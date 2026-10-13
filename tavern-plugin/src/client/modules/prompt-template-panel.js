async function tavernPromptTemplatePanelBootstrap(config) {
  const pending=new Map();let serial=0,plugin,worldInfo,bookName='',dirty=false;
  config.installMirror({window,token:config.token,post:data=>parent.postMessage({...data,token:config.token},config.origin),editors:()=>plugin?.getEditors?.()||[]});
  const status=document.getElementById('template-status'), editor=document.getElementById('world_entry_content_dsh');
  function notice(message,error=false){status.textContent=String(message);status.setAttribute('role',error?'alert':'status');}
  function markDirty(value){dirty=value;parent.postMessage({type:'dsh-template-ui-dirty',token:config.token,value},config.origin);}
  function rpc(method,args={}){const id=String(++serial);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('模板界面请求超时'));},35000);pending.set(id,{resolve,reject,timer});parent.postMessage({type:'dsh-template-ui-call',token:config.token,id,method,args:{...args,sessionId:config.sessionId}},config.origin);});}
  addEventListener('message',event=>{const data=event.data;if(event.source!==parent||event.origin!==config.origin||data?.token!==config.token||data.type!=='dsh-template-ui-result')return;const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);data.ok?task.resolve(data.value):task.reject(new Error(data.error));});
  try {
    const prefix=config.origin+'/api/dsh-tavern/vendor/st-prompt-template/';
    const {connectTemplateSession,createTemplateBrowserServices}=await import(prefix+'index.js');
    const editorWorkers=new Set(),getWorker=(_id,label)=>{const worker=config.createWorker(window,config.token,label,config.origin);editorWorkers.add(worker);return worker;};
    let monacoEnvironment={getWorker};Object.defineProperty(window,'MonacoEnvironment',{configurable:true,get:()=>monacoEnvironment,set:value=>{monacoEnvironment={...value,getWorker};}});
    addEventListener('pagehide',()=>{for(const worker of editorWorkers)worker.terminate();},{once:true});
    const YAML=await import(config.origin+'/api/dsh-tavern/vendor/runtime-assets/yaml/index.mjs');
    window.toastr=Object.fromEntries(['info','success','warning','error'].map(level=>[level,message=>notice(message,level==='error')]));
    const services=createTemplateBrowserServices({context:()=>plugin.context,command:(...args)=>plugin.commandFromTemplate(...args),reportError:message=>notice(message,true)});
    services.callGenericPopup=async(html,_type,_input,options={})=>{
      const dialog=document.createElement('dialog');dialog.className='template-editor-dialog';dialog.innerHTML=html;
      const done=document.createElement('button');done.textContent=options.okButton||'保存并返回';done.className='template-editor-save';dialog.append(done);document.body.append(dialog);
      return await new Promise((resolve,reject)=>{let closed=false;async function finish(){if(closed)return;closed=true;try{await options.onClose?.();dialog.close();dialog.remove();markDirty(true);resolve(1);}catch(error){reject(error);}}
        done.onclick=finish;dialog.addEventListener('cancel',event=>{event.preventDefault();void finish();});dialog.showModal();Promise.resolve(options.onOpen?.()).catch(reject);
      });
    };
    const guardedRpc=async(method,args)=>{const value=await rpc(method,args);if(method==='saveFullPromptTemplateSettings')notice('模板设置已保存');return value;};
    plugin=await connectTemplateSession({sessionId:config.sessionId,rpc:guardedRpc,services,settingsHtml:await fetch(prefix+'settings.html').then(r=>r.text()),libraries:{yaml:YAML}});
    window.SillyTavern={getContext:()=>plugin.context};
    const labels={pt_enabled:'启用模板',pt_generate_enabled:'处理生成提示词',pt_generate_loader_enabled:'启用 [GENERATE] 世界书',pt_render_enabled:'处理聊天显示',pt_render_loader_enabled:'启用 [RENDER] 世界书',pt_with_context_disabled:'禁用 with 上下文',pt_debug_enabled:'调试模式',pt_autosave_enabled:'自动保存变量',pt_preload_worldinfo:'预加载世界书',pt_code_blocks:'处理代码块',pt_permanent_evaluation:'将计算结果保存到消息正文',pt_filter_chat_message:'过滤未执行的模板代码',pt_cache_enabled:'模板缓存',pt_cache_size:'缓存条数',pt_cache_hasher:'缓存校验算法',pt_inject_loader_enabled:'启用 @INJECT',pt_invert_enabled:'启用反转表达式',pt_chat_depth:'消息处理深度',pt_compile_workers:'使用 Worker 编译',pt_sandbox:'模板沙箱',pt_code_editor:'启用代码编辑器',pt_worldinfo_preload_only:'仅处理预加载世界书'};
    for(const [id,label] of Object.entries(labels)){const input=document.getElementById(id),span=input?.closest('label')?.querySelector('span');if(span)span.textContent=label;}
    document.querySelector('#prompt_template_settings .inline-drawer-header b span').textContent='ST-Prompt-Template 1.17.9';
    async function loadBook(requestedName){const names=plugin.context.world_names||[],books=document.getElementById('template-world-book');
      const old=requestedName||bookName||plugin.context.characters?.[plugin.context.this_chid]?.data?.extensions?.world;
      books.replaceChildren();for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;books.append(option);}
      bookName=names.includes(old)?old:names[0]||'';books.value=bookName;const select=document.getElementById('template-world-entry');select.replaceChildren();if(!bookName){notice('模板已载入。当前人物卡没有绑定世界书。');return;}
      worldInfo=(await rpc('loadFullPromptTemplateWorldInfo',{name:bookName})).worldInfo;
      for(const [key,entry] of Object.entries(worldInfo.entries||{})){const option=document.createElement('option');option.value=key;option.textContent=entry.comment||entry.key?.join('、')||('条目 '+key);select.append(option);}
      editor.value=worldInfo.entries?.[select.value]?.content||'';markDirty(false);
    }
    function action(id,work){document.getElementById(id).onclick=async()=>{try{await work();}catch(error){notice(error.message,true);}};}
    async function engineLabel(){const status=await rpc('getTemplateEngineStatus');document.getElementById('template-engine-current').textContent='当前：'+({disabled:'已关闭',lightweight:'轻量模板',full:'完整模板'}[status.engine])+' · '+status.reason;const details=document.getElementById('template-engine-reasons');details.replaceChildren();for(const item of [...(status.triggers||[]),...(status.warnings||[]).map(row=>({resource:'资源读取提醒',entry:row.message}))]){const row=document.createElement('li');row.textContent=item.resource+'：'+item.entry;details.append(row)}}
    let recovery=null;
    async function loadRecovery(){recovery=await rpc('getFullPromptTemplateRecovery');const panel=document.getElementById('template-recovery');panel.hidden=!recovery.pending;const rows=document.getElementById('template-recovery-values');rows.replaceChildren();if(!recovery.effect)return;
      document.getElementById('template-recovery-summary').textContent='有 '+recovery.pending+' 项已确认回复附带的保存操作等待处理。当前项：'+recovery.effect.label+'。正文和聊天变量已保存。';
      const value=(object,key)=>Object.prototype.hasOwnProperty.call(object,key)?JSON.stringify(object[key],null,2):'（不存在）';
      for(const key of recovery.effect.keys){const section=document.createElement('details'),title=document.createElement('summary');title.textContent=key+(recovery.effect.conflicts.includes(key)?' · 冲突':'');section.append(title);for(const [field,label]of [['base','原值'],['current','当前值'],['desired','待保存值']]){const heading=document.createElement('strong'),pre=document.createElement('pre');heading.textContent=label;pre.textContent=value(recovery.effect[field],key);section.append(heading,pre);}rows.append(section);}}
    for(const [id,actionName]of [['template-recovery-retry','retry'],['template-recovery-keep','keep-current'],['template-recovery-apply','apply-pending']])action(id,async()=>{if(!recovery?.effect)return;await rpc('resolveFullPromptTemplateRecovery',{revision:recovery.revision,action:actionName});await loadRecovery();await plugin.refresh();notice(recovery.pending?'已处理当前项，请继续检查下一项。':'待保存操作已处理完成。');});
    action('template-recovery-refresh',loadRecovery);
    for(const [id,mode]of [['template-enable-full','full'],['template-enable-auto','auto'],['template-enable-light','lightweight']])action(id,async()=>{await rpc('setTemplateEngineMode',{mode});await engineLabel();notice('本局模板模式已保存。自动模式在需要时启用完整引擎；显式轻量/完整优先。模板总开关仍由下方设置控制。');});
    action('template-open-editor',async()=>{plugin.api.setFeatures({code_editor:true});await plugin.openEditor('world_entry_content_dsh');});
    action('template-save-world',async()=>{if(!worldInfo)throw new Error('当前没有世界书条目');const next=structuredClone(worldInfo),key=document.getElementById('template-world-entry').value;next.entries[key].content=editor.value;const result=await rpc('saveFullPromptTemplateWorldInfo',{name:bookName,worldInfo:next,expectedWorldInfo:worldInfo});worldInfo=result.worldInfo;markDirty(false);await plugin.refresh();notice('世界书模板已保存。');});
    action('template-reload-world',async()=>{await plugin.refresh();await loadBook();notice('已恢复已保存内容。');});
    action('template-evaluate',async()=>{const result=await rpc('runFullPromptTemplate',{operation:{kind:'evaluate',code:editor.value}});document.getElementById('template-result').textContent=result.text;await engineLabel();notice('执行完成，变量变更已保存。');});
    document.getElementById('template-world-entry').onchange=event=>{if(dirty){notice('请先保存或恢复当前编辑。',true);event.target.value=editor.dataset.entry||'';return;}editor.dataset.entry=event.target.value;editor.value=worldInfo?.entries?.[event.target.value]?.content||'';};
    document.getElementById('template-world-book').onchange=async event=>{if(dirty){event.target.value=bookName;notice('请先保存或恢复当前编辑。',true);return;}try{await loadBook(event.target.value);editor.dataset.entry=document.getElementById('template-world-entry').value;}catch(error){notice(error.message,true);}};
    editor.addEventListener('input',()=>markDirty(true));
    await loadBook();await loadRecovery();editor.dataset.entry=document.getElementById('template-world-entry').value;await engineLabel();
    document.documentElement.dataset.templateReady='true';notice('模板设置已载入，修改开关后自动保存。');
  } catch(error){notice(error.message,true);}
}
function buildTavernPromptTemplatePanelDocument(config) {
  const origin=config.origin,root=origin+'/api/dsh-tavern/vendor/runtime-assets/';
  const css='body{margin:0;padding:18px;background:#191d29;color:#e8ebf6;font:14px system-ui}button,select,textarea,input{font:inherit}button,select,textarea,input[type=number]{color:inherit;background:#2b3346;border:1px solid #65738d;border-radius:6px;padding:7px}button{cursor:pointer}button:hover{background:#3b4862}label{display:flex;align-items:center;gap:10px;margin:9px 0}input[type=checkbox]{accent-color:#a3b8ef}hr{border:0;border-top:1px solid #424b61;margin:16px 0}.template-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}textarea{box-sizing:border-box;width:100%;min-height:230px;font:14px monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}.inline-drawer-content{display:block!important}.template-editor-dialog{padding:14px;width:92vw;height:88vh;max-width:none;max-height:none;color:#edf0fa;background:#1c2030;border:1px solid #78829c}.template-editor-dialog[open]{display:flex;flex-direction:column;gap:8px}.template-editor-dialog>#editor-wrapper{flex:1;min-height:0!important;height:calc(100% - 45px)!important}.template-editor-save{align-self:flex-end;flex-shrink:0;position:relative;z-index:9999}.template-editor-dialog::backdrop{background:#0009}.flex-container{display:flex}.flex1{flex:1}';
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>'+css+'</style><script src="'+root+'jquery/jquery.min.js"></script><script src="'+root+'lodash/lodash.min.js"></script><link rel="stylesheet" href="'+root+'fontawesome/css/all.min.css"><body><h2>完整提示词模板</h2><div class="template-toolbar"><strong id="template-engine-current"></strong><button id="template-enable-auto">本局：自动</button><button id="template-enable-light">本局：轻量</button><button id="template-enable-full">本局：完整</button></div><ul id="template-engine-reasons" aria-label="模板启用原因"></ul><p id="template-status" role="status">正在载入原版模板界面…</p><section id="template-recovery" hidden><h3>待保存操作恢复</h3><p id="template-recovery-summary"></p><div id="template-recovery-values"></div><p>保留当前值会跳过本项；采用待保存值只替换本项列出的字段。</p><div class="template-toolbar"><button id="template-recovery-refresh">刷新对照</button><button id="template-recovery-retry">重试保存</button><button id="template-recovery-keep">保留当前值</button><button id="template-recovery-apply">采用待保存值</button></div></section><div id="extensions_settings"></div><hr><h3>世界书模板编辑</h3><select id="template-world-book" aria-label="模板世界书"></select> <select id="template-world-entry" aria-label="模板世界书条目"></select><div class="template-toolbar"><button id="template-open-editor">打开原版代码编辑器</button><button id="template-save-world">保存世界书条目</button><button id="template-reload-world">恢复已保存内容</button></div><textarea id="world_entry_content_dsh" aria-label="模板代码"></textarea><div class="template-toolbar"><button id="template-evaluate">执行模板并保存变量</button></div><pre id="template-result"></pre><div id="chat" hidden></div>';
  return html+'<script>('+tavernPromptTemplatePanelBootstrap.toString()+')('+('Object.assign('+JSON.stringify(config).replace(/</g,'\\u003c')+',{createWorker:'+createTavernTemplateWorker.toString()+',installMirror:'+installTavernMirrorSource.toString()+'})')+').catch(console.error);<\/script></body></html>';
}
function TavernPromptTemplatePanel(props) {
  const host=React.useRef(null),api=React.useRef(props.api),dirty=React.useRef(props.onDirty);api.current=props.api;dirty.current=props.onDirty;
  React.useEffect(function(){const frame=document.createElement('iframe'),token=crypto.randomUUID();let closed=false;
    frame.title='ST-Prompt-Template 原版设置';frame.setAttribute('sandbox','allow-scripts allow-downloads');frame.style.cssText='width:100%;min-height:720px;border:0;display:block';
    const allowed=new Set(['getTemplateEngineStatus','setTemplateEngineMode','getFullPromptTemplateState','saveFullPromptTemplateState','saveFullPromptTemplateGlobals','saveFullPromptTemplateSettings','loadFullPromptTemplateWorldInfo','saveFullPromptTemplateWorldInfo','runFullPromptTemplate','getFullPromptTemplateRecovery','resolveFullPromptTemplateRecovery']);
    async function receive(event){const data=event.data;if(closed||event.source!==frame.contentWindow||data?.token!==token)return;if(data.type==='dsh-template-ui-dirty'){dirty.current?.(data.value===true);return;}if(data.type!=='dsh-template-ui-call'||!allowed.has(data.method))return;
      let result;try{result={ok:true,value:await api.current(data.method,{...data.args,sessionId:props.sessionId})};}catch(error){result={ok:false,error:error.message};}
      if(!closed)frame.contentWindow?.postMessage({type:'dsh-template-ui-result',token,id:data.id,...result},'*');
    }
    const workers=createTavernTemplateWorkerService(window,frame,token);
    const mirror=createTavernWindowMirror(window,frame,token,'提示词模板');frame.__dshTavernMirror=mirror;
    addEventListener('message',receive);host.current.append(frame);frame.srcdoc=buildTavernPromptTemplatePanelDocument({token,sessionId:props.sessionId,origin:location.origin});
    return function(){closed=true;workers.dispose();mirror.dispose();removeEventListener('message',receive);frame.remove();dirty.current?.(false);};
  },[props.sessionId]);
  return React.createElement('div',{ref:host,className:'dsh-prompt-template-panel'});
}
