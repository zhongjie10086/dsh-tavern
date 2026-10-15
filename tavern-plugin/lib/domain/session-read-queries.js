import {applyNativeSessionUpgrade} from './native-session-upgrade.js'
import {freezeJson} from './readonly-json.js'

const activityPaths=['/sessionId','/updatedAt','/nativeSessionUpgrade','/candidateAgent','/timeline/schemaVersion','/timeline/branchId','/timeline/revision','/timeline/operations','/timeline/participants','/timeline/updatedAt','/candidates/messageId']
function inputOf(envelope){
 const input={id:envelope.chatId,_storageRevision:envelope.storageRevision}
 for(const row of envelope.fields){
  if(!row.found)continue
  const parts=row.path.slice(1).split('/').map(key=>key.replace(/~1/g,'/').replace(/~0/g,'~'))
  let target=input
  for(const key of parts.slice(0,-1)){if(!Object.hasOwn(target,key))Object.defineProperty(target,key,{value:{},enumerable:true,writable:true});target=target[key]}
  Object.defineProperty(target,parts.at(-1),{value:structuredClone(row.value),enumerable:true,writable:true,configurable:true})
 }
 return input
}

/** Narrow read consumers. Envelopes never enter Chat normalization or writes;
 * only coordinator metadata is privately assembled for its read-only query. */
export function createSessionReadQueries({links,records,readFull,coordinator,upgradeReceipt}={}){
 async function identity(sessionId){
  if(typeof sessionId!=='string'||!sessionId)return undefined
  const mapped=(await links())[sessionId]
  if(typeof mapped==='string')return mapped
  return (await readFull(sessionId))?.id
 }
 async function fields(sessionId,paths){
  let id=await identity(sessionId);if(!id)return undefined
  let result=await records.readFields(id,{paths:[...new Set(['/sessionId',...paths])]})
  if(!result){id=(await readFull(sessionId))?.id;if(!id)return undefined;result=await records.readFields(id,{paths:[...new Set(['/sessionId',...paths])]})}
  if(!result||result.fields.find(row=>row.path==='/sessionId')?.value!==sessionId)return undefined
  return result
 }
 async function activityInput(sessionId){
  const envelope=await fields(sessionId,activityPaths);if(!envelope)return undefined
  const input=inputOf(envelope)
  // inspect() migrates unfinished bodies using full snapshots. Never let a
  // metadata-only object fabricate those snapshots or legacy branch identity.
  if(input.timeline?.schemaVersion!==1||!input.timeline?.branchId||Object.values(input.timeline?.operations||{}).some(op=>op?.kind==='body'&&op.status==='foreground-completed'))return readFull(sessionId)
  return applyNativeSessionUpgrade(input,upgradeReceipt)
 }
 async function activity(sessionId){const input=await activityInput(sessionId);return input?{chatId:input.id,updatedAt:input.updatedAt||0,value:coordinator.activity(input)}:undefined}
 async function operation(sessionId,id){const input=await activityInput(sessionId);return input?{value:coordinator.operation(input,id),candidateMessageId:input.candidates?.messageId}:undefined}
 async function history(sessionId,options,method){
  let id=await identity(sessionId);if(!id)return undefined
  let envelope=await records[method](id,{...options,fields:['/sessionId']})
  if(!envelope){id=(await readFull(sessionId))?.id;if(!id)return undefined;envelope=await records[method](id,{...options,fields:['/sessionId']})}
  if(!envelope||envelope.fields.find(row=>row.path==='/sessionId')?.value!==sessionId)return undefined
  return envelope
 }
 async function window(sessionId,options={}){return history(sessionId,options,'readMessageWindow')}
 async function slice(sessionId,options={}){return history(sessionId,options,'readMessageSlice')}
 async function value(sessionId,path){const envelope=await fields(sessionId,[path,'/nativeSessionUpgrade']);if(!envelope)return undefined;const input=applyNativeSessionUpgrade(inputOf(envelope),upgradeReceipt);return freezeJson(input[path.slice(1)])}
 return Object.freeze({fields,activity,operation,window,slice,value})
}
