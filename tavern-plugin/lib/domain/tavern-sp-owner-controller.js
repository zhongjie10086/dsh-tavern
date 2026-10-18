import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'

/** One private transport to a persistent SP realm. Browser requests may attach
 * to it; they cannot choose a dispatcher, evaluate code or supply its lease. */
export function createTavernSpOwnerController({executor,dispatch,frontendDispatch,scope,retrySave,saveRecoveryState,now=Date.now,monotonicNow=()=>performance.now()}){
 const attachments=new Map(),owners=new Map(),surfaces=new Map(),deliveries=new Map()
 const error=message=>new Error('SP 持久执行者：'+message)
 function caller(args,{retainedClose=false}={}){
  if(args?.scriptScope||args?.scriptId||!args?.runtimeId||!retainedClose&&!frontendDispatch.available(args.sessionId,args.runtimeId))throw error('游戏页面身份已失效')
 }
 async function current(args,{retainedClose=false}={}){
  caller(args,{retainedClose});const identity=await scope(args.sessionId)
  caller(args,{retainedClose})
  if(identity.chatId!==args.chatId||identity.lifecycleRevision!==args.lifecycleRevision||identity.sourceDigest!==args.sourceDigest)throw error('卡片、脚本或剧情版本已变化')
  return identity
 }
 async function attachment(args,{starting=false,retainedClose=false}={}){
  const identity=await current(args,{retainedClose}),entry=attachments.get(args.capability)
  if(!entry||entry.runtimeId!==args.runtimeId||entry.sessionId!==args.sessionId||entry.ownerId!==args.ownerId||!isDeepStrictEqual(entry.identity,identity))throw error('界面连接已经失效')
  if(!starting){await entry.owner.promise;await executor.owned.assertOwner(args.sessionId,entry.owner.runtimeId)}entry.seenAt=now();return entry
 }
 async function prepare(args){
  const identity=await current(args);let owner=owners.get(args.sessionId)
  if(owner&&!isDeepStrictEqual(owner.identity,identity)){
   // Old viewers are already invalid under current(); they must not pin an
   // otherwise idle old realm. Only the executor may prove safe retirement.
   const previous=owner
   for(const[key,row]of attachments)if(row.owner===previous)attachments.delete(key)
   if(!previous.retiring)previous.retiring=(async()=>{
    if(typeof executor.owned.retire!=='function')throw error('旧原实例缺少安全退出入口')
    const result=await executor.owned.retire(args.sessionId)
    if(result?.released!==true)throw error('上一个剧情版本仍有未完成工作或未确认保存，暂不可切换')
    // onRetired runs only after real context closure and clears the old owner.
    // A success flag alone is not a substitute for that authoritative callback.
    if(owners.get(args.sessionId)===previous)throw error('旧原实例退出尚未获得确认')
   })().finally(()=>{delete previous.retiring})
   await previous.retiring
   if(!isDeepStrictEqual(await current(args),identity))throw error('退出期间剧情身份再次变化，请重新打开')
   owner=owners.get(args.sessionId)
   if(owner&&!isDeepStrictEqual(owner.identity,identity))throw error('上一个剧情版本的原实例尚未安全退出')
  }
  if(!owner){owner={id:randomUUID(),identity,runtimeId:null,initializing:true};owners.set(args.sessionId,owner);owner.promise=executor.owned.ensure(args.sessionId).then(ready=>{owner.runtimeId=ready.runtimeId;owner.initializing=false;return ready},cause=>{owner.initializing=false;owner.initializationError=cause;throw cause});owner.promise.catch(()=>{})}
  for(const [key,value]of attachments)if(value.sessionId===args.sessionId&&value.runtimeId!==args.runtimeId)attachments.delete(key)
  owner.composerEpoch=(owner.composerEpoch||0)+1;const composerEpoch=owner.composerEpoch;for(const[id,row]of surfaces)if(row.sessionId===args.sessionId&&row.composerEpoch!==undefined&&row.composerEpoch!==composerEpoch){surfaces.delete(id);clearTimeout(row.timer);row.reject(error('输入框界面已更换；旧操作不会自动重播'))}
  const capability=randomUUID();attachments.set(capability,{sessionId:args.sessionId,runtimeId:args.runtimeId,ownerId:owner.id,owner,identity,composerEpoch,seenAt:now()})
  return {ownerId:owner.id,capability,composerEpoch,sourceDigest:identity.sourceDigest,lifecycleRevision:identity.lifecycleRevision}
 }
 async function attach(args){
  let remaining=91000,last=monotonicNow()
  const charge=async()=>{
   const at=monotonicNow();let paused=false
   if(args.capability){const entry=await attachment(args,{starting:true});caller(args);if(attachments.get(args.capability)!==entry||entry.composerEpoch!==entry.owner.composerEpoch)throw error('等待期间界面连接已更换');paused=executor.owned.nativeDialogPending?.(args.sessionId)===true;if(paused&&executor.owned.keepNativeDialogAlive?.(args.sessionId)===false)throw error('原确认执行权已失效')}
   if(!paused)remaining-=Math.max(0,at-last);last=Math.max(last,at)
   if(remaining<=0)throw error('原插件初始化等待超时，原实例与任务保留')
  }
  const bounded=work=>new Promise((resolve,reject)=>{
   let timer,finished=false
   const finish=(ok,value)=>{if(finished)return;finished=true;clearTimeout(timer);ok?resolve(value):reject(value)}
   const monitor=async()=>{try{await charge();if(!finished)timer=setTimeout(monitor,Math.min(1000,remaining))}catch(cause){finish(false,cause)}}
   void monitor()
   Promise.resolve().then(work).then(async value=>{try{await charge();finish(true,value)}catch(cause){finish(false,cause)}},cause=>finish(false,cause))
  })
  if(!args.capability){const prepared=await bounded(()=>prepare(args));args={...args,...prepared}}
  const observed=await bounded(()=>attachment(args,{starting:true}));await observed.owner.promise;
  if(executor.owned.retainedNativeDialogPending?.(args.sessionId)===true)return {ready:false,dialogRecoveryRequired:true,ownerId:observed.ownerId,capability:args.capability,composerEpoch:observed.composerEpoch,executionOwner:observed.owner.runtimeId};
  const recovery=await executor.withOwnedInstance(args.sessionId,context=>({quarantined:context.quarantined,error:context.drainError,runtimeId:context.runtimeId}));
  if(recovery.quarantined)return {ready:false,recoveryRequired:true,quarantined:true,error:recovery.error,ownerId:observed.ownerId,capability:args.capability,composerEpoch:observed.composerEpoch,executionOwner:recovery.runtimeId};
  const entry=await bounded(()=>attachment(args)),identity=entry.identity,runtimeId=entry.owner.runtimeId
  const pendingSave=typeof saveRecoveryState==='function'?await bounded(()=>saveRecoveryState(args.sessionId,runtimeId)):null;
  if(pendingSave?.required===true){if(await bounded(()=>attachment(args))!==entry)throw error('保存恢复期间界面连接已变化');return {ready:false,recoveryRequired:true,quarantined:false,error:pendingSave.error||'SP 正文优化结果尚未确认保存，请仅重试保存。',ownerId:entry.ownerId,capability:args.capability,composerEpoch:entry.composerEpoch,executionOwner:runtimeId};}
  const inOwner=work=>bounded(()=>executor.withOwnedInstance(args.sessionId,context=>{if(context.runtimeId!==runtimeId||!isDeepStrictEqual(context.scope,identity))throw error('等待初始化期间原执行者或剧情身份已变化');return work(context.page)}))
  if(args.refresh)await inOwner(page=>page.evaluate(()=>window.__dshBackgroundRefresh()))
  for(;;){
   if(await bounded(()=>attachment(args))!==entry)throw error('等待初始化期间界面连接已变化')
   const state=await inOwner(page=>page.evaluate(()=>window.__dshBackgroundEngine.ownedState()))
   if(state?.actualInitializationError||state?.initializationFailed)throw error(state.actualInitializationError||'原插件初始化失败，原实例保留')
   if(state&&(state.chatId!==identity.chatId||state.sourceDigest!==identity.sourceDigest||state.lifecycleRevision!==identity.lifecycleRevision))throw error('等待初始化期间原插件身份已变化')
   if(state?.ready)return {...state,ownerId:entry.ownerId,capability:args.capability,composerEpoch:entry.composerEpoch,executionOwner:runtimeId}
   await bounded(()=>new Promise(resolve=>setTimeout(resolve,100)))
  }
 }
 async function emit(args){
  const entry=await attachment(args)
  if(typeof args.eventId!=='string'||!args.eventId||typeof args.name!=='string'||!Array.isArray(args.args))throw error('事件身份无效')
  const key=JSON.stringify([args.sessionId,entry.ownerId,args.eventId])
  const fingerprint=JSON.stringify([args.name,args.args,args.excludedScriptIds,args.onlyScriptIds])
  if(deliveries.has(key)){const old=deliveries.get(key);if(old.fingerprint!==fingerprint)throw error('事件编号被不同内容复用');return old.promise}
  const promise=executor.owned.emit(args.sessionId,args.name,args.args,{eventId:args.eventId,excludedScriptIds:args.excludedScriptIds,onlyScriptIds:['extension-sp-database'],general:true}).then(result=>{
   if(result.handled!==true)throw error(result.error||'原事件没有完成')
   return {completed:true,args:result.args,diagnostics:result.diagnostics||[]}
  })
  const delivery={promise,fingerprint,eventId:args.eventId,ownerId:entry.ownerId,runtimeId:entry.owner.runtimeId,args:structuredClone(args.args)};deliveries.set(key,delivery)
  void promise.catch(cause=>{delivery.error=String(cause?.message||cause)})
  // Retain both success and failure receipts for this live realm; failures are
  // not silently replayed. Eviction is only for old completed entries.
  void promise.finally(()=>{const row=deliveries.get(key);if(row)row.done=true;while(deliveries.size>128){const found=[...deliveries].find(([id,row])=>row.done&&id!==key);if(!found)break;deliveries.delete(found[0])}}).catch(()=>{})
  return promise
 }
 function confirmSaveFailureBoundary(sessionId,{eventId,ownerId,allOtherRecipientsComplete}={}){
  const row=deliveries.get(JSON.stringify([sessionId,ownerId,eventId]));
  if(!row||allOtherRecipientsComplete!==true||!row.error)return false;
  row.allOtherRecipientsComplete=true;return true;
 }
 function savedTaskEvent(sessionId,{eventId,runtimeId,recoveryError,args}={},{commit=false}={}){
  if(!eventId){if([...deliveries.values()].some(row=>row.runtimeId===runtimeId&&row.error&&!row.savedRecovery))throw error('已保存任务仍有未确认原事件');return {eventId:null};}
  const owner=owners.get(sessionId),row=deliveries.get(JSON.stringify([sessionId,owner?.id,eventId]));
  if(!row||row.runtimeId!==runtimeId||!row.done||!row.allOtherRecipientsComplete||typeof recoveryError!=='string'||!recoveryError||!row.error?.endsWith(recoveryError))throw error('已保存任务缺少同一事件及其他接收者完成证明');
  if(commit){row.promise=Promise.resolve({completed:true,args:Array.isArray(args)?structuredClone(args):row.args,diagnostics:[]});row.savedRecovery=true;}
  return {eventId,ownerId:owner.id};
 }
 async function command(args){
  const input=args.operation
  if(!input||!['database-command','ui','game-state','retry-save','composer-state','composer-intent'].includes(input.kind))throw error('原界面操作无效')
  if(input.kind==='composer-state'&&(!input.value||typeof input.value.draft!=='string'||!Number.isSafeInteger(input.value.revision)||input.value.revision<0||typeof input.value.attached!=='boolean'))throw error('输入框状态无效')
  if(input.kind==='composer-intent'&&(!input.value||typeof input.value!=='object'||Array.isArray(input.value)))throw error('输入框意图无效')
  const coldRead=input.kind==='database-command'&&input.operation?.kind==='zero-read'&&['snapshot','history'].includes(input.operation.method)
  const recoveryUi=input.kind==='ui'&&['recover','dialog','files','close'].includes(input.command?.operation)
  const retainedClose=input.kind==='ui'&&input.command?.operation==='close';
  const authenticated=await attachment(args,{starting:recoveryUi||input.kind==='retry-save'||input.kind==='game-state'||coldRead,retainedClose})
  if(input.kind==='ui'&&authenticated.composerEpoch!==authenticated.owner.composerEpoch)throw error('原确认界面连接已更换')
  if(input.kind==='ui'&&['recover','capture','dialog','files'].includes(input.command?.operation)&&authenticated.composerEpoch===authenticated.owner.composerEpoch)executor.owned.keepNativeDialogAlive?.(args.sessionId)
  if(input.kind==='composer-state'||input.kind==='composer-intent'){if(!Number.isSafeInteger(input.composerEpoch)||input.composerEpoch!==authenticated.composerEpoch||input.composerEpoch!==authenticated.owner.composerEpoch)throw error('输入框界面epoch已失效')}
  // The real zero-layer channel can request its read model before original
  // initialization completes. A canonical starting attachment permits only
  // this existing read command, never a mutation or a fabricated ready state.
  if(coldRead)return {completed:true,result:await executor.withOwnedInstance(args.sessionId,({page})=>page.evaluate(operation=>window.__dshBackgroundEngine.commandOwned(operation),input.operation))}
  if(input.kind==='game-state')return {completed:true,result:await executor.withOwnedInstance(args.sessionId,({page})=>page.evaluate(ready=>window.__dshBackgroundEngine.commandOwned({kind:'game-state',ready}),input.ready===true))}
  if(input.kind==='retry-save'){if(typeof retrySave!=='function')throw error('仅保存恢复入口不可用');if(authenticated.composerEpoch!==authenticated.owner.composerEpoch)throw error('保存恢复界面连接已更换');return {completed:true,result:await retrySave(args.sessionId,authenticated.owner.runtimeId)}}
  const commandRuntimeId=authenticated.owner.runtimeId;
  const authority=input.kind==='ui'?{initializingScope:()=>{caller(args,{retainedClose});if(attachments.get(args.capability)!==authenticated||owners.get(args.sessionId)!==authenticated.owner||authenticated.composerEpoch!==authenticated.owner.composerEpoch)throw error('原恢复界面连接已更换');if(authenticated.owner.initializationError)throw authenticated.owner.initializationError;return input.command?.operation==='recover'&&authenticated.owner.initializing===true?authenticated.identity:null;},authorizeUi:async()=>{
   const latest=await attachment(args,{starting:recoveryUi,retainedClose});
   const validate=()=>{caller(args,{retainedClose});if(latest!==authenticated||attachments.get(args.capability)!==latest||owners.get(args.sessionId)!==latest.owner||latest.composerEpoch!==latest.owner.composerEpoch||(input.command?.operation!=='recover'||commandRuntimeId!==null)&&latest.owner.runtimeId!==commandRuntimeId)throw error('原界面连接已更换，旧输入未执行');};
   validate();return validate;
  }}:undefined;
  const result=await executor.owned.command(args.sessionId,input,authority)
  return {completed:true,result}
 }
 async function ui(args){return (await command({...args,operation:{kind:'ui',command:args}})).result}
 async function surfaceRequest(sessionId,operation,lifecycleRevision){
  const identity=await scope(sessionId)
  if(identity.lifecycleRevision!==lifecycleRevision)throw error('实时页面剧情版本已变化')
  if(!frontendDispatch.availableFrontend(sessionId))throw error('该实时显示操作需要打开游戏页面；后台任务和结果仍保留')
  const interactive=operation?.kind==='composer'||operation?.kind==='slash',composerEpoch=operation?.kind==='composer'?owners.get(sessionId)?.composerEpoch:undefined;
  if(operation?.kind==='composer'){const expected=operation.operation?.expectedComposerEpoch;if(!Number.isSafeInteger(composerEpoch)||expected!==undefined&&expected!==composerEpoch||['write','send'].includes(operation.operation?.kind)&&expected!==composerEpoch)throw error('输入框操作epoch已失效')}
  const viewer=interactive?[...attachments.values()].find(entry=>entry.sessionId===sessionId&&isDeepStrictEqual(entry.identity,identity)&&frontendDispatch.available(sessionId,entry.runtimeId)&&now()-entry.seenAt<20000):null;if(interactive&&!viewer)throw error('前台尚未建立当前原插件连接')
  const id=randomUUID();let resolve,reject
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no})
  const row={id,sessionId,operation,lifecycleRevision,resolve,reject,identity,...(composerEpoch===undefined?{}:{composerEpoch}),delivered:false,createdAt:now(),...(viewer?{viewerRuntimeId:viewer.runtimeId}:{})};
  const rejectRow=message=>{if(surfaces.get(id)!==row)return;surfaces.delete(id);clearTimeout(row.timer);reject(error(message))};
  if(interactive){
   const check=async()=>{if(surfaces.get(id)!==row)return;try{if(!frontendDispatch.availableFrontend(sessionId)||row.viewerRuntimeId&&!frontendDispatch.available(sessionId,row.viewerRuntimeId)||!isDeepStrictEqual(await scope(sessionId),identity))return rejectRow('前台或剧情身份已失效；已执行操作不会自动重播');if(!row.delivered&&now()-row.createdAt>=30000)return rejectRow('前台尚未接收操作');if(surfaces.get(id)===row)row.timer=setTimeout(check,1000)}catch(cause){rejectRow(cause.message)}};
   row.timer=setTimeout(check,1000);
  }else row.timer=setTimeout(()=>rejectRow('实时页面未确认显示操作'),30000);
  surfaces.set(id,row);return promise
 }
 async function surfaceRequests(args){
  await attachment(args,{starting:true})
  const identity=await scope(args.sessionId),requests=[];
  for(const row of surfaces.values())if(row.sessionId===args.sessionId&&isDeepStrictEqual(row.identity,identity)){
   if(row.viewerRuntimeId&&row.viewerRuntimeId!==args.runtimeId)continue;if(row.composerEpoch!==undefined&&row.composerEpoch!==attachments.get(args.capability)?.composerEpoch)continue;
   row.delivered=true;if(row.operation?.kind==='composer'||row.operation?.kind==='slash')row.viewerRuntimeId=args.runtimeId;requests.push({id:row.id,operation:row.operation,lifecycleRevision:row.lifecycleRevision,...(row.composerEpoch===undefined?{}:{composerEpoch:row.composerEpoch})});
  }
  return {requests}
 }
 async function surfaceComplete(args){
  await attachment(args,{starting:true});const row=surfaces.get(args.id)
  if(!row||row.sessionId!==args.sessionId||row.viewerRuntimeId&&row.viewerRuntimeId!==args.runtimeId||!isDeepStrictEqual(row.identity,await scope(args.sessionId)))throw error('实时显示回执已失效')
  if(row.composerEpoch!==undefined&&(args.composerEpoch!==row.composerEpoch||row.composerEpoch!==owners.get(args.sessionId)?.composerEpoch))throw error('输入框回执epoch已失效')
  surfaces.delete(args.id);clearTimeout(row.timer);if(args.error)row.reject(error(String(args.error)));else row.resolve(row.composerEpoch!==undefined&&args.result&&typeof args.result==='object'?{...args.result,composerEpoch:row.composerEpoch}:args.result)
  return {completed:true}
 }
 function hasViewers(sessionId){return [...attachments.values()].some(row=>row.sessionId===sessionId&&frontendDispatch.available(sessionId,row.runtimeId)&&now()-row.seenAt<20000)}
 async function inspect(sessionId,{tables=true}={}){
  return executor.withOwnedInstance(sessionId,async({page,runtimeId,scope,hostAvailable,quarantined,drainError,errors})=>{
   const rows=[];for(const frame of page.frames()){const row=await frame.evaluate(includeTables=>{
    if(window.__dshOriginalExtensionState?.id!=='sp-database')return null
    const status={state:window.__dshOriginalExtensionState.phase,originalError:window.__dshOriginalExtensionState.error,retired:window.__dshOriginalExtensionState.retired===true,originalApi:typeof window.AutoCardUpdaterAPI?.__dshExecuteOwnedTask==='function',connected:typeof window.__dshOriginalDatabaseCommand==='function',ready:window.__dshOriginalExtensionState.ready===true,exportAvailable:typeof window.AutoCardUpdaterAPI?.exportTableAsJson==='function',originalChatId:window.SillyTavern?.getContext?.().getCurrentChatId?.()}
    if(includeTables===false)return status
    return {...status,tables:window.AutoCardUpdaterAPI?.exportTableAsJson?.(),originalPersisted:window.__dshOriginalDatabaseIsPersisted?.()===true,originalDiagnostics:window.__dshOriginalDatabasePersistenceDiagnostics?.(),pendingWork:window.AutoCardUpdaterAPI?.__dshPendingWork?.()}
   },tables!==false);if(row)rows.push(row)}
   if(rows.length===0)return {...scope,scope,scriptId:'extension-sp-database',ownerId:owners.get(sessionId)?.id,executionOwner:runtimeId,runtimeId,state:'waiting-original',ready:false,originalReady:false,originalFrameCount:0,hostAvailable,quarantined:quarantined===true,drainError:drainError||null,errors};
   if(rows.length>1)throw error('原包读取来源不唯一（多个原窗口）')
   const engine=tables===false?undefined:await page.evaluate(()=>window.__dshBackgroundEngine.ownedState())
   return {...scope,scope,scriptId:'extension-sp-database',ownerId:owners.get(sessionId)?.id,executionOwner:runtimeId,runtimeId,...rows[0],originalReady:rows[0].ready,hostAvailable,quarantined:quarantined===true,drainError:drainError||null,ready:hostAvailable===true&&quarantined!==true&&rows[0].ready===true,engine,errors,diagnostics:{originalPersisted:rows[0].originalPersisted,original:rows[0].originalDiagnostics,pendingWork:rows[0].pendingWork}}
  })
 }
 function retired(sessionId,runtimeId){const owner=owners.get(sessionId);if(owner?.runtimeId!==runtimeId)return;owners.delete(sessionId);for(const[key,row]of attachments)if(row.owner===owner)attachments.delete(key)}
 function dispose(){for(const row of surfaces.values()){clearTimeout(row.timer);row.reject(error('宿主已停止'))}surfaces.clear();attachments.clear();owners.clear();deliveries.clear()}
 return {prepare,attach,emit,command,ui,surfaceRequest,surfaceRequests,surfaceComplete,hasViewers,retired,inspect,confirmSaveFailureBoundary,savedTaskEvent,dispose}
}
