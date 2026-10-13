import { consumeTemplateInput } from './full-prompt-template-input.js'
import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { projectFullPromptTemplateState, applyFullPromptTemplateState } from './full-prompt-template-state.js'
import { assertPluginJson } from './tavern-chat-plugin-data.js'
import { RETENTION_DEFAULTS } from './retention-policy.js'
import { immutableJsonSnapshot, mutableJsonDraft } from './json-draft.js'

/** Stage effects until the corresponding native history commit durably owns them. */
export function createFullPromptTemplateCommitter({ execute, rpc, chats, project, readWorldbook, retention=RETENTION_DEFAULTS }) {
  const flushes=new Map(),queues=new Map()
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key)
  const equal=(a,b,key)=>own(a,key)===own(b,key)&&isDeepStrictEqual(a[key],b[key])
  function serialize(sessionId,work) {
    const task=(queues.get(sessionId)||Promise.resolve()).catch(()=>{}).then(work)
    queues.set(sessionId,task)
    task.finally(()=>{if(queues.get(sessionId)===task)queues.delete(sessionId)}).catch(()=>{})
    return task
  }
  async function flushNow(sessionId) {
    let chat=await chats.forSession(sessionId)
    while(chat?.fullPromptTemplateEffects?.length) {
      const effect=chat.fullPromptTemplateEffects[0]
      if(effect.status==='blocked')throw new Error('模板操作已阻塞（blocked），请先在恢复面板处理')
      try { await rpc(effect.method,{...effect.args,sessionId}) }
      catch(error) {
        await chats.update(chat.id,current=>{
          const first=current.fullPromptTemplateEffects?.[0]
          if(first?.id!==effect.id)return undefined
          first.failures=(Number(first.failures)||0)+1;first.status=first.failures>=retention.effectFailures?'blocked':'pending';first.lastError=String(error.message||error).slice(0,1000)
          return current
        },{source:'prompt-template.effect-failure'})
        throw error
      }
      chat=await chats.update(chat.id,current=>{
        current.fullPromptTemplateEffects=(current.fullPromptTemplateEffects||[]).filter(item=>item.id!==effect.id)
        return current
      },{source:'prompt-template.effects'})
    }
  }
  async function flush(sessionId) {
    if(flushes.has(sessionId))return flushes.get(sessionId)
    const task=serialize(sessionId,()=>flushNow(sessionId));flushes.set(sessionId,task)
    try{await task}finally{if(flushes.get(sessionId)===task)flushes.delete(sessionId)}
  }
  async function inspect(sessionId) {
    const chat=await chats.forSession(sessionId),effect=chat?.fullPromptTemplateEffects?.[0]
    if(!chat)throw new Error('模板游戏不存在')
    if(!effect)return {pending:0,effect:null}
    const globals=effect.method==='saveFullPromptTemplateGlobals'
    if(!globals&&effect.method!=='saveFullPromptTemplateSettings')throw new Error('待恢复模板操作不受支持')
    const field=globals?'variables':'settings',expected=globals?'expectedVariables':'expectedSettings'
    const {environment}=await rpc('getFullPromptTemplateState',{sessionId})
    const current=structuredClone(globals?environment.extension_settings.variables.global:environment.extension_settings.EjsTemplate||{})
    const base=effect.args[expected]||{},desired=effect.args[field]
    const keys=[...new Set([...Object.keys(base),...Object.keys(desired)])].filter(key=>!equal(base,desired,key))
    const revision=createHash('sha256').update(JSON.stringify([effect,current])).digest('hex')
    return {pending:chat.fullPromptTemplateEffects.length,revision,effect:{id:effect.id,status:effect.status||'pending',failures:Number(effect.failures)||0,lastError:effect.lastError||'',kind:field,label:globals?'全局变量':'模板设置',base:structuredClone(base),desired:structuredClone(desired),current,keys,conflicts:keys.filter(key=>!equal(base,current,key)&&!equal(desired,current,key))}}
  }
  async function resolve(sessionId,{revision,action}={}) {
    return serialize(sessionId,async()=>{
      const preview=await inspect(sessionId)
      if(!preview.effect)return preview
      if(preview.revision!==revision)throw new Error('待恢复操作或当前数据已变化，请刷新后再选择')
      if(!['retry','keep-current','apply-pending'].includes(action))throw new Error('请选择模板恢复方式')
      const chat=await chats.forSession(sessionId),effect=chat.fullPromptTemplateEffects[0]
      if(action==='retry'){
        await chats.update(chat.id,current=>{const first=current.fullPromptTemplateEffects?.[0];if(first?.id!==effect.id)throw Error('待恢复操作已变化');first.status='pending';first.failures=0;delete first.lastError;return current},{source:'prompt-template.retry'})
        await flushNow(sessionId)
      }
      else {
        if(action==='apply-pending') {
          const {current,desired,keys}=preview.effect,next=structuredClone(current)
          for(const key of keys)if(own(desired,key))Object.defineProperty(next,key,{value:structuredClone(desired[key]),enumerable:true,writable:true,configurable:true});else delete next[key]
          const globals=effect.method==='saveFullPromptTemplateGlobals'
          await rpc(effect.method,{sessionId,[globals?'variables':'settings']:next,[globals?'expectedVariables':'expectedSettings']:current})
        }
        await chats.update(chat.id,current=>{
          const first=current.fullPromptTemplateEffects?.[0]
          if(first?.id!==effect.id)throw new Error('待恢复操作已变化')
          current.fullPromptTemplateEffects=current.fullPromptTemplateEffects.slice(1)
          current.fullPromptTemplateEffectResolutions=[...(current.fullPromptTemplateEffectResolutions||[]),{id:effect.id,at:Date.now(),action,revision,keys:preview.effect.keys}].slice(-100)
          return current
        },{source:'prompt-template.recovery'})
      }
      return inspect(sessionId)
    })
  }
  async function stage(chat,operation,{signal,envelope:providedEnvelope,serviceContext,bodyIds=[]}={}) {
    if(chat.fullPromptTemplateEffects?.some(effect=>effect.status==='blocked'))throw new Error('模板操作已阻塞（blocked），请先处理恢复队列')
    const sessionId=chat.sessionId,storageRevision=chat._storageRevision
    let draft=mutableJsonDraft(immutableJsonSnapshot(chat));draft._storageRevision=Math.max(1,Number(draft._storageRevision)||0)
    const envelope=providedEnvelope || await rpc('getFullPromptTemplateState',{sessionId})
    const environment=structuredClone(envelope.environment)
    const baselines=new Map([[draft._storageRevision,immutableJsonSnapshot(draft)]]),effects=new Map()
    const stagedRpc=async(method,args)=>{
      if(method==='loadFullPromptTemplateWorldInfo') {if(!readWorldbook)throw new Error('模板世界书读取器未连接');return readWorldbook(args.name,draft)}
      if(method==='getFullPromptTemplateState')return {state:projectFullPromptTemplateState(draft),environment:structuredClone(environment)}
      if(method==='saveFullPromptTemplateState') {
        draft=applyFullPromptTemplateState(draft,baselines.get(args.state.stateRevision),args.state,{allowMessageBodyChanges:new Set(bodyIds)})
        draft._storageRevision++;baselines.set(draft._storageRevision,immutableJsonSnapshot(draft))
        return {updated:true,state:projectFullPromptTemplateState(draft)}
      }
      if(method==='saveFullPromptTemplateGlobals'||method==='saveFullPromptTemplateSettings') {
        const field=method==='saveFullPromptTemplateGlobals'?'variables':'settings',expected=field==='variables'?'expectedVariables':'expectedSettings'
        assertPluginJson(args[field],'模板共享状态')
        const prior=effects.get(method)
        effects.set(method,{id:prior?.id||randomUUID(),method,args:{[field]:structuredClone(args[field]),[expected]:prior?prior.args[expected]:structuredClone(args[expected])}})
        if(field==='variables')environment.extension_settings.variables.global=structuredClone(args[field])
        else environment.extension_settings.EjsTemplate=structuredClone(args[field])
        return {updated:true,[field]:structuredClone(args[field])}
      }
      throw new Error('模板提交包含不支持的操作')
    }
    const result=await execute(sessionId,operation,{signal,rpc:stagedRpc,serviceContext})
    draft._storageRevision=storageRevision
    const pending=[...(draft.fullPromptTemplateEffects||[])]
    for(const effect of effects.values()){
      const previous=pending.at(-1),field=effect.method==='saveFullPromptTemplateGlobals'?'variables':'settings',expected=field==='variables'?'expectedVariables':'expectedSettings'
      if(previous?.method===effect.method&&!previous.failures&&isDeepStrictEqual(previous.args[field],effect.args[expected]))pending[pending.length-1]={...effect,args:{...effect.args,[expected]:previous.args[expected]}}
      else pending.push(effect)
    }
    if(pending.length>retention.effectCount||Buffer.byteLength(JSON.stringify(pending))>retention.effectBytes)throw Error('模板待处理队列已达到数量或容量上限，请先处理恢复队列')
    draft.fullPromptTemplateEffects=pending
    return {chat:draft,result,environment}
  }
  async function projectMessage(chat,id,rendered,edited=false) {
    const target=chat.messages[id],swipeId=Math.max(0,Number(target.swipeId)||0)
    const nextReply=await project(rendered.text,chat,{messageId:id,role:target.tavernRoleOverride||target.tavernRole||target.role,edited})
    Object.assign(target,{text:nextReply.sessionText,sessionText:nextReply.sessionText,sourceText:nextReply.sourceText,projectionText:nextReply.projectionText,displayText:nextReply.displayText,displayMode:nextReply.displayMode||'html',projectionWarnings:nextReply.warnings||[]})
    // These fields are optional compatibility fallbacks. Identical text needs
    // no additional saved mirror, and ordinary Markdown needs no iframe capture.
    delete target.sessionText
    if(target.displayText===target.text)delete target.displayText
    target.swipes=structuredClone(target.swipes||[]);target.swipes[swipeId]=nextReply.projectionText
    if(rendered.unchangedMarkup===true&&nextReply.displayMode==='markdown')delete target.tavernTemplateDisplay
    else target.tavernTemplateDisplay={html:rendered.html,sourceText:nextReply.projectionText,...Array.isArray(rendered.parts)?{parts:structuredClone(rendered.parts)}:{}}
    return nextReply
  }
  async function prepare({chat,reply,...options}) {
    const draft=consumeTemplateInput(mutableJsonDraft(immutableJsonSnapshot(chat))),messageId=draft.messages.length-1,message=draft.messages[messageId]
    if(message?.role!=='assistant')throw new Error('模板提交缺少新回复')
    const raw=reply.sourceText,swipeId=Math.max(0,Number(message.swipeId)||0)
    message.swipes=structuredClone(message.swipes||[raw]);message.swipes[swipeId]=raw
    Object.assign(message,{text:raw,sourceText:raw,projectionText:raw,swipeId})
    const staged=await stage(draft,{kind:'message',messageId,created:true},{...options,bodyIds:[messageId]})
    return {chat:staged.chat,reply:await projectMessage(staged.chat,messageId,staged.result)}
  }
  async function prepareHistory({chat,events,...options}) {
    const ids=events.filter(event=>event.kind==='message').map(event=>event.messageId)
    const staged=await stage(chat,{kind:'history',events},{...options,bodyIds:ids})
    for(const rendered of staged.result.messages)await projectMessage(staged.chat,rendered.messageId,rendered,true)
    return staged.chat
  }
  return {prepare,prepareHistory,stage,flush,inspect,resolve}
}
