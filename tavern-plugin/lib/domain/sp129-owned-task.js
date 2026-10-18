import {walkSp129} from './sp129-source.js'

// Dormant until the host supplies the complete authenticated task protocol.
// Functions and promises stay inside their owner realm; RPC payloads are JSON.
export function createSpOwnedTaskBridge({host,identity,message,settings,execute,flush,generation=()=>null}) {
 const copy=value=>JSON.parse(JSON.stringify(value));let pending=null,active=null,sequence=0,cancellationError=null,cancelBarrier=Promise.resolve();
 const interactions=new Map(),saveRetries=new Map();
 const enabled=()=>host.__dshSpOwnedTasksEnabled===true;
 const protocol=()=>{for(const name of ['__dshSpOwnedTaskRegister','__dshSpOwnedTaskCancel','__dshSpOwnedTaskDispatch','__dshSpOwnedTaskCheckpoint','__dshSpOwnedModelStep','__dshSpOwnedTaskAssertOwner','__dshSpOwnedTaskOwnerCommand'])if(typeof host[name]!=='function')throw Error('SP owned-task protocol incomplete: '+name)};
 const sameIdentity=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function cancelPlan(plan,reason){
  if(plan.dispatched)return Promise.resolve();if(plan.cancellation)return plan.cancellation;
  plan.cancelled=true;plan.cancellation=plan.receipt.then(async receipt=>{if(receipt?.cancelled===true)return receipt;if(!receipt?.taskId)throw Error('SP owned task cancellation lacks registration');const result=await host.__dshSpOwnedTaskCancel({taskId:receipt.taskId,reason});if(result?.cancelled!==true)throw Error('SP owned task cancellation was not acknowledged');return result}).catch(error=>{cancellationError=error;throw error});plan.cancellation.catch(()=>{});return plan.cancellation;
 }
 function cancelPending(){if(cancellationError)throw cancellationError;const plan=pending;pending=null;if(!plan)return;cancelBarrier=cancelPlan(plan,'debounce_replaced');return cancelBarrier}
 async function finishPlan(plan,businessError){
  if(!plan||plan.dispatched)return;if(pending===plan)pending=null;
  try{const cancellation=cancelPlan(plan,'original_evaluation_not_dispatched');cancelBarrier=Promise.all([cancelBarrier,cancellation]).then(()=>{});cancelBarrier.catch(()=>{});await cancellation}
  catch(error){if(businessError&&businessError!==error)throw new AggregateError([businessError,error],'SP callback and undispatched plan cancellation both failed',{cause:businessError});throw error}
 }
 function plan(eventType,intent){
  if(!enabled())return null;protocol();if(cancellationError)throw cancellationError;
  const ownApply=active?.applying,eventIndex=intent?.eventMessageId;
  const selfUpdate=ownApply&&eventType==='CHARACTER_MESSAGE_RENDERED'&&eventIndex===ownApply.index&&generation()===active.generation&&message(eventIndex)?.content===ownApply.content;
  const descriptor={generation:generation(),...(selfUpdate?{selfUpdateOf:active.id,selfUpdateIndex:eventIndex}:{}),requestId:host.crypto?.randomUUID?.()||('sp-plan:'+Date.now()+':'+(++sequence)+':'+Math.random()),version:1,kind:'contentOptimization',identity:copy(identity()),eventType:String(eventType),intent:intent?copy(intent):null,settings:copy(settings())};
  const register=typeof host.__dshCaptureSpOwnedTaskRegister==='function'?host.__dshCaptureSpOwnedTaskRegister():value=>host.__dshSpOwnedTaskRegister(value);if(typeof register!=='function')throw Error('SP owned-task registration capture unavailable');
  const item={descriptor,cancelled:false};item.receipt=cancelBarrier.then(()=>register(descriptor));item.receipt.catch(error=>{item.error=error});pending=item;return item;
 }
 async function dispatch(plan,index){
  if(!plan)return execute(index);const receipt=await plan.receipt;
  if(receipt?.cancelled===true&&receipt.reason==='original-apply-refresh'){if(pending===plan)pending=null;return receipt}
  if(plan.cancelled)throw Error('SP owned task was cancelled');
  if(!receipt||typeof receipt.taskId!=='string'||!receipt.taskId)throw Error('SP owned task registration was not acknowledged');
  if(!sameIdentity(plan.descriptor.identity,identity()))throw Error('SP owned task scope changed before dispatch');
  const target=copy(message(index));if(!target)throw Error('SP owned task target missing');
  if(pending===plan)pending=null;plan.dispatched=true;
  return host.__dshSpOwnedTaskDispatch({...plan.descriptor,taskId:receipt.taskId,target});
 }
 async function run(task){
  protocol();if(active)throw Error('SP owned task already executing');
  if(task?.version!==1||task.kind!=='contentOptimization'||typeof task.taskId!=='string'||!task.taskId)throw Error('Invalid SP owned task');
  active={id:task.taskId,generation:task.generation??generation(),modelStep:0,dialogs:new Set()};let authenticated=false;
  try{await host.__dshSpOwnedTaskAssertOwner(copy(task));authenticated=true;
   if(!sameIdentity(task.identity,identity())||!sameIdentity(task.settings,settings()))throw Error('SP owned task identity or settings changed');
   const target=task.target;if(!target||!Number.isSafeInteger(target.index)||!sameIdentity(target,message(target.index)))throw Error('SP owned task target changed');
   const result=await execute(target.index);while(active.dialogs.size)await Promise.all([...active.dialogs].map(entry=>entry.done));if(active.blocked)throw active.blocked;await host.__dshSpOwnedTaskCheckpoint({taskId:task.taskId,phase:'result',result:{wasUndefined:result===undefined,...result===undefined?{}:{value:copy(result)}}});await host.__dshSpOwnedTaskCheckpoint({taskId:task.taskId,phase:'saving'});saveRetries.set(task.taskId,copy(task.identity));await flush();await host.__dshSpOwnedTaskCheckpoint({taskId:task.taskId,phase:'completed'});saveRetries.delete(task.taskId);return result}
  catch(error){if(authenticated)try{await host.__dshSpOwnedTaskCheckpoint({taskId:task.taskId,phase:'failed',error:String(error?.message||error)})}catch(checkpointError){if(error&&typeof error==='object'&&Object.isExtensible(error))Object.defineProperty(error,'dshOwnedCheckpointError',{value:checkpointError});else throw new AggregateError([error,checkpointError],'SP task and failure checkpoint both failed',{cause:error})}throw error}
  finally{active=null}
 }
 async function applyMessage(index,content,work){
  if(!active)return work();const owner=active,previous=owner.applying;owner.applying={index,content:String(content)};
  try{return await work()}finally{if(active===owner)owner.applying=previous}
 }
 function prepareQueued(task){
  if(active)throw Error('SP original task is still executing');
  if(!sameIdentity(task.identity,identity()))return {cancelled:true,code:'scope-changed',reason:'original scope changed before queued execution'};
  if(task.generation!==undefined&&task.generation!==generation())return {cancelled:true,code:'generation-changed',reason:'original generation changed before queued execution'};
  const target=message(task.target?.index);
  if(!target||target.isUser)return {cancelled:true,code:'target-not-ai',reason:'original target is no longer an AI message'};
  return {identity:copy(identity()),target:copy(target),settings:copy(settings())};
 }
 // This map is deliberately realm-local: persisted data cannot reconstruct the
 // original mutated SP objects/closures after a process restart.
 async function retrySave(taskId,recovery){
  protocol();if(recovery&&(recovery.taskId!==taskId||typeof recovery.token!=='string'||!recovery.token))throw Error('SP save recovery capability invalid');if(active)throw Error('SP owned task already executing');
  const savedIdentity=saveRetries.get(taskId);
  if(!savedIdentity||!sameIdentity(savedIdentity,identity()))throw Error('SP original save state is not retained in this realm');
  if(typeof host.__dshSpOwnedTaskPrepareSaveRetry!=='function')throw Error('SP save retry protocol unavailable');
  active={id:taskId,modelStep:0,dialogs:new Set()};let prepared=false;
  try{await host.__dshSpOwnedTaskAssertOwner({taskId,...(recovery?{recovery}:{})},recovery);const receipt=await host.__dshSpOwnedTaskPrepareSaveRetry({taskId,...(recovery?{recovery}:{})},recovery);
   if(receipt?.saving!==true||receipt.taskId!==taskId)throw Error('SP save retry was not durably prepared');prepared=true;
   await flush(recovery);await host.__dshSpOwnedTaskCheckpoint({taskId,phase:'completed',...(recovery?{recovery}:{})},recovery);saveRetries.delete(taskId);return {saved:true,taskId}
  }catch(error){if(prepared)try{await host.__dshSpOwnedTaskCheckpoint({taskId,...(recovery?{recovery}:{}),phase:'failed',error:String(error?.message||error)},recovery)}catch(checkpointError){throw new AggregateError([error,checkpointError],'SP save retry and failure checkpoint both failed',{cause:error})}throw error}
  finally{active=null}
 }
 async function model(request,invoke){
  if(!active)return invoke();if(active.blocked)throw active.blocked;const taskId=active.id,step=++active.modelStep;
  // The host returns a durable result, or admits exactly one invocation. An
  // execution-unknown step must reject; it must never silently reissue a model.
  let admission;try{admission=await host.__dshSpOwnedModelStep({taskId,step,phase:'prepare',request:copy(request)})}catch(error){active.blocked=error;throw error}
  if(admission?.state==='result')return admission.result;
  if(admission?.state!=='admitted'||typeof admission.attemptId!=='string'){active.blocked=Error('SP model step is not safely executable');throw active.blocked}
  let result;try{result=await invoke()}catch(error){try{await host.__dshSpOwnedModelStep({taskId,step,attemptId:admission.attemptId,phase:'failed',error:String(error?.message||error)})}catch(checkpointError){active.blocked=checkpointError;throw checkpointError}throw error}
  let saved;try{saved=await host.__dshSpOwnedModelStep({taskId,step,attemptId:admission.attemptId,phase:'result',result})}catch(error){active.blocked=error;throw error}
  if(saved?.persisted!==true){active.blocked=Error('SP model result was not durably acknowledged');throw active.blocked}return result;
 }
 async function interaction(payload){
  if(!active)throw Error('SP owned interaction has no execution owner');
  const taskId=active.id,interactionId=taskId+':interaction:'+(++sequence);
  let resolve;const choice=new Promise(yes=>{resolve=yes});interactions.set(interactionId,{taskId,resolve});
  try{await host.__dshSpOwnedTaskCheckpoint({taskId,phase:'awaiting-user',interactionId,payload:copy(payload)});return await choice}
  finally{interactions.delete(interactionId)}
 }
 async function command(input){
  const entry=interactions.get(input?.interactionId);
  if(!entry||entry.taskId!==input.taskId||!['apply','skip','cancel','reoptimize'].includes(input.command))throw Error('SP owned interaction command is stale or invalid');
  // Reoptimization opens a second original dialog whose callbacks are not yet
  // bridged. Keep the pending interaction; never report it cancelled/completed.
  if(input.command==='reoptimize')throw Error('SP reoptimization dialog ownership is not integrated; task remains awaiting user');
  await host.__dshSpOwnedTaskAssertOwner({taskId:input.taskId});
  await host.__dshSpOwnedTaskCheckpoint({taskId:input.taskId,phase:'interaction-command',interactionId:input.interactionId,command:input.command});
  if(interactions.get(input.interactionId)!==entry)throw Error('SP owned interaction already consumed');
  interactions.delete(input.interactionId);entry.resolve(input.command);return {accepted:true};
 }
 function failOriginalDialog(entry,error){
  if(!entry)return;if(entry.owner===active)active.blocked=error;entry.owner.dialogs.delete(entry);entry.reject(error);entry.onError?.(error)
 }
 function armOriginalDialog(entry){
  entry.interactionId=entry.taskId+':original-dialog:'+(++sequence);entry.revision=1;entry.consumed=false
  entry.receipt=Promise.resolve(host.__dshSpOwnedTaskCheckpoint({taskId:entry.taskId,phase:'awaiting-user',interactionId:entry.interactionId,payload:copy(entry.payload)}));entry.receipt.catch(error=>failOriginalDialog(entry,error))
 }
 function originalDialog(payload,onError){
  if(!active)return null
  const entry={taskId:active.id,owner:active,payload:copy(payload),onError};entry.done=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject});entry.done.catch(()=>{});active.dialogs.add(entry);armOriginalDialog(entry);return entry
 }
 async function beforeOriginalCommand(entry,action){
  if(!entry)return true;if(entry.owner!==active)throw Error('SP original interaction owner changed');if(entry.consumed)return false;entry.consumed=true
  try{await entry.receipt;const result=await host.__dshSpOwnedTaskOwnerCommand({taskId:entry.taskId,identity:copy(identity()),interactionId:entry.interactionId,revision:entry.revision,commandId:entry.interactionId+':'+action,action,payload:null});if(result?.persisted!==true)throw Error('SP original interaction command was not durably acknowledged');return true}catch(error){failOriginalDialog(entry,error);throw error}
 }
 async function afterOriginalCommand(entry,element){
  if(!entry)return;if(entry.owner!==active)throw Error('SP original interaction owner changed');if(entry.owner.blocked)return
  if(element?.isConnected===true){armOriginalDialog(entry);await entry.receipt;return}
  entry.owner.dialogs.delete(entry);entry.resolve()
 }
 return {plan,cancelPending,finishPlan,dispatch,run,retrySave,prepareQueued,applyMessage,model,interaction,command,isActive:()=>active!==null,originalDialog,beforeOriginalCommand,afterOriginalCommand,failOriginalDialog};
}

export function adaptSp129OwnedTask(ctx){
 // The published host is a lexical const (m=getHostWindow()), not a hoisted
 // global. Constructing the bridge at root.start reads it inside its TDZ.
 const hostStatements=ctx.root.body.filter(node=>node.type==='VariableDeclaration'&&node.declarations.some(item=>item.id?.name===ctx.hostName));
 if(hostStatements.length!==1)throw Error('SP owned-task AST contract: host declaration');
 const hostStatement=hostStatements[0],hostBinding=hostStatement.declarations.find(item=>item.id?.name===ctx.hostName);
 if(hostBinding.init?.type!=='CallExpression'||hostBinding.init.callee?.name!=='getHostWindow')throw Error('SP owned-task AST contract: host initializer');

 const all=[];walkSp129(ctx.root,node=>all.push(node));
 const unique=(rows,name)=>{if(rows.length!==1)throw Error('SP owned-task AST contract: '+name);return rows[0]};
 const named=name=>unique(all.filter(n=>['FunctionDeclaration','FunctionExpression'].includes(n.type)&&n.id?.name===name),name);
 const handler=named('handleContentOptimizationEvent_ACU'),event=handler.params[0].left?.name||handler.params[0].name,intent=handler.params[1].name;
 const calls=(root,name)=>{const rows=[];walkSp129(root,n=>{if(n.type==='CallExpression'&&n.callee.name===name)rows.push(n)});return rows};
 const timer=unique(calls(handler,'setTimeout').filter(n=>n.arguments[1]?.value===500),'500ms content debounce');
 const cancel=unique(calls(handler,'clearTimeout'),'content debounce cancellation');
 const executeCall=unique(calls(timer,'executeContentOptimization_ACU'),'content optimization dispatch');
 ctx.insert(handler.body.start+1,'let __dshOwnedPlan=null;');
 ctx.insert(cancel.start,'(__dshSpOwnedBridge.cancelPending(),');ctx.insert(cancel.end,')');
 ctx.replace(timer.start,timer.start,'(__dshOwnedPlan=__dshSpOwnedBridge.plan('+event+','+intent+'),');ctx.insert(timer.end,')');
 ctx.replace(executeCall,'__dshSpOwnedBridge.dispatch(__dshOwnedPlan,'+ctx.text(executeCall.arguments[0])+')');
 const callback=timer.arguments[0];if(!callback.async||callback.body.type!=='BlockStatement')throw Error('SP owned-task AST contract: async content callback');
 const callbackFailures=[];walkSp129(callback.body,node=>{if(node.type==='CatchClause'&&ctx.text(node.body).includes('ACU 正文事件处理失败:'))callbackFailures.push(node)});
 const callbackFailure=unique(callbackFailures,'content callback failure');if(callbackFailure.param?.type!=='Identifier')throw Error('SP owned-task AST contract: content callback error binding');
 ctx.insert(callback.body.start+1,'let __dshOwnedCallbackError;try{');
 ctx.insert(callbackFailure.body.start+1,'__dshOwnedCallbackError='+callbackFailure.param.name+';');
 ctx.insert(callback.body.end-1,'}catch(error){__dshOwnedCallbackError=error;throw error}finally{await __dshSpOwnedBridge.finishPlan(__dshOwnedPlan,__dshOwnedCallbackError);if(__dshOwnedCallbackError!==undefined)throw __dshOwnedCallbackError}');
 for(const call of calls(named('performContentOptimization_ACU'),'callAIWithPreset_ACU'))ctx.replace(call,'__dshSpOwnedBridge.model(['+call.arguments.map(n=>ctx.text(n)).join(',')+'],()=>'+ctx.text(call)+')');
 const replacement=named('replaceChatMessage_ACU');
 if(!replacement.async||replacement.params.slice(0,2).some(node=>node.type!=='Identifier'))throw Error('SP original message replacement contract changed');
 ctx.insert(replacement.body.start+1,`return __dshSpOwnedBridge.applyMessage(${replacement.params[0].name},${replacement.params[1].name},async()=>{`);
 ctx.insert(replacement.body.end-1,'});');
 const confirm=named('executeContentOptimizationWithConfirm_ACU');
 const promises=[];walkSp129(confirm,n=>{if(n.type==='NewExpression'&&n.callee.name==='Promise')promises.push(n)});
 const executor=unique(promises,'manual optimization promise').arguments[0];
 if(executor.params.length!==1||executor.params[0].type!=='Identifier')throw Error('SP owned-task confirmation executor changed');
 ctx.replace(executor.params[0],'('+executor.params[0].name+',__dshOwnedReject)');
 // Preserve BOTH original dialogs and every original click handler. Only gate
 // their real button actions on durable admission; never synthesize apply/skip.
 for(const dialogName of ['showOptimizationDiffDialogForLoop_ACU','showReoptimizationDialog_ACU']){
  const dialog=named(dialogName),[index,payload]=dialog.params.map(n=>n.name),primary=dialogName==='showOptimizationDiffDialogForLoop_ACU'
  // The published template nests CSS quotes inside a double-quoted HTML
  // style attribute. Encode only those inner quotes; DOM parsing restores the
  // exact CSS values instead of dropping everything after background-image.
  const templates=[];walkSp129(dialog,node=>{if(node.type==='TemplateLiteral'&&node.quasis[0]?.value.cooked.includes('<div class="acu-optimization-dialog acu-dialog-classic" style="'))templates.push(node)});
  const template=unique(templates,dialogName+' original modal template'),quasi=template.quasis[0],raw=ctx.text(quasi),start=raw.indexOf('style="')+7,end=raw.indexOf('">',start);
  if(start<7||end<start)throw Error('SP owned-task modal style boundary changed');
  const style=raw.slice(start,end);if(!style.includes('z-index: 100000')||!style.includes('background-image: url(')||!style.includes('font-family:'))throw Error('SP owned-task original modal CSS changed');
  ctx.replace(quasi,raw.slice(0,start)+style.replaceAll('"','&quot;')+raw.slice(end));
  ctx.insert(dialog.body.start+1,`const __dshOwnedOriginalDialog=__dshSpOwnedBridge.originalDialog({kind:${JSON.stringify(dialogName)},messageIndex:${index},...${payload}},${primary?'__dshOwnedReject':'undefined'});`)
  const handlers=[];walkSp129(dialog,node=>{if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.property.name==='on'&&node.arguments[0]?.value==='click'&&node.arguments[1]?.type==='FunctionExpression')handlers.push(node)})
  if(handlers.length!==(primary?4:3))throw Error('SP owned-task original dialog handlers changed: '+dialogName)
  for(const handler of handlers){
   const selector=handler.callee.object.arguments?.[0]?.value,fn=handler.arguments[1]
   const action=typeof selector==='string'&&selector.includes('acu-opt-reoptimize')?'reoptimize':typeof selector==='string'&&selector.includes('acu-opt-apply')?'apply':typeof selector==='string'&&selector.includes('acu-opt-skip')?'skip':typeof selector==='string'&&selector.includes('acu-opt-cancel')?'cancel':null
   if(!action)throw Error('SP owned-task original button selector changed')
   if(!fn.async)ctx.insert(fn.start,'async ')
   ctx.insert(fn.body.start+1,`let __dshOwnedCommandStarted=false;try{if(__dshOwnedOriginalDialog&&!await __dshSpOwnedBridge.beforeOriginalCommand(__dshOwnedOriginalDialog,${JSON.stringify(action)}))return;__dshOwnedCommandStarted=true;`)
   ctx.insert(fn.body.end-1,`}catch(error){__dshSpOwnedBridge.failOriginalDialog(__dshOwnedOriginalDialog,error);${primary?'__dshOwnedReject(error);':'throw error;'}}finally{if(__dshOwnedOriginalDialog&&__dshOwnedCommandStarted)await __dshSpOwnedBridge.afterOriginalCommand(__dshOwnedOriginalDialog,this);}`)
  }
 }
 ctx.insert(hostStatement.end,`;const __dshSpOwnedBridge=(${createSpOwnedTaskBridge.toString()})({host:${ctx.hostName},identity:()=>{if(typeof ${ctx.hostName}.__dshSpOwnedTaskIdentity!=='function')throw Error('SP canonical owned-task identity unavailable');return ${ctx.hostName}.__dshSpOwnedTaskIdentity({chatId:String(Gd||''),isolationKey:String(getCurrentIsolationKey_ACU()??'')})},message:index=>{const row=getChatArray_ACU()?.[index];return row?{index,messageId:row.message_id,isUser:!!row.is_user,content:String(row.mes||'')}:null},settings:()=>_d.contentOptimizationSettings||{},generation:()=>Eu,execute:index=>executeContentOptimization_ACU(index),flush:async recovery=>{await saveChatToHostStrict_ACU({__dshOwnedRecoveryCall:recovery?${ctx.hostName}.__dshSpOwnedSaveCall(recovery):undefined})}});`);
 ctx.atApi(`Object.defineProperty(${ctx.apiName},'__dshPrepareQueuedOwnedTask',{value:task=>__dshSpOwnedBridge.prepareQueued(task)});Object.defineProperty(${ctx.apiName},'__dshRetryOwnedTaskSave',{value:(taskId,recovery)=>__dshSpOwnedBridge.retrySave(taskId,recovery)});Object.defineProperty(${ctx.apiName},'__dshExecuteOwnedTask',{value:task=>__dshSpOwnedBridge.run(task)});Object.defineProperty(${ctx.apiName},'__dshOwnedTaskCommand',{value:command=>__dshSpOwnedBridge.command(command)});`);
}
