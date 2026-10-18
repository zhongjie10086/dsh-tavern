// Fixed SP owner surface: pixels and real browser input; no mirrored scripts.
function createTavernSpRemoteSurface({window:win,document:doc,container,frame,sessionId,identity,command,retrySave,onClose=()=>{},onNativeDialogPending=()=>{},report=()=>{}}){
 let disposed=false,opened=false,recovering=false,timer=null,polling=false,revision=0,viewport=null,tail=Promise.resolve(),composing=false,signature='',epoch=0,lastSize='',moving=false,clickCount=0,lastDown=0,lastPoint=null;
 let saveRecoveryRequired=false;const toolbarButtons=[];
 const notices=new Map(),urls=new Set(),downloads=new Map(),listeners=[];
 const panel=doc.createElement('section'),toolbar=doc.createElement('div'),image=doc.createElement('img'),keyboard=doc.createElement('textarea'),status=doc.createElement('div'),noticeBox=doc.createElement('div');
 panel.setAttribute('aria-label','SP 原插件界面');panel.hidden=true;panel.style.cssText='position:relative;width:100%;height:100%;overflow:auto;background:#24221f;color:#ddd';
 image.alt='SP 原插件实时界面';image.draggable=false;image.style.cssText='display:block;width:100%;height:auto;touch-action:none;user-select:none';
 keyboard.setAttribute('aria-label','SP 原界面键盘输入');keyboard.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0';
 toolbar.style.cssText='display:flex;gap:8px;align-items:center;padding:6px;flex-wrap:wrap';status.setAttribute('role','status');
 const button=(text,work)=>{const el=doc.createElement('button');el.type='button';el.textContent=text;el.addEventListener('click',()=>Promise.resolve().then(work).catch(fail));toolbar.appendChild(el);toolbarButtons.push(el);return el};
 panel.append(toolbar,status,noticeBox,image,keyboard);container.appendChild(panel);
 function fail(error){if(!disposed){status.textContent=String(error?.message||error);report(error)}}
 const current=()=>JSON.stringify(identity?.()||{sessionId});
 const rpc=async operation=>{if(disposed)throw Error('SP 界面已退出');const version=epoch,scope=current();const result=await command({kind:'ui',command:operation});if(disposed||version!==epoch||scope!==current())throw Error('SP 界面身份已变化，操作回执未应用');return result};
 const serial=work=>{const next=tail.catch(()=>{}).then(()=>{if(disposed)throw Error('SP 界面已退出');return work()});tail=next;next.catch(fail);return next};
 function input(events){const observedRevision=revision;return serial(async()=>{if(recovering||!opened||!observedRevision)throw Error('SP 当前画面尚未就绪');if(observedRevision!==revision)throw Error('SP 画面尺寸已变化，请按当前画面重新操作');const result=await rpc({operation:'input',revision:observedRevision,events});if(result?.delivered!==true)throw Error('SP 原界面未确认输入送达');return result})}
 function listen(target,name,handler,options){target.addEventListener(name,handler,options);listeners.push(()=>target.removeEventListener(name,handler,options))}
 function point(event){const box=image.getBoundingClientRect();if(!viewport||!box.width||!box.height)throw Error('SP 画面尺寸尚未就绪');return{x:Math.max(0,Math.min(viewport.width,(event.clientX-box.left)*viewport.width/box.width)),y:Math.max(0,Math.min(viewport.height,(event.clientY-box.top)*viewport.height/box.height))}}
 const mouseButton=number=>number===2?'right':number===1?'middle':'left';
 let pointerModifiers=[];
 listen(image,'pointerdown',event=>{event.preventDefault();keyboard.focus({preventScroll:true});image.setPointerCapture?.(event.pointerId);moving=true;const p=point(event),now=Date.now();clickCount=now-lastDown<400&&lastPoint&&Math.abs(p.x-lastPoint.x)<4&&Math.abs(p.y-lastPoint.y)<4?clickCount%3+1:1;lastDown=now;lastPoint=p;pointerModifiers=[event.ctrlKey?'Control':null,event.metaKey?'Meta':null,event.shiftKey?'Shift':null,event.altKey?'Alt':null].filter(Boolean);void input([...pointerModifiers.map(key=>({type:'key',key,action:'down'})),{type:'down',...p,button:mouseButton(event.button),clickCount}])});
 listen(image,'pointerup',event=>{event.preventDefault();moving=false;void input([{type:'up',...point(event),button:mouseButton(event.button),clickCount},...pointerModifiers.map(key=>({type:'key',key,action:'up'}))]);pointerModifiers=[];image.releasePointerCapture?.(event.pointerId)});
 let latestMove=null,moveFrame=null;
 listen(image,'pointermove',event=>{latestMove=point(event);if(moveFrame===null)moveFrame=win.requestAnimationFrame(()=>{moveFrame=null;if(!disposed&&opened)void input([{type:'move',...latestMove}])})});
 listen(image,'pointercancel',event=>{moving=false;void input([{type:'up',...point(event),button:'left'},...pointerModifiers.map(key=>({type:'key',key,action:'up'}))]);pointerModifiers=[]});
 listen(image,'contextmenu',event=>event.preventDefault());
 listen(image,'wheel',event=>{event.preventDefault();const factor=event.deltaMode===1?16:event.deltaMode===2?(viewport?.height||600):1;void input([{type:'wheel',...point(event),deltaX:event.deltaX*factor,deltaY:event.deltaY*factor}])},{passive:false});
 const keyName=event=>event.key===' '?'Space':event.key;
 listen(keyboard,'keydown',event=>{
  if(composing||event.isComposing||event.key==='Process'||event.key==='Dead')return;
  const modifier=event.ctrlKey||event.metaKey;
  if(modifier&&event.key.toLowerCase()==='v')return;
  if(modifier&&event.key.toLowerCase()==='c'){event.preventDefault();void copySelection();return}
  if(modifier&&event.key.toLowerCase()==='x'){event.preventDefault();void copySelection().then(text=>text?input([{type:'key',key:'Backspace'}]):undefined).catch(fail);return}
  if(event.key.length===1&&!modifier&&!event.altKey)return;
  if(['Control','Shift','Meta','Alt'].includes(event.key))return;
  event.preventDefault();const prefix=[event.ctrlKey?'Control':null,event.metaKey?'Meta':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null].filter(Boolean);
  void input([{type:'key',key:[...prefix,keyName(event)].join('+'),action:'press'}]);
 });
 listen(keyboard,'beforeinput',event=>{
  if(composing||event.isComposing)return;
  if(committedComposition!==null&&event.data===committedComposition){event.preventDefault();committedComposition=null;keyboard.value='';return}
  if(event.inputType==='insertText'&&typeof event.data==='string'){event.preventDefault();void input([{type:'insertText',text:event.data}]);keyboard.value=''}
 });
 let committedComposition=null;
 listen(keyboard,'compositionstart',()=>{composing=true;committedComposition=null});
 listen(keyboard,'compositionend',event=>{composing=false;committedComposition=event.data||'';if(committedComposition)void input([{type:'insertText',text:committedComposition}]);keyboard.value='';win.setTimeout(()=>{committedComposition=null},0)});
 // Some engines emit the committed insertText after compositionend.
 listen(keyboard,'input',()=>{keyboard.value=''});
 listen(keyboard,'paste',event=>{event.preventDefault();const text=event.clipboardData?.getData('text/plain');if(typeof text==='string')void input([{type:'insertText',text}])});
 async function copySelection(){const result=await serial(()=>rpc({operation:'selection'}));if(typeof result?.text!=='string')throw Error('SP 原界面选中文字未返回');
  try{await win.navigator.clipboard.writeText(result.text)}catch{const area=doc.createElement('textarea');area.value=result.text;noticeBox.appendChild(area);area.focus();area.select();if(!doc.execCommand?.('copy')){status.textContent='已取回选中文字，请在文本框中复制';return result.text}area.remove()}return result.text;
 }
 button('复制选中文字',copySelection);button('粘贴文字',async()=>{const text=await win.navigator.clipboard.readText();await input([{type:'insertText',text}])});
 button('关闭界面',close);button('刷新画面',()=>capture());
 if(typeof retrySave==='function')button('仅重试保存',async()=>{const result=await serial(()=>retrySave());if(result?.saved!==true)throw Error('SP 仅重试保存未获持久化确认');status.textContent='SP 保存已确认';return result});
 async function filesToJson(files){const rows=[];for(const file of files){const data=await new Promise((resolve,reject)=>{const reader=new win.FileReader();reader.onerror=()=>reject(reader.error||Error('文件读取失败'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file)});rows.push({name:file.name,mimeType:file.type||'application/octet-stream',data})}return rows}
 async function download(notice){let progress=downloads.get(notice.id);if(!progress){progress={offset:0,done:false,name:notice.name||'SP-export',mimeType:'application/octet-stream',parts:[]};downloads.set(notice.id,progress)}
  while(!progress.done){const result=await rpc({operation:'download',id:notice.id,offset:progress.offset});if(typeof result?.data!=='string'||!Number.isSafeInteger(result.offset)||result.offset<progress.offset||!result.done&&result.offset===progress.offset)throw Error('SP 下载分块回执无效');const text=win.atob(result.data),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);if(result.offset!==progress.offset+bytes.length)throw Error('SP 下载分块位置不一致');progress.parts.push(bytes);progress.offset=result.offset;progress.done=result.done===true;progress.name=result.name||progress.name;progress.mimeType=result.mimeType||progress.mimeType}
  await rpc({operation:'download-ack',id:notice.id,offset:progress.offset});
  const url=win.URL.createObjectURL(new win.Blob(progress.parts,{type:progress.mimeType}));urls.add(url);const link=doc.createElement('a');link.href=url;link.download=progress.name;link.textContent='下载 '+progress.name;noticeBox.appendChild(link);link.click();downloads.delete(notice.id);
 }
 async function handleNotice(notice){
  if(!notice||typeof notice.id!=='string'||notices.has(notice.id))return;notices.set(notice.id,true);
  try{if(notice.kind==='dialog'){
   const row=doc.createElement('dialog'),message=doc.createElement('p'),accept=doc.createElement('button'),cancel=doc.createElement('button');row.setAttribute('role','dialog');row.setAttribute('aria-modal','true');row.setAttribute('aria-label','SP 原插件确认');row.style.cssText='background:#24221f;color:#ddd;padding:20px;border:1px solid #697489;border-radius:8px;max-width:calc(100vw - 48px)';message.textContent=String(notice.message||'');accept.type=cancel.type='button';accept.textContent='确定';cancel.textContent='取消';row.append(message);
   let field;if(notice.type==='prompt'){field=doc.createElement('input');field.type='text';field.setAttribute('aria-label','SP 原插件输入');field.value=String(notice.defaultValue||'');row.append(field)}
   row.append(accept);if(notice.type!=='alert')row.append(cancel);noticeBox.appendChild(row);notices.set(notice.id,'native-pending');onNativeDialogPending(true);
   const answer=async accepted=>{if(accept.disabled)return;accept.disabled=cancel.disabled=true;try{await rpc({operation:'dialog',id:notice.id,accept:accepted,...field&&accepted?{promptText:field.value}:{}});row.remove();notices.set(notice.id,'answered');onNativeDialogPending([...notices.values()].some(value=>value==='native-pending'))}catch(error){accept.disabled=cancel.disabled=false;fail(error)}};
   accept.addEventListener('click',()=>{void answer(true)});cancel.addEventListener('click',()=>{void answer(false)});
   row.addEventListener('cancel',event=>{event.preventDefault();void answer(notice.type==='alert')});row.showModal?.();(field||accept).focus();
  }else if(notice.kind==='file'){
   const row=doc.createElement('label'),picker=doc.createElement('input'),cancel=doc.createElement('button');row.textContent='SP 原插件选择文件：';picker.type='file';picker.multiple=notice.multiple===true;cancel.type='button';cancel.textContent='取消文件选择';row.append(picker,cancel);noticeBox.appendChild(row);
   const submit=async files=>{try{await rpc({operation:'files',id:notice.id,files:await filesToJson(files)});row.remove()}catch(error){notices.delete(notice.id);fail(error)}};
   picker.addEventListener('change',()=>{void submit(Array.from(picker.files||[]))});picker.addEventListener('cancel',()=>{void submit([])});cancel.addEventListener('click',()=>{void submit([])});
  }else if(notice.kind==='select'){
   if(!Array.isArray(notice.options))throw Error('SP 选择列表回执无效');
   const row=doc.createElement('label'),select=doc.createElement('select'),apply=doc.createElement('button');row.textContent=String(notice.label||'SP 原插件选择：');select.multiple=notice.multiple===true;apply.type='button';apply.textContent='确认选择';
   const groups=new Map();for(const option of notice.options){if(typeof option.value!=='string')throw Error('SP 选择项目无效');const el=doc.createElement('option');el.value=option.value;el.textContent=String(option.label??option.text??option.value);el.disabled=option.disabled===true;el.selected=option.selected===true||(notice.values||[]).includes(option.value);let parent=select;if(option.group){if(!groups.has(option.group)){const group=doc.createElement('optgroup');group.label=String(option.group);groups.set(option.group,group);select.appendChild(group)}parent=groups.get(option.group)}parent.appendChild(el)}
   row.append(select,apply);noticeBox.appendChild(row);
   apply.addEventListener('click',()=>{apply.disabled=true;const values=Array.from(select.options).filter(option=>option.selected).map(option=>String(option.value));void rpc({operation:'select',id:notice.id,values}).then(()=>row.remove()).catch(error=>{apply.disabled=false;fail(error)})});
  }else if(notice.kind==='download')await download(notice);else throw Error('SP 原界面返回未知交互');
  }catch(error){notices.delete(notice.id);throw error}
 }
 function apply(result){if(!result||!Number.isSafeInteger(result.revision))throw Error('SP 画面回执无效');if(result.revision<revision)return;revision=result.revision;
  if(result.image){if(!['image/jpeg','image/png'].includes(result.image.mimeType)||typeof result.image.data!=='string')throw Error('SP 画面类型无效');image.src='data:'+result.image.mimeType+';base64,'+result.image.data}
  if(result.viewport){if(!(result.viewport.width>0&&result.viewport.height>0))throw Error('SP 画面尺寸无效');viewport=result.viewport}
  for(const notice of result.notices||[])void handleNotice(notice).catch(fail);
 }
 const visible=()=>doc.visibilityState!=='hidden'&&!container.hidden&&(!panel.getClientRects||panel.getClientRects().length>0);
 async function capture(){if(disposed||!opened||!visible())return;if(polling)return;polling=true;
  try{apply(await rpc({operation:recovering?'recover':'capture'}))}catch(error){fail(error)}finally{polling=false;schedule()}}
 function schedule(){if(timer!==null)win.clearTimeout(timer);timer=null;if(!disposed&&opened&&visible())timer=win.setTimeout(()=>{timer=null;void capture()},400)}
 async function resize(){if(!opened||disposed||recovering)return;const box=panel.getBoundingClientRect(),width=Math.max(240,Math.min(4096,Math.round(box.width||940))),height=Math.max(160,Math.min(4096,Math.round(box.height||700)));const size=width+'x'+height;if(size===lastSize)return;apply(await serial(()=>rpc({operation:'resize',width,height})));lastSize=size}
 async function open({recover=false}={}){if(disposed)throw Error('SP 界面已退出');recovering=recover;opened=true;panel.hidden=false;if(frame)frame.hidden=true;status.textContent=saveRecoveryRequired?'SP 保存失败，原实例保留；请仅重试保存':recover?'正在恢复原 SP 确认，初始化尚未完成':'正在连接原 SP 界面';schedule();
  try{const result=await serial(()=>rpc({operation:recover?'recover':'open'}));apply(result);if(!recover&&!result.notices?.some(item=>item.kind==='dialog')){await resize();status.textContent='';keyboard.focus({preventScroll:true})}schedule()}catch(error){fail(error);throw error}}
 async function close({notify=true}={}){opened=false;panel.hidden=true;if(timer!==null)win.clearTimeout(timer);timer=null;try{const result=await rpc({operation:'close'});if(result?.detached!==true)throw Error('SP 原界面关闭未获确认')}finally{if(notify)onClose()}}
 listen(doc,'visibilitychange',()=>{if(doc.visibilityState==='hidden'){if(timer!==null)win.clearTimeout(timer);timer=null}else if(opened)void capture()});
 const observer=win.ResizeObserver?new win.ResizeObserver(()=>{if(opened)void resize().catch(fail)}):null;observer?.observe(container);
 return {sync(state){if(state?.recoveryError)fail(Error(state.recoveryError));if(state?.recoveryRequired!==undefined||state?.ready===true)saveRecoveryRequired=state?.recoveryRequired===true;for(const button of toolbarButtons)button.disabled=saveRecoveryRequired&&!['仅重试保存','关闭界面'].includes(button.textContent);if(saveRecoveryRequired)status.textContent=String(state.error||'SP 保存失败，原实例保留；请仅重试保存');const next=current();if(signature&&signature!==next){epoch++;opened=false;panel.hidden=true;if(timer!==null)win.clearTimeout(timer);timer=null;notices.clear();onNativeDialogPending(false);downloads.clear();revision=0;viewport=null}signature=next;if(opened)schedule()},open,close,dispose({close=true}={}){if(disposed)return;if(close)try{Promise.resolve(command({kind:'ui',command:{operation:'close'}})).catch(error=>report(error))}catch(error){report(error)}disposed=true;onNativeDialogPending(false);epoch++;opened=false;if(timer!==null)win.clearTimeout(timer);if(moveFrame!==null)win.cancelAnimationFrame(moveFrame);observer?.disconnect();for(const remove of listeners)remove();for(const url of urls)win.URL.revokeObjectURL(url);downloads.clear();panel.remove()}};
}
