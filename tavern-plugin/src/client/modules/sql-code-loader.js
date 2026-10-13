// Share only the shipped, immutable WASM bytes. Compiled WebAssembly.Module
// objects cannot cross the opaque frames' agent clusters in current Chromium.
function loadTavernSqlCode(hostWindow) {
  const cache = loadTavernSqlCode.cache ||= new WeakMap();
  if (cache.has(hostWindow)) return cache.get(hostWindow);
  const pending = hostWindow.fetch('/api/dsh-tavern/client-assets/sql-wasm.wasm').then(response => {
    if (!response.ok) throw new Error('本地 SQLite 代码读取失败：HTTP ' + response.status);
    return response.arrayBuffer();
  }).catch(error => { if (cache.get(hostWindow) === pending) cache.delete(hostWindow); throw error; });
  cache.set(hostWindow, pending);
  return pending;
}
