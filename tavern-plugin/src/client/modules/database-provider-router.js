// Routes a script's template operation to the installed original database.
// Every message is already authenticated against its iframe by the runtime.
function createTavernDatabaseProviderRouter({ records, post, schedule=setTimeout, cancel=clearTimeout }) {
 const pending=new Map();let sequence=0;
 const isProvider=record=>record.scripts.has('extension-sp-database');
 const current=record=>records.get(record.id)===record;
 function sameChat(a,b){return a.sessionId===b.sessionId&&a.context.chatId===b.context.chatId&&Number(a.context.lifecycleRevision||0)===Number(b.context.lifecycleRevision||0)}
 function catalog(provider,names){
  provider.databaseCatalog=Array.isArray(names)?names.filter(n=>typeof n==='string').slice(0,2000):[];
  for(const record of records.values())if(sameChat(provider,record)){
   record.context.originalDatabaseTemplates=provider.databaseCatalog.slice();
   post(record,{type:'dsh-tavern-helper-context',context:{chatId:record.context.chatId,lifecycleRevision:record.context.lifecycleRevision,originalDatabaseTemplates:provider.databaseCatalog}});
  }
 }
 function dispatch(id,entry){
  if(entry.sent||!entry.provider.databaseReady)return;
  entry.sent=true;
  post(entry.provider,{type:'dsh-tavern-original-database-command',requestId:id,operation:entry.operation,chatId:entry.chatId,lifecycleRevision:entry.lifecycleRevision});
 }
 function request(caller,args){
  const provider=[...records.values()].find(r=>isProvider(r)&&sameChat(r,caller));
  if(!provider||provider===caller)return null;
  if(!caller.scripts.has(args.scriptId)||Number(args.expectedLifecycleRevision)!==Number(caller.context.lifecycleRevision||0))return Promise.reject(Error('数据库调用已失效'));
  if(!['list','import','select','mutate','fill'].includes(args.operation?.kind))return Promise.reject(Error('模板操作无效'));
  // A directory snapshot must not serialize every script's bootstrap behind SP.
  // Real imports and switches still wait for the installed provider.
  if(args.operation.kind==='list'&&args.operation.bootstrap===true)return Promise.resolve({names:provider.databaseCatalog?.slice()||[]});
  const id='database-command-'+(++sequence);
  return new Promise((resolve,reject)=>{
   const timer=schedule(()=>{pending.delete(id);reject(Error('原数据库模板操作超时，请检查数据库运行日志'));},60000);
   const entry={caller,provider,resolve,reject,timer,operation:args.operation,chatId:caller.context.chatId,lifecycleRevision:Number(caller.context.lifecycleRevision||0)};
   pending.set(id,entry);dispatch(id,entry);
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
 function remove(record){
  for(const[id,entry]of pending)if(entry.caller===record||entry.provider===record){pending.delete(id);cancel(entry.timer);entry.reject(Error('数据库脚本已重新加载，请重试'))}
  if(isProvider(record))for(const other of records.values())if(other!==record&&sameChat(other,record)){
   delete other.context.originalDatabaseTemplates;
   post(other,{type:'dsh-tavern-helper-context',context:{originalDatabaseTemplates:null}});
  }
 }
 function requestPanel(sessionId,operation){
  const provider=[...records.values()].find(record=>isProvider(record)&&record.sessionId===sessionId&&current(record));
  if(!provider||!provider.databaseReady)return Promise.reject(Error('SP 原包未就绪，当前仅可查看缓存。'));
  const id='database-panel-'+(++sequence);
  return new Promise((resolve,reject)=>{const timer=schedule(()=>{pending.delete(id);reject(Error('SP 原包操作超时，缓存保持只读。'));},60000),entry={caller:provider,provider,resolve,reject,timer,operation,chatId:provider.context.chatId,lifecycleRevision:Number(provider.context.lifecycleRevision||0)};pending.set(id,entry);dispatch(id,entry)});
 }
 return {request,requestPanel,receive,remove};
}
