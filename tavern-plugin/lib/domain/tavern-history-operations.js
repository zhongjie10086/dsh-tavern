import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { nativeHistoryItems, planNativeHistoryEdit, synchronizeNativeHistoryEdit, isHistoryEditMarker } from './session-history-edit.js'
import { sessionEvents } from './session-events.js'
import { tavernAssistantTurn, syncAuthoredAgentPhase } from './session-surface-edit.js'
import { synchronizeBodyEdits } from './body-editor.js'

const role=row=>row.tavernRoleOverride || (row.role==='tavern-helper'?row.tavernRole:row.role)
const text=row=>String(row.sessionText ?? row.text ?? row.sourceText ?? '')
const own=(o,k)=>Object.hasOwn(o,k)
function mergeFields(base,current,desired,label) {
  const result=structuredClone(current)
  for(const key of new Set([...Object.keys(base),...Object.keys(desired)])) {
    if(own(base,key)===own(desired,key) && isDeepStrictEqual(base[key],desired[key]))continue
    if(!(own(base,key)===own(current,key)&&isDeepStrictEqual(base[key],current[key])) && !(own(desired,key)===own(current,key)&&isDeepStrictEqual(desired[key],current[key])))throw new Error(label+'已被其他操作修改，历史操作等待恢复')
    if(own(desired,key))Object.defineProperty(result,key,{value:structuredClone(desired[key]),enumerable:true,writable:true,configurable:true});else delete result[key]
  }
  return result
}
function expandCompactedItems(session,items) {
  const events=sessionEvents(session),bySeq=new Map(events.map(e=>[e.seq,e]))
  const visit=(item,ancestors=new Set())=>{
    if(item.message.source?.plugin!=='compact')return [item]
    if(ancestors.has(item.event.seq))throw new Error('压缩来源包含循环')
    const next=new Set([...ancestors,item.event.seq])
    const source=(item.event.sourceEventSeqs||[]).map(seq=>bySeq.get(seq)).filter(e=>e&&['user/message','assistant/message','system/message','tool/result'].includes(e.type))
    if(!source.length)throw new Error('压缩记录缺少原始历史来源')
    return source.flatMap(event=>visit({event,message:structuredClone(event.type==='user/message'?event.data:event.data.message),logicalTurn:tavernAssistantTurn(event,events)},next))
  }
  return items.flatMap(item=>visit(item))
}
function findBindings(chat,items) {
  const used=new Set(),bindings=new Map(),byId=new Map(),byTurn=new Map(),byText=new Map(),users=[];let cursor=0
  const push=(map,key,index)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(index)}
  items.forEach((item,index)=>{push(byId,item.message.id,index);if(item.event?.type==='assistant/message'&&item.message.source?.model!=='synthetic-trajectory'&&item.message.content.some(b=>b.type==='text'))push(byTurn,item.logicalTurn,index);if(item.event?.type==='user/message'&&['user','human'].includes(item.message.source?.kind)){users.push(index);push(byText,item.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),index)}})
  function first(positions=[],minimum=0){let lo=0,hi=positions.length;while(lo<hi){const mid=(lo+hi)>>>1;if(positions[mid]<minimum)lo=mid+1;else hi=mid}while(lo<positions.length&&used.has(positions[lo]))lo++;return positions[lo]??-1}
  function last(positions=[]){while(positions.length&&used.has(positions.at(-1)))positions.pop();return positions.at(-1)??-1}
  for(const [index,row]of chat.messages.entries()) {
    const nativeId=row.tavernNativeMessageId || (row.importSource?'tavern-import:'+row.importSource.operationId+':'+row.importSource.line:row.role==='tavern-helper'?'tavern-helper-user:'+chat.id+':'+index:'')
    let at=nativeId?first(byId.get(nativeId)):-1
    if(at<0 && row.role==='assistant')at=last(byTurn.get(Number(row.turn || (row.greeting?1:0))))
    if(at<0 && row.role==='user') {
      const sources=[row.text,row.sessionText,row.sourceText].filter(v=>typeof v==='string')
      const matches=sources.map(value=>first(byText.get(value),cursor)).filter(index=>index>=0);at=matches.length?Math.min(...matches):-1
      if(at<0)at=first(users,cursor)
    }
    if(at<0) {if(row.tavernHidden===true)continue;return null}
    used.add(at);cursor=at+1;bindings.set(row.tavernHistoryKey,at)
  }
  return bindings
}
/** Resolve Chat floors to actual native messages before changing any durable state. */
export function projectHistoryMutation(session,before,after) {
  let items=nativeHistoryItems(session), bindings=findBindings(before,items)
  if(!bindings){items=expandCompactedItems(session,items);bindings=findBindings(before,items)}
  if(!bindings)throw new Error('历史楼层缺少原生来源，无法安全修改；请先导出诊断')
  const oldRows=new Map(before.messages.map(row=>[row.tavernHistoryKey,row]))
  const ordered=[...bindings].sort((a,b)=>a[1]-b[1]), groups=new Map()
  const prefix=items.slice(0,ordered[0]?.[1] ?? items.length)
  for(const [index,[key,start]]of ordered.entries())groups.set(key,items.slice(start,ordered[index+1]?.[1]??items.length))
  const result=[...prefix]
  for(const row of after.messages) {
    const prior=oldRows.get(row.tavernHistoryKey), group=groups.get(row.tavernHistoryKey)
    if(row.tavernHidden===true)continue
    const body=group?.[0], changed=!prior||role(prior)!==role(row)||text(prior)!==text(row)
    let message=body?structuredClone(body.message):{id:'new:'+row.tavernHistoryKey,role:role(row),content:[],source:{kind:'plugin',plugin:'dsh-tavern-helper'}}
    if(changed||!body) {
      message.role=role(row)
      // Attachment references and paired tool blocks remain intact when editing prose.
      message.content=[{type:'text',text:text(row)},...message.content.filter(block=>block.type!=='text')]
      if(message.role==='system') {message.role='user';message.source={kind:'plugin',plugin:'dsh-tavern-helper-system',authoredRole:'system'}}
      else if(message.role==='user')message.source={kind:'plugin',plugin:'dsh-tavern-helper'}
      else message.source={kind:'model',provider:'dsh-tavern',model:'history-edit'}
    }
    const item={...body,message,logicalTurn:Number(row.turn)||(row.greeting?1:0),floorKey:row.tavernHistoryKey}
    result.push(item)
    for(const auxiliary of group?.slice(1)||[]) {
      if(isHistoryEditMarker(auxiliary.event)||auxiliary.message.content.length===0)continue
      // Old task frames contain the previous input; the next round builds a fresh frame.
      if(changed&&role(prior)==='user'&&auxiliary.message.source?.form==='foreground-frame')continue
      result.push(auxiliary)
    }
  }
  return {items:result,bindings}
}
function invalidate(after,before) {
  let first=0
  while(first<before.messages.length&&first<after.messages.length&&isDeepStrictEqual(before.messages[first],after.messages[first]))first++
  if(first===before.messages.length&&first===after.messages.length)return
  const turns=[...before.messages.slice(first),...after.messages.slice(first)].map(row=>Number(row.turn)||(row.greeting?1:0)).filter(Boolean)
  const turn=turns.length?Math.min(...turns):0
  if(after.timeline) {
    after.timeline.revision=(Number(after.timeline.revision)||0)+1
    after.timeline.updatedAt=Date.now()
    after.timeline.checkpoints=(after.timeline.checkpoints||[]).filter(checkpoint=>Number(checkpoint.turn)<turn)
    after.timeline.operations={}
    for(const [key,participant]of Object.entries(after.timeline.participants||{}))after.timeline.participants[key]={...participant,sessionId:'',status:'needs-session',boundary:null,syncedRevision:null}
  }
  after.candidates=null;after.preparedWorldBookContext='';after.preparedWorldBook=null;after.worldBookReads=[]
  after.runtimeInputs=Object.fromEntries(Object.entries(after.runtimeInputs||{}).filter(([key])=>Number(key)<turn))
  if(after.spDatabase) {
    after.spDatabase.lastFilledBody='';after.spDatabase.lastRecall=null
    after.spDatabase.historyChanged={at:Date.now(),fromMessage:first,fromTurn:turn}
    after.spDatabase.snapshots=(after.spDatabase.snapshots||[]).map(snapshot=>Number(snapshot.turn)>=turn?{...snapshot,historyStale:true}:snapshot)
  }
  for(const row of after.messages.slice(first)) {delete row.displayRuntime;delete row.bodyEdit;delete row.tavernTemplateDisplay}
  if(after.contextCompaction)after.contextCompaction={...after.contextCompaction,baseline:[],operation:null,warning:''}
}

/** Durable prepare → native append/flush → authoritative Chat commit, with exact recovery. */
export function createTavernHistoryOperations({chats,sessions,activity=()=>({}),exclusive=(_id,work)=>work(),prepareHistory,afterCommit}) {
  const running=new Map()
  function idle(chat,agent) {
    const status=activity(chat)
    if(agent?.phase?.kind==='running'||chat.regenInProgress||['pending','running'].includes(chat.settleStatus)||status.busy||['pending','running'].includes(status.phase)||chat.contextCompaction?.operation?.status==='running'||['activity','maintenance','inspiration'].some(key=>chat.spDatabase?.[key]?.status==='running'))throw new Error('请等待生成、填表或后台处理完成后修改历史')
  }
  async function finish(chat,agent) {
    const pending=chat.nativeHistoryEdit
    if(!pending)return chat
    await synchronizeNativeHistoryEdit(agent.session,pending.plan,async session=>{syncAuthoredAgentPhase(agent);await sessions.flush(session)})
    return chats.update(chat.id,current=>{
      if(current.nativeHistoryEdit?.id!==pending.id)throw new Error('历史操作记录已变化')
      const base=pending.before,desired=pending.after
      const rows=new Map(current.messages.map(row=>[row.tavernHistoryKey,row]))
      const previous=new Map(base.messages.map(row=>[row.tavernHistoryKey,row]))
      const messages=desired.messages.map(row=>previous.has(row.tavernHistoryKey)?mergeFields(previous.get(row.tavernHistoryKey),rows.get(row.tavernHistoryKey)||{},row,'消息'):structuredClone(row))
      const withoutMessages=object=>Object.fromEntries(Object.entries(object).filter(([key])=>!['messages','_storageRevision','updatedAt','nativeHistoryEdit'].includes(key)))
      const merged=mergeFields(withoutMessages(base),withoutMessages(current),withoutMessages(desired),'聊天状态')
      const next={...merged,messages,_storageRevision:current._storageRevision,updatedAt:current.updatedAt}
      next.nativeHistoryReceipt={id:pending.id,at:Date.now(),digest:pending.plan?.digest||'',source:'tavern-helper'}
      return next
    },{source:'history.commit'})
  }
  async function recover(sessionId) {
    if(running.has(sessionId))return running.get(sessionId)
    const chat=await chats.forSession(sessionId)
    if(!chat?.nativeHistoryEdit)return chat
    const agent=sessions.get(sessionId)
    if(!agent?.session)throw new Error('无法访问原生会话')
    const task=exclusive(chat.id,()=>finish(chat,agent));running.set(sessionId,task)
    let saved
    try{saved=await task}finally{running.delete(sessionId)}
    if(afterCommit)await afterCommit(sessionId)
    return saved
  }
  async function mutate(initial,mutator,{template=true}={}) {
    if(running.has(initial.sessionId))await running.get(initial.sessionId)
    const task=exclusive(initial.id,async()=>{
      let current=await chats.forSession(initial.sessionId),agent=sessions.get(initial.sessionId)
      if(!agent?.session)throw new Error('无法访问原生会话')
      if(current.nativeHistoryEdit)current=await finish(current,agent)
      idle(current,agent)
      if(current._storageRevision!==initial._storageRevision)throw new Error('聊天已被其他操作修改，请重新读取')
      await synchronizeBodyEdits(agent.session,current,sessions.flush);syncAuthoredAgentPhase(agent)
      const before=structuredClone(current)
      for(const row of before.messages)row.tavernHistoryKey ||= randomUUID()
      let after=structuredClone(before);const targets=await mutator(after)
      for(const row of after.messages)row.tavernHistoryKey ||= randomUUID()
      invalidate(after,before)
      if(template&&prepareHistory)after=await prepareHistory(before,after,targets)
      const projected=projectHistoryMutation(agent.session,before,after)
      const plan=planNativeHistoryEdit(agent.session,projected.items)
      for(const row of after.messages) {
        const nativeId=plan?.bindings[row.tavernHistoryKey] || projected.items.find(item=>item.floorKey===row.tavernHistoryKey)?.message.id
        if(nativeId)row.tavernNativeMessageId=nativeId
      }
      const pending={id:randomUUID(),before,after,plan}
      current=await chats.update(current.id,latest=>{
        idle(latest,agent)
        if(latest._storageRevision!==initial._storageRevision || latest.nativeHistoryEdit)throw new Error('聊天已被其他操作修改，请重新读取')
        latest.messages=before.messages;latest.nativeHistoryEdit=pending;return latest
      },{source:'history.prepare'})
      try {const saved=await finish(current,agent);return {chat:saved,targets}}
      catch(error) {
        // No native marker means nothing was published. Cancel only this admission.
        if(!plan||!sessionEvents(agent.session).some(e=>isHistoryEditMarker(e)&&e.data.id==='tavern-history-marker:'+plan.id))await chats.update(current.id,latest=>{if(latest.nativeHistoryEdit?.id===pending.id)delete latest.nativeHistoryEdit;return latest},{source:'history.abort'})
        throw error
      }
    })
    running.set(initial.sessionId,task)
    let result
    try{result=await task}finally{if(running.get(initial.sessionId)===task)running.delete(initial.sessionId)}
    if(afterCommit)await afterCommit(initial.sessionId)
    return result
  }
  return {mutate,recover,isRunning:sessionId=>running.has(sessionId)}
}
