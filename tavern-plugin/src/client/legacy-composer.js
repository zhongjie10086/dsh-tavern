// Legacy card pages submit through these SillyTavern DOM IDs. Keep the
// adapter inside its owning frame so it cannot target another conversation.
function installLegacyTavernComposer() {
  if (document.getElementById('send_textarea') || document.getElementById('send_but')) return;
  const controls = document.createElement('div');
  controls.hidden = true;
  const area = document.createElement('textarea');
  area.id = 'send_textarea';
  const button = document.createElement('button');
  button.id = 'send_but';
  button.type = 'button';
  controls.append(area, button);
  document.body.append(controls);
  area.addEventListener('input', function () {
    Promise.resolve().then(function () {
      if (typeof window.triggerSlash !== 'function') throw new Error('当前对话输入框尚未就绪');
      return window.triggerSlash('/setinput ' + String(area.value || ''));
    }).catch(function (error) {
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.textContent = '开场文字填入失败：' + String(error && error.message || error);
      document.body.append(notice);
    });
  });
  let pending = false;
  button.addEventListener('click', function () {
    const text = String(area.value || '').trim();
    if (pending || !text) return;
    if (typeof window.triggerSlash !== 'function') throw new Error('当前对话发送入口尚未就绪');
    pending = true;
    button.disabled = true;
    Promise.resolve().then(function () {
      return window.triggerSlash('/send ' + text + '|/trigger');
    }).then(function () {
      if (area.value.trim() === text) area.value = '';
    }, function (error) {
      // A DOM click cannot return an asynchronous rejection to legacy callers.
      // Surface it in the card itself, retaining the payload for a retry.
      const notice = document.createElement('div');
      notice.setAttribute('role', 'alert');
      notice.textContent = '开局消息发送失败：' + String(error && error.message || error);
      document.body.append(notice);
      console.error('[DSH Tavern] 开局消息发送失败', error);
    }).finally(function () { pending = false; button.disabled = false; });
  });
}

// Preparation pages address the parent DOM. Own these controls only while that
// preview is mounted; they must never forward a submission to the current chat.
function installOpeningHostComposer(hostDocument, submit, report) {
  if (hostDocument.getElementById('send_textarea') || hostDocument.getElementById('send_but')) return function () {};
  const controls = hostDocument.createElement('div');
  controls.hidden = true;
  const area = hostDocument.createElement('textarea');
  area.id = 'send_textarea';
  const button = hostDocument.createElement('button');
  button.id = 'send_but'; button.type = 'button';
  controls.append(area, button);
  hostDocument.body.append(controls);
  let active = true, pending = false, completed = false;
  button.addEventListener('click', function () {
    const text = String(area.value || '').trim();
    if (!active || pending || completed || !text) return;
    pending = true; button.disabled = true;
    Promise.resolve().then(function () { return submit(text); }).then(function () {
      completed = true; area.value = '';
    }, report).finally(function () { pending = false; button.disabled = completed; });
  });
  return function () { active = false; controls.remove(); };
}


// Original script windows use native textarea setters; mirror them to the
// owning DSH draft through the authenticated script channel.
async function installTavernScriptComposer(win, call, token, options={}) {
  const doc=win.document;
  if(!doc.body)await new Promise(resolve=>doc.addEventListener('DOMContentLoaded',resolve,{once:true}));
  if(doc.getElementById('send_textarea'))return;
  const controls=doc.createElement('div'),area=doc.createElement('textarea'),button=doc.createElement('button');
  controls.hidden=true;controls.dataset.dshScriptComposer='true';area.id='send_textarea';button.id='send_but';button.type='button';
  controls.append(area,button);doc.body.append(controls);
  let latest={draft:'',revision:-1,composerEpoch:0},optimistic='',pending=0,tail=Promise.resolve(),sending=false,disposed=false,writeError=null,previewIntent=false,attached=true;
  const epochCurrent=epoch=>options.owned!==true||epoch===latest.composerEpoch;
  function assertEpoch(epoch){if(!epochCurrent(epoch))throw Error('SP 输入连接代次已变化，旧操作未应用')}
  function applyReply(value,epoch){assertEpoch(epoch);if(options.owned===true&&value?.composerEpoch!==epoch)throw Error('SP 输入回执连接代次已变化');apply(value);return value}
  function apply(value){
    if(!value)return;
    let advanced=false;
    if(options.owned===true){
      if(!Number.isSafeInteger(value.composerEpoch)||value.composerEpoch<1)throw Error('SP 输入连接代次无效');
      if(value.composerEpoch<latest.composerEpoch)return;
      advanced=value.composerEpoch>latest.composerEpoch;
      if(advanced){pending=0;tail=Promise.resolve();sending=false;button.disabled=false;writeError=null}
    }
    if(!advanced&&Number(value.revision)<latest.revision)return;
    latest={draft:String(value.draft||''),revision:Number(value.revision)||0,composerEpoch:options.owned===true?value.composerEpoch:0};
    if(options.owned===true)attached=value.attached!==false;
    if(!pending){area.value=latest.draft;optimistic=latest.draft}
  }
  function report(error){win.toastr?.error?.(String(error?.message||error),'输入框');win.console.error('[DSH Tavern] 脚本输入操作失败',error)}
  function receive(event){const data=event.data;if(event.source===win.parent&&data?.token===token&&data.type==='dsh-tavern-composer-state')apply(data.value)}
  win.addEventListener('message',receive);
  function changed(){
    if(options.owned===true&&!attached)throw Error('真实游戏输入框已关闭，草稿未写回');
    if(String(area.value||'')===optimistic)return;
    const expectedDraft=optimistic,text=String(area.value||''),epoch=latest.composerEpoch;optimistic=text;pending++;
    tail=tail.catch(()=>{}).then(()=>{assertEpoch(epoch);if(disposed)throw Error('脚本窗口已关闭');return call('tavernHelperComposer',{operation:{kind:'write',text,expectedDraft,...options.owned===true?{expectedRevision:latest.revision,expectedComposerEpoch:epoch}:{}}})})
      .then(value=>{applyReply(value,epoch);writeError=null}).catch(error=>{if(epochCurrent(epoch))writeError=error;report(error)}).finally(()=>{if(epochCurrent(epoch)){pending--;if(!pending)apply(latest)}});
  };
  area.addEventListener('input',changed);
  const nativeValue=win.HTMLTextAreaElement&&Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype,'value');
  if(nativeValue?.get&&nativeValue?.set)Object.defineProperty(area,'value',{configurable:true,get(){return nativeValue.get.call(this)},set(value){nativeValue.set.call(this,value);win.queueMicrotask(()=>{if(!disposed&&String(area.value||'')!==optimistic)changed()})}});
  function send(){
    if(previewIntent)return;
    if(sending||!String(area.value||'').trim())return;
    if(String(area.value||'')!==optimistic)changed();
    sending=true;button.disabled=true;const expectedDraft=optimistic,epoch=latest.composerEpoch;
    tail=tail.catch(()=>{}).then(()=>{assertEpoch(epoch);if(disposed)throw Error('脚本窗口已关闭');if(options.owned===true&&(!attached||writeError))throw writeError||Error('真实游戏输入框已关闭');return call('tavernHelperComposer',{operation:{kind:'send',expectedDraft,...options.owned===true?{expectedRevision:latest.revision,expectedComposerEpoch:epoch}:{}}})})
      .then(value=>applyReply(value,epoch)).catch(report).finally(()=>{if(epochCurrent(epoch)){sending=false;button.disabled=false}});
  }
  // Native context.generate must await the authenticated submission and receive
  // its actual CAS failure, rather than merely dispatching a button click.
  win.__dshSubmitTavernComposer=async function(){
    if(sending)throw Error('当前输入正在发送');
    if(!String(area.value||'').trim())throw Error('输入框为空');
    if(String(area.value||'')!==optimistic)changed();
    sending=true;button.disabled=true;const expectedDraft=optimistic,epoch=latest.composerEpoch;
    const task=tail.catch(()=>{}).then(()=>{assertEpoch(epoch);if(disposed)throw Error('脚本窗口已关闭');if(options.owned===true&&(!attached||writeError))throw writeError||Error('真实游戏输入框已关闭');return call('tavernHelperComposer',{operation:{kind:'send',expectedDraft,...options.owned===true?{expectedRevision:latest.revision,expectedComposerEpoch:epoch}:{}}})}).then(value=>applyReply(value,epoch));
    tail=task;
    try{return await task}finally{if(epochCurrent(epoch)){sending=false;button.disabled=false}}
  };
  win.__dshStopTavernComposer=()=>{const epoch=latest.composerEpoch;return call('tavernHelperComposer',{operation:{kind:'stop',...options.owned===true?{expectedComposerEpoch:epoch}:{}}}).then(value=>applyReply(value,epoch))};
  button.addEventListener('click',send);
  area.addEventListener('keydown',event=>{if(!previewIntent&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}});
  win.addEventListener('pagehide',()=>{disposed=true;win.removeEventListener('message',receive)},{once:true});
  apply(await call('tavernHelperComposer',{operation:{kind:'read'}}));
  return {apply,async flush(){await tail;if(writeError)throw writeError},async intent(value){
    const epoch=value?.composerEpoch;assertEpoch(epoch);await tail;assertEpoch(epoch);if(writeError)throw writeError;if(!attached)throw Error('真实游戏输入框已关闭');
    if(!value||typeof value.draft!=='string'||!Number.isSafeInteger(value.revision)||!['click','keydown'].includes(value.type))throw Error('SP 发送意图无效');
    apply({...value,attached:true});if(value.revision!==latest.revision||value.draft!==latest.draft)throw Error('发送前草稿版本已变化');
    previewIntent=true;let event;
    try{event=value.type==='click'?new win.MouseEvent('click',{bubbles:true,cancelable:true,button:0}):new win.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:value.key||'Enter',code:'Enter',shiftKey:value.shiftKey===true});(value.type==='click'?button:area).dispatchEvent(event)}finally{previewIntent=false}
    await tail;assertEpoch(epoch);if(writeError)throw writeError;return {prevented:event.defaultPrevented,draft:latest.draft,revision:latest.revision,composerEpoch:latest.composerEpoch};
  },dispose(){disposed=true;win.removeEventListener('message',receive);controls.remove()}};
}

// One authenticated fixed-SP viewer. The native input remains the draft owner.
function installTavernSpRemoteComposer({window:win,input,getRoot,current,command,report,running=()=>false,composerEpoch}){
 if(!Number.isSafeInteger(composerEpoch)||composerEpoch<1)throw Error('SP 输入连接代次无效');
 let revision=0,disposed=false,pending=false,tail=Promise.resolve();
 const snapshot=()=>({draft:String(input.state.getSnapshot().draft||''),revision,attached:!disposed&&current(),composerEpoch});
 function publish(){const value=snapshot();tail=tail.catch(()=>{}).then(()=>command({kind:'composer-state',composerEpoch,value}));void tail.catch(report);return tail}
 const unsubscribe=input.state.subscribe(()=>{revision++;void publish()});
 const initial=publish();
 function receive(event){
  if(disposed||!current())return;
  const root=getRoot(),editor=root?.querySelector('[data-composer-input]'),buttons=root?.querySelectorAll('button'),send=buttons?.[buttons.length-1];
  const click=event.type==='click'&&send?.contains(event.target),enter=event.type==='keydown'&&event.target===editor&&(event.key==='Enter'||event.key==='NumpadEnter')&&!event.shiftKey&&!event.isComposing;
  if(!click&&!enter)return;
  // The fixed native composer replaces its send button with Stop while busy.
  // Its cancellation must reach the original native handler without a handshake.
  if(running())return;
  event.preventDefault();event.stopImmediatePropagation();if(pending){report(Error('SP 正在处理发送意图，输入已保留'));return}
  pending=true;const expected=snapshot();
  void (async()=>{
   await initial;await tail;if(!current()||disposed)throw Error('SP 游戏页面已关闭，输入未发送');
   const value=await command({kind:'composer-intent',composerEpoch,value:{...expected,type:click?'click':'keydown',key:event.key||'Enter',shiftKey:false}});
   if(typeof value?.prevented!=='boolean'||typeof value.draft!=='string'||!Number.isSafeInteger(value.revision)||value.composerEpoch!==composerEpoch)throw Error('SP 原发送意图未获当前连接确认');
   if(value.prevented)return;
   if(!current()||disposed||snapshot().draft!==value.draft||revision!==value.revision)throw Error('发送期间输入框已变化，当前草稿已保留');
   performTavernComposerOperation(input,{kind:'send',expectedDraft:value.draft},{running:running()});
  })().catch(report).finally(()=>{pending=false});
 }
 win.addEventListener('click',receive,true);win.addEventListener('keydown',receive,true);
 const visibility=()=>{void publish()};win.document?.addEventListener('visibilitychange',visibility);
 return {snapshot,publish,dispose(){if(disposed)return;disposed=true;unsubscribe();win.document?.removeEventListener('visibilitychange',visibility);win.removeEventListener('click',receive,true);win.removeEventListener('keydown',receive,true);void command({kind:'composer-state',composerEpoch,value:snapshot()}).catch(report)}};
}

function performTavernComposerOperation(input, operation, options={}) {
  const draft=String(input.state.getSnapshot().draft||'');
  if(!operation||!['read','write','send','stop'].includes(operation.kind))throw new Error('未知输入框操作');
  if(operation.kind==='stop'){
    if(typeof options.stop!=='function')throw new Error('当前会话停止入口不可用');
    return Promise.resolve(options.stop()).then(()=>({draft:String(input.state.getSnapshot().draft||''),revision:options.revision?.()||0}));
  }
  if(operation.kind!=='read'&&String(operation.expectedDraft??'')!==draft)throw new Error('输入框已被修改，已保留当前草稿；请重新操作');
  if(operation.kind==='write'){
    if(typeof operation.text!=='string'||operation.text.length>1000000)throw new Error('输入文字无效或过长');
    input.setDraft(operation.text);
  }else if(operation.kind==='send'){
    if(!draft.trim())throw new Error('输入框为空');
    if(options.running)throw new Error('请等当前生成完成');
    input.submit('queue');
  }
  return {draft:String(input.state.getSnapshot().draft||''),revision:options.revision?.()||0};
}

// Focused card previews keep their own submission target. Trusted scripts may
// additionally register one explicit live draft owner for parent DOM / jQuery.
// No owner is inferred from whichever conversation happens to be active.
const tavernHostComposers = new WeakMap();
function installFrameHostComposer(doc, ownsFrame, submit, report, liveInput = null, liveRoot = null) {
  let state = tavernHostComposers.get(doc);
  if (!state) {
    if (doc.getElementById('send_textarea') || doc.getElementById('send_but')) return function () {};
    const controls = doc.createElement('div');
    controls.hidden = true;
    const area = doc.createElement('textarea'), button = doc.createElement('button');
    area.id = 'send_textarea'; button.id = 'send_but'; button.type = 'button';
    controls.append(area, button); doc.body.append(controls);
    state = { controls, owners: new Set() };
    tavernHostComposers.set(doc, state);
    function selected() {
      const focused = Array.from(state.owners).filter(owner => owner.ownsFrame(doc.activeElement));
      if (focused.length) return focused.length === 1 ? focused[0] : null;
      const live = Array.from(state.owners).filter(owner => owner.liveInput);
      return live.length === 1 ? live[0] : null;
    }
    const descriptor = doc.defaultView?.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(doc.defaultView.HTMLTextAreaElement.prototype, 'value');
    const readRaw = () => descriptor?.get ? descriptor.get.call(area) : String(area.value || '');
    const writeRaw = value => { if (descriptor?.set) descriptor.set.call(area, value); else area.value = value; };
    function writeDraft() {
      const owner = selected();
      if (!owner?.liveInput) return;
      const text = String(readRaw());
      if (text !== String(owner.liveInput.state.getSnapshot().draft || '')) owner.liveInput.setDraft(text);
    }
    // Both jQuery .val() and native value setters followed by input events work.
    if (descriptor?.get && descriptor?.set) Object.defineProperty(area, 'value', {
      configurable: true,
      get() { const owner = selected(); return owner?.liveInput ? String(owner.liveInput.state.getSnapshot().draft || '') : readRaw(); },
      set(value) { writeRaw(String(value ?? '')); writeDraft(); }
    });
    area.addEventListener('input', writeDraft);
    state.refresh = () => { const owner = selected(); if (owner?.liveInput) writeRaw(String(owner.liveInput.state.getSnapshot().draft || '')); };
    button.addEventListener('click', function () {
      const owner = selected();
      if (!owner) { const error = new Error('无法确定消息所属的卡片或对话，请重新打开对应界面'); const reporter = state.owners.values().next().value; if (reporter) reporter.report(error); else throw error; return; }
      const text = String(area.value || '').trim();
      if (owner.pending || !text) return;
      owner.pending = true;
      Promise.resolve().then(function () {
        if (!state.owners.has(owner)) throw new Error('卡片已关闭，请重新打开');
        return owner.submit(text);
      }).then(function () { if (state.owners.has(owner) && selected() === owner && area.value === text) area.value = ''; }, owner.report)
        .finally(function () { owner.pending = false; });
    });
  }
  const owner = { ownsFrame, submit, report, liveInput, pending: false };
  state.owners.add(owner);
  // Expose the real host controls during their native DOM events. Between
  // events the textarea proxy remains available, including native textarea
  // setters used by original plugins. Never synthesize trusted user input.
  let restoreEvent = null;
  function nativeEvent(event) {
    if (!liveInput || !liveRoot || !state.owners.has(owner)) return;
    const root = liveRoot(), editor = root?.querySelector('[data-composer-input]');
    const send = root?.querySelectorAll('button');
    const button = send?.[send.length - 1];
    if (!editor || (event.type === 'click' ? !button?.contains(event.target) : event.target !== editor)) return;
    restoreEvent?.();
    const saved = [], value = Object.getOwnPropertyDescriptor(editor, 'value');
    function alias(node, id) { if (!node) return; saved.push([node, node.id]); node.id = id; }
    alias(doc.getElementById('send_textarea'), '');
    alias(doc.getElementById('send_but'), '');
    alias(editor, 'send_textarea'); alias(button, 'send_but');
    Object.defineProperty(editor, 'value', { configurable: true,
      get() { return event.type === 'input' ? editor.innerText : String(liveInput.state.getSnapshot().draft || ''); },
      set(text) { liveInput.setDraft(String(text ?? '')); }
    });
    const restore = () => {
      for (const [node, id] of saved.reverse()) node.id = id;
      if (value) Object.defineProperty(editor, 'value', value); else delete editor.value;
      if (restoreEvent === restore) restoreEvent = null;
    };
    restoreEvent = restore;
    // A browser may drain microtasks between native event listeners; retain
    // these IDs through capture, target, bubble and the native default action.
    doc.defaultView.setTimeout(() => { if (restoreEvent === restore) restore(); }, 0);
  }
  if (liveRoot) for (const name of ['input', 'keydown', 'click']) doc.defaultView.addEventListener(name, nativeEvent, true);
  const unsubscribe = liveInput?.state.subscribe(() => state.refresh());
  state.refresh();
  return function () {
    unsubscribe?.();
    if (liveRoot) for (const name of ['input', 'keydown', 'click']) doc.defaultView.removeEventListener(name, nativeEvent, true);
    restoreEvent?.();
    state.owners.delete(owner);
    if (!state.owners.size) { state.controls.remove(); tavernHostComposers.delete(doc); }
    else state.refresh();
  };
}
