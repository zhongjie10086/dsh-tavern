/** Shared ST menu DOM: original scripts append their own nodes and handlers. */
function ensureTavernLegacyMenus(win) {
  if (win.__dshTavernLegacyMenus) return win.__dshTavernLegacyMenus;
  const doc=win.document,root=doc.createElement('div');root.id='dsh-tavern-legacy-menus';root.dataset.dshLegacyMenus='true';
  const listeners=new Set(),menus={},content={};let active='',sessionId='',actions={};
  for(const [kind,id,label] of [['extensions','extensionsMenu','魔法棒'],['options','options','聊天菜单']]) {
    const menu=doc.createElement('div');menu.id=id;menu.className='dsh-legacy-menu options-content';menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);menu.hidden=true;menu.style.display='none';root.appendChild(menu);menus[kind]=menu;
    content[kind]=kind==='options'?menu.appendChild(doc.createElement('div')):menu;
    if(kind==='options')content[kind].className='options-content';
    menu.addEventListener('click',e=>{if(e.target.closest('button,a,[role="menuitem"],.list-group-item')&&!e.target.closest('input,textarea,select'))win.setTimeout(close,0)});
    menu.addEventListener('keydown',e=>{const items=[...menu.querySelectorAll('button,a,[role="menuitem"],.list-group-item')].filter(el=>el.getClientRects().length);if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const i=items.indexOf(doc.activeElement),next=(i+(e.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next]?.focus()}else if(['Enter',' '].includes(e.key)&&e.target.matches('.list-group-item:not(button):not(a)')){e.preventDefault();e.target.click()}});
  }
  (doc.body||doc.documentElement).appendChild(root);
  function publish(){for(const listener of listeners)listener()}
  function close(){active='';for(const menu of Object.values(menus)){menu.hidden=true;menu.style.display='none'}publish()}
  function open(kind,anchor){close();const menu=menus[kind];if(!menu)return;active=kind;menu.hidden=false;menu.style.display='block';menu.style.zIndex=String(nextTavernFloatingLayer());const box=anchor?.getBoundingClientRect()||{left:24,top:win.innerHeight-55};menu.style.left=Math.max(8,Math.min(box.left,win.innerWidth-330))+'px';menu.style.bottom=Math.max(8,win.innerHeight-box.top+8)+'px';for(const el of menu.querySelectorAll('.list-group-item:not(button):not(a)')){if(!el.hasAttribute('tabindex'))el.tabIndex=0;if(!el.hasAttribute('role'))el.setAttribute('role','menuitem')}menu.querySelector('button,a,[role=menuitem]')?.focus();publish()}
  function configure(nextSession,nextActions){if(sessionId&&sessionId!==nextSession){close();for(const target of Object.values(content))for(const child of [...target.children])if(!child.hasAttribute('data-dsh-menu-builtin'))child.remove()}sessionId=nextSession;actions=nextActions;
    const groups={extensions:[['helper','酒馆助手 · 脚本管理'],['database','SP·数据库'],['regex','正则'],['template','提示词模板']],options:[['presets','预设管理'],['personas','玩家身份'],['characters','角色卡'],['worldbooks','世界书'],['extensions','扩展程序']]};
    for(const [kind,entries] of Object.entries(groups))for(const [id,label] of entries){if(content[kind].querySelector('[data-dsh-menu-builtin="'+id+'"]'))continue;const button=doc.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.setAttribute('data-dsh-menu-builtin',id);button.textContent=label;button.onclick=()=>actions[id]?.();content[kind].appendChild(button)}
  }
  function outside(e){if(active&&!root.contains(e.target)&&!e.target.closest?.('#extensionsMenuButton,#options_button'))close()}
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){close();e.stopPropagation()}},true);win.addEventListener('resize',close);
  function registerScript(id,label,onOpen){const button=doc.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.dataset.dshScriptMenu=id;button.textContent=label;button.onclick=onOpen;content.extensions.appendChild(button);return()=>button.remove()}
  const api={configure,open,close,registerScript,toggle(kind,anchor){if(active===kind)close();else open(kind,anchor)},hasScriptEntries(){return [...content.extensions.children].some(el=>!el.hasAttribute('data-dsh-menu-builtin'))},getSnapshot:()=>active,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}};
  win.__dshTavernLegacyMenus=api;return api;
}
function TavernLegacyMenuLaunchers(props) {
 const h=React.createElement,menus=React.useMemo(()=>ensureTavernLegacyMenus(window),[]),open=React.useRef(props.open);open.current=props.open;
 const active=React.useSyncExternalStore(menus.subscribe,menus.getSnapshot,menus.getSnapshot);
 React.useEffect(()=>{menus.configure(props.sessionId,Object.fromEntries(['helper','database','regex','template','presets','personas','characters','worldbooks','extensions'].map(id=>[id,()=>open.current(id)])));return()=>menus.close()},[props.sessionId]);
 return h(React.Fragment,null,h('button',{id:'extensionsMenuButton',type:'button',className:'dsh-floating-launcher','aria-label':'魔法棒','aria-haspopup':'menu','aria-expanded':active==='extensions',title:'魔法棒 · 扩展快捷入口',onClick:e=>menus.toggle('extensions',e.currentTarget)},'🪄 魔法棒'),h('button',{id:'options_button',type:'button',className:'dsh-floating-launcher','aria-label':'聊天菜单','aria-haspopup':'menu','aria-expanded':active==='options',title:'聊天菜单',onClick:e=>menus.toggle('options',e.currentTarget)},'☰'));
}
