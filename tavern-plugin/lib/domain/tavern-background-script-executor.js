import {isMvuSettlementWork} from './tavern-script-dispatch.js'
import {prepareMvuStartupView} from './mvu-companion-plan.js'
import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {spAuthorityStamp} from './sp-authority.js'
import {createBackgroundContext,launchBackgroundBrowser,installBackgroundNetworkBoundary,backgroundFrameSources,createBackgroundBrowserOwner} from './background-browser.js'
import {readFile} from 'node:fs/promises'
import {readTavernRuntimeAsset} from './tavern-runtime-assets.js'
import {readTavernClientAsset} from './tavern-client-assets.js'
import {readOfficialMvuBundle,OFFICIAL_MVU_VERSION} from './official-mvu-assets.js'
import {readFullPromptTemplateAsset,FULL_PROMPT_TEMPLATE_ASSET_PREFIX} from './full-prompt-template-assets.js'
const origin='http://dsh-helper.localhost'
// Present in a visible page only (R8 Z61). The page skips the ones that cannot write;
// a refusal here names the method instead of a generic scope error.
const pageOnlyMethods=new Set(['tavernHelperComposer','triggerTavernSlash'])
const methods=new Set(['tavernSpWebRequest','setTavernMvuActivity','tavernHelperAudio','getSession','claimTavernScriptWork','startTavernScriptWork','completeTavernHelperEvent','heartbeatTavernScriptRuntime','releaseTavernHelperRuntime','reserveTavernHelperRuntime','quarantineTavernHelperRuntime','tavernHelperWorldbookLibrary','tavernScriptStorage','fillTavernScriptDatabase','getTavernScriptResource','editTavernRuntimeScripts','startTavernHelperGeneration','pollTavernHelperGeneration','stopTavernHelperGeneration','listTavernHelperModels','commitTavernScriptDatabase','tavernScriptFiles','tavernScriptImages','tavernHelperChatFiles','tavernHelperDatabaseTemplates','tavernHelperPresets','tavernHelperIzumiConnection','tavernHelperIzumiAdvice','getTavernScriptLibrary','changeTavernScriptLibrary','generateTavernHelperRaw','updateTavernHelperPrompts','updateTavernHelperVariables','updateTavernHelperMessages','createTavernHelperMessages','mutateTavernHelperHistory','getTavernHelperWorldbook','replaceTavernHelperWorldbook','saveTavernExtensionSettings','loadTavernWorldInfo','saveTavernWorldInfo','saveTavernChatData','recordMvuRuntimeDiagnostic','recordTavernCompatibilityCalls'])
/** Filter executable sources only; complete Helper context and permissions are retained. */
export function projectOwnedSpBackgroundView(view){
 if(!view)return view
 const scripts=(view.tavernHelperScripts||[]).filter(script=>script.id==='extension-sp-database')
 if(scripts.length!==1)throw new Error('SP 专用后台需要唯一原SP脚本')
 return {...view,tavernHelperScripts:scripts,tavernMvuRuntime:null,tavernSpOwnedRealm:true}
}
/** Start the same script/lease implementation only when no visible executor owns the game. */
for(const method of ['getSpDatabase','beginTavernSpAuthority','chooseTavernSpAuthority','publishTavernSpAuthorityCache','prepareTavernOriginalDatabaseMutation'])methods.add(method)
const generationMethods=new Set(['startTavernHelperGeneration','startTavernFrontendGeneration','startTavernFrontendMainGeneration'])
for(const method of [...generationMethods,'selectTavernFrontendWorldInfo','tavernHelperBrowserCache'])methods.add(method)
for(const method of ['prepareTavernSpOwner','inspectTavernSpOwner','attachTavernSpOwner','emitTavernSpOwner','commandTavernSpOwner','spOwnedUiTavern','getTavernSpSurfaceRequests','completeTavernSpSurfaceRequest'])methods.add(method)
export function createTavernBackgroundScriptExecutor({rpc,dispatch,view,assets,ownedSp=false,ownedUiFactory,networkPolicy=async()=>false,launch=launchBackgroundBrowser,timeoutMs=91000,idleMs=180000,maxInstances=3,maxRetained=3,retryCooldownMs=30000,onRetainedDiscarded,maxQueuedPerSession=16,monotonicNow=()=>performance.now()}) {
 // Opt-in instances receive a DIFFERENT dispatch/lease from the seven frontend scripts.
 const ownedMode=ownedSp!==false,ownedOptions=typeof ownedSp==='object'?ownedSp:{}
 const allowedMethods=new Set([...methods,...(ownedOptions.rpcMethods||[])])
 const projectView=value=>ownedMode?projectOwnedSpBackgroundView(value):prepareMvuStartupView(value)
 timeoutMs=Math.max(1,Math.min(91000,Number(timeoutMs)||91000))
 const instances=new Map(),admitted=new Set(),pending=new Map(),queues=new Map(),queued=new Map(),metrics=[],discarded=[],browserOwner=createBackgroundBrowserOwner(launch);let closed=false
 const persistenceMethods=new Set(['saveTavernChatData','saveTavernExtensionSettings','publishTavernSpAuthorityCache'])
 const saveRecoveryMethods=new Set([...persistenceMethods,'assertTavernSpOwnedTask','prepareTavernSpOwnedSaveRetry','checkpointTavernSpOwnedTask'])
 const liveInstances=()=>[...instances.values()].filter(row=>!row.closed)
 const retainedInstances=()=>liveInstances().filter(row=>row.quarantined||row.drainError||row.initializationBlocked)
 const retainedCapacityError=()=>new Error('SP/脚本初始化失败状态的保留容量已满，请先安全恢复已有实例后再启动新的游戏')
 // Initialization failure is not permission to dispose a non-SP realm: its
 // prefix may already have effects or unsaved local state. Keep it bounded and
 // report not-ready; only a verified recovery can resume queued settlement.
 function preserveInitialization(instance,error,{cancel=false}={}){
  if(!instance||instance.closed||instance.crashed)return;
  instance.initializationObservation=(instance.initializationObservation||0)+1;
  instance.initializationBlocked=true;instance.retainedAt ||= monotonicNow();
  instance.initializationBlockReason=String(error?.message||error||'脚本初始化未完成，变量结算已暂停');
  clearTimeout(instance.timer);
  if(cancel&&!instance.initializationCancelled){
   instance.initializationCancelled=true;
   void Promise.allSettled([...instance.generations.values()].map(args=>Promise.resolve().then(()=>rpc('stopTavernHelperGeneration',args))));
   void instance.page?.evaluate(message=>window.__dshBackgroundEngine?.cancelInitialization(message),instance.initializationBlockReason).catch(error=>instance.errors.push(error.message));
  }
 }
 async function initializationState(instance){
  const value=await instance.page.evaluate(()=>{
   const runtime=window.__dshBackgroundEngine.inspect().runtime;
   return {ready:window.__dshHelper.tavernScriptRuntimeReady(runtime),generalReady:window.__dshHelper.tavernScriptGeneralReady?.(runtime)===true,blocked:runtime?.initializationBlocked===true,
    reason:runtime?.initializationBlockReason||'',error:runtime?.initializationError||'',canRetry:runtime?.mvuLoadState?.canRetry===true};
  });
  if(!value||typeof value!=='object')throw new Error('脚本初始化状态不可用，未确认验证器就绪');
  return value;
 }
 async function checkInitialization(instance,{retry=false}={}){
  const observation=instance.initializationObservation||0;
  let state=await initializationState(instance);
  if((instance.initializationObservation||0)!==observation)return instance;
  instance.generalReady=state.ready===true&&!state.error;instance.ordinaryReady=state.generalReady===true;
  if(state.ready===true&&!state.error&&!state.blocked&&!instance.initializationCancelled){instance.initializationBlocked=false;delete instance.initializationBlockReason;return instance;}
  if(retry&&state.canRetry&&!instance.initializationCancelled&&monotonicNow()>=(instance.initializationRetryAfter||0)){
   instance.initializationRetryAfter=monotonicNow()+retryCooldownMs;
   await instance.page.evaluate(()=>window.__dshBackgroundEngine.retryMvuLoad());
   state=await initializationState(instance);
   if((instance.initializationObservation||0)!==observation)return instance;
   instance.generalReady=state.ready===true&&!state.error;instance.ordinaryReady=state.generalReady===true;
   if(state.ready===true&&!state.error&&!state.blocked&&!instance.initializationCancelled){instance.initializationBlocked=false;delete instance.initializationBlockReason;return instance;}
  }
  preserveInitialization(instance,state.error||state.reason);
  if(state.error)throw new Error(state.error);
  return instance;
 }
 function refreshInitialization(instance,options){
  if(instance.initializationRefresh)return instance.initializationRefresh.result;
  const task=checkInitialization(instance,options);let timer;
  const result=Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{
   const error=new Error('脚本初始化检查超时，原实例已保留；未重放初始化');preserveInitialization(instance,error,{cancel:true});reject(error);
  },timeoutMs)})]).finally(()=>clearTimeout(timer));
  const attempt={task,result};instance.initializationRefresh=attempt;
  void task.finally(()=>{if(instance.initializationRefresh===attempt)delete instance.initializationRefresh}).catch(()=>{});
  return result;
 }
 function quarantineOne(instance,error){
  if(!instance||instance.closed)return
  if(instance.quarantined){instance.quarantineRevision=(instance.quarantineRevision||0)+1;instance.errors.push(String(error?.message||error));return}
  instance.quarantineRevision=(instance.quarantineRevision||0)+1
  instance.quarantined=true;instance.retainedAt=monotonicNow();instance.drainError=String(error?.message||error||'SP 执行已隔离');instance.errors.push(instance.drainError)
  clearTimeout(instance.timer);instance.unsubscribe?.();instance.unsubscribe=null
  if(instance.runtimeId)dispatch.quarantine?.(instance.sessionId,instance.runtimeId,instance.drainError)
  // Preserve the only original realm. Neither a stuck page nor generation stop
  // may extend the original operation deadline.
  void Promise.allSettled([...instance.generations.values()].map(args=>Promise.resolve().then(()=>rpc('stopTavernHelperGeneration',args))))
  instance.quarantinePromise=Promise.resolve().then(()=>instance.page?.evaluate(error=>window.__dshBackgroundEngine?.quarantine(error),instance.drainError)).catch(error=>{instance.errors.push(error.message)})
  // Capacity never destroys an unsaved realm. maxRetained is an admission
  // threshold: already admitted originals may all fail concurrently. start()
  // bounds live realms (including startup reservations) by maxInstances +
  // maxRetained and refuses new originals once the retained threshold is full.
 }
 // A retained realm that can no longer be saved is released; what was lost stays
 // on record. Its identity is fenced first, so nothing is written afterwards.
 function discardRetained(instance,reason){
  if(!instance||instance.closed)return
  const detail={sessionId:instance.sessionId,runtimeId:instance.runtimeId,error:instance.drainError||instance.initializationBlockReason||'',reason,at:Date.now()}
  discarded.push(detail);if(discarded.length>20)discarded.shift()
  try{onRetainedDiscarded?.(instance.sessionId,detail)}catch{}
  delete instance.recoveryToken
  return disposeOne(instance)
 }
 // One bounded automatic save per cooldown. Only DSH_SP_DRAIN is sent: neither
 // the failed event nor any model request is replayed.
 async function recoverRetained(instance,{preserveUnsaved=false}={}){
  if(!instance||instance.closed)return true
  if(instance.initializationBlocked)return false
  if(instance.recoveryAttempt){await instance.recoveryAttempt.catch(()=>{});return instance.closed===true}
  if(monotonicNow()<(instance.retryAfter||0))return false
  instance.retryAfter=monotonicNow()+retryCooldownMs
  await retryDrain(instance.sessionId,{preserveUnsaved})
  return instance.closed===true
 }
 async function recoverRetainedCapacity(cancelled){
  for(const instance of retainedInstances().sort((a,b)=>a.retainedAt-b.retainedAt)){
   if(closed||cancelled())throw new Error('后台脚本启动已取消')
   if(instance.initializationBlocked)continue
   // A stuck recovery must not hold admission indefinitely or overlap a save.
   if(!instance.recoveryAttempt)await recoverRetained(instance,{preserveUnsaved:true})
   if(retainedInstances().length<maxRetained)return
  }
  throw retainedCapacityError()
 }
 // A timeout or cancellation leaves the original mid-operation: that realm is
 // retained untouched. Any other failure (listener error, rejected validation,
 // initialization error) lets the original save and release normally; only a
 // save that fails retains the realm (see the drain branch of disposeOne).
 function failOne(instance,error,{retain=false}={}){
  if(!instance||instance.closed)return
  if(ownedMode&&instance.hasOriginal&&instance.page){quarantineOne(instance,error);return}
  if(instance.hasMvu&&instance.engineStarted&&!instance.crashed&&(instance.starting||instance.initializationBlocked||retain)){preserveInitialization(instance,error,{cancel:retain});return}
  if(instance.hasOriginal&&instance.page){
   if(retain||instance.quarantined)quarantineOne(instance,error)
   else void Promise.resolve(disposeOne(instance,{drain:true})).catch(()=>{})
  }else void Promise.resolve(disposeOne(instance)).catch(()=>{})
 }
 function disposeOne(instance,{drain=false}={}){
  if(!instance)return;if(drain&&instance.drainError)return {released:false,drainError:instance.drainError};
  if(instance.closePromise){
   // A crash may race an already pending drain. Fence immediately while that
   // original teardown keeps ownership of context/lease and admission capacity.
   if(instance.crashed&&!instance.closed){
    instance.closed=true;clearTimeout(instance.timer);instance.unsubscribe?.();instance.unsubscribe=null
    if(instances.get(instance.sessionId)===instance)instances.delete(instance.sessionId)
    if(instance.runtimeId)dispatch.dispose(instance.sessionId,instance.runtimeId)
   }
   return instance.closePromise
  }
  clearTimeout(instance.timer);instance.unsubscribe?.()
  if(!drain)instance.closed=true
  return instance.closePromise=(async()=>{
   if(drain&&instance.page){let timer;try{const result=await Promise.race([instance.page.evaluate(()=>window.__dshBackgroundEngine?.dispose()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SP 原包结束前 drain 超时；实例与未保存状态已保留')),timeoutMs)})]);if(result?.released===false){instance.hasOriginal=true;throw new Error(result.drainError||'SP 原包尚未保存');}}catch(error){
    // Only an original realm that still exists can hold something worth retaining.
    if(instance.hasOriginal&&!instance.crashed){quarantineOne(instance,error);instance.closePromise=null;return {released:false,drainError:error.message}}
    instance.errors.push(String(error?.message||error))
   }finally{clearTimeout(timer)}}
   instance.closed=true;if(instances.get(instance.sessionId)===instance)instances.delete(instance.sessionId)
   try{
    if(instance.runtimeId)dispatch.dispose(instance.sessionId,instance.runtimeId)
    await Promise.allSettled([...instance.generations.values()].map(args=>Promise.resolve().then(()=>rpc('stopTavernHelperGeneration',args))))
    if(instance.ownedUi)try{await instance.ownedUi.dispose()}catch(error){instance.errors.push(String(error.message||error))}
    let contextClosed=!instance.context
    if(instance.context)try{await instance.context.close();contextClosed=true}catch(error){instance.errors.push(String(error.message||error));if(ownedMode)throw error}
    try{if(ownedMode&&contextClosed&&!instance.ownedRetirementNotified){await ownedOptions.onRetired?.(instance.sessionId,{runtimeId:instance.runtimeId});instance.ownedRetirementNotified=true}}finally{await instance.browserLease?.release()}
    if(ownedMode)return {released:true}
   }finally{
    instance.disposed=true
    // A cancelled startup may still be acquiring its context. Hold capacity
    // until both startup and teardown settle, even after the map entry is gone.
    if(!instance.starting)admitted.delete(instance)
   }
  })()
 }
 // Every automatic retirement checks the live realm, not only the boolean
 // cached at initial boot. New guards can fail after a view refresh/heartbeat.
 async function retireIdle(instance){
  if(!instance||instance.closed||instance.busy||instance.generations.size||instance.ownedCommands)return {released:false};
  if(ownedMode){
   if(instance.ownedUiPromise)await instance.ownedUiPromise
   if(instance.ownedUi?.isBusy?.()===true)return {released:false,ownedSp:true,reason:'original browser interaction pending'}
   if(typeof ownedOptions.canRetire!=='function')return {released:false,ownedSp:true,reason:'retirement policy unavailable'}
   const state=await instance.page.evaluate(()=>window.__dshBackgroundEngine?.ownedState?.())
   const originals=[];for(const frame of instance.page.frames()){const value=await frame.evaluate(()=>window.__dshOriginalExtensionState?.id==='sp-database'?window.AutoCardUpdaterAPI?.__dshIsPersistenceIdle?.()===true:null);if(value!==null)originals.push(value)}
   if(instance.ownedUi?.isBusy?.()===true)return {released:false,ownedSp:true}
   if(!state||originals.length!==1||originals[0]!==true||instance.ownedCommands||!await ownedOptions.canRetire(instance.sessionId,{runtimeId:instance.runtimeId,state,originalIdle:true}))return {released:false,ownedSp:true}
  }
  if(!instance||instance.closed||instance.busy||instance.generations.size||instance.ownedCommands)return {released:false};
  if(instance.hasMvu&&instance.engineStarted&&!instance.crashed){
   try{await refreshInitialization(instance)}catch(error){preserveInitialization(instance,error);return {released:false};}
  }
  if(instance.busy||instance.initializationBlocked)return {released:false};
  return disposeOne(instance,{drain:true});
 }
 function armIdle(instance){if(!instance||instance.closed||instance.quarantined||instance.initializationBlocked)return;clearTimeout(instance.timer);instance.lastUsed=Date.now();instance.timer=setTimeout(()=>{if(!instance.busy)void retireIdle(instance).then(result=>{if(ownedMode&&result?.released===false)armIdle(instance)}).catch(error=>{instance.errors.push(String(error.message||error));if(ownedMode)armIdle(instance)})},idleMs);instance.timer.unref?.()}
 async function start(sessionId,cancelled=()=>false){
  if(closed)throw new Error('脚本后台执行器已停止')
  // A startup reservation is not a ready realm. Join its promise before looking
  // up instances so a concurrent ensure/execute cannot use it half initialized.
  if(pending.has(sessionId))return pending.get(sessionId)
  const existing=instances.get(sessionId)
  if(existing?.initializationBlocked&&!existing.closed)return refreshInitialization(existing,{retry:true})
  if(existing?.drainError){
   if(ownedMode)throw new Error(existing.drainError||'SP 专用后台保存待显式重试，原窗口保留')
   // A visible page that owns the game has already fenced the retained realm's
   // identity: it can never write again, so it must not fail this game's events.
   if(!ownedMode&&dispatch.availableFrontend?.(sessionId)){await discardRetained(existing,'前台页面已接管本局，后台未保存的 SP 实例已放弃');return null}
   if(!await recoverRetained(existing))throw new Error(existing.drainError||'SP 原包尚未保存')
   return start(sessionId,cancelled)
  }
  if(existing?.closePromise){await existing.closePromise;return start(sessionId,cancelled)}if(existing&&!existing.closed){clearTimeout(existing.timer);return existing.hasMvu?refreshInitialization(existing):existing}
  if(dispatch.available(sessionId))return null
  const task=(async()=>{
   const initial=projectView(await view(sessionId));if(cancelled())throw new Error('后台脚本启动已取消');if(!initial)throw new Error('当前游戏不存在')
   const hasOriginal=initial.tavernHelperScripts?.some(script=>script.id==='extension-sp-database')
   const hasMvu=['official','card'].includes(initial.tavernMvuRuntime?.owner)||initial.tavernHelperScripts?.some(script=>['official-mvu','card-mvu'].includes(script.system))
   const working=()=>liveInstances().filter(row=>!row.quarantined&&!row.drainError&&!row.initializationBlocked)
   for(;;){
    if(closed||cancelled())throw new Error('后台脚本启动已取消')
    if(!ownedMode&&dispatch.availableFrontend?.(sessionId))return null
    if((hasOriginal||hasMvu)&&retainedInstances().length>=maxRetained){if(ownedMode)throw retainedCapacityError();await recoverRetainedCapacity(cancelled);continue}
    if(working().length<maxInstances&&admitted.size<maxInstances+maxRetained)break
    const idle=working().filter(row=>!row.busy).sort((a,b)=>a.lastUsed-b.lastUsed)[0]
    if(!idle)throw new Error('后台脚本执行器正忙')
    const retired=await retireIdle(idle)
    if(ownedMode&&!idle.closed)throw new Error('SP 专用后台容量已满；活动查看者、任务或交互阻止回收')
    // Failed retirement can fill retained capacity; recheck after every await.
   }
   // No await between the checks and insertion: concurrent views/startups must
   // see this working-slot reservation before acquiring a browser context.
   const instance={sessionId,hasOriginal,hasMvu,startupTask:task,starting:true,ownedLeaseRegistered:false,closed:false,busy:true,lastUsed:Date.now(),runtimeId:'',errors:[],generations:new Map()};instances.set(sessionId,instance);admitted.add(instance)
   let yieldStartup;const frontendAcquired=new Promise(resolve=>{yieldStartup=()=>resolve('foreground')})
   try{
    if(ownedMode){if(typeof ownedOptions.scope!=='function')throw new Error('SP 专用后台缺少canonical scope提供者');instance.ownedScope=await ownedOptions.scope(sessionId)}
    instance.browserLease=browserOwner.acquire(()=>{void disposeOne(instance)})
    const browser=await instance.browserLease.browser.catch(error=>{throw new Error('无法启动脚本后台浏览器：'+error.message)});if(instance.closed||instance.quarantined||closed||cancelled())throw new Error('后台脚本启动已取消')
    instance.browser=browser
    const context=instance.context=await createBackgroundContext(browser,{viewport:{width:1280,height:900},serviceWorkers:'block'});if(instance.closed||instance.quarantined||closed||cancelled()){await context.close();throw new Error('后台脚本启动已取消')}
    await installBackgroundNetworkBoundary(context,{origin,authorize:async request=>{
     if(instance.closed||instance.quarantined)return false
     const sources=await backgroundFrameSources(instance.page,request.frame)
     if(instance.closed||instance.quarantined)return false
     const permit=await networkPolicy(sessionId,sources,request.kind)
     return !instance.closed&&!instance.quarantined&&permit===true
    }})
    const client=await readFile(new URL('../client.js',import.meta.url),'utf8')
    await context.route(origin+'/**',async route=>{
     try {const request=route.request(),url=new URL(request.url()),path=url.pathname,headers=await request.allHeaders(),resourceType=request.resourceType(),isNavigationRequest=request.isNavigationRequest();let file
      // Private assets are read capabilities, never an alternate document or
      // write channel. Browser request metadata is independent of caller headers.
      if(instance.closed||instance.quarantined){await route.fulfill({status:403,body:'Retained runtime resources are quarantined'});return}
      const engineDocument=path==='/'&&isNavigationRequest&&request.frame()===instance.page?.mainFrame()
      if(request.method()!=='GET'||!engineDocument&&(isNavigationRequest||['document','iframe','frame','object','embed'].includes(resourceType)||headers['sec-fetch-mode']==='navigate'||['document','iframe','frame','object','embed'].includes(headers['sec-fetch-dest']))){await route.fulfill({status:403,body:'Helper resources are read-only and cannot be navigated',headers:{'x-content-type-options':'nosniff'}});return}
      if(path==='/'){if(!engineDocument){await route.fulfill({status:403,body:'Helper document is private'});return}await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><meta charset="utf-8"><title>DSH 脚本后台</title><link rel="icon" href="data:,"><body><script>window.__dshTavernBackground=true;window.__dshTavernOwnedSp='+JSON.stringify(ownedMode)+';window.__ModuleLoader__={load:d=>{window.__dshHelper=d.factory(()=>({}))}}</script><script src="/client.js"></script></body></html>'});return}
      if(path==='/client.js')file={body:client,mediaType:'application/javascript'}
      else if(path===OFFICIAL_MVU_VERSION.assetUrl)file=await readOfficialMvuBundle()
      else if(path.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX))file=await readFullPromptTemplateAsset(path)
      else file=await readTavernRuntimeAsset(path)||await readTavernClientAsset(path)||await assets?.(path,sessionId,url,{method:request.method(),headers,sources:await backgroundFrameSources(instance.page,request.frame()),resourceType,isNavigationRequest})
      await route.fulfill(file?{status:200,contentType:file.mediaType,body:file.body,headers:{...file.headers,'access-control-allow-origin':'*','x-content-type-options':'nosniff'}}:{status:404,body:'Unknown helper resource'})
     }catch {await route.fulfill({status:404,body:'Helper resource unavailable'}).catch(()=>{})}
    })
    const page=instance.page=await context.newPage();page.on('pageerror',error=>{instance.errors.push(error.stack||error.message);if(instance.errors.length>30)instance.errors.shift()})
    if(ownedMode){
     if(typeof ownedUiFactory!=='function')throw new Error('SP 原UI浏览器桥未接入')
     // Playwright auto-dismisses dialogs without a listener. Install the private
     // retained bridge before navigation or any original script can open one.
     instance.ownedUiPromise=Promise.resolve(ownedUiFactory({page,sessionId,runtimeId:()=>instance.runtimeId})).then(ui=>instance.ownedUi=ui)
     await instance.ownedUiPromise
    }
    // A crashed renderer no longer holds the original realm: nothing is left to save.
    page.on('crash',()=>{
     if(instance.closed||instance.crashed)return
     instance.crashed=true;instance.errors.push('后台脚本页面已崩溃')
     // Crash destroys a working realm too, not only one already quarantined.
     // Fence its lease now; an executing event is failed, never replayed. Keeping
     // the dead page until its deadline would falsely retain unsaved capacity.
     void Promise.resolve(instance.hasOriginal?discardRetained(instance,'后台脚本页面已崩溃，未保存的 SP 实例已放弃'):disposeOne(instance)).catch(()=>{})
    })
    await page.exposeBinding('__dshHelperRpc',async({frame},method,args={})=>{
     if(frame!==page.mainFrame())throw new Error('脚本子页面不能直接调用宿主桥接')
     if(instance.closed)throw new Error('脚本执行器已结束');if(!allowedMethods.has(method)&&pageOnlyMethods.has(method))throw new Error('后台实例不提供「'+method+'」：它只能在打开的游戏页面里使用');if(!allowedMethods.has(method)||args.sessionId!==sessionId)throw new Error('脚本后台操作超出当前游戏范围')
     if(ownedMode&&args.scriptId&&args.scriptId!=='extension-sp-database')throw new Error('SP 专用后台不能调用其他脚本身份');
     if(ownedMode&&args.scriptScope==='frame'){const currentScope=await ownedOptions.scope(sessionId);if(!isDeepStrictEqual(currentScope,instance.ownedScope)||args.expectedLifecycleRevision!==undefined&&args.expectedLifecycleRevision!==currentScope.lifecycleRevision)throw new Error('SP 专用后台原包、卡片或剧情身份已变化')}

     if(['claimTavernScriptWork','heartbeatTavernScriptRuntime'].includes(method)){if(!String(args.runtimeId).startsWith('background:')||ownedMode&&instance.runtimeId&&instance.runtimeId!==args.runtimeId)throw new Error('后台执行身份无效');instance.runtimeId=args.runtimeId}
     if(instance.quarantined){
      const control=['heartbeatTavernScriptRuntime','reserveTavernHelperRuntime','quarantineTavernHelperRuntime','releaseTavernHelperRuntime'].includes(method)
      const ownedRecovery=instance.ownedSaveRecovery;
      const ownedSave=ownedRecovery&&monotonicNow()<ownedRecovery.deadline&&args.spRecoveryToken===ownedRecovery.token&&args.scriptId==='extension-sp-database'&&saveRecoveryMethods.has(method)&&(!args.payload?.taskId||args.payload.taskId===ownedRecovery.taskId)&&(!(method==='checkpointTavernSpOwnedTask')||['completed','failed'].includes(args.payload?.phase));
      const recovery=ownedSave||instance.recoveryToken&&monotonicNow()<instance.recoveryDeadline&&args.spRecoveryToken===instance.recoveryToken&&args.scriptId==='extension-sp-database'&&persistenceMethods.has(method)
      if(!control&&!recovery)throw new Error('SP 执行已隔离，仅允许当前显式保存重试')
      if(method==='reserveTavernHelperRuntime'&&!(instance.recoveryToken&&args.recoveryToken===instance.recoveryToken&&monotonicNow()<instance.recoveryDeadline))throw new Error('SP 保存重试窗口已失效')
     }
     const registrationOrigin=ownedMode&&method==='registerTavernSpOwnedTask'?dispatch.executingEvent?.(sessionId,instance.runtimeId,args.apiCallOrigin?.eventId):null;
     let result
     try{result=await rpc(method,args)}catch(error){if(method==='pollTavernHelperGeneration'){instance.generations.delete(args.id);if(!instance.busy)armIdle(instance)}throw error}
     if(ownedMode&&['claimTavernScriptWork','heartbeatTavernScriptRuntime'].includes(method)&&result?.active===true)instance.ownedLeaseRegistered=true;
     if(registrationOrigin&&result?.taskId){if(!instance.ownedTaskOrigins)instance.ownedTaskOrigins=new Map();instance.ownedTaskOrigins.set(result.taskId,registrationOrigin);}
     if(method==='getSession'&&result?.view)result={...result,view:projectView(result.view)}
     if(method==='getSession'&&(['official','card'].includes(result?.view?.tavernMvuRuntime?.owner)||result?.view?.tavernHelperScripts?.some(script=>['official-mvu','card-mvu'].includes(script.system)))){
      if(!instance.hasMvu&&retainedInstances().length>=maxRetained)throw retainedCapacityError();
      instance.hasMvu=true;
     }
     if(method==='getSession'&&result?.view?.tavernHelperScripts?.some(script=>script.id==='extension-sp-database')){
      // A previously non-SP realm can discover SP on refresh. Refuse before
      // returning its view to engine.sync, which could create the new original.
      if(!instance.hasOriginal&&retainedInstances().length>=maxRetained)throw retainedCapacityError()
      instance.hasOriginal=true
     }
     if(ownedMode&&['claimTavernScriptWork','heartbeatTavernScriptRuntime'].includes(method)&&result?.active===true&&!instance.ownedOwnerBound){await ownedOptions.onOwner?.(sessionId,{runtimeId:instance.runtimeId});instance.ownedOwnerBound=true}
     if(['claimTavernScriptWork','heartbeatTavernScriptRuntime'].includes(method)&&result?.active===true&&args.mvuValidation?.blocked===true){
      // Only the acknowledged owner can add this retention state. A later
      // heartbeat does not clear it without checking the current realm.
      preserveInitialization(instance,args.mvuValidation.reason);
     }
     if(!ownedMode&&['claimTavernScriptWork','heartbeatTavernScriptRuntime'].includes(method)&&result?.active===false&&dispatch.availableFrontend?.(sessionId))yieldStartup()
     if(generationMethods.has(method)&&result?.id){
      const stop={sessionId,scriptId:args.scriptId,expectedLifecycleRevision:args.expectedLifecycleRevision,id:result.id}
      instance.generations.set(result.id,stop)
      if(instance.closed||instance.quarantined)void Promise.resolve(rpc('stopTavernHelperGeneration',stop)).catch(()=>{})
     }
     if(method==='pollTavernHelperGeneration'&&result?.status!=='running'){instance.generations.delete(args.id);if(!instance.busy)armIdle(instance)}
     if(instance.closed)throw new Error('脚本执行器已结束')
     return result
    })
    await page.goto(origin,{waitUntil:'load',timeout:timeoutMs})
    if(instance.closed||instance.quarantined||cancelled())throw new Error('后台脚本启动已取消')
    instance.engineStarted=true;
    await page.evaluate(async({sessionId,initial,ownedMode})=>{
     const ui=window.__dshHelper,id=crypto.randomUUID?.bind(crypto)||(()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));Object.defineProperty(crypto,'randomUUID',{value:()=> 'background:'+id(),configurable:true})
     // Match the existing foreground HTTP JSON wire contract before Playwright can preserve undefined.
     const invoke=(method,args,_sessionId)=>window.__dshHelperRpc(method,ownedMode?JSON.parse(JSON.stringify({...args,sessionId})):{...args,sessionId})
     let syncing=null,refreshRequested=false
     const update=expectedContextRevision=>{if(typeof expectedContextRevision==='string'&&expectedContextRevision&&!refreshRequested&&!syncing&&engine.ownedState?.()?.contextRevision===expectedContextRevision)return Promise.resolve();refreshRequested=true;return syncing ||= (async()=>{do{refreshRequested=false;const {view}=await invoke('getSession',{});engine.sync(sessionId,view);}while(refreshRequested)})().finally(()=>{syncing=null})}
     const listeners=new Map()
     window.__dshBackgroundSignal=signal=>{for(const receive of [...(listeners.get(signal.kind)||[])])receive(signal)}
     const engine=window.__dshBackgroundEngine=ui.createTavernScriptExecutionModule({window,background:true,ownedSp:ownedMode,rpc:invoke,invalidate:()=>{void update().catch(console.error)},signals:{subscribe(_id,kind,receive){let set=listeners.get(kind);if(!set){set=new Set();listeners.set(kind,set)}set.add(receive);return()=>{set.delete(receive);if(!set.size)listeners.delete(kind)}}},heartbeatIntervalMs:1000})
     engine.sync(sessionId,initial);window.__dshBackgroundRefresh=update
    },{sessionId,initial,ownedMode})
    instance.unsubscribe=dispatch.subscribeWork?.(sessionId,signal=>{if(!instance.closed)void page.evaluate(signal=>window.__dshBackgroundSignal?.(signal),signal).catch(error=>{if(!instance.closed){instance.errors.push(error.message);if(instance.errors.length>30)instance.errors.shift()}})})
    const readiness=await Promise.race([frontendAcquired,page.waitForFunction(()=>{const state=window.__dshBackgroundEngine?.inspect();return state?.active&&window.__dshHelper.tavernScriptRuntimeReady(state.runtime)||Boolean(state?.runtime?.initializationError||state?.runtime?.initializationBlocked||state?.runtime?.mvuLoadState?.canRetry)},{},{timeout:timeoutMs}).then(async handle=>{await handle.dispose();return 'ready'})])
    if(readiness==='foreground'||!ownedMode&&dispatch.availableFrontend?.(sessionId)){await disposeOne(instance);return null}
    if(instance.hasMvu){await refreshInitialization(instance);instance.busy=false;if(instance.initializationBlocked)return instance;}
    else {const initializationError=await page.evaluate(()=>window.__dshBackgroundEngine.inspect().runtime?.initializationError||'');if(initializationError)throw new Error(initializationError)}
    instance.busy=false;armIdle(instance);return instance
   }catch(error){failOne(instance,error);throw error}
   finally{instance.starting=false;if(instance.disposed)admitted.delete(instance)}
  })();pending.set(sessionId,task);try{return await task}finally{if(pending.get(sessionId)===task)pending.delete(sessionId)}
 }
 async function executeNow(input){
  const sessionId=input.sessionId,started=Date.now(),budgetStarted=monotonicNow();let instance,timer,abort,stopped=false,dispatched=false
  // R8 1.5: an ordinary lifecycle event that never reached a script before the
  // deadline is skipped, not failed: nothing ran, so there is nothing to isolate.
  const general=input.work?.general===true&&!isMvuSettlementWork(input.work)
  const skipped=error=>({handled:false,unavailable:true,skipped:true,phase:'queued',error,args:input.args||[]})
  const timeout=new Promise((resolve,reject)=>{abort=()=>{stopped=true;failOne(instance||instances.get(sessionId),input.signal?.reason||new Error('脚本后台操作已取消'),{retain:true});reject(input.signal?.reason||new Error('脚本后台操作已取消'))};input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted)abort();timer=setTimeout(()=>{stopped=true;if(general&&!dispatched){resolve(skipped('脚本运行时在时限内没有就绪，本次事件未执行'));return}const message='脚本执行超时（'+(timeoutMs>=1000?Math.round(timeoutMs/1000)+' 秒':timeoutMs+' 毫秒')+'内没有完成），本轮已停止；这个脚本窗口已隔离保留。为避免重复执行脚本的效果，不会自动重试，可以直接重新发送。';failOne(instance||instances.get(sessionId),new Error(message),{retain:true});reject(new Error(message))},timeoutMs)})
  try{return await Promise.race([timeout,(async()=>{
   for(;;){
    input.signal?.throwIfAborted();if(stopped)throw new Error('后台脚本已取消')
    try{instance=await start(sessionId,()=>stopped)}
    catch(error){if(!general||stopped)throw error;return skipped(String(error?.message||error))}
    if(stopped){failOne(instance,new Error('后台脚本已取消'));throw new Error('后台脚本已取消')}
    const blocked=()=>instance.initializationBlocked&&(!(general?instance.ordinaryReady:instance.generalReady)||isMvuSettlementWork(input.work))
    if(instance&&blocked())return {handled:false,unavailable:true,mvuValidationBlocked:true,initializationBlocked:true,error:instance.initializationBlockReason,args:input.args||[]};
    if(instance){
     instance.busy=true;await instance.page.evaluate(()=>window.__dshBackgroundRefresh());
     if(instance.hasMvu)await refreshInitialization(instance);
     if(blocked())return {handled:false,unavailable:true,mvuValidationBlocked:true,initializationBlocked:true,error:instance.initializationBlockReason,args:input.args||[]};
    }
    while(!dispatch.available(sessionId,'',general?'general':true)&&dispatch.available(sessionId)){
     input.signal?.throwIfAborted();if(stopped)throw new Error('后台脚本已取消')
     await new Promise(resolve=>setTimeout(resolve,40))
    }
    const context=typeof input.context==='function'?await input.context():input.context
    input.signal?.throwIfAborted();if(stopped)throw new Error('后台脚本已取消')
    dispatched=true
    const result=await dispatch.dispatch(sessionId,input.name,input.args,context,{...input.work,executionTimeoutMs:Math.max(1,timeoutMs-(monotonicNow()-budgetStarted))})
    // Regeneration changes the script lifecycle. A frontend may release its
    // lease after readiness was checked (or after an offer, before start).
    // Only re-acquire events which provably never entered execution. An error,
    // timeout or disposal while executing must never replay script side effects.
    if(result.mvuValidationBlocked){preserveInitialization(instance,result.error);return result;}
    // A cached owner can lack the required contract after readiness was checked.
    // The dispatch gate proves this work never started; preserve that receipt so
    // the durable journal can wait for a real capability transition. Re-acquiring
    // the same owner until timeout would turn safe pending work into failed work.
    if(result.handled===false&&result.unavailable===true&&result.unsupportedRuntimeContract===true&&(!result.phase||['queued','offered'].includes(result.phase)))return result;
    // Preserve the Host's explicit pre-dispatch proof for the durable journal's
    // existing drain waiter. Throwing here would turn unexecuted busy work into
    // an execution-unknown failure; this executor must neither replay nor skip it.
    if(result.handled===false&&result.busy===true&&result.notExecuted===true&&result.phase==='queued')return result;
    if(!result.handled&&(result.unavailable||result.disposed)&&(!result.phase||['queued','offered'].includes(result.phase))){
     dispatched=false
     await disposeOne(instance);instance=undefined
     await new Promise(resolve=>setTimeout(resolve,40));continue
    }
    if(!result.handled){
     // After a dispatch timeout the event may still be running in the page.
     if(input.returnFailure){if(ownedMode)instance.failedOwnedEvent={eventId:input.work?.eventId,error:result.error,phase:result.phase,args:result.args,diagnostics:result.diagnostics};failOne(instance,new Error(result.error||'脚本事件执行失败'),{retain:result.timedOut===true});return result}
     throw Object.assign(new Error(result.error||(result.timedOut?'脚本事件执行超时':'脚本没有可用的事件执行者，请重新打开游戏')),{retainOriginal:result.timedOut===true})
    }
    // Script saves can invalidate during an in-flight refresh. Synchronize the
    // current committed snapshot before returning or reusing the instance.
    if(instance&&!instance.closed){await instance.page.evaluate(()=>window.__dshBackgroundRefresh());if(instance.hasMvu)await refreshInitialization(instance);}
    metrics.push({at:Date.now(),name:input.name,durationMs:Date.now()-started,ok:true});return result
   }
  })()])}
  catch(error){failOne(instance||instances.get(sessionId),error,{retain:error?.retainOriginal===true});metrics.push({at:Date.now(),name:input.name,durationMs:Date.now()-started,ok:false});throw error}
  finally{clearTimeout(timer);input.signal?.removeEventListener('abort',abort);if(metrics.length>100)metrics.shift();if(instance&&!instance.closed){instance.busy=false;armIdle(instance)}}
 }
 function execute(input){
  if((queued.get(input.sessionId)||0)>=maxQueuedPerSession)return Promise.reject(new Error('后台脚本排队已满，请稍后重试'))
  queued.set(input.sessionId,(queued.get(input.sessionId)||0)+1)
  const previous=queues.get(input.sessionId)||Promise.resolve()
  const task=previous.catch(()=>{}).then(()=>{input.signal?.throwIfAborted();return executeNow(input)})
  queues.set(input.sessionId,task)
  void task.finally(()=>{if(queues.get(input.sessionId)===task)queues.delete(input.sessionId);const count=queued.get(input.sessionId)-1;if(count)queued.set(input.sessionId,count);else queued.delete(input.sessionId)}).catch(()=>{})
  if(!input.signal)return task
  return new Promise((resolve,reject)=>{
   const abort=()=>reject(input.signal.reason||new Error('脚本后台操作已取消'))
   input.signal.addEventListener('abort',abort,{once:true});if(input.signal.aborted)abort()
   task.then(resolve,reject).finally(()=>input.signal.removeEventListener('abort',abort))
  })
 }
 async function ensure(sessionId){
  let stopped=false,timer;
  const task=start(sessionId,()=>stopped);
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{
   stopped=true;const error=new Error('脚本后台初始化超时，原实例已保留；不会重放已执行模块');
   failOne(instances.get(sessionId),error,{retain:true});reject(error);
  },timeoutMs)})]).then(instance=>{if(instance&&!instance.busy)armIdle(instance);return instance})}
  finally{clearTimeout(timer)}
 }
 async function yieldToFrontend(sessionId,runtimeId,{takeover=false}={}){
  if(ownedMode)return {yielded:false,ownedSp:true};
  if(String(runtimeId).startsWith('background:'))return;const instance=instances.get(sessionId);if(!instance||instance.busy||instance.generations.size)return
  // The last poll is not the script's completion. Its response templates,
  // callbacks and acknowledged writes still own this original realm.
  for(const frame of instance.page?.frames?.()||[])if(await frame.evaluate(()=>window.__dshTavernGenerationBusy?.()===true))return
  if(instance.busy||instance.generations.size)return
  if(instance.hasMvu&&!instance.initializationBlocked)await refreshInitialization(instance);
  if(instance.initializationBlocked){if(takeover&&dispatch.availableFrontend?.(sessionId))await discardRetained(instance,'用户显式接管，初始化失败的后台实例已释放');return}
  if(!instance.drainError){await disposeOne(instance,{drain:true});return}
  // The page that now owns the game has fenced the retained realm; release it.
  if(dispatch.availableFrontend?.(sessionId)){await discardRetained(instance,'前台页面已接管本局，后台未保存的 SP 实例已放弃');return}
  // A page is waiting for this game: try one bounded save without holding its
  // claim. An explicit takeover is the user's decision and is not preceded by one.
  if(!takeover)void recoverRetained(instance).catch(()=>{})
 }
 async function retryDrain(sessionId,{preserveUnsaved=false}={}){
  const instance=instances.get(sessionId);if(!instance?.drainError)return {released:false,error:'没有待重试的 SP 保存'};
  if(instance.recoveryAttempt)return {released:false,drainError:'SP 上次保存尚未退出，未启动重叠重试'};
  const token=randomUUID();instance.recoveryToken=token;instance.recoveryDeadline=monotonicNow()+timeoutMs;
  let timer;
  const task=(async()=>{
   await instance.quarantinePromise;
   if(instance.recoveryToken!==token||monotonicNow()>=instance.recoveryDeadline)throw new Error('SP 保存重试超时，未保存实例已保留');
   const results=await instance.page.evaluate(recovery=>window.__dshBackgroundEngine.retrySpDrain(recovery),{recoveryToken:token,timeoutMs:Math.max(1,instance.recoveryDeadline-monotonicNow())});
   if(instance.recoveryToken!==token||monotonicNow()>=instance.recoveryDeadline)throw new Error('SP 保存重试超时，未保存实例已保留');
   if(!Array.isArray(results)||!results.length||results.some(result=>!result||typeof result.released!=='boolean'))throw new Error('SP 保存回执不完整，未保存实例已保留');
   const failed=results.find(result=>result.released===false);
   if(failed){
    instance.drainError=failed.drainError||instance.drainError||'SP 原包尚未保存';
    // A newer story lifecycle fenced this realm for good: no retry can save it.
    if(failed.superseded&&!preserveUnsaved)void Promise.resolve(discardRetained(instance,'剧情版本已变化，后台未保存的 SP 实例已放弃')).catch(()=>{});
    return failed;
   }
   delete instance.drainError;await disposeOne(instance);return {released:true};
  })();instance.recoveryAttempt=task;
  task.finally(()=>{if(instance.recoveryAttempt===task)delete instance.recoveryAttempt}).catch(()=>{});
  try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SP 保存重试超时，未保存实例已保留')),timeoutMs)})])}
  catch(error){instance.drainError=error.message;return {released:false,drainError:error.message}}
  finally{clearTimeout(timer);delete instance.recoveryToken;if(!instance.closed&&instance.runtimeId)dispatch.quarantine?.(sessionId,instance.runtimeId,instance.drainError)}
 }
 function requireOwned(){if(!ownedMode)throw new Error('SP 专用后台模式未启用')}
 function nativeDialogPending(sessionId){const instance=instances.get(sessionId);return !!instance&&!instance.closed&&!instance.crashed&&!instance.quarantined&&dispatch.available(sessionId,instance.runtimeId)&&instance.ownedUi?.hasNativeDialog?.()===true}
 function retainedNativeDialogPending(sessionId){const instance=instances.get(sessionId);return !!instance&&!instance.closed&&!instance.crashed&&dispatch.retainedOwner(sessionId,instance.runtimeId)&&instance.ownedUi?.hasNativeDialog?.()===true}
 function keepNativeDialogAlive(sessionId){
  // Called only after the controller validates a live current viewer. Preserve
  // the existing live lease while its renderer is suspended; never revive an
  // expired/replaced lease or advertise initialization/work as ready.
  if(!nativeDialogPending(sessionId))return false
  const instance=instances.get(sessionId)
  if(instance.initializationBlocked||instance.drainError||dispatch.status(sessionId).initializationError)return false
  return dispatch.heartbeat(sessionId,instance.runtimeId,false,'',2).active===true
 }
 async function assertOwnedOwner(sessionId,runtimeId){
  requireOwned();const instance=instances.get(sessionId)
  if(!instance||instance.closed||instance.crashed||instance.quarantined||instance.runtimeId!==runtimeId||!String(runtimeId).startsWith('background:')||!dispatch.available(sessionId,runtimeId))throw new Error('SP 专用后台执行权已失效')
  return true
 }
 async function assertRetainedUiOwner(sessionId,instance){
  const valid=()=>instances.get(sessionId)===instance&&!instance.closed&&!instance.crashed&&!!instance.page&&String(instance.runtimeId).startsWith('background:')&&dispatch.retainedOwner(sessionId,instance.runtimeId);
  if(!valid())throw new Error('SP 原恢复界面身份已失效');
  if(!isDeepStrictEqual(await ownedOptions.scope(sessionId),instance.ownedScope)||!valid())throw new Error('SP 原恢复界面剧情或执行者已变化');
 }
 async function recoverStartingMetadata(sessionId,instance,authorizeUi,initializingScope){
  const initial=initializingScope?.();
  const cold=()=>instance?instance.starting===true&&instance.ownedLeaseRegistered===false&&!instance.quarantined&&!instance.initializationBlocked:!!initial;
  const current=()=>instances.get(sessionId)===instance&&!closed&&(!instance||!instance.closed&&!instance.crashed);
  if(!cold())return null;
  const expected=instance?.ownedScope||initial;
  const actual=await ownedOptions.scope(sessionId);
  if(!instance&&initial)instance=instances.get(sessionId);
  if(!cold())return null;
  if(!current()||!expected||!isDeepStrictEqual(actual,expected)||instance?.ownedScope&&!isDeepStrictEqual(instance.ownedScope,expected))throw new Error('SP 首次观察剧情或执行者已变化');
  const validate=typeof authorizeUi==='function'?await authorizeUi():null;
  validate?.();initializingScope?.();
  if(!instance&&initial)instance=instances.get(sessionId);
  if(instance?.ownedScope&&!isDeepStrictEqual(instance.ownedScope,expected))throw new Error('SP initial metadata scope changed');
  if(!current())throw new Error('SP 首次观察执行者已变化');if(!cold())return null;
  const metadata=instance?.ownedUi?await instance.ownedUi.operate({operation:'recover'},{validate}):{revision:0,notices:[],sessionId,runtimeId:instance?.runtimeId||null};
  return {...metadata,ready:false,initializing:true};
 }
 async function assertSaveRecovery(sessionId,runtimeId,recovery){
  const instance=instances.get(sessionId),permit=instance?.ownedSaveRecovery;
  if(!instance||instance.closed||instance.crashed||instance.runtimeId!==runtimeId||!instance.quarantined||!permit||permit.token!==recovery?.token||permit.taskId!==recovery?.taskId||monotonicNow()>=permit.deadline||permit.revision!==instance.quarantineRevision)throw new Error('SP 专用保存恢复能力已失效');
  if(!isDeepStrictEqual(await ownedOptions.scope(sessionId),instance.ownedScope))throw new Error('SP 保存恢复剧情身份已变化');
  if(instances.get(sessionId)!==instance||instance.closed||instance.crashed||instance.ownedSaveRecovery!==permit||permit.revision!==instance.quarantineRevision||monotonicNow()>=permit.deadline)throw new Error('SP 专用保存恢复能力已失效');
  return true;
 }
 async function withSaveRecovery(sessionId,{runtimeId,taskId},work){
  requireOwned();const instance=instances.get(sessionId);
  if(instance&&!instance.quarantined){await assertOwnedOwner(sessionId,runtimeId);return work(undefined);}
  if(!instance||instance.closed||instance.crashed||instance.runtimeId!==runtimeId||!instance.quarantined||instance.ownedSaveRecovery||typeof taskId!=='string'||!taskId)throw new Error('SP 原保存恢复窗口不可用');
  await instance.quarantinePromise;
  if(!isDeepStrictEqual(await ownedOptions.scope(sessionId),instance.ownedScope))throw new Error('SP 保存恢复剧情身份已变化');
  const permit={token:randomUUID(),taskId,runtimeId,deadline:monotonicNow()+timeoutMs,revision:instance.quarantineRevision};
  dispatch.beginOwnedSaveRecovery(sessionId,runtimeId,permit.token,taskId,timeoutMs);instance.ownedSaveRecovery=permit;
  let resumed=false;
  try{
   await instance.page.evaluate(permit=>window.__dshBackgroundEngine.beginOwnedSaveRecovery(permit),{token:permit.token,taskId,runtimeId,timeoutMs});
   const result=await work({token:permit.token,taskId,runtimeId});
   await assertSaveRecovery(sessionId,runtimeId,permit);
   if(result?.saved!==true||result.taskId!==taskId||result.recoveryComplete!==true)throw new Error('SP 仅保存恢复未获得任务完成及安全恢复双确认');
   if(typeof result.recoveryError!=='string'||!result.recoveryError||!instance.drainError?.endsWith(result.recoveryError))throw new Error('SP 已保存，但当前隔离还包含另一故障，未恢复普通执行');
   const origin=instance.ownedTaskOrigins?.get(taskId),failed=instance.failedOwnedEvent;
   if(result.hostEvent&&(!origin||result.hostEvent.eventId!==origin.id||result.hostEvent.name!==origin.name||result.hostEvent.runtimeId!==runtimeId))throw new Error('SP 保存恢复持久来源与原宿主事件不一致');
   if(failed&&(!origin||origin.id!==failed.eventId||typeof failed.error!=='string'||!failed.error.endsWith(result.recoveryError)))throw new Error('SP 已保存，但任务与失败事件缺少同一真实执行编号证明');
   if(typeof ownedOptions.completeSaveRecovery!=='function')throw new Error('SP 保存恢复事件确认入口不可用');
   await ownedOptions.completeSaveRecovery(sessionId,{runtimeId,taskId,eventId:failed?origin.id:undefined,recoveryError:result.recoveryError,identity:instance.ownedScope,args:failed?.args});
   dispatch.finishOwnedSaveRecovery(sessionId,runtimeId,permit.token,{resume:true});
   await instance.page.evaluate(token=>window.__dshBackgroundEngine.finishOwnedSaveRecovery(token),permit.token);
   await assertSaveRecovery(sessionId,runtimeId,permit);
   instance.quarantined=false;
   await instance.page.evaluate(token=>window.__dshBackgroundEngine.resumeOwnedSaveRecovery(token),permit.token);
   if(instance.quarantineRevision!==permit.revision)throw new Error('SP 保存恢复期间发生另一隔离');
   delete instance.drainError;delete instance.retainedAt;delete instance.failedOwnedEvent;resumed=true;
   instance.unsubscribe=dispatch.subscribeWork?.(sessionId,signal=>{if(!instance.closed)void instance.page.evaluate(signal=>window.__dshBackgroundSignal?.(signal),signal).catch(error=>instance.errors.push(error.message))});
   armIdle(instance);return result;
  }catch(error){if(!instance.closed){instance.quarantined=true;dispatch.quarantine?.(sessionId,runtimeId,instance.drainError);await instance.page.evaluate(reason=>window.__dshBackgroundEngine.quarantine(reason),instance.drainError).catch(failure=>instance.errors.push(failure.message));}throw error}
  finally{if(!resumed){try{dispatch.finishOwnedSaveRecovery(sessionId,runtimeId,permit.token)}catch{}await instance.page.evaluate(token=>window.__dshBackgroundEngine.cancelOwnedSaveRecovery(token),permit.token).catch(error=>instance.errors.push(error.message));}if(instance.ownedSaveRecovery===permit)delete instance.ownedSaveRecovery;}
 }
 async function ownedEnsure(sessionId){requireOwned();const instance=await ensure(sessionId);if(!instance)throw new Error('SP 专用后台未取得执行权');await assertOwnedOwner(sessionId,instance.runtimeId);return {active:true,runtimeId:instance.runtimeId,initialized:true}}
 async function ownedEmit(sessionId,eventOrName,args=[],work={}){
  requireOwned();const event=typeof eventOrName==='string'?{...work,name:eventOrName,args}:eventOrName
  if(!event||typeof event.name!=='string')throw new Error('SP 专用后台事件无效')
  if(String(event.eventId||'').startsWith('display-render:'))throw new Error('正文显示改写专用事件不能派发给SP')
  if(event.name==='CHAT_CHANGED'&&event.initialization===true){await ownedEnsure(sessionId);return {handled:true,alreadyInitialized:true,args:event.args||[]}}
  // The runtime already has the freshly synchronized complete Helper context.
  // Passing a whole session view here would overwrite it with the wrong shape.
  const {name,args:eventArgs=[],context:_unusedContext,...eventWork}=event
  return execute({sessionId,name,args:eventArgs,context:null,work:{...eventWork,general:true,onlyScriptIds:['extension-sp-database']},returnFailure:true})
 }
 // Internal callback only: never expose this object through a browser RPC.
 async function withOwnedInstance(sessionId,fn){
  requireOwned();let instance=instances.get(sessionId);if(!instance?.page||!instance.runtimeId)instance=await ensure(sessionId)
  if(!instance||instance.closed||instance.crashed)throw new Error('SP 专用后台原窗口不可用')
  if(typeof ownedOptions.scope!=='function')throw new Error('SP 专用后台缺少canonical scope提供者')
  return fn({page:instance.page,runtimeId:instance.runtimeId,scope:await ownedOptions.scope(sessionId),hostAvailable:!instance.quarantined&&dispatch.available(sessionId,instance.runtimeId),quarantined:!!instance.quarantined,drainError:instance.drainError||null,errors:instance.errors.slice()})
 }
 async function ownedCommand(sessionId,command,{authorizeUi,initializingScope,authorizeComposer}={}){
  requireOwned();
  let validateComposer;
  if(command?.kind==='composer-state'){
   if(typeof authorizeComposer!=='function')throw new Error('SP 输入框状态缺少认证');
   validateComposer=await authorizeComposer();
   const deadline=monotonicNow()+timeoutMs,startup=pending.get(sessionId);let observedInstance=instances.get(sessionId);
   for(;;){
    validateComposer();const current=instances.get(sessionId);
    if(!current){if(observedInstance||!startup||pending.get(sessionId)!==startup)throw new Error('SP 原输入框实例已失效')}
    else{
     if(!observedInstance&&startup&&(current.startupTask!==startup||(pending.has(sessionId)&&pending.get(sessionId)!==startup)))throw new Error('SP 原输入框实例已失效');
     if((observedInstance&&observedInstance!==current)||current.closed||current.crashed||current.quarantined)throw new Error('SP 原输入框实例已失效');
     observedInstance=current;
    }
    if(monotonicNow()>=deadline)throw new Error('SP 原输入框桥安装等待超时');
    if(current?.page&&current.ownedLeaseRegistered){
     // A newly mounted frame can navigate while being inspected. Only snapshot
     // synchronization is repeatable: apply updates the draft/epoch and resolves
     // bridge readiness; it never writes or sends an input through the host API.
     const navigationTransient=error=>String(error?.message||error).includes('Execution context was destroyed, most likely because of a navigation');
     current.ownedCommands=(current.ownedCommands||0)+1;
     try{
      const matches=[];
      for(const frame of current.page.frames()){
       try{if(await frame.evaluate(()=>window.__dshOwnedComposerScriptId==='extension-sp-database'&&!!window.__dshOwnedComposerBridgeReady))matches.push(frame)}
       catch(error){if(!navigationTransient(error))throw error}
      }
      if(matches.length>1)throw new Error('SP 专用后台原包窗口缺失或不唯一');
      if(matches.length===1){
       await assertOwnedOwner(sessionId,current.runtimeId);
       validateComposer();
       if(instances.get(sessionId)!==current||current.closed||current.crashed||current.quarantined)throw new Error('SP 原输入框实例已失效');
       if(monotonicNow()>=deadline)throw new Error('SP 原输入框桥安装等待超时');
       try{
        return await matches[0].evaluate(async command=>{
         if(!window.__dshOwnedComposerBridgeReady)throw Error('SP 原输入框桥未安装');
         const bridge=await window.__dshOwnedComposerBridgeReady;if(!bridge)throw Error('SP 原输入框桥不可用');
         bridge.apply({...command.value,composerEpoch:command.composerEpoch});return {delivered:true};
        },command);
       }catch(error){if(!navigationTransient(error))throw error}
      }
     }finally{current.ownedCommands--;armIdle(current)}
    }
    await new Promise(resolve=>setTimeout(resolve,100));
   }
  }
  const composerCommand=command?.kind==='composer-intent',recoveryUi=command?.kind==='ui'&&['recover','dialog','files','close'].includes(command.command?.operation);let instance=command?.kind==='save-retry'||composerCommand||recoveryUi?instances.get(sessionId):await ensure(sessionId);if(command?.kind==='save-retry'&&(!instance||instance.closed||instance.crashed||!instance.page||command.runtimeId&&command.runtimeId!==instance.runtimeId))throw new Error('SP original save realm no longer available');if(command?.kind==='ui'&&command.command?.operation==='recover'&&(!instance||instance.starting===true&&instance.ownedLeaseRegistered===false)){const starting=await recoverStartingMetadata(sessionId,instance,authorizeUi,initializingScope);if(starting!==null)return starting;instance=instances.get(sessionId);}if(!instance)throw new Error('SP 专用后台不可用');if(command?.kind==='save-retry'&&instance.quarantined)await assertSaveRecovery(sessionId,instance.runtimeId,command.recovery);else if(recoveryUi&&['recover','dialog','close'].includes(command.command?.operation))await assertRetainedUiOwner(sessionId,instance);else await assertOwnedOwner(sessionId,instance.runtimeId)
  // Commands, including real UI actions, must prevent idle retirement. A task
  // may wait for another command, so no common serial queue spans these awaits.
  instance.ownedCommands=(instance.ownedCommands||0)+1
  try{
   if(command?.kind==='database-command')return await instance.page.evaluate(operation=>window.__dshBackgroundEngine.commandOwned(operation),command.operation||command.command)
   if(command?.kind==='open-ui')return await instance.page.evaluate(()=>window.__dshBackgroundEngine.openOwnedUi())
   if(command?.kind==='ui'){
    // Replies to a native dialog must not evaluate into its suspended renderer.
    // Opening is an explicit operation; capture/answers use the existing bridge.
    // The bridge performs openOwnedUi exactly once for operation "open".
    if(typeof ownedUiFactory!=='function')throw new Error('SP 原UI浏览器桥未接入')
    if(!instance.ownedUiPromise)instance.ownedUiPromise=Promise.resolve(ownedUiFactory({page:instance.page,sessionId,runtimeId:instance.runtimeId})).then(ui=>instance.ownedUi=ui).catch(error=>{delete instance.ownedUiPromise;throw error})
    const ui=await instance.ownedUiPromise;
    if(!recoveryUi&&command.command?.operation!=='capture'&&!(command.command?.operation==='open'&&ui.hasNativeDialog?.())){
     if(!await instance.page.evaluate(()=>window.__dshBackgroundEngine.ownedState()?.ready===true))throw new Error('SP 原插件尚未完整初始化，输入未执行')
    }
    const validateUi=typeof authorizeUi==='function'?await authorizeUi():null;
    if(validateUi!==null&&typeof validateUi!=='function')throw new Error('SP 原界面最终认证回执无效');
    validateUi?.();const result=await ui.operate(command.command,{validate:validateUi});
    if(command.viewerDetachEpoch!==undefined){
     validateUi?.();
     // A viewer release carries no draft and cannot replay an input. Check the
     // original bridge epoch again in its own realm before changing readiness.
     const originals=[];for(const frame of instance.page.frames())if(await frame.evaluate(()=>window.__dshOwnedComposerScriptId==='extension-sp-database'&&!!window.__dshOwnedComposerBridgeReady))originals.push(frame);
     if(originals.length!==1)throw new Error('SP 专用后台原包窗口缺失或不唯一');
     validateUi?.();
     const detached=await originals[0].evaluate(async epoch=>{const bridge=await window.__dshOwnedComposerBridgeReady;if(!bridge)throw Error('SP 原输入框桥不可用');return bridge.detach(epoch)},command.viewerDetachEpoch);
     if(detached.detached!==true)return detached;
     validateUi?.();
     await instance.page.evaluate(composerEpoch=>window.__dshBackgroundEngine.commandOwned({kind:'game-state',ready:false,composerEpoch}),command.viewerDetachEpoch);
     return {...result,...detached};
    }
    return result
   }
   const matches=[]
   for(const frame of instance.page.frames())if(await frame.evaluate(composer=>composer?window.__dshOwnedComposerScriptId==='extension-sp-database'&&!!window.__dshOwnedComposerBridgeReady:window.__dshOriginalExtensionState?.id==='sp-database',composerCommand))matches.push(frame)
   if(matches.length!==1)throw new Error('SP 专用后台原包窗口缺失或不唯一')
   validateComposer?.();
   return await matches[0].evaluate(async command=>{
    if(command?.kind==='composer-intent'){if(!window.__dshOwnedComposerBridgeReady)throw Error('SP 原输入框桥未安装');const bridge=await window.__dshOwnedComposerBridgeReady;if(!bridge)throw Error('SP 原输入框桥不可用');const value={...command.value,composerEpoch:command.composerEpoch};return bridge.intent(value)}
    if(command?.kind==='task'){if(typeof window.AutoCardUpdaterAPI?.__dshExecuteOwnedTask!=='function')throw Error('SP owned-task API unavailable');return window.AutoCardUpdaterAPI.__dshExecuteOwnedTask(command.task)}
    if(command?.kind==='save-retry'){if(typeof window.AutoCardUpdaterAPI?.__dshRetryOwnedTaskSave!=='function')throw Error('SP save retry API unavailable');return window.AutoCardUpdaterAPI.__dshRetryOwnedTaskSave(command.taskId,command.recovery)}
    if(command?.kind==='task-prepare'){if(typeof window.AutoCardUpdaterAPI?.__dshPrepareQueuedOwnedTask!=='function')throw Error('SP queued preparation API unavailable');return window.AutoCardUpdaterAPI.__dshPrepareQueuedOwnedTask(command.task)}
    if(command?.kind==='task-command'){if(typeof window.AutoCardUpdaterAPI?.__dshOwnedTaskCommand!=='function')throw Error('SP owned-command API unavailable');return window.AutoCardUpdaterAPI.__dshOwnedTaskCommand(command.command)}
    throw Error('Unsupported SP owner command')
   },command)
  }finally{instance.ownedCommands--;armIdle(instance)}
 }
 async function ownedInspect(sessionId){
  requireOwned();const instance=instances.get(sessionId);if(!instance)return {active:false}
  const original=[]
  for(const frame of instance.page?.frames()||[])try{const state=await frame.evaluate(()=>{
   if(window.__dshOriginalExtensionState?.id!=='sp-database')return null
   const api=window.AutoCardUpdaterAPI,detail=api?.__dshPersistenceDiagnostics?.()
   return {phase:window.__dshOriginalExtensionState.phase,ready:window.__dshOriginalExtensionState.ready,work:api?.__dshPendingWork?.(),persistenceIdle:detail?.idle===true,checks:detail?.checks||null,ui:typeof window.__dshSpOwnedBackgroundInspect==='function'?window.__dshSpOwnedBackgroundInspect():null}
  });if(state)original.push(state)}catch(error){original.push({inspectionFailed:true,error:String(error.message||error)})}
  const ownedState=await instance.page.evaluate(()=>window.__dshBackgroundEngine?.ownedState?.()||null)
  const hostAvailable=!instance.closed&&!instance.crashed&&!instance.quarantined&&dispatch.available(sessionId,instance.runtimeId)
  return {active:!instance.closed&&!instance.crashed,hostAvailable,ready:hostAvailable&&ownedState?.ready===true,runtimeId:instance.runtimeId,busy:instance.busy,commands:instance.ownedCommands||0,quarantined:!!instance.quarantined,drainError:instance.drainError||null,errors:instance.errors.slice(),ownedState,original}
 }
 async function diagnose(){return {instances:await Promise.all([...instances.values()].map(async instance=>{
  const original=[];
  for(const frame of instance.page?.frames?.()||[])try{
   const state=await frame.evaluate(()=>{
    if(!window.__dshOriginalExtensionState)return null;
    const {ready,phase,error,hiddenColumnRepair}=window.__dshOriginalExtensionState,api=window.AutoCardUpdaterAPI,context=window.SillyTavern?.getContext?.(),configs=[];
    for(const namespace of Object.values(context?.extensionSettings?.__userscripts||{}))for(const [key,raw]of Object.entries(namespace||{}))if(/(?:profile_v1.*settings|allSettings_v2)$/.test(key))try{
     const value=typeof raw==='string'?JSON.parse(raw):raw;
     if(value&&typeof value==='object')configs.push({autoUpdateEnabled:value.autoUpdateEnabled===true,apiMode:['custom','tavern'].includes(value.apiMode)?value.apiMode:'unknown',useMainApi:value.apiConfig?.useMainApi===true,hasUrl:!!value.apiConfig?.url,hasModel:!!value.apiConfig?.model,hasTavernProfile:!!value.tavernProfile,performanceDiagnosticsEnabled:value.performanceDiagnosticsEnabled===true});
    }catch{}
    const performance=(api?.getRecentPerformanceSpans?.()||[]).slice(-40).map(row=>({name:row.name,startedAt:row.startedAt,durationMs:row.durationMs,severity:row.severity,metrics:Object.fromEntries(Object.entries(row.metrics||{}).filter(([key,value])=>typeof value==='number'||typeof value==='boolean'||(['source','reason','skipReason'].includes(key)&&typeof value==='string'&&/^[\w-]{0,96}$/.test(value))))}));
    return {ready,phase,error,hiddenColumnRepair,tables:api?.exportTableAsJson?.()||{},pendingWork:api?.__dshPendingWork?.(),isolationCode:api?.__dshGetCurrentIsolationCode?.(),tableCount:Object.keys(api?.exportTableAsJson?.()||{}).filter(k=>k.startsWith('sheet_')).length,chatLength:context?.chat?.length,configs,performance,updateConfig:api?.getUpdateConfigParams?.()};
   });if(state){const {tables,...summary}=state;original.push({...summary,tableStamp:spAuthorityStamp(tables)})}
  }catch{}
  return {sessionId:instance.sessionId,busy:instance.busy,...(instance.initializationBlocked?{initializationBlocked:true,initializationBlockReason:instance.initializationBlockReason}:{}),...(instance.drainError?{drainError:instance.drainError}:{}),errors:instance.errors.slice(),original};
 })),metrics:[...metrics],discarded:[...discarded]}}
 // Shutdown: a working instance drains once and a retained one gets one bounded
 // save retry (both within timeoutMs). Whatever the outcome every realm and the
 // browser are then released; what could not be saved is reported and recorded.
 async function dispose(){
  closed=true;const errors=[]
  await Promise.allSettled([...instances.values()].map(async instance=>{
   if(instance.initializationBlocked){errors.push(instance.initializationBlockReason||'脚本初始化未完成');await discardRetained(instance,'服务停止，初始化失败实例的未保存状态已放弃');return}
   try{if(instance.drainError)await retryDrain(instance.sessionId);else await disposeOne(instance,{drain:true})}catch(error){instance.errors.push(String(error?.message||error))}
   if(instance.closed)return
   errors.push(instance.drainError||'SP 原包尚未保存')
   await discardRetained(instance,'服务停止，后台未保存的 SP 实例已放弃')
  }))
  await browserOwner.dispose()
  return {disposed:true,...(errors.length?{errors}:{})}
 }
 return {withOwnedInstance,owned:ownedMode?Object.freeze({ensure:ownedEnsure,nativeDialogPending,retainedNativeDialogPending,keepNativeDialogAlive,emit:ownedEmit,command:ownedCommand,inspect:ownedInspect,assertOwner:assertOwnedOwner,assertSaveRecovery,withSaveRecovery,retire:sessionId=>retireIdle(instances.get(sessionId))}):null,execute,ensure,yieldToFrontend,retryDrain,diagnose,inspect:()=>({instances:[...instances.values()].map(i=>({sessionId:i.sessionId,busy:i.busy,lastUsed:i.lastUsed,...(i.initializationBlocked?{initializationBlocked:true,initializationBlockReason:i.initializationBlockReason}:{}),...(i.drainError?{drainError:i.drainError}:{})})),metrics:[...metrics],discarded:[...discarded]}),dispose}
}
