import {mergeConcurrentFields} from './chat-persistence.js'
import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {assertPluginJson} from './tavern-chat-plugin-data.js'
const copy=structuredClone,file='script-variable-policies.json'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const has=(value,key)=>value!==null&&value!==undefined&&Object.hasOwn(value,key)
function at(value,path){for(const key of path){if(!has(value,key))return {present:false};value=value[key]}return {present:true,value}}
function assign(value,path,record){let cursor=value;for(const key of path.slice(0,-1)){if(!object(cursor[key]))Object.defineProperty(cursor,key,{value:{},enumerable:true,writable:true,configurable:true});cursor=cursor[key]}const key=path.at(-1);if(record.present)Object.defineProperty(cursor,key,{value:copy(record.value),enumerable:true,writable:true,configurable:true});else delete cursor[key]}
function fields(value,path=[]){if(object(value)&&Object.keys(value).length&&path.length<8)return Object.keys(value).flatMap(key=>fields(value[key],path.concat(key)));return path.length?[path]:[]}
const defaultState=()=>({version:1,revision:0,rules:{}})
const apiDefault=script=>script?._dshVariableScope==='shared'
/** Legacy unknown data stays local. New host-admitted scripts use their declared API scope. */
export function createScriptVariablePolicy({store,chats,scripts,readCardVariables=async()=>({}),readStorage=async()=>({}),isBusy=()=>false,fault=async()=>{}}){
 let tail=Promise.resolve()
 const serialize=work=>{const task=tail.catch(()=>{}).then(work);tail=task;return task}
 const state=async()=>await (store.readReadonly||store.readJson)(file)||defaultState()
 function identity(chat,script){return script._dshResourceId||hash([script.scope,script.scope==='global'?'global':script.scope==='preset'?chat.resourceBindings?.preset?.id||chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath:chat.cardPath,script.id])}
 async function effective(chat,current){
  const all=await scripts(chat),snapshot=current||await state(),rules=snapshot.rules,result=copy(chat.tavernHelperScriptVariables||{})
  for(const script of all){
   const owner=identity(chat,script),api=apiDefault(script),active=Object.values(rules).filter(row=>row.owner===owner&&row.status==='active')
   const matched=active.filter(row=>row.target==='shared'||row.formerShared&&chat.scriptVariableMigration?.[hash([owner,row.path])]!==row.operationId)
   if(!api&&!matched.length)continue
   const value=copy(api?snapshot.apiValues?.[owner]?.value??script.data??{}:result[script.id]??script.data??{})
   if(api)for(const row of active.filter(row=>row.target==='local')){
    const migrated=chat.scriptVariableMigration?.[hash([owner,row.path])]===row.operationId
    assign(value,row.path,!migrated&&row.formerShared?row.formerShared:at(result[script.id]||{},row.path))
   }
   for(const row of matched)if(!api||row.target==='shared')assign(value,row.path,row.target==='shared'?row.value:row.formerShared)
   Object.defineProperty(result,script.id,{value,enumerable:true,writable:true,configurable:true})
  }
  return result
 }
 async function inspect(sessionId){const chat=await chats.forSession(sessionId);if(!chat)throw Error('请先进入一局游玩');const current=await state(),rows=[],all=await scripts(chat),known=new Set(all.map(row=>row.id)),effectiveValues=await effective(chat,current)
  for(const script of all.concat(Object.keys(chat.tavernHelperScriptVariables||{}).filter(id=>!known.has(id)).map(id=>({id,name:id,scope:'missing',data:{}})))){
   const owner=identity(chat,script),value=effectiveValues[script.id]??script.data??{}
   for(const path of fields(value)){const id=hash([owner,path]),rule=current.rules[id],record=at(value,path);rows.push({id,owner,scriptId:script.id,scriptName:script.name,scriptScope:script.scope,path,key:path.join('.'),source:Object.hasOwn(chat.tavernHelperScriptVariables||{},script.id)?'Helper script 变量':'脚本 data 初值',purpose:rule?.purpose||'',authorDeclaration:'',evidence:rule?'玩家保存的分类决定':apiDefault(script)?'新资源按 script API 默认共享；用途尚未核验':'实际保存位置；用途尚未核验',apiShared:apiDefault(script),target:rule?.target||(apiDefault(script)?'api-shared':'undecided'),choices:script.scope==='missing'?['keep']:['keep','local','shared'],valueType:Array.isArray(record.value)?'array':record.value===null?'null':typeof record.value,bytes:Buffer.byteLength(JSON.stringify(record.value)),valueDigest:hash(record),decided:!!rule})}
  }
  const card=await readCardVariables(chat)
  for(const key of Object.keys(card||{})){const id=hash(['character-initial',chat.cardPath,key]),rule=current.rules[id];rows.push({id,source:'角色卡变量初值',scriptName:'角色卡',path:[key],key,purpose:rule?.purpose||'',authorDeclaration:'',evidence:rule?'玩家决定保留初值':'角色卡声明的变量；没有用途声明',target:rule?.target||'undecided',choices:['keep'],bytes:Buffer.byteLength(JSON.stringify(card[key])),valueDigest:hash({present:true,value:card[key]}),decided:!!rule})}
  const storage=await readStorage(chat,all)
  for(const script of all)for(const [key,value]of Object.entries(storage[script.id]||{})){
   const id=hash(['localStorage',identity(chat,script),key]),rule=current.rules[id];rows.push({id,source:'脚本 localStorage',scriptName:script.name,path:[key],key:'localStorage.'+key,purpose:rule?.purpose||'',authorDeclaration:'',evidence:rule?'玩家决定保留原作用域':'实际保存位置；内容可能混合配置与剧情，未拆解字符串',target:rule?.target||'undecided',choices:['keep'],bytes:Buffer.byteLength(JSON.stringify(value)),valueDigest:hash(value),decided:!!rule})
  }
  return {revision:current.revision,rows,unknown:rows.filter(row=>!row.decided).length,notice:'新资源的 script 变量依原 API 默认共享；旧未知数据保持原位。用途留空不影响运行；聊天、消息、MVU 和表格不在此迁移。'}
 }
 async function recover(){const current=await state();for(const [id,row]of Object.entries(current.rules)){if(row.status!=='pending')continue
   const chat=await chats.forSession(row.sourceSessionId),receipt=chat?.scriptVariableMigration?.[id]
   if(receipt===row.operationId)await store.updateJson(file,value=>{if(value?.rules[id]?.operationId!==row.operationId)return;return {...value,revision:value.revision+1,rules:{...value.rules,[id]:Object.fromEntries(Object.entries({...row,status:'active'}).filter(([key])=>key!=='previous'))}}})
   else await store.updateJson(file,value=>{if(value?.rules[id]?.operationId!==row.operationId)return;const rules={...value.rules};if(row.previous)rules[id]=row.previous;else delete rules[id];return {...value,revision:value.revision+1,rules}})
  }}
 async function decide(sessionId,selections,expectedRevision){return serialize(async()=>{
   await recover();const report=await inspect(sessionId),chat=await chats.forSession(sessionId)
   if(report.revision!==expectedRevision)throw Error('变量清单已变化，请刷新后选择');if(isBusy(chat))throw Error('请等待本轮结束后迁移配置')
   if(!Array.isArray(selections)||!selections.length)throw Error('请选择要处理的变量')
   const all=await scripts(chat),selected=selections.map(selection=>{const row=report.rows.find(row=>row.id===selection.id);if(!row||!row.choices.includes(selection.target)||row.valueDigest!==selection.valueDigest)throw Error('变量或选择已变化，请刷新');return {...row,target:selection.target,purpose:selection.target==='shared'?'玩家确认的共享配置':selection.target==='local'?'玩家确认的本局数据':'玩家选择保留原作用域'}})
   if(new Set(selected.map(row=>row.id)).size!==selected.length)throw Error('变量选择重复')
   const before=await state(),operationId=randomUUID(),effectiveValues=await effective(chat,before)
   await store.writeJson('recovery/variable-decisions/'+operationId+'.json',{version:1,chatId:chat.id,operationId,selected:selected.map(row=>({id:row.id,scriptId:row.scriptId,path:row.path,target:row.target,value:row.scriptId?at(effectiveValues[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{},row.path):undefined})),priorRules:Object.fromEntries(selected.filter(row=>before.rules[row.id]).map(row=>[row.id,before.rules[row.id]]))})
   const rules={...before.rules}
   for(const row of selected){const value=row.scriptId?at(effectiveValues[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{},row.path):{present:false};rules[row.id]={owner:row.owner||'',path:row.path,target:row.target,purpose:row.purpose,value:row.target==='shared'?value:undefined,formerShared:row.target==='local'&&row.apiShared?value:row.target!=='shared'&&before.rules[row.id]?.target==='shared'?before.rules[row.id].value:undefined,status:'pending',sourceSessionId:sessionId,operationId,previous:before.rules[row.id]}}
   await store.updateJson(file,current=>{if(Number(current?.revision||0)!==expectedRevision)throw Error('配置分类已被其他窗口修改');return {...(current||{}),version:1,revision:expectedRevision+1,rules}});await fault('prepared')
   try{
    await chats.update(chat.id,current=>{
     if(isBusy(current)||Number(current.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0))throw Error('本局状态已变化，请刷新')
     for(const row of selected){if(!row.scriptId)continue;const baseline=at(chat.tavernHelperScriptVariables?.[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{},row.path),latest=at(current.tavernHelperScriptVariables?.[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{},row.path);if(!isDeepStrictEqual(baseline,latest))throw Error('变量内容已变化，迁移未覆盖新值')
      if(row.apiShared||row.target!=='keep'||before.rules[row.id]?.target==='shared'){current.tavernHelperScriptVariables=copy(current.tavernHelperScriptVariables||{});const value=copy(current.tavernHelperScriptVariables[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{});assign(value,row.path,row.target==='shared'||row.apiShared&&row.target==='keep'?{present:false}:at(effectiveValues[row.scriptId]??all.find(s=>s.id===row.scriptId)?.data??{},row.path));Object.defineProperty(current.tavernHelperScriptVariables,row.scriptId,{value,enumerable:true,writable:true,configurable:true})}
     }
     current.scriptVariableMigration={...current.scriptVariableMigration,...Object.fromEntries(selected.map(row=>[row.id,operationId]))};return current
    },{source:'script-variable.classification'});await fault('chat-written');await recover()
   }catch(error){await recover();throw error}
   return inspect(sessionId)
 })}
 // Shared script API writes are independent from plot settlement, as in the original API.
 // A later plot cancellation does not rewind a successful shared-settings write.
 async function saveApi(chat,script,variables,expectedVariables,current,stageOnly=false){
  const owner=identity(chat,script),active=Object.entries(current.rules).filter(([,row])=>row.owner===owner&&row.status==='active'),locals=active.filter(([,row])=>row.target==='local')
  const effectiveValue=(await effective(chat,current))[script.id]||{},expected=copy(expectedVariables??effectiveValue),requested=copy(variables)
  const shared=copy(current.apiValues?.[owner]?.value??script.data??{}),baseline=copy(expected),desired=copy(requested),local={},expectedLocal={}
  for(const [,row]of active.filter(([,row])=>row.target==='shared'))assign(shared,row.path,row.value)
  for(const [,row]of locals){
   assign(local,row.path,at(requested,row.path));assign(expectedLocal,row.path,at(expected,row.path))
   for(const value of [shared,baseline,desired])assign(value,row.path,{present:false})
  }
  const merged=mergeConcurrentFields(baseline,shared,desired,chat.id)
  const latest=await chats.forSession(chat.sessionId||chat.id)
  if(!latest||Number(latest.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0))throw Error('脚本生命周期已变化')
  let saved=chat
  if(!stageOnly)saved=await chats.update(chat.id,value=>{
   if(Number(value.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0))throw Error('脚本生命周期已变化')
   const latestLocal={}
   for(const [id,row]of locals){const migrated=value.scriptVariableMigration?.[id]===row.operationId;assign(latestLocal,row.path,!migrated&&row.formerShared?row.formerShared:at(value.tavernHelperScriptVariables?.[script.id]||{},row.path))}
   const kept=mergeConcurrentFields(expectedLocal,latestLocal,local,chat.id)
   value.tavernHelperScriptVariables={...value.tavernHelperScriptVariables,[script.id]:kept}
   if(locals.length)value.scriptVariableMigration={...value.scriptVariableMigration,...Object.fromEntries(locals.map(([id,row])=>[id,row.operationId]))}
   return value
  },{source:'script-variable.api-local'})
  const rules={...current.rules}
  for(const [id,row]of active.filter(([,row])=>row.target==='shared'))rules[id]={...row,value:at(merged,row.path)}
  if(!isDeepStrictEqual(current.apiValues?.[owner]?.value,merged)||!isDeepStrictEqual(rules,current.rules))await store.updateJson(file,value=>{
   const latest=value||defaultState();if(Number(latest.revision)!==Number(current.revision))throw Error('共享脚本变量已变化，请重试')
   return {...latest,revision:current.revision+1,rules,apiValues:{...latest.apiValues,[owner]:{value:merged}}}
  })
  return stageOnly?local:{handled:true,chat:saved,variables:await effective(saved)}
 }
 async function save(chat,scriptId,variables,expectedVariables){return serialize(async()=>{
  assertPluginJson(variables,'脚本变量');if(!object(variables))throw Error('脚本变量必须是对象');await recover()
  const all=await scripts(chat),script=all.find(row=>row.id===scriptId);if(!script)throw Error('脚本变量缺少当前资源')
  const current=await state();if(apiDefault(script))return saveApi(chat,script,variables,expectedVariables,current)
  const owner=identity(chat,script),matches=Object.entries(current.rules).filter(([,row])=>row.owner===owner&&row.target==='shared'&&row.status==='active'),local=copy(variables)
  if(!matches.length)return {handled:false}
  const effectiveValues=(await effective(chat,current))[scriptId]||{},expected=expectedVariables??effectiveValues
  const rules={...current.rules}
  for(const [id,row]of matches){const requested=at(variables,row.path),baseline=at(expected,row.path);if(!isDeepStrictEqual(requested,baseline)&&!isDeepStrictEqual(row.value,baseline)&&!isDeepStrictEqual(row.value,requested))throw Error('共享脚本配置已被其他窗口修改：'+row.path.join('.'));if(!isDeepStrictEqual(requested,baseline))rules[id]={...row,value:requested};assign(local,row.path,{present:false})}
  // Publish local progress first. Shared values are independent configuration, never plot.
  const saved=await chats.update(chat.id,current=>{if(Number(current.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0))throw Error('脚本生命周期已变化');const baseline=copy(chat.tavernHelperScriptVariables?.[scriptId]??script.data??{}),latest=copy(current.tavernHelperScriptVariables?.[scriptId]??script.data??{});for(const [,row]of matches){assign(baseline,row.path,{present:false});assign(latest,row.path,{present:false})}const merged=mergeConcurrentFields(baseline,latest,local,chat.id);current.tavernHelperScriptVariables={...current.tavernHelperScriptVariables,[scriptId]:merged};return current},{source:'script-variable.local'})
  if(!isDeepStrictEqual(rules,current.rules))await store.updateJson(file,latest=>{if(Number(latest?.revision||0)!==current.revision)throw Error('共享脚本配置已变化，请重试');return {...latest,revision:current.revision+1,rules}})
  return {handled:true,chat:saved,variables:await effective(saved)}
 })}
 async function migrateChat(chat){
  const current=await state();if(!Object.keys(current.rules).length||!chat.tavernHelperScriptVariables)return false
  const all=await scripts(chat);let changed=false
  for(const script of all){const owner=identity(chat,script),matches=Object.entries(current.rules).filter(([,row])=>row.owner===owner&&row.status==='active'&&(row.target==='shared'||row.formerShared&&chat.scriptVariableMigration?.[hash([owner,row.path])]!==row.operationId))
   for(const [id,row]of matches){if(row.target==='shared'&&!at(chat.tavernHelperScriptVariables?.[script.id],row.path).present)continue
    if(!changed){chat.tavernHelperScriptVariables=copy(chat.tavernHelperScriptVariables);chat.scriptVariableMigration=copy(chat.scriptVariableMigration||{})}
    chat.tavernHelperScriptVariables[script.id]??=copy(script.data||{});assign(chat.tavernHelperScriptVariables[script.id],row.path,row.target==='shared'?{present:false}:row.formerShared);chat.scriptVariableMigration[id]=row.operationId;changed=true
   }
  }return changed
 }
 async function stage(chat,scriptId,variables,expectedVariables){
  assertPluginJson(variables,'脚本变量');const result=copy(variables),current=await state(),script=(await scripts(chat)).find(row=>row.id===scriptId)
  if(!script)throw Error('脚本变量缺少当前资源')
  if(apiDefault(script))return serialize(async()=>saveApi(chat,script,variables,expectedVariables,await state(),true))
  for(const rule of Object.values(current.rules).filter(row=>row.owner===identity(chat,script)&&row.target==='shared'&&row.status==='active')){
   if(!isDeepStrictEqual(at(variables,rule.path),rule.value))throw Error('MVU 结算事务不能原子修改共享配置：'+rule.path.join('.'))
   assign(result,rule.path,{present:false})
  }
  return result
 }
 return {inspect,decide,effective,save,stage,recover,migrateChat}
}
