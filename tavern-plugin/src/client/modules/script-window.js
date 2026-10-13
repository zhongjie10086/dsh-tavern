function createTavernScriptWindow(win, root, minimize, retrySettings, options = {}) {
  const key = 'dsh-tavern.window.original-scripts.' + (options.key || 'shared');
  const storage = win.localStorage;
  let rect, drag = null, observer, layer = 1000000;
  function raise() { layer = win.__dshTavernFloatingLayer = Math.max(1000000, Number(win.__dshTavernFloatingLayer) || 0) + 1; root.style.zIndex = String(layer); }
  function defaults() { return { x: 32, y: 60, width: Math.min(1100, win.innerWidth - 32), height: Math.min(760, win.innerHeight - 90) }; }
  function clamp(value) {
    const fallback = defaults(), width = Math.max(280, Math.min(Number(value.width) || fallback.width, win.innerWidth - 16)), height = Math.max(220, Math.min(Number(value.height) || fallback.height, win.innerHeight - 24));
    return { width, height, x: Math.max(8, Math.min(Number(value.x) || fallback.x, win.innerWidth - width - 8)), y: Math.max(8, Math.min(Number(value.y) || fallback.y, win.innerHeight - 48)) };
  }
  try { rect = clamp(JSON.parse(storage.getItem(key) || '{}')); } catch { rect = defaults(); }
  function paint() { Object.assign(root.style, { position: 'fixed', inset: 'auto', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px', zIndex: String(layer), display: 'flex', flexDirection: 'column', resize: 'both', overflow: 'hidden', background: '#181923', border: '1px solid #697489', borderRadius: '14px', boxShadow: '0 20px 80px #0008' }); }
  function save() { try { storage.setItem(key, JSON.stringify(rect)); } catch {} }
  const bar = root.querySelector('.dsh-floating-titlebar');
  Object.assign(bar.style, { minHeight: '42px', padding: '7px 12px', color: '#eef0f8', background: '#252938', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: '0', font: '13px system-ui' });
  for (const button of bar.querySelectorAll('button')) Object.assign(button.style, { marginLeft: 'auto', borderRadius: '6px', border: '1px solid #657089', background: '#343e54', color: '#eef0f8', padding: '5px 10px', cursor: 'pointer' });
  const status = win.document.createElement('span'); status.setAttribute('data-script-save-status', 'true'); status.setAttribute('role','status'); status.style.cssText='font-size:12px;opacity:.8'; bar.appendChild(status);
  const mirror=options.frame?createTavernWindowMirror(win,options.frame,options.token,options.title||'原版脚本'):null;
  if(mirror){const pip=win.document.createElement('button');pip.type='button';pip.textContent='系统小窗';pip.onclick=()=>mirror.open().catch(error=>{status.textContent=error.message});bar.appendChild(pip)}
  const retry = win.document.createElement('button'); retry.type = 'button'; retry.textContent = '重试保存'; retry.onclick = retrySettings; bar.appendChild(retry);
  bar.style.touchAction = 'none';
  bar.style.cursor = 'move';
  bar.setAttribute('aria-label', '拖动原版脚本窗口');
  function down(e) { raise(); if (e.button !== 0 || e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY, rect: { ...rect } }; bar.setPointerCapture(e.pointerId); e.preventDefault(); }
  function move(e) { if (!drag) return; rect = clamp({ ...drag.rect, x: drag.rect.x + e.clientX - drag.x, y: drag.rect.y + e.clientY - drag.y }); paint(); }
  function up() { if (drag) { drag = null; save(); } }
  const reset = win.document.createElement('button'); reset.type = 'button'; reset.textContent = '重置位置'; reset.onclick = () => { rect = defaults(); paint(); save(); }; Object.assign(reset.style, { borderRadius: '6px', border: '1px solid #657089', background: '#343e54', color: '#eef0f8', padding: '5px 10px', cursor: 'pointer' }); bar.appendChild(reset);
  bar.addEventListener('pointerdown', down); bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('lostpointercapture', up);
  if (win.ResizeObserver) { observer = new win.ResizeObserver(() => { if (root.hidden) return; const r = root.getBoundingClientRect(); if (r.width > 100 && r.height > 100) { rect.width = r.width; rect.height = r.height; save(); } }); observer.observe(root); }
  function resize() { rect = clamp(rect); if (!root.hidden) paint(); }
  win.addEventListener('resize', resize);
  return { open() { root.hidden = false; raise(); paint(); }, hide() { root.hidden = true; root.style.display = 'none'; }, dispose() { mirror?.dispose(); observer?.disconnect(); win.removeEventListener('resize', resize); } };
}
