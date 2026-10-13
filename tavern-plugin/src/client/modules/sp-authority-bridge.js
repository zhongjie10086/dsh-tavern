// Inject the actual original API and authenticated host RPC. The cache is never
// imported back into the original package during normal synchronization.
function createTavernSpAuthorityBridge(options) {
 let revision=Number(options.initialRevision)||0,claim=null,closed=false,tail=Promise.resolve(),ready=false,lastStamp,lastScope,lastReceipt;
 // `stale` is set only while the host cache may be behind the original: the last
 // publication failed and none has succeeded since. `queued` counts operations
 // not yet finished; `publishing` holds only publications already on the wire.
 let stale=null,queued=0;const publishing=new Set();
 // Bounded evidence of what was published, from where and with what outcome (R8 Z78).
 const trace=[],note=row=>{trace.push({at:Date.now(),...row});if(trace.length>16)trace.shift()},tableCount=value=>Object.keys(value||{}).filter(key=>key.startsWith('sheet_')).length;
 const stamp=value=>JSON.stringify((function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v})(Object.fromEntries(Object.entries(value||{}).map(([key,sheet])=>{if(!key.startsWith('sheet_')||!sheet||typeof sheet!=='object')return[key,sheet];const {_dshLastRowId:counter,...rest}=sheet;return[key,rest]}))));
 const queue=work=>{queued++;const result=tail.then(()=>{if(closed)throw new Error('SP 实例已关闭。');return work()});tail=result.then(()=>{queued--},()=>{queued--});return result};
 const scope=api=>typeof api?.__dshGetCurrentIsolationCode==='function'?api.__dshGetCurrentIsolationCode():undefined;
 const request=(data,isolationCode)=>({...(typeof isolationCode==='string'?{isolationCode}:{}),provider:'extension-sp-database',lifecycle:options.lifecycle,expectedRevision:revision,data});
 const status=(phase,error)=>{ready=phase==='ready';options.onStatus?.({phase,ready,error:error?.message||'',cacheOnly:!ready})};
 async function publish(confirmed=false,recoveryCall=options.call,source='publish'){
  const api=options.getOriginalApi();if(!api)throw new Error('SP 原包未就绪，当前仅可查看缓存。');
  // The real getter is synchronous. Its null-to-{} export can be superseded by
  // original hydration while `await` yields; retain the scope of that export.
  const isolationCode=scope(api);let data=await api.exportTableAsJson();
  const refreshEmpty=captured=>{
   if(tableCount(captured)||closed||options.getOriginalApi()!==api||scope(api)!==isolationCode)return captured;
   const current=api.exportTableAsJson();
   return current&&typeof current.then!=='function'&&tableCount(current)?current:captured;
  };
  const capturedEmpty=tableCount(data)===0;data=refreshEmpty(data);const restoredEmpty=capturedEmpty&&tableCount(data)>0;
  let nextStamp=stamp(data);const row={source,confirmed:confirmed===true,tables:tableCount(data)};
  // A recovered empty export still crosses the host CAS/lifecycle guard, even
  // when its current tables match our previous stamp. Ordinary dedupe is intact.
  if(source!=='hydration'&&!restoredEmpty&&!claim&&lastStamp===nextStamp&&lastScope===isolationCode){note({...row,result:'unchanged'});stale=null;status('ready');return {...lastReceipt,unchanged:true}}
  const sent=Promise.resolve().then(()=>{
   const current=refreshEmpty(data);
   if(current!==data||(row.tables===0&&tableCount(current))){data=current;nextStamp=stamp(data);row.tables=tableCount(data)}
   return recoveryCall('publishTavernSpAuthorityCache',{...request(data,isolationCode),confirmed:confirmed===true,...(claim?{claimId:claim}:{})});
  });
  publishing.add(sent);let result;
  try{result=await sent}catch(error){note({...row,result:String(error?.message||error).slice(0,160)});if(error&&typeof error==='object')error.dshPublishedTables=row.tables;stale={confirmed:confirmed===true};throw error}finally{publishing.delete(sent)}
  note({...row,result:'ok'});
  revision=result.revision;claim=null;lastStamp=nextStamp;lastScope=isolationCode;lastReceipt=result;stale=null;status('ready');return result;
 }
 // Event epilogue. `settle` (background instance or explicit drain) waits for the
 // whole queue; a visible page waits only for a publication already on the wire,
 // so a manual fill queued behind it cannot hold the next send. A publication that
 // failed earlier is not rethrown forever: the original's current tables are
 // exported and published once more (no original operation or model request is
 // replayed) and only that attempt's error fails this event. An unfinished user
 // choice (`claim`) is resolved from its own panel, never from here.
 async function flush({settle=true,call}={}){
  if(settle)await tail;else await Promise.allSettled([...publishing]);
  if(!stale||claim||closed||(!settle&&queued))return;
  const {confirmed}=stale;
  await queue(async()=>{if(!stale)return;try{return await publish(confirmed,call,'flush')}catch(error){status('unavailable',error);throw error}});
 }
 return {
  connect:()=>queue(async()=>{try{const api=options.getOriginalApi();if(!api)throw new Error('SP 原包未就绪，当前仅可查看缓存。');const state=await options.call('beginTavernSpAuthority',request(await api.exportTableAsJson(),scope(api)));revision=state.revision;status(state.phase);return state}catch(error){status('unavailable',error);throw error}}),
  choose:side=>queue(async()=>{try{const choice=await options.call('chooseTavernSpAuthority',{side,lifecycle:options.lifecycle,expectedRevision:revision});revision=choice.revision??revision;if(choice.alreadyChosen)return choice;claim=choice.claimId;status('claiming');await options.importOriginal(choice.importToOriginal);return await publish(false,options.call,'choose')}catch(error){status('unavailable',error);throw error}}),
  publish:(confirmed,recoveryCall,source,validate)=>queue(async()=>{try{validate?.();return await publish(confirmed,recoveryCall,source)}catch(error){status('unavailable',error);throw error}}),
  // R8 Z85: a refusal the host gave before anything was applied (dshUnapplied) is
  // that caller's error; the original and the cache are unchanged and stay writable.
  mutate:operation=>queue(async()=>{if(!ready)throw new Error('SP 原包未就绪，当前仅可查看缓存。');try{const result=await options.mutateOriginal(operation);await publish(true,options.call,'mutate');return result}catch(error){if(error?.dshUnapplied!==true)status('unavailable',error);throw error}}),
  // A failed original operation must not make the cache writable. Reconnect or
  // explicit retry resumes from the persisted owner and retained migration.
  unavailable:error=>status('unavailable',error),
  hydrating:()=>status('hydrating'),
  // Z78: the original's startup-empty export was refused while its tables are still
  // loading. That is a wait, not a failure: nothing is stale (an epilogue must not
  // retry the empty export) and the frame reports cache-only without an error.
  awaitTables:notice=>{stale=null;ready=false;options.onStatus?.({phase:'waiting-storage',ready:false,error:'',notice,cacheOnly:true})},
  flush,
  note,
  trace:()=>trace,
  getState:()=>({ready,revision,claim,closed,stale:Boolean(stale)}),
  close:()=>{closed=true;status('closed')}
 };
}

async function connectTavernSpSingleAuthority(win,options,nativeDatabase,descriptor){
 const sleep=ms=>new Promise(resolve=>win.setTimeout(resolve,ms)),deadline=Date.now()+91000;
 const state=win.__dshOriginalExtensionState;state.phase='waiting-api';
 while(win.AutoCardUpdaterAPI===nativeDatabase||!win.document.querySelector('#extensionsMenu .list-group-item')){if(Date.now()>deadline)throw Error('SP 原包尚未就绪，当前仅可查看缓存。');await sleep(100)}
 const api=win.AutoCardUpdaterAPI,context=win.SillyTavern.getContext();
 if(typeof api.importTableAsJson!=='function'||typeof api.registerTableUpdateCallback!=='function')throw Error('SP 原包未提供数据库 API。');
 const hasTables=data=>Object.keys(data||{}).some(key=>key.startsWith('sheet_'));
 const cached=await options.call('getSpDatabase');
 // Original API publication precedes async checkpoint hydration. Waiting does
 // not authorize seeding the original from a host cache.
 if(hasTables(cached.database?.data)||(hasTables(api.getTableTemplate?.())&&options.context?.().databaseInitialized!==false)){state.phase='waiting-storage';const waited=Date.now();while(!hasTables(api.exportTableAsJson())){if(Date.now()>deadline)break;await sleep(100)}state.storageWait={ms:Date.now()-waited,found:hasTables(api.exportTableAsJson())}}
 else state.storageWait={skipped:true,cachedTables:hasTables(cached.database?.data),templateTables:hasTables(api.getTableTemplate?.())};
 let internal=false,connected=false,awaitingTables=false,conflictPanel,announced='',hydration=null,hydrationFailure=null,hydrationEpoch=0;
 const project=value=>Object.fromEntries(Object.entries(value||{}).map(([key,sheet])=>{if(!key.startsWith('sheet_')||!sheet||typeof sheet!=='object')return[key,sheet];const {_dshLastRowId:counter,...rest}=sheet;return[key,rest]}));
 const canonical=value=>JSON.stringify((function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v})(project(value)));
 async function importOriginal(data){
  internal=true;try{
   data=project(data);const template=structuredClone(data);
   for(const [key,sheet]of Object.entries(template))if(key.startsWith('sheet_')&&Array.isArray(sheet.content))sheet.content=sheet.content.slice(0,1);
   const schema=value=>Object.fromEntries(Object.entries(project(value)).filter(([key])=>key.startsWith('sheet_')).map(([key,sheet])=>[key,{...sheet,content:sheet.content?.slice(0,1)}]));
   if(hasTables(data)&&canonical(schema(data))!==canonical(schema(api.exportTableAsJson()))){const result=await api.importTemplateFromData(template,{scope:'chat',presetName:'DSH 已迁移表格',dataMode:'replace'});if(!result?.success)throw Error(result?.message||'原包模板导入失败，两份原件已保留。')}
   if(await api.importTableAsJson(JSON.stringify(data))===false)throw Error('原包表格导入失败，两份原件已保留。');
  }finally{internal=false}
 }
 // A chat template that DSH migrated can list hidden columns the table no longer
 // has. The original then refuses to build that table's fill prompt, so automatic
 // fills never start. Column names are read the way the original reads them: one
 // definition per top-level comma, comments and table constraints skipped.
 const ddlColumnNames=ddl=>{
  const text=String(ddl||''),names=[];let depth=0,quote='',current='';
  const push=()=>{const definition=current.trim();current='';if(!definition||/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(definition))return;const match=definition.match(/^([^\s,()]+)/);if(match)names.push(match[1])};
  for(let i=0;i<text.length;i++){
   const char=text[i];
   if(quote){current+=char;if(char===quote)quote='';continue}
   if(char==='-'&&text[i+1]==='-'){const end=text.indexOf('\n',i);i=end<0?text.length:end;current+=' ';continue}
   if(char==='/'&&text[i+1]==='*'){const end=text.indexOf('*/',i+2);i=end<0?text.length:end+1;current+=' ';continue}
   if(char==='('){if(depth++>0)current+=char;continue}
   if(depth===0)continue;
   if(char===')'){if(--depth===0)break;current+=char;continue}
   if(char==="'"||char==='"'||char==='`')quote=char;
   if(char===','&&depth===1)push();else current+=char;
  }
  push();return names;
 };
 // `ghosts` name neither a header nor a DDL column; `rejected` is every name the
 // original's projection refuses (it accepts only DDL names when the DDL has one
 // column per header).
 const hiddenColumnFaults=sheet=>{
  const hidden=sheet?.sourceData?.hiddenPhysicalColumns;if(!Array.isArray(hidden))return null;
  const lower=list=>new Set(list.map(name=>name.toLowerCase())),headers=(Array.isArray(sheet.content?.[0])?sheet.content[0]:[]).map(value=>String(value??'')),columns=ddlColumnNames(sheet.sourceData.ddl);
  const any=lower([...headers,...columns]),accepted=columns.length===headers.length?lower(columns):any,names=hidden.map(value=>String(value??'').trim()).filter(Boolean);
  return {ghosts:names.filter(name=>!any.has(name.toLowerCase())),rejected:names.filter(name=>!accepted.has(name.toLowerCase())),rows:Math.max(0,(sheet.content?.length||1)-1)};
 };
 // Only a table without rows is changed: there a ghost points at no cell, which
 // the original itself treats as harmless to drop. A table that holds rows is
 // reported and left to the user.
 function dropGhostHiddenColumns(data){
  const dropped=[],left=[];
  for(const [key,sheet]of Object.entries(data||{})){
   if(!key.startsWith('sheet_')||!sheet||typeof sheet!=='object')continue;
   const faults=hiddenColumnFaults(sheet);if(!faults?.rejected.length)continue;
   const label=String(sheet.name||key);
   if(faults.rows||!faults.ghosts.length){left.push({key,name:label,columns:faults.rejected,rows:faults.rows});continue}
   const ghosts=new Set(faults.ghosts.map(name=>name.toLowerCase())),kept=sheet.sourceData.hiddenPhysicalColumns.filter(name=>!ghosts.has(String(name??'').trim().toLowerCase()));
   if(kept.length)sheet.sourceData.hiddenPhysicalColumns=kept;else delete sheet.sourceData.hiddenPhysicalColumns;
   dropped.push({key,name:label,columns:faults.ghosts});
   if(faults.rejected.length>faults.ghosts.length)left.push({key,name:label,columns:faults.rejected.filter(name=>!ghosts.has(name.toLowerCase())),rows:0});
  }
  return {dropped,left};
 }
 // Runs once the original is this chat's authority, on a visible page only. The
 // header-only template goes through the original's public chat-template import
 // under the preset name the chat already uses; existing rows are not touched.
 // The original then re-emits every table's DDL and rewrites its worldbook
 // entries: dozens of host calls. Measured on a real game inside a background
 // instance, they take about 40% of its single-event budget when the host is
 // otherwise idle and exceeded the budget (failing the turn) while another
 // client was polling the host. A background instance therefore only reports
 // the fault and the repair waits for the game's page, which has no such
 // budget. Returns whether the tables changed, so the caller publishes them.
 async function repairHiddenColumns(){
  let dropped=[],left=[],failure='';const started=Date.now(),deferred=options.background===true;
  try{
   const template=structuredClone(project(api.exportTableAsJson()));({dropped,left}=dropGhostHiddenColumns(template));
   if(dropped.length&&!deferred){
    let scoped=win.SillyTavern.getContext().chatMetadata?.TavernDB_ACU_ScopedConfig;if(typeof scoped==='string')try{scoped=JSON.parse(scoped)}catch(_){scoped=null}
    const presetName=scoped?.template?.[api.__dshGetCurrentIsolationCode?.()??'']?.presetName;
    if(typeof presetName!=='string'||!presetName)failure='本局没有聊天级模板';
    else{
     for(const [key,sheet]of Object.entries(template))if(key.startsWith('sheet_')&&Array.isArray(sheet.content))sheet.content=sheet.content.slice(0,1);
     internal=true;try{const result=await api.importTemplateFromData(template,{scope:'chat',presetName,dataMode:'replace'});if(!result?.success)failure=String(result?.message||'原包拒绝了模板导入')}finally{internal=false}
     if(!failure){const after=api.exportTableAsJson(),remaining=dropped.filter(row=>hiddenColumnFaults(after?.[row.key])?.rejected.length);if(remaining.length)failure='导入后仍有 '+remaining.map(row=>row.name).join('、')}
    }
   }
  }catch(error){failure=String(error?.message||error)}
  const list=rows=>rows.map(row=>'「'+row.name+'」（'+row.columns.join('、')+'）').join('，');
  if(dropped.length&&deferred)win.console.error('[DSH] SP 聊天模板里空表的隐藏列名单指向不存在的列：'+list(dropped)+'。原包因此不会自动填表；打开一次本局页面即自动清理，后台实例不做这项修改。');
  else if(dropped.length&&!failure)win.console.warn('[DSH] 已清理本局 SP 聊天模板里空表的无效隐藏列：'+list(dropped)+'。这些名字不对应任何列，原包因此拒绝自动填表。清理经原包的聊天模板导入完成，原包同时按自己的格式重写了各表的建表语句（列定义不变）；表内数据未改动。');
  else if(dropped.length)win.console.error('[DSH] SP 聊天模板里空表的隐藏列名单指向不存在的列：'+list(dropped)+'，自动清理未完成（'+failure+'）。原包在修正前不会自动填表。');
  else if(failure)win.console.error('[DSH] SP 隐藏列检查失败：'+failure);
  if(left.length)win.console.error('[DSH] SP 表的隐藏列名单指向不存在的列：'+list(left)+'。这些表已有数据或名单与列定义不一致，未自动修改；原包在修正前不会自动填表，请在原包的模板编辑里处理。');
  state.hiddenColumnRepair={[deferred?'deferred':'dropped']:dropped.map(row=>row.key),left:left.map(row=>row.key),ms:Date.now()-started,...(failure?{error:failure}:{})};
  return dropped.length>0&&!failure&&!deferred;
 }
 const lifecycle=Number(options.context().lifecycleRevision)||0;
 const bridge=options.createAuthorityBridge({initialRevision:cached.database?.authority?.revision||0,lifecycle,getOriginalApi:()=>win.AutoCardUpdaterAPI===api?api:null,call:options.call,importOriginal,
  onStatus:status=>{const ready=status.ready&&connected&&!hydration&&!hydrationFailure&&!state.retired&&win.AutoCardUpdaterAPI===api&&Number(options.context().lifecycleRevision)===lifecycle;Object.assign(state,status,{ready,cacheOnly:!ready});if(hydration)state.phase='hydrating';if(hydrationFailure){state.phase='unavailable';state.error=hydrationFailure.message}options.post?.({type:'dsh-tavern-original-database-ready',ready,names:api.getTemplatePresetNames?.()||[]});if(ready){delete state.error;delete state.notice;if(conflictPanel){conflictPanel.remove();conflictPanel=null}}},
  mutateOriginal:async operation=>{
   if(operation.kind==='mutate'){
    const original=structuredClone(api.exportTableAsJson()),originalScope=api.__dshGetCurrentIsolationCode?.()??null,prepared=await options.call('prepareTavernOriginalDatabaseMutation',{command:operation.command,expectedRevision:operation.expectedRevision,original});
    if(prepared?.rejected?.code==='stale-database-unapplied'){
     const basis=prepared.basis,live=()=>!state.retired&&!bridge.getState().closed&&bridge.getState().ready&&bridge.getState().revision===basis?.authority&&Number(options.context().lifecycleRevision)===basis?.lifecycle&&win.AutoCardUpdaterAPI===api;
     const unchanged=()=>canonical(original)===canonical(api.exportTableAsJson())&&originalScope===(api.__dshGetCurrentIsolationCode?.()??null)&&originalScope===basis?.isolationCode;
     if(!basis||!live()||!unchanged())throw Error('表格已变化，请刷新后重试');
     // Reuses the exact prepare RPC owner/lifecycle checks. The operation only
     // validates current cache/authority/story/content; it never computes SQL.
     const checked=await options.call('prepareTavernOriginalDatabaseMutation',{command:{kind:'validate-unapplied',basis},expectedRevision:{database:basis.database,branch:basis.branch,story:basis.story},original:structuredClone(api.exportTableAsJson())});
     if(checked?.validated!==true||JSON.stringify(checked.basis)!==JSON.stringify(basis)||!live()||!unchanged())throw Error('表格已变化，请刷新后重试');
     throw Object.assign(new Error(String(prepared.rejected.message)),{dshUnapplied:true});
    }
    if(prepared?.rejected){if(prepared.rejected.code)throw Error('原包写入拒绝类型无效。');throw Object.assign(new Error(String(prepared.rejected.message||'SQL 执行失败')),{dshUnapplied:true})}
    if(canonical(original)!==canonical(api.exportTableAsJson()))throw Error('原版表格已变化，请刷新。');await importOriginal(prepared.data);return {changes:prepared.changes};
   }
   internal=true;try{
    if(operation.kind==='fill')return await api.manualUpdate();
    if(operation.kind==='import')return await api.importTemplateFromData(operation.data,{scope:operation.scope||'global',presetName:operation.name,dataMode:operation.dataMode,conflictPolicy:operation.conflictPolicy});
    if(operation.kind==='select')return await api.switchTemplatePreset(operation.name,{scope:operation.scope||'global'});
    throw Error('SP 原包操作无效。');
   }finally{internal=false}
  }});
 state.publishTrace=bridge.trace();
 // Only the host's formal CHAT_CHANGED handler owns this work. The original
 // clears derived memory and emits persisted=true before its awaited hydration;
 // that empty callback is an intent, not an empty persisted checkpoint.
 win.__dshBeginOriginalDatabaseHydration=()=>{
  if(['choice','claiming'].includes(state.phase))return async error=>{if(error)bridge.unavailable(error)};
  if(!hydration)hydrationFailure=null;
  const work=hydration||(hydration={count:0,confirmed:false,error:null,epoch:++hydrationEpoch,scope:api.__dshGetCurrentIsolationCode?.(),lifecycle:Number(options.context().lifecycleRevision)});
  work.count++;bridge.hydrating();let finished=false;
  return async error=>{
   if(finished)return;finished=true;if(error)work.error||=error;
   if(--work.count)return;
   hydration=null;
   if(work.error){hydrationFailure=work.error;if(!bridge.getState().closed)bridge.unavailable(work.error);return}
   const validate=()=>{if(state.retired||bridge.getState().closed||work.epoch!==hydrationEpoch||win.AutoCardUpdaterAPI!==api||api.__dshGetCurrentIsolationCode?.()!==work.scope||Number(options.context().lifecycleRevision)!==work.lifecycle){
    const failure=Error('SP 水合所属实例、局或生命周期已变化，保留最后缓存。');hydrationFailure=failure;if(!bridge.getState().closed)bridge.unavailable(failure);throw failure;
   }};
   validate();
   // Re-export inside the ordinary queue and validate even an unchanged stamp:
   // hydration must not recover readiness by skipping the host lifecycle/CAS.
   await bridge.publish(work.confirmed,undefined,'hydration',validate);
  };
 };
 // `awaitOriginalWork` is false only for an ordinary event on a visible page: the
 // original's deferred table fill then stays parallel to the next send.
 win.__dshFlushOriginalDatabase=async({retry=false,recoveryCall,awaitOriginalWork=true}={})=>{if(awaitOriginalWork)await api.__dshFlushPendingWork?.();if(retry){if(hydration)throw Error('SP 原包正在加载本局表格，当前仅可查看缓存。');const failedHydration=hydrationFailure;hydrationFailure=null;await bridge.publish(true,recoveryCall,failedHydration?'hydration':'retry')}await bridge.flush({settle:awaitOriginalWork,call:recoveryCall});await options.flushSettings?.(recoveryCall);};
 const initial=await bridge.connect();connected=true;
 if(initial.phase==='choice'||initial.phase==='claiming'){
  conflictPanel=win.document.createElement('section');conflictPanel.setAttribute('role','alert');conflictPanel.style.cssText='position:fixed;inset:12px 12px auto;z-index:2147483647;background:Canvas;color:CanvasText;padding:16px;border:1px solid #b88';
  const text=win.document.createElement('p');text.textContent='SP 旧数据存在差异，两份原件均已保留。请选择一次本局继续使用的数据；之后由原包唯一写入。';conflictPanel.append(text);
  for(const [side,label]of [['original','使用原版 SP 这份'],['host','使用 DSH 这份']]){const button=win.document.createElement('button');button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await win.__dshResolveDatabaseConflict(side)}catch(error){text.textContent=error.message;button.disabled=false}};conflictPanel.append(button)}win.document.body.append(conflictPanel);
 }else{
  await repairHiddenColumns();
  try{await bridge.publish(false,undefined,'connect')}
  catch(error){if(!awaitTablesAfter(error,'connect'))throw error}
 }
 win.__dshResolveDatabaseConflict=async side=>{await bridge.choose(side);if(await repairHiddenColumns())await bridge.publish(true,undefined,'resolve');return {resolved:true,reloadRequired:false}};
 api.registerTableUpdateCallback((_data,meta)=>{if(internal)return;const persisted=meta?.persisted===true,skipped=state.retired?'retired':!connected?'not-connected':meta?.persisted===false?'not-persisted':['choice','claiming'].includes(state.phase)?state.phase:hydrationFailure?'hydration-failed':awaitingTables&&!persisted&&!hasTables(api.exportTableAsJson())?'awaiting-tables':'';if(skipped){bridge.note({source:'original-callback',persisted,skipped});return}if(hydration&&!hasTables(api.exportTableAsJson())){hydration.confirmed||=persisted;bridge.note({source:'original-callback',persisted,skipped:'owned-hydration'});return}return bridge.publish(persisted,undefined,'callback').catch(error=>{if(!awaitTablesAfter(error,'callback'))win.toastr?.error?.(error.message)})});
 win.__dshOriginalDatabaseCatalogChanged=()=>{const names=api.getTemplatePresetNames?.()||[],signature=JSON.stringify(names);if(signature!==announced){announced=signature;options.post?.({type:'dsh-tavern-original-database-ready',ready:state.ready===true,names})}};
 win.__dshOriginalDatabaseCommand=async operation=>{
  if(operation.kind==='list')return {success:true,names:api.getTemplatePresetNames?.()||[]};
  if(hydration||hydrationFailure||state.retired||win.AutoCardUpdaterAPI!==api||Number(options.context().lifecycleRevision)!==lifecycle)throw Error('SP 原包正在加载本局表格、加载失败或所属实例已变化，当前仅可查看缓存。');
  const result=await bridge.mutate(operation);await options.flushSettings?.();win.__dshOriginalDatabaseCatalogChanged();
  const {database}=await options.call('getSpDatabase');return {...result,names:api.getTemplatePresetNames?.()||[],database};
 };
 win.__dshOriginalDatabaseCatalogChanged();
 win.addEventListener('pagehide',()=>bridge.close(),{once:true});
 // Profile migration is independent of this chat's retained two-sided pair.
 let migrated=false;
 async function afterReady(){if(migrated)return;migrated=true;const {migration}=await options.call('tavernHelperDatabaseTemplates',{operation:{kind:'migration-status'}});if(migration?.status==='blocked')throw Error(migration.error||'原版模板迁移被阻止，原件保留。');if(migration?.status==='completed'&&migration.defaultStatus==='pending'){if(migration.defaultName){const result=await api.switchTemplatePreset(migration.defaultName,{scope:'global'});if(!result?.success)throw Error(result?.message||'恢复全局模板选择失败')}await options.flushSettings?.();await options.call('tavernHelperDatabaseTemplates',{operation:{kind:'migration-default-applied',name:migration.defaultName}})}}
 if(bridge.getState().ready)await afterReady();
 return bridge;
 // R8 Z78: the original can export no tables for a while: when its checkpoint
 // hydration outlasts the wait above, or for a few seconds mid-session (real-Home
 // SP multi: a persisted empty notification about 2.6 s after connecting, the 19
 // tables back afterwards). The host refuses such an export and keeps the last
 // cache, but the frame then stayed unavailable for good: at startup the refusal
 // failed the connection before the update callback existed, and later no further
 // notification came. The host's refusal decides (the client's cache view is per
 // isolation slot). After a refused export without tables the frame waits, cache-only
 // and without an error, and publishes the tables once they are back (at once if they
 // already are); refusing an export with tables stays an ordinary failure. The
 // profile migration step runs once ready.
 function awaitTablesAfter(error,source){
  // Decide by what was refused: the tables can be back before the refusal arrives.
  if(error?.dshPublishedTables!==0)return false;
  state.hydrationRetry={refused:String(error?.message||error).slice(0,200),source,at:Date.now()};
  bridge.awaitTables('SP 原包表格暂时为空（加载或切换中），当前仅可查看缓存；表格恢复后自动连接。');
  if(!awaitingTables){awaitingTables=true;void watchTables().catch(error=>{awaitingTables=false;if(!state.retired)bridge.unavailable(error)})}
  return true;
 }
 async function watchTables(){
  const until=Date.now()+600000,stopped=()=>state.retired||bridge.getState().closed;
  while(!bridge.getState().ready&&!hasTables(api.exportTableAsJson())){
   if(stopped())return;
   if(Date.now()>until)throw Error('SP 原包 10 分钟内没有恢复表格，当前仅可查看缓存；原包保存表格后会自动连接，也可刷新页面重试。');
   await sleep(500);
  }
  if(stopped())return;
  awaitingTables=false;
  if(!bridge.getState().ready){if(state.hydrationRetry.source==='connect')await repairHiddenColumns();await bridge.publish(false,undefined,'tables-back')}
  state.hydrationRetry={...state.hydrationRetry,connectedAfterMs:Date.now()-state.hydrationRetry.at};
  await afterReady();
 }
}

function requestTavernSpPanelCommand(sessionId,operation){
 return new Promise((resolve,reject)=>{const detail={sessionId,operation,resolve,reject,accepted:false};window.dispatchEvent(new CustomEvent('dsh-tavern-database-panel-command',{detail}));if(!detail.accepted)reject(Error('SP 原包执行者未就绪，当前仅可查看缓存；请恢复原包或打开拥有执行权的页面。'))});
}
