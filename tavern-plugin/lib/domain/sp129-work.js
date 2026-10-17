import {walkSp129} from './sp129-source.js'

const callNamed=(node,name)=>node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name===name
const memberCall=(node,method)=>node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&!node.callee.computed&&node.callee.property.name===method&&node.callee.object.type==='Identifier'
function unique(items,label){if(items.length!==1)throw Error('SP 1.2.9 工作适配节点缺失或不唯一：'+label);return items[0]}
function nodes(root,predicate){const result=[];walkSp129(root,node=>{if(predicate(node))result.push(node)});return result}
function mapFrom(named,name,method='get'){
 const fn=named(name), calls=nodes(fn,n=>memberCall(n,method))
 return unique([...new Set(calls.map(n=>n.callee.object.name))],name+'.'+method)
}

// Keep the upstream queue, timer delays, cancellation and captured scope guards.
// Only the verified persistence pipeline participates in the host's drain ledger.
export function adaptSp129Work(ctx){
 // Preserve preorder and every duplicate, including named expressions nested
 // below the main scope. ctx.functions intentionally covers declarations only.
 const all=[],functions=[],byName=new Map()
 walkSp129(ctx.root,node=>{
  all.push(node)
  if(node.type!=='FunctionDeclaration'&&node.type!=='FunctionExpression')return
  functions.push(node)
  const name=node.id?.name
  if(name){if(!byName.has(name))byName.set(name,[]);byName.get(name).push(node)}
 })
 const named=name=>unique(byName.get(name)||[],name)
 const trigger=named('triggerAutomaticUpdateIfNeeded_ACU')
 const last=trigger.body.body.at(-1)
 if(last?.type!=='ReturnStatement'||last.argument?.type!=='SequenceExpression')throw Error('SP 1.2.9 自动填表队列返回形态改变')
 const task=last.argument.expressions.at(-1)
 if(task.type!=='Identifier')throw Error('SP 1.2.9 自动填表任务标识缺失')
 ctx.replace(task,'__dshTrackSpWork('+ctx.text(task)+')')

 const timerScopes=[named('handleContentOptimizationEvent_ACU'),named('mainInitialize_ACU')]
 const main=timerScopes[1]
 // Startup has its own finite completion boundary. It is deliberately separate
 // from the work ledger: initialization may itself run inside a tracked host
 // event, and waiting for that ledger here would wait for its own caller.
 const startup=unique(nodes(main,n=>n.type==='VariableDeclarator'&&n.id?.name==='initWithChatId'),'startup restore').init
 const safely=unique(nodes(main,n=>n.type==='VariableDeclarator'&&n.id?.name==='initWithChatIdSafely'),'startup restore error boundary').init
 const startupCall=unique(nodes(safely,n=>callNamed(n,'initWithChatId')),'startup restore call')
 ctx.replace(startupCall,'__dshObserveSpStartup('+ctx.text(startupCall)+')')
 function startupResult(name){
  const decl=unique(nodes(startup,n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.init?.type==='AwaitExpression'&&callNamed(d.init.argument,name))),name+' startup result')
  const item=unique(decl.declarations.filter(d=>d.init?.type==='AwaitExpression'&&callNamed(d.init.argument,name)),name+' result binding')
  if(item.id.type!=='Identifier')throw Error('SP 1.2.9 启动结果绑定改变：'+name)
  return {decl,result:item.id.name}
 }
 const provisional=startupResult('ensureNoActiveProvisionalBridgeForCurrentScope_ACU')
 ctx.insert(provisional.decl.end,`if(!${provisional.result}.ok)__dshCompleteSpStartup(new Error(${provisional.result}.error||'SP 启动恢复残留事务失败'));`)
 const hydrated=startupResult('hydrateStorageProviderFromSnapshot_ACU')
 ctx.insert(hydrated.decl.end,`if(!${hydrated.result}.ok&&${hydrated.result}.failureCode!=='stale_load_discarded')__dshCompleteSpStartup(new Error(${hydrated.result}.error||${hydrated.result}.failureCode||'SP 启动水合失败'));`)
 const reloads=nodes(startup,n=>n.type==='TryStatement'&&nodes(n.block,c=>callNamed(c,'reloadStorageProvider')).length)
 if(reloads.length!==2||reloads.some(n=>n.handler?.param?.type!=='Identifier'))throw Error('SP 1.2.9 启动冷读取失败边界改变')
 for(const reload of reloads)ctx.insert(reload.handler.body.start+1,`__dshCompleteSpStartup(${reload.handler.param.name});`)
 const unavailable=unique(nodes(main,n=>callNamed(n,'logWarn_ACU')&&n.arguments[0]?.type==='TemplateLiteral'&&ctx.text(n.arguments[0]).includes('chatId still not available')),'startup polling exhaustion')
 ctx.replace(unavailable,"(__dshCompleteSpStartup(new Error('SP 启动等待 chatId 超时，尚未完成初始化')),"+ctx.text(unavailable)+')')
 const core=unique(main.body.body.filter(n=>n.type==='IfStatement'&&nodes(n.test,c=>callNamed(c,'attemptToLoadCoreApis_ACU')).length),'startup core API branch')
 if(core.alternate?.type!=='BlockStatement')throw Error('SP 1.2.9 核心API启动失败边界改变')
 ctx.insert(core.alternate.start+1,"__dshCompleteSpStartup(new Error('SP 启动失败：核心API不可用'));")
 const timers=[]
 for(const scope of timerScopes)walkSp129(scope,node=>{
  if(!callNamed(node,'setTimeout'))return
  const cb=node.arguments[0];if(!cb||!/FunctionExpression/.test(cb.type))return
  const text=ctx.text(cb)
  if(scope===timerScopes[0]&&node.arguments[1]?.value===500||
   scope===timerScopes[1]&&(/refreshMergedDataAndNotifyWithUI_ACU|runMutationRound_ACU|initWithChatIdSafely/.test(text)))timers.push(node)
 })
 if(timers.length!==4)throw Error('SP 1.2.9 延迟流水线形态改变：'+timers.length)
 const startupHydration=unique(timers.filter(timer=>nodes(timer.arguments[0],n=>callNamed(n,'ensureCurrentChatFillModeRecorded_ACU')).length),'initial chat hydration handoff')
 const hydrationCallback=startupHydration.arguments[0]
 if(!hydrationCallback.async||hydrationCallback.params.length!==0)throw Error('SP 1.2.9 初始聊天水合回调参数改变')
 // The first formal CHAT_CHANGED registers a second delayed startup writer.
 // Its own local failure observer is a no-op for every later chat change.
 ctx.replace(hydrationCallback.start,hydrationCallback.body.start,'async(__dshSpStartupFailure)=>')
 const hydrationCatch=unique(nodes(hydrationCallback,n=>n.type==='CatchClause'&&ctx.text(n.body).includes('CHAT_CHANGED 延迟刷新失败')),'chat hydration error boundary')
 if(hydrationCatch.param?.type!=='Identifier')throw Error('SP 1.2.9 初始聊天水合错误绑定改变')
 ctx.insert(hydrationCatch.body.start+1,`__dshSpStartupFailure(${hydrationCatch.param.name});`)
 // 1.2.9 dispatches completion jobs after its event listener has returned.
 // Admit the 0ms handoff immediately, and retain each original concurrent job
 // through settlement before the event owner may retire its scope or realm.
 const receiver=unique(all.filter(n=>n.type==='ClassDeclaration'&&n.id?.name==='PassiveCompletionReceiver_ACU'),'passive completion receiver')
 const receive=unique(receiver.body.body.filter(n=>n.key?.name==='receive'),'passive receive method')
 const receiveTimer=unique(nodes(receive,n=>callNamed(n,'setTimeout')&&n.arguments[1]?.value===0),'passive dispatch timer')
 const job=unique(nodes(receiveTimer,n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='then'&&n.arguments.length===1&&n.arguments[0].type==='MemberExpression'&&n.arguments[0].property.name==='run'),'passive job promise')
 ctx.replace(job,'__dshTrackSpWork('+ctx.text(job)+')')
 timers.push(receiveTimer)
 // Vector archives are also delayed writes; return their promise from the timer.
 const archiveTimers=all.filter(n=>callNamed(n,'setTimeout')&&nodes(n.arguments[0],c=>callNamed(c,'persistPendingVectorIndexArchive_ACU')).length>0)
 const archiveTimer=unique(archiveTimers,'vector archive timer');timers.push(archiveTimer)
 for(const timer of timers){
  ctx.replace(timer.callee,timer===startupHydration?'__dshScheduleSpStartupHydration':'__dshScheduleSpWork')
  const cb=timer.arguments[0], tail=cb.body?.body?.at(-1)
  if(tail?.type==='ExpressionStatement'&&nodes(tail,n=>callNamed(n,'runMutationRound_ACU')||callNamed(n,'persistPendingVectorIndexArchive_ACU')).length)ctx.insert(tail.start,'return ')
 }
 // Replace cancellation only for the concrete timer symbols, everywhere they
 // occur (including explicit generation cancellation outside the scheduler).
 const timerSymbols=new Set([ctx.symbolFromSetter('_set_contentOptimizationDebounceTimer_ACU'),ctx.symbolFromSetter('_set_chatMutationDebounceTimer_ACU')])
 const archiveTimerMap=unique(nodes(archiveTimer.arguments[0],n=>memberCall(n,'delete')),'archive timer map').callee.object.name
 all.forEach(node=>{
  if(callNamed(node,'clearTimeout')&&(timerSymbols.has(node.arguments[0]?.name)||nodes(node.arguments[0],n=>memberCall(n,'get')&&n.callee.object.name===archiveTimerMap).length))ctx.replace(node.callee,'__dshCancelSpWork')
 })
 // Archive cancellation stores the Map.get result in a local before clearing.
 const archiveCancels=new Map()
 const archiveHandles=all.filter(n=>n.type==='VariableDeclarator'&&n.init&&memberCall(n.init,'get')&&n.init.callee.object.name===archiveTimerMap)
 const clearCalls=all.filter(n=>callNamed(n,'clearTimeout'))
 const inside=(node,body)=>node.start>=body.start&&node.end<=body.end
 for(const fn of functions){
  const handles=archiveHandles.filter(n=>inside(n,fn.body)).map(n=>n.id.name)
  for(const call of clearCalls.filter(n=>inside(n,fn.body)&&handles.includes(n.arguments[0]?.name)))archiveCancels.set(call.start,call)
 }
 for(const call of archiveCancels.values())ctx.replace(call.callee,'__dshCancelSpWork')
 // The original archive removes its entry before I/O and swallows failures.
 // Restore the same pending payload on failure unless a newer payload replaced
 // it, and let the drain observe the failure instead of declaring it durable.
 const archive=named('persistPendingVectorIndexArchive_ACU')
 const pending=mapFrom(named,'persistPendingVectorIndexArchive_ACU')
 const payload=unique(nodes(archive,n=>n.type==='VariableDeclarator'&&n.init&&memberCall(n.init,'get')&&n.init.callee.object.name===pending),'archive payload').id.name
 const catcher=unique(nodes(archive,n=>n.type==='CatchClause'),'archive failure')
 ctx.insert(archive.body.start+1,`const __dshArchiveScope=${archive.params[0].name};`)
 ctx.insert(catcher.body.end-1,`;if(!${pending}.has(__dshArchiveScope))${pending}.set(__dshArchiveScope,${payload});throw ${catcher.param.name};`)

 // Read actual bindings from the AST; no dependency on bundle minifier names.
 const runtimePending=mapFrom(named,'readRuntimeOnlyPendingSheets_ACU')
 const locks=mapFrom(named,'getLock_ACU')
 const archiveLocks=mapFrom(named,'runSummaryVectorIndexScopeExclusive_ACU')
 const flushTimers=mapFrom(named,'clearFlushTimer_ACU')
 const notify=named('notifyTableUpdateCallbacksSafely_ACU')
 const notifyFlags=[...new Set(nodes(notify,n=>n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&['Literal','UnaryExpression'].includes(n.right.type)).map(n=>n.left.name))]
 if(notifyFlags.length!==3)throw Error('SP 1.2.9 表格通知状态形态改变')
 // Track transaction/notification handoffs, including their await gaps before a
 // lock appears in its map. The ledger never changes their return values.
 for(const name of ['runTableWriteTransaction_ACU','runMutationRound_ACU','enqueueSummaryVectorIndexFlush_ACU','flushSummaryVectorIndexTaskNow_ACU','rebuildOutdatedSummaryVectorIndexInBackground_ACU']){
  const fn=named(name);if(!fn.async)throw Error('SP 1.2.9 工作函数不再异步：'+name)
  ctx.insert(fn.body.start+1,'const __dshFinishSpWork=__dshBeginSpWork();try{')
  ctx.insert(fn.body.end-1,'}finally{__dshFinishSpWork()}')
 }
 // A completed failed group otherwise only produces a mutable toast. Report it
 // once at the final aggregate branch; retries and progress events stay quiet.
 const failedBranch=unique(nodes(trigger,n=>n.type==='IfStatement'&&n.consequent.type==='BlockStatement'&&ctx.text(n.test).includes('.failedGroups')&&ctx.text(n.consequent).includes('并发分组更新有')),'failed group result')
 const failedNames=[...new Set(nodes(failedBranch.test,n=>n.type==='MemberExpression'&&!n.computed&&n.property.name==='failedGroups').map(n=>ctx.text(n.object)))]
 const failed=unique(failedNames,'failed group count')
 ctx.insert(failedBranch.consequent.start+1,`__dshReportSpFillFailure(${failed});`)

 ctx.insert(ctx.root.start+1,`
 let __dshSpStartupStatus='pending',__dshResolveSpStartup,__dshRejectSpStartup;
 const __dshSpStartupReady=new Promise((resolve,reject)=>{__dshResolveSpStartup=resolve;__dshRejectSpStartup=reject});
 __dshSpStartupReady.catch(()=>{});
 function __dshCompleteSpStartup(error){if(__dshSpStartupStatus!=='pending')return;if(error){__dshSpStartupStatus='failed';__dshRejectSpStartup(error)}else{__dshSpStartupStatus='ready';__dshResolveSpStartup()}}
 function __dshObserveSpStartup(promise){Promise.resolve(promise).then(()=>__dshCompleteSpStartup(),error=>__dshCompleteSpStartup(error));return promise;}
 let __dshSpStartupHydration=null,__dshSpStartupHydrationStatus='unregistered';
 function __dshScheduleSpStartupHydration(work,delay){
  if(__dshSpStartupHydration)return __dshScheduleSpWork(()=>work(()=>{}),delay);
  let resolve,reject,done=false;__dshSpStartupHydrationStatus='pending';
  __dshSpStartupHydration=new Promise((yes,no)=>{resolve=yes;reject=no});__dshSpStartupHydration.catch(()=>{});
  const finish=error=>{if(done)return;done=true;if(error){__dshSpStartupHydrationStatus='failed';reject(error)}else{__dshSpStartupHydrationStatus='ready';resolve()}};
  return __dshScheduleSpWork(async()=>{try{await work(finish);finish()}catch(error){finish(error);throw error}},delay);
 }
 const __dshSpWork=new Set();let __dshSpDrains=0;
 function __dshBeginSpWork(){let resolve,done=false;const entry={settled:new Promise(r=>{resolve=r})};__dshSpWork.add(entry);return error=>{if(done)return;done=true;entry.error=error;resolve(error);if(!error&&${ctx.hostName}.__dshAwaitOriginalWork===false&&!__dshSpDrains)__dshSpWork.delete(entry)};}
 function __dshTrackSpWork(promise){const finish=__dshBeginSpWork();Promise.resolve(promise).then(()=>finish(),error=>finish(error));return promise;}
 const __dshSpTimers=new Map();
 function __dshScheduleSpWork(work,delay,...args){const finish=__dshBeginSpWork(),entry={running:false,finish};const timer=setTimeout(async()=>{entry.running=true;try{await work(...args);finish()}catch(error){finish(error);if(${ctx.hostName}.__dshAwaitOriginalWork===false&&!__dshSpDrains)throw error}finally{__dshSpTimers.delete(timer)}},delay);__dshSpTimers.set(timer,entry);return timer;}
 function __dshCancelSpWork(timer){const entry=__dshSpTimers.get(timer);if(!entry){clearTimeout(timer);return}if(!entry.running){clearTimeout(timer);entry.finish();__dshSpTimers.delete(timer)}}
 function __dshReportSpFillFailure(result){try{const error=new Error('[DSH] SP 自动填表有 '+result.failedGroups+' 组失败'+(Array.isArray(result.errors)&&result.errors[0]?'：'+String(result.errors[0]):''));if(typeof globalThis.reportError==='function')globalThis.reportError(error);else console.error(error.message)}catch(_){}}
 `)
 ctx.atApi(`
 Object.defineProperty(${ctx.apiName},'__dshAwaitStartupReady',{value:()=>Promise.all([__dshSpStartupReady,...(__dshSpStartupHydration?[__dshSpStartupHydration]:[])]).then(()=>{})});
 Object.defineProperty(${ctx.apiName},'__dshGetCurrentIsolationCode',{value:()=>getCurrentIsolationKey_ACU()});
 Object.defineProperty(${ctx.apiName},'__dshPendingWork',{value:()=>__dshSpWork.size});
 Object.defineProperty(${ctx.apiName},'__dshIsPersistenceIdle',{value:()=>{try{return __dshSpStartupStatus==='ready'&&!['pending','failed'].includes(__dshSpStartupHydrationStatus)&&__dshSpWork.size===0&&__dshSpDrains===0&&${runtimePending}.size===0&&${pending}.size===0&&${archiveTimerMap}.size===0&&${archiveLocks}.size===0&&${flushTimers}.size===0&&![${notifyFlags.join(',')}].some(Boolean)&&![...${locks}.values()].some(lock=>lock.activeReaders!==0||lock.activeWriter!==false||lock.queue.length!==0)&&!hasActiveProvisionalBridgeAnywhere_ACU(getChatArray_ACU())}catch(_){return false}}});
 Object.defineProperty(${ctx.apiName},'__dshFlushPendingWork',{value:async()=>{let failure;__dshSpDrains++;try{while(__dshSpWork.size){const batch=[...__dshSpWork],results=await Promise.all(batch.map(entry=>entry.settled));for(const entry of batch)__dshSpWork.delete(entry);failure ||= results.find(Boolean)}}finally{__dshSpDrains--}if(failure)throw failure}});
 `)
}
