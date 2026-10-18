import {randomUUID} from 'node:crypto'

// This is deliberately a fixed SP surface, not an arbitrary browser controller.
// The caller authenticates the current session, lifecycle and attachment before
// every operation. Original handlers run in the original persistent browser.
export function createSpOwnedBrowserUi({page,sessionId,runtimeId}) {
 const notices=new Map(),downloads=new Map(),pressedKeys=new Set(),pressedButtons=new Set();let revision=1,closed=false,lastImage=null,tail=Promise.resolve(),inputEpoch=0,inputAttached=true
 const reject=message=>new Error('SP 界面：'+message)
 const serial=work=>{const task=tail.catch(()=>{}).then(work);tail=task;return task}
 const note=(kind,value,handle)=>{const id=randomUUID();notices.set(id,{id,kind,...value,handle});return id}
 const fileListener=chooser=>note('file',{multiple:chooser.isMultiple()},chooser)
 const dialogListener=dialog=>note('dialog',{type:dialog.type(),message:dialog.message(),defaultValue:dialog.defaultValue()},dialog)
 const downloadListener=download=>{
  const id=note('download',{name:download.suggestedFilename()},download)
  downloads.set(id,{download,name:download.suggestedFilename(),offset:0,stream:null,rest:Buffer.alloc(0),done:false})
 }
 page.on('filechooser',fileListener);page.on('dialog',dialogListener);page.on('download',downloadListener)
 async function original(){
  if(closed||page.isClosed())throw reject('原窗口已经结束')
  const frames=[]
  for(const frame of page.frames())if(await frame.evaluate(()=>window.__dshOriginalExtensionState?.id==='sp-database'))frames.push(frame)
  if(frames.length!==1)throw reject('原插件窗口缺失或不唯一')
  return frames[0]
 }
 const visibleNotices=()=>[...notices.values()].map(({handle,...item})=>item)
 const recover=()=>({...lastImage,revision,notices:visibleNotices(),sessionId,runtimeId:typeof runtimeId==='function'?runtimeId():runtimeId})
 async function releaseInput(){
  if(pressedButtons.size)await page.mouse.move(-1,-1)
  for(const button of [...pressedButtons]){await page.mouse.up({button});pressedButtons.delete(button)}
  for(const key of [...pressedKeys]){await page.keyboard.up(key);pressedKeys.delete(key)}
 }
 async function surface(){
  const frame=await original(),element=await frame.frameElement(),box=await element.boundingBox()
  if(!box||box.width<1||box.height<1)throw reject('原插件界面尚未打开')
  return {frame,element,box}
 }
 async function offerNativeSelect(clickedPoint){
  if([...notices.values()].some(item=>item.kind==='dialog'||item.kind==='file'))return
  const frame=await original(),candidate=await frame.evaluateHandle(point=>{const active=document.activeElement;if(active?.tagName!=='SELECT')return null;if(point){let hit=document.elementFromPoint(point.x,point.y);while(hit&&hit!==active)hit=hit.parentElement;if(hit!==active)return null}return active},clickedPoint),handle=candidate.asElement()
  if(!handle){await candidate.dispose();return}
  const descriptor=await handle.evaluate(element=>{
   if(!element.isConnected||element.ownerDocument!==document||element.disabled)return null
   return {label:element.getAttribute('aria-label')||element.labels?.[0]?.textContent||'',multiple:element.multiple,values:Array.from(element.selectedOptions,option=>option.value),options:Array.from(element.options,option=>({value:option.value,label:option.label,selected:option.selected,disabled:option.disabled||option.parentElement?.tagName==='OPTGROUP'&&option.parentElement.disabled,group:option.parentElement?.tagName==='OPTGROUP'?option.parentElement.label:undefined}))}
  })
  if(!descriptor){await handle.dispose();return}
  // A native popup is not reliably included in screenshots. Close only that
  // popup, preserving selection, and present its exact options to the viewer.
  await page.keyboard.press('Escape')
  for(const [id,item]of notices)if(item.kind==='select'){await item.handle.dispose();notices.delete(id)}
  note('select',{...descriptor,optionsVersion:JSON.stringify(descriptor.options)},handle)
 }
 async function capture(){
  // Native dialogs suspend the browser renderer. Return the last real picture
  // with the pending dialog instead of hanging a screenshot behind that dialog.
  const modal=[...notices.values()].some(n=>n.kind==='dialog')
  if(!modal){const {element,box}=await surface();lastImage={image:{data:(await element.screenshot({type:'jpeg',quality:85,timeout:5000})).toString('base64'),mimeType:'image/jpeg'},viewport:{width:Math.round(box.width),height:Math.round(box.height)}}}
  return recover()
 }
 async function input(packet,epoch,validate){
  const check=async()=>{try{validate?.()}catch(error){await releaseInput();throw error}if(epoch!==inputEpoch||!inputAttached){await releaseInput();throw reject('界面连接已关闭，旧输入未继续执行')}}
  const deliver=async(work,held)=>{await check();try{validate?.()}catch(error){await releaseInput();throw error}await work();held?.();await check()}
  await check()
  if(packet.revision!==revision)throw reject('画面尺寸已变化，请按当前画面重新操作')
  if(!Array.isArray(packet.events)||packet.events.length>64)throw reject('输入事件无效')
  const {box}=await surface();await check()
  for(const event of packet.events){
   const point=()=>{if(!Number.isFinite(event.x)||!Number.isFinite(event.y)||event.x<0||event.y<0||event.x>box.width||event.y>box.height)throw reject('输入位置超出原界面');return [box.x+event.x,box.y+event.y]}
   if(event.type==='move')await deliver(()=>page.mouse.move(...point()))
   else if(event.type==='down'||event.type==='up'){
    await deliver(()=>page.mouse.move(...point()));const button=event.button??'left';if(!['left','right','middle'].includes(button))throw reject('鼠标按钮无效')
    if(event.type==='down')pressedButtons.add(button);else pressedButtons.delete(button)
    await deliver(()=>page.mouse[event.type]({button,clickCount:Math.max(1,Math.min(3,Number(event.clickCount)||1))}),()=>{if(event.type==='down')pressedButtons.add(button)})
    if(event.type==='up'&&button==='left')await offerNativeSelect({x:event.x,y:event.y})
   }else if(event.type==='wheel'){
    await deliver(()=>page.mouse.move(...point()));if(!Number.isFinite(event.deltaX)||!Number.isFinite(event.deltaY))throw reject('滚动输入无效');await deliver(()=>page.mouse.wheel(event.deltaX,event.deltaY))
   }else if(event.type==='key'){
    if(typeof event.key!=='string'||event.key.length>100||!['down','up','press'].includes(event.action||'press'))throw reject('键盘输入无效');if(event.action==='down')pressedKeys.add(event.key);else if(event.action==='up')pressedKeys.delete(event.key);await deliver(()=>page.keyboard[event.action||'press'](event.key),()=>{if(event.action==='down')pressedKeys.add(event.key)})
    if((event.action||'press')==='press'&&['Space','Enter','Alt+ArrowDown','F4'].includes(event.key))await offerNativeSelect()
   }else if(event.type==='insertText'){
    if(typeof event.text!=='string')throw reject('文字输入无效');await deliver(()=>page.keyboard.insertText(event.text))
   }else throw reject('输入类型不受支持')
  }
  await check()
  // Delivery is not a successful SP save/fill receipt.
  return {delivered:true,revision}
 }
 async function operate(packet={},{validate}={}){
  if(closed)throw reject('当前界面连接已经结束')
  validate?.();
  const operation=packet.operation
  const admittedInputEpoch=inputEpoch
  if(operation==='recover')return recover()
  // Dialog answers must be able to unblock an outstanding browser input.
  if(operation==='dialog'){
   const item=notices.get(packet.id);if(item?.kind!=='dialog')throw reject('对话框已经失效')
   if(packet.accept)await item.handle.accept(typeof packet.promptText==='string'?packet.promptText:undefined);else await item.handle.dismiss()
   notices.delete(packet.id);return {delivered:true}
  }
  if(operation==='files'){
   const item=notices.get(packet.id);if(item?.kind!=='file'||!Array.isArray(packet.files)||!item.multiple&&packet.files.length>1)throw reject('文件选择已经失效')
   const files=packet.files.map(file=>{if(typeof file.name!=='string'||!file.name||/[\\/\0]/.test(file.name)||typeof file.data!=='string')throw reject('文件内容无效');return {name:file.name,mimeType:String(file.mimeType||'application/octet-stream'),buffer:Buffer.from(file.data,'base64')}})
   await item.handle.setFiles(files);notices.delete(packet.id);return {delivered:true}
  }
  if(operation==='download'){
   const item=downloads.get(packet.id);if(!item)throw reject('下载已经失效');if(item.last?.requestedOffset===packet.offset)return item.last.response;if(packet.offset!==item.offset)throw reject('下载位置已经失效')
   if(!item.stream){item.stream=await item.download.createReadStream();if(!item.stream)throw reject('下载失败');item.iterator=item.stream[Symbol.asyncIterator]()}
   while(item.rest.length<65536&&!item.done){const chunk=await item.iterator.next();if(chunk.done)item.done=true;else item.rest=Buffer.concat([item.rest,chunk.value])}
   const data=item.rest.subarray(0,65536);item.rest=item.rest.subarray(data.length);item.offset+=data.length
   const done=item.done&&!item.rest.length,response={name:item.name,mimeType:'application/octet-stream',data:data.toString('base64'),done,offset:item.offset}
   item.last={requestedOffset:packet.offset,response};return response
  }
  if(operation==='download-ack'){const item=downloads.get(packet.id);if(!item)return {acknowledged:true};if(!item.last?.response.done||packet.offset!==item.offset)throw reject('下载尚未接收完整');await item.download.delete();downloads.delete(packet.id);notices.delete(packet.id);return {acknowledged:true}}
  if(operation==='close'){inputAttached=false;inputEpoch++;await releaseInput();return {detached:true}}
  // Polling must not queue behind an input which opened a native dialog.
  if(operation==='capture')return capture()
  if(operation==='open'&&[...notices.values()].some(item=>item.kind==='dialog'))return capture()
  return serial(async()=>{
   validate?.();
   if(operation==='open'){
    inputAttached=true
    await page.evaluate(()=>window.__dshBackgroundEngine.openOwnedUi())
    return capture()
   }
   if(operation==='resize'){
    const width=Math.round(Number(packet.width)),height=Math.round(Number(packet.height));if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<240||height<160||width>4096||height>4096)throw reject('界面尺寸无效')
    await page.setViewportSize({width,height});const {element}=await surface();await element.evaluate(el=>{el.style.cssText='position:fixed;inset:0;display:block;width:100vw;height:100vh;border:0;z-index:2147483647';for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){p.hidden=false;p.style.display='block';p.style.visibility='visible'}});revision++;return capture()
   }
   if(operation==='input')return input(packet,admittedInputEpoch,validate)
   if(operation==='select'){
    const item=notices.get(packet.id)
    if(item?.kind!=='select'||!Array.isArray(packet.values)||packet.values.some(value=>typeof value!=='string')||new Set(packet.values).size!==packet.values.length||!item.multiple&&packet.values.length!==1)throw reject('选择列表已经失效或选项无效')
    const state=await item.handle.evaluate(element=>({connected:element.isConnected&&element.ownerDocument===document,disabled:element.disabled,multiple:element.multiple,options:Array.from(element.options,option=>({value:option.value,label:option.label,selected:option.selected,disabled:option.disabled||option.parentElement?.tagName==='OPTGROUP'&&option.parentElement.disabled,group:option.parentElement?.tagName==='OPTGROUP'?option.parentElement.label:undefined}))}))
    if(!state.connected||state.disabled||state.multiple!==item.multiple||JSON.stringify(state.options)!==item.optionsVersion)throw reject('原选择控件或选项已经变化，请重新打开')
    for(const value of packet.values){const matches=state.options.filter(option=>option.value===value);if(matches.length!==1||matches[0].disabled)throw reject('选择项目不存在、重复或已经禁用')}
    validate?.();await item.handle.selectOption(packet.values.map(value=>({value})))
    notices.delete(packet.id);await item.handle.dispose();return {delivered:true}
   }
   if(operation==='selection')return {text:await (await original()).evaluate(()=>{const e=document.activeElement;return typeof e?.value==='string'&&Number.isInteger(e.selectionStart)?e.value.slice(e.selectionStart,e.selectionEnd):String(window.getSelection()||'')})}
   throw reject('未知界面操作')
  })
 }
 async function dispose(){closed=true;page.off('filechooser',fileListener);page.off('dialog',dialogListener);page.off('download',downloadListener);for(const row of downloads.values()){row.stream?.destroy();await row.download.delete().catch(()=>{})}for(const item of notices.values())if(item.kind==='select')await item.handle.dispose();downloads.clear();notices.clear();lastImage=null}
 return {operate,dispose,isBusy:()=>notices.size>0||downloads.size>0,hasNativeDialog:()=>[...notices.values()].some(item=>item.kind==='dialog')}
}
