// Real renderer instances, never a cloned transcript or a replacement game.
function createTavernSpLiveSurfaces(){
 const frames=new Set(),views=new Map();
 const key=scope=>JSON.stringify([scope.sessionId,Number(scope.lifecycleRevision)||0]);
 function register(frame){frames.add(frame);return()=>{frames.delete(frame);for(const view of views.values())if(view.frame===frame)dispose(view)}}
 function dispose(view){view.channel?.dispose();view.slot?.remove();view.frame.hold=false;for(const game of view.games||[])game.hold=false;views.delete(view.key)}
 function assertFrame(view){if(!frames.has(view.frame)||!view.frame.current()||!view.frame.node.isConnected)throw Error('零层真实游戏表面已退出');}
 function command(scope,operation,read,notify=()=>{}){
  const id=key(scope);
  if(operation.kind==='dispose'){const old=views.get(id);if(old)dispose(old);return {disposed:true}}
  if(operation.kind==='unbind'){views.get(id)?.channel?.dispose();if(views.get(id))views.get(id).channel=null;return {unbound:true}}
  const update=operation.update,snapshot=update?.snapshot;
  if(!snapshot||snapshot.carrierRef?.messageIndex!==undefined&&snapshot.carrierRef.messageIndex!==operation.carrierIndex)throw Error('零层载体身份无效');
  let view=views.get(id);const created=!view;
  if(!view){
   let candidates=[...frames].filter(frame=>frame.current()&&frame.identity.sessionId===scope.sessionId&&Number(frame.identity.lifecycleRevision||0)===Number(scope.lifecycleRevision||0)&&frame.identity.messageId===operation.carrierIndex);
   const games=candidates.filter(frame=>frame.node.tagName==='IFRAME'),surfaces=candidates.filter(frame=>frame.node.tagName!=='IFRAME');
   if(surfaces.length===1)candidates=surfaces;
   if(candidates.length!==1)throw Error('零层载体的真实游戏界面尚未挂载或不唯一；请显示开场游戏界面后重同步');
   const frame=candidates[0],slot=frame.node.ownerDocument.createElement('section');slot.dataset.dshZeroLayerBody='true';slot.setAttribute('aria-live','polite');slot.style.whiteSpace='pre-wrap';frame.node.after(slot);frame.hold=true;
   view={key:id,frame,games,slot,scope:structuredClone(scope),latest:structuredClone(update),read,notify};views.set(id,view);
  }
  // Discover real renderer iframes activated after the stable carrier mount.
  view.games=[...frames].filter(frame=>frame.node.tagName==='IFRAME'&&frame.current()&&frame.node.isConnected&&frame.identity.sessionId===scope.sessionId&&Number(frame.identity.lifecycleRevision||0)===Number(scope.lifecycleRevision||0)&&frame.identity.messageId===operation.carrierIndex);
  assertFrame(view);
  const prior=view.latest.snapshot;
  if(prior.sessionId!==snapshot.sessionId||prior.branchId!==snapshot.branchId||prior.carrierRef.carrierId!==snapshot.carrierRef.carrierId||prior.carrierRef.swipeId!==snapshot.carrierRef.swipeId){dispose(view);return command(scope,operation,read,notify)}
  if(snapshot.revision<prior.revision)throw Error('零层显示修订已过期');
  view.latest=structuredClone(update);view.slot.textContent=String(update.body||'');if(view.channel?.isActive)view.channel.publish(view.latest);
  if(operation.kind==='bind'||operation.kind==='mount'||created){
   const game=operation.frameToken?view.games.find(frame=>frame.token===operation.frameToken):view.games.length===1?view.games[0]:null;
   if(operation.kind==='bind'&&!game)throw Error('请指定已认证的真实游戏 frame 身份');
   if(game){
    if(operation.expectedOrigin!==undefined&&operation.expectedOrigin!==game.node.ownerDocument.location.origin)throw Error('游戏表面来源不匹配');
    if(view.game!==game){view.channel?.dispose();if(view.game)view.game.hold=false;view.channel=null;view.game=game;game.hold=true}
    if(operation.kind==='bind'&&view.channel){view.channel.dispose();view.channel=null}
    if(!view.channel?.isActive)view.channel=createTavernSpGameChannel({...view,frame:game},()=>{assertFrame(view);if(!frames.has(game)||!game.current()||!game.node.isConnected)throw Error('游戏表面已退出')});
   }
  }
  return {mounted:true,isReady:view.channel?.isReady===true,frames:view.games.map(frame=>({dshFrameToken:frame.token}))};
 }
 return {register,command,isHeld:node=>[...frames].some(frame=>frame.node===node&&frame.hold),disposeScope(scope){const view=views.get(key(scope));if(view)dispose(view)}};
}

// Same bounded protocol as the fixed original. Opaque origin is accepted only
// for this authenticated, registered sandboxed frame, with its exact Window,
// fresh nonce, monotonically increasing sequence and complete logical scope.
function createTavernSpGameChannel(view,assertCurrent){
 const frame=view.frame.node,host=frame.ownerDocument.defaultView,target=frame.contentWindow;
 const opaque=frame.hasAttribute('sandbox')&&!frame.sandbox.contains('allow-same-origin');
 const origin=opaque?'null':new URL(frame.hasAttribute('srcdoc')?frame.ownerDocument.location.href:frame.getAttribute('src')||frame.ownerDocument.location.href,frame.ownerDocument.baseURI).origin;
 if(!target||!opaque&&!/^https?:/.test(origin))throw Error('游戏表面来源不受支持');
 const attributes=['src','srcdoc','sandbox'].map(name=>frame.getAttribute(name)),token=host.crypto.randomUUID();
 let active=true,ready=false,incoming=0,outgoing=0,latest=view.latest;
 const scope=()=>({sessionId:latest.snapshot.sessionId,branchId:latest.snapshot.branchId,carrierRef:latest.snapshot.carrierRef});
 const same=(left,right)=>left?.sessionId===right.sessionId&&left.branchId===right.branchId&&left.carrierRef?.carrierId===right.carrierRef.carrierId&&left.carrierRef?.swipeId===right.carrierRef.swipeId;
 function check(){assertCurrent();if(!active||frame.contentWindow!==target||attributes.some((value,index)=>frame.getAttribute(['src','srcdoc','sandbox'][index])!==value))throw Error('游戏表面身份已变化')}
 function send(kind,value){check();target.postMessage({protocol:'acu-zero-layer-game',version:1,kind,token,scope:scope(),sequence:++outgoing,...value},opaque?'*':origin)}
 function dispose(){if(!active)return;active=false;ready=false;host.clearTimeout(timer);host.removeEventListener('message',receive);frame.removeEventListener('load',dispose);observer?.disconnect();view.notify(false)}
 async function receive(event){
  if(!active||event.source!==target||event.origin!==origin)return;
  const data=event.data;if(data?.protocol!=='acu-zero-layer-game'||data.version!==1||data.token!==token||!Number.isSafeInteger(data.sequence)||data.sequence<=incoming||!same(data.scope,scope()))return;
  try{check();if(data.kind==='accept'&&!ready){incoming=data.sequence;ready=true;host.clearTimeout(timer);send('update',{update:latest});view.notify(true);return}
   if(!ready||!['snapshot','history','close'].includes(data.kind))return;incoming=data.sequence;if(data.kind==='close'){dispose();return}
   if(typeof data.requestId!=='string'||!data.requestId)return;
   const result=await view.read(data.kind,data.query);check();if(ready)send('result',{requestId:data.requestId,result});
  }catch{dispose()}
 }
 host.addEventListener('message',receive);frame.addEventListener('load',dispose);
 const observer=host.MutationObserver?new host.MutationObserver(()=>{try{check()}catch{dispose()}}):null;
 observer?.observe(frame.ownerDocument.documentElement,{subtree:true,childList:true});observer?.observe(frame,{attributes:true,attributeFilter:['src','srcdoc','sandbox']});
 const timer=host.setTimeout(dispose,10000);send('offer',{});
 return {get isActive(){return active},get isReady(){return active&&ready},dispose,publish(update){check();latest=structuredClone(update);if(ready)send('update',{update:latest})}};
}

function TavernSpCarrierSurface(props){
 const node=React.useRef(null),identity=props.identity;
 React.useLayoutEffect(()=>identity?tavernSpLiveSurfaces.register({node:node.current,identity,current:()=>node.current?.isConnected===true}):undefined,[identity?.sessionId,identity?.lifecycleRevision,identity?.messageId,identity?.bodyId,identity?.swipeId]);
 return React.createElement('div',{ref:node,'data-dsh-sp-carrier-surface':identity?.messageId},props.children);
}

// Fixed runtime SessionInputShell admission, after slash/reference adjudication
// and before its default sink writes a native message. Stop never uses this sink.
function installTavernSpNativeInputGate(host,{getRoot,getInput,logical,submit,report,identity=()=>''}){
 const bindings=new Map();let disposed=false,pending=false;
 function ensure(input=getInput()){
  if(!input||bindings.has(input))return;
  const deps=input.deps;
  if(!deps||typeof deps.defaultSink!=='function')throw Error('当前固定内核的输入准入接口已变化，零层输入未发送');
  const original=deps.defaultSink,scope=identity();
  const wrapped=async function(text,attachments,mode,signal){
   if(!logical())return original.call(this,text,attachments,mode,signal);
   if(disposed||identity()!==scope)return {kind:'error',text:'聊天已切换，零层输入未发送'};
   if(typeof text!=='string'||!text.trim())return {kind:'error',text:'零层输入不能为空，输入已保留'};
   if(attachments?.length)return {kind:'error',text:'原包零层入口仅接受正文文字，附件已保留'};
   if(pending)return {kind:'error',text:'零层回合仍在处理中，输入已保留'};
   signal?.throwIfAborted();pending=true;
   try{await submit(text,scope,signal);return {kind:'success'}}
   catch(error){return {kind:'error',text:String(error.message||error)}}
   finally{pending=false}
  };
  deps.defaultSink=wrapped;bindings.set(input,{deps,original,wrapped});
 }
 function receive(event){
  if(disposed)return;
  const root=getRoot();if(!root?.contains(event.target))return;
  try{ensure()}catch(error){if(logical()){event.preventDefault();event.stopImmediatePropagation();report(error)}}
 }
 host.addEventListener('click',receive,true);host.addEventListener('keydown',receive,true);
 const release=()=>{disposed=true;host.removeEventListener('click',receive,true);host.removeEventListener('keydown',receive,true);for(const {deps,original,wrapped}of bindings.values())if(deps.defaultSink===wrapped)deps.defaultSink=original;bindings.clear()};
 release.ensure=ensure;return release;
}
