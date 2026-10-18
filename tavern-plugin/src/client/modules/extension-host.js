// Shared DOM and persistence interfaces for original SillyTavern extensions.
function installTavernExtensionHost(win, options) {
 const doc=win.document, sleep=ms=>new Promise(r=>win.setTimeout(r,ms));
 let descriptor=null, nativeDatabase=null, commandTail=Promise.resolve();
 win.__dshInstallExtensionHost=async function(input){
  descriptor=input;nativeDatabase=win.AutoCardUpdaterAPI;
  // Original request gates compare endpoints with the owning host URL. srcdoc's
  // about: URL is not that endpoint; expose the actual authenticated document
  // base as a read-only URL, without granting parent DOM or navigation access.
  const baseUrl=new URL(doc.baseURI),hostLocation=Object.freeze({href:baseUrl.href,origin:baseUrl.origin,protocol:baseUrl.protocol,host:baseUrl.host,hostname:baseUrl.hostname,port:baseUrl.port,pathname:baseUrl.pathname,search:baseUrl.search,hash:baseUrl.hash,toString:()=>baseUrl.href});
  const nativeRequestLocation=input.id==='sp-database'&&input.version==='1.2.9';
  if(nativeRequestLocation&&options.persistentOwner===true){
   const owner=()=>({scriptId:'extension-sp-database',lifecycleRevision:Number(options.context().lifecycleRevision)||0});
   const canonical=await options.call('getTavernSpOwnedTaskIdentity',{},owner());
   win.__dshSpOwnedTaskIdentity=()=>({...canonical});
   const methods={Register:'registerTavernSpOwnedTask',Cancel:'cancelTavernSpOwnedTask',Dispatch:'dispatchTavernSpOwnedTask',Checkpoint:'checkpointTavernSpOwnedTask',AssertOwner:'assertTavernSpOwnedTask',Command:'commandTavernSpOwnedTask',PrepareSaveRetry:'prepareTavernSpOwnedSaveRetry'};
   for(const [name,method]of Object.entries(methods))win['__dshSpOwnedTask'+name]=(payload,recovery)=>options.call(method,{payload},recovery?{...owner(),spRecoveryToken:recovery.token}:owner());
   win.__dshCaptureSpOwnedTaskRegister=()=>{
    if(typeof options.captureOwner!=='function')throw Error('SP 注册事件身份捕获入口不可用');
    const captured=Object.freeze({...owner(),eventId:String(options.captureOwner().eventId||'')});
    return payload=>options.call('registerTavernSpOwnedTask',{payload},captured);
   };
   win.__dshSpOwnedSaveCall=recovery=>{
    if(!recovery?.token||!recovery.taskId)throw Error('SP 专用保存能力缺失');
    const savedOwner=Object.freeze({...owner(),spRecoveryToken:recovery.token});
    return (method,args)=>{if(!['saveTavernChatData','saveTavernExtensionSettings','publishTavernSpAuthorityCache'].includes(method))throw Error('SP 恢复仅允许保存');return options.call(method,args,savedOwner);};
   };
   win.__dshSpOwnedTaskOwnerCommand=payload=>options.call('commandTavernSpOwnedTask',{payload},owner());
   win.__dshSpOwnedModelStep=payload=>options.call('modelTavernSpOwnedTask',{payload},owner());
   win.__dshSpOwnedTasksEnabled=true;
  }
  if(nativeRequestLocation)win.__dshAssertSpNativeInput=stamp=>{
   const state=options.context(),chat=win.SillyTavern.getContext().chat,row=chat[stamp?.floor];
   if(!stamp||stamp.version!==1||typeof stamp.operationId!=='string'||!stamp.operationId||stamp.chatId!==state.chatId||state.nativeInput?.operationId!==stamp.operationId||state.nativeInput?.floor!==stamp.floor||state.nativeInput?.branchId!==stamp.branchId||stamp.lifecycleRevision!==Number(state.lifecycleRevision||0)||stamp.floor!==chat.length-1||!row?.is_user)throw Error('原生输入准入身份已变化');
  };
  if(nativeRequestLocation)win.__dshSpWebFetch=async(path,init)=>{
   if(String(init.method||'GET').toUpperCase()!=='POST'||typeof init.body!=='string')throw Error('网页请求必须使用 JSON POST');
   init.signal?.throwIfAborted();
   const requestId=win.crypto.randomUUID(),body=JSON.parse(init.body),owner={scriptId:'extension-sp-database',lifecycleRevision:Number(options.context().lifecycleRevision)||0};
   const abort=()=>{void options.call('tavernSpWebRequest',{operation:{kind:'cancel',requestId}},owner).catch(()=>{})};
   init.signal?.addEventListener('abort',abort,{once:true});
   try{const result=await options.call('tavernSpWebRequest',{operation:{path,body,requestId}},owner);init.signal?.throwIfAborted();return new win.Response([204,205,304].includes(result.status)?null:result.body,{status:result.status,headers:{'content-type':result.contentType}})}
   finally{init.signal?.removeEventListener('abort',abort)}
  };

  const bound=new Map();let host;host=new Proxy(win,{get(target,key){if(['window','self','parent','top'].includes(key))return host;if(key==='location'&&nativeRequestLocation)return hostLocation;const value=Reflect.get(target,key,target);if(typeof value==='function'&&!value.prototype){if(!bound.has(value))bound.set(value,value.bind(target));return bound.get(value)}return value},set(target,key,value){if(key==='location'&&nativeRequestLocation)throw Error('扩展不能导航宿主');return Reflect.set(target,key,value,target)}});win.__dshExtensionWindow=host;
  if(!doc.body)await new Promise(r=>doc.addEventListener('DOMContentLoaded',r,{once:true}));
  if(!win.__dshUiJQuery){await new Promise((resolve,reject)=>{const s=doc.createElement('script');s.src='/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js';s.onload=resolve;s.onerror=()=>reject(Error('扩展 jQuery 加载失败'));doc.head.appendChild(s)});win.__dshUiJQuery=win.jQuery.noConflict(true)}
  win.jQuery=win.$=win.__dshUiJQuery;
  for(const id of ['extensionsMenu','extensions_settings','extensions_settings2','top-settings-holder']){let node=doc.getElementById(id);if(!node){node=doc.createElement('div');node.id=id;doc.body.appendChild(node)}node.hidden=false}
  const style=doc.createElement('style');style.textContent='html,body{margin:0;min-height:100%;background:#202529;color:#e2e6e9;font:14px system-ui}#extensionsMenu{padding:12px;display:flex;gap:12px;flex-wrap:wrap}.list-group-item{cursor:pointer;padding:10px;border:1px solid #4e5f63;border-radius:8px}';doc.head.appendChild(style);
  if(input.style){const packageStyle=doc.createElement('style');packageStyle.textContent=String(input.style);doc.head.appendChild(packageStyle)}
  win.__dshOriginalExtensionState={...input,ready:false,phase:'host-installed'};
  if(input.id==='sp-database'&&input.version==='1.2.9'){
   let closed=false,channelReady=false,readyEpoch=0,frames=[];
   win.addEventListener('message',event=>{if(event.source===win.parent&&event.data?.token===options.token&&event.data.type==='dsh-tavern-sp-game-state'){readyEpoch++;channelReady=event.data.ready===true}});
   const invoke=(kind,value={})=>options.call('tavernSpZeroLayerView',{operation:{kind,...value}});
   const update=value=>({carrierIndex:value.carrierIndex,update:{snapshot:value.snapshot,body:value.body,preview:value.preview??null},expectedOrigin:value.expectedOrigin,frameToken:value.frameToken});
   win.__dshSpView={
    async mount(value){closed=false;channelReady=false;const result=await invoke('mount',update(value));if(result?.mounted!==true)throw Error('零层真实载体尚未挂载');frames=result.frames||[];return result},
    async publish(value){if(closed)throw Error('零层显示已退出');const result=await invoke('publish',update(value));if(result?.mounted!==true)throw Error('零层真实载体尚未挂载');frames=result.frames||[];return result},
    frames:()=>frames.map(frame=>({...frame})),
    bindGameFrame(value){if(closed)throw Error('零层显示已退出');let disposed=false;const epoch=readyEpoch,task=invoke('bind',update(value)).then(result=>{if(epoch===readyEpoch)channelReady=result.isReady===true});task.catch(error=>win.toastr?.error(error.message));return {get isReady(){return !disposed&&!closed&&channelReady},dispose(){disposed=true;void invoke('unbind').catch(()=>{})}}},
    dispose(){if(closed)return;closed=true;channelReady=false;frames=[];void invoke('dispose').catch(()=>{})},
    error(message){win.toastr?.warning?.(message)}
   };
  }
  win.addEventListener('pagehide',()=>{win.__dshOriginalExtensionState.retired=true;win.__dshOriginalExtensionState.ready=false},{capture:true,once:true});
  win.__dshOpenExtension=()=>{const menu=doc.querySelector('#extensionsMenu .list-group-item, #extensionsMenu button');if(menu)menu.click()};
 };
 // SP owns its original UI/storage, while every other script reads the host's
 // AutoCardUpdaterAPI. Exchange committed tables through that existing API.
 win.__dshConnectOriginalDatabase=async function(){
  win.__dshOriginalExtensionState.phase='connect-enter';
  if(descriptor?.id==='sp-database')return options.connectSingleAuthority(win,options,nativeDatabase,descriptor);
 };
 win.addEventListener('message',event=>{
  const data=event.data;if(event.source!==win.parent||data?.token!==options.token)return;
  if(data.type==='dsh-tavern-extension-open'){win.__dshOpenExtension?.();return}
  if(data.type!=='dsh-tavern-original-database-command')return;
  const execute=async()=>{
   const context=options.context();if(data.chatId!==context.chatId||Number(data.lifecycleRevision)!==Number(context.lifecycleRevision||0))throw Error('聊天已切换，模板操作已取消');
   if(data.operation?.kind!=='zero-stop'&&!win.__dshOriginalExtensionState?.ready||!win.__dshOriginalDatabaseCommand)throw Error('原数据库尚未就绪');
   return win.__dshOriginalDatabaseCommand(data.operation);
  };
  const task=data.operation?.kind==='zero-stop'?Promise.resolve().then(execute):commandTail.catch(()=>{}).then(execute);
  if(data.operation?.kind!=='zero-stop')commandTail=task;
  task.then(result=>options.post({type:'dsh-tavern-original-database-result',requestId:data.requestId,ok:true,result}),error=>options.post({type:'dsh-tavern-original-database-result',requestId:data.requestId,ok:false,error:String(error.message||error)}));
 });
}
