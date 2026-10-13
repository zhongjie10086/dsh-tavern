function installTavernScriptLibraryBridge(options) {
  const { window: win, call, context, currentScript, scriptList, buttonEvent, writer, recordUnverifiedWrite } = options;
  const copy = value => structuredClone(value);
  let tail = Promise.resolve();
  const writes = new Map(), origins = new WeakMap();
  const optimisticTrees = new Map();
  function enqueue(command) {
    const owner = currentScript().id, lifecycle = Number(context().lifecycleRevision || 0);
    const pending = tail.catch(() => {}).then(async () => {
      const result = await call('editTavernRuntimeScripts', { command: { ...command, expectedRevision: Number(context().scriptTreeRevision || 0) } }, { scriptId: owner, lifecycleRevision: lifecycle });
      if (result.stale) throw new Error('脚本配置未保存：当前局已变化');
      return result;
    });
    tail = pending; writes.set(owner, pending); if (writer) origins.set(pending, writer());
    pending.catch(error => { win.console.error('脚本设置保存失败', error); win.__dshTavernToast?.('error', String(error.message || error), '脚本配置未保存'); });
    return pending;
  }
  function scopeOf(option) {
    const scope = option?.type || 'global';
    if (!['global', 'preset', 'character', 'chat'].includes(scope)) throw new TypeError('脚本作用域无效');
    return scope;
  }
  win.getScriptTrees = option => copy(context().scriptTrees?.[scopeOf(option)] || []);
  win.replaceScriptTrees = (trees, option) => {
    if (!Array.isArray(trees)) throw new TypeError('脚本集合必须是数组');
    const scope = scopeOf(option), value = copy(trees);
    let record = optimisticTrees.get(scope);
    if (!record) { record = { base: context().scriptTrees?.[scope], pending: [], context: context() }; optimisticTrees.set(scope, record); }
    const change = { value }; record.pending.push(change); record.visible = value;
    context().scriptTrees = { ...context().scriptTrees, [scope]: value };
    function settle(saved) {
      const owned = context() === record.context && context().scriptTrees?.[scope] === record.visible;
      if (saved && owned) record.base = value;
      record.pending = record.pending.filter(item => item !== change);
      if (owned) {
        record.visible = record.pending.at(-1)?.value ?? record.base;
        context().scriptTrees = { ...context().scriptTrees, [scope]: record.visible };
      }
      if (!record.pending.length) optimisticTrees.delete(scope);
    }
    void enqueue({ kind: 'trees', scope, trees: value }).then(() => settle(true), () => settle(false));
  };
  win.updateScriptTreesWith = (updater, option) => {
    const result = updater(win.getScriptTrees(option));
    const save = trees => { win.replaceScriptTrees(trees, option); return copy(trees); };
    return result && typeof result.then === 'function' ? result.then(save) : save(result);
  };
  function metadata(patch) {
    const script = currentScript();
    Object.assign(script, copy(patch));
    void enqueue({ kind: 'metadata', ...copy(patch) });
  }
  for (const script of scriptList) Object.assign(script, copy(context().scriptMetadata?.[script.id] || {}));
  win.replaceScriptInfo = info => metadata({ info: String(info || '') });
  win.replaceScriptButtons = buttons => {
    if (!Array.isArray(buttons) || buttons.some(b => typeof b?.name !== 'string')) throw new TypeError('按钮格式无效');
    metadata({ buttons });
  };
  win.updateScriptButtonsWith = updater => {
    const result = updater(copy(currentScript().buttons));
    const save = buttons => { win.replaceScriptButtons(buttons); return copy(buttons); };
    return result && typeof result.then === 'function' ? result.then(save) : save(result);
  };
  win.getAllEnabledScriptButtons = () => Object.fromEntries(scriptList.map(script => [script.id, script.buttons.filter(b => b.visible !== false).map(b => ({ button_id: buttonEvent(b.name, script.id), button_name: b.name }))]));
  // A callback rethrows its script's last unsettled save even when another context
  // issued it (initialization, another event, a button). R8 Z59 first step: record
  // that the failure is charged here by guess; the rethrow itself is unchanged.
  return { async flush(owner) { const task = writes.get(owner); if (!task) return; try { await task; } catch (error) {
    const origin = origins.get(task), now = writer ? writer() : null;
    if (origin && now && now.eventId && (origin.eventId !== now.eventId || !origin.verified) && recordUnverifiedWrite) recordUnverifiedWrite(now.eventId, owner, '本回调结束时冲刷的脚本配置保存发出于' + (origin.eventId ? (origin.eventId === now.eventId ? '本事件的 await 之后或按钮、定时器' : '另一事件 ' + origin.eventId) : '初始化或界面操作（当时没有事件）') + '，其失败按现有规则在此重抛：' + String(error && error.message || error).slice(0, 300));
    throw error; } finally { if (writes.get(owner) === task) writes.delete(owner); } } };
}
