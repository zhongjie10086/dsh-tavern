// Runs in the existing script-owned frame. Original imports are real ESM live
// bindings; host authority still comes from the frame transport, never manifest data.
function installTavernGithubExtensionHost(win, {call, context}) {
  let sync = () => {};
  win.__dshSyncGithubExtension = () => sync();
  win.__dshInstallGithubExtension = async function (input) {
    const owner = win.getScriptId(), doc = win.document, st = win.SillyTavern.getContext();
    await win.__dshTavernComposerReady;
    const graph=input.graph;
    const assetUrl=path=>{const row=graph?.assets[path];if(!row)throw Error('扩展资源未打包：'+path);return 'data:'+row.type+';base64,'+row.base64};
    function cssText(path,parents=new Set()){
      if(parents.has(path))return '';const row=graph.styles[path];if(!row)throw Error('扩展样式未打包：'+path);
      const stack=new Set(parents).add(path);let text=row.source;
      for(const ref of row.refs.slice().reverse()){const url=ref.kind==='css'?'data:text/css;charset=utf-8,'+encodeURIComponent(cssText(ref.path,stack)):assetUrl(ref.path);text=text.slice(0,ref.start)+(ref.form==='import'?'@import '+JSON.stringify(url):'url('+JSON.stringify(url)+')')+text.slice(ref.end)}
      return text;
    }
    await win.__dshInstallExtensionHost({...input,style:graph?.css?cssText(graph.css):input.style});
    const copy = value => JSON.parse(JSON.stringify(value));
    const report = error => { win.toastr.error(error.message); throw error; };
    // ST extensions write extra.choice. Host-owned extra also contains history
    // semantics, so persist extension extras in the normal plugin-data namespace.
    const messageViews = new WeakMap();
    function messageView(message) {
      if(messageViews.has(message))return messageViews.get(message);
      const ownExtra=()=>message.dshFrontendExtensions?.[owner] || {};
      const extras=new Proxy(Object.create(null),{
        get:(_,key)=>Object.hasOwn(ownExtra(),key)?ownExtra()[key]:message.extra?.[key],
        set:(_,key,value)=>{message.dshFrontendExtensions ||= {};message.dshFrontendExtensions[owner] ||= {};Object.defineProperty(ownExtra(),key,{value,enumerable:true,configurable:true,writable:true});return true;},
        ownKeys:()=>[...new Set([...Object.keys(message.extra || {}),...Object.keys(ownExtra())])],
        getOwnPropertyDescriptor:(_,key)=>Object.hasOwn(ownExtra(),key)||Object.hasOwn(message.extra || {},key)?{value:extras[key],enumerable:true,configurable:true,writable:true}:undefined
      });
      const view=new Proxy(message,{get:(target,key)=>key==='extra'?extras:target[key],set:(target,key,value)=>{if(key==='extra'){for(const [k,v]of Object.entries(value || {}))extras[k]=v;}else target[key]=value;return true;}});
      messageViews.set(message,view);return view;
    }
    const settings = () => st.extensionSettings[owner] || {};
    const regexes = scope => (context().regexScripts?.[scope] || []).map(row=>({...copy(row),scriptName:row.scriptName || row.name || '',disabled:row.disabled === true || row.enabled === false}));
    const extension_settings = new Proxy(Object.create(null), {
      get: (_, key) => key === owner ? settings() : key === 'regex' ? regexes('global') : settings()[key],
      set: (_, key, value) => { if(key===owner){st.extensionSettings[owner]=value;return true}if (!Object.hasOwn(st.extensionSettings,owner)) st.extensionSettings[owner] = {}; Object.defineProperty(settings(),key,{value,enumerable:true,configurable:true,writable:true}); return true; },
      ownKeys: () => Reflect.ownKeys(settings()),
      getOwnPropertyDescriptor: (_, key) => Object.hasOwn(settings(),key) ? {value:settings()[key],enumerable:true,configurable:true,writable:true} : undefined,
      deleteProperty: (_, key) => { delete settings()[key]; return true; }
    });
    const extensionContext=Object.create(st);
    Object.defineProperties(extensionContext,{
      getContext:{value:()=>extensionContext,enumerable:true},extensionSettings:{value:extension_settings,enumerable:true},
      characters:{get:()=>characters,enumerable:true},chat:{get:()=>st.chat.map(messageView),enumerable:true},
      getCharacterCardFields:{value:()=>copy(ch?.data||{}),enumerable:true},
      writeExtensionField:{value:async(id,field,value)=>{await st.writeExtensionField(id,field,value);if(ch){if(value===null)delete ch.data.extensions[field];else Object.defineProperty(ch.data.extensions,field,{value:copy(value),enumerable:true,writable:true,configurable:true})}return true},enumerable:true}
    });
    win.SillyTavern=Object.freeze(extensionContext);win.getContext=()=>extensionContext;
    // Expose the current character and its per-chat extension overlay. Automatic
    // bindings never rewrite the shared source card.
    const characters = st.characters;
    const ch = characters[0];
    if (ch) {
      ch.data ||= copy(ch);
      ch.data.extensions ||= {};
      ch.data.extensions.regex_scripts = regexes('character');
      if (!ch.data.extensions.choice && context().characterVariables?.[owner]?.choice) ch.data.extensions.choice = copy(context().characterVariables[owner].choice);
      ch.json_data = JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:ch.data});
    }
    async function saveCharacter(data = ch?.data, avatar = ch?.avatar) {
      if (!ch || avatar !== ch.avatar || !data) throw Error('只能保存当前角色的扩展绑定');
      const strip=value=>{const result=copy(value);delete result.extensions;return result};
      const base=context().character?.data||context().character||{};
      if(JSON.stringify(strip(data))!==JSON.stringify(strip(base)))throw Error('自动角色保存仅修改本局扩展字段；正文等卡片字段请在角色编辑器修改');
      const before=st.characters[0]?.data?.extensions||{},next=data.extensions||{};
      for(const field of new Set([...Object.keys(before),...Object.keys(next)]))if(field!=='regex_scripts'&&JSON.stringify(before[field])!==JSON.stringify(next[field]))await extensionContext.writeExtensionField(0,field,Object.hasOwn(next,field)?next[field]:null);
      return {ok:true};
    }
    const worldInfoCache = new Map(), selected_world_info = win.getGlobalWorldbookNames();
    const charBooks = win.getCharWorldbookNames();
    for (const name of charBooks.additional || []) if (!selected_world_info.includes(name)) selected_world_info.push(name);
    if (ch && charBooks.primary) ch.data.extensions.world = charBooks.primary;
    async function loadWorldInfo(name) {
      if (!worldInfoCache.has(name)) worldInfoCache.set(name, await st.loadWorldInfo(name));
      return copy(worldInfoCache.get(name));
    }
    async function getWorldInfoPrompt(messages, maxContext) {
      const names = [...new Set([...selected_world_info,ch?.data.extensions.world,st.chatMetadata.world_info || win.getChatWorldbookName()].filter(Boolean))];
      const documents = [];
      for (const name of names) { await loadWorldInfo(name); documents.push(copy(worldInfoCache.get(name))); }
      return call('selectTavernFrontendWorldInfo',{input:{documents,messages,maxContext}});
    }
    const regex_placement = Object.freeze({MD_DISPLAY:0,USER_INPUT:1,AI_OUTPUT:2,SLASH_COMMAND:3,WORLD_INFO:5,REASONING:6});
    const t = (strings,...values) => Array.isArray(strings) ? strings.reduce((text,part,i)=>text+part+(i<values.length?values[i]:''),'') : String(strings);
    const shared = {
      characters, get chat_metadata(){return st.chatMetadata;}, get chat(){return st.chat.map(messageView);}, this_chid:st.characterId,
      saveSettingsDebounced:() => st.saveSettingsDebounced().catch(report),
      saveCharacterDebounced:() => saveCharacter().catch(report),
      saveMetadataDebounced:() => st.saveMetadataDebounced().catch(report),
      saveChatDebounced:() => st.saveChat().catch(report),
      substituteParams:value=>win.substitudeMacros(String(value)),
      sendTextareaMessage:async()=>{await win.__dshTavernComposerReady;doc.getElementById('send_but').click();},
      eventSource:st.eventSource,event_types:st.eventTypes,extension_settings,
      world_names:win.getWorldbookNames(),selected_world_info,METADATA_KEY:'world_info',worldInfoCache,loadWorldInfo,getWorldInfoPrompt,
      regex_placement,getRegexedString:(text,placement,options={})=>win.formatAsTavernRegexedString(text,({1:'user_input',2:'ai_output',3:'slash_command',5:'world_info',6:'reasoning'})[placement] || 'ai_output',options.isMarkdown?'display':'prompt',options),
      uuidv4:()=>win.crypto.randomUUID(),power_user:{...st.powerUserSettings,persona_description:context().personaDescription || ''},t,
      getPresetManager:()=>({readPresetExtensionField:({path})=>{if(path!=='regex_scripts')throw Error('此扩展接口仅支持当前预设正则');return regexes('preset');}})
    };
    // A visible copy of the authenticated composer uses the same controls and CAS.
    const chatRoot = doc.createElement('div');chatRoot.id='chat';doc.body.appendChild(chatRoot);
    const controls = doc.querySelector('[data-dsh-script-composer]');
    if (controls) { controls.id='send_form';controls.hidden=false;const area=doc.getElementById('send_textarea');area.placeholder='当前会话输入框';area.setAttribute('aria-label','当前会话输入框');const right=doc.createElement('div');right.id='rightSendForm';right.appendChild(doc.getElementById('send_but'));controls.appendChild(right);right.firstChild.textContent='发送到当前会话'; }
    const style=doc.createElement('style');style.textContent='#chat{padding:12px}#send_form{padding:12px;display:flex;gap:8px}#send_textarea{flex:1;min-height:70px;background:#171d21;color:inherit}#chat>.dsh-choice-context{white-space:pre-wrap;opacity:.75;margin-bottom:10px}';doc.head.appendChild(style);
    const last = doc.createElement('div');last.className='mes last_mes dsh-choice-context';chatRoot.appendChild(last);
    const updaters=[];
    sync = () => { for (const update of updaters) update();const message=st.chat.findLast(m=>!m.is_user&&!m.is_system);last.textContent=String(message?.mes || '').slice(-2000); };
    // Build only the enumerated export names supplied by the importer; no source
    // string is evaluated while constructing the compatibility modules.
    const registry = '__dshStModules_' + win.crypto.randomUUID().replaceAll('-','');
    win[registry] = {shared,updaters};
    const urls = new Map();
    const dispose=()=>{for(const url of urls.values())URL.revokeObjectURL(url);delete win[registry]};
    win.addEventListener('pagehide',dispose,{once:true});
    try {
      for (const [path,names] of Object.entries(input.modules)) {
        if (names.some(name=>!/^\w+$/.test(name) || !(name in shared))) throw Error('未知扩展模块接口');
        const source='const bridge=window['+JSON.stringify(registry)+'];\n'+names.map(name=>'export let '+name+'=bridge.shared.'+name+';').join('\n')+'\nbridge.updaters.push(()=>{'+names.map(name=>name+'=bridge.shared.'+name+';').join('')+'});';
        urls.set(path,URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
      }
      let url;
      if(graph){
        const prefix='https://dsh-extension.invalid/'+registry+'/',canonical=path=>prefix+'repository/'+path;
        const imports={};for(const [path,value]of urls)imports[prefix+'host/'+path]=value;
        win[registry].importModule=async(specifier,from)=>{
          const target=new URL(String(specifier),canonical(from)),path=target.href.startsWith(prefix+'repository/')?target.href.slice((prefix+'repository/').length):'';
          if(!Object.hasOwn(graph.files,path))throw Error('扩展动态模块未预加载：'+String(specifier)+'（来源 '+from+'，提交 '+input.commit+'）。请在脚本管理重新导入以重试；若仍失败，导出诊断。');
          return import(canonical(path));
        };
        for(const [path,row]of Object.entries(graph.files)){
          let source=row.source;
          for(const edit of row.edits.slice().reverse()){
            const value=edit.kind==='module'?JSON.stringify(canonical(edit.path)):edit.kind==='builtin'?JSON.stringify(prefix+'host/'+edit.path):edit.kind==='base'?JSON.stringify(new URL(path,input.base).href):edit.kind==='asset'?JSON.stringify(assetUrl(edit.path)):'window['+JSON.stringify(registry)+'].importModule('+edit.expression+','+JSON.stringify(path)+')';
            source=source.slice(0,edit.start)+value+source.slice(edit.end);
          }
          if(row.type!=='json')source+='\n//# sourceURL='+new URL(path,input.base).href;
          const objectUrl=URL.createObjectURL(new Blob([source],{type:row.type==='json'?'application/json':'text/javascript'}));urls.set('repository:'+path,objectUrl);imports[canonical(path)]=objectUrl;
        }
        const map=doc.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});doc.head.appendChild(map);url=canonical(graph.entry);
      }else{
        let source=input.source;for(const item of input.imports.slice().reverse()){if(!urls.has(item.path))throw Error('扩展模块未登记');source=source.slice(0,item.start)+JSON.stringify(urls.get(item.path))+source.slice(item.end)}
        url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));urls.set('entry',url);
      }
      const oldFetch=win.fetch.bind(win);
      win.fetch=async function(resource,init={}) {
        const url=new URL(typeof resource==='string'?resource:resource.url,doc.baseURI);
        if(url.origin===new URL(doc.baseURI).origin&&url.pathname==='/api/characters/edit'&&init.body instanceof win.FormData) {
          try { const result=await saveCharacter(JSON.parse(init.body.get('json_data')).data,init.body.get('avatar_url'));return new win.Response(JSON.stringify(result),{headers:{'content-type':'application/json'}}); }
          catch(error){return new win.Response(JSON.stringify({error:error.message}),{status:409});}
        }
        return oldFetch(resource,init);
      };
      // Upstream auto-imports the tagged translator as a global in Vue templates.
      win.t=t;
      sync();await import(url);
      await new Promise(resolve=>win.$(resolve));
      win.__dshOriginalExtensionState.ready=true;
    } catch(error) {dispose();win.__dshOriginalExtensionState.error=String(error.message||error);win.__dshOriginalExtensionState.phase='module-load';throw error;}
    // Keep module URLs alive for delayed import() and lazy UI code; the frame
    // owns them and releases them on pagehide, including normal script reloads.
  };
}
