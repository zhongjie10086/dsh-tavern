/** A view of the same live iframe. The execution document is never reparented. */
function installTavernMirrorSource(options) {
  const win=options.window,doc=win.document,keys=new WeakMap();let serial=0,active='',observer,timer,interval,ack=0,last='',disposed=false;
  if(!doc?.documentElement)return {dispose(){}};
  let nodes=new Map(),editors=new Map(),dynamic=[],canvases=[],lastDynamic='',canvasImages=new WeakMap();
  function dynamicState(refreshCanvas) {
    return JSON.stringify([dynamic.map(node=>{const editor=editors.get(node);return editor?editor.getValue():[node.value,node.checked,node.indeterminate]}),canvases.map(node=>{if(refreshCanvas||!canvasImages.has(node)){try{canvasImages.set(node,node.toDataURL())}catch{canvasImages.set(node,'')}}return canvasImages.get(node)})]);
  }
  function pollDynamic(){if(active&&dynamicState(true)!==lastDynamic)schedule()}
  const post=data=>options.post(Object.assign({type:'dsh-tavern-mirror-snapshot',mirrorId:active},data));
  function snapshot() {
    timer=null;if(!active||disposed)return;
    try {
      nodes=new Map();editors=new Map();dynamic=[];canvases=[];const fields=[],scrolls=[];
      for(const editor of options.editors?.()||[])if(editor.getDomNode?.())editors.set(editor.getDomNode(),editor);
      function visit(source) {
        if(source.nodeType===3)return doc.createTextNode(source.data);
        if(source.nodeType!==1)return null;
        if(['SCRIPT','BASE','META','OBJECT','EMBED','IFRAME'].includes(source.tagName))return null;
        let id=keys.get(source);if(!id){id=String(++serial);keys.set(source,id)}nodes.set(id,source);
        const editor=editors.get(source),copy=editor?doc.createElement('textarea'):source.cloneNode(false);
        for(const attr of [...copy.attributes])if(/^on/i.test(attr.name)||['srcdoc','action','formaction'].includes(attr.name)||/^javascript:/i.test(attr.value))copy.removeAttribute(attr.name);
        copy.setAttribute('data-dsh-mirror-id',id);
        if(source.tagName==='LINK')copy.href=source.href;
        if(source.tagName==='IMG')copy.src=source.currentSrc||source.src;
        if(source.tagName==='A')copy.href='#';
        if(editor) {dynamic.push(source);copy.className='dsh-mirror-code-editor';copy.setAttribute('aria-label','系统小窗模板代码');copy.style.cssText='box-sizing:border-box;width:100%;height:100%;min-height:260px;background:#1e1e1e;color:#ddd;font:14px monospace;tab-size:4;resize:none';fields.push({id,value:editor.getValue()})}
        else {
          for(const child of source.childNodes){const next=visit(child);if(next)copy.append(next)}
          if(['INPUT','TEXTAREA','SELECT'].includes(source.tagName)){dynamic.push(source);fields.push({id,value:source.type==='file'?'':source.value,checked:source.checked,indeterminate:source.indeterminate});}
          if(source.tagName==='CANVAS'){canvases.push(source);try{if(!canvasImages.has(source))canvasImages.set(source,source.toDataURL());copy.style.backgroundImage='url('+canvasImages.get(source)+')';copy.style.backgroundSize='100% 100%'}catch{}}
        }
        if(source.scrollTop||source.scrollLeft)scrolls.push({id,top:source.scrollTop,left:source.scrollLeft});
        return copy;
      }
      const head=visit(doc.head),body=visit(doc.body);
      const data={head:head.innerHTML,body:body.innerHTML,bodyClass:doc.body.className,htmlClass:doc.documentElement.className,bodyStyle:doc.body.getAttribute('style')||'',fields,scrolls,ack};
      lastDynamic=dynamicState(false);
      const json=JSON.stringify(data);if(json.length>4000000)throw new Error('系统小窗内容超过 4MB，请先收起大型列表');
      if(json!==last){last=json;post({snapshot:data})}
    }catch(error){post({error:String(error.message)})}
  }
  function schedule(){if(active&&!timer)timer=win.setTimeout(snapshot,40)}
  function stop(){active='';observer?.disconnect();observer=null;win.clearTimeout(timer);win.clearInterval(interval);timer=null;interval=null;last='';nodes.clear();editors.clear();dynamic=[];canvases=[];canvasImages=new WeakMap();lastDynamic=''}
  function input(data) {
    ack=Math.max(ack,Number(data.commandId)||0);
    const target=nodes.get(String(data.id));if(!target?.isConnected){schedule();return}
    const editor=editors.get(target);
    if(data.event==='input'||data.event==='change') {
      if(editor) {const model=editor.getModel();if(model&&editor.getValue()!==data.value)model.pushEditOperations([],[{range:model.getFullModelRange(),text:String(data.value)}],()=>null);schedule();return}
      if(data.files && target.type==='file') {const transfer=new win.DataTransfer();for(const file of data.files)transfer.items.add(file);target.files=transfer.files}
      else if('value' in target) {
        const prototype=target.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:target.tagName==='SELECT'?win.HTMLSelectElement.prototype:win.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value')?.set?.call(target,data.value);
        if('checked' in target)Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype,'checked')?.set?.call(target,Boolean(data.checked));
      } else if(target.isContentEditable)target.textContent=String(data.value||'');
    }
    if(data.event==='scroll'){target.scrollTop=data.top;target.scrollLeft=data.left;schedule();return}
    let event;
    const init={bubbles:true,cancelable:true,composed:true,key:data.key,code:data.code,ctrlKey:data.ctrlKey,altKey:data.altKey,shiftKey:data.shiftKey,metaKey:data.metaKey};
    if(['keydown','keyup'].includes(data.event))event=new win.KeyboardEvent(data.event,init);
    else if(/^(?:click|dblclick|mouse|pointer)/.test(data.event)) {const rect=target.getBoundingClientRect(),EventType=data.event.startsWith('pointer')?win.PointerEvent:win.MouseEvent;event=new EventType(data.event,{...init,button:data.button||0,buttons:data.buttons||0,pointerId:data.pointerId||1,pointerType:data.pointerType||'mouse',clientX:rect.left+(data.rx||0)*rect.width,clientY:rect.top+(data.ry||0)*rect.height})}
    else event=new win.Event(data.event,init);
    target.dispatchEvent(event);schedule();
  }
  const receive=event=>{
    const data=event.data;if(event.source!==win.parent||data?.token!==options.token||data.type!=='dsh-tavern-mirror-control')return;
    if(data.action==='start'){stop();active=data.mirrorId;ack=0;observer=new win.MutationObserver(schedule);observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});interval=win.setInterval(pollDynamic,500);snapshot()}
    else if(data.mirrorId===active){if(data.action==='stop')stop();else if(data.action==='input')input(data)}
  };
  win.addEventListener('message',receive);doc?.addEventListener('input',schedule,true);doc?.addEventListener('change',schedule,true);doc?.addEventListener('scroll',schedule,true);
  return {dispose(){disposed=true;stop();win.removeEventListener('message',receive);doc?.removeEventListener('input',schedule,true);doc?.removeEventListener('change',schedule,true);doc?.removeEventListener('scroll',schedule,true)}};
}
function tavernMirrorViewer(config) {
  const root=document.body,host=parent.opener||parent;let serial=0,painting=false,ignoreScrollUntil=0;
  const post=data=>host.postMessage({...data,token:config.token,mirrorId:config.mirrorId},'*');
  function clean(html) {
    const fragment=document.createElement('template');fragment.innerHTML=html;
    for(const node of fragment.content.querySelectorAll('script,base,meta,iframe,object,embed'))node.remove();
    for(const node of fragment.content.querySelectorAll('*'))for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['srcdoc','action','formaction'].includes(attr.name)||/^javascript:/i.test(attr.value))node.removeAttribute(attr.name);
    return fragment.content;
  }
  addEventListener('message',event=>{
    const data=event.data;if(event.source!==host||data?.token!==config.token||data.mirrorId!==config.mirrorId||data.type!=='dsh-tavern-mirror-view')return;
    if(data.error){document.body.textContent=data.error;return}
    const snapshot=data.snapshot;if(!snapshot||snapshot.ack<serial)return;
    painting=true;ignoreScrollUntil=Date.now()+100;
    const focus=document.activeElement,active=focus?.getAttribute('data-dsh-mirror-id'),start=focus?.selectionStart,end=focus?.selectionEnd;
    const scrolling=[...document.querySelectorAll('[data-dsh-mirror-id]')].filter(n=>n.scrollTop||n.scrollLeft).map(n=>({id:n.getAttribute('data-dsh-mirror-id'),top:n.scrollTop,left:n.scrollLeft}));
    document.head.replaceChildren(clean(snapshot.head));document.documentElement.className=snapshot.htmlClass;
    root.className=snapshot.bodyClass;root.setAttribute('style',snapshot.bodyStyle);root.replaceChildren(clean(snapshot.body));
    const find=id=>document.querySelector('[data-dsh-mirror-id="'+id+'"]');
    for(const field of snapshot.fields){const node=find(field.id);if(!node)continue;if(node.type!=='file')node.value=field.value;if('checked' in node)node.checked=field.checked;if('indeterminate' in node)node.indeterminate=field.indeterminate}
    for(const saved of scrolling.length?scrolling:snapshot.scrolls){const node=find(saved.id);if(node){node.scrollTop=saved.top;node.scrollLeft=saved.left}}
    const next=find(active);if(next){next.focus({preventScroll:true});try{next.setSelectionRange(start,end)}catch{}}
    painting=false;
  });
  for(const type of ['click','dblclick','mousedown','mouseup','mousemove','pointerdown','pointerup','pointermove','pointercancel','input','change','keydown','keyup','submit','scroll'])addEventListener(type,event=>{
    if(painting || type==='scroll'&&Date.now()<ignoreScrollUntil || type.endsWith('move')&&!event.buttons)return;
    const target=event.target?.closest?.('[data-dsh-mirror-id]');if(!target)return;
    if(type==='click' && !['SELECT','TEXTAREA','INPUT','OPTION'].includes(target.tagName))event.preventDefault();
    if(type==='submit')event.preventDefault();
    if(type==='click'&&target.tagName==='A')event.preventDefault();
    const commandId=++serial,rect=target.getBoundingClientRect();
    post({type:'dsh-tavern-mirror-input',commandId,id:target.getAttribute('data-dsh-mirror-id'),event:type,value:target.isContentEditable?target.textContent:target.value,checked:target.checked,files:target.type==='file'&&type==='change'?[...target.files]:undefined,top:target.scrollTop,left:target.scrollLeft,key:event.key,code:event.code,button:event.button,buttons:event.buttons,pointerId:event.pointerId,pointerType:event.pointerType,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey,rx:rect.width?(event.clientX-rect.left)/rect.width:0,ry:rect.height?(event.clientY-rect.top)/rect.height:0});
  },true);
  post({type:'dsh-tavern-mirror-ready'});
}
function createTavernWindowMirror(win,sourceFrame,token,title) {
  let child,viewer,id='',disposed=false;
  const send=data=>sourceFrame.contentWindow?.postMessage({...data,type:'dsh-tavern-mirror-control',token,mirrorId:id},'*');
  const receive=event=>{
    const data=event.data;if(disposed||!child||data?.token!==token||data.mirrorId!==id)return;
    if(event.source===sourceFrame.contentWindow&&data.type==='dsh-tavern-mirror-snapshot')viewer?.contentWindow?.postMessage({...data,type:'dsh-tavern-mirror-view'},'*');
    if(event.source===viewer?.contentWindow) {
      if(data.type==='dsh-tavern-mirror-ready')send({action:'start'});
      else if(data.type==='dsh-tavern-mirror-input')send({...data,action:'input'});
    }
  };
  if(win.documentPictureInPicture)win.addEventListener('message',receive);
  const closed=()=>{send({action:'stop'});child?.removeEventListener('message',receive);child=null;viewer=null;id=''};
  return {
    async open() {
      if(child&&!child.closed){child.close();return null}
      if(!win.documentPictureInPicture)throw new Error('当前浏览器不支持系统小窗，可继续使用页面浮窗');
      const bounds=sourceFrame.getBoundingClientRect();
      child=await win.documentPictureInPicture.requestWindow({width:Math.max(360,Math.round(bounds.width)),height:Math.max(280,Math.round(bounds.height)),disallowReturnToOpener:false});
      if(disposed){child.close();throw new Error('窗口已经关闭')}
      id=win.crypto.randomUUID();child.document.title=title+' · DSH 酒馆';child.document.body.style.cssText='margin:0;height:100vh';
      viewer=child.document.createElement('iframe');viewer.title=title+'系统小窗';viewer.setAttribute('sandbox','allow-scripts allow-downloads');viewer.style.cssText='width:100%;height:100%;border:0';
      viewer.srcdoc='<!doctype html><html><head><meta charset="utf-8"></head><body>正在连接原窗口…<script>('+tavernMirrorViewer.toString()+')('+JSON.stringify({token,mirrorId:id}).replace(/</g,'\\u003c')+');<\/script></body></html>';
      child.addEventListener('message',receive);child.document.body.append(viewer);child.addEventListener('pagehide',closed,{once:true});return child;
    },
    close(){if(child)child.close()},
    dispose(){disposed=true;if(child)child.close();if(win.documentPictureInPicture)win.removeEventListener('message',receive)}
  };
}
