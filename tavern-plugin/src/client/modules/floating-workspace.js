function requestTavernScriptUi(detail){const pending=window.__dshTavernPendingScriptUi||[];window.__dshTavernPendingScriptUi=pending.filter(p=>p.sessionId!==detail.sessionId||p.kind!==(detail.kind||'companion')).concat({...detail,kind:detail.kind||'companion'}).slice(-40);window.dispatchEvent(new CustomEvent('dsh-tavern-open-script-ui',{detail}));}
function nextTavernFloatingLayer() {
  const layer=window.__dshTavernFloatingLayer=Math.max(1000000,Number(window.__dshTavernFloatingLayer)||0)+1;
  queueMicrotask(()=>window.dispatchEvent(new Event('dsh-tavern-floating-layer')));
  return layer;
}
// One observation source for launcher visibility and error placement. Ordinary floating
// dialogs are deliberately excluded; minimizing one must not suppress its launcher.
const tavernModalState=(function(){
  let snapshot=Object.freeze({blocked:false,modal:null,layer:1000000}),dispose=null;
  const listeners=new Set();
  function start(){
    let frame=0,nativeOrder=[];
    function update(){
      frame=0;
      const visible=element=>!element.closest('[hidden],[aria-hidden="true"]')&&element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
      const natives=[...document.querySelectorAll('dialog:modal')].filter(visible);
      nativeOrder=nativeOrder.filter(element=>natives.includes(element));
      for(const element of natives)if(!nativeOrder.includes(element))nativeOrder.push(element);
      const focused=document.activeElement?.closest('dialog:modal');
      if(focused&&natives.includes(focused))nativeOrder=nativeOrder.filter(element=>element!==focused).concat(focused);
      const other=[...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible);
      const focusedOther=other.find(element=>element.contains(document.activeElement));
      const settings=[...document.querySelectorAll('.dsh-tavern-settings-section')].find(visible);
      const modal=nativeOrder.at(-1)||focusedOther||other.at(-1)||settings||null;
      const next={blocked:!!modal,modal,layer:Math.max(1000000,Number(window.__dshTavernFloatingLayer)||0)};
      if(next.modal!==snapshot.modal||next.layer!==snapshot.layer){snapshot=Object.freeze(next);listeners.forEach(listener=>listener());}
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','aria-hidden','aria-modal','class','style','data-state']});
    for(const event of ['toggle','focusin','close'])document.addEventListener(event,schedule,true);
    for(const event of ['resize','dsh-tavern-floating-layer'])window.addEventListener(event,schedule);
    update();
    return()=>{observer.disconnect();for(const event of ['toggle','focusin','close'])document.removeEventListener(event,schedule,true);for(const event of ['resize','dsh-tavern-floating-layer'])window.removeEventListener(event,schedule);if(frame)cancelAnimationFrame(frame);};
  }
  return {getSnapshot:()=>snapshot,subscribe(listener){listeners.add(listener);if(!dispose)dispose=start();return()=>{listeners.delete(listener);if(!listeners.size&&dispose){dispose();dispose=null;}};}};
})();
function useTavernModalState(){return React.useSyncExternalStore(tavernModalState.subscribe,tavernModalState.getSnapshot,tavernModalState.getSnapshot);}
const tavernFloatingWindows = (function () {
  let snapshot = Object.freeze([]), serial = 0;
  const listeners = new Set();
  function publish(value) { snapshot = Object.freeze(value); listeners.forEach(function (fn) { fn(); }); }
  return {
    subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    getSnapshot: function () { return snapshot; },
    openResourceLibrary: function (kind, title, meta) {
      const id = 'resource-library:' + kind, previous = snapshot.find(item => item.id === id);
      publish(snapshot.filter(item => item.id !== id).concat([Object.assign({}, previous, { id, kind: 'resource-library-' + kind, resourceLibrary: kind, title, meta, minimized: false, order: ++serial })]));
    },
    open: function (sessionId, kind, title, page) {
      if (!sessionId) return;
      const id = sessionId + ':' + kind, previous = snapshot.find(function (item) { return item.id === id; });
      publish(snapshot.filter(function (item) { return item.id !== id; }).concat([Object.assign({}, previous, { id: id, sessionId: sessionId, kind: kind, title: title, page: page, minimized: false, order: ++serial })]));
    },
    minimize: function (id) { publish(snapshot.map(function (item) { return item.id === id ? Object.assign({}, item, { minimized: true }) : item; })); },
    close: function (id) { publish(snapshot.filter(function (item) { return item.id !== id; })); }
  };
})();
function tavernWindowRect(kind) {
  let saved = {};
  try { saved = JSON.parse(tavernPreferenceStorage('getItem','dsh-tavern.window.' + kind) || '{}'); } catch (_) {}
  const width = Math.min(Math.max(Number(saved.width) || (kind==='database'?1320:940), 320), window.innerWidth - 16);
  const height = Math.min(Math.max(Number(saved.height) || (kind==='database'?850:720), 240), window.innerHeight - 24);
  return { width: width, height: height, x: Math.max(8, Math.min(Number(saved.x) || (window.innerWidth - width) / 2, window.innerWidth - width - 8)), y: Math.max(8, Math.min(Number(saved.y) || 70, window.innerHeight - height - 8)) };
}
function TavernFloatingWindow(props) {
  const h = React.createElement, item = props.item;
  const [container] = React.useState(function () { const element = document.createElement('div'); element.className = 'dsh-floating-portal'; return element; });
  const [rect, setRect] = React.useState(function () { return tavernWindowRect(item.kind); });
  const [pip, setPip] = React.useState(null), [error, setError] = React.useState(''), [layer, setLayer] = React.useState(nextTavernFloatingLayer);
  const restoreRect=React.useRef(null),[maximized,setMaximized]=React.useState(false);
  const mounted=React.useRef(false),popPending=React.useRef(false);
  const rectRef = React.useRef(rect), dialog = React.useRef(null), drag = React.useRef(null), dirty = React.useRef(false), pipRef = React.useRef(null);
  rectRef.current = rect;
  React.useLayoutEffect(function () {
    mounted.current=true;
    document.body.appendChild(container);
    function resized() {
      const current = rectRef.current;
      const width = Math.min(current.width, innerWidth - 16), height = Math.min(current.height, innerHeight - 24);
      setRect(Object.assign({}, current, { width: width, height: height, x: Math.max(8, Math.min(current.x, innerWidth - width - 8)), y: Math.max(8, Math.min(current.y, innerHeight - height - 8)) }));
    }
    window.addEventListener('resize', resized);
    return function () { mounted.current=false; window.removeEventListener('resize', resized); const child=pipRef.current; pipRef.current=null; if(child){child.removeEventListener('pagehide',returnToPage);child.close();} container.remove(); };
  }, [container]);
  React.useEffect(function () {
    if (!dialog.current || pip) return;
    let timer;
    const observer = new ResizeObserver(function () {
      if (!dialog.current || item.minimized) return;
      const measured = dialog.current.getBoundingClientRect();
      if (measured.width < 100 || measured.height < 100) return;
      rectRef.current = Object.assign({}, rectRef.current, { width: measured.width, height: measured.height });
      clearTimeout(timer); timer = setTimeout(function () { tavernPreferenceStorage('setItem','dsh-tavern.window.' + item.kind, JSON.stringify(rectRef.current)); }, 180);
    });
    observer.observe(dialog.current);
    return function () { observer.disconnect(); clearTimeout(timer); };
  }, [pip, item.minimized, item.kind]);
  React.useEffect(function () { setLayer(nextTavernFloatingLayer()); }, [item.order]);
  function saveRect(next) { rectRef.current = next; setRect(next); tavernPreferenceStorage('setItem','dsh-tavern.window.' + item.kind, JSON.stringify(next)); }
  function pointerDown(event) {
    if (pip || event.button !== 0 || event.target.closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, rect: Object.assign({}, rectRef.current) };
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
  }
  function pointerMove(event) {
    if (!drag.current) return;
    const start = drag.current, next = Object.assign({}, start.rect, {
      x: Math.max(8, Math.min(start.rect.x + event.clientX - start.x, innerWidth - start.rect.width - 8)),
      y: Math.max(8, Math.min(start.rect.y + event.clientY - start.y, innerHeight - 54))
    });
    setRect(next);
  }
  function pointerUp() { if (drag.current) { drag.current = null; saveRect(rectRef.current); } }
  function returnToPage() {
    if(!mounted.current){container.remove();return;}
    document.body.appendChild(container); pipRef.current = null; setPip(null);
  }
  async function popOut() {
    if(popPending.current)return;
    setError('');
    if (pipRef.current) { pipRef.current.close(); return; }
    if (!window.documentPictureInPicture) { setError('当前浏览器不支持系统小窗，仍可使用页面内浮窗。'); return; }
    popPending.current=true;
    try {
      const mirroredFrame=container.querySelector('iframe');
      if(mirroredFrame?.__dshTavernMirror){await mirroredFrame.__dshTavernMirror.open();return;}
      const child = await window.documentPictureInPicture.requestWindow({ width: Math.round(rectRef.current.width), height: Math.round(rectRef.current.height), disallowReturnToOpener: false });
      if(!mounted.current){child.close();return;}
      child.document.title = item.title + ' · DSH 酒馆';
      child.document.documentElement.className = document.documentElement.className;
      const computed = getComputedStyle(document.documentElement);
      for (let index = 0; index < computed.length; index++) { const key = computed[index]; if (key.startsWith('--')) child.document.documentElement.style.setProperty(key, computed.getPropertyValue(key)); }
      document.querySelectorAll('style,link[rel="stylesheet"]').forEach(function (style) {
        const copy = style.cloneNode(true); if (copy.tagName === 'LINK') copy.href = style.href; child.document.head.appendChild(copy);
      });
      child.document.body.style.margin = '0';
      child.document.body.appendChild(container);
      pipRef.current = child; setPip(child);
      child.addEventListener('pagehide', returnToPage, { once: true });
    } catch (error) { if(mounted.current)setError('系统小窗未打开：' + error.message); }
    finally {popPending.current=false;}
  }
  function maximize(){if(maximized){saveRect(restoreRect.current||tavernWindowRect(item.kind));setMaximized(false)}else{restoreRect.current={...rectRef.current};saveRect({x:8,y:8,width:innerWidth-16,height:innerHeight-16});setMaximized(true)}}
  const dirtyCloseMessage='此窗口有未保存的编辑，请先保存或放弃编辑；也可以最小化。';
  function reportDirty(value) {
    dirty.current=value;
    if(!value)setError(current=>current===dirtyCloseMessage?'':current);
  }
  function close() {
    if (dirty.current) { setError(dirtyCloseMessage); return; }
    tavernFloatingWindows.close(item.id);
  }
  function button(label, work, title) { return h('button', { type: 'button', className: 'dsh-floating-control', 'aria-label': label, title: title || label, onClick: work }, label); }
  const style = pip ? { position: 'relative', width: '100vw', height: '100vh', left: 0, top: 0, resize: 'none' } : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: layer };
  style.display = item.minimized && !pip ? 'none' : 'flex';
  const embeddedTitles={'play-settings':'本局设置',characters:'角色卡管理',extensions:'扩展程序',personas:'玩家身份',presets:'预设管理','resource-permissions':'本局资源授信','resource-versions':'本局资源版本'};
  return ReactDom.createPortal(h('section', { ref: dialog, className: 'dsh-floating-window', role: 'dialog', 'aria-label': item.title, 'data-window-kind': item.kind, 'data-tavern-embedded-title':embeddedTitles[item.kind]===item.title?true:undefined, style: style,
    onPointerDown: function () { setLayer(nextTavernFloatingLayer()); } },
    h('header', { className: 'dsh-floating-titlebar', onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerUp, onLostPointerCapture: pointerUp },
      h('strong', null, item.title), h('span', { className: 'dsh-floating-controls' },
        button(pip ? '返回页面' : '系统小窗', popOut, '系统小窗保持置顶；主页面关闭后小窗也会关闭。浏览器决定初始位置。'),
        !pip?button(maximized?'还原大小':'最大化',maximize):null,button('重置位置', function () { tavernPreferenceStorage('removeItem','dsh-tavern.window.' + item.kind); saveRect(tavernWindowRect(item.kind)); }),
        button('最小化', function () { if (pipRef.current) pipRef.current.close(); tavernFloatingWindows.minimize(item.id); }),
        button('关闭', close))),
    error ? h('div', { className: 'dsh-floating-error', role: 'alert' }, error) : null,
    h('div', { className: 'dsh-floating-content' }, props.renderContent(reportDirty))
  ), container);
}
function TavernFloatingLauncher(props) {
  const h=React.createElement,kind=props.button.kind,storageKey='dsh-tavern.launcher.'+kind;
  function initial(){let saved;try{saved=JSON.parse(tavernPreferenceStorage('getItem',storageKey)||'null')}catch{};return saved||{x:innerWidth-96,y:innerHeight-(kind==='preset'?240:145)}}
  function clamp(value){return {x:Math.max(4,Math.min(innerWidth-76,Number(value.x)||4)),y:Math.max(4,Math.min(innerHeight-76,Number(value.y)||4))}}
  const [position,setPosition]=React.useState(()=>clamp(initial())),drag=React.useRef(null),current=React.useRef(position),moved=React.useRef(false);current.current=position;
  React.useEffect(()=>{function resized(){setPosition(clamp(current.current))}window.addEventListener('resize',resized);return()=>window.removeEventListener('resize',resized)},[]);
  function down(e){if(e.button!==0)return;moved.current=false;drag.current={x:e.clientX,y:e.clientY,position:current.current};e.currentTarget.setPointerCapture(e.pointerId)}
  function move(e){const start=drag.current;if(!start)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!moved.current&&Math.hypot(dx,dy)<4)return;moved.current=true;setPosition(clamp({x:start.position.x+dx,y:start.position.y+dy}));e.preventDefault()}
  function up(){if(drag.current){drag.current=null;if(moved.current)tavernPreferenceStorage('setItem',storageKey,JSON.stringify(current.current))}}
  return ReactDom.createPortal(h('button',{type:'button',hidden:props.hidden,className:'dsh-original-floating-entry dsh-original-entry-'+kind,'data-floating-plugin':kind,'aria-label':'打开'+props.button.title+'浮窗',title:props.button.title+' · 点击打开，拖动可移动',style:{left:position.x,top:position.y},onContextMenu:e=>{if(kind==='preset'){e.preventDefault();props.open({...props.button,quick:true})}},onPointerDown:down,onPointerMove:move,onPointerUp:up,onLostPointerCapture:up,onClick:e=>{if(moved.current&&e.detail!==0){moved.current=false;return;}props.open(props.button)}},kind==='preset'?h('img',{src:'/api/dsh-tavern/client-assets/izumi-launcher.png',alt:'泉此方',draggable:false}):h('span',{'aria-hidden':true},'⚙')),document.body);
}
function TavernFloatingWorkspace(props) {
  const h=React.createElement,entries=React.useSyncExternalStore(tavernFloatingWindows.subscribe,tavernFloatingWindows.getSnapshot,tavernFloatingWindows.getSnapshot),live=useLiveTavernView(props.sessionId);
  const launchersBlocked=useTavernModalState().blocked;
  if(!live.view||!['story','script'].includes(live.view.mode))return null;
  function version(kind,fallback){const name=live.view.tavernHelperScripts?.find(script=>script.uiKind===kind)?.name||'';return name.match(/V\d+(?:\.\d+)+/i)?.[0]||fallback;}
  const buttons=[
    {kind:'preset',title:'Izumi floating window',page:'preset',icon:'✎'},
    {kind:'companion',title:version('companion','V3.732')+' 状态栏',page:'companion',icon:'⚙'},
    {kind:'play-settings',title:'本局设置',page:'play-settings',icon:'⚙'},
    {kind:'database',title:'SP·数据库',page:'dashboard',icon:'▦'},
    {kind:'database-visualizer',title:version('database-visualizer','V13.28')+' 可视化前端',page:'tables',icon:'▤'},
    {kind:'prompt-template',title:'提示词模板',page:'prompt-template',icon:'⌗'},
    {kind:'worldbooks',title:'世界书',page:'worldbooks',icon:'🌐'},
    {kind:'regex',title:'正则',page:'regex',icon:'.*'},
    {kind:'extensions',title:'扩展程序',page:'extensions',icon:'⌘'}
  ];
  function renderPanel(item,onDirty){if(item.page==='resource-versions')return h(TavernResourceVersionPanel,{embedded:true,sessionId:item.sessionId,api:(method,args)=>rpc(method,args,item.sessionId),onOpenWorldbooks:()=>tavernFloatingWindows.open(item.sessionId,'worldbooks','世界书库','worldbooks')});const api=async(method,args)=>{const result=await rpc(method,args,item.sessionId);if(['changeTavernScriptLibrary','applyTavernScriptLibrary','changeTavernExtension','setTemplateEngineMode','runFullPromptTemplate','saveFullPromptTemplateSettings'].includes(method))liveTavernView.invalidate(item.sessionId);return result},common={sessionId:item.sessionId,api,onDirty};if(['companion','database-visualizer'].includes(item.kind))return h('section',{className:'dsh-plugin-panel','data-tavern-owned-ui':true},h('h2',null,item.title),h('p',null,'尚未启用对应的原版脚本，请在酒馆助手中导入并启用。'),h('button',{className:'dsh-tavern-btn',onClick:()=>tavernFloatingWindows.open(item.sessionId,'helper','酒馆助手','helper')},'打开酒馆助手'));if(item.page==='resource-permissions')return h(TavernResourcePermissions,{...common,embedded:true});if(item.page==='play-settings')return h(TavernPlaySettings,common);if(item.page==='user-profile')return h('section',{'data-tavern-owned-ui':true},h(UserPreferenceProfileTab,{embedded:true,scope:{sessionId:item.sessionId},onDirty}));if(item.page==='worldbooks')return h('section',{'data-tavern-owned-ui':true},h(worldBookLibraryFeature.Library,{scope:{sessionId:item.sessionId},onDirty}));if(item.page==='personas')return h(TavernPersonaManager,common);if(item.page==='presets')return h(TavernPresetManager,common);if(item.page==='regex')return h(TavernPresetManager,{...common,regexOnly:true});if(item.page==='characters')return h(TavernCharacterManager,common);if(item.page==='extensions')return h(TavernExtensionsPanel,common);if(['helper','scripts','audio'].includes(item.page))return h(TavernHelperPanel,{...common,initialPage:item.page});if(item.page==='prompt-template')return h(TavernPromptTemplatePanel,common);return props.renderWorkbench({scope:{sessionId:item.sessionId},initialPage:item.page,floating:true,onDirty});}
  function open(button){if(button.kind==='database'&&live.view.tavernHelperScripts?.some(s=>s.uiKind==='extension-sp-database')){requestTavernScriptUi({sessionId:props.sessionId,kind:'extension-sp-database'});return}if(['preset','companion','database-visualizer'].includes(button.kind)&&live.view.tavernHelperScripts?.some(s=>s.uiKind===button.kind||button.kind==='companion'&&s.originalUi&&!s.uiKind))requestTavernScriptUi({sessionId:props.sessionId,kind:button.kind,quick:button.quick===true});else tavernFloatingWindows.open(props.sessionId,button.kind,button.title,button.page);}
  const dockButtons=buttons.slice(2).filter(button=>button.kind!=='database'||live.view.extensions?.installed?.enabled!==false&&live.view.spDatabase);
  function dockButton(button){const entry=entries.find(item=>item.sessionId===props.sessionId&&item.kind===button.kind);return h('button',{key:button.kind,type:'button',className:'dsh-floating-launcher','aria-label':'打开'+button.title+'浮窗','aria-expanded':!!entry&&!entry.minimized,onClick:()=>open(button)},button.icon+' '+button.title+(entry?.minimized?' · 恢复':''));}
  const legacyMenus=h(TavernLegacyMenuLaunchers,{sessionId:props.sessionId,open:kind=>{const button=buttons.find(b=>b.kind===kind);if(button){open(button);return;}const routes={helper:['酒馆助手','helper'],template:['提示词模板','prompt-template'],presets:['预设管理','presets'],personas:['玩家身份','personas'],characters:['角色卡','characters']};const route=routes[kind];if(route)tavernFloatingWindows.open(props.sessionId,kind==='template'?'prompt-template':kind,route[0],route[1]);}});
  return h(React.Fragment,null,
    ...buttons.slice(0,2).map(button=>h(TavernFloatingLauncher,{key:button.kind,button,open,hidden:launchersBlocked})),
    h('nav',{className:'dsh-floating-launchers','data-plugin-dock':'anchored','aria-label':'酒馆插件工具栏'},
      legacyMenus,
      dockButtons.filter(button=>['play-settings','database'].includes(button.kind)).map(dockButton),
      h('details',{className:'dsh-floating-tools-menu',onBlur:event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;},onKeyDown:event=>{if(event.key==='Escape'){event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}},
        h('summary',null,'更多工具'),
        h('div',{className:'dsh-floating-tools-body',onClick:event=>{if(event.target.closest('button'))event.currentTarget.closest('details').open=false;}},dockButtons.filter(button=>!['play-settings','database'].includes(button.kind)).map(dockButton)))),
    ...entries.filter(item=>item.sessionId===props.sessionId).map(item=>h(TavernFloatingWindow,{key:item.id,item,renderContent:onDirty=>renderPanel(item,onDirty)})));
}
