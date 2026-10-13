// Kept self-contained so the frame bootstrap can serialize this function.
function validateTavernMvuRuntime(runtime, selection) {
  const required = ['getMvuData', 'replaceMvuData', 'parseMessage'];
  const missing = required.filter(function (name) { return !runtime || typeof runtime[name] !== 'function'; });
  const versions = {
    requestedVersion: selection && selection.requestedVersion || 'host-default',
    actualVersion: selection && selection.actualVersion || null
  };
  if (missing.length) {
    const error = new Error('人物卡指定 MVU 与宿主不兼容：缺少 ' + missing.join(', ') + '；保留原资源和剧情数据。');
    error.code = 'MVU_RUNTIME_INCOMPATIBLE';
    error.mvuVersion = versions;
    throw error;
  }
  return Object.assign({ phase: 'version-ready' }, versions);
}

function TavernMvuVersion(props) {
  const selection = props && props.runtime;
  if (!selection) return null;
  return React.createElement('span', { className: 'tavern-mvu-version', title: selection.message || '' },
    'MVU 请求：' + (selection.requestedVersion || 'host-default') + ' · 实际：' + (selection.actualVersion || (selection.status === 'incompatible' ? '未加载（不兼容）' : '待加载')));
}
