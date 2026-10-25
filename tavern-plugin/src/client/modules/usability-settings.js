function R47SystemPromptSets(props) {
  const h=React.createElement,[state,setState]=React.useState(null),[name,setName]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  async function load(){try{const r=await rpc('getTavernSettings');setState(r.settings.systemPromptSets);setError('');}catch(e){setError(e.message);}}
  React.useEffect(()=>{void load();},[]);
  async function act(action){if(action==='delete'&&props.hasDrafts){setError('请先保存当前提示词草稿，再删除方案。');return;}setBusy(true);setError('');try{const r=await rpc('updateTavernSettings',{patch:{systemPromptSet:{action,id:state.selected,newId:'set-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),name}}});setState(r.settings.systemPromptSets);setName('');if(action==='delete'&&props.onChanged)props.onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function select(id){if(props.hasDrafts){setError('请先保存当前提示词草稿，再切换方案。');return;}setBusy(true);try{const r=await rpc('updateTavernSettings',{patch:{systemPromptSet:{action:'select',id}}});setState(r.settings.systemPromptSets);setError('');if(props.onChanged)props.onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  return h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'系统提示词方案'),h('p',null,'全局选择从下一次请求生效。切换前请保存正文编辑区的草稿。'),error?h('p',{role:'alert'},error):null,state?h(React.Fragment,null,
    h('label',{className:'dsh-tavern-usability-field'},'当前方案',h('select',{'aria-label':'当前系统提示词方案',value:state.selected,disabled:busy,onChange:e=>void select(e.target.value)},state.sets.map(item=>h('option',{key:item.id,value:item.id},item.name)))),
    h('label',{className:'dsh-tavern-usability-field'},'方案名称',h('input',{'aria-label':'系统提示词方案名称',value:name,disabled:busy,onChange:e=>setName(e.target.value)})),
    h('div',{className:'dsh-tavern-usability-actions'},['create','copy','rename','delete'].map((action,index)=>h('button',{key:action,className:'dsh-tavern-btn',disabled:busy||(action==='delete'?state.sets.length<2:!name.trim()),onClick:()=>void act(action)},['新建默认方案','复制当前方案','重命名','删除当前方案'][index])))) : h('button',{className:'dsh-tavern-btn',onClick:()=>void load()},'重新读取方案'));
}

function R47MvuEditor(props) {
  const h=React.createElement,[snapshot,setSnapshot]=React.useState(null),[text,setText]=React.useState(''),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false);
  async function load(){setBusy(true);try{const r=await rpc('getCurrentMvuEdit',{sessionId:props.sessionId});setSnapshot(r);setText(JSON.stringify(r.variables.stat_data,null,2));setError('');setNotice('');}catch(e){setError('读取失败：'+e.message);}finally{setBusy(false);}}
  React.useEffect(()=>{setSnapshot(null);setText('');void load();},[props.sessionId]);
  async function save(){setBusy(true);setError('');try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('stat_data 必须是 JSON 对象');const r=await rpc('saveCurrentMvuEdit',{sessionId:props.sessionId,option:snapshot.option,variables:{...snapshot.variables,stat_data:value},expectedVariables:snapshot.variables,expectedLifecycleRevision:snapshot.lifecycleRevision});if(r.stale||r.updated!==true)throw Error('聊天已变化，请重新读取');setSnapshot({...snapshot,variables:r.variables||{...snapshot.variables,stat_data:value}});setNotice('已保存；下一次正文请求会携带一次变化说明。');}catch(e){setError('保存失败：'+e.message);}finally{setBusy(false);}}
  function field(key,value){if(value!==null&&typeof value==='object')return h('div',{key,className:'dsh-tavern-usability-field'},h('b',null,key),h('pre',null,JSON.stringify(value,null,2)),h('small',null,'在下方 JSON 编辑器中修改此对象'));return h('label',{key,className:'dsh-tavern-usability-field'},key,h('input',{'aria-label':'MVU '+key,key:JSON.stringify(value),defaultValue:typeof value==='string'?value:JSON.stringify(value),disabled:busy,onBlur:e=>{try{const data=JSON.parse(text);data[key]=typeof value==='string'?e.target.value:JSON.parse(e.target.value);setText(JSON.stringify(data,null,2));setError('');}catch{setError('该字段需要有效 JSON；输入保留，可继续修改或使用下方 JSON 编辑器。');}}}));}
  let data;try{data=JSON.parse(text);}catch{}
  return h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'当前 MVU 状态'),h('p',null,'仅修改当前最新楼层的 stat_data，保留 schema、全局初始值与 SP 数据。'),error?h('p',{role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,
    snapshot?h(React.Fragment,null,data&&typeof data==='object'?Object.entries(data).map(([key,value])=>field(key,value)):null,h('textarea',{'aria-label':'当前 MVU stat_data JSON',value:text,disabled:busy,onChange:e=>{setText(e.target.value);setError('');},rows:16}),h('button',{className:'dsh-tavern-btn',disabled:busy||error.startsWith('该字段'),onClick:()=>void save()},'保存 MVU')):null,h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>void load()},snapshot?'放弃草稿并重新读取':'重新读取'));
}

function applyR47ReadingPreferences(document, preferences) {
  const style=document.body.style;
  style.setProperty('--dsh-content-font-size',preferences.fontSize+'px');
  style.setProperty('--dsh-content-line-height',String(preferences.lineHeight));
  style.setProperty('--dsh-content-letter-spacing',preferences.letterSpacing+'px');
  document.body.setAttribute('data-dsh-tavern-reading-spacing','');
  document.defaultView.dispatchEvent(new document.defaultView.CustomEvent('dsh-tavern-font-size-changed'));
}
function readR47ReadingPreferences(document) {
  const raw=document.defaultView.localStorage.getItem('dsh-tavern-reading-preferences'),saved=raw?JSON.parse(raw):{},size=parseFloat(document.defaultView.getComputedStyle(document.body).getPropertyValue('--dsh-content-font-size'));
  return {fontSize:Number.isFinite(size)&&size>=8&&size<=48?size:(saved.fontSize??16),lineHeight:saved.lineHeight??1.75,letterSpacing:saved.letterSpacing??0};
}

function R47ReadingSettings() {
  const h=React.createElement,[value,setValue]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState('');
  async function load(){try{const r=await rpc('getTavernSettings');setValue({readingPreferences:readR47ReadingPreferences(document),headerShortcuts:r.settings.headerShortcuts});setError('');}catch(e){setError(e.message);}}
  React.useEffect(()=>{void load();},[]);
  async function save(){setBusy(true);try{for(const [key,min,max] of [['fontSize',8,48],['lineHeight',1,3],['letterSpacing',-1,8]]){const number=value.readingPreferences[key];if(!Number.isFinite(number)||number<min||number>max)throw Error('阅读设置超出范围：'+key);}const r=await rpc('updateTavernSettings',{patch:{headerShortcuts:value.headerShortcuts}});localStorage.setItem('dsh-tavern-reading-preferences',JSON.stringify(value.readingPreferences));setValue({...value,headerShortcuts:r.settings.headerShortcuts});applyR47ReadingPreferences(document,value.readingPreferences);window.dispatchEvent(new CustomEvent('dsh-tavern-settings-changed'));setError('');setNotice('已保存；阅读设置仅作用于当前浏览器。');}catch(e){setError(e.message);}finally{setBusy(false);}}
  return h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'阅读与顶栏快捷入口'),error?h('p',{role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,value?h(React.Fragment,null,
    h('div',{className:'dsh-tavern-usability-number-fields'},[['fontSize','字号',8,48,.5],['lineHeight','行距',1,3,.05],['letterSpacing','字距',-1,8,.1]].map(([key,label,min,max,step])=>h('label',{key,className:'dsh-tavern-usability-field'},label,h('input',{type:'number','aria-label':label,min,max,step,value:value.readingPreferences[key],disabled:busy,onChange:e=>setValue({...value,readingPreferences:{...value.readingPreferences,[key]:Number(e.target.value)}})})))),
    h('div',{className:'dsh-tavern-usability-checks'},[['settings','设置（必留）'],['presets','预设'],['worldbooks','世界书'],['variables','MVU'],['memory','剧情记忆'],['scripts','脚本'],['images','图片']].map(([key,label])=>h('label',{key,className:'dsh-tavern-usability-check'},h('input',{type:'checkbox',checked:value.headerShortcuts.includes(key),disabled:busy||key==='settings',onChange:e=>setValue({...value,headerShortcuts:e.target.checked?[...value.headerShortcuts,key]:value.headerShortcuts.filter(item=>item!==key)})}),label))),
    h('div',{className:'dsh-tavern-usability-actions'},h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>setValue({readingPreferences:{fontSize:16,lineHeight:1.75,letterSpacing:0},headerShortcuts:['settings','presets','worldbooks','variables']})},'恢复默认（保存后生效）'),h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>void save()},'保存'))):h('button',{className:'dsh-tavern-btn',onClick:()=>void load()},'重新读取'));
}
function R47UsabilityTab(props) {
  const h=React.createElement,sessionId=props.scope?.sessionId||props.sessionId,mode=useTavernSessionMode(sessionId);
  const unavailable=h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'当前 MVU 状态'),h('p',null,mode==='card'?'人物卡工作台不使用当前剧情 MVU。进入游玩对话后可在此编辑状态。':!sessionId?'打开游戏后可编辑当前 MVU。':'正在读取当前会话类型…'));
  return h('div',{className:'dsh-tavern-usability'},h(R47ReadingSettings),h(R47SettingsBundle),sessionId&&(mode==='story'||mode==='script')?h(R47MvuEditor,{key:sessionId,sessionId}):unavailable);
}
function R47MemorySettingsTab() {
  const h=React.createElement;
  return h('div',{className:'dsh-tavern-usability'},h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'剧情记忆与压缩'),h('p',null,'在这里调整已有的剧情压缩策略。分卷摘要可在对话中的“剧情摘要”条目中展开查看。'),h(ContextCompactionSettings)));
}
function R47ImageSettingsTab() {
  const h=React.createElement;
  return h('div',{className:'dsh-tavern-usability'},h('section',{className:'dsh-tavern-usability-card'},h('h3',null,'场景配图设置'),h('p',null,'使用已有的场景配图配置。启用后，可在游戏输入区通过“生图”按钮手动配图。'),h(SceneImageSettings)));
}
function R47HeaderShortcuts(props) {
  const h=React.createElement,[entries,setEntries]=React.useState(['settings']),[error,setError]=React.useState('');
  React.useEffect(()=>{let active=true;try{const raw=localStorage.getItem('dsh-tavern-reading-preferences');if(raw)applyR47ReadingPreferences(document,JSON.parse(raw));}catch(e){setError('读取阅读设置失败：'+e.message);}const load=()=>rpc('getTavernSettings').then(r=>{if(active)setEntries(r.settings.headerShortcuts);},e=>{if(active)setError(e.message);});void load();window.addEventListener('dsh-tavern-settings-changed',load);return()=>{active=false;window.removeEventListener('dsh-tavern-settings-changed',load);};},[]);
  const labels={settings:'设置',presets:'预设',worldbooks:'世界书',variables:'MVU',memory:'剧情记忆',scripts:'脚本',images:'图片'},targets={settings:'usability',presets:'presets',worldbooks:'worldbooks',variables:'usability',memory:'memory',scripts:'resources',images:'images'};
  return h('nav',{'aria-label':'酒馆快捷入口'},entries.map(key=>h('button',{key,className:'dsh-tavern-btn',onClick:()=>props.open('dsh-tavern:'+targets[key]),title:labels[key]},labels[key])),error?h('span',{role:'alert'},error):null);
}
