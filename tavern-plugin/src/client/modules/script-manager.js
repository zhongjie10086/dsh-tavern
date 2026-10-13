function describeTavernScriptChanges(before, after, pendingId = '') {
  function collect(trees) {
    const rows = new Map(), siblings = new Map();
    function visit(items, parent = '') { siblings.set(parent, (items || []).map(item => item.id)); for (const item of items || []) { rows.set(item.id, {item, parent}); if (item.type === 'folder') visit(item.scripts, item.id); } }
    visit(trees); return {rows, siblings};
  }
  const old = collect(before), next = collect(after), changed = [];
  const fields = item => Object.fromEntries(Object.keys(item).filter(key => key !== 'scripts').sort().map(key => [key, item[key]]));
  for (const [id, row] of next.rows) {
    const prior = old.rows.get(id); let kind = '';
    if (!prior) kind = '新增';
    else if (JSON.stringify(fields(prior.item)) !== JSON.stringify(fields(row.item)) || id === pendingId) kind = '修改';
    else {
      const common = key => (old.siblings.get(key) || []).filter(uid => next.rows.get(uid)?.parent === key);
      const order = (next.siblings.get(row.parent) || []).filter(uid => old.rows.get(uid)?.parent === row.parent);
      if (row.parent !== prior.parent || common(row.parent).indexOf(id) !== order.indexOf(id)) kind = '顺序或分组调整';
    }
    if (kind) changed.push({id, name:row.item.name, kind});
  }
  for (const [id, row] of old.rows) if (!next.rows.has(id)) changed.push({id, name:row.item.name, kind:'删除'});
  return changed;
}
function tavernScriptJsonChanged(text, value) { try { return JSON.stringify(JSON.parse(text)) !== JSON.stringify(value); } catch { return true; } }
// A fresh read can acknowledge an already-completed follow, but never grant a
// new lifecycle token to a write or silently accept another window's library.
async function applyTavernScriptLibrarySelection(api, sessionId, expected, isCurrent) {
  if (!isCurrent()) return null;
  const validRevision = value => Number.isSafeInteger(value) && value >= 0;
  if (!expected || !validRevision(expected.revision) || !validRevision(expected.lifecycleRevision)) throw Error('脚本版本信息无效，请刷新');
  const latest = await api('getTavernScriptLibrary', {sessionId, includeApplyStatus:true});
  if (!isCurrent()) return null;
  if (!latest || !validRevision(latest.revision) || !validRevision(latest.lifecycleRevision)) throw Error('脚本版本信息无效，请刷新');
  if (latest.revision !== expected.revision) throw Error('脚本库已变化，请刷新后确认要应用的版本');
  if (latest.lifecycleRevision !== expected.lifecycleRevision) {
    if (latest.appliedToCurrent === true) return {view:latest, alreadyApplied:true};
    throw Error('本局版本已变化，请刷新');
  }
  const view = await api('applyTavernScriptLibrary', {sessionId, expectedLifecycleRevision:expected.lifecycleRevision, expectedLibraryRevision:expected.revision});
  return isCurrent() ? {view, alreadyApplied:false} : null;
}
function TavernScriptManager(props) {
            const askConfirm = useTavernConfirm([props.sessionId,props.scope?.sessionId,props.cardPath,props.path,props.card?.path,props.view?.card?.path,props.record?.source?.path,props.record?.source?.cardPath].join("\n"));
  const h = React.createElement;
  const [view, setView] = React.useState(null), [scope, setScope] = React.useState('global');
  const [trees, setTrees] = React.useState([]), [selected, setSelected] = React.useState(''), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [notice,setNotice]=React.useState('');
  const [variableReview,setVariableReview]=React.useState(null),[variableChoices,setVariableChoices]=React.useState({});
  async function readVariableReview(){setVariableReview(await props.api('getScriptVariableMigration',{}));setVariableChoices({})}
  // A single, nonblocking review surface; never ask again on every generation.
  const variableChoicesRef=React.useRef(variableChoices);variableChoicesRef.current=variableChoices;
  React.useEffect(()=>{let active=true;async function read(){if(Object.keys(variableChoicesRef.current).length)return;try{const report=await props.api('getScriptVariableMigration',{});if(active)setVariableReview(report)}catch{/* Loading a review must not prevent normal script use. */}}void read();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void read()},10000);return()=>{active=false;clearInterval(timer)}},[props.sessionId]);
  const [remoteProgress,setRemoteProgress]=React.useState(null);
  async function refreshDependencies(){
    setRemoteProgress({stage:'resolving'});
    const timer=setInterval(()=>{props.api('getTavernRemoteDependencyStatus',{}).then(row=>{if(row.stage!=='idle')setRemoteProgress(row)},()=>{})},700);
    try{const result=await props.api('refreshTavernRemoteDependencies',{});if(result.status!=='completed')throw Error(result.diagnostics.map(row=>(row.name||'远程资源')+'：'+row.message+' · '+row.url).join('\n'));setView(await props.api('getTavernScriptLibrary',{}));liveTavernView.invalidate(props.sessionId);setNotice('远程依赖已重新解析并重载，已有授信继续有效');}
    finally{clearInterval(timer);setRemoteProgress(null)}
  }
  const [importPlan,setImportPlan]=React.useState(null);
  const [repository,setRepository]=React.useState(''),[repositoryRef,setRepositoryRef]=React.useState('');
  const [permission,setPermission]=React.useState(null);
  const [trustTargets,setTrustTargets]=React.useState([]),[trustCaps,setTrustCaps]=React.useState(['same-origin','cross-card','shared-settings','shared-resources','network']);
  const [trustImported,setTrustImported]=React.useState(true),[pendingTrustIds,setPendingTrustIds]=React.useState([]);
  const [pendingRevokeIds,setPendingRevokeIds]=React.useState([]),[pendingUpdateIds,setPendingUpdateIds]=React.useState([]);
  const [eventStatus,setEventStatus]=React.useState({events:[],running:false});
  const [dataText, setDataText] = React.useState(''), [buttonsText, setButtonsText] = React.useState(''), [draftDirty, setDraftDirty] = React.useState(false);
  const [, refreshApplicationContext] = React.useState(0);
  const applicationRef = React.useRef({sessionId:props.sessionId, active:true, pending:false, viewReady:!!view});
  if (applicationRef.current.sessionId !== props.sessionId) {
    applicationRef.current.active = false;
    applicationRef.current = {sessionId:props.sessionId, active:true, pending:false, viewReady:false};
  }
  // Bind callbacks to this visit, not to whichever same-named session is current
  // when an old callback happens to run. Ordinary renders reuse the same visit.
  const applicationContext = applicationRef.current;
  React.useEffect(() => {
    if (!applicationRef.current.active) {
      applicationRef.current = {...applicationRef.current, active:true, pending:false};
      // Effect replay revokes the old callbacks too. Render the new context even
      // if every background read returns a memoized value and no state changes.
      refreshApplicationContext(value => value + 1);
    }
    const context = applicationRef.current;
    setBusy(false); setError(''); setNotice('');
    return () => { context.active = false; };
  }, [props.sessionId]);
  const changes = React.useMemo(()=>describeTavernScriptChanges(view?.library[scope] || [],trees,draftDirty?selected:''),[view,scope,trees,draftDirty,selected]);
  const changedIds = new Set(changes.map(item=>item.id));
  const scopeName = {global:'全局',preset:'当前预设',character:'当前角色卡',chat:'仅本局'}[scope];
  const dirty = !!view && (changes.length > 0 || !!importPlan);
  React.useEffect(function () { if (props.onDirty) props.onDirty(!!dirty); return function () { if (props.onDirty) props.onDirty(false); }; }, [!!dirty]);
  function install(value) { applicationRef.current.viewReady = true; setView(value); setTrees(value.library[scope] || []); setDraftDirty(false); }
  React.useEffect(function () { let active = true; props.api('getTavernScriptLibrary', {}).then(function (value) { if (active) install(value); }, function (e) { if (active) setError(e.message); }); return function () { active = false; }; }, [props.sessionId]);
  async function loadEvents(){setEventStatus(await props.api('getTavernHelperEventStatus',{}));}
  React.useEffect(()=>{void loadEvents().catch(e=>setError(e.message));},[props.sessionId]);
  React.useEffect(()=>{let active=true;props.api('getTavernCardPermissions',{}).then(value=>{if(active)setPermission(value)},e=>{if(active)setError(e.message)});return()=>{active=false}},[props.sessionId]);
  function flattened(items, parent) { return (items || []).flatMap(function (item) { return [{ item: item, parent: parent || '' }].concat(item.type === 'folder' ? flattened(item.scripts, item.name) : []); }); }
  const items = flattened(trees), entry = items.find(function (row) { return row.item.id === selected; })?.item;
  React.useEffect(function () { setDataText(JSON.stringify(entry?.data || {}, null, 2)); setButtonsText(JSON.stringify(entry?.button || { enabled: true, buttons: [] }, null, 2)); setDraftDirty(false); }, [selected, scope, entry?.data, entry?.button]);
  function alter(items, id, work) { return items.flatMap(function (item) { if (item.id === id) { const next = work(item); return next ? [next] : []; } return [{ ...item, ...(item.type === 'folder' ? { scripts: alter(item.scripts, id, work) } : {}) }]; }); }
  function patch(value) { if (busy || importPlan) return; setTrees(alter(trees, selected, function (item) { return Object.assign({}, item, value); })); }
  async function run(work) { setError('');setNotice(''); setBusy(true); try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function runApplication(work) {
    const context = applicationContext;
    const isCurrent = () => context.active && applicationRef.current === context && context.sessionId === props.sessionId;
    if (!isCurrent() || context.pending || !context.viewReady) return;
    context.pending = true; setError(''); setNotice(''); setBusy(true);
    try { await work(isCurrent, context.sessionId); }
    catch (error) { if (isCurrent()) setError(error.message); }
    finally { context.pending = false; if (isCurrent()) setBusy(false); }
  }
  function importChoices(plan) {
    const ids = plan?.decisions.map(item=>item.id) || [], imported = new Set(ids);
    return {trustResourceIds:pendingTrustIds.filter(id=>!imported.has(id)).concat(trustImported?ids:[]),
      revokeTrustResourceIds:pendingRevokeIds.filter(id=>!imported.has(id)).concat(trustImported?[]:ids),
      confirmedUpdateIds:[...new Set(pendingUpdateIds.concat((plan?.decisions || []).filter(item=>item.kind!=='add').map(item=>item.id)))]};
  }
  async function changeImportTarget(importedId,choice){
    const before=importPlan;
    await run(async()=>{const next=await props.api('planTavernScriptUpdate',{name:'预览中的脚本',document:before.incoming,scope,existing:trees,selections:{...before.selections,[importedId]:choice}});setImportPlan({...next,...(before.github?{github:before.github,modules:before.modules}:{})});});
  }
  function clearImportChoices() { setPendingTrustIds([]);setPendingRevokeIds([]);setPendingUpdateIds([]); }
  function button(label, work, disabled) { return h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: busy || disabled, onClick: work }, label); }
  function field(label, value, change, rows) { return h('label', { className: 'dsh-sp-field' }, label, h(rows ? 'textarea' : 'input', { 'aria-label': label, value: value || '', rows: rows, onChange: function (e) { change(e.target.value); } })); }
  function switchScope(next) { if (busy || importPlan) { setError('请先完成或取消脚本导入'); return; } if (dirty) { setError('请先保存或放弃脚本编辑'); return; } setScope(next); setSelected(''); setTrees(view.library[next] || []); }
  function exportScripts() {
    const body = JSON.stringify(trees, null, 2), url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = '酒馆脚本-' + scope + '.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  if (!view) return h('p', { role: error ? 'alert' : 'status' }, error || '读取脚本库…');
  return h('section', { className: 'dsh-script-manager' },
    h('h3', null, '酒馆助手 · 脚本管理'),
    view.diagnostics?.some(row=>row.status==='patch-missed')?h('section',{'aria-label':'脚本兼容提示',role:'status'},h('h4',null,'兼容补丁未命中'),view.diagnostics.filter(row=>row.status==='patch-missed').map((row,index)=>h('p',{key:index},(row.name||row.scriptId)+' · '+row.message))):null,
    permission?.codeUpdated ? h('p',{role:'status'},'当前人物卡的可执行内容较授信记录有变化；已有授信仍然有效，可在资源授信中查看或撤销。') : null,
    permission ? h('details',{className:'dsh-script-permissions'},h('summary',null,'资源授信（永久，可批量设置）'),
      h('p',null,tavernResourceTrustExplanation),
      button('选择全部已有资源',()=>setTrustTargets(permission.resources.map(row=>row.key))),button('清空选择',()=>setTrustTargets([])),
      (permission.resources || []).map(row=>h('label',{key:row.key,style:{display:'block'}},h('input',{type:'checkbox',checked:trustTargets.includes(row.key),onChange:e=>setTrustTargets(values=>e.target.checked?[...values,row.key]:values.filter(key=>key!==row.key))}),({card:'人物卡',preset:'预设',script:'脚本'}[row.kind])+' · '+row.name+' · '+(row.capabilities.length?'已授信：'+row.capabilities.join('、'):'未授信'))),
      h('details',null,h('summary',null,'高级：本次一次性设置的权限'),Object.entries({'same-origin':'操作宿主页','cross-card':'跨卡读取','shared-settings':'共享设置读写','shared-resources':'共享资源读写',network:'网络（含 HTTP 和本机/内网）'}).map(([id,label])=>h('label',{key:id,style:{display:'block'}},h('input',{type:'checkbox',checked:trustCaps.includes(id),onChange:e=>setTrustCaps(values=>e.target.checked?[...values,id]:values.filter(key=>key!==id))}),label))),
      button('授信所选资源',()=>run(async()=>{setPermission(await props.api('changeTavernResourcePermissions',{targets:trustTargets,capabilities:trustCaps}));install(await props.api('getTavernScriptLibrary',{}));liveTavernView.invalidate(props.sessionId);setNotice('所选资源已永久授信，可随时在此撤销');}),dirty||!trustTargets.length),
      button('撤销所选资源授信',()=>run(async()=>{setPermission(await props.api('changeTavernResourcePermissions',{targets:trustTargets,capabilities:[]}));install(await props.api('getTavernScriptLibrary',{}));liveTavernView.invalidate(props.sessionId);}),dirty||!trustTargets.length)) : null,
    h('details', {className:'dsh-script-event-status',open:eventStatus.events.some(row=>['failed','running'].includes(row.status))},
      h('summary',null,'脚本事件与恢复'),h('p',null,'已发送但未确认完成的事件不会自动重发。请先检查表格和模型任务结果，再选择重试或跳过。'),
      button('刷新事件状态',()=>run(loadEvents)),
      eventStatus.events.length?eventStatus.events.slice(-20).reverse().map(row=>h('div',{key:row.id},
        h('p',null,row.name+' · '+({pending:'待处理',running:eventStatus.running?'执行中':'结果未确认',completed:'已完成',failed:'失败',discarded:'已跳过'}[row.status]||row.status)+' · 第 '+row.attempt+' 次'),row.error?h('p',{role:'alert'},row.error):null,
        ['running','failed'].includes(row.status)?h('div',null,...[['retry','核对后重试'],['skip','跳过此次事件']].map(([action,label])=>button(label,()=>run(async()=>{await props.api('resolveTavernHelperEvent',{id:row.id,attempt:row.attempt,action});await loadEvents();}),eventStatus.running))):null)):h('p',null,'没有待处理事件。')),

    h('details',{'aria-label':'变量用途与归属'},h('summary',null,'变量用途与归属'+(variableReview?' · 未确定 '+variableReview.unknown:'')),
      h('p',null,'新资源的 script 变量按原 API 默认共享，成功写入不随剧情回退。旧未知数据保持原位；用途或作者声明没有证据时留空。只迁移你选中的字段；聊天、消息、MVU 和表格保留。'),
      button('检查变量用途',()=>run(readVariableReview)),
      variableReview?h('div',null,variableReview.rows.map(row=>h('div',{key:row.id,className:'dsh-script-variable-row'},
        h('strong',null,row.scriptName+' · '+row.key),h('p',null,row.source+' · 用途：'+row.purpose+' · 作者声明：'+row.authorDeclaration),
        h('small',null,row.evidence+' · '+row.bytes+' 字节'),
        h('select',{'aria-label':'变量归属 '+row.scriptName+' '+row.key,disabled:busy,value:variableChoices[row.id]||row.target,onChange:event=>setVariableChoices(values=>({...values,[row.id]:event.target.value}))},
          h('option',{value:'undecided'},'未确定，保持原位'),row.apiShared?h('option',{value:'api-shared'},'按 script API 共享（默认）'):null,row.choices.map(choice=>h('option',{key:choice,value:choice},({keep:'保留原作用域',local:'确认本局数据',shared:'确认共享配置'}[choice])))))),
        button('保存所选变量决定',()=>run(async()=>{const selections=variableReview.rows.filter(row=>variableChoices[row.id]&&!['undecided','api-shared'].includes(variableChoices[row.id])).map(row=>({id:row.id,target:variableChoices[row.id],valueDigest:row.valueDigest}));setVariableReview(await props.api('decideScriptVariableMigration',{selections,expectedRevision:variableReview.revision}));setVariableChoices({});liveTavernView.invalidate(props.sessionId);setNotice('已保存变量归属决定，未选择的项继续保持原位');}),!Object.values(variableChoices).some(value=>!['undecided','api-shared'].includes(value)))):null),
    h('section',{'aria-label':'远程依赖'},button('重新解析远程依赖',()=>run(refreshDependencies),dirty||!!importPlan),
      remoteProgress?h('p',{role:'status'},({resolving:'正在解析资源版本…',resources:'正在检查缓存…',downloading:'正在下载依赖…',verifying:'正在校验依赖…',publishing:'正在保存新版本…',completed:'依赖已更新'}[remoteProgress.stage]||'正在准备依赖…')+(remoteProgress.url?' '+remoteProgress.url:'')):null,
      remoteProgress?h('button',{type:'button',className:'dsh-tavern-btn',disabled:remoteProgress.stage==='publishing'||remoteProgress.stage==='completed',onClick:()=>props.api('cancelTavernRemoteDependencies',{}).catch(e=>setError(e.message))},'取消依赖解析'):null),
    view.versionStatus?.available?h('p',{role:'status'},'脚本库与本局版本不同：'+view.versionStatus.changes.map(row=>row.name).join('、')+'。跟随模式将在空闲或下一次请求开始时更新；固定模式可手动应用。'):null,
    h('p', null, '插件脚本更新：直接导入新版 JSON，即可预览识别出的旧版。更新保留原脚本 ID、设置、变量和外部文件；保存后，跟随模式的局会自动取得新版。SP·数据库通过“扩展程序 → SP·数据库”管理安装与更新；表格模板与推进预设在各自页面导入。'),
    h('p', null, '全局、预设和角色卡脚本默认跟随库中的更新；正在发送的请求继续使用起始版本。需要保留旧版时可对当前局选择固定。“仅本局”直接保存到当前局。同 ID 按全局 → 预设 → 角色卡 → 本局依次覆盖。'),
    h('nav', { className: 'dsh-migration-toolbar' }, Object.entries({ global: '全局', preset: '当前预设', character: '当前角色卡', chat: '仅本局' }).map(function ([key, label]) { return h('button', { key: key, className: 'dsh-tavern-btn', 'aria-pressed': scope === key, disabled: busy || !!importPlan, onClick: function () { switchScope(key); } }, label); })),
    scope!=='chat'?h('label',null,scopeName+'脚本版本',h('select',{'aria-label':'本局脚本版本模式',value:view.versionStatus?.scopes?.[scope]||'follow',disabled:busy||dirty,onChange:event=>run(async()=>{await props.api('setGameResourceMode',{selection:{kind:'script',scope,mode:event.target.value},expectedRevision:view.configRevision});install(await props.api('getTavernScriptLibrary',{}));liveTavernView.invalidate(props.sessionId);})},h('option',{value:'follow'},'跟随共享版本'),h('option',{value:'pinned'},'固定本局当前版本'))):null,
    error ? h('p', { role: 'alert' }, error) : null,
    notice?h('p',{role:'status'},notice):null,
    h('fieldset', {className:'dsh-migration-toolbar',disabled:busy||!!importPlan},
      h('legend',null,'从 GitHub 安装浏览器扩展'),
      field('GitHub 仓库地址',repository,setRepository),field('分支或提交号（留空使用默认分支）',repositoryRef,setRepositoryRef),
      button('读取仓库并预览',()=>run(async()=>{if(draftDirty)throw Error('请先应用数据和按钮编辑');setImportPlan(await props.api('planTavernGithubImport',{repository,ref:repositoryRef,scope,existing:trees}));}),!repository.trim()),
      h('p',null,'仅安装包含 manifest.json 的浏览器扩展。读取固定提交并检查模块兼容性；预览后保存，不自动更新。已验证 Choice 1.4.0。')),
    h('fieldset', { className: 'dsh-migration-toolbar', disabled:busy || !!importPlan },
      h('label', { className: 'dsh-tavern-btn' }, '导入 JSON / JavaScript', h('input', { type: 'file', accept: '.json,.js,.mjs', 'aria-label': '导入脚本', disabled: busy, onChange: function (e) {
        const file = e.target.files[0]; e.target.value = ''; if (!file) return; if(draftDirty) {setError('请先应用数据和按钮编辑，或保存脚本库');return;}
        run(async function () { const source = await file.text(), parsed = await props.api('planTavernScriptUpdate', { name: file.name, document: /\.json$/i.test(file.name) ? JSON.parse(source) : source,scope,existing:trees });
          setImportPlan(parsed);
        });
      } })),
      button('新建脚本', function () { const id = crypto.randomUUID(); setTrees(trees.concat([{ type: 'script', id: id, name: '新脚本', content: '', enabled: false, data: {}, button: { enabled: true, buttons: [] } }])); setSelected(id); }),
      button('新建分组', function () { const id = crypto.randomUUID(); setTrees(trees.concat([{ type: 'folder', id, name: '新分组', scripts: [], enabled: true }])); setSelected(id); }),
      button('导出此作用域', exportScripts),
      button('打开脚本界面', function () { requestTavernScriptUi({sessionId:props.sessionId,kind:selected?'script:'+selected:'shared'}); }),
      button(scope==='chat'?'保存并重载本局':'保存到脚本库', () => runApplication(async (isCurrent, sessionId) => {
        const savedTrees = draftDirty && entry?.type === 'script' ? alter(trees, selected, item => ({...item, data:JSON.parse(dataText), button:JSON.parse(buttonsText)})) : trees;
        const saved = await props.api('changeTavernScriptLibrary', {sessionId, expectedRevision:view.revision, ...importChoices(), command:{scope, trees:savedTrees, expectedLifecycleRevision:view.lifecycleRevision}});
        if (!isCurrent()) return;
        install(saved); clearImportChoices();
        const permission = await props.api('getTavernCardPermissions', {sessionId});
        if (!isCurrent()) return;
        setPermission(permission); liveTavernView.invalidate(sessionId); setDraftDirty(false);
        setNotice(scope==='chat'?'已保存并重载本局脚本':'已保存到'+scopeName+'脚本库；点击“将已保存脚本应用到本局”可立即使用。');
      }), !dirty),
      button('放弃编辑', function () { setTrees(view.library[scope] || []); setSelected(''); clearImportChoices(); setDraftDirty(false); }, !dirty),
      button('将已保存脚本应用到本局', () => runApplication(async (isCurrent, sessionId) => {
        const result = await applyTavernScriptLibrarySelection(props.api, sessionId, view, isCurrent);
        if (!result || !isCurrent()) return;
        install(result.view);
        if (result.alreadyApplied) setNotice('当前局已跟随到所选脚本库版本，无需重复应用');
      }), dirty)),
    importPlan?h('section',{className:'dsh-script-update-preview','aria-label':'脚本更新预览'},h('h4',null,'脚本更新预览'),
      importPlan.variableReview?.unknown?h('details',{'aria-label':'导入变量用途'},h('summary',null,'有 '+importPlan.variableReview.unknown+' 项变量用途未确定，可稍后处理'),h('p',null,importPlan.variableReview.notice),h('ul',null,importPlan.variableReview.rows.map((row,index)=>h('li',{key:index},row.scriptName+' · '+row.path.join('.')+' · '+row.source+' · 用途：'+row.purpose+' · 作者声明：'+row.authorDeclaration)))):null,
      importPlan.github?h('p',null,importPlan.github.repository+' · '+importPlan.github.version+' · 提交 '+importPlan.github.commit):null,
      importPlan.github?.warnings?.length?h('ul',{'aria-label':'模块依赖提示'},importPlan.github.warnings.map((row,i)=>h('li',{key:i},row.module+':'+row.line+' · '+row.message))):null,
      importPlan.decisions.map(item=>h('div',{key:item.importedId||item.id},h('p',null,({add:'新增',update:'更新',restore:'恢复安装',override:'在此作用域接管'}[item.kind])+': '+item.name+(item.kind!=='add'?' · 保留设置和数据':'')+(item.changed&&item.kind!=='add'?' · 代码已更新':'')),
        h('label',null,'导入方式',h('select',{'aria-label':'导入方式 · '+item.name,value:item.choice||'',disabled:busy,onChange:event=>changeImportTarget(item.importedId,event.target.value)},
          item.requiresChoice?h('option',{value:'',disabled:true},'有多个候选，请选择'):null,h('option',{value:'new'},'作为新脚本'),
          (importPlan.targets||[]).map(target=>h('option',{key:target.id,value:'replace:'+target.id},(target.installed?'替换：':'恢复或接管：')+target.name+' · '+target.id+(target.scope?' · '+target.scope:''))))),
        h('p',null,'匹配建议：'+({id:'相同 ID',source:'相同来源',name:'去除版本号后同名',userscript:'相同 userscript 头',chosen:'按你的选择'}[item.matchBy]||'未找到匹配')+'；保存前可以更改。'),
        item.previousName?h('details',null,h('summary',null,'查看匹配来源'),h('p',null,(item.kind==='restore'?'历史版本：':'原脚本：')+item.previousName)):null)),
      h('p',null,'待确认导入，尚未保存。可以直接保存并应用，或先放入草稿继续编辑。'),
      h('label',null,h('input',{type:'checkbox',checked:trustImported,onChange:e=>setTrustImported(e.target.checked)}),'导入并永久信任这些脚本（包含同来源更新）'),h('p',null,tavernResourceTrustExplanation),
      !trustImported ? h('p',{role:'status'},'保存此次更新时撤销这些脚本已有的授信；脚本设置和数据仍保留。') : null,
      changes.length?h('p',null,'此次保存也包含下方列出的 '+changes.length+' 项未保存修改。'):null,
      button('放入草稿继续编辑',()=>{const choices=importChoices(importPlan);setTrees(importPlan.trees);setPendingTrustIds(choices.trustResourceIds);setPendingRevokeIds(choices.revokeTrustResourceIds);setPendingUpdateIds(choices.confirmedUpdateIds);setSelected(importPlan.decisions[0]?.id||'');setImportPlan(null);},importPlan.decisions.some(item=>item.requiresChoice)),
      button(trustImported?'导入并信任，应用到本局':'保存并应用到本局', () => runApplication(async (isCurrent, sessionId) => {
        const saved = await props.api('changeTavernScriptLibrary', {sessionId, expectedRevision:view.revision, ...importChoices(importPlan), command:{scope, trees:importPlan.trees, expectedLifecycleRevision:view.lifecycleRevision}});
        if (!isCurrent()) return;
        clearImportChoices(); setImportPlan(null); install(saved);
        if (scope !== 'chat') {
          const result = await applyTavernScriptLibrarySelection(props.api, sessionId, saved, isCurrent);
          if (!result || !isCurrent()) return;
          install(result.view);
        }
        const permission = await props.api('getTavernCardPermissions', {sessionId});
        if (!isCurrent()) return;
        setPermission(permission); setNotice('已保存更新并应用到本局');
      }), importPlan.decisions.some(item=>item.requiresChoice)),button('取消导入',()=>setImportPlan(null))):null,
    changes.length?h('section',{'aria-label':'未保存修改',role:'status'},h('p',null,'未保存（'+scopeName+'）：'+changes.length+' 项'),h('ul',null,changes.map(item=>h('li',{key:item.id},item.kind+'：'+item.name)))):null,
    h('fieldset', { className: 'dsh-script-columns', disabled:busy || !!importPlan },
      h('nav', { className: 'dsh-script-list' }, items.map(function (row) { return h('button', { key: row.item.id, className: 'dsh-tavern-btn', 'aria-pressed': selected === row.item.id, onClick: function () { if (draftDirty) { setError('请先应用数据和按钮编辑，或保存脚本库'); return; } setSelected(row.item.id); } },
        (row.parent ? row.parent + ' / ' : '') + row.item.name + (row.item.enabled === false ? '（停用）' : '') + (changedIds.has(row.item.id)?' · 未保存':'')); })),
      entry ? h('div', { className: 'dsh-script-editor' },
        dirty?h('p',null,changedIds.has(entry.id)?'当前脚本有未保存修改':'当前选中的脚本未修改'):null,
        field('脚本名称', entry.name, function (value) { patch({ name: value }); }),
        h('label', null, h('input', { type: 'checkbox', checked: entry.enabled !== false, onChange: function (e) { patch({ enabled: e.target.checked }); } }), '启用'),
        h('p', null, 'ID：' + entry.id),
        entry.type === 'folder' ? h('p', null, '此开关控制整个分组。') : h(React.Fragment, null,
          field('脚本说明', entry.info, function (value) { patch({ info: value }); }, 2),
          field('JavaScript 模块', entry.content, function (value) { patch({ content: value }); }, 18),
          field('脚本初始数据 JSON', dataText, function (value) { setDataText(value); setDraftDirty(tavernScriptJsonChanged(value,entry.data||{})||tavernScriptJsonChanged(buttonsText,entry.button||{enabled:true,buttons:[]})); }, 4),
          field('脚本按钮 JSON', buttonsText, function (value) { setButtonsText(value); setDraftDirty(tavernScriptJsonChanged(dataText,entry.data||{})||tavernScriptJsonChanged(value,entry.button||{enabled:true,buttons:[]})); }, 4),
          button('应用数据和按钮编辑', function () { try { patch({ data: JSON.parse(dataText), button: JSON.parse(buttonsText) }); setError(''); } catch (e) { setError(e.message); } })),
        h('div', { className: 'dsh-migration-toolbar' },
          button('上移', function () { const move = function (list) { const i = list.findIndex(function (x) { return x.id === selected; }); if (i > 0) { const next = list.slice(); [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; } return list.map(function (x) { return x.type === 'folder' ? { ...x, scripts: move(x.scripts) } : x; }); }; setTrees(move(trees)); }),
          button('删除所选脚本', function () { setTrees(alter(trees, selected, function () { return null; })); setSelected(''); }))) : h('p', null, '选择一个脚本进行编辑。')),
    h('details', null, h('summary', null, '历史版本与来源'),
      h('p', null, '本局快照 ' + view.digest.slice(0, 12) + ' · 脚本库版本 ' + view.revision),
      (view.diagnostics || []).map(function (d, i) { return h('p', { key: i }, (d.name || flattened(['chat','character','preset','global'].flatMap(key=>view.library[key]||[])).find(row=>row.item.id===d.scriptId)?.item.name || d.scriptId || '脚本') + '：' + d.message); }),
      view.history.slice().reverse().map(function (version) { return h('div', { key: version.id }, version.scope + ' · ' + new Date(version.at).toLocaleString(),
        button('恢复版本 ' + version.revision, function () { run(async function () { install(await props.api('changeTavernScriptLibrary', { expectedRevision: view.revision, command: { scope: scope, restore: version.id,expectedLifecycleRevision:view.lifecycleRevision } })); }); }, dirty || !version.scope.startsWith(scope))); })));
}
