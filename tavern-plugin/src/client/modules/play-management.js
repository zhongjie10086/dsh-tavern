function TavernPersonaManager(props){
            const askConfirm = useTavernConfirm([props.sessionId,props.scope?.sessionId,props.cardPath,props.path,props.card?.path,props.view?.card?.path,props.record?.source?.path,props.record?.source?.cardPath].join("\n"));
 const h=React.createElement,[state,setState]=React.useState(null),[draft,setDraft]=React.useState(null),[original,setOriginal]=React.useState(''),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false);
 const dirty=!!draft&&JSON.stringify(draft)!==original;React.useEffect(()=>{props.onDirty?.(dirty);return()=>props.onDirty?.(false)},[dirty]);
 function choose(p){if(dirty){setError('请先保存或放弃身份编辑');return}setDraft({...p});setOriginal(JSON.stringify(p));setError('')}
 async function reload(){const next=await props.api('getPlayManagement',{});setState(next);return next}
 React.useEffect(()=>{reload().catch(e=>setError(e.message))},[props.sessionId]);
 async function run(fn){setBusy(true);setError('');setNotice('');try{await fn();liveTavernView.invalidate(props.sessionId);notifyTavernDataChanged(['sessions'],'play-management')}catch(e){setError(e.message)}finally{setBusy(false)}}
 const button=(text,fn,disabled=false)=>h('button',{className:'dsh-tavern-btn',disabled:busy||disabled,onClick:()=>run(fn)},text);
 return h('section',{className:'dsh-plugin-panel','data-plugin':'personas'},h('h2',null,'玩家身份'),error?h('p',{role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,!state?h('p',null,'读取身份库…'):h(React.Fragment,null,
 h('p',null,'本局玩家：'+state.current.name+'。切换后，姓名和身份描述从下一轮生效；已有消息保留。'),
 h('div',{className:'dsh-migration-toolbar'},button('使用默认玩家',async()=>{setState(await props.api('applyPlayConfiguration',{operation:{kind:'persona-default'},expectedRevision:state.configRevision}));setNotice('已切换为默认玩家：你')},dirty),button('新建身份',()=>choose({id:'',name:'',title:'',description:''})),button('将当前玩家存为身份',()=>choose({id:'',name:state.current.name,title:'',description:state.current.description||''}))),
 h('div',{className:'dsh-extension-grid'},state.personas.map(p=>h('article',{key:p.id,className:'dsh-sp-card'},h('h3',null,p.name),h('p',null,p.title||''),h('p',null,p.id===state.current.id?'本局使用中':''),button('编辑 '+p.name,()=>choose(p)),button('切换为 '+p.name,async()=>{setState(await props.api('applyPlayConfiguration',{operation:{kind:'persona',id:p.id},expectedRevision:state.configRevision}));tavernPreferenceStorage('setItem','dsh-tavern-player-name',p.name);setNotice('本局身份已切换')},dirty),button('删除 '+p.name,async()=>{if(!(await askConfirm('从身份库删除 '+p.name+'？已经使用它的聊天会保留各自的身份。')))return;await props.api('editTavernPersona',{operation:{kind:'delete',id:p.id},expectedRevision:state.revision});await reload();if(draft?.id===p.id){setDraft(null);setOriginal('')}},dirty)))),
 draft?h('fieldset',{disabled:busy,className:'dsh-sp-card'},h('legend',null,draft.id?'编辑身份':'新建身份'),...['name','title','description'].map(key=>h('label',{key,className:'dsh-sp-field'},{name:'玩家姓名',title:'身份备注',description:'身份描述'}[key],h(key==='description'?'textarea':'input',{'aria-label':{name:'玩家姓名',title:'身份备注',description:'身份描述'}[key],rows:key==='description'?8:undefined,value:draft[key]||'',onChange:e=>setDraft({...draft,[key]:e.target.value})}))),button('保存身份',async()=>{const result=await props.api('editTavernPersona',{operation:{kind:'save',id:draft.id,persona:draft},expectedRevision:state.revision});setDraft(result.saved);setOriginal(JSON.stringify(result.saved));await reload();setNotice('身份已保存，可点击“切换为”应用到本局')},!draft.name?.trim()||!dirty),button('放弃身份编辑',()=>{setDraft(null);setOriginal('')})) : null));
}
async function confirmTavernPresetSwitch(api,askConfirm){
 const state=await api('getPlayManagement',{}),status=state.presetSwitch;
 if(status?.requiresConfirmation&&!(await askConfirm(status.reasons.join('；')+'。切换会重置这些本局设置，随后可撤销。继续切换？')))return null;
 return state;
}
async function undoTavernPresetSwitch(api,askConfirm,archive){
 const state=await confirmTavernPresetSwitch(api,askConfirm);if(!state)return null;
 if(state.presetSwitch?.undo?.archive!==archive)throw Error('可撤销的预设切换已变化，请刷新');
 return api('applyPlayConfiguration',{operation:{kind:'preset-undo',archive},expectedRevision:state.configRevision});
}
function TavernPresetManager(props){
 const askConfirm=useTavernConfirm(props.sessionId);
 const h=React.createElement,[state,setState]=React.useState(null),[catalog,setCatalog]=React.useState(null),[selected,setSelected]=React.useState(''),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false),[dirty,setDirty]=React.useState(false);
 React.useEffect(()=>{props.onDirty?.(dirty);return()=>props.onDirty?.(false)},[dirty]);
 const reloadRequest=React.useRef(0);
 async function reload(selectCurrent=true){const request=++reloadRequest.current;const [next,list]=await Promise.all([props.api('getPlayManagement',{}),props.api('listPresets',{})]);if(request!==reloadRequest.current)return;setState(next);setCatalog(list);if(selectCurrent)setSelected(next.presetPath)}
 React.useEffect(()=>{reload().catch(e=>setError(e.message));const changed=event=>{if(tavernDataChangeAffects(event,['presets'],'play-management'))reload(false).catch(e=>setError(e.message))};window.addEventListener('dsh-tavern-data-changed',changed);return()=>window.removeEventListener('dsh-tavern-data-changed',changed)},[props.sessionId]);
 async function apply(){setBusy(true);setError('');try{const current=await confirmTavernPresetSwitch(props.api,askConfirm);if(!current)return;await props.api('applyPlayConfiguration',{operation:{kind:'preset',path:selected},expectedRevision:current.configRevision});await reload();liveTavernView.invalidate(props.sessionId);notifyTavernDataChanged(['sessions','presets'],'play-management');setNotice('预设、正则和预设脚本已应用到本局，下一轮使用新设置。')}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function undo(){setBusy(true);setError('');try{if(!await undoTavernPresetSwitch(props.api,askConfirm,state.presetSwitch.undo.archive))return;await reload();liveTavernView.invalidate(props.sessionId);notifyTavernDataChanged(['sessions','presets'],'play-management');setNotice('已撤销最近一次预设切换，本局剧情保留。')}catch(e){setError(e.message)}finally{setBusy(false)}}
 return h('section',{className:'dsh-plugin-panel','data-plugin':props.regexOnly?'regex':'presets'},h('h2',null,props.regexOnly?'正则 · 预设规则':'预设管理'),h('p',null,props.regexOnly?'编辑所选预设随附的正则。保存后，跟随该预设的聊天会在下一次请求使用最新规则；固定版本的聊天保持原版本。':'默认跟随共享预设的更新。在这里切换本局使用的预设，已有剧情和数据库保留；有本局覆盖或固定设置时会先确认。切换后可以撤销，恢复之前的预设、开关和方案。'),error?h('p',{role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,
 catalog?h('div',{className:'dsh-migration-toolbar'},h('label',null,'本局预设',h('select',{'aria-label':'本局预设',value:selected,disabled:busy||dirty,onChange:e=>setSelected(e.target.value)},h('option',{value:''},'内置设置'),catalog.presets.filter(p=>p.valid&&p.recognized).map(p=>h('option',{key:p.path,value:p.path},p.title)))),h('button',{className:'dsh-tavern-btn',disabled:busy||dirty,onClick:apply},'应用到本局'),h('button',{className:'dsh-tavern-btn',disabled:busy||dirty,onClick:()=>reload(false).catch(e=>setError(e.message))},'刷新预设列表')):null,
 state?.presetSwitch?.undo?h('button',{className:'dsh-tavern-btn',disabled:busy||dirty,onClick:undo},'撤销最近一次预设切换'):null,
 h(presetLibraryFeature.Library,{scope:{sessionId:props.sessionId},onDirty:setDirty,onApplied:path=>{setSelected(path);return reload(false)},showCurrentPresetSelector:false,regexOnly:props.regexOnly,initialPath:props.regexOnly?selected:undefined}));
}
function TavernCharacterManager(props){
 const live=useLiveTavernView(props.sessionId);
 return React.createElement('section',{className:'dsh-plugin-panel','data-plugin':'characters'},React.createElement('h2',null,'角色卡管理'),React.createElement('p',null,'编辑人物卡库中的角色、开场白和世界书绑定。修改卡片后，可在酒馆状态中点击“应用新版人物卡”，更新本局背景并保留已有剧情和变量。'),React.createElement(cardLibraryFeature.Library,{visible:true,scope:{sessionId:props.sessionId},tab:{meta:{cardPath:live.view?.card?.path||''}},onDirty:props.onDirty}));
}

function TavernUserInputEditor(props){
 const h=React.createElement,[edit,setEdit]=React.useState(null),[text,setText]=React.useState(''),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),dialog=React.useRef(null);
 const live=useLiveTavernView(props.sessionId),coordination=useTavernCoordination(props.sessionId),activity=coordination.view?.activity;
 const running=typeof props.useSession==='function'?props.useSession(snapshot=>snapshot.running===true):props.running===true;
 const blocked=busy||running||activity?.busy===true||['pending','running','waiting-runtime'].includes(live.view?.settleStatus);
 React.useEffect(()=>{if(edit&&!dialog.current?.open)dialog.current?.showModal()},[edit]);
 async function start(){if(blocked)return;setError('');setBusy(true);try{const r=await rpc('getInputEdit',{turn:props.turn},props.sessionId);setEdit(r.edit);setText(r.edit.text)}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function save(){if(blocked)return;setBusy(true);setError('');try{await rpc('saveInputEdit',{turn:props.turn,token:edit.token,text},props.sessionId);liveTavernView.invalidate(props.sessionId);dialog.current.close();setEdit(null)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return h(React.Fragment,null,h('button',{type:'button',className:'dsh-tavern-user-copy',disabled:blocked,'aria-label':'编辑玩家输入',role:props.inMenu?'menuitem':undefined,onClick:e=>{e.stopPropagation();start()}},'编辑'),error&&!edit?h('span',{role:'alert'},error):null,edit?h('dialog',{ref:dialog,className:'dsh-input-edit-dialog','aria-label':'编辑玩家输入',onCancel:e=>{if(busy)e.preventDefault();else setEdit(null)}},h('h3',null,'编辑玩家输入'),h('textarea',{'aria-label':'玩家输入内容',value:text,onChange:e=>setText(e.target.value),rows:9}),h('p',null,'保存后更新对话历史。后续已有回复保留；需要重新演绎时可从此处分叉。'),error?h('p',{role:'alert'},error):null,h('button',{className:'dsh-tavern-btn',disabled:blocked,onClick:save},'保存输入'),h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>{dialog.current.close();setEdit(null)}},'取消')):null);
}

function TavernLatestInputEditor(props){const live=useLiveTavernView(props.sessionId),turn=Math.max(0,...(live.view?.userProjections||[]).map(p=>Number(p.turn)||0));return turn?React.createElement(TavernUserInputEditor,{sessionId:props.sessionId,turn,inMenu:true,useSession:props.useSession}):null;}
