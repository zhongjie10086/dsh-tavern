import {cardMvuTargetStamp,cardMvuExpectedIdentity,cardMvuPredecessor} from './card-mvu-work-identity.js'
import {randomUUID,createHash} from 'node:crypto'
import {redactDiagnostic} from './mvu-diagnostics.js'
import {templateInputView,persistTemplateInputView} from './full-prompt-template-input.js'
const clone=value=>structuredClone(value)
const role=row=>row.tavernRoleOverride||row.tavernRole||row.role
const key=(row,index)=>row.tavernHistoryKey||'floor:'+index
const body=row=>row.sourceText??row.text??''
// R8 1.5: a receipt that proves no script received the event (no ready runtime,
// or the deadline passed before one was ready). The turn continues; the event is
// recorded as skipped and never delivered later.
const neverStarted=result=>result?.handled!==true&&(result?.unavailable===true||result?.skipped===true||result?.initializationFailed===true)&&(!result.phase||['queued','offered'].includes(result.phase))
export const skippedForRuntime=row=>row?.status==='discarded'&&row.runtimeUnavailable===true
const historyStamp=chat=>createHash('sha256').update(JSON.stringify((chat.messages||[]).map((row,index)=>[key(row,index),role(row),body(row),row.swipeId||0,Boolean(row.tavernHidden)]))).digest('hex')
export function helperHistoryEvents(before,after){
 const previous=new Map((before.messages||[]).map((row,index)=>[key(row,index),{row,index}])),events=[]
 const nextKeys=new Set((after.messages||[]).map(key))
 if([...previous.keys()].some(id=>!nextKeys.has(id)))events.push({name:'MESSAGE_DELETED',args:[after.messages.length]})
 for(const [index,row]of (after.messages||[]).entries()){
  const prior=previous.get(key(row,index));let name
  if(!prior)name=role(row)==='user'?(row.tavernHelperInputDelivered?null:'MESSAGE_SENT'):'MESSAGE_RECEIVED'
  else if((row.swipeId||0)!==(prior.row.swipeId||0))name='MESSAGE_SWIPED'
  else if(body(row)!==body(prior.row)||role(row)!==role(prior.row)||prior.index!==index||Boolean(row.tavernHidden)!==Boolean(prior.row.tavernHidden))name='MESSAGE_UPDATED'
  if(name)events.push({name,args:[index]})
 }
 return events
}
/** Persist admission before invoking scripts. An unacknowledged side effect is never replayed automatically. */
export function createTavernHelperEventJournal({chats,dispatch,waitForIdle,enabled=async()=>true,cardCore=async()=>null,isCardMvuReady=()=>false,ensureCardMvuRuntime,fault=async()=>{},onError=error=>console.warn('Tavern script event remains in the recovery journal:',error.message)}){
 const running=new Map(),cardRunning=new Map(),cardRequested=new Set();let stopped=false
 const idleWait = new AbortController()
 const unexecutedBusy = result => typeof waitForIdle === 'function' && result?.handled !== true && result?.busy === true && result?.notExecuted === true && result?.phase === 'queued'
 const cardUnfinished=row=>row.cardMvu&&!['completed','discarded'].includes(row.cardMvu.status)
 const targetStamp=cardMvuTargetStamp
 function assertCardContract(chat){
  if(chat?.tavernCardMvuContract!==undefined&&chat.tavernCardMvuContract!==1||chat?.tavernHelperEventJournal?.some(row=>row.cardMvu&&(chat.tavernCardMvuContract!==1||row.cardMvu.version!==1||!['unconfirmed','pending','running','completed','failed','discarded'].includes(row.cardMvu.status)||typeof row.cardMvu.coreId!=='string'||!row.cardMvu.coreId||typeof row.cardMvu.sourceDigest!=='string'||!Number.isSafeInteger(row.cardMvu.attempt)||row.cardMvu.attempt<0||!/^[a-f0-9]{64}$/.test(row.cardMvu.targetStamp))))throw Object.assign(new Error('卡核心待办合同版本不受支持；请升级程序或恢复匹配备份'),{code:'DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'})
 }
 const cardIdentity=(chat,event,core,status)=>({version:1,coreId:String(core.id),sourceDigest:String(core.sourceDigest||''),status,targetStamp:targetStamp(chat,event),attempt:0})
 function stage(chat,events){
  assertCardContract(chat)
  chat.tavernHelperServerEvents=true
  if(!events.length)return chat
  const unfinished=(chat.tavernHelperEventJournal||[]).filter(row=>!['completed','discarded'].includes(row.status)||cardUnfinished(row))
  if(unfinished.length+events.length>256)throw new Error('待处理脚本事件过多，请先在脚本管理中处理失败事件')
  const completed=(chat.tavernHelperEventJournal||[]).filter(row=>['completed','discarded'].includes(row.status)&&!cardUnfinished(row)).slice(-100)
  chat.tavernHelperEventJournal=[...completed,...unfinished,...events.map(event=>({id:randomUUID(),...clone(event),status:'pending',attempt:0,createdAt:Date.now(),branchId:chat.timeline?.branchId||'',identityVersion:1,target:event.inputOperationId||event.name==='MESSAGE_DELETED'||!Number.isInteger(event.args?.[0])?null:{index:event.args?.[0],key:chat.messages?.[event.args?.[0]]?key(chat.messages[event.args[0]],event.args[0]):null},lifecycle:Number(chat.tavernHelperLifecycleRevision)||0}))]
  return chat
 }
 function stageInput(chat,operationId,{spNative=false}={}){
  if((chat.tavernHelperEventJournal||[]).some(row=>row.inputOperationId===operationId))return chat
  const view=templateInputView(chat);if(!view.input||view.input.operationId!==operationId)return chat
  const draft=persistTemplateInputView(view.chat,view.input)
  const generationType=chat.regenInProgress?'regenerate':'normal'
  // Like ST, after-commands runs before MESSAGE_SENT and prompt assembly. The
  // admitted operation has already survived slash-command processing here.
  const admission=spNative&&generationType==='normal'?{version:1,operationId,floor:view.input.floor,text:view.input.sourceText,branchId:chat.timeline?.branchId||'',chatId:chat.id,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision)||0}:null
  return stage(draft,[{name:'GENERATION_STARTED',args:[generationType,{},false],inputOperationId:operationId},{name:'GENERATION_AFTER_COMMANDS',args:[generationType,admission?{__dshNativeInput:admission}:{},false],inputOperationId:operationId},{name:'MESSAGE_SENT',args:[view.input.floor],inputOperationId:operationId},...(admission?[{name:'USER_MESSAGE_RENDERED',args:[view.input.floor],inputOperationId:operationId}]:[])])
 }
 function stageInputPrepared(chat,operationId){
  if((chat.tavernHelperEventJournal||[]).some(row=>row.inputOperationId===operationId&&row.name==='GENERATE_AFTER_DATA'))return chat
  const view=templateInputView(chat)
  if(view.input?.operationId!==operationId)throw Error('正文请求准备期间输入身份已变化')
  const admitted=(chat.tavernHelperEventJournal||[]).find(row=>row.inputOperationId===operationId&&row.name==='USER_MESSAGE_RENDERED')
  if(!admitted||admitted.status!=='completed')throw Error('原生用户楼层尚未完成脚本处理')
  return stage(chat,[{name:'GENERATE_AFTER_DATA',args:[{},false],inputOperationId:operationId}])
 }
 // Foreground completion is distinct from manual history edits. The operation
 // identity is persisted with the same commit and prevents duplicate notification.
 function stageGeneration(chat,generationId){
  if(typeof generationId!=='string'||!generationId)throw Error('生成完成事件缺少操作标识');
  if((chat.tavernHelperEventJournal||[]).some(row=>row.name==='GENERATION_ENDED'&&row.generationId===generationId))return chat;
  const index=(chat.messages||[]).findLastIndex(row=>role(row)==='assistant');
  return index<0?chat:stage(chat,[{name:'GENERATION_ENDED',args:[index],generationId}]);
 }
 // Regeneration adopts a replacement only after the synthetic native turn has
 // finished. Admit its completion in that final lifecycle, not the discarded
 // intermediate one. The persisted recovery id also makes crash recovery safe.
 function stageRegeneration(chat,id){
  const generationId='regeneration:'+id;
  if((chat.tavernHelperEventJournal||[]).some(row=>row.generationId===generationId))return chat;
  const index=(chat.messages||[]).findLastIndex(row=>role(row)==='assistant');
  return index<0?chat:stage(chat,[{name:'MESSAGE_RECEIVED',args:[index],generationId},{name:'GENERATION_ENDED',args:[index],generationId}]);
 }
 function stageStopped(chat,generationId){
  if(typeof generationId!=='string'||!generationId)throw Error('生成停止事件缺少操作标识');
  if((chat.tavernHelperEventJournal||[]).some(row=>row.name==='GENERATION_STOPPED'&&row.generationId===generationId))return chat;
  return stage(chat,[{name:'GENERATION_STOPPED',args:[],generationId}]);
 }
 const status=chat=>(chat.tavernHelperEventJournal||[]).map(row=>({id:row.id,name:row.name,args:row.args,status:row.status,attempt:row.attempt,createdAt:row.createdAt,finishedAt:row.finishedAt,error:row.error||'',...(row.cardMvu?{cardMvu:clone(row.cardMvu)}:{})}))
 async function update(chat,id,work){return chats.update(chat.id,current=>{const row=current.tavernHelperEventJournal?.find(row=>row.id===id);if(!row)throw new Error('脚本事件记录已变化');work(row,current);return current},{source:'helper.event-journal'})}
 async function flushNow(sessionId){
  for(let count=0;count<256;count++){
   let chat=await chats.forSession(sessionId);if(!chat)return;assertCardContract(chat)
   let event=(chat.tavernHelperEventJournal||[]).find(row=>!['completed','discarded'].includes(row.status));if(!event)return
   const stale=event.inputOperationId?templateInputView(chat).input?.operationId!==event.inputOperationId:event.identityVersion===1?(event.target!==null&&(!chat.messages?.[event.target.index]||key(chat.messages[event.target.index],event.target.index)!==event.target.key)):event.historyStamp!==historyStamp(chat)
   if(event.branchId!==(chat.timeline?.branchId||'')||stale||event.lifecycle!==(Number(chat.tavernHelperLifecycleRevision)||0)){
    await update(chat,event.id,row=>{row.status='discarded';if(row.cardMvu)row.cardMvu.status='discarded';row.error='聊天分支或脚本版本已变化';row.finishedAt=Date.now()});continue
   }
   if(event.status!=='pending')throw new Error('上一个脚本事件「'+event.name+'」尚未确认完成。为避免重复执行脚本的效果，本轮先暂停；请在「脚本管理」里核对后选择重试或跳过，再重新发送。')
   if(!await enabled(chat)){await update(chat,event.id,row=>{row.status='discarded';row.error='当前没有启用的脚本';row.finishedAt=Date.now()});continue}
   const selectedCore=chat.mvu?.enabled===true&&chat.mvu.owner==='card'&&!chat.mvu.settlementPaused&&event.name==='MESSAGE_RECEIVED'?await cardCore(chat):null
   chat=await update(chat,event.id,(row,current)=>{
    if(row.status!=='pending')throw new Error('脚本事件已被接管');row.status='running';row.attempt++;row.startedAt=Date.now();row.error='';delete row.schedulingDeferral
    if(selectedCore?.id){current.tavernCardMvuContract=1;const prior=cardMvuPredecessor(current,row,selectedCore);row.cardMvu={...cardIdentity(current,row,selectedCore,'unconfirmed'),...(prior?{deferredByPrior:prior.id}:{})}}
   });event=chat.tavernHelperEventJournal.find(row=>row.id===event.id)
   await fault('admitted',event)
   let result
   try{
    result=await dispatch({sessionId,name:event.name,args:clone(event.args),work:{eventId:'journal:'+event.id+':'+event.attempt,general:true,excludedScriptIds:event.cardMvu?.deferredByPrior?[event.cardMvu.coreId]:chat.mvu?.owner==='official'&&!event.inputOperationId&&event.name!=='GENERATION_STOPPED'?['__dsh_official_mvu__']:[]}})
    if(result?.handled!==true&&!neverStarted(result)&&!unexecutedBusy(result))throw new Error(result?.error||'脚本执行结果未确认')
   }catch(error){await update(chat,event.id,row=>{row.status='failed';row.error=redactDiagnostic(String(error.message||error)).slice(0,2000);row.finishedAt=Date.now()});throw error}
   if(unexecutedBusy(result)){
    // Only the Host's pre-dispatch rejection proves no script ran. Unknown or
    // executing receipts retain the failure/recovery protocol above.
    await update(chat,event.id,row=>{row.status='pending';row.schedulingDeferral={reason:'runtime-busy',phase:'queued',notExecuted:true};row.error=''})
    // Outside the execution catch: timeout/disposal leaves this proven-unrun
    // event pending. Re-enter the loop to revalidate branch/target/lifecycle.
    await waitForIdle(sessionId,{signal:idleWait.signal})
    if(stopped)return
    continue
   }
   if(result.handled!==true){
    // Nothing ran: a card core keeps its step pending for the readiness resume.
    await update(chat,event.id,row=>{row.status='discarded';row.runtimeUnavailable=true;row.error=redactDiagnostic('脚本运行时未就绪，本次事件未送达，已跳过'+(result.error?'：'+String(result.error):'')).slice(0,2000);row.finishedAt=Date.now();if(row.cardMvu&&!['completed','discarded'].includes(row.cardMvu.status))row.cardMvu.status='pending'})
    continue
   }
   await fault('executed',event)
   const deferred=(result.diagnostics||[]).filter(item=>item.kind==='card-mvu-deferred-v1'&&item.name==='MESSAGE_RECEIVED'&&item.scriptId)
   await update(chat,event.id,(row,current)=>{
    // Only a successful native after-commands receipt can replace this admitted
    // input. The original SP writes options.prompt; its ST.chat mes mutation is
    // a local facade edit, not permission to rewrite durable history.
    const admission=event.name==='GENERATION_AFTER_COMMANDS'&&event.args?.[1]?.__dshNativeInput
    const returned=result.args?.[1]
    if(admission&&returned&&Object.hasOwn(returned,'prompt')){
     const returnedAdmission=returned.__dshNativeInput,view=templateInputView(current),pending=current.fullPromptTemplatePendingInput
     const fields=['version','operationId','floor','text','branchId','chatId','lifecycleRevision']
     if(typeof returned.prompt!=='string'||!returnedAdmission||fields.some(key=>returnedAdmission[key]!==admission[key])||admission.version!==1||event.inputOperationId!==admission.operationId||current.id!==admission.chatId||current.timeline?.branchId!==admission.branchId||(Number(current.tavernHelperLifecycleRevision)||0)!==admission.lifecycleRevision||view.input?.operationId!==admission.operationId||view.input?.floor!==admission.floor||view.input?.sourceText!==admission.text||pending?.operationId!==admission.operationId)throw Error('原生输入在剧情回执前已变化，未覆盖当前输入')
     pending.text=returned.prompt
    }
    if(deferred.length){
     const ids=[...new Set(deferred.map(item=>item.scriptId))]
     if(ids.length!==1||selectedCore&&ids[0]!==selectedCore.id)throw new Error('卡核心延期回执身份不一致，未确认工作不会自动重放')
     current.tavernCardMvuContract=1
     row.cardMvu={...(row.cardMvu||cardIdentity(current,row,{id:ids[0]},'pending')),status:'pending'}
    }else if(row.cardMvu)row.cardMvu.status=row.cardMvu.deferredByPrior?'pending':'completed'
    row.status='completed';row.finishedAt=Date.now()
   })
  }
  throw new Error('脚本持续产生新事件，本轮已停止；请检查事件循环')
 }
 function flush(sessionId){if(running.has(sessionId))return running.get(sessionId);const task=flushNow(sessionId);running.set(sessionId,task);void task.finally(()=>{if(running.get(sessionId)===task)running.delete(sessionId);if(!stopped)void resumeCardMvu(sessionId).catch(error=>{try{onError(error,sessionId)}catch{}})}).catch(()=>{});return task}
 async function resumeCardMvuNow(sessionId){
  await running.get(sessionId)?.catch(()=>{})
  for(let count=0;!stopped&&count<256;count++){
   let chat=await chats.forSession(sessionId);if(!chat)return;assertCardContract(chat)
   const event=chat.tavernHelperEventJournal?.find(row=>cardUnfinished(row));if(!event)return
   const core=await cardCore(chat),pending=event.cardMvu
   const invalid=chat.mvu?.enabled!==true||chat.mvu.owner!=='card'||event.branchId!==(chat.timeline?.branchId||'')||event.lifecycle!==(Number(chat.tavernHelperLifecycleRevision)||0)||targetStamp(chat,event)!==pending.targetStamp||core&&(core.id!==pending.coreId||String(core.sourceDigest||'')!==pending.sourceDigest)||!core&&Boolean(pending.sourceDigest)
   if(invalid){await update(chat,event.id,row=>{row.cardMvu.status='discarded';row.cardMvu.error='卡核心、来源、分支或目标消息已变化；禁止再次执行旧工作'});continue}
   if(chat.mvu.settlementPaused){await update(chat,event.id,row=>{row.cardMvu.status='discarded';row.cardMvu.error='本局已关闭 MVU 变量结算，这一层没有更新变量'});continue}
   if(!(event.status==='completed'||skippedForRuntime(event))||pending.status!=='pending')return
   await ensureCardMvuRuntime?.(sessionId)
   if(stopped||!await isCardMvuReady(sessionId))return
   const refreshed=await chats.forSession(sessionId),refreshedCore=await cardCore(refreshed);
   if(pending.sourceDigest&&(!refreshedCore||refreshedCore.id!==pending.coreId||String(refreshedCore.sourceDigest||'')!==pending.sourceDigest)){await update(chat,event.id,row=>{row.cardMvu.status='discarded';row.cardMvu.error='等待运行时期间卡核心来源已变化，未执行旧工作'});continue}
   chat=await update(chat,event.id,(row,current)=>{
    if(row.cardMvu?.status!=='pending')throw new Error('卡核心待办已被接管')
    if(row.branchId!==(current.timeline?.branchId||'')||row.lifecycle!==(Number(current.tavernHelperLifecycleRevision)||0)||targetStamp(current,row)!==row.cardMvu.targetStamp){row.cardMvu.status='discarded';row.cardMvu.error='卡核心目标已变化，未派发旧工作';return}
    row.cardMvu.status='running';row.cardMvu.attempt++;row.cardMvu.startedAt=Date.now()
   })
   const admitted=chat.tavernHelperEventJournal.find(row=>row.id===event.id),attempt=admitted.cardMvu.attempt
   if(admitted.cardMvu.status!=='running')continue
   await fault('card-admitted',admitted)
   let result,error
   try{result=await dispatch({sessionId,name:event.name,args:clone(event.args),work:{eventId:'card-mvu:'+event.id+':'+attempt,onlyScriptIds:[pending.coreId],requiredRuntimeContract:'card-mvu-pending-v1',expectedLifecycleRevision:event.lifecycle,expectedCardMvu:cardMvuExpectedIdentity(chat,admitted)},returnFailure:true})}catch(caught){error=caught}
   await fault('card-executed',admitted)
   await update(chat,event.id,row=>{
    if(row.cardMvu?.status!=='running'||row.cardMvu.attempt!==attempt)throw new Error('卡核心待办回执身份已变化')
    // Only an explicit never-executed scheduling result may return to pending.
    // A thrown error, timeout, disposal or unknown receipt is never replayed.
    const deferred=!error&&result?.handled!==true&&(result?.unavailable===true||result?.busy===true)&&(!result.phase||['queued','offered'].includes(result.phase))
    row.cardMvu.status=!error&&result?.stale===true?'discarded':deferred?'pending':!error&&result?.handled===true?'completed':'failed'
    row.cardMvu.error=deferred?'':redactDiagnostic(String(error?.message||result?.error||(!result?.handled?'卡核心执行回执未确认':''))).slice(0,2000)
    row.cardMvu.finishedAt=Date.now()
   })
   if(error||result?.handled!==true)return
  }
 }
 function resumeCardMvu(sessionId){
  if(stopped)return Promise.resolve()
  if(cardRunning.has(sessionId)){cardRequested.add(sessionId);return cardRunning.get(sessionId)}
  const task=resumeCardMvuNow(sessionId);cardRunning.set(sessionId,task)
  void task.finally(()=>{if(cardRunning.get(sessionId)===task)cardRunning.delete(sessionId);if(cardRequested.delete(sessionId)&&!stopped)void resumeCardMvu(sessionId).catch(error=>{try{onError(error,sessionId)}catch{}})}).catch(()=>{})
  return task
 }
 // A script may edit history while its caller waits for the edit acknowledgement.
 // The durable outbox must not synchronously call back into that waiting caller.
 function schedule(sessionId){void flush(sessionId).catch(error=>{try{onError(error,sessionId)}catch{}})}
 async function resolve(sessionId,{id,attempt,action}){
  if(running.has(sessionId))throw new Error('脚本事件正在执行，请等待完成')
  if(!['retry','skip'].includes(action))throw new Error('未知脚本恢复操作')
  const chat=await chats.forSession(sessionId);if(!chat)throw new Error('游戏不存在')
  await update(chat,id,row=>{if(!['running','failed'].includes(row.status)||row.attempt!==attempt)throw new Error('脚本事件状态已变化，请刷新');row.status=action==='retry'?'pending':'discarded';row.resolution={action,at:Date.now()};row.error='';if(action==='skip')row.finishedAt=Date.now()})
  await flush(sessionId);return status(await chats.forSession(sessionId))
 }
 // Host-only completion of an already executed SP event. This never dispatches
 // a handler; caller proves the retained task saved and every other recipient
 // finished before the SP-only persistence error.
 async function completeSavedSpTask(sessionId,{eventId,identity,recoveryError,taskId}){
  const match=/^journal:([^:]+):(\d+)$/.exec(eventId||'');
  const chat=await chats.forSession(sessionId);
  if(!chat||chat.id!==identity.chatId||(chat.timeline?.branchId||'')!==identity.branchId||(Number(chat.tavernHelperLifecycleRevision)||0)!==identity.lifecycleRevision)throw Error('SP 保存恢复事件剧情身份已变化');
  if(!match){if((chat.tavernHelperEventJournal||[]).some(row=>['running','failed'].includes(row.status)))throw Error('SP 保存后仍有未确认脚本事件');return {completed:true,journal:false};}
  if(running.has(sessionId))throw Error('SP 保存恢复事件仍在执行');
  if((chat.tavernHelperEventJournal||[]).some(row=>row.id!==match[1]&&['running','failed'].includes(row.status)))throw Error('SP 保存后仍有另一未确认脚本事件');
  await update(chat,match[1],(row,current)=>{
   if(current.id!==identity.chatId||(current.timeline?.branchId||'')!==identity.branchId||(Number(current.tavernHelperLifecycleRevision)||0)!==identity.lifecycleRevision||(current.tavernHelperEventJournal||[]).some(other=>other.id!==row.id&&['running','failed'].includes(other.status)))throw Error('SP 保存恢复事件提交期间身份或其他事件已变化');
   if(row.attempt!==Number(match[2])||row.lifecycle!==identity.lifecycleRevision||row.branchId!==identity.branchId||row.status!=='failed'||typeof recoveryError!=='string'||!recoveryError||!row.error?.endsWith(recoveryError)||cardUnfinished(row))throw Error('SP 保存恢复事件缺少精确失败回执');
   row.status='completed';row.finishedAt=Date.now();row.resolution={action:'saved-sp-task',taskId,eventId,at:Date.now()};
   // Preserve the original failure for diagnosis, rather than erasing it.
   row.recoveredError=row.error;row.error='';
  });
  return {completed:true,journal:true};
 }
 return {resumeCardMvu,completeSavedSpTask,dispose(){stopped=true;cardRequested.clear();idleWait.abort(new Error('脚本事件服务已释放，未执行事件仍保留'))},stage,stageInput,stageInputPrepared,stageGeneration,stageRegeneration,stageStopped,schedule,stageHistory:(before,after)=>stage(after,helperHistoryEvents(before,after)),flush,resolve,status,inspect:async sessionId=>({events:status(await chats.forSession(sessionId)),running:running.has(sessionId)}),isRunning:sessionId=>running.has(sessionId)}
}
