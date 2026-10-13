// Shared DOM and persistence interfaces for original SillyTavern extensions.
function installTavernExtensionHost(win, options) {
 const doc=win.document, sleep=ms=>new Promise(r=>win.setTimeout(r,ms));
 let descriptor=null, nativeDatabase=null, commandTail=Promise.resolve();
 win.__dshInstallExtensionHost=async function(input){
  descriptor=input;nativeDatabase=win.AutoCardUpdaterAPI;
  const bound=new Map();let host;host=new Proxy(win,{get(target,key){if(['window','self','parent','top'].includes(key))return host;const value=Reflect.get(target,key,target);if(typeof value==='function'&&!value.prototype){if(!bound.has(value))bound.set(value,value.bind(target));return bound.get(value)}return value},set(target,key,value){return Reflect.set(target,key,value,target)}});win.__dshExtensionWindow=host;
  if(!doc.body)await new Promise(r=>doc.addEventListener('DOMContentLoaded',r,{once:true}));
  if(!win.__dshUiJQuery){await new Promise((resolve,reject)=>{const s=doc.createElement('script');s.src='/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js';s.onload=resolve;s.onerror=()=>reject(Error('扩展 jQuery 加载失败'));doc.head.appendChild(s)});win.__dshUiJQuery=win.jQuery.noConflict(true)}
  win.jQuery=win.$=win.__dshUiJQuery;
  for(const id of ['extensionsMenu','extensions_settings','extensions_settings2','top-settings-holder']){let node=doc.getElementById(id);if(!node){node=doc.createElement('div');node.id=id;doc.body.appendChild(node)}node.hidden=false}
  const style=doc.createElement('style');style.textContent='html,body{margin:0;min-height:100%;background:#202529;color:#e2e6e9;font:14px system-ui}#extensionsMenu{padding:12px;display:flex;gap:12px;flex-wrap:wrap}.list-group-item{cursor:pointer;padding:10px;border:1px solid #4e5f63;border-radius:8px}';doc.head.appendChild(style);
  if(input.style){const packageStyle=doc.createElement('style');packageStyle.textContent=String(input.style);doc.head.appendChild(packageStyle)}
  win.__dshOriginalExtensionState={...input,ready:false};
  win.addEventListener('pagehide',()=>{win.__dshOriginalExtensionState.retired=true;win.__dshOriginalExtensionState.ready=false},{capture:true,once:true});
  win.__dshOpenExtension=()=>{const menu=doc.querySelector('#extensionsMenu .list-group-item, #extensionsMenu button');if(menu)menu.click()};
 };
 // SP owns its original UI/storage, while every other script reads the host's
 // AutoCardUpdaterAPI. Exchange committed tables through that existing API.
 win.__dshConnectOriginalDatabase=async function(){
  if(descriptor?.id==='sp-database')return options.connectSingleAuthority(win,options,nativeDatabase,descriptor);
 };
 win.addEventListener('message',event=>{
  const data=event.data;if(event.source!==win.parent||data?.token!==options.token)return;
  if(data.type==='dsh-tavern-extension-open'){win.__dshOpenExtension?.();return}
  if(data.type!=='dsh-tavern-original-database-command')return;
  const task=commandTail.catch(()=>{}).then(async()=>{
   const context=options.context();if(data.chatId!==context.chatId||Number(data.lifecycleRevision)!==Number(context.lifecycleRevision||0))throw Error('聊天已切换，模板操作已取消');
   if(!win.__dshOriginalExtensionState?.ready||!win.__dshOriginalDatabaseCommand)throw Error('原数据库尚未就绪');
   return win.__dshOriginalDatabaseCommand(data.operation);
  });commandTail=task;
  task.then(result=>options.post({type:'dsh-tavern-original-database-result',requestId:data.requestId,ok:true,result}),error=>options.post({type:'dsh-tavern-original-database-result',requestId:data.requestId,ok:false,error:String(error.message||error)}));
 });
}
