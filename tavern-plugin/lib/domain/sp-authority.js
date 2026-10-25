import {originalSpTableFields,originalSp129MaterialFields,originalSp129CarrierFields,originalSp129RecoveryFields} from './sp-original-fields.js'
import {createHash,randomUUID} from 'node:crypto'
import {publicSpTables,validateTableData} from './sp-database.js'
import {finishJsonDraft} from './json-draft.js'

const clone=value=>structuredClone(value)
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
export const spAuthorityStamp=value=>createHash('sha256').update(JSON.stringify(stable(publicSpTables(value)))).digest('hex')
const empty=value=>value&&typeof value==='object'&&!Array.isArray(value)&&!Object.keys(value).some(key=>key.startsWith('sheet_'))
const validated=value=>empty(value)?clone(value):validateTableData(value)
// SP 9.2.5 MESSAGE_TABLE_FIELDS_ACU / FIRST_MESSAGE_SCOPE_GUIDE_FIELDS_ACU.
// These are original-package persistence, not a projection of the DSH cache.
const tableFields=originalSpTableFields
const scopeFields=['TavernDB_ACU_ScopedConfig','TavernDB_ACU_InternalSheetGuide','TavernDB_ACU_TableHeaderGuide']
const metadataFields=scopeFields.flatMap(key=>[key,key+'__chatId'])
const select=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value||{},key)).map(key=>[key,clone(value[key])]))
export function originalSpRollbackNeedsMaterialization(chat){
 const carriers=(chat.messages||[]).filter(row=>row.role==='assistant'&&tableFields.slice(0,4).some(key=>Object.hasOwn(row.tavernPluginData||{},key))),message=carriers.at(-1)
 if(!message)return false
 // Only a single self-contained carrier proves that no earlier floor is
 // needed (including hidden-sheet recovery or another isolation domain).
 // Delegate all chains and legacy/unknown shapes to the original codec.
 if(carriers.length!==1||tableFields.slice(1,4).some(key=>Object.hasOwn(message.tavernPluginData,key)))return true
 let slots=message.tavernPluginData.TavernDB_ACU_IsolatedData
 if(typeof slots==='string'){try{slots=JSON.parse(slots)}catch{return true}}
 if(!slots||typeof slots!=='object'||Array.isArray(slots)||!Object.keys(slots).length)return true
 return Object.values(slots).some(slot=>slot?.storageFrame?.version!==2||slot.storageFrame.checkpoint?.kind!=='full'||!slot.storageFrame.checkpoint.data||typeof slot.storageFrame.checkpoint.data!=='object'||Array.isArray(slot.storageFrame.checkpoint.data)||!Array.isArray(slot.storageFrame.logEntries))
}
export function captureOriginalSpPersistence(chat){
 return {messages:(chat.messages||[]).map(message=>({id:message.id,role:message.role,turn:message.turn,greeting:message.greeting,fields:select(message.tavernPluginData,[...originalSp129RecoveryFields,...scopeFields])})),metadata:select(chat.tavernPluginMetadata,metadataFields),extension:clone(chat.tavernPluginMetadata?.dsh_original_extensions?.['sp-database'])}
}
// Same canonical form as the original's rollback-deletion receipt (key order free).
export const originalSpFieldsDigest=value=>JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item)
export const originalSpFloorFields=originalSp129RecoveryFields
export function originalSpFloorCarries(message){return [...tableFields.slice(0,4),...originalSp129MaterialFields,...originalSp129CarrierFields].some(key=>Object.hasOwn(message?.tavernPluginData||{},key))}
export function restoreOriginalSpPersistence(chat,saved,{deletion}={}){
 const receiptFields=deletion?.receipt?.fieldNames
 if(receiptFields!==undefined&&JSON.stringify(receiptFields)!==JSON.stringify(originalSp129RecoveryFields))throw Error('SP 原包删楼字段契约无效，未回退')
 const deletionFields=receiptFields===undefined?tableFields:originalSp129RecoveryFields
 const matched=new Set()
 for(const [index,message]of (chat.messages||[]).entries()){
  const previous=saved.messages.find(row=>row.id&&message.id===row.id)||saved.messages[index]
  if(!previous||previous.role!==message.role||previous.turn!==message.turn||Boolean(previous.greeting)!==Boolean(message.greeting))continue
  matched.add(previous)
  const fields={...(message.tavernPluginData||{})}
  for(const key of [...originalSp129RecoveryFields,...scopeFields])delete fields[key]
  Object.assign(fields,clone(previous.fields));if(Object.keys(fields).length)message.tavernPluginData=fields;else delete message.tavernPluginData
 }
 if(deletion){
  // 1.7: the removed floors' payloads leave with them. What the original's own
  // delete guard grafted onto survivors arrives in its receipt, computed from the
  // same fields this rollback started from; anything else changed meanwhile.
  for(const row of deletion.receipt?.changed||[]){
   const message=chat.messages?.[row.index]
   if(!message||Boolean(row.user)!==(message.role==='user'))throw new Error('SP 原包删楼回执的楼层与回退后的剧情不一致，未回退')
   if(originalSpFieldsDigest(select(message.tavernPluginData,deletionFields))!==row.before)throw new Error('SP 原包数据在回退准备期间已变化，未回退；请重试')
   const fields={...(message.tavernPluginData||{})};for(const key of deletionFields)delete fields[key]
   Object.assign(fields,select(row.fields,deletionFields));if(Object.keys(fields).length)message.tavernPluginData=fields;else delete message.tavernPluginData
  }
 }else{
 // SP scans assistant floors for its latest checkpoint/log. When rollback
 // removes that carrier, keep the exact original payload on the last surviving
 // assistant; do not reconstruct it from native tables or merge storage frames.
 const latest=[...saved.messages].reverse().find(row=>row.role==='assistant'&&tableFields.slice(0,4).some(key=>Object.hasOwn(row.fields,key)))
 const target=(chat.messages||[]).findLast(message=>message.role==='assistant')
 if(latest&&!matched.has(latest)&&target){target.tavernPluginData??={};for(const key of tableFields)delete target.tavernPluginData[key];Object.assign(target.tavernPluginData,select(latest.fields,tableFields))}
 }
 if(chat.tavernPluginMetadata||Object.keys(saved.metadata).length||saved.extension!==undefined){
  chat.tavernPluginMetadata??={};for(const key of metadataFields)delete chat.tavernPluginMetadata[key];Object.assign(chat.tavernPluginMetadata,clone(saved.metadata))
  if(saved.extension!==undefined){chat.tavernPluginMetadata.dsh_original_extensions??={};chat.tavernPluginMetadata.dsh_original_extensions['sp-database']=clone(saved.extension)}else if(chat.tavernPluginMetadata.dsh_original_extensions)delete chat.tavernPluginMetadata.dsh_original_extensions['sp-database']
 }
}
// SP defaults notification metadata to persisted=true, including teardown
// notifications. Accept an empty cache only when the real saved original
// checkpoint proves it. Unknown delta/log formats remain read-only.
function originalEmptyCheckpoint(chat,request){
 for(const message of [...(chat.messages||[])].reverse()){
  // A newer legacy/unknown carrier invalidates proof from an older empty
  // root. Only the original codec may decide what that intervening data means.
  if(!tableFields.slice(0,4).some(key=>Object.hasOwn(message.tavernPluginData||{},key)))continue;
  let slots=message.tavernPluginData?.TavernDB_ACU_IsolatedData;
  if(typeof slots==='string'){try{slots=JSON.parse(slots)}catch{return false}}
  if(!slots||typeof slots!=='object'||Array.isArray(slots))return false;
  const keys=Object.keys(slots),code=request.isolationCode;
  // A receipt/cache may describe an earlier original instance or scope. Only
  // this authenticated lifecycle's current publication selects a multi-slot root.
  const tag=typeof code==='string'?slots[code]:(keys.length===1?slots[keys[0]]:null);
  if(!tag)return false;
  const frame=tag.storageFrame;
  if(frame!==undefined)return frame?.version===2&&frame.checkpoint?.kind==='full'&&empty(frame.checkpoint.data)&&Array.isArray(frame.logEntries)&&frame.logEntries.length===0;
  return ['checkpoint','legacy'].includes(tag._acu_storage_mode)&&empty(tag.independentData);
 }
 return false;
}
function ddlTokens(ddl,key){
 if(typeof ddl!=='string')return null
 const tokens=[],pattern=/\s+|--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?|<=|>=|!=|<>|==|\|\||[\s\S]/g
 for(const part of ddl.match(pattern)||[])if(!/^(?:\s|--|\/\*)/.test(part))tokens.push(part)
 let name=2;if(tokens[0]?.toUpperCase()!=='CREATE'||tokens[1]?.toUpperCase()!=='TABLE')return null
 if(tokens[2]?.toUpperCase()==='IF'&&tokens[3]?.toUpperCase()==='NOT'&&tokens[4]?.toUpperCase()==='EXISTS')name=5
 if(tokens[name+1]!=='('||!/^sheet_[A-Za-z_0-9]+$/.test(key))return null
 const identifier=tokens[name];tokens[name]=key;return {identifier,tokens}
}
// B3's exact import-boundary rules, applied only to the selected migration
// receipt. Ordinary cache comparison retains every DDL and narrative value.
export function spAuthorityImportEquivalent(expected,actual){
 const candidate=clone(publicSpTables(actual))
 for(const [key,sheet]of Object.entries(publicSpTables(expected))){
  const target=candidate[key];if(!key.startsWith('sheet_')||!sheet||!target)continue
  if(sheet.sourceData?.ddl!==target.sourceData?.ddl){
   const before=ddlTokens(sheet.sourceData?.ddl,key),after=ddlTokens(target.sourceData?.ddl,key)
   if(before&&after&&[before.identifier,key].includes(after.identifier)&&JSON.stringify(before.tokens)===JSON.stringify(after.tokens))target.sourceData.ddl=sheet.sourceData.ddl
  }
  const column=sheet.content?.[0]?.indexOf('row_id')
  if(column>=0)for(let i=1;i<(sheet.content?.length||0);i++){
   const id=sheet.content[i]?.[column];if(Number.isSafeInteger(id)&&target.content?.[i]?.[column]===String(id))target.content[i][column]=id
  }
 }
 return spAuthorityStamp(expected)===spAuthorityStamp(candidate)
}
function check(chat,request,{initial=false}={}){
 if(request.provider!=='extension-sp-database')throw new Error('SP 原包来源无效。')
 const state=chat.spAuthority
 if(request.expectedRevision!==(state?.revision||0))throw new Error('SP 权威版本已经变化，请刷新。')
 if(!Number.isSafeInteger(request.lifecycle)||request.lifecycle<0)throw new Error('SP 生命周期无效。')
 if(!initial&&request.lifecycle!==state?.lifecycle)throw new Error('SP 生命周期已过期。')
 return state
}
function cache(chat,data){
 const current=finishJsonDraft(chat.spDatabase)||{version:1,revision:0,locks:{},settings:{},snapshots:[]}
 const next=clone(data)
 // The original API omits the native allocator. Preserve it only for unchanged
 // sheets, never copy a counter onto a changed original schema or row set.
 for(const [key,sheet]of Object.entries(next))if(key.startsWith('sheet_')&&sheet&&current.data?.[key]&&spAuthorityStamp({[key]:sheet})===spAuthorityStamp({[key]:current.data?.[key]}))next[key]=current.data[key]
 if(spAuthorityStamp(current.data||{})!==spAuthorityStamp(next))chat.spDatabase={...current,data:next,revision:(current.revision||0)+1}
 else if(!chat.spDatabase)chat.spDatabase={...current,data:next}
}
/** Call only inside the chat transaction after verifying the provider instance.
 * spAuthority is persisted; readiness is deliberately supplied by the runtime.
 * Migration copies are inline once, self-contained across export/move/restart.
 */
export function beginSpAuthority(chat,request){
 const old=check(chat,request,{initial:true}),data=validated(request.data)
 if(old?.owner==='original'){
  const unchanged=old.lifecycle===request.lifecycle;
  if(!unchanged){old.lifecycle=request.lifecycle;old.revision++;}
  return {...clone(old),unchanged}
 }
 const host=chat.spDatabase?.data?clone(chat.spDatabase.data):null
 const same=!host||spAuthorityImportEquivalent(host,data)
 chat.spAuthority={version:1,owner:'original',revision:1,lifecycle:request.lifecycle,phase:same?'ready':'choice',cacheStamp:spAuthorityStamp(host||{}),migration:{host:{data:host},original:{data:clone(data)},choice:same?'original':null}}
 if(same){cache(chat,data);chat.spAuthority.cacheStamp=spAuthorityStamp(data)}
 return clone(chat.spAuthority)
}
export function chooseSpAuthority(chat,{side,expectedRevision}){
 const state=chat.spAuthority
 if(!state||state.owner!=='original')throw new Error('SP 原包尚未接管。')
 if(expectedRevision!==state.revision)throw new Error('SP 权威版本已经变化，请刷新。')
 if(state.phase==='claiming'){
  if(side!==state.migration.choice)throw new Error('SP 已选择来源，等待原包恢复回执。')
  return {claimId:state.claim.id,importToOriginal:clone(state.migration[side].data),revision:state.revision}
 }
 if(state.phase!=='choice')return {alreadyChosen:true,phase:state.phase}
 if(!['host','original'].includes(side))throw new Error('请选择保留的 SP 数据来源。')
 const data=state.migration[side].data
 if(data===null)throw new Error('没有可恢复的宿主数据。')
 state.migration.choice=side;state.claim={id:randomUUID(),stamp:spAuthorityStamp(data)};state.phase='claiming';state.revision++
 return {claimId:state.claim.id,importToOriginal:clone(data),revision:state.revision}
}
export function publishSpAuthorityCache(chat,request){
 const state=check(chat,request),data=validated(request.data)
 if(!state||state.owner!=='original')throw new Error('SP 原包尚未接管。')
 if(state.phase==='choice')throw new Error('请先选择保留的 SP 数据。')
 if(state.phase==='claiming'){
  if(request.claimId!==state.claim.id||!spAuthorityImportEquivalent(state.migration[state.migration.choice].data,data))throw new Error('SP 接管回执与所选数据不一致。')
 }else if(empty(data)&&!empty(chat.spDatabase?.data||{})&&!(request.confirmed===true&&originalEmptyCheckpoint(chat,request)))throw new Error('原包空表尚未确认，保留最后缓存。')
 // A cache that never recorded a scope (every game claimed before Z31, and
 // every first publication after a claim) has not *changed* scope: the scope is
 // recorded, but the cache revision only advances for different tables or for a
 // scope that differs from a recorded one.
 const rawSp=finishJsonDraft(chat.spDatabase),stamp=spAuthorityStamp(data),recordedScope=rawSp?.isolationCode
 const scopeUnrecorded=typeof request.isolationCode==='string'&&recordedScope!==request.isolationCode,scopeChanged=scopeUnrecorded&&recordedScope!==undefined
 if(!scopeUnrecorded&&state.phase==='ready'&&state.cacheStamp===stamp&&spAuthorityStamp(rawSp?.data||{})===stamp)return {revision:state.revision,cacheRevision:chat.spDatabase.revision,stamp,unchanged:true};
 const cacheRevision=chat.spDatabase?.revision||0;cache(chat,data);if(scopeUnrecorded){chat.spDatabase.isolationCode=request.isolationCode;if(scopeChanged&&chat.spDatabase.revision===cacheRevision)chat.spDatabase.revision++;}state.phase='ready';state.cacheStamp=stamp;state.revision++
 if(state.claim){state.migration.receipt=clone(state.claim);delete state.claim}
 return {revision:state.revision,cacheRevision:chat.spDatabase.revision,stamp:state.cacheStamp}
}
export function assertSpNativeWritable(chat,{installed=false}={}){
 if(installed||chat.spAuthority?.owner==='original')throw new Error('此局 SP 由原包唯一写入；原包未就绪时仅可查看缓存。')
}
export function spAuthorityView(chat,{installed=false,ready=false}={}){
 const original=installed||chat.spAuthority?.owner==='original',phase=chat.spAuthority?.phase
 return {owner:original?'original':'native',writable:original?ready&&phase==='ready':true,cacheOnly:original&&!ready,phase:phase||'unclaimed',revision:chat.spAuthority?.revision||0,notice:original&&!ready?'SP 原包未就绪，当前显示最后缓存；恢复原包后可编辑。':phase==='choice'?'SP 旧数据存在差异，两份已保留，请选择一次。':''}
}

/** Host adapter: assertProvider verifies a live authenticated provider record.
 * checkInstalled must use the installed descriptor, including failed loads.
 */
export function createSpAuthorityService({chats,assertProvider,checkInstalled,publish=()=>{}}){
 if(typeof assertProvider!=='function'||typeof checkInstalled!=='function')throw new Error('SP 权威服务缺少来源验证。')
 async function transaction(sessionId,request,method){
  const initial=await chats.forSession(sessionId);let result
  await chats.update(initial.id,async chat=>{
   if(!await checkInstalled(sessionId))throw new Error('此局没有安装原版 SP。')
   const lifecycle=Number(chat.tavernHelperLifecycleRevision)||0
   if(Number(request.lifecycle)!==lifecycle)throw new Error('SP 生命周期已过期。')
   await assertProvider(sessionId,request,chat)
   result=method(chat,request);return result.unchanged?undefined:chat
  },{source:'sp-authority.cache'})
  if(!result.unchanged)await publish(sessionId,{kind:'tavern-state',version:'sp-authority:'+result.revision});return result
 }
 return {
  begin:(sessionId,request)=>transaction(sessionId,request,beginSpAuthority),
  choose:(sessionId,request)=>transaction(sessionId,request,chooseSpAuthority),
  publishCache:(sessionId,request)=>transaction(sessionId,request,publishSpAuthorityCache),
  read:async(sessionId,options={})=>spAuthorityView(await chats.forSession(sessionId),{...options,installed:await checkInstalled(sessionId)}),
  assertNativeWritable:async sessionId=>assertSpNativeWritable(await chats.forSession(sessionId),{installed:await checkInstalled(sessionId)})
 }
}
