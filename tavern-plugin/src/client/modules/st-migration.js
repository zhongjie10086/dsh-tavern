let migrationHost = null;

function NativeTavernChoices(props) {
  const h = React.createElement;
  const [error, setError] = React.useState("");
  return h("div", { className: "dsh-migration-choices" },
    (props.choices || []).map(function (choice, index) {
      return h("button", { key: index, type: "button", className: "dsh-tavern-btn", onClick: function () {
        try {
          if (!migrationHost) throw new Error("输入框尚未就绪");
          migrationHost.appendInput(props.sessionId, choice); setError("");
        } catch (error) { setError(error.message); }
      } }, h("span", { className: "dsh-migration-choice-index" }, index + 1), choice);
    }), error ? h("div", { role: "alert" }, error) : null);
}

function NativeMulticolorInput(props) {
  const h = React.createElement;
  return h("div", { className: "dsh-migration-multicolor" },
    h("div", { className: "dsh-migration-multicolor-title" }, "本轮输入"),
    String(props.text || "").split(/\r?\n/).map(function (line, index) {
      return h("p", { key: index, className: "dsh-migration-input-line tone-" + (index % 4) }, line || "\u00a0");
    }),
    h("button", { type: "button", className: "dsh-tavern-btn", onClick: function () {
      if (migrationHost) migrationHost.openDatabase(props.sessionId);
    } }, "查看本局数据库"));
}

function PresetCompatibilityReport(props) {
  const h = React.createElement, report = props.report;
  if (!report) return null;
  const labels = { supported: "已支持", dependency: "需要配套功能或验证", unsupported: "尚未支持" };
  return h("details", { className: "dsh-migration-report", open: true },
    h("summary", null, "兼容情况：已支持 " + report.counts.supported + " · 需配套 " + report.counts.dependency + " · 尚未支持 " + report.counts.unsupported),
    h("p", null, "导入内容已保存。使用这份预设的局默认跟随共享更新，下一次请求取得新版；显式固定的局保留当前版本。"),
    ["unsupported", "dependency", "supported"].map(function (status) {
      const items = (report.items || []).filter(function (item) { return item.status === status; });
      if (!items.length) return null;
      return h("details", { key: status, open: status === "unsupported" || status === "dependency" },
        h("summary", null, labels[status] + " · " + items.length),
        items.map(function (item, index) { return h("div", { key: item.kind + item.key + index, className: "dsh-migration-report-item" },
          h("strong", null, item.name + (item.reviewedVersion ? "（已审核版本）" : "") + (item.enabled ? "" : "（关闭）")), h("span", null, item.message)); }));
    }));
}

function MigrationModelPicker(props) {
  const h = React.createElement, value = props.value ? JSON.stringify(props.value) : "";
  const options = (props.catalog || []).flatMap(function (group) { return (group.models || []).map(function (model) {
    return { value: JSON.stringify({ provider: group.provider, model: model.id }), name: (group.providerName || group.provider) + " · " + (model.name || model.id) };
  }); });
  if (value && !options.some(function (o) { return o.value === value; })) options.push({ value: value, name: props.value.provider + " · " + props.value.model + "（当前目录未提供）" });
  return h("label", { className: "dsh-sp-field" }, props.label, h("select", { "aria-label": props.label, value: value, disabled: props.disabled,
    onChange: function (event) { props.onChange(event.target.value ? JSON.parse(event.target.value) : null); } },
    h("option", { value: "" }, props.fallback || "跟随本局正文模型"), options.map(function (o) { return h("option", { key: o.value, value: o.value }, o.name); })));
}
function MigrationRuleEditor(props) {
  const h = React.createElement, encoded = JSON.stringify(props.value || []);
  const [draft, setDraft] = React.useState(props.value || []);
  React.useEffect(function () { setDraft(props.value || []); }, [encoded]);
  const changed = JSON.stringify(draft) !== encoded;
  function patch(index, field, value) { setDraft(draft.map(function (rule, i) { return i === index ? Object.assign({}, rule, { [field]: value }) : rule; })); }
  return h("details", { className: "dsh-sp-rules" }, h("summary", null, props.label + " · " + draft.length),
    h("p", null, "按起始与结束文本配对，不需要编写正则。提取保留每条规则最后一个完整片段；排除删除全部完整片段。没有匹配到提取规则时保留原文。"),
    draft.map(function (rule, i) { return h("div", { key: i, className: "dsh-migration-toolbar" },
      h("input", { value: rule.start, "aria-label": props.label + " " + (i + 1) + " 起始文本", placeholder: "起始文本", disabled: props.disabled, onChange: function (e) { patch(i, "start", e.target.value); } }),
      h("input", { value: rule.end, "aria-label": props.label + " " + (i + 1) + " 结束文本", placeholder: "结束文本", disabled: props.disabled, onChange: function (e) { patch(i, "end", e.target.value); } }),
      h("button", { className: "dsh-tavern-btn", disabled: props.disabled, onClick: function () { setDraft(draft.filter(function (_, n) { return n !== i; })); } }, "删除规则")); }),
    h("div", { className: "dsh-migration-toolbar" },
      h("button", { className: "dsh-tavern-btn", disabled: props.disabled, onClick: function () { setDraft(draft.concat([{ start: "", end: "" }])); } }, "添加规则"),
      h("button", { className: "dsh-tavern-btn", disabled: props.disabled || !changed || draft.some(function (r) { return !r.start.trim() || !r.end.trim(); }),
        onClick: function () { props.onSave(draft); } }, "保存" + props.label),
      h("button", { className: "dsh-tavern-btn", disabled: props.disabled || !changed, onClick: function () { setDraft(props.value || []); } }, "放弃规则编辑")),
    changed ? h("p", { role: "status" }, "这些规则尚未保存。") : null);
}
function SpPlotEditor(props) {
            const askConfirm = useTavernConfirm([props.sessionId,props.scope?.sessionId,props.cardPath,props.path,props.card?.path,props.view?.card?.path,props.record?.source?.path,props.record?.source?.cardPath].join("\n"));
  const h = React.createElement, settings = props.database.settings;
  const [library, setLibrary] = React.useState(null), [selected, setSelected] = React.useState(""), [draft, setDraft] = React.useState(null);
  const [previewInput, setPreviewInput] = React.useState("");
  const file = React.useRef(null), saved = JSON.stringify(settings.plotPreset);
  const latestSettings = React.useRef(settings), draftBaseline = React.useRef(saved);
  latestSettings.current = settings;
  React.useEffect(function () {
    let disposed = false;
    props.api("listSpConfigurations", {}).then(function (result) { if (!disposed) { const value=latestSettings.current.plotPreset || result.defaultPreset; draftBaseline.current=JSON.stringify(value); setLibrary(result); setDraft(value); } }, props.onError);
    return function () { disposed = true; };
  }, [props.sessionId]);
  React.useEffect(function () { if (library) { const value=settings.plotPreset || library.defaultPreset; setDraft(current=>JSON.stringify(current)===draftBaseline.current?value:current); draftBaseline.current=JSON.stringify(value); } }, [saved]);
  const unchanged = JSON.stringify(draft) === JSON.stringify(settings.plotPreset || library && library.defaultPreset);
  React.useEffect(function () { props.onDirty(!unchanged); return function () { props.onDirty(false); }; }, [unchanged]);
  function patch(value) { setDraft(Object.assign({}, draft, value)); }
  function taskPatch(index, value) { patch({ plotTasks: draft.plotTasks.map(function (t, i) { return i === index ? Object.assign({}, t, value) : t; }) }); }
  function button(label, action, disabled) { return h("button", { className: "dsh-tavern-btn", disabled: props.busy || disabled, onClick: action }, label); }
  function field(label, value, action, rows) { return h("label", { className: "dsh-sp-field" }, label, h(rows ? "textarea" : "input", { "aria-label": label, value: value == null ? "" : value, rows: rows, disabled: props.busy, onChange: function (e) { action(e.target.value); } })); }
  function model(label, value, action, fallback) { return h(MigrationModelPicker, { label: label, value: value, onChange: action, catalog: props.catalog, disabled: props.busy, fallback: fallback }); }
  function refresh(result) { setLibrary(result); }
  async function importFile(input) {
    if (!input) return;
    await props.run(async function () {
      const imported = JSON.parse(await input.text());
      const result = await props.api("saveSpPlotPreset", { preset: imported, name: imported.name || input.name.replace(/\.json$/i, "") });
      refresh(result);
      const item = result.presets.find(function (p) { return p.name === (imported.name || input.name.replace(/\.json$/i, "")); });
      if (item) { setSelected(item.id); setDraft(item.preset); }
    }, "推进预设已导入预设库；保存到本局后生效。");
  }
  if (!draft || !library) return h("p", null, "读取推进预设…");
  const activity = props.database.plotActivity, result = props.database.plotPreview || props.database.plot;
  return h("div", { className: "dsh-sp-plot-editor" },
    h("p", null, "召回和推进在正文生成前运行。模型、开关和保存到本局的内容从下一轮生效；预设库可供其他局载入。"),
    h("label", { className: "dsh-migration-check" }, h("input", { type: "checkbox", checked: settings.plotEnabled, disabled: props.busy,
      onChange: function (e) { props.settings({ plotEnabled: e.target.checked }); } }), "自动召回与推进"),
    h("div", { className: "dsh-sp-grid" }, model("召回模型", settings.recallModel, function (value) { props.settings({ recallModel: value }); }),
      model("推进模型", settings.plotModel, function (value) { props.settings({ plotModel: value }); })),
    h("div", { className: "dsh-migration-toolbar" },
      h("select", { "aria-label": "推进预设库", value: selected, disabled: props.busy, onChange: function (e) { setSelected(e.target.value); } },
        h("option", { value: "" }, "选择已保存的推进预设"), library.presets.map(function (p) { return h("option", { value: p.id, key: p.id }, p.name); })),
      button("载入所选预设", function () { const item = library.presets.find(function (p) { return p.id === selected; }); if (item) setDraft(item.preset); }, !selected || !unchanged),
      button("导入推进预设 JSON", function () { file.current.click(); }, !unchanged),
      button("导出当前推进预设", function () { props.exportJson((draft.name || "推进预设") + ".json", draft); }),
      button("删除所选预设", async function () { if(!(await askConfirm('删除所选推进预设？库中不保留副本，本局设置保留。')))return;props.run(async function () { refresh(await props.api("deleteSpPlotPreset", { id: selected })); setSelected(""); }, "已从预设库删除，本局设置保留"); }, !selected),
      h("input", { ref: file, type: "file", accept: ".json", hidden: true, onChange: function (e) { importFile(e.target.files[0]); e.target.value = ""; } })),
    field("推进预设名称", draft.name, function (value) { patch({ name: value }); }),
    h("div", { className: "dsh-migration-toolbar" },
      button("保存推进预设到本局", function () { props.settings({ plotPreset: draft }); }, unchanged),
      button("存入推进预设库", function () { props.run(async function () { refresh(await props.api("saveSpPlotPreset", { name: draft.name, preset: draft })); }, "已存入预设库；本局使用的内容请另行保存"); }, !draft.name.trim()),
      button("放弃推进编辑", function () { setDraft(settings.plotPreset || library.defaultPreset); }, unchanged)),
    !unchanged ? h("p", { role: "status" }, "推进预设有未保存的修改。") : null,
    (draft.warnings || []).map(function (w, i) { return h("p", { key: i, role: "note" }, w); }),
    field("推进参考最近几条助手消息", draft.contextTurnCount, function (v) { patch({ contextTurnCount: Number(v) }); }),
    h(MigrationRuleEditor, { label: "召回与推进上下文提取规则", value: draft.contextExtractRules, disabled: props.busy, onSave: function (rules) { patch({ contextExtractRules: rules }); } }),
    h(MigrationRuleEditor, { label: "召回与推进上下文排除规则", value: draft.contextExcludeRules, disabled: props.busy, onSave: function (rules) { patch({ contextExcludeRules: rules }); } }),
    h("p", null, "推进规则只处理历史助手消息，玩家本轮输入单独提供。规则写入编辑稿后，点“保存推进预设到本局”。同阶段任务共用前阶段结果，后阶段可引用前阶段输出标签。"),
    draft.plotTasks.map(function (task, index) {
      return h("details", { key: task.id, open: index === 0, className: "dsh-sp-task" }, h("summary", null, task.name + " · 阶段 " + task.stage),
        h("label", { className: "dsh-migration-check" }, h("input", { type: "checkbox", checked: task.enabled !== false, disabled: props.busy, onChange: function (e) { taskPatch(index, { enabled: e.target.checked }); } }), "启用任务"),
        field("任务名称 " + (index + 1), task.name, function (v) { taskPatch(index, { name: v }); }),
        h("label", { className: "dsh-sp-field" }, "任务类型", h("select", { "aria-label": "任务类型 " + (index + 1), value: task.kind, disabled: props.busy, onChange: function (e) { taskPatch(index, { kind: e.target.value }); } }, h("option", { value: "recall" }, "召回"), h("option", { value: "plot" }, "推进"))),
        model("任务模型 " + (index + 1), task.model, function (v) { taskPatch(index, { model: v }); }, "跟随上方" + (task.kind === "recall" ? "召回" : "推进") + "模型"),
        h("div", { className: "dsh-sp-grid" }, ["stage", "order", "maxRetries", "minLength"].map(function (key) {
          return field(({ stage: "阶段", order: "顺序", maxRetries: "结果修正次数（0–3）", minLength: "结果最少字数" })[key] + " " + (index + 1), task[key], function (v) { taskPatch(index, { [key]: Number(v) }); }); })),
        field("结果提取标签 " + (index + 1), task.extractTags, function (v) { taskPatch(index, { extractTags: v }); }),
        field("注入正文标签 " + (index + 1), task.extractInjectTags, function (v) { taskPatch(index, { extractInjectTags: v }); }),
        h("p", null, "多个标签用逗号分隔；留空保留全部结果。"),
        task.promptGroup.map(function (prompt, pIndex) {
          const setPrompt = function (value) { taskPatch(index, { promptGroup: task.promptGroup.map(function (p, i) { return i === pIndex ? Object.assign({}, p, value) : p; }) }); };
          const move = function (step) { const next = task.promptGroup.slice(), other = pIndex + step; [next[pIndex], next[other]] = [next[other], next[pIndex]]; taskPatch(index, { promptGroup: next }); };
          return h("div", { key: pIndex, className: "dsh-sp-prompt" },
            h("div", { className: "dsh-migration-toolbar" }, h("label", null, h("input", { type: "checkbox", checked: prompt.enabled !== false, disabled: props.busy, onChange: function (e) { setPrompt({ enabled: e.target.checked }); } }), "提示词 " + (pIndex + 1)),
              h("select", { "aria-label": "提示词角色 " + (index + 1) + "-" + (pIndex + 1), value: prompt.role, disabled: props.busy, onChange: function (e) { setPrompt({ role: e.target.value }); } }, ["system", "user", "assistant"].map(function (role) { return h("option", { value: role, key: role }, role); })),
              button("上移", function () { move(-1); }, pIndex === 0), button("下移", function () { move(1); }, pIndex === task.promptGroup.length - 1),
              button("删除提示词", function () { taskPatch(index, { promptGroup: task.promptGroup.filter(function (_, i) { return i !== pIndex; }) }); }, task.promptGroup.length === 1)),
            field("提示词内容 " + (index + 1) + "-" + (pIndex + 1), prompt.content, function (v) { setPrompt({ content: v }); }, 6));
        }),
        button("添加提示词", function () { taskPatch(index, { promptGroup: task.promptGroup.concat([{ role: "user", content: "", enabled: true }]) }); }),
        field("本任务最终注入指令 " + (index + 1), task.finalDirectiveTemplate, function (v) { taskPatch(index, { finalDirectiveTemplate: v }); }, 3),
        button("删除任务", function () { patch({ plotTasks: draft.plotTasks.filter(function (_, i) { return i !== index; }) }); }, draft.plotTasks.length === 1));
    }),
    button("添加推进任务", function () { patch({ plotTasks: draft.plotTasks.concat([{ id: "task-" + Date.now(), name: "新任务", kind: "plot", enabled: true, stage: 2, order: draft.plotTasks.length, model: null, maxRetries: 1, minLength: 0, extractTags: "", extractInjectTags: "", finalDirectiveTemplate: "", promptGroup: [{ role: "user", content: "$7\n\n$8" }] }]) }); }),
    field("最终注入正文的指令", draft.finalSystemDirective, function (v) { patch({ finalSystemDirective: v }); }, 5),
    h("details", null, h("summary", null, "可用占位符与生效方式"),
      h("p", null, "$7：过滤后的历史助手消息；$8：本轮输入；$5 / {{tables}}：可发送的表格；$6：上轮推进；$1 / $9：DSH 已准备的世界书；$C：角色描述；$U：玩家设定。{{标签名}} 引用前阶段的输出。最终注入指令只发给正文模型。"),
      h("div", { className: "dsh-sp-grid" }, ["rateMain", "ratePersonal", "rateErotic", "rateCuckold", "recallCount"].map(function (key) { return field(({ rateMain: "主线比率 sulv1", ratePersonal: "个人比率 sulv2", rateErotic: "亲密比率 sulv3", rateCuckold: "冲突比率 sulv4", recallCount: "召回数量 zhaohui" })[key], draft[key], function (v) { patch({ [key]: Number(v) }); }); }))),
    h("details", null, h("summary", null, "试运行已保存的推进预设"),
      h("p", null, "将当前剧情、可发送的表格及这里填写的测试输入发给所选模型。结果保存在预览中，不新增正文或修改表格。"),
      field("推进测试输入", previewInput, setPreviewInput, 3),
      button("试运行召回与推进", function () { props.run(function () { return props.api("previewSpPlot", { userText: previewInput }); }, "推进预览已保存"); }, !unchanged || !previewInput.trim()),
      h("button", { className: "dsh-tavern-btn", disabled: !activity || activity.status !== "running", onClick: function () { props.api("cancelSpPlot", {}).catch(props.onError); } }, "停止召回与推进")),
    activity ? h("p", { role: activity.status === "failed" ? "alert" : "status" }, "召回与推进：" + ({ running: "运行中", completed: "完成", failed: "失败", cancelled: "已停止" }[activity.status] || activity.status) + (activity.task ? " · " + activity.task : "") + (activity.error ? " · " + activity.error : "")) : null,
    result ? h("details", null, h("summary", null, "最近推进结果 · " + result.presetName), h("pre", { className: "dsh-sp-result" }, result.text),
      (result.warnings || []).map(function (w, i) { return h("p", { key: i }, w); })) : null,
    button("保存全部推进修改", function () { props.settings({ plotPreset: draft }); }, unchanged),
    button("将本局数据库设置设为新局默认", function () { props.run(async function () { refresh(await props.api("saveSpDatabaseDefaults", { settings: settings })); }, "已保存新局默认设置，已有各局保持自己的设置"); }, !unchanged));
}

function createMigrationWorkbenchFeature() {
  function Workbench(props) {
            const askConfirm = useTavernConfirm([props.sessionId,props.scope?.sessionId,props.cardPath,props.path,props.card?.path,props.view?.card?.path,props.record?.source?.path,props.record?.source?.cardPath].join("\n"));
    const h = React.createElement, sessionId = props.scope.sessionId;
    const presetOnly = props.floating && props.initialPage === 'preset';
    const live = useLiveTavernView(sessionId);
    const [page, setPage] = React.useState(props.initialPage || "dashboard");
    const [database, setDatabase] = React.useState(null);
    const [controls, setControls] = React.useState(null);
    const [modelCatalog, setModelCatalog] = React.useState([]);
    const [plotDirty, setPlotDirty] = React.useState(false);
    const [sheetKey, setSheetKey] = React.useState("");
    const [draft, setDraft] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const [filter, setFilter] = React.useState("");
    const [planName, setPlanName] = React.useState("");
    const [tableName, setTableName] = React.useState("");
    const [headers, setHeaders] = React.useState("名称,状态");
    const [promptDraft, setPromptDraft] = React.useState("");
    const [inspiration, setInspiration] = React.useState("");
    const [inspirationRequest, setInspirationRequest] = React.useState("结合当前人物、事件和未完成任务，给出三条可以继续发展的剧情建议。");
    const [companions, setCompanions] = React.useState(null);
    const [templatePreview,setTemplatePreview]=React.useState(null),[templateMode,setTemplateMode]=React.useState('preserve'),[templateDraft,setTemplateDraft]=React.useState('');
    const [advancedMode,setAdvancedMode]=React.useState(()=>tavernPreferenceStorage('getItem','dsh-tavern.database-mode')!=='basic');
    const [templateName, setTemplateName] = React.useState("");
    const [templateWithData, setTemplateWithData] = React.useState(false);
    const [sqlText, setSqlText] = React.useState("");
    const [sqlResult, setSqlResult] = React.useState(null);
    const [tableConfig, setTableConfig] = React.useState("");
    const templateInput = React.useRef(null);
    const editingTemplate = React.useRef(null);
    const fileInput = React.useRef(null), configInput = React.useRef(null);
    const active = React.useRef(sessionId), dirty = React.useRef(false);
    const requests = React.useRef(0), acceptedDatabase = React.useRef(null);
    const panelQueries = React.useRef(new Map());
    React.useEffect(function () {
      panelQueries.current.clear();
      if(presetOnly)return;
      const invalidate = () => panelQueries.current.clear();
      window.addEventListener('dsh-tavern-data-changed', invalidate); window.addEventListener('focus', invalidate);
      return () => { invalidate(); window.removeEventListener('dsh-tavern-data-changed', invalidate); window.removeEventListener('focus', invalidate); };
    }, [sessionId,presetOnly]);
    async function panelApi(method, args) {
      if (!['getSpDashboard','getSpFillWorldbooks'].includes(method)) return rpc(method, args, sessionId);
      const key = JSON.stringify([sessionId,method,args,database?.revision,database?.activity]);
      let cached = panelQueries.current.get(key);
      if (!cached || Date.now()-cached.at>30000) {
        cached = { at:Date.now(), task:Promise.resolve().then(() => rpc(method,args,sessionId)) }; panelQueries.current.set(key,cached);
        while(panelQueries.current.size>6)panelQueries.current.delete(panelQueries.current.keys().next().value);
        cached.task.catch(() => {if(panelQueries.current.get(key)===cached)panelQueries.current.delete(key)});
      }
      return structuredClone(await cached.task);
    }

    active.current = sessionId;
    React.useEffect(function () { if (props.onDirty) props.onDirty(Boolean(draft) || plotDirty || busy || Boolean(templateDraft)); return function () { if (props.onDirty) props.onDirty(false); }; }, [draft, plotDirty, busy, templateDraft]);
    const inPlay = live.view && ["story", "script"].includes(live.view.mode);
    const keys = database ? Object.keys(database.data).filter(function (key) { return key.startsWith("sheet_"); }).sort(function (a, b) { return (database.data[a].orderNo || 0) - (database.data[b].orderNo || 0); }) : [];
    const key = keys.includes(sheetKey) ? sheetKey : keys[0];
    const table = draft && draft.key === key ? draft.value : database && database.data[key];
    const lock = database && database.locks[key] || {};
    function acceptDatabase(value) {
      const previous = acceptedDatabase.current;
      if (previous && previous.basis?.branch === value.basis?.branch && previous.basis?.story === value.basis?.story && Number(value.revision) < Number(previous.revision)) return false;
      acceptedDatabase.current = value; setDatabase(value); setInspiration(value.inspiration?.text || ''); return true;
    }
    async function reload() {
      if (presetOnly) return;
      const sid = sessionId, request = ++requests.current;
      try {
        const result = await rpc("getSpDatabase", {}, sid);
        if (active.current !== sid || request !== requests.current) return;
        if (!dirty.current) acceptDatabase(result.database);
      } catch (error) { if (active.current === sid && request === requests.current) setError(String(error.message || error)); }
    }
    React.useEffect(function () {
      dirty.current = false; setDatabase(null); setControls(null); setDraft(null); setError(""); setNotice(""); setBusy(false); setInspiration("");
      requests.current++; acceptedDatabase.current = null;
      if (presetOnly) return;
      let disposed = false;
      rpc("getMigrationConfiguration", {}, sessionId).then(function (result) { if (!disposed) setCompanions(result.configuration); }, function (error) { if (!disposed) setError(error.message); });
      return function () { disposed = true; };
    }, [sessionId,presetOnly]);
    React.useEffect(function () {
      if (!inPlay || presetOnly) return;
      let disposed = false;
      rpc("getTavernSettings", {}).then(function (result) { if (!disposed) setModelCatalog(result.modelCatalog || []); }, function (error) { if (!disposed) setError(error.message); });
      return function () { disposed = true; };
    }, [inPlay,presetOnly]);
    React.useEffect(function () { if (!busy || !inPlay || presetOnly) return; const timer = setInterval(reload, 1200); return function () { clearInterval(timer); }; }, [busy, inPlay, sessionId,presetOnly]);
    const updateKey = live.view && JSON.stringify([live.view.spDatabase, live.view.presetControls && live.view.presetControls.version]);
    React.useEffect(function () {
      if (!inPlay) return;
      reload();
      setControls(live.view.presetControls || null);
    }, [sessionId, inPlay, updateKey]);

    async function run(work, message) {
      if (busy) return;
      const sid = sessionId;
      requests.current++;
      setBusy(true); setError(""); setNotice("");
      try {
        const result = await work();
        if (active.current !== sid) return result;
        requests.current++;
        if (result && result.database) { dirty.current = false; setDraft(null); acceptedDatabase.current=null; acceptDatabase(result.database); }
        if (result && result.controls) setControls(result.controls);
        if (message && !result?.cancelled && !(database && database.settings.toastMuteEnabled && /已保存|已更新/.test(String(message)))) setNotice(typeof message === "function" ? message(result) : message);
        return result;
      } catch (error) { if (active.current === sid) { setError(String(error.message || error)); if (!dirty.current && /剧情或表格已变化|表格已被其他操作/.test(String(error.message))) await reload(); } }
      finally { if (active.current === sid) setBusy(false); }
    }
    function update(command, message) {
      if (dirty.current && !(command.kind === "operations" && command.operations.length === 1 && command.operations[0].kind === "replace-sheet")) { setError("请先保存或放弃当前表格编辑"); return; }
      return run(function () { return database.authority?.owner==='original'?requestTavernSpPanelCommand(sessionId,{kind:'mutate',command,expectedRevision:database.basis||database.revision}):rpc("updateSpDatabase", { command: command, expectedRevision: database.basis || database.revision }, sessionId); }, message || "已保存");
    }
    function changeControl(operation) {
      return run(function () { return rpc("changeGamePresetControls", { operation: operation, expectedVersion: controls.version }, sessionId); }, "已更新本局设置，下轮生效");
    }
    function changeCell(row, col, value) {
      if (!table) return;
      const next = JSON.parse(JSON.stringify(table));
      next.content[row][col] = value;
      dirty.current = true; setDraft({ key: key, value: next });
    }
    function exportJson(name, data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = name; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    async function importTables(file) {
      if (!file) return;
      await run(async function () {
        const data = JSON.parse(await file.text());
        return await rpc("importSpTableData", { data: data, expectedRevision: database.basis || database.revision }, sessionId);
      }, "已导入表格，并保存导入前快照");
    }
    async function importCompanions(file) {
      if (!file) return;
      await run(async function () {
        const result = await rpc("importMigrationConfiguration", { payload: await parseTextResourceFile(file) }, sessionId);
        if (active.current !== sessionId) return;
        const current = await rpc("getMigrationConfiguration", {}, sessionId);
        if (active.current !== sessionId) return;
        setCompanions(current.configuration);
        setNotice("已导入 " + result.imported.regexCount + " 条正则；配套功能：" + (result.imported.companions.join("、") || "无新增") + (result.imported.unsupported.length ? "。尚未适配：" + result.imported.unsupported.join("、") : "") + "。新开的一局生效。");
        notifyTavernDataChanged(["presets", "sessions"], "migration");
      });
    }
    function button(label, onClick, disabled) { return h("button", { key: label, type: "button", className: "dsh-tavern-btn", disabled: busy || disabled, onClick: onClick }, label); }
    function checkbox(label, checked, onChange) { return h("label", { className: "dsh-migration-check" }, h("input", { type: "checkbox", checked: Boolean(checked), disabled: busy || dirty.current, onChange: function (event) { onChange(event.target.checked); } }), label); }
    function setLocks(patch) { return update({ kind: "locks", sheet: key, value: Object.assign({}, lock, patch) }); }
    function settings(patch) { return update({ kind: "settings", patch: patch }); }
    function tablePage() {
      if (!database) return h("p", null, "读取本局数据库…");
      const activity = database.activity;
      return h(React.Fragment, null,
        database.authority?.owner==='original'?h('p',{role:'status'},'SP 原包唯一写入，当前为宿主只读缓存。面板编辑经原包 API；原包未就绪时仅可查看缓存，请恢复原包后再编辑。'):null,
        h("div", { className: "dsh-migration-toolbar" }, button("导入 SP 表格 JSON", function () { fileInput.current.click(); }, dirty.current),
          button("导出表格", function () { exportJson("SP-database.json", database.data); }),
          button("手动填表", function () { run(function () { return database.authority?.owner==='original'?requestTavernSpPanelCommand(sessionId,{kind:'fill'}):rpc("fillSpDatabase", {}, sessionId); }, function (result) { return result.database?.activity?.status === "cancelled" ? "填表已停止" : "填表完成"; }); }, dirty.current),
          h("button", { type: "button", className: "dsh-tavern-btn", disabled: !activity || activity.status !== "running", onClick: function () { rpc("cancelSpDatabaseFill", {}, sessionId).then(function () { setNotice("已请求停止填表"); }, function (error) { setError(error.message); }); } }, "停止填表"),
          button("保存快照", function () { update({ kind: "snapshot", name: "手动快照" }); }, dirty.current),
          h("input", { ref: fileInput, type: "file", accept: ".json", hidden: true, onChange: function (event) { importTables(event.target.files[0]); event.target.value = ""; } })),
        activity ? h("p", { role: activity.status === "failed" ? "alert" : "status" }, "填表：" + ({ running: "进行中", completed: "完成", cancelled: "已停止", failed: "失败", interrupted: "已中断" }[activity.status] || activity.status) + (activity.error ? " · " + activity.error : "")) : null,
        activity && activity.retrying && activity.status === "running" ? h("p", { role: "status" }, "正在修正填表结果，第 " + activity.attempt + " 次尝试") : null,
        activity && activity.rejectedOutput ? h("details", null, h("summary", null, "查看未通过验证的填表结果"), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, activity.rejectedOutput)) : null,
        h("div", { className: "dsh-migration-toolbar" },
          checkbox("自动填表", database.settings.autoFill, function (value) { settings({ autoFill: value }); }),
          checkbox("发送数据库记忆", database.settings.recallEnabled, function (value) { settings({ recallEnabled: value }); }),
          h("label", null, "每 ", h("input", { type: "number", min: 1, max: 1000, className: "dsh-migration-number", value: database.settings.updateFrequency, disabled: busy, onChange: function (event) { const value = Number(event.target.value); if (value > 0) settings({ updateFrequency: value }); } }), " 轮填表")),
        h("div", { className: "dsh-migration-table-tabs" }, keys.map(function (item) { return button(database.data[item].name, function () { if (dirty.current) { setError("请先保存或放弃当前表格编辑"); return; } setSheetKey(item); setTableConfig(""); setPromptDraft(""); }, false); })),
        table ? h(React.Fragment, null,
          h("div", { className: "dsh-migration-toolbar" }, h("strong", null, table.name),
            checkbox("锁定整表", lock.table, function (value) { setLocks({ table: value }); }),
            button("新增行", function () { update({ kind: "operations", operations: [{ kind: "insert", sheet: key, values: table.content[0].map(function (_, index) { return index === 0 ? null : ""; }) }] }); }, dirty.current || lock.table),
            button("保存表格", function () { update({ kind: "operations", operations: [{ kind: "replace-sheet", sheet: key, value: draft.value }] }); }, !draft),
            button(draft ? "放弃编辑并刷新" : "刷新表格", function () { dirty.current = false; setDraft(null); reload(); })),
          h("div", { className: "dsh-migration-table-scroll" }, h("table", { className: "dsh-migration-table" },
            h("thead", null, h("tr", null, table.content[0].map(function (name, col) {
              return h("th", { key: col }, name, checkbox("锁列", (lock.columns || []).includes(col), function (value) {
                setLocks({ columns: value ? (lock.columns || []).concat([col]) : (lock.columns || []).filter(function (item) { return item !== col; }) });
              }));
            }), h("th", null, "操作"))),
            h("tbody", null, table.content.slice(1).map(function (row, index) {
              const rowLocked = (lock.rows || []).includes(String(row[0]));
              return h("tr", { key: String(row[0]) + ":" + index },
                row.map(function (cell, col) { return h("td", { key: col }, h("textarea", { rows: 2, "aria-label": table.name + " · 第" + (index + 1) + "行 · " + table.content[0][col], value: cell === null ? "" : String(cell),
                  disabled: busy || lock.table || rowLocked || (lock.columns || []).includes(col) || (lock.cells || []).includes(String(row[0]) + ":" + col),
                  onChange: function (event) { changeCell(index + 1, col, event.target.value); } }),
                  checkbox("锁格", (lock.cells || []).includes(String(row[0]) + ":" + col), function (value) {
                    const id = String(row[0]) + ":" + col;
                    setLocks({ cells: value ? (lock.cells || []).concat([id]) : (lock.cells || []).filter(function (item) { return item !== id; }) });
                  })); }),
                h("td", null, checkbox("锁行", rowLocked, function (value) { setLocks({ rows: value ? (lock.rows || []).concat([String(row[0])]) : (lock.rows || []).filter(function (item) { return item !== String(row[0]); }) }); }),
                  button("删行", function () { update({ kind: "operations", operations: [{ kind: "delete", sheet: key, row: index + 1 }] }); }, dirty.current || lock.table || rowLocked)));
            })))),
          h("details", null, h("summary", null, "填写说明与表格设置"), h("p", null, table.sourceData && table.sourceData.note || "未设置填写说明"),
            checkbox("发送这张表", table.exportConfig && table.exportConfig.enabled !== false, function (value) { update({ kind: "operations", operations: [{ kind: "configure", sheet: key, patch: { exportConfig: Object.assign({}, table.exportConfig, { enabled: value }) } }] }); }),
            button("载入填写说明", function () { setPromptDraft(table.sourceData && table.sourceData.note || ""); }),
            h("textarea", { rows: 5, value: promptDraft, placeholder: "输入新的表格填写说明", onChange: function (event) { setPromptDraft(event.target.value); } }),
            button("保存填写说明", function () { update({ kind: "operations", operations: [{ kind: "configure", sheet: key, patch: { sourceData: Object.assign({}, table.sourceData, { note: promptDraft }) } }] }); }, dirty.current)),
          h("details", null, h("summary", null, "高级表格配置"), h("p", null, "可编辑表名、填写说明、DDL、更新配置和召回配置；未修改的字段会保留。"),
            button("载入配置", function () { setTableConfig(JSON.stringify({ name: table.name, sourceData: table.sourceData || {}, updateConfig: table.updateConfig || {}, exportConfig: table.exportConfig || {}, orderNo: table.orderNo || 0 }, null, 2)); }),
            h("textarea", { rows: 12, value: tableConfig, placeholder: "先载入本表配置", onChange: function (event) { setTableConfig(event.target.value); } }),
            button("保存高级配置", function () {const patch=JSON.parse(tableConfig);update({kind:'operations',operations:[{kind:'configure',sheet:key,patch}]},'表格配置已保存'); }, !tableConfig.trim() || dirty.current))) : null,
        h("details", null, h("summary", null, "新增表格"), h("input", { value: tableName, placeholder: "表格名称", onChange: function (event) { setTableName(event.target.value); } }),
          h("input", { value: headers, placeholder: "列名，用逗号分隔", onChange: function (event) { setHeaders(event.target.value); } }),
          button("创建", function () { update({ kind: "operations", operations: [{ kind: "create", sheet: { name: tableName.trim(), content: [["row_id"].concat(headers.split(/[,，]/).map(function (value) { return value.trim(); }).filter(Boolean))], exportConfig: { enabled: true }, sourceData: { note: "" } } }] }); }, !tableName.trim() || dirty.current)),
        h("details", null, h("summary", null, "快照与恢复 · " + database.snapshots.length), database.snapshots.slice().reverse().map(function (snapshot) {
          return h("div", { key: snapshot.id, className: "dsh-migration-toolbar" }, h("span", null, snapshot.name + " · " + new Date(snapshot.at).toLocaleString()),
            button("恢复", function () { update({ kind: "restore", id: snapshot.id }, "已恢复，并保留恢复前快照"); }, dirty.current));
        })));
    }
    function presetPage() {
      if (!controls) return h("p", null, "读取本局预设…");
      return h(React.Fragment, null, h("h3", null, controls.name), h("p", null, "默认跟随预设库更新。这里修改的是显式本局覆盖，从下一轮生效；其他局继续跟随共享设置。"),
        h('label',null,'预设版本',h('select',{'aria-label':'本局预设版本模式',value:controls.resourceMode||'follow',disabled:busy,onChange:event=>run(()=>rpc('setGameResourceMode',{selection:{kind:'preset',mode:event.target.value},expectedRevision:controls.configRevision},sessionId),'资源版本模式已更新')},h('option',{value:'follow'},'跟随共享版本'),h('option',{value:'pinned'},'固定本局当前版本'))),
        h('p',{role:'status'},controls.scope==='local'?'当前有本局覆盖':'当前使用共享条目的设置'),
        (controls.warnings||[]).map((text,index)=>h('p',{role:'alert',key:index},text)),
        h("div", { className: "dsh-migration-toolbar" }, checkbox("Advice 剧情引导", controls.advice, function (value) { changeControl({ kind: "advice", enabled: value }); }),
          checkbox("多彩输入展示", controls.colorful, function (value) { changeControl({ kind: "colorful", enabled: value }); })),
        h("div", { className: "dsh-migration-toolbar" }, h("input", { value: planName, placeholder: "方案名称", onChange: function (event) { setPlanName(event.target.value); } }),
          button("保存当前方案", function () { changeControl({ kind: "save-plan", name: planName }); }, !planName.trim()),
          button("清除本局覆盖", function () { changeControl({ kind: "reset" }); })),
        controls.plans.map(function (plan) { return h("div", { key: plan.id, className: "dsh-migration-toolbar" }, h("span", null, plan.name),
          button("应用", function () { changeControl({ kind: "apply-plan", id: plan.id }); }), button("删除方案", async function () { if((await askConfirm('删除此方案？库中不保留副本。')))changeControl({ kind: "delete-plan", id: plan.id }); })); }),
        h("input", { value: filter, placeholder: "查找提示词或正则", onChange: function (event) { setFilter(event.target.value); } }),
        ["entries", "regexes"].map(function (field) { return h("details", { key: field, open: true }, h("summary", null, (field === "entries" ? "提示词" : "正则") + " · " + controls[field].length),
          controls[field].filter(function (item) { return item.name.includes(filter); }).map(function (item) { return h("div", { key: item.key },
            checkbox(item.name, item.enabled, function (enabled) { changeControl({ kind: field === "entries" ? "entry" : "regex", key: item.key, enabled: enabled }); })); })); }));
    }
    function importPage() {
      return h(React.Fragment, null, h("p", null, "Izumi 预设使用原有预设库导入。这里导入独立的全局正则、可视化前端或状态栏 JSON，识别后使用对应的原生功能。"),
        button("导入配套 JSON", function () { configInput.current.click(); }),
        h("input", { ref: configInput, type: "file", accept: ".json", hidden: true, onChange: function (event) { importCompanions(event.target.files[0]); event.target.value = ""; } }),
        companions ? h("div", null, h("p", null, "全局正则：" + (companions.regexScripts || []).length),
          (companions.companions || []).map(function (item) { return h("p", { key: item.adapter }, item.name + " → " + (item.adapter === "database-workbench" ? "表格工作台" : "状态与灵感")); }),
          h("p", null, "全局导入影响新开的一局。当前局的表格使用“表格”页导入。")) : null);
    }
    function templatePage() {
      if(companions?.templateOwner==='original')return h('section',null,h('h3',null,'表格模板'),h('p',null,'模板由原版 SP 管理。删除、重命名、导出及新局默认选择均在同一目录完成。'),button('打开原版 SP 模板目录',()=>requestTavernScriptUi({sessionId,kind:'extension-sp-database'})));
      const templates = companions && companions.templates || [];
      return h(React.Fragment, null,
        h("h3",null,"表格模板"),h("p",null,"当前局："+(database?.template?.name||"开局模板 / 本局自定义表格")),
        h("p",null,"设为默认影响新局；切换本局会先保存快照。保留数据按表身份或唯一表名匹配，再按列名迁移；移出的表与字段可从快照恢复。"),
        h('label',null,'本局切换方式',h('select',{'aria-label':'本局切换方式',value:templateMode,onChange:e=>{setTemplateMode(e.target.value);setTemplatePreview(null)}},h('option',{value:'preserve'},'保留匹配表数据'),h('option',{value:'replace'},'使用模板初始数据'))),
        h("input", { value: templateName, placeholder: "模板名称", onChange: function (event) { setTemplateName(event.target.value); } }),
        checkbox("包含初始数据", templateWithData, setTemplateWithData),
        button("导入模板 JSON", function () { templateInput.current.click(); }, !templateName.trim()),
        button("将本局表格存为模板", function () { saveTemplate(database.data); }, !templateName.trim() || !database || dirty.current),
        h("input", { ref: templateInput, type: "file", accept: ".json", hidden: true, onChange: function (event) {
          const file = event.target.files[0]; event.target.value = "";
          if (file) run(async function () { return await writeTemplate(JSON.parse(await file.text())); }, "模板已保存，请按需选用");
        } }),
        button("新局使用默认表格", function () { changeTemplate("selectSpTemplate", { id: "" }); }),
        templates.map(function (item) {
          return h("div", { key: item.id, className: "dsh-migration-toolbar" }, h("strong", null, item.name + (item.selected ? " · 新局使用" : "")),
            button("设为新局默认", function () { changeTemplate("selectSpTemplate", { id: item.id }); }, item.selected),
            button("预览切换本局 · "+item.name,()=>run(async()=>{const result=await rpc('previewSpChatTemplate',{id:item.id,mode:templateMode},sessionId);setTemplatePreview(result.preview);}),!database||dirty.current),
            button("编辑模板 · "+item.name,()=>{editingTemplate.current=item;setTemplateName(item.name);setTemplateWithData(item.withData);setTemplateDraft(JSON.stringify(item.data,null,2));}),
            button("导出", function () { exportJson(item.name + ".json", item.data); }),
            button("删除模板", async function () { if(!(await askConfirm('删除模板“'+item.name+'”？库中不保留副本，已有对话保留。')))return;changeTemplate("deleteSpTemplate", { id: item.id }); }));
        }),
        templatePreview?h('section',{className:'dsh-sp-card','aria-label':'本局模板切换预览'},h('h4',null,'切换为 '+templatePreview.name),
          templatePreview.summary.map(t=>h('p',{key:t.key},t.name+'：'+t.rows+' 行，保留 '+t.retained+' 行'+(t.removedColumns.length?'；移出列 '+t.removedColumns.join('、'):''))),
          templatePreview.archived.map(t=>h('p',{key:t.key},'移入切换前快照：'+t.name+' · '+t.rows+' 行')),
          button('切换本局模板',()=>run(async()=>{const result=await rpc('applySpChatTemplate',{id:templatePreview.id,updatedAt:templatePreview.updatedAt,mode:templatePreview.mode,expectedRevision:templatePreview.basis},sessionId);setTemplatePreview(null);return result;},'已切换模板，切换前的数据可在数据管理中恢复')),
          button('取消切换',()=>setTemplatePreview(null))):null,
        templateDraft?h('section',{className:'dsh-sp-card'},h('h4',null,'编辑模板内容'),h('textarea',{'aria-label':'模板内容 JSON',rows:15,value:templateDraft,onChange:e=>setTemplateDraft(e.target.value)}),
          h('p',null,'修改名称会重命名当前模板；同名冲突或其他窗口已保存的新版本不会被覆盖。'),
          button('保存模板编辑',()=>run(async()=>{const result=await writeTemplate(JSON.parse(templateDraft),true);setTemplateDraft('');editingTemplate.current=null;return result;},'模板库已保存；点击预览切换可应用到本局')),
          button('放弃模板编辑',()=>{setTemplateDraft('');editingTemplate.current=null})) : null);
    }
    async function writeTemplate(data, editing = false) {
      const target = editing ? editingTemplate.current : (companions?.templates || []).find(item => item.name === templateName.trim());
      if (target && !editing && !(await askConfirm('覆盖已有模板“'+target.name+'”？模板库中的旧内容将被替换，已有游戏保留。'))) return { cancelled: true };
      const result = await rpc("saveSpTemplate", { name: templateName, data: data, withData: templateWithData, ...(target ? { id: target.id, expectedUpdatedAt: target.updatedAt } : {}) }, sessionId);
      if (active.current === sessionId) setCompanions(function (previous) { return Object.assign({}, previous, { templates: result.templates }); });
      return result;
    }
    function saveTemplate(data) { return run(function () { return writeTemplate(data); }, "模板已保存，请按需选用"); }
    function changeTemplate(method, args) {
      return run(async function () {
        const result = await rpc(method, args, sessionId);
        if (active.current === sessionId) setCompanions(function (previous) { return Object.assign({}, previous, { templates: result.templates }); });
      }, "已更新新局的模板设置");
    }
    function sqlPage() {
      if (!database) return h("p", null, "读取本局数据库…");
      return h(React.Fragment, null,
        h("p", null, "查询使用 SELECT；写入使用 INSERT、UPDATE、DELETE。写入成功前会保存快照，表格锁仍然生效。"),
        h("details", null, h("summary", null, "表名和列名"), keys.map(function (item) {
          const sheet = database.data[item];
          return h("pre", { key: item }, sheet.name + " · " + item + "\n" + (sheet.sourceData && sheet.sourceData.ddl || sheet.content[0].join(", ")));
        })),
        h("textarea", { rows: 8, value: sqlText, placeholder: "SELECT * FROM sheet_state", onChange: function (event) { setSqlText(event.target.value); } }),
        button("运行查询", function () { run(async function () {
          const result = await rpc("querySpDatabase", { sql: sqlText }, sessionId);
          if (active.current === sessionId) setSqlResult(result);
        }); }, !sqlText.trim() || dirty.current),
        button("执行修改并保存", function () { update({ kind: "sql", sql: sqlText }, "SQL 修改已保存，可从快照恢复"); }, !sqlText.trim() || dirty.current),
        sqlResult ? h("div", null, h("p", null, "返回 " + sqlResult.rows.length + " 行" + (sqlResult.limited ? "（最多显示 2000 行）" : "")),
          h("div", { className: "dsh-migration-table-scroll" }, h("table", { className: "dsh-migration-table" },
            h("thead", null, h("tr", null, Object.keys(sqlResult.rows[0] || {}).map(function (key) { return h("th", { key: key }, key); }))),
            h("tbody", null, sqlResult.rows.map(function (row, index) { return h("tr", { key: index }, Object.keys(row).map(function (key) { return h("td", { key: key }, String(row[key] === null ? "" : row[key])); })); }))))) : null);
    }
    function settingsPage() {
      return h(SpFillRules,{sessionId,database,catalog:modelCatalog,busy,run,settings,exportJson,onDirty:setPlotDirty,api:panelApi,tableRules:nested=>h(React.Fragment,null,h('select',{disabled:nested.dirty,'aria-label':'填写规则表格',value:key,onChange:e=>setSheetKey(e.target.value)},keys.map(k=>h('option',{key:k,value:k},database.data[k].name))),key?h(SpTableRuleEditor,{key:key,table:database.data[key],busy:busy||nested.disabled,onDirty:nested.onDirty,onSave:patch=>update({kind:'operations',operations:[{kind:'configure',sheet:key,patch}]},'本表填写规则已保存')}):null)});
    }

    function advancedPanel(tab) {return database?h(SpAdvancedPanel,{key:sessionId+':'+tab,initialTab:tab,embedded:true,sessionId,database,catalog:modelCatalog,busy,run,settings,exportJson,onDirty:setPlotDirty,onError:e=>setError(e.message),api:(method,args)=>rpc(method,args,sessionId)}):h('p',null,'读取数据库…');}
    function apiPage() {
      if(!database)return h('p',null,'读取 API 配置…');
      return h('section',{'aria-label':'数据库 API'},h('h3',null,'API'),h('p',null,'分别选择填表、召回和推进的连接与模型。连接地址和密钥由酒馆的模型设置管理；选择后从下一次调用生效。'),
        [['fillModel','填表 API / 模型'],['recallModel','召回 API / 模型'],['plotModel','推进 API / 模型']].map(([key,label])=>h(MigrationModelPicker,{key,label,catalog:modelCatalog,value:database.settings[key],disabled:busy,onChange:value=>settings({[key]:value})})),
        h('p',null,'推进预设中的任务可以再指定模型；任务留空时使用上方对应模型。'),button('编辑召回与推进任务',()=>setPage('plot')),button('Embedding / Rerank 设置',()=>setPage('vector')));
    }
    function fillPage() {
      return h(SpFillWorkbench,{sessionId,database,catalog:modelCatalog,busy,run,settings,reload,navigate,renderTemplate:templatePage,onDirty:setPlotDirty,api:panelApi});
    }

    function dataPage(){return h(SpDatabaseDataManager,{database,busy,update,importTables,reload,exportJson,onDirty:setPlotDirty,api:panelApi})}
    function inspirationPage() {
      return h(React.Fragment, null, h("h3", null, "状态与灵感"),
        database ? keys.map(function (key) {
          const table = database.data[key];
          return h("details", { key: key, open: true }, h("summary", null, table.name),
            table.content.length === 1 ? h("p", null, "暂无记录") : table.content.slice(1).map(function (row, index) { return h("p", { key: index }, table.content[0].map(function (header, col) { return header + "：" + String(row[col] === null ? "" : row[col]); }).join(" · ")); }));
        }) : null,
        h("textarea", { rows: 3, value: inspirationRequest, onChange: function (event) { setInspirationRequest(event.target.value); } }),
        button("生成灵感", function () { run(function () { return rpc("generateSpInspiration", { prompt: inspirationRequest }, sessionId); }, function (result) { return result.database.inspiration.status === "cancelled" ? "灵感已停止" : "灵感已保存"; }); }, !inspirationRequest.trim()),
        h("button", { type: "button", className: "dsh-tavern-btn", disabled: !busy && !(database && database.inspiration && database.inspiration.status === "running"), onClick: function () { rpc("cancelSpInspiration", {}, sessionId).then(function () { setNotice("已请求停止灵感生成"); }, function (error) { setError(error.message); }); } }, "停止生成灵感"),
        database && database.inspiration ? h("p", { role: database.inspiration.status === "failed" ? "alert" : "status" }, "灵感：" + ({ running: "生成中", completed: "已保存", cancelled: "已停止", failed: "失败", interrupted: "已中断" }[database.inspiration.status] || database.inspiration.status) + (database.inspiration.error ? " · " + database.inspiration.error : "")) : null,
        inspiration ? h("div", { className: "dsh-migration-inspiration" }, h(TavernColoredMarkdown, { text: inspiration }),
          button("追加到输入框", function () { migrationHost.appendInput(sessionId, inspiration); })) : null);
    }
    if(props.floating&&props.initialPage==='preset')return h(IzumiFloatingPanel,{sessionId,controls,busy,error,notice,change:changeControl});
    function navigate(next){if((plotDirty||dirty.current||templateDraft)&&next!==page){setError('请先保存或放弃当前编辑');return}setPage(next);setError('')}
    const activePage=advancedMode?page:'basic';
    const subPages=['templates','tables'].includes(activePage)?[['fill','返回填表工作台'],['templates','表格模板'],['tables','表格编辑器']]:activePage==='fill'?[['templates','表格模板'],['tables','表格编辑器']]:['advanced','sql','logs'].includes(activePage)?[['advanced','高级工具'],['sql','SQL 控制台'],['logs','运行日志']]:[];
    let content=!inPlay?h('p',null,'请先进入游玩对话。'):!database?h('p',null,'读取数据库…'):
      activePage==='basic'?advancedPanel('overview'):activePage==='dashboard'?advancedPanel('overview'):activePage==='api'?apiPage():activePage==='fill'?fillPage():activePage==='data'?dataPage():activePage==='templates'?templatePage():activePage==='tables'?tablePage():activePage==='settings'?settingsPage():activePage==='sql'?sqlPage():
      activePage==='plot'?h(SpPlotEditor,{sessionId,database,catalog:modelCatalog,busy,run,settings,exportJson,onDirty:setPlotDirty,onError:e=>setError(e.message),api:panelApi}):advancedPanel(activePage==='advanced'?'utilities':activePage);
    return h(SpDatabaseFrame,{sessionId,page:activePage,advanced:advancedMode,navigate,onMode:()=>{if(plotDirty||dirty.current||templateDraft){setError('请先保存或放弃当前编辑');return}setAdvancedMode(!advancedMode);tavernPreferenceStorage('setItem','dsh-tavern.database-mode',advancedMode?'basic':'advanced');if(!advancedMode)setPage('dashboard')}},
      error?h('p',{role:'alert',className:'dsh-sp-notice'},error):null,notice?h('p',{role:'status',className:'dsh-sp-notice'},notice):null,
      subPages.length?h('nav',{className:'dsh-sp-subnav','aria-label':'数据库子栏目'},subPages.map(([id,title])=>button(title,()=>navigate(id)))):null,content);

  }
  return { register: function (input) {
    const ctx = input.ctx;
    ctx.effect(function () {
      return input.slots.inject('conversation.input.left', function () { return input.slots.register({ name: 'conversation.input.left', id: 'dsh-tavern-composer-owner', order: -999 }, function (props) {
        return React.createElement('span', { hidden: true, 'data-dsh-tavern-composer-owner': props.sessionId });
      }); });
    }, 'dsh-tavern: composer owner');
    ctx.effect(function () {
      return input.slots.inject("conversation.composer.dock", function () { return input.slots.register({ name: "conversation.composer.dock", id: "dsh-tavern-floating-workspace", order: -130 }, function (props) {
        return React.createElement(TavernFloatingWorkspace, { sessionId: props.sessionId, renderWorkbench: function (settings) { return React.createElement(Workbench, settings); } });
      }); });
    }, "dsh-tavern: floating workspace");
    ctx.effect(function () {
      const host = {
        executeSlash: createTavernFrameSlashExecutor(ctx),
        composerInput: function(sessionId){const scope=ctx.sessions.scope(sessionId),conversation=ctx.get('conversation');if(!scope||!conversation)throw new Error('当前对话输入框不可用');return conversation.input.for(scope);},
        composerRunning: function(sessionId){return ctx.sessions.list.getSnapshot().byId[sessionId]?.running===true;},
        stopComposer: function(sessionId){const scope=ctx.sessions.scope(sessionId),conversation=scope?.get('conversation');if(!conversation)throw new Error('当前会话停止入口不可用');return conversation.cancel();},
        composerRoot: function(sessionId){return Array.from(document.querySelectorAll('[data-dsh-tavern-composer-owner]')).find(node=>node.dataset.dshTavernComposerOwner===sessionId)?.closest('[data-composer-card]')||null;},
        appendInput: function (sessionId, text) {
          const scope = ctx.sessions.scope(sessionId), conversation = ctx.get("conversation");
          if (!scope || !conversation) throw new Error("当前对话输入框不可用");
          const input = conversation.input.for(scope), draft = String(input.state.getSnapshot().draft || "");
          input.setDraft(draft + (draft && !/\s$/.test(draft) ? "\n" : "") + String(text || ""));
        },
        continueTurn: async function (sessionId, text, signal) {
          const scope = ctx.sessions.scope(sessionId), conversation = ctx.get('conversation'), list = ctx.sessions.list;
          if (!scope || !conversation) throw new Error('当前对话输入框不可用');
          const input = conversation.input.for(scope);
          if (String(input.state.getSnapshot().draft || '').trim()) throw new Error('输入框已有草稿，请先处理草稿再开始续写');
          if (list.getSnapshot().byId[sessionId]?.running) throw new Error('请等当前生成完成');
          signal.throwIfAborted();
          const before = await rpc('getSession', {}, sessionId);
          await new Promise(function (resolve, reject) {
            let observed = false, finished = false, stop = function () {}, timer;
            function finish(error) { if (finished) return; finished = true; stop(); clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); }
            function abort() { finish(new Error('续写已停止')); }
            function inspect() { const value = list.getSnapshot().byId[sessionId]; if (!value) finish(new Error('当前对话已关闭')); else if (value.running) observed = true; else if (observed) finish(); }
            stop = list.subscribe(inspect); if(finished){stop();return;} signal.addEventListener('abort', abort, { once: true });
            timer = setTimeout(function () { finish(new Error('等待续写完成超时')); }, 900000);
            try { signal.throwIfAborted(); input.setDraft(text); Promise.resolve(input.submit('queue')).catch(finish); inspect(); } catch (e) { finish(e); }
          });
          const after = await rpc('getSession', {}, sessionId);
          const a = after.view || after, b = before.view || before;
          if (a.foregroundError || Number(a.latestAssistantTurn || 0) <= Number(b.latestAssistantTurn || 0)) throw new Error(a.foregroundError || '本轮未成功保存正文，已停止后续续写');
        },
        openDatabase: function (sessionId) { tavernFloatingWindows.open(sessionId, "database", "SP·数据库", "dashboard"); },
        openPlugin: function (sessionId, kind, title, page) { tavernFloatingWindows.open(sessionId, kind, title, page); }
      };
      migrationHost = host;
      const dispose = ctx.betterSidebar.registerTab({ id: "dsh-tavern:database", title: "数据库", order: 5, single: true,
        component: function (props) { return React.createElement(Workbench, { scope: props.scope }); } });
      return function () { if (migrationHost === host) migrationHost = null; if (typeof dispose === "function") dispose(); };
    }, "dsh-tavern: migration workbench");
  } };
}
const migrationWorkbenchFeature = createMigrationWorkbenchFeature();

function SpTableRuleEditor(props){
  const h=React.createElement,[draft,setDraft]=React.useState(props.table),dirty=JSON.stringify(draft)!==JSON.stringify(props.table);
  const draftBase=React.useRef(JSON.stringify(props.table));
  React.useEffect(()=>{if(JSON.stringify(draft)===draftBase.current)setDraft(props.table);draftBase.current=JSON.stringify(props.table)},[JSON.stringify(props.table)]);
  React.useEffect(()=>{props.onDirty(dirty);return()=>props.onDirty(false)},[dirty]);
  function field(group,key,label,type='text'){return h('label',{className:'dsh-sp-field'},label,h(type==='textarea'?'textarea':'input',{'aria-label':label,type:type==='textarea'?undefined:type,rows:type==='textarea'?5:undefined,value:draft[group]?.[key]??'',onChange:e=>setDraft({...draft,[group]:{...draft[group],[key]:type==='number'?Number(e.target.value):e.target.value}})}));}
  function toggle(group,key,label,defaultValue=true){return h('label',null,h('input',{type:'checkbox',checked:(draft[group]?.[key]??defaultValue)!==false,onChange:e=>setDraft({...draft,[group]:{...draft[group],[key]:e.target.checked}})}),label)}
  return h('fieldset',{disabled:props.busy,className:'dsh-sp-card','aria-label':'本表填写规则'},h('h4',null,draft.name),field('sourceData','note','表格填写说明','textarea'),
    toggle('updateConfig','enabled','允许自动更新本表'),field('updateConfig','updateFrequency','本表更新频率（-1 跟随全局，0 关闭自动更新）','number'),
    toggle('exportConfig','enabled','向正文发送本表'),h('label',null,'召回方式',h('select',{'aria-label':'本表召回方式',value:draft.exportConfig?.entryType||'selective',onChange:e=>setDraft({...draft,exportConfig:{...draft.exportConfig,entryType:e.target.value}})},h('option',{value:'constant'},'常驻发送'),h('option',{value:'selective'},'按相关性召回'))),
    field('sourceData','ddl','SQL 表结构（可留空自动生成）','textarea'),h('div',{className:'dsh-migration-toolbar'},h('button',{className:'dsh-tavern-btn',disabled:props.busy||!dirty,onClick:()=>props.onSave({sourceData:draft.sourceData||{},updateConfig:draft.updateConfig||{},exportConfig:draft.exportConfig||{}})},'保存本表填写规则'),h('button',{className:'dsh-tavern-btn',disabled:props.busy||!dirty,onClick:()=>setDraft(props.table)},'放弃规则修改')));
}

function IzumiFloatingPanel(props){
            const askConfirm = useTavernConfirm([props.sessionId,props.scope?.sessionId,props.cardPath,props.path,props.card?.path,props.view?.card?.path,props.record?.source?.path,props.record?.source?.cardPath].join("\n"));
  const h=React.createElement,[tab,setTab]=React.useState('entries'),[query,setQuery]=React.useState(''),[name,setName]=React.useState(''),[night,setNight]=React.useState(()=>tavernPreferenceStorage('getItem','dsh-tavern.izumi-night')==='true');
  const c=props.controls;React.useEffect(()=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/api/dsh-tavern/client-assets/izumi-original.css';document.head.appendChild(link);return()=>link.remove()},[]);
  function toggle(label,value,operation){return h('label',{className:'dsh-izumi-toggle'},h('input',{type:'checkbox',checked:value,disabled:props.busy,onChange:e=>props.change({...operation,enabled:e.target.checked})}),label)}
  return h('section',{id:'izumi-floating-window-v1-panel',className:'open dsh-izumi-panel'+(night?' night':''),'aria-label':'泉此方设置'},
    h('header',{className:'panel-header'},h('div',{className:'header-top'},h('div',{className:'header-title'},h('span',{className:'kicker'},'IZUMI / FLOATING WINDOW'),h('h2',null,'泉此方设置')),h('button',{className:'icon-btn',title:'夜间模式','aria-label':'Izumi 夜间模式',onClick:()=>{setNight(!night);tavernPreferenceStorage('setItem','dsh-tavern.izumi-night',String(!night))}},'☾')),
    h('div',{className:'header-bottom'},h('img',{src:'/api/dsh-tavern/client-assets/izumi-launcher.png',alt:'泉此方',width:56,height:56}),h('div',{className:'header-preset'},c?.name||'读取预设…'),c?toggle('Advice',c.advice,{kind:'advice'}):null)),
    props.error?h('p',{role:'alert'},props.error):null,props.notice?h('p',{role:'status'},props.notice):null,
    c?h(React.Fragment,null,h('div',{className:'dsh-izumi-body'},!c.izumi?h('p',null,'当前局未加载 Izumi 预设。导入并使用 Izumi 开局后，这里会显示它的提示词与正则。'):null,
      h('div',{className:'tabs'},[['entries','提示词',c.entries.length],['regexes','正则',c.regexes.length],['plans','方案',c.plans.length]].map(([key,label,count])=>h('button',{key,className:'tab','aria-selected':tab===key,onClick:()=>setTab(key)},label+' '+count))),
      tab==='plans'?h('div',null,h('input',{'aria-label':'Izumi 方案名称',placeholder:'方案名称',value:name,onChange:e=>setName(e.target.value)}),h('button',{className:'command',disabled:!name.trim()||props.busy,onClick:()=>props.change({kind:'save-plan',name})},'保存当前方案'),c.plans.map(plan=>h('div',{key:plan.id,className:'dsh-izumi-plan'},h('strong',null,plan.name),h('button',{className:'command',disabled:props.busy,onClick:()=>props.change({kind:'apply-plan',id:plan.id})},'应用'),h('button',{className:'command',disabled:props.busy,onClick:async ()=>{if((await askConfirm('删除此方案？库中不保留副本。')))props.change({kind:'delete-plan',id:plan.id})}},'删除')))):
      h('div',null,h('input',{'aria-label':'Izumi 查找条目',placeholder:'筛选名称',value:query,onChange:e=>setQuery(e.target.value)}),h('div',{className:'dsh-izumi-items'},c[tab].filter(item=>item.name.toLowerCase().includes(query.toLowerCase())).map(item=>h('div',{key:item.key,className:'dsh-izumi-item'},toggle(item.name,item.enabled,{kind:tab==='entries'?'entry':'regex',key:item.key}))))),
      h('footer',null,toggle('多彩输入展示',c.colorful,{kind:'colorful'}),h('button',{className:'command',disabled:props.busy,onClick:()=>props.change({kind:'reset'})},'恢复开局开关'),h('small',null,'本局修改从下一轮生效。')))):null);
}
