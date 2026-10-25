// Routes a script's template operation to the installed original database.
// Every message is already authenticated against its iframe by the runtime.
function createTavernDatabaseProviderRouter({ records, post, schedule=setTimeout, cancel=clearTimeout }) {
 const pending=new Map();let sequence=0;
 const isProvider=record=>record.scripts.has('extension-sp-database');
 const current=record=>records.get(record.id)===record;
 // Shared-realm initialization flags summarize multiple script handlers.
 // Only the dedicated remote owner's work failure identifies SP itself;
 // caller admission uses its script and parent-event lifetime instead.
 const providerFailed=record=>(record.remoteOwner===true||record.scripts.size===1)&&record.initializationWorkFailed===true||record.initializationCancelled===true||record.scripts.get('extension-sp-database')?.initializationFailed===true;
 function valid(entry){return current(entry.caller)&&current(entry.provider)&&entry.caller.initializationCancelled!==true&&(entry.caller.scripts.size!==1||entry.caller.initializationWorkFailed!==true)&&(entry.panel||!providerFailed(entry.provider))&&isProvider(entry.provider)&&(!entry.scriptId||entry.caller.scripts.has(entry.scriptId)&&entry.caller.scripts.get(entry.scriptId)?.initializationFailed!==true)&&(!entry.provider.remoteOwner||entry.attachment===entry.provider.remoteAttached)&&sameChat(entry.caller,entry.provider)&&entry.sessionId===entry.provider.sessionId&&entry.chatId===entry.provider.context.chatId&&entry.lifecycleRevision===Number(entry.provider.context.lifecycleRevision||0)&&entry.isCurrent?.()!==false}
 function rejectUnsent(id,entry,message){if(pending.get(id)!==entry||entry.sent)return;pending.delete(id);cancel(entry.timer);entry.reject(Object.assign(Error(message),{code:'SP_DATABASE_NOT_EXECUTED',notExecuted:true}))}
 function sameChat(a,b){return a.sessionId===b.sessionId&&a.context.chatId===b.context.chatId&&Number(a.context.lifecycleRevision||0)===Number(b.context.lifecycleRevision||0)}
 function catalog(provider,names){
  provider.databaseCatalog=Array.isArray(names)?names.filter(n=>typeof n==='string').slice(0,2000):[];
  for(const record of records.values())if(sameChat(provider,record)){
   record.context.originalDatabaseTemplates=provider.databaseCatalog.slice();
   post(record,{type:'dsh-tavern-helper-context',context:{chatId:record.context.chatId,lifecycleRevision:record.context.lifecycleRevision,originalDatabaseTemplates:provider.databaseCatalog}});
  }
 }
 function dispatch(id,entry){
  if(pending.get(id)!==entry||entry.awaitingAttachment||entry.offered||!entry.provider.databaseReady&&entry.operation.kind!=='zero-stop')return;
  entry.offered=true;
  const canSend=()=>{
   if(pending.get(id)!==entry||entry.sent)return false;
   if(!valid(entry)){
    rejectUnsent(id,entry,'聊天、事件或初始化已变化，数据库调用已失效');return false;
   }
   return true;
  };
  const begin=()=>{
   if(!canSend())return false;
   entry.sent=true;
   if(!entry.panel){
    cancel(entry.timer);
    entry.timer=schedule(()=>{if(pending.get(id)!==entry)return;pending.delete(id);entry.reject(Object.assign(Error('原数据库模板执行回执超时，操作可能已执行，请检查原包保存状态；不要重复提交'),{code:'SP_DATABASE_EXECUTION_TIMEOUT',notExecuted:false,mayHaveExecuted:true}));},60000);
   }
   return true;
  };
  try{post(entry.provider,{type:'dsh-tavern-original-database-command',requestId:id,operation:entry.operation,chatId:entry.chatId,lifecycleRevision:entry.lifecycleRevision},{canSend,begin})}
  catch(error){if(pending.get(id)===entry){pending.delete(id);cancel(entry.timer);entry.reject(error)}}
 }
 function request(caller,args,{isCurrent}={}){
  const provider=[...records.values()].find(r=>isProvider(r)&&sameChat(r,caller));
  if(!provider||provider===caller)return null;
  if(!caller.scripts.has(args.scriptId)||Number(args.expectedLifecycleRevision)!==Number(caller.context.lifecycleRevision||0))return Promise.reject(Error('数据库调用已失效'));
  if(!['list','import','select','mutate','fill'].includes(args.operation?.kind))return Promise.reject(Error('模板操作无效'));
  // A directory snapshot must not serialize every script's bootstrap behind SP.
  // Real imports and switches still wait for the installed provider.
  if(args.operation.kind==='list'&&args.operation.bootstrap===true)return Promise.resolve({names:provider.databaseCatalog?.slice()||[]});
  const id='database-command-'+(++sequence);
  return new Promise((resolve,reject)=>{
   const awaitingAttachment=provider.remoteOwner===true&&provider.remoteAttachmentPending===true&&typeof provider.remoteAttached?.then==='function';
   const timer=awaitingAttachment?null:schedule(()=>{const entry=pending.get(id);if(!entry||entry.sent)return;pending.delete(id);reject(Object.assign(Error('原数据库模板等待就绪超时，操作未发送'),{code:'SP_DATABASE_WAIT_TIMEOUT',notExecuted:true}));},60000);
   const entry={caller,provider,resolve,reject,timer,isCurrent,awaitingAttachment,operation:args.operation,chatId:caller.context.chatId,lifecycleRevision:Number(caller.context.lifecycleRevision||0)};
   entry.scriptId=args.scriptId;entry.sessionId=caller.sessionId;entry.attachment=provider.remoteAttached;
   pending.set(id,entry);
   if(!valid(entry)){rejectUnsent(id,entry,'聊天、事件或初始化已变化，数据库调用已失效');return}
   if(awaitingAttachment){
    // The initial owner connection owns its bounded wait and explicit recovery.
    // Readiness notifications alone cannot renew or bypass that connection.
    entry.attachment.then(()=>{
     if(pending.get(id)!==entry)return;
     entry.awaitingAttachment=false;
     if(!valid(entry)||provider.databaseReady!==true){rejectUnsent(id,entry,'原数据库初始连接或调用身份已失效，操作未发送');return}
     dispatch(id,entry);
    },()=>rejectUnsent(id,entry,'原数据库初始连接失败，操作未发送'));
   }else dispatch(id,entry);
  });
 }
 function receive(record,data){
  if(data.type==='dsh-tavern-original-database-ready'){
   if(!isProvider(record))return true;
   record.databaseReady=data.ready!==false;catalog(record,data.names);
   for(const[id,entry]of pending)if(entry.provider===record)dispatch(id,entry);
   return true;
  }
  if(data.type!=='dsh-tavern-original-database-result')return false;
  const entry=pending.get(data.requestId);if(!entry||entry.provider!==record)return true;
  pending.delete(data.requestId);cancel(entry.timer);
  if(!current(entry.caller)||!sameChat(record,entry.caller)||entry.chatId!==record.context.chatId||entry.lifecycleRevision!==Number(record.context.lifecycleRevision||0)){entry.reject(Error('聊天已切换，数据库调用已失效'));return true}
  if(data.ok){if(data.result?.names)catalog(record,data.result.names);entry.resolve(data.result)}else entry.reject(Error(data.error||'原数据库模板操作失败'));
  return true;
 }
 function remove(record,retiringRecords){
  for(const[id,entry]of pending)if(entry.caller===record||entry.provider===record){pending.delete(id);cancel(entry.timer);entry.reject(Error('数据库脚本已重新加载，请重试'))}
  if(isProvider(record))for(const other of records.values())if(other!==record&&sameChat(other,record)){
   delete other.context.originalDatabaseTemplates;
   // Bulk teardown still clears metadata and rejects work, but these exact
   // retiring realms cannot consume another full projected context.
   if(!retiringRecords?.has(other))post(other,{type:'dsh-tavern-helper-context',context:{originalDatabaseTemplates:null}});
  }
 }
 function requestPanel(sessionId,operation,expected){
  const provider=[...records.values()].find(record=>isProvider(record)&&record.sessionId===sessionId&&current(record));
  if(expected&&(!provider||provider.id!==expected.id||provider.context.chatId!==expected.chatId||Number(provider.context.lifecycleRevision||0)!==expected.lifecycleRevision))return Promise.reject(Error('原数据库实例已变化，操作已取消'));
  if(!provider||!provider.databaseReady&&operation.kind!=='zero-stop')return Promise.reject(Error('SP 原包未就绪，当前仅可查看缓存。'));
  const id='database-panel-'+(++sequence);
  return new Promise((resolve,reject)=>{const timer=schedule(()=>{pending.delete(id);reject(Error('SP 原包操作超时，缓存保持只读。'));},60000),entry={caller:provider,provider,resolve,reject,timer,panel:true,operation,sessionId:provider.sessionId,attachment:provider.remoteAttached,chatId:provider.context.chatId,lifecycleRevision:Number(provider.context.lifecycleRevision||0)};pending.set(id,entry);dispatch(id,entry)});
 }
 function invalidate(){for(const[id,entry]of pending)if(!entry.sent&&!valid(entry))rejectUnsent(id,entry,'聊天、事件或初始化已变化，数据库调用已失效')}
 return {request,requestPanel,receive,remove,invalidate};
}
