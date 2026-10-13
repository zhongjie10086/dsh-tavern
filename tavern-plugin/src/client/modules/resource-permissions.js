function TavernResourcePermissions(props) {
 const h=React.createElement,[catalog,setCatalog]=React.useState(null),[selected,setSelected]=React.useState([]),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
 const labels={'same-origin':'操作宿主页','cross-card':'跨卡读取','shared-settings':'共享设置读写','shared-resources':'共享资源读写',network:'网络（含 HTTP 和本机/内网）'};
 const [caps,setCaps]=React.useState(Object.keys(labels));
 React.useEffect(()=>{let active=true;props.api('getTavernCardPermissions',{currentOnly:true}).then(value=>{if(!active)return;setCatalog(value);const restricted=new Set((value.restrictions?.rows||[]).map(row=>row.scriptId));setSelected(value.resources.filter(row=>row.kind==='script'&&restricted.has(row.scriptId)||row.kind==='card'&&['__dsh_message__','__dsh_official_mvu__'].some(id=>restricted.has(id))).map(row=>row.key));},e=>{if(active)setError(e.message)});return()=>{active=false}},[props.sessionId]);
 async function change(revoke) {
  setError('');setNotice('');setBusy(true);
  try{await props.api('changeTavernResourcePermissions',{targets:selected,capabilities:revoke?[]:caps});setCatalog(await props.api('getTavernCardPermissions',{currentOnly:true}));liveTavernView.invalidate(props.sessionId);setNotice(revoke?'所选资源的授信已撤销。':'所选资源已永久授信，新局、刷新、重启及同来源更新继续有效。');}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return h('section',{'aria-label':'本局资源授信',className:'dsh-script-permissions'},h('h2',null,'本局资源授信'),h('p',null,tavernResourceTrustExplanation),
  error?h('p',{role:'alert'},error):null,notice?h('p',{role:'status'},notice):null,
  !catalog?h('p',null,'正在读取本局资源…'):h('fieldset',{disabled:busy},h('legend',null,(catalog.restrictions?.count||0)+' 项能力受限'),
   h('p',null,'下面只列本局使用的资源。重复请求按资源和能力合并计数；此处记录保留到服务重启。'),
   h('button',{type:'button',onClick:()=>setSelected(catalog.resources.map(row=>row.key))},'选择本局全部资源'),h('button',{type:'button',onClick:()=>setSelected([])},'清空选择'),
   catalog.resources.map(row=>h('div',{key:row.key},h('label',null,h('input',{type:'checkbox',checked:selected.includes(row.key),onChange:e=>setSelected(values=>e.target.checked?[...values,row.key]:values.filter(key=>key!==row.key))}),({card:'人物卡',preset:'预设',script:'脚本'}[row.kind])+' · '+row.name+' · '+(row.capabilities.length?'已授信：'+row.capabilities.map(id=>labels[id]||id).join('、'):'未授信')),
    (catalog.restrictions?.rows||[]).filter(failure=>failure.scriptId===row.scriptId||row.kind==='card'&&['__dsh_message__','__dsh_official_mvu__'].includes(failure.scriptId)).map(failure=>h('p',{key:failure.scriptId+':'+failure.capability},(labels[failure.capability]||failure.capability)+'受限 · '+failure.attempts+' 次')))),
   h('details',null,h('summary',null,'分项设置'),Object.entries(labels).map(([id,label])=>h('label',{key:id,style:{display:'block'}},h('input',{type:'checkbox',checked:caps.includes(id),onChange:e=>setCaps(values=>e.target.checked?[...values,id]:values.filter(key=>key!==id))}),label))),
   h('button',{type:'button',className:'dsh-tavern-btn',disabled:!selected.length||!caps.length,onClick:()=>change(false)},'永久授信所选资源'),h('button',{type:'button',className:'dsh-tavern-btn',disabled:!selected.length,onClick:()=>change(true)},'撤销所选资源授信')));
}
