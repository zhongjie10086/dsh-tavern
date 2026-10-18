import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {createTavernSpTaskJournal} from './tavern-sp-task-journal.js'

const fail=message=>new Error('SP owned task service: '+message)
const clone=structuredClone
const hash=value=>createHash('sha256').update(value).digest('hex')
const ended=new Set(['done','cancelled'])
const identityKeys=['chatId','branchId','lifecycleRevision','sourceDigest','packageDigest','scriptId']
function canonical(value){
 if(!value||typeof value!=='object'||identityKeys.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!identityKeys.includes(key))||value.scriptId!=='extension-sp-database'||!Number.isSafeInteger(value.lifecycleRevision)||value.lifecycleRevision<0)throw fail('canonical identity required')
 for(const key of identityKeys.filter(key=>key!=='lifecycleRevision'))if(typeof value[key]!=='string'||key!=='branchId'&&!value[key])throw fail('invalid canonical identity')
 return Object.fromEntries(identityKeys.map(key=>[key,value[key]]))
}
function json(value){
 const visit=(item,parents=new Set())=>{if(item===null||['string','boolean'].includes(typeof item)||typeof item==='number'&&Number.isFinite(item))return;if(!item||typeof item!=='object'||parents.has(item)||!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw fail('non-JSON task data');const next=new Set(parents);next.add(item);for(const [key,child] of Object.entries(item)){if(['__proto__','constructor','prototype'].includes(key))throw fail('unsafe task data');visit(child,next)}}
 visit(value);return clone(value)
}
const requiredText=(value,label)=>{if(typeof value!=='string'||!value||value.length>512)throw fail('invalid '+label);return value}

/** Not wired or enabled by construction. The caller authenticates the transport;
 * runtimeId must come from its trusted SP-only lease, never a browser argument.
 * scope(sessionId) -> authoritative canonical identity (including fixed source/package).
 * assertOwner(sessionId,runtimeId,identity) -> throws/false unless that BACKGROUND realm
 * exclusively owns the independent SP lease; the seven frontend scripts use another lease.
 * store is the existing profileData readJson/updateJson adapter. Large results go in
 * separate durable records; the Chat journal holds references, never truncated text.
 * execute(sessionId,{runtimeId,task}) invokes __dshExecuteOwnedTask in that owner realm.
 * validateTarget(sessionId,target,identity) checks the canonical current message anchor.
 * This service does not start realms, transfer a lease, mirror DOM, or replay started work.
 */
export function createTavernSpOwnedTaskService({chats,store,scope,assertOwner,assertSaveRecovery,execute,prepare,validateTarget,journal=createTavernSpTaskJournal({chats}),now=Date.now}){
 for(const [name,value] of Object.entries({scope,assertOwner,execute,validateTarget}))if(typeof value!=='function')throw fail('missing dependency '+name)
 if(!store?.readJson||!store?.updateJson)throw fail('durable profile store required')
 const bindings=new Map(),tails=new Map(),inFlight=new Map(),queuedDispatches=new Map(),pumps=new Set(),pendingWakes=new Set(),queueFailures=new Map()
 const serial=(sessionId,work)=>{const previous=tails.get(sessionId)||Promise.resolve(),current=previous.catch(()=>{}).then(work);tails.set(sessionId,current);return current.finally(()=>{if(tails.get(sessionId)===current)tails.delete(sessionId)})}
 async function currentScope(sessionId){return canonical(await scope(sessionId))}
 async function guard(sessionId,runtimeId,recovery,admitRecovery=false){
  const binding=bindings.get(sessionId);if(!binding||binding.runtimeId!==runtimeId||!String(runtimeId).startsWith('background:'))throw fail('no bound background owner')
  const identity=await currentScope(sessionId);if(!isDeepStrictEqual(identity,binding.identity)||bindings.get(sessionId)!==binding)throw fail('background owner or scope changed')
  if(recovery){
   if(typeof assertSaveRecovery!=='function'||typeof recovery.token!=='string'||!recovery.token||typeof recovery.taskId!=='string'||await assertSaveRecovery(sessionId,runtimeId,recovery,identity)===false)throw fail('invalid save recovery capability')
   if(!admitRecovery){const permit=binding.saveRecovery,proof=binding.attempts.get(recovery.taskId);if(!permit||permit.token!==recovery.token||permit.taskId!==recovery.taskId||!isDeepStrictEqual(permit.attempt,proof))throw fail('save recovery task or attempt changed')}
  }else if(await assertOwner(sessionId,runtimeId,identity)===false)throw fail('background owner or scope changed')
  return binding
 }

 const base=(identity,id)=>'sp-owned-tasks/'+hash(JSON.stringify(identity))+'/'+hash(id)
 const manifestPath=(identity,id)=>base(identity,id)+'/task.json'
 async function row(sessionId,id){const value=await journal.inspect(sessionId),task=value.tasks.find(item=>item.id===id);if(!task)throw fail('unknown task');return task}
 async function artifact(binding,id){const value=await store.readJson(manifestPath(binding.identity,id));if(value?.version!==1||value.taskId!==id||!isDeepStrictEqual(value.identity,binding.identity))throw fail('missing or incompatible task artifact');return value}
 async function putImmutable(path,value){
  const next=json(value);await store.updateJson(path,old=>{if(old!==undefined&&old!==null){if(!isDeepStrictEqual(old,next))throw fail('durable record identity reused with different data');return undefined}return next});return path
 }
 async function bindOwner(sessionId,{runtimeId,identity}={}){
  return serial(sessionId,async()=>{
   if(!String(runtimeId).startsWith('background:'))throw fail('SP owner must be a background realm')
   const authoritative=await currentScope(sessionId);if(!isDeepStrictEqual(canonical(identity),authoritative)||await assertOwner(sessionId,runtimeId,authoritative)===false)throw fail('owner admission rejected')
   const old=bindings.get(sessionId)
   if(old){if(old.runtimeId===runtimeId&&isDeepStrictEqual(old.identity,authoritative))return {bound:true,identity:clone(authoritative)};throw fail('previous owner must explicitly release; no automatic transfer')}
   bindings.set(sessionId,{runtimeId,identity:authoritative,token:randomUUID(),attempts:new Map(),preparedSaves:new Map()});return {bound:true,identity:clone(authoritative)}
  })
 }
 async function release(sessionId,{runtimeId}={}){
  return serial(sessionId,async()=>{const binding=await guard(sessionId,runtimeId),tasks=(await journal.inspect(sessionId)).tasks.filter(task=>!ended.has(task.state));if(tasks.length||inFlight.has(sessionId))return {released:false,pending:tasks.map(task=>({id:task.id,state:task.state})),executing:inFlight.has(sessionId)};bindings.delete(sessionId);return {released:true}})
 }
 // Trusted host teardown hook ONLY, after the context has actually closed.
 // It is deliberately absent from the original-frame RPC surface. Journal rows
 // remain durable; a dead realm is not evidence that its started effects vanished.
 async function retireOwner(sessionId,{runtimeId}={}){
  return serial(sessionId,async()=>{
   if(inFlight.has(sessionId))throw fail('cannot retire an in-flight original task')
   const binding=bindings.get(sessionId)
   if(!binding)return {retired:true}
   if(binding.runtimeId!==runtimeId)return {retired:false,superseded:true}
   const pending=(await journal.inspect(sessionId)).tasks.filter(task=>!ended.has(task.state)).map(task=>({id:task.id,state:task.state}))
   bindings.delete(sessionId);return {retired:true,pending}
  })
 }
 async function register(sessionId,{runtimeId,requestId,...descriptor},{hostEvent}={}){
  return serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId);requiredText(requestId,'registration request id')
   if(descriptor.version!==1||descriptor.kind!=='contentOptimization'||!isDeepStrictEqual(canonical(descriptor.identity),binding.identity)||typeof descriptor.eventType!=='string')throw fail('invalid registered task')
   const taskId='sp:'+hash(JSON.stringify([binding.identity,requestId])),path=manifestPath(binding.identity,taskId)
   const prior=(await journal.inspect(sessionId)).tasks.find(task=>task.id===taskId)
   if(prior?.state==='cancelled'&&prior.error==='original task message apply refresh; optimization not reissued'){
    const stored=await artifact(binding,taskId);if(stored.requestId!==requestId||!isDeepStrictEqual(stored.descriptor,json(descriptor)))throw fail('durable record identity reused with different data');return {taskId,persisted:true,cancelled:true,reason:'original-apply-refresh'}
   }
   const unresolved=(await journal.inspect(sessionId)).tasks.filter(task=>task.id!==taskId&&!ended.has(task.state)&&task.attempt>0&&(!binding.attempts.has(task.id)||binding.attempts.get(task.id).number!==task.attempt||!inFlight.has(sessionId)||inFlight.get(sessionId).task.taskId!==task.id))
   if(unresolved.length)throw fail('previous original task outcome is unresolved; inspect and recover it before admitting a new request ('+unresolved.map(task=>task.id).join(',')+')')
   const previous=await store.readJson(path)
   let hostOrigin=previous?.hostEvent
   if(hostEvent){
    const nextOrigin={eventId:requiredText(hostEvent.id??hostEvent.eventId,'host event id'),name:requiredText(hostEvent.name,'host event name'),runtimeId}
    if(hostOrigin&&!isDeepStrictEqual(hostOrigin,nextOrigin))throw fail('task host event origin changed');hostOrigin=nextOrigin
   }
   const saved={version:1,taskId,identity:binding.identity,descriptor:json(descriptor),requestId,...(hostOrigin?{hostEvent:hostOrigin}:{})}
   await putImmutable(path,saved);await guard(sessionId,runtimeId)
   const task=await journal.enqueue(sessionId,{id:taskId,kind:descriptor.kind,identity:binding.identity,target:{artifactRef:path},input:{requestId,eventType:descriptor.eventType},dueAt:Number.isFinite(descriptor.dueAt)?descriptor.dueAt:0})
   if(descriptor.selfUpdateOf!==undefined){
    if(task.state==='cancelled'&&task.error==='original task message apply refresh; optimization not reissued')return {taskId:task.id,persisted:true,cancelled:true,reason:'original-apply-refresh'};
    const current=inFlight.get(sessionId);
    if(!current||current.task.taskId!==descriptor.selfUpdateOf||current.task.target?.index!==descriptor.selfUpdateIndex||current.task.generation!==descriptor.generation)throw fail('original apply refresh proof is no longer active');
    const proof=await journal.claim(sessionId,task.id,{attempt:task.attempt+1,ownerToken:binding.token});binding.attempts.set(task.id,proof.attempt);
    await journal.transition(sessionId,task.id,{attempt:proof.attempt,expectedState:'queued',nextState:'cancelled',error:'original task message apply refresh; optimization not reissued'});
    return {taskId:task.id,persisted:true,cancelled:true,reason:'original-apply-refresh'}
   }
   return {taskId:task.id,persisted:true}
  })
 }
 async function ownedAttempt(sessionId,binding,id){const proof=binding.attempts.get(id);if(!proof)throw fail('task has no attached execution attempt');return {task:await row(sessionId,id),proof}}
 async function cancel(sessionId,{runtimeId,taskId,reason}={}){
  return serial(sessionId,async()=>{const binding=await guard(sessionId,runtimeId),task=await row(sessionId,taskId);if(task.state==='cancelled'){forgetQueued(sessionId,taskId);return {cancelled:true}}if(task.state!=='queued')throw fail('executing task cannot be debounce-cancelled');const claim=await journal.claim(sessionId,taskId,{attempt:task.attempt+1,ownerToken:binding.token});binding.attempts.set(taskId,claim.attempt);await journal.transition(sessionId,taskId,{attempt:claim.attempt,expectedState:'queued',nextState:'cancelled',...reason?{error:requiredText(reason,'cancellation reason')}:{}});forgetQueued(sessionId,taskId);return {cancelled:true}})
 }
 // A busy 500ms callback receives admission, not completion. Its refresh event
 // can return while the actual execution waits for the unique original owner.
 const queueKey=(sessionId,id)=>JSON.stringify([sessionId,id])
 function forgetQueued(sessionId,id){const queue=queuedDispatches.get(sessionId);queue?.delete(id);if(!queue?.size)queuedDispatches.delete(sessionId);queueFailures.delete(queueKey(sessionId,id))}
 async function noteQueueFailure(sessionId,flight,error){
  const ref=base(flight.binding.identity,flight.task.taskId)+'/queue-state.json';
  const failure={name:String(error?.name||'Error'),message:String(error?.message||error)};
  queueFailures.set(queueKey(sessionId,flight.task.taskId),{errorRef:ref,durable:false,...failure});
  await store.updateJson(ref,()=>({version:1,identity:flight.binding.identity,taskId:flight.task.taskId,status:'blocked',error:failure}));
  queueFailures.set(queueKey(sessionId,flight.task.taskId),{errorRef:ref,durable:true,...failure});
 }
 function resumeQueued(sessionId){
  if(pumps.has(sessionId)){pendingWakes.add(sessionId);return}pumps.add(sessionId)
  void (async()=>{
   while(!inFlight.has(sessionId)){
    const queue=queuedDispatches.get(sessionId);if(!queue?.size)return
    const [id,request]=queue.entries().next().value;if(queueFailures.has(queueKey(sessionId,id)))return
    if((await journal.inspect(sessionId)).tasks.some(task=>!ended.has(task.state)&&task.attempt>0))return
    await dispatch(sessionId,request,true)
   }
  })().catch(error=>console.error('SP queued task blocked; inspect its durable journal/queue receipt:',String(error?.message||error))).finally(()=>{pumps.delete(sessionId);if(pendingWakes.delete(sessionId)&&queuedDispatches.get(sessionId)?.size&&!inFlight.has(sessionId))resumeQueued(sessionId)})
 }
 async function runFlight(sessionId,flight,wasQueued){
  const {runtimeId,taskId,target,requestId,...descriptor}=flight.request;let prepared
  try{
   if(wasQueued){
    prepared=await (prepare?prepare(sessionId,{runtimeId,task:flight.task}):execute(sessionId,{runtimeId,kind:'task-prepare',task:flight.task}));
    if(prepared?.cancelled===true){
     if(!['scope-changed','generation-changed','target-not-ai'].includes(prepared.code))throw fail('unrecognized queued cancellation proof');
     const result=await cancel(sessionId,{runtimeId,taskId,reason:requiredText(prepared.reason,'queued cancellation reason')});forgetQueued(sessionId,taskId);flight.resolve(result);return
    }
    if(!prepared||prepared.target?.index!==target.index||!isDeepStrictEqual(canonical(prepared.identity),canonical(descriptor.identity)))throw fail('queued preparation identity or target invalid')
    json(prepared.settings)
   }
   await serial(sessionId,async()=>{
    const binding=await guard(sessionId,runtimeId);if(inFlight.get(sessionId)!==flight)throw fail('task preparation reservation lost')
    const currentTask=await row(sessionId,taskId);if(currentTask.state==='cancelled'){forgetQueued(sessionId,taskId);flight.cancelled=true;return}
    const nextTarget=json(prepared?prepared.target:target)
    if(await validateTarget(sessionId,nextTarget,binding.identity)===false)throw fail('canonical target changed')
    const task=await row(sessionId,taskId);if(task.state!=='queued')throw fail('task already started; no replay')
    const targetRef=await putImmutable(base(binding.identity,taskId)+'/target.json',{version:1,identity:binding.identity,taskId,target:nextTarget})
    const claim=await journal.claim(sessionId,taskId,{attempt:task.attempt+1,ownerToken:binding.token});binding.attempts.set(taskId,claim.attempt)
    await journal.transition(sessionId,taskId,{attempt:claim.attempt,expectedState:'queued',nextState:'started'})
    flight.kind='executing';flight.task={...clone(descriptor),...(prepared?{settings:json(prepared.settings)}:{}),taskId,target:nextTarget,targetRef};forgetQueued(sessionId,taskId)
   })
   if(flight.cancelled){flight.resolve({cancelled:true});return}
   flight.resolve(await execute(sessionId,{runtimeId,task:flight.task}))
  }catch(error){
   if(wasQueued&&flight.kind==='preparing')try{await noteQueueFailure(sessionId,flight,error)}catch(storageError){error=new AggregateError([error,storageError],'queued preparation and durable error receipt failed')}
   flight.reject(error)
  }finally{if(inFlight.get(sessionId)===flight)inFlight.delete(sessionId);resumeQueued(sessionId)}
 }
 async function dispatch(sessionId,request,wasQueued=false){
  const {runtimeId,taskId,target,requestId,...descriptor}=request
  const admission=await serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId),task=await row(sessionId,taskId),saved=await artifact(binding,taskId)
   if(requestId!==undefined&&requestId!==saved.requestId||!isDeepStrictEqual(saved.descriptor,json(descriptor)))throw fail('descriptor changed; no replay')
   if(!Number.isSafeInteger(target?.index)||target.index<0)throw fail('invalid queued target index');json(target)
   const current=inFlight.get(sessionId)
   if(current?.task.taskId===taskId){if(!isDeepStrictEqual(current.request,json(request)))throw fail('in-flight task request changed');return {join:current}}
   if(task.state!=='queued')throw fail('task already started or descriptor changed; no replay')
   const queue=queuedDispatches.get(sessionId)
   if(current||queue?.size&&!wasQueued){
    const pending=queue||new Map();queuedDispatches.set(sessionId,pending);const prior=pending.get(taskId)
    if(prior&&(prior.target.index!==target.index||!isDeepStrictEqual(prior.settings,descriptor.settings)))throw fail('queued task request changed')
    if(prior&&!wasQueued&&queueFailures.has(queueKey(sessionId,taskId))){
     await store.updateJson(base(binding.identity,taskId)+'/queue-state.json',()=>({version:1,identity:binding.identity,taskId,status:'queued'}));queueFailures.delete(queueKey(sessionId,taskId))
    }
    pending.set(taskId,json(request));return {queued:true}
   }
   let resolve,reject;const done=new Promise((yes,no)=>{resolve=yes;reject=no});done.catch(()=>{})
   const flight={kind:wasQueued?'preparing':'admitting',binding,request:json(request),task:{...clone(descriptor),taskId,target:json(target)},done,resolve,reject};
   inFlight.set(sessionId,flight);return {flight}
  })
  if(admission.queued){resumeQueued(sessionId);return {queued:true,taskId}}
  if(admission.join)return admission.join.done
  void runFlight(sessionId,admission.flight,wasQueued);return admission.flight.done
 }
 async function checkpoint(sessionId,{runtimeId,taskId,phase,result,payload,interactionId,error,command:action,recovery}={}){
  if(recovery&&(recovery.taskId!==taskId||!['completed','failed'].includes(phase)))throw fail('save recovery permits only same-task completion or failure')
  return serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId,recovery),{task,proof}=await ownedAttempt(sessionId,binding,taskId),path=base(binding.identity,taskId)
   if(phase==='result'){
    const ref=await putImmutable(path+'/result.json',{version:1,identity:binding.identity,taskId,result:json(result)});await guard(sessionId,runtimeId,recovery)
    if(task.state!=='result')await journal.transition(sessionId,taskId,{attempt:proof,expectedState:task.state,nextState:'result',checkpoint:{resultRef:ref}});return {persisted:true,resultRef:ref}
   }
   if(phase==='saving'){
    const resultRef=path+'/result.json',output=await store.readJson(resultRef)
    if(output?.version!==1||output.taskId!==taskId||!Object.hasOwn(output,'result')||!isDeepStrictEqual(output.identity,binding.identity))throw fail('save requires durable final task result')
    const ref=await putImmutable(path+'/save.json',{version:1,identity:binding.identity,taskId,resultRef})
    await guard(sessionId,runtimeId,recovery);await journal.transition(sessionId,taskId,{attempt:proof,expectedState:'result',nextState:'saving',checkpoint:{resultRef,saveRef:ref,recovery:'saving'}});return {persisted:true,saveRef:ref}
   }
   if(phase==='completed'){
    if(task.state!=='saving'&&task.state!=='done')throw fail('completion requires acknowledged save phase')
    await journal.transition(sessionId,taskId,{attempt:proof,expectedState:'saving',nextState:'done'});return {persisted:true}
   }
   if(phase==='interaction-command'){
    const accepted=task.commands.find(item=>item.interactionId===interactionId&&item.action===action)
    if(accepted&&task.state==='result'&&task.lastTransition?.expectedState==='awaiting-user'&&task.checkpoint?.resultRef===path+'/interaction-'+hash(interactionId)+'.json')return {persisted:true,commandId:accepted.commandId}
    if(!accepted||task.checkpoint?.interaction?.id!==interactionId)throw fail('interaction command was not durably authorized by the user')
    await journal.transition(sessionId,taskId,{attempt:proof,expectedState:'awaiting-user',nextState:'result',checkpoint:{resultRef:task.checkpoint.resultRef}});return {persisted:true,commandId:accepted.commandId}
   }
   if(phase==='failed'){
    if(ended.has(task.state))throw fail('terminal task cannot fail')
    const ref=await putImmutable(path+'/failure-'+hash(String(error))+'.json',{version:1,identity:binding.identity,taskId,error:String(error)});await guard(sessionId,runtimeId,recovery);await journal.transition(sessionId,taskId,{attempt:proof,expectedState:task.state==='failed'?task.lastTransition.expectedState:task.state,nextState:'failed',error:'errorRef:'+ref});return {persisted:true,errorRef:ref}
   }
   if(phase==='awaiting-user'){
    requiredText(interactionId,'interaction id');const ref=await putImmutable(path+'/interaction-'+hash(interactionId)+'.json',{version:1,identity:binding.identity,taskId,interactionId,payload:json(payload)})
    await guard(sessionId,runtimeId,recovery);await journal.transition(sessionId,taskId,{attempt:proof,expectedState:task.state==='awaiting-user'?task.lastTransition.expectedState:task.state,nextState:'awaiting-user',checkpoint:{...task.checkpoint,resultRef:ref,interaction:{id:interactionId,revision:1,actions:['apply','skip','cancel','reoptimize']}}});return {persisted:true,interactionId,revision:1,payloadRef:ref}
   }
   throw fail('unsupported checkpoint phase')
  })
 }
 async function modelStep(sessionId,{runtimeId,taskId,step,phase,request,attemptId,result,error}={}){
  return serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId),{task}=await ownedAttempt(sessionId,binding,taskId)
   if(!['started','result'].includes(task.state))throw fail('model admission requires the executing task')
   if(!Number.isSafeInteger(step)||step<1)throw fail('invalid model step')
   const path=base(binding.identity,taskId)+'/model-'+step+'.json';let response
   await store.updateJson(path,old=>{
    if(old&&(typeof old.attemptId!=='string'||!old.attemptId||!Object.hasOwn(old,'request')||old.state==='result'&&!Object.hasOwn(old,'result')||old.version!==1||old.taskId!==taskId||old.step!==step||!isDeepStrictEqual(old.identity,binding.identity)||!['admitted','result','failed'].includes(old.state)))throw fail('incompatible model checkpoint')
    if(phase==='prepare'){
     const input=json(request)
     if(old){if(!isDeepStrictEqual(old.request,input))throw fail('model request changed');if(old.state!=='result')throw fail('model execution outcome unknown; do not reissue');response={state:'result',result:json(old.result)};return undefined}
     const next={version:1,identity:binding.identity,taskId,step,state:'admitted',attemptId:randomUUID(),request:input,createdAt:now()};response={state:'admitted',attemptId:next.attemptId};return next
    }
    if(!old||old.attemptId!==attemptId)throw fail('stale model attempt')
    if(phase==='result'){
     const output=json(result);if(old.state==='result'){if(!isDeepStrictEqual(old.result,output))throw fail('model result changed');response={persisted:true};return undefined}
     if(old.state!=='admitted')throw fail('model step cannot publish a result');response={persisted:true};return {...old,state:'result',result:output,completedAt:now()}
    }
    if(phase==='failed'){if(old.state==='failed'&&old.error===String(error)){response={persisted:true};return undefined}if(old.state!=='admitted')throw fail('model step is already terminal');response={persisted:true};return {...old,state:'failed',error:String(error),completedAt:now()}}
    throw fail('unsupported model phase')
   })
   await guard(sessionId,runtimeId);return response
  })
 }
 async function recoveryFailure(binding,task){
  if(resumableSave(binding,task)&&binding.preparedSaves.get(task.id).recoveryError)return binding.preparedSaves.get(task.id).recoveryError
  if(typeof task.error==='string'&&task.error.startsWith('errorRef:')){
   const value=await store.readJson(task.error.slice('errorRef:'.length));
   if(value?.version===1&&value.taskId===task.id&&isDeepStrictEqual(value.identity,binding.identity)&&typeof value.error==='string'&&value.error)return value.error
   throw fail('original recovery failure receipt missing')
  }
  return typeof task.error==='string'&&task.error?task.error:null
 }
 function resumableSave(binding,task){
  const receipt=binding?.preparedSaves.get(task.id),proof=binding?.attempts.get(task.id);
  return task.state==='saving'&&!!receipt&&!!proof&&task.attempt===receipt.attempt.number&&isDeepStrictEqual(proof,receipt.attempt)&&isDeepStrictEqual(task.checkpoint,receipt.checkpoint)
 }
 // Trusted host entry; execute must route kind save-retry into the SAME realm.
 // Never ensure/recreate a cold realm to satisfy this operation.
 async function retrySave(sessionId,{runtimeId,taskId,recovery}={}){
  if(recovery&&recovery.taskId!==taskId)throw fail('save recovery task changed')
  const reservation=await serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId,recovery,true),task=await row(sessionId,taskId);
   if(inFlight.has(sessionId)||!binding.attempts.has(taskId)||!(['failed','interrupted'].includes(task.state)&&task.recoveryCheckpoint||resumableSave(binding,task)))throw fail('original owner has no retained save-only recovery');
   if(recovery)binding.saveRecovery={token:recovery.token,taskId,attempt:clone(binding.attempts.get(taskId))};
   const recoveryError=await recoveryFailure(binding,task);if(recovery&&!recoveryError)throw fail('original recovery error missing');
   const reservation={kind:'save-retry',binding,task:{taskId},recoveryError};inFlight.set(sessionId,reservation);return reservation
  });
  try{const result=await execute(sessionId,{runtimeId,kind:'save-retry',taskId,...(recovery?{recovery}: {})});if(result?.saved!==true||(await row(sessionId,taskId)).state!=='done')throw fail('save retry was not durably completed');if(recovery){await guard(sessionId,runtimeId,recovery);if((await journal.inspect(sessionId)).tasks.some(task=>task.id!==taskId&&!ended.has(task.state)&&task.attempt>0))throw fail('task saved but other unfinished attempts prevent owner recovery');const manifest=await artifact(reservation.binding,taskId);return {...result,recoveryComplete:true,recoveryError:reservation.recoveryError,hostEvent:manifest.hostEvent||null}}return result}
  finally{if(inFlight.get(sessionId)===reservation)inFlight.delete(sessionId);if(recovery)delete reservation.binding.saveRecovery;else resumeQueued(sessionId)}
 }
 async function prepareSaveRetry(sessionId,{runtimeId,taskId,recovery}={}){
  if(recovery&&recovery.taskId!==taskId)throw fail('save recovery task changed')
  return serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId,recovery),task=await row(sessionId,taskId)
   if(!binding.attempts.has(taskId)||inFlight.has(sessionId)&&!(inFlight.get(sessionId).kind==='save-retry'&&inFlight.get(sessionId).task.taskId===taskId)||!(['failed','interrupted'].includes(task.state)&&task.recoveryCheckpoint||resumableSave(binding,task)))throw fail('no idle save-only recovery checkpoint')
   const savePoint=resumableSave(binding,task)?task.checkpoint:task.recoveryCheckpoint,recoveryError=await recoveryFailure(binding,task)
   const output=await store.readJson(savePoint.resultRef)
   if(output?.version!==1||output.taskId!==taskId||!Object.hasOwn(output,'result')||!isDeepStrictEqual(output.identity,binding.identity))throw fail('durable recovery result missing')
   await guard(sessionId,runtimeId,recovery)
   if(!resumableSave(binding,task)){
    const claim=await journal.claim(sessionId,taskId,{attempt:task.attempt+1,ownerToken:binding.token});binding.attempts.set(taskId,claim.attempt);if(recovery)binding.saveRecovery.attempt=clone(claim.attempt)
    await journal.transition(sessionId,taskId,{attempt:claim.attempt,expectedState:task.state,nextState:'saving'})
    // Publish only after durable transition. A lost transport ACK may repeat this
    // exact receipt; it cannot adopt another attempt/checkpoint or cold owner.
    binding.preparedSaves.set(taskId,{attempt:clone(claim.attempt),checkpoint:clone(savePoint),recoveryError})
   }
   return {saving:true,taskId,result:clone(output.result),saveRef:savePoint.saveRef}
  })
 }
 async function command(sessionId,{identity,taskId,interactionId,revision,commandId,action,payload}={}){
  return serial(sessionId,async()=>{
   if(!isDeepStrictEqual(canonical(identity),await currentScope(sessionId)))throw fail('UI session/lifecycle changed')
   const accepted=await journal.command(sessionId,taskId,{interactionId,revision,commandId,action,payload})
   // Acceptance is durable, not delivery. The caller forwards this SAME commandId
   // to the authenticated owner; it must not replay an unacknowledged UI side effect.
   return {accepted:true,delivered:false,command:accepted.command,taskId}
  })
 }
 // Only the authenticated original background realm calls this immediately
 // before its ORIGINAL DOM click handler runs. No action is synthesized here.
 async function ownerCommand(sessionId,{runtimeId,identity,taskId,interactionId,revision,commandId,action,payload}={}){
  return serial(sessionId,async()=>{
   const binding=await guard(sessionId,runtimeId)
   if(!isDeepStrictEqual(canonical(identity),binding.identity))throw fail('original interaction scope changed')
   const {task,proof}=await ownedAttempt(sessionId,binding,taskId)
   const accepted=await journal.command(sessionId,taskId,{interactionId,revision,commandId,action,payload})
   await guard(sessionId,runtimeId)
   if(task.state==='awaiting-user')await journal.transition(sessionId,taskId,{attempt:proof,expectedState:'awaiting-user',nextState:'result',checkpoint:{resultRef:task.checkpoint.resultRef}})
   else if(task.state!=='result'||task.checkpoint?.resultRef!==base(binding.identity,taskId)+'/interaction-'+hash(interactionId)+'.json')throw fail('original interaction already advanced')
   return {persisted:true,accepted:true,commandId:accepted.command.commandId}
  })
 }
 async function inspect(sessionId){
  const value=await journal.inspect(sessionId),binding=bindings.get(sessionId),pendingTasks=[];
  for(const task of value.tasks.filter(task=>!ended.has(task.state))){
   let fault=queueFailures.get(queueKey(sessionId,task.id));
   if(task.state==='queued'&&!fault){const ref=base(task.identity,task.id)+'/queue-state.json',stored=await store.readJson(ref);if(stored?.status==='blocked'&&stored.taskId===task.id&&isDeepStrictEqual(stored.identity,task.identity))fault={errorRef:ref,durable:true,...stored.error}}
   pendingTasks.push({id:task.id,state:task.state,...(fault?{queueError:clone(fault)}:{}),saveRetryAvailable:!!binding?.attempts.has(task.id)&&!inFlight.has(sessionId)&&(['failed','interrupted'].includes(task.state)&&!!task.recoveryCheckpoint||resumableSave(binding,task))})
  }
  return {...value,bound:!!binding,executing:inFlight.has(sessionId),pendingTasks}
 }

 return Object.freeze({bindOwner,release,retireOwner,register,cancel,dispatch,checkpoint,modelStep,prepareSaveRetry,retrySave,resumeQueued,command,ownerCommand,inspect,identity:async(sessionId,{runtimeId})=>clone((await guard(sessionId,runtimeId)).identity),assertTaskOwner:async(sessionId,{runtimeId,taskId,recovery})=>{if(recovery&&recovery.taskId!==taskId)throw fail('save recovery task changed');const binding=await guard(sessionId,runtimeId,recovery);if(taskId)await ownedAttempt(sessionId,binding,taskId);return {active:true}}})
}
