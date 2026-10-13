function SpAdvancedPanel(props) {
  const h = React.createElement, database = props.database;
  const [tab, setTab] = React.useState(props.initialTab||'overview'), [info, setInfo] = React.useState(null), [draft, setDraft] = React.useState(database.settings);
  const [query, setQuery] = React.useState(''), [keys, setKeys] = React.useState({}), [novel, setNovel] = React.useState(''), [novelName, setNovelName] = React.useState('小说世界书');
  const [continuing, setContinuing] = React.useState(false), [continued, setContinued] = React.useState(0);
  const controller = React.useRef(null), dirty = JSON.stringify(draft) !== JSON.stringify(database.settings);
  const draftBase=React.useRef(JSON.stringify(database.settings));
  React.useEffect(function () { if(JSON.stringify(draft)===draftBase.current)setDraft(database.settings);draftBase.current=JSON.stringify(database.settings); }, [JSON.stringify(database.settings)]);
  React.useEffect(function () { props.onDirty(dirty); return function () { props.onDirty(false); }; }, [dirty]);
  React.useEffect(function () { let cancelled = false; props.api('getSpDashboard', {}).then(function (result) { if (!cancelled) setInfo(result); }, props.onError); return function () { cancelled = true; }; }, [database.revision, database.activity && database.activity.finishedAt, props.sessionId]);
  React.useEffect(function () { return function () { if (controller.current) controller.current.abort(); }; }, [props.sessionId]);
  function patch(key, value) { setDraft(Object.assign({}, draft, { [key]: value })); }
  function nested(group, key, value) { patch(group, Object.assign({}, draft[group], { [key]: value })); }
  function check(label, value, change, help) { return h('label', { className: 'dsh-sp-toggle' }, h('input', { type: 'checkbox', checked: !!value, disabled: props.busy, onChange: function (e) { change(e.target.checked); } }), h('span', null, label, help ? h('small', null, help) : null)); }
  function field(group, key, label, type, help) { const value = draft[group][key]; return h('label', { className: 'dsh-sp-field' }, label,
    h(type === 'textarea' ? 'textarea' : 'input', { 'aria-label': label, type: type === 'textarea' ? undefined : type || 'text', rows: type === 'textarea' ? 4 : undefined, value: value, disabled: props.busy,
      onChange: function (e) { nested(group, key, type === 'number' ? Number(e.target.value) : e.target.value); } }), help ? h('small', null, help) : null); }
  function model(group, key, label) { return h(MigrationModelPicker, { label: label, catalog: props.catalog, value: draft[group][key], disabled: props.busy, onChange: function (v) { nested(group, key, v); } }); }
  function button(label, action, disabled) { return h('button', { className: 'dsh-tavern-btn', disabled: props.busy || disabled, onClick: action }, label); }
  function task(kind, payload) { return props.run(function () { return props.api('runSpAdvanced', { kind: kind, payload: payload || {} }); }, '任务已完成'); }
  function tables(group, key) { return h('fieldset', null, h('legend', null, '选择表格（不选则使用默认范围）'), Object.keys(database.data).filter(function (k) { return k.startsWith('sheet_'); }).map(function (k) {
    return h('div', { key: k }, check(database.data[k].name, draft[group][key].includes(k), function (on) { nested(group, key, on ? draft[group][key].concat([k]) : draft[group][key].filter(function (v) { return v !== k; })); })); })); }
  function save() { return props.settings(draft); }
  function basicToggles() { return h('div', { className: 'dsh-sp-grid' },
    check('自动更新', draft.autoFill, function (v) { patch('autoFill', v); }, '正文完成后，按每张表的频率自动填表。'),
    check('飞行模式', draft.flightMode, function (v) { patch('flightMode', v); }, '暂停自动召回与推进；召回时隐藏已有大总结覆盖的旧记录。原始记录仍可查看。'),
    check('静默提示框', draft.toastMuteEnabled, function (v) { patch('toastMuteEnabled', v); }, '减少普通保存通知，保留任务状态和错误。'),
    check('0TK 占用模式', draft.zeroTkOccupyMode, function (v) { patch('zeroTkOccupyMode', v); }, '不自动注入纪要目录、大纲和索引；选中的记忆仍可召回，模型调用仍消耗 token。'),
    check('开启流式输出', draft.streamingEnabled, function (v) { patch('streamingEnabled', v); }, '在工作台逐步显示后台模型输出。'));
  }
  let content;
  if (tab === 'overview') {
    const d = info && info.dashboard;
    content = h(React.Fragment, null, h('h3',null,'运行概览'), h('p', null, '运行概览按本局真实记录计算。模型已选择表示配置存在，成功调用记录单独显示。'), d ? h(React.Fragment, null,
      h('div', { className: 'dsh-sp-grid' }, [['模型配置', d.modelConfigured ? (d.fillModel.provider + ' / ' + d.fillModel.model) : '未选择'], ['SQL 模板', d.sql.ready ? '可用，' + d.sql.generated + ' 张表自动生成结构' : d.sql.error], ['表格更新', d.active + ' 张自动更新 · ' + d.due + ' 张待更新'], ['向量索引', d.vector.indexed + ' / ' + d.vector.documents + ' 段'], ['运行日志', d.errors + ' 条错误 · ' + d.warnings + ' 条警告']].map(function (v) { return h('article', { className: 'dsh-sp-card', key: v[0] }, h('strong', null, v[0]), h('p', null, v[1])); })),
      h('p', null, '本局正文 ' + d.total + ' 楼；最近成功填表：' + (d.modelVerifiedAt ? new Date(d.modelVerifiedAt).toLocaleString() : '尚无成功记录')),
      h('div', { className: 'dsh-migration-table-scroll' }, h('table', { className: 'dsh-migration-table' }, h('thead', null, h('tr', null, ['表格', '数据行', '自动更新', '上次楼层', '下次楼层', '积压楼数'].map(function (s) { return h('th', { key: s }, s); }))), h('tbody', null, d.tables.map(function (t) { return h('tr', { key: t.key }, [t.name, t.rows, t.enabled ? '开启' : '关闭', t.last === null ? '未记录' : t.last, t.next === null ? '—' : t.next, t.pending].map(function (s, i) { return h('td', { key: i }, s); })); }))))) : h('p', null, '读取运行概览…'),
      h('h3', null, '基础设置'), basicToggles(), h('h3', null, '高级设置'), h('div', { className: 'dsh-sp-grid' },
        check('剧情推进', draft.plotEnabled, function (v) { patch('plotEnabled', v); }, '使用推进预设，在正文前运行；默认保持关闭。'),
        check('智能续写', draft.continuationPageEnabled, function (v) { patch('continuationPageEnabled', v); }, '开放连续游玩入口，需手动开始。'),
        check('外部导入', draft.externalImportPageEnabled, function (v) { patch('externalImportPageEnabled', v); }, '开放小说转世界书入口。'),
        check('正文替换', draft.contentReplaceEnabled, function (v) { patch('contentReplaceEnabled', v); }, '正文保存前由独立模型检查与优化。'),
        check('交火模式', draft.vector.enabled, function (v) { nested('vector', 'enabled', v); }, '启用语义检索，需配置 Embedding。'),
        check('开发者选项', draft.developerOptionsEnabled, function (v) { patch('developerOptionsEnabled', v); }, '显示运行依据、选择记录和数据诊断。')),
      h('label', { className: 'dsh-sp-field' }, '存储模式', h('select', { 'aria-label': '存储模式', value: draft.storageMode, onChange: function (e) { patch('storageMode', e.target.value); } }, h('option', { value: 'json' }, 'JSON'), h('option', { value: 'sqlite' }, 'SQLite'))),
      h('p', null, '切换后从下次保存开始使用所选存储。历史快照保留，JSON / SQL 填表格式在“填表与召回”单独选择。'));
  } else if (tab === 'vector') content = h(React.Fragment, null,
    h('p', null, '把记忆转成向量，按语义找回相关事件；Rerank 可选。这里填写完整接口地址，例如 /v1/embeddings。'),
    check('交火模式 / 向量召回', draft.vector.enabled, function (v) { nested('vector', 'enabled', v); }),
    field('vector', 'url', 'Embedding API 地址'), field('vector', 'model', 'Embedding 模型'), field('vector', 'rerankUrl', 'Rerank API 地址'), field('vector', 'rerankModel', 'Rerank 模型'),
    h('div', { className: 'dsh-sp-grid' }, ['embeddingKey', 'rerankKey'].map(function (key) { return h('label', { key: key, className: 'dsh-sp-field' }, key === 'embeddingKey' ? 'Embedding 密钥' : 'Rerank 密钥', h('input', { type: 'password', autoComplete: 'new-password', value: keys[key] || '', placeholder: info && info.credentials[key] ? '已保存；不填写则保留' : '未保存', onChange: function (e) { setKeys(Object.assign({}, keys, { [key]: e.target.value })); } })); })),
    button('保存填写的服务密钥', function () { props.run(async function () { const r = await props.api('saveSpServiceCredentials', { patch: keys }); setInfo(Object.assign({}, info, r)); setKeys({}); return r; }, '密钥已保存'); }, dirty || !Object.keys(keys).length),
    dirty ? h('small', null, '请先保存 API 地址等数据库设置，再保存服务密钥。') : null,
    h('div', { className: 'dsh-sp-grid' }, field('vector', 'topK', '语义召回条数', 'number'), field('vector', 'threshold', '相似度阈值（-1 至 1）', 'number'), field('vector', 'recentRows', '固定保留最近记录数', 'number'), field('vector', 'chunkChars', '索引分段字数', 'number'), field('vector', 'batchSize', 'Embedding 每批数量', 'number')),
    model('vector', 'queryModel', '召回检索词模型'), field('vector', 'queryPrompt', '检索词提示词（留空直接检索输入）', 'textarea'),
    button('建立 / 更新向量索引', function () { task('vector-index'); }, dirty), h('label', { className: 'dsh-sp-field' }, '召回测试内容', h('textarea', { value: query, onChange: function (e) { setQuery(e.target.value); } })),
    button('测试语义召回', function () { task('vector-test', { query: query }); }, dirty || !query.trim()), database.vectorPreview ? h('pre', { className: 'dsh-sp-output' }, JSON.stringify(database.vectorPreview, null, 2)) : null);
  else if (tab === 'agent') content = h(React.Fragment, null,
    h('p', null, 'Agent 从指定世界书中挑选当前需要的条目。仅观察会保存选择结果，接管会把选择结果交给正文。'),
    h('label', { className: 'dsh-sp-field' }, 'Agent 世界书模式', h('select', { value: draft.agent.mode, 'aria-label': 'Agent 世界书模式', onChange: function (e) { nested('agent', 'mode', e.target.value); } }, [['off', '关闭'], ['observe', '仅观察'], ['takeover', 'Agent 接管']].map(function (v) { return h('option', { key: v[0], value: v[0] }, v[1]); }))),
    h('fieldset', null, h('legend', null, '世界书范围（不勾选使用本局绑定世界书）'), ((info && info.worldbooks) || []).map(function (book) { return h('div', { key: book.id }, check(book.name, draft.agent.scope.includes(book.id), function (v) { nested('agent', 'scope', v ? draft.agent.scope.concat([book.id]) : draft.agent.scope.filter(function (id) { return id !== book.id; })); })); })),
    model('agent', 'model', '世界书选择模型'), model('agent', 'skillModel', '条目描述生成模型'),
    field('agent', 'maxEntries', '最多选择条目', 'number'), field('agent', 'maxChars', '世界书字数预算', 'number'), field('agent', 'contextTurns', '参考最近轮数', 'number'), field('agent', 'prompt', 'Agent 选择提示词', 'textarea'),
    button('生成条目用途与触发说明', function () { task('agent-skills'); }, dirty),
    h('details', null, h('summary', null, '编辑条目描述与触发规则'), Object.entries(draft.agent.skills).map(function (pair) { return h('div', { key: pair[0], className: 'dsh-sp-card' }, h('strong', null, pair[0]), ['description', 'trigger'].map(function (key) { return h('label', { key: key, className: 'dsh-sp-field' }, key === 'description' ? '用途' : '触发条件', h('textarea', { value: pair[1][key], onChange: function (e) { nested('agent', 'skills', Object.assign({}, draft.agent.skills, { [pair[0]]: Object.assign({}, pair[1], { [key]: e.target.value }) })); } })); })); })),
    h('label', { className: 'dsh-sp-field' }, 'Agent 测试输入', h('textarea', { value: query, onChange: function (e) { setQuery(e.target.value); } })),
    button('测试世界书选择', function () { task('agent-test', { query: query }); }, dirty || !query.trim()), database.agentPreview || database.agentResult ? h('pre', { className: 'dsh-sp-output' }, JSON.stringify(database.agentPreview || database.agentResult, null, 2)) : null);
  else if (tab === 'history') content = h(React.Fragment, null,
    h('h3', null, '分组补填'), h('p', null, '楼层按非开场白的 AI 正文计数。各组依次读取前组候选结果，全部成功才写入；失败和取消不保存半份数据。'),
    field('backfill', 'from', '补填起始楼层', 'number'), field('backfill', 'to', '补填结束楼层（0 到最新）', 'number'), field('backfill', 'groupSize', '每组正文楼数', 'number'), tables('backfill', 'tables'), field('backfill', 'prompt', '补填附加规则', 'textarea'),
    button('开始分组补填', function () { task('backfill'); }, dirty), h('h3', null, '摘要合并'),
    check('自动合并旧纪要', draft.summary.enabled, function (v) { nested('summary', 'enabled', v); }), model('summary', 'model', '摘要合并模型'), tables('summary', 'sourceTables'),
    field('summary', 'keepRecent', '保留最近原始记录数', 'number'), field('summary', 'batchSize', '每组合并记录数', 'number'), field('summary', 'maxChars', '摘要字数目标', 'number'), field('summary', 'prompt', '摘要合并提示词', 'textarea'),
    button('手动合并旧纪要', function () { task('summary'); }, dirty), h('p', null, '合并结果写入大总结表，源记录保留；飞行模式控制是否在召回中隐藏已被合并的旧记录。'));
  else if (['utilities','import','continuation'].includes(tab)) content = h(React.Fragment, null,
    tab==='utilities'?h(React.Fragment,null,h('h3', null, '正文替换'), model('replacement', 'model', '正文优化模型'), field('replacement', 'prompt', '正文优化提示词', 'textarea'), field('replacement', 'maxChars', '正文最大字数', 'number'),
    database.lastReplacement ? h('details', null, h('summary', null, '上次优化前后对照'), database.lastReplacement.error ? h('p', { role: 'alert' }, '保留原文：' + database.lastReplacement.error) : null, h('pre', { className: 'dsh-sp-output' }, database.lastReplacement.original), h('hr'), h('pre', { className: 'dsh-sp-output' }, database.lastReplacement.result)) : null):null,
    tab==='import' ? h(React.Fragment, null, h('h3', null, '小说转世界书'),check('启用外部导入',draft.externalImportPageEnabled,v=>patch('externalImportPageEnabled',v)), h('input', { value: novelName, 'aria-label': '导出世界书名称', onChange: function (e) { setNovelName(e.target.value); } }),
      h('input', { type: 'file', accept: '.txt,.md', onChange: async function (e) { const file = e.target.files[0]; if (file) { if (file.size > 4000000) { props.onError(new Error('文件过大，请分批导入')); return; } setNovel(await file.text()); setNovelName(file.name.replace(/\.[^.]+$/, '')); } } }),
      h('textarea', { value: novel, rows: 7, 'aria-label': '小说内容', onChange: function (e) { setNovel(e.target.value); } }), button('整理世界书条目', function () { task('external-import', { text: novel, name: novelName }); }, dirty || !novel.trim() || !draft.externalImportPageEnabled),
      database.worldbookImport ? button('导出世界书 JSON', function () { props.exportJson(database.worldbookImport.name + '.json', database.worldbookImport); }) : null) : null,
    tab==='continuation' ? h(React.Fragment, null, h('h3', null, '智能续写'),check('启用智能续写',draft.continuationPageEnabled,v=>patch('continuationPageEnabled',v)),h('p',null,'当前提供按设定轮数连续生成；原扩展的 Agent 大纲会话工作流尚未接入。'), field('continuation', 'rounds', '连续续写轮数', 'number'), field('continuation', 'prompt', '每轮发送的提示词', 'textarea'),
      h('p', null, '手动开始后依次发送，关闭此页面或点击停止后不再发送下一轮；当前已发送的一轮可用聊天停止按钮停止。'),
      button('开始连续续写', async function () { const c = new AbortController(); controller.current = c; setContinuing(true); setContinued(0); try { for (let i = 0; i < draft.continuation.rounds; i++) { c.signal.throwIfAborted(); await migrationHost.continueTurn(props.sessionId, draft.continuation.prompt, c.signal); setContinued(i + 1); } } catch (e) { if (!c.signal.aborted) props.onError(e); } finally { setContinuing(false); } }, dirty || continuing || !draft.continuationPageEnabled),
      h('button', { className: 'dsh-tavern-btn', disabled: !continuing, onClick: function () { controller.current.abort(); } }, '停止后续续写'), h('p', { role: 'status' }, '本次已续写 ' + continued + ' 轮')) : null);
  else content = h(React.Fragment, null, h('h3', null, '运行日志'), ((info && info.dashboard.logs) || []).map(function (entry, i) { return h('p', { key: i, className: entry.level === 'error' ? 'dsh-tavern-dock-error' : '' }, new Date(entry.at).toLocaleString() + ' · ' + entry.task + ' · ' + entry.message); }),
    draft.developerOptionsEnabled ? h('details', null, h('summary', null, '开发者诊断'), h('pre', { className: 'dsh-sp-output' }, JSON.stringify({ basis: database.basis, fillProgress: database.fillProgress, vectorPreview: database.vectorPreview, agentResult: database.agentResult, lastPlot: database.plot }, null, 2))) : null);
  return h('section', { className: 'dsh-sp-advanced' }, props.embedded?null:h('nav', { className: 'dsh-migration-toolbar' }, [['overview', '运行概览'], ['vector', '向量召回'], ['agent', 'Agent 世界书'], ['history', '补填与摘要'], ['utilities', '高级工具'], ['logs', '日志']].map(function (v) { return h('button', { key: v[0], className: 'dsh-tavern-btn', 'aria-pressed': tab === v[0], onClick: function () { setTab(v[0]); } }, v[1]); })),
    h('div', { className: 'dsh-migration-toolbar dsh-sp-savebar' }, button('保存数据库设置', save, !dirty), button('放弃设置编辑', function () { setDraft(database.settings); }, !dirty), dirty ? h('span', { role: 'status' }, '有尚未保存的设置') : null), content,
    database.maintenance ? h('div', { role: 'status', className: 'dsh-sp-card' }, '后台任务：' + database.maintenance.kind + ' · ' + ({ running: '运行中', completed: '完成', cancelled: '已停止', failed: '失败', interrupted: '已中断' }[database.maintenance.status] || database.maintenance.status), database.maintenance.total ? h('progress', { value: database.maintenance.done || 0, max: database.maintenance.total }) : null,
      database.maintenance.error ? h('p', { role: 'alert' }, database.maintenance.error) : null, database.maintenance.text ? h('pre', { className: 'dsh-sp-output' }, database.maintenance.text) : null,
      database.maintenance.result ? h('pre', { className: 'dsh-sp-output' }, JSON.stringify(database.maintenance.result, null, 2)) : null) : null,
    h('button', { className: 'dsh-tavern-btn', disabled: !(props.busy || database.maintenance && database.maintenance.status === 'running'), onClick: function () { props.api('cancelSpAdvanced', {}).catch(props.onError); } }, '停止数据库后台任务'));
}
