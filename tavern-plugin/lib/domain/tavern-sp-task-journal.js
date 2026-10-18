import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {finishJsonDraft} from './json-draft.js'

const field='tavernSpTasks',version=1,terminal=new Set(['done','cancelled']),retain=32,maxPending=128
const kinds=new Set(['contentOptimization'])
const states=new Set(['queued','started','result','awaiting-user','saving','done','failed','interrupted','cancelled'])
const transitions={queued:['started','cancelled'],started:['result','awaiting-user','saving','failed','interrupted'],result:['saving','awaiting-user','done','failed','interrupted'], 'awaiting-user':['result','saving','cancelled','failed','interrupted'],saving:['done','failed','interrupted'],failed:['saving','cancelled'],interrupted:['saving','cancelled'],done:[],cancelled:[]}
const copy=value=>structuredClone(finishJsonDraft(value))
const fail=message=>new Error('SP task journal: '+message)
const text=(value,label)=>{if(typeof value!=='string'||!value||value.length>512)throw fail('invalid '+label);return value}
function json(value,label,limit=16384){
 const visit=(item,ancestors=new Set())=>{
  if(item===null||['string','boolean'].includes(typeof item))return
  if(typeof item==='number'&&Number.isFinite(item))return
  if(!item||typeof item!=='object'||ancestors.has(item)||!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw fail('invalid '+label)
  if(Array.isArray(item)&&Object.keys(item).length!==item.length)throw fail('sparse '+label)
  const next=new Set(ancestors);next.add(item)
  for(const [key,child] of Object.entries(item)){if(['__proto__','constructor','prototype'].includes(key))throw fail('unsafe '+label);visit(child,next)}
 }
 visit(value);if(Buffer.byteLength(JSON.stringify(value))>limit)throw fail(label+' exceeds compact task limit');return copy(value)
}
function shape(value,required,optional=[],label='record'){
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw fail('invalid '+label)
}
function identityShape(value){
 shape(value,['chatId','branchId','lifecycleRevision','sourceDigest','packageDigest','scriptId'],[],'identity')
 text(value.chatId,'chat id');if(typeof value.branchId!=='string'||value.branchId.length>512||!Number.isSafeInteger(value.lifecycleRevision)||value.lifecycleRevision<0)throw fail('invalid identity')
 if(value.scriptId!=='extension-sp-database')throw fail('task is not owned by original SP')
 text(value.sourceDigest,'source digest');text(value.packageDigest,'package digest');json(value,'identity',4096)
}
function identity(chat,value){
 identityShape(value)
 if(value.chatId!==chat.id||value.branchId!==(chat.timeline?.branchId||'')||value.lifecycleRevision!==(Number(chat.tavernHelperLifecycleRevision)||0))throw fail('chat/branch/lifecycle changed')
 return copy(value)
}
function descriptor(value){
 text(value.id,'task id');if(!kinds.has(value.kind))throw fail('unsupported task kind')
 identityShape(value.identity)
 if(!Number.isFinite(value.dueAt)||value.dueAt<0)throw fail('invalid dueAt')
 json(value.target,'target',4096);json(value.input,'input')
}
function checkpoint(value){
 if(value===undefined)return undefined
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['resultRef','saveRef','interaction','recovery'].includes(key)))throw fail('checkpoint must contain references, not live tables')
 for(const key of ['resultRef','saveRef'])if(Object.hasOwn(value,key))text(value[key],key)
 if(value.recovery!==undefined&&value.recovery!=='saving')throw fail('only save recovery is supported')
 if(Object.hasOwn(value,'interaction')){const i=value.interaction;if(!i||typeof i!=='object'||Array.isArray(i)||Object.keys(i).some(key=>!['id','revision','actions'].includes(key))||!Number.isSafeInteger(i.revision)||i.revision<1||!Array.isArray(i.actions)||!i.actions.length||i.actions.length>16||new Set(i.actions).size!==i.actions.length)throw fail('invalid interaction');text(i.id,'interaction id');i.actions.forEach(action=>text(action,'interaction action'))}
 return json(value,'checkpoint',4096)
}
function ledger(chat){
 const value=chat[field]
 if(value===undefined)return {version,tasks:[]}
 if(!value||value.version!==version||!Array.isArray(value.tasks)||Object.keys(value).some(key=>!['version','tasks'].includes(key)))throw fail('unsupported persisted version')
 const ids=new Set()
 for(const row of value.tasks){
  shape(row,['id','kind','identity','target','input','dueAt','state','attempt','revision','createdAt','updatedAt','commands'],['checkpoint','error','lastTransition','recoveryCheckpoint'],'persisted task')
  descriptor(row)
  if(ids.has(row.id)||!states.has(row.state)||!Number.isSafeInteger(row.attempt)||row.attempt<0||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isFinite(row.createdAt)||row.createdAt<0||!Number.isFinite(row.updatedAt)||row.updatedAt<row.createdAt||!Array.isArray(row.commands)||row.commands.length>64)throw fail('invalid persisted task')
  const point=checkpoint(row.checkpoint)
  if(row.state==='result'&&!point?.resultRef||row.state==='awaiting-user'&&!point?.interaction||row.state==='saving'&&!point?.saveRef||row.state==='done'&&!point?.saveRef&&!point?.resultRef||!['queued','cancelled'].includes(row.state)&&row.attempt<1)throw fail('persisted state lacks durable checkpoint or attempt')
  if(Object.hasOwn(row,'error'))text(row.error,'error')
  const commandIds=new Set(),answered=new Set()
  for(const command of row.commands){
   shape(command,['interactionId','revision','commandId','action','payload'],[],'persisted command')
   for(const key of ['interactionId','commandId','action'])text(command[key],key)
   if(!Number.isSafeInteger(command.revision)||command.revision<1||commandIds.has(command.commandId)||answered.has(JSON.stringify([command.interactionId,command.revision])))throw fail('invalid persisted command')
   json(command.payload,'command payload',4096);commandIds.add(command.commandId);answered.add(JSON.stringify([command.interactionId,command.revision]))
  }
  if(Object.hasOwn(row,'lastTransition')){const t=row.lastTransition;shape(t,['attempt','expectedState','nextState'],['checkpoint','error'],'transition receipt');if(!Number.isSafeInteger(t.attempt)||t.attempt<1||t.attempt>row.attempt||!states.has(t.expectedState)||!transitions[t.expectedState].includes(t.nextState)||t.nextState!==row.state)throw fail('invalid persisted transition');checkpoint(t.checkpoint);if(t.error!==undefined)text(t.error,'error')}
  if(row.recoveryCheckpoint!==undefined){checkpoint(row.recoveryCheckpoint);if(!['failed','interrupted'].includes(row.state)||row.lastTransition?.expectedState!=='saving'||!row.recoveryCheckpoint.saveRef||row.recoveryCheckpoint.recovery!=='saving'||!isDeepStrictEqual(row.recoveryCheckpoint,point))throw fail('invalid persisted save recovery')}
  ids.add(row.id)
 }
 if(value.tasks.filter(row=>!terminal.has(row.state)).length>maxPending||value.tasks.filter(row=>terminal.has(row.state)).length>retain)throw fail('persisted task capacity exceeded')
 return value
}
function prune(value){const ended=value.tasks.filter(row=>terminal.has(row.state)).slice(-retain),keep=new Set(ended);value.tasks=value.tasks.filter(row=>!terminal.has(row.state)||keep.has(row));return value}

/** Dormant host service. Caller MUST authenticate fixed SP/source and run every mutation
 * inside dispatch.runOwned. Owner tokens are process-local capabilities, never imported.
 * Idempotency exists only while a task is retained (32 terminal tasks per chat).
 * Callers must never reuse pruned task IDs; this is not a permanent deduplication store.
 * A destroyed started realm has unknown effects: this API deliberately cannot replay it.
 */
export function createTavernSpTaskJournal({chats,now=Date.now}){
 const owners=new Map(),operations=new Map()
 // Publication of an ephemeral owner and its durable attempt share this queue.
 // Serialize the canonical chat because retention also prunes its sibling tasks.
 async function serialize(sessionId,work){
  const chat=await resolve(sessionId),id=chat.id,previous=operations.get(id)||Promise.resolve()
  const current=previous.catch(()=>{}).then(work);operations.set(id,current)
  try{return await current}finally{if(operations.get(id)===current)operations.delete(id)}
 }
 const key=(chatId,id)=>JSON.stringify([chatId,id])
 async function resolve(sessionId){const chat=await chats.forSession(sessionId);if(!chat||chat.sessionId!==sessionId)throw fail('session binding changed');ledger(chat);return chat}
 async function update(sessionId,work){
  const initial=await resolve(sessionId);let answer
  const saved=await chats.update(initial.id,current=>{
   if(!current||current.id!==initial.id||current.sessionId!==sessionId)throw fail('session binding changed')
   const value=ledger(current);answer=work(current,value);current[field]=prune(value);ledger(current);return current
  },{source:'sp.task-journal'})
  if(!saved)throw fail('task update did not persist')
  const retained=new Set(ledger(saved).tasks.map(row=>key(saved.id,row.id)))
  for(const id of owners.keys())if(JSON.parse(id)[0]===saved.id&&!retained.has(id))owners.delete(id)
  return copy(answer)
 }
 const find=(chat,value,id)=>{const row=value.tasks.find(item=>item.id===id);if(!row)throw fail('task does not exist');identity(chat,row.identity);return row}
 function active(chat,row,proof){
  const lease=owners.get(key(chat.id,row.id))
  if(!proof||!lease||proof.number!==row.attempt||proof.number!==lease.number||proof.token!==lease.token)throw fail('stale or unattached owner acknowledgement')
 }
 async function enqueue(sessionId,request){
  text(request?.id,'task id');text(request.kind,'task kind')
  if(!Number.isFinite(request.dueAt)||request.dueAt<0)throw fail('invalid dueAt')
  const admission={id:request.id,kind:request.kind,identity:json(request.identity,'identity',4096),target:json(request.target??null,'target',4096),input:json(request.input??null,'input'),dueAt:request.dueAt};descriptor(admission)
  return update(sessionId,(chat,value)=>{
   identity(chat,admission.identity)
   const old=value.tasks.find(row=>row.id===admission.id)
   if(old){if(!isDeepStrictEqual(Object.fromEntries(Object.keys(admission).map(key=>[key,old[key]])),admission))throw fail('task id reused with different content');return old}
   if(value.tasks.filter(row=>!terminal.has(row.state)).length>=maxPending)throw fail('unfinished task capacity reached')
   const at=now(),row={...copy(admission),state:'queued',attempt:0,revision:1,createdAt:at,updatedAt:at,commands:[]};value.tasks.push(row);return row
  })
 }
 async function claim(sessionId,id,{attempt,ownerToken}={}){
  text(ownerToken,'runtime owner token');if(!Number.isSafeInteger(attempt)||attempt<1)throw fail('invalid attempt')
  let lease,newLease=false,chatId
  const task=await update(sessionId,(chat,value)=>{
   const row=find(chat,value,id);chatId=chat.id;const old=owners.get(key(chat.id,id))
   if(attempt===row.attempt&&old?.number===attempt&&old.ownerToken===ownerToken){lease=old;return row}
   if(attempt!==row.attempt+1)throw fail('attempt changed')
   if(!['queued','result','awaiting-user','saving'].includes(row.state)&&!(['failed','interrupted'].includes(row.state)&&row.recoveryCheckpoint?.recovery==='saving'&&row.recoveryCheckpoint?.saveRef))throw fail('execution outcome is unknown or task is terminal; no automatic replay')
   lease={number:attempt,token:randomUUID(),ownerToken};newLease=true;row.attempt=attempt;row.revision++;row.updatedAt=now();return row
  })
  if(newLease)owners.set(key(chatId,id),lease)
  return {task,attempt:{number:lease.number,token:lease.token}}
 }
 async function transition(sessionId,id,request){
  const {attempt,expectedState,nextState}=request||{}
  if(!states.has(expectedState)||!states.has(nextState))throw fail('invalid state')
  const point=checkpoint(request.checkpoint),error=request.error===undefined?undefined:text(request.error,'error')
  const receipt={attempt:attempt?.number,expectedState,nextState,...point===undefined?{}:{checkpoint:point},...error===undefined?{}:{error}}
  return update(sessionId,(chat,value)=>{
   const row=find(chat,value,id);active(chat,row,attempt)
   if(row.state===nextState&&isDeepStrictEqual(row.lastTransition,receipt))return row
   if(row.state!==expectedState||!transitions[expectedState].includes(nextState))throw fail('state changed or transition forbidden')
   let nextPoint=point??row.checkpoint
   if(['failed','interrupted'].includes(expectedState)&&nextState==='saving'){
    if(!row.recoveryCheckpoint||point!==undefined&&!isDeepStrictEqual(point,row.recoveryCheckpoint))throw fail('only the pre-failure durable save checkpoint can recover')
    nextPoint=row.recoveryCheckpoint
   }
   if(['failed','interrupted'].includes(nextState)&&point!==undefined&&!isDeepStrictEqual(point,row.checkpoint))throw fail('failure cannot replace the prior checkpoint')
   if(nextState==='result'&&!nextPoint?.resultRef||nextState==='awaiting-user'&&!nextPoint?.interaction||nextState==='saving'&&!nextPoint?.saveRef)throw fail('durable result/interaction/save reference required')
   if(['failed','interrupted'].includes(expectedState)&&nextState==='saving'&&(!nextPoint?.saveRef||nextPoint.recovery!=='saving'))throw fail('only an explicit durable save checkpoint can recover')
   if(['failed','interrupted'].includes(nextState)&&expectedState==='saving'&&row.checkpoint?.saveRef&&row.checkpoint.recovery==='saving')row.recoveryCheckpoint=copy(row.checkpoint);else delete row.recoveryCheckpoint
   row.state=nextState;if(nextPoint!==undefined)row.checkpoint=nextPoint;if(error!==undefined)row.error=error;else delete row.error
   row.lastTransition=receipt;row.revision++;row.updatedAt=now();return row
  })
 }
 async function inspect(sessionId){const chat=await resolve(sessionId);return copy({version,tasks:ledger(chat).tasks})}
 async function command(sessionId,id,request){
  text(request?.interactionId,'interaction id');text(request.commandId,'command id');text(request.action,'command action')
  if(!Number.isSafeInteger(request.revision)||request.revision<1)throw fail('invalid interaction revision')
  const submitted={interactionId:request.interactionId,revision:request.revision,commandId:request.commandId,action:request.action,payload:json(request.payload??null,'command payload',4096)}
  return update(sessionId,(chat,value)=>{
   const row=find(chat,value,id),old=row.commands.find(item=>item.commandId===submitted.commandId)
   if(old){if(!isDeepStrictEqual(old,submitted))throw fail('command id reused with different content');return {task:row,command:old}}
   const interaction=row.checkpoint?.interaction
   if(row.state!=='awaiting-user'||!interaction||interaction.id!==submitted.interactionId||interaction.revision!==submitted.revision||!interaction.actions.includes(submitted.action))throw fail('interaction changed')
   if(row.commands.some(item=>item.interactionId===submitted.interactionId&&item.revision===submitted.revision))throw fail('interaction already answered')
   if(row.commands.length>=64)throw fail('task command capacity reached')
   row.commands.push(submitted);row.revision++;row.updatedAt=now();return {task:row,command:submitted}
  })
 }
 return Object.freeze({enqueue:(sessionId,request)=>serialize(sessionId,()=>enqueue(sessionId,request)),claim:(sessionId,id,request)=>serialize(sessionId,()=>claim(sessionId,id,request)),transition:(sessionId,id,request)=>serialize(sessionId,()=>transition(sessionId,id,request)),inspect,command:(sessionId,id,request)=>serialize(sessionId,()=>command(sessionId,id,request))})
}
