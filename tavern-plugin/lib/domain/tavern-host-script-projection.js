import { parse } from 'acorn'
const hostNames = new Set(['TavernHelper', 'SillyTavern'])
const hostSourceCache = new Map()
function anchorDiagnostic(source,label,count, diagnostics = []) {if(diagnostics.length<32)diagnostics.push({status:'patch-missed',anchor:String(label).slice(0,100),expected:1,actual:count,message:'兼容补丁未命中：'+String(label).slice(0,100)+'（预期 1，实际 '+count+'），请检查脚本版本'});return 'console.warn('+JSON.stringify('兼容适配锚点未命中或不唯一：'+label+'（预期 1，实际 '+count+'）；请检查脚本版本')+');\n'+source}
function checkedSourceReplace(source,pattern,replacement,label=String(pattern).slice(0,100), diagnostics = []) {
 const count=typeof pattern==='string'?source.split(pattern).length-1:Array.from(source.matchAll(new RegExp(pattern.source,pattern.flags.replace('g','')+'g'))).length
 return count===1?source.replace(pattern,replacement):anchorDiagnostic(source,label,count, diagnostics)
}
function property(node) { return node?.computed ? node.property?.type === 'Literal' ? node.property.value : null : node?.property?.name }
function walk(node, visit, parent) {
  if (!node || typeof node !== 'object') return
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit, node))
    else if (value && typeof value === 'object') walk(value, visit, node)
  }
}
export function projectTavernHostScript(source, { isolatedDocument = false, storageOwner = false, preserveJQuery = false } = {}) {
  return projectHostScript(source, {isolatedDocument,storageOwner,preserveJQuery})
}
// Internal bridge: the tree must be the successful strict module parse of this
// exact source. Consume it synchronously; never retain it in the source cache.
export function projectParsedTavernHostScript({source,tree}, {isolatedDocument=false,storageOwner=false,preserveJQuery=false}={}) {
  return projectHostScript(source,{isolatedDocument,storageOwner,preserveJQuery},tree)
}
function projectHostScript(source, {isolatedDocument,storageOwner,preserveJQuery}, parsedTree) {
  const cacheKey = String(isolatedDocument) + String(storageOwner) + String(preserveJQuery) + source
  if (hostSourceCache.has(cacheKey)) return hostSourceCache.get(cacheKey)
  const originalSource = source
  let tree=parsedTree
  try { if(!tree)tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) }
  catch(error) { if(storageOwner||isolatedDocument)throw new Error('脚本适配解析失败，未运行原始代码：'+error.message);return source }
  const bindings = [], candidates = [], hostIdentifiers = new Set(['window', 'parent', 'top', 'globalThis', 'localStorage'])
  function bind(pattern, scope) {
    if (!pattern) return
    if (pattern.type === 'Identifier') { if (hostIdentifiers.has(pattern.name)) bindings.push({ name: pattern.name, start: scope.start, end: scope.end }); return }
    if (pattern.type === 'RestElement') bind(pattern.argument, scope)
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(item => bind(item, scope))
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(item => bind(item.type === 'RestElement' ? item.argument : item.value, scope))
  }
  function scopes(node, lexical, functional, parent) {
    if (!node || typeof node !== 'object') return
    // Retain projection order and parent identity while collecting all bindings.
    // Replay only relevant nodes afterwards, including references before declarations.
    if (node.type === 'MemberExpression' || storageOwner && node.type === 'Identifier' && node.name === 'localStorage' || !isolatedDocument && node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && ['createElement', 'createElementNS'].includes(property(node.callee))) candidates.push([node, parent])
    if (node.type === 'FunctionDeclaration' && node.id) bind(node.id, lexical)
    if (/Function(?:Expression|Declaration)$/.test(node.type || '')) {
      functional = node; lexical = node
      bind(node.id, node); (node.params || []).forEach(item => bind(item, node))
    } else if (node.type === 'BlockStatement' || node.type === 'CatchClause' || node.type === 'ForStatement' || node.type === 'ForOfStatement' || node.type === 'ForInStatement') lexical = node
    if (node.type === 'CatchClause') bind(node.param, node)
    if (node.type === 'VariableDeclaration') node.declarations.forEach(item => bind(item.id, node.kind === 'var' ? functional : lexical))
    if (node.type === 'ClassDeclaration') bind(node.id, lexical)
    if (node.type === 'ImportDeclaration') node.specifiers.forEach(item => bind(item.local, lexical))
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue
      if (Array.isArray(value)) value.forEach(item => scopes(item, lexical, functional, node))
      else if (value && typeof value === 'object') scopes(value, lexical, functional, node)
    }
  }
  scopes(tree, tree, tree)
  const isGlobal = node => node?.type === 'Identifier' && hostIdentifiers.has(node.name) && !bindings.some(binding => binding.name === node.name && node.start >= binding.start && node.end <= binding.end)
  const edits = []
  const project = (node, parent) => {
    if(!isolatedDocument&&node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&['createElement','createElementNS'].includes(property(node.callee))){
      const doc=node.callee.object,owner=doc?.object,bare=isGlobal(owner)&&['parent','top'].includes(owner.name),qualified=owner?.type==='MemberExpression'&&['parent','top'].includes(property(owner))&&isGlobal(owner.object)&&['window','globalThis'].includes(owner.object.name)
      if(doc?.type==='MemberExpression'&&property(doc)==='document'&&(bare||qualified))edits.push({start:node.start,end:node.end,text:'((node)=>{const owner=globalThis.__dshTavernArtifactOwner;if(owner)node.setAttribute?.("data-dsh-tavern-artifact-owner",owner);return node})('+source.slice(node.start,node.end)+')'})
    }
    if (storageOwner && node.type === 'Identifier' && node.name === 'localStorage' && isGlobal(node)) {
      const memberKey = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const objectKey = ['Property','MethodDefinition'].includes(parent?.type) && parent.key === node && !parent.computed;
      if (!memberKey && (!objectKey || parent.shorthand)) edits.push({start:node.start,end:node.end,text:parent?.shorthand ? 'localStorage: __dshUiStorage' : '__dshUiStorage'});
      return;
    }
    if (node.type !== 'MemberExpression') return
    if (storageOwner && property(node) === 'localStorage' && (isGlobal(node.object) || node.object?.type === 'MemberExpression' && isGlobal(node.object.object) && ['parent','top'].includes(property(node.object)))) {
      edits.push({start:node.start,end:node.end,text:'__dshUiStorage'});return;
    }
    const name = property(node)
    if (isolatedDocument && ['parent', 'top'].includes(name) && isGlobal(node.object) && ['window', 'globalThis'].includes(node.object.name)) edits.push({ start: node.start, end: node.end })
    if (isolatedDocument && !preserveJQuery && ['jQuery', '$'].includes(name) && (isGlobal(node.object) || node.object?.type === 'MemberExpression' && isGlobal(node.object.object) && ['parent', 'top'].includes(property(node.object)))) { edits.push({ start: node.start, end: node.end, text: 'globalThis.__dshUiJQuery' }); return }
    if (!hostNames.has(name) && !(isolatedDocument && (['window', 'document', 'localStorage', 'AutoCardUpdaterAPI', 'toastr', 'jQuery', '$', 'Event'].includes(name) || /^__ub/.test(name)))) return
    const owner = node.object
    const bare = isGlobal(owner) && ['parent', 'top'].includes(owner.name)
    const qualified = owner?.type === 'MemberExpression' && ['parent', 'top'].includes(property(owner)) &&
      isGlobal(owner.object) && ['window', 'globalThis'].includes(owner.object.name)
    if (bare || qualified) edits.push({ start: owner.start, end: owner.end })
  }
  for (const [node, parent] of candidates) project(node, parent)
  const selected = []
  for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) if (!selected.some(other => edit.start >= other.start && edit.end <= other.end)) selected.push(edit)
  // AST spans are nested or disjoint. Build disjoint edits in one pass instead
  // of copying a multi-megabyte extension once for every replaced identifier.
  if(selected.every((edit,index)=>index===0||edit.start>=selected[index-1].end)){
    const chunks=[];let offset=0
    for(const edit of selected){chunks.push(source.slice(offset,edit.start),edit.text||'globalThis');offset=edit.end}
    chunks.push(source.slice(offset));source=chunks.join('')
  }else for (const edit of selected.reverse()) source = source.slice(0, edit.start) + (edit.text || 'globalThis') + source.slice(edit.end)
  if (originalSource.length > 100000) { if (hostSourceCache.size >= 8) hostSourceCache.delete(hostSourceCache.keys().next().value); hostSourceCache.set(cacheKey, source) }
  return source
}
export function projectTavernHostHtml(html, options = {}) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_match, opening, script, closing) => opening + projectTavernHostScript(script, options) + closing)
}
const isolatedCache = new Map()
/** Imported plugin UI stays inside its own app document, using real host data services. */
export function projectTavernOriginalDocument(source, diagnostics = []) {
  if (isolatedCache.has(source)) {const hit=isolatedCache.get(source);diagnostics.push(...structuredClone(hit.diagnostics).slice(0,Math.max(0,32-diagnostics.length)));return hit.output}
  const diagnosticStart=diagnostics.length
  function save(output){if(isolatedCache.size>=4)isolatedCache.delete(isolatedCache.keys().next().value);isolatedCache.set(source,{output,diagnostics:structuredClone(diagnostics.slice(diagnosticStart))});return output}
  if (source.includes('izumi_advice') && source.includes('izumi-floating-window') && source.includes('prompt_order')) {
    let projected=projectTavernHostScript(source,{isolatedDocument:true,storageOwner:true});
    projected=checkedSourceReplace(projected,'const saved = writeStorageKey(ADVICE_ENABLED_KEY, String(adviceEnabled));','const saved = writeStorageKey(ADVICE_ENABLED_KEY, String(adviceEnabled)); void globalThis.__dshIzumiSaveAdvice(adviceEnabled, adviceConfig).catch(error=>toast(error.message,"error"));', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'const saved = writeStorageKey(ADVICE_CONFIG_KEY, JSON.stringify(adviceConfig));','const saved = writeStorageKey(ADVICE_CONFIG_KEY, JSON.stringify(adviceConfig)); void globalThis.__dshIzumiSaveAdvice(adviceEnabled, adviceConfig).catch(error=>toast(error.message,"error"));', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'const loaded = api.load(imported[0].name);','const loaded = await api.load(imported[0].name);', undefined, diagnostics);
    projected=projectIzumiPresetLifecycle(projected, diagnostics);
    projected=checkedSourceReplace(projected,'panel = createPanel();','panel = createPanel(); applyNightMode(panel, icon);','夜间按钮初始状态', diagnostics);
    projected=checkedSourceReplace(projected,'normalizeName((wrapper && wrapper.name) || source.name || fallbackName)','normalizeName((wrapper && wrapper.name) || raw.name || source.name || fallbackName)', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'const prompts = (Array.isArray(source.prompts) ? source.prompts : [])',"const rawPrompts=Array.isArray(source.prompts)?source.prompts:[],order=!isHelper&&((source.prompt_order||[]).find(x=>Number(x.character_id)===100001)||(source.prompt_order||[]).at(-1))?.order;const referenced=new Set((order||[]).map(x=>String(x.identifier)));const prompts = (order?.length?order.map(ref=>{const p=rawPrompts.find(p=>String(p.identifier||p.id)===String(ref.identifier));return p?{...p,enabled:ref.enabled!==false}:null}).filter(Boolean):rawPrompts)", undefined, diagnostics);
    projected=checkedSourceReplace(projected,'const unused = (Array.isArray(source.prompts_unused) ? source.prompts_unused : [])',"const unused = (order?.length?rawPrompts.filter(p=>!referenced.has(String(p.identifier||p.id))):(Array.isArray(source.prompts_unused)?source.prompts_unused:[]))", undefined, diagnostics);
    projected=checkedSourceReplace(projected,'extensions: source.extensions && typeof source.extensions',"...(!isHelper?{__dshNativeDocument:native}:{}),extensions: source.extensions && typeof source.extensions", undefined, diagnostics);

    projected=checkedSourceReplace(projected,'function downloadText(text, filename) {','function downloadText(text, filename) { if(globalThis.__dshDownloadText)return globalThis.__dshDownloadText(text,filename);', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'async function openManager() {','async function openManager() { if(globalThis.__dshOpenPresetManager)return globalThis.__dshOpenPresetManager();', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'async function readCurrentApiConfig() {','async function readCurrentApiConfig() { if(globalThis.__dshIzumiReadConnection)return normalizeApiConfig(await globalThis.__dshIzumiReadConnection());', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'async function fetchModelList(config) {','async function fetchModelList(config) { if(globalThis.__dshIzumiModels)return await globalThis.__dshIzumiModels(config);', undefined, diagnostics);
    projected=checkedSourceReplace(projected,'async function applyApiConfig(input) {','async function applyApiConfig(input) { if(globalThis.__dshIzumiApplyConnection){try{currentApiConfig=normalizeApiConfig(await globalThis.__dshIzumiApplyConnection(input));renderApiConfig(currentApiConfig);return {ok:true,skipped:false,errors:[]}}catch(error){return {ok:false,skipped:false,errors:[error.message]}}}', undefined, diagnostics);
    projected=checkedSourceReplace(projected,"} else if (action === 'api-read') {","} else if(action==='api-reset'){try{renderApiConfig(normalizeApiConfig(await globalThis.__dshIzumiResetConnection()));toast('已恢复跟随 DSH 连接','success')}catch(error){toast(error.message,'error')} } else if (action === 'api-read') {", undefined, diagnostics);
    projected=checkedSourceReplace(projected,'<button class="command primary" data-action="api-apply">','<button class="command" data-action="api-reset">跟随 DSH 连接</button><button class="command primary" data-action="api-apply">', undefined, diagnostics);
    projected=checkedSourceReplace(projected,"if (action === 'close') {", "if (action === 'close') { globalThis.__dshTavernCloseUi?.();", undefined, diagnostics);
    projected=checkedSourceReplace(projected,'bindQuickMenu(quickMenu, icon);','bindQuickMenu(quickMenu, icon);globalThis.__dshOpenIzumiQuick=()=>openQuickMenu(quickMenu,icon);', undefined, diagnostics);
    // Preserve source event listeners (including later Izumi additions). DSH owns
    // Advice input/history, so only the legacy destructive transfer is bypassed.
    projected=checkedSourceReplace(projected,/(function stageAdviceTransfer\([^)]*\)\s*\{)/, '$1 return null; /* DSH native Advice */', undefined, diagnostics);
    projected=checkedSourceReplace(projected,/(async function syncAdviceAfterMessageEdit\([^)]*\)\s*\{)/, '$1 return; /* DSH native input editor */', undefined, diagnostics);
    // Sanitizer is a separate switch and must work when Advice is disabled.
    projected=checkedSourceReplace(projected,'if (!adviceRuntimeEnabled()) return;\n            listener(...args);', 'if (!adviceRuntimeEnabled() && !(typeof sanitizerRuntimeEnabled === "function" && sanitizerRuntimeEnabled())) return;\n            listener(...args);', undefined, diagnostics);
    const output='/* tavernOriginalUi: izumi */\nconst __dshUiStorage = globalThis.__dshTavernStorageFor(getScriptId());\nif(!__dshUiStorage.getItem("__dshIzumiBrowserCacheImported_v2")){try{const old=await globalThis.__dshReadIzumiBrowserCache(),keys=Object.keys(old).filter(key=>key.startsWith("izumi_floating_window_"));if(keys.length){for(const key of keys)if(__dshUiStorage.getItem(key)===null)__dshUiStorage.setItem(key,old[key]);__dshUiStorage.setItem("__dshIzumiBrowserCacheImported_v2","true")}}catch(error){console.warn("Izumi 旧浏览器缓存迁移未完成",error)}}\nconst __dshAdvice=globalThis.__dshIzumiInitialAdvice();__dshUiStorage.setItem("izumi_floating_window_advice_enabled_v1",String(__dshAdvice.enabled));__dshUiStorage.setItem("izumi_floating_window_advice_config_v1",JSON.stringify(__dshAdvice.config));\n'+projected+'\nconst izumiStyle=document.createElement("style");izumiStyle.textContent="#izumi-floating-window-v1-panel{inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;border-radius:0!important} #izumi-floating-window-v1{display:none!important}";document.head.appendChild(izumiStyle);globalThis.__dshOpenIzumi=()=>{const p=document.getElementById("izumi-floating-window-v1-panel");if(p&&getComputedStyle(p).display==="none")document.getElementById("izumi-floating-window-v1")?.click()};setTimeout(globalThis.__dshOpenIzumi,100);';
    return save(output);
  }
  if (!source.includes('AutoCardUpdaterAPI')) return source
  if (!source.includes('<!doctype html')) {
    // Standalone database visualizers construct their DOM dynamically.
    if (!source.includes('registerTableUpdateCallback') || !source.includes('importTableAsJson')) return source
    const output = '/* tavernOriginalUi: database-visualizer */\nconst __dshUiStorage = globalThis.__dshTavernStorageFor(getScriptId());\nif (!globalThis.__dshUiJQuery) { await new Promise((resolve,reject)=>{ const s=document.createElement("script");s.src="/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s); }); globalThis.__dshUiJQuery=globalThis.jQuery.noConflict(true); }\n' + projectTavernHostScript(source, { isolatedDocument: true, storageOwner: true })
    return save(output)
  }
  let tree, html = ''
  try { tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true }) } catch { return source }
  walk(tree, node => {
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      const value = node.quasis[0]?.value.cooked || ''
      if (/^\s*<!doctype html/i.test(value) && value.includes('AutoCardUpdaterAPI')) html = value
    }
  })
  if (!html) return source
  const seeds = [], declarations = new Map(), mounts = new Set(), ids = new Map()
  function staticValue(node) {
    if (!node) return false
    if (node.type === 'Literal') return true
    if (node.type === 'ArrayExpression') return node.elements.every(staticValue)
    if (node.type === 'ObjectExpression') return node.properties.every(p => p.type === 'Property' && !p.computed && staticValue(p.value))
    if (node.type === 'UnaryExpression') return ['-', '+', '!'].includes(node.operator) && staticValue(node.argument)
    return false
  }
  walk(tree, node => {
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && staticValue(node.init)) declarations.set(node.id.name, node.init)
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' && node.left.object?.type === 'Identifier') {
      if (property(node.left) === 'innerHTML') mounts.add(node.left.object.name)
      if (property(node.left) === 'id' && node.right.type === 'Literal') ids.set(node.left.object.name, node.right.value)
    }
  })
  walk(tree, node => {
    if (node.type !== 'AssignmentExpression' || node.left?.type !== 'MemberExpression') return
    const name = property(node.left), value = node.right.type === 'Identifier' ? declarations.get(node.right.name) : null
    if (/^__ub/.test(name || '') && value) seeds.push('globalThis[' + JSON.stringify(name) + ']=' + source.slice(value.start, value.end) + ';')
  })
  const wrapperId = [...mounts].map(name => ids.get(name)).find(Boolean)
  const scripts = []
  const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_, attributes, body) => {
    if (/\bsrc\s*=/.test(attributes)) throw new Error('嵌入文档的外部 script src 尚未转换')
    scripts.push(body)
    return ''
  })
  const output = seeds.join('\n') + '\nconst __dshUiOwner = getScriptId();\nconst imported = new DOMParser().parseFromString(' + JSON.stringify(markup) + ', "text/html");\n'
    + 'for (const item of imported.head.children) document.head.appendChild(document.importNode(item, true));\n'
    + 'const host = document.createElement("div"); host.dataset.tavernOriginalUi = "true"; host.inert = true;' + (wrapperId ? 'host.id=' + JSON.stringify(wrapperId) + ';' : '') + '\n'
    + 'host.append(...Array.from(imported.body.childNodes).map(n => document.importNode(n, true))); document.body.appendChild(host);\n'
    + 'document.body.style.margin="0";\n'
    + 'if (!globalThis.__dshUiJQuery) { await new Promise((resolve,reject) => { const script=document.createElement("script");script.src="/api/dsh-tavern/vendor/runtime-assets/jquery/jquery.min.js";script.onload=resolve;script.onerror=reject;document.head.appendChild(script); }); globalThis.__dshUiJQuery=globalThis.jQuery.noConflict(true); }\n'
    + 'globalThis.__ub_inject = () => globalThis.__ub_on_reinject?.();\n'
    // Rewrite parsed dependencies before JSON quoting hides them inside the Blob source.
    + scripts.map(body => 'await import(URL.createObjectURL(new Blob([' + JSON.stringify('const $ = globalThis.__dshUiJQuery, jQuery = $; const __dshUiStorage = globalThis.__dshTavernStorageFor(getScriptId());\n' + projectTavernRemoteImports(projectTavernHostScript(projectOriginalConnectionHooks(projectOriginalStorageLifecycle(projectOriginalStorageControls(projectOriginalEmptyRelationships(projectOriginalWorldbookQueue(body, diagnostics), diagnostics), diagnostics), diagnostics), diagnostics), { isolatedDocument: true, storageOwner: true }), '')) + ' + "\\n//# sourceURL=dsh-tavern-script:" + encodeURIComponent(__dshUiOwner)],{type:"text/javascript"})));').join('\n')
    + '\nawait new Promise(resolve => globalThis.__dshUiJQuery(resolve)); await globalThis.__dshTavernFilesReady?.(); await globalThis.__dshTavernComposerReady; host.inert = false; host.dataset.tavernUiReady = \"true\";\n'
    + (markup.includes('ac-settings-btn') ? '\n('+originalStatusLayout.toString()+')();\n('+originalCharacterStatus.toString()+')();\n' : '')
  return save(output)
}

export function projectIzumiPresetLifecycle(source, diagnostics = []){
  if(source.includes('load(name)'))source=checkedSourceReplace(source,'const loaded = load(name);', 'nativePresetTransition=name;let loaded;try{loaded=await load(name);if(loaded!==false)knownPreset=name;}finally{nativePresetTransition="";}','预设载入生命周期', diagnostics);
  if(source.includes('stopped'))source=checkedSourceReplace(source,'stopped = true;', 'stopped = true;globalThis.__dshIzumiWasShutdown=true;','预设停止', diagnostics);
  if(source.includes('watchPresetSwitch'))source=checkedSourceReplace(source,'watchPresetSwitch();', 'globalThis.__dshIzumiWasShutdown=false;watchPresetSwitch();','预设监听恢复', diagnostics);
  return source;
}

export function projectOriginalWorldbookQueue(body, diagnostics = []){
  return body.includes('getHelper')?checkedSourceReplace(body,'const e=Ta({getHelper:ne.fr});Pa=', 'const e=Ta({getHelper:()=>globalThis.__dshV3WorldbookHelper?.((0,ne.fr)())||(0,ne.fr)()});Pa=','世界书队列', diagnostics):body;
}

export function projectOriginalEmptyRelationships(body, diagnostics = []){
  // The upstream empty-state returns before attaching the normal close-button handler.
  // The following rendering helper was renamed by upstream's minifier in
  // V3.759 (gm -> Ng). Bind to the empty branch, leaving that helper untouched.
  return body.includes('edges')?checkedSourceReplace(body,"if(!i.edges.length)return k(!0),","if(!i.edges.length)return m.querySelector('#panelClose')?.addEventListener('click',()=>{(0,tt.pv)()||C()}),k(!0),",'空关系窗口关闭', diagnostics):body;
}

export function projectOriginalStorageControls(body, diagnostics = []){
 // Storage pages replace their controls after asynchronous file reads. Bind changes to the document.
 const marker="const we=document.getElementById('ubMoveAutoOpenInput');";
 if(!body.includes('ubMoveAutoOpenInput'))return body;
 if(body.split(marker).length!==2)return anchorDiagnostic(body,'存储控件起点',body.split(marker).length-1, diagnostics);
 const start=body.indexOf(marker),end=body.indexOf('const Se=',start);if(end<0||end-start>1200)return anchorDiagnostic(body,'存储控件终点',0, diagnostics);
 const binding="if(!document.__dshStorageControls){document.__dshStorageControls=true;document.addEventListener('change',event=>{const target=event.target,keys={ubMoveLayersInput:'moveLayers',ubBackupIntervalInput:'storyBackupInterval'};if(target.id==='ubMoveAutoOpenInput')(0,m.Nk)('moveChatAutoOpen',target.checked===true);else if(keys[target.id]){const value=Number(target.value);if(Number.isInteger(value)&&value>=1&&value<=999)(0,m.Nk)(keys[target.id],value);else target.value=String((0,m.zj)()[keys[target.id]])}})}";
 return body.slice(0,start)+binding+body.slice(end);
}

export function projectOriginalStorageLifecycle(body, diagnostics = []){
 if(!body.includes("trigger:'chat-changed'")||!body.includes("flushStatusbarStorage"))return body;
 const edits=[],tree=parse(body,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true});
 walk(tree,node=>{if(node.type!=='ArrowFunctionExpression'||!node.async||node.params.length||node.body.type!=='BlockStatement')return;const source=body.slice(node.body.start,node.body.end);if(source.includes("await(0,Z.Xi)('')")&&source.includes("trigger:'chat-changed'")&&source.length<600)edits.push({at:node.body.start+1,text:"const current=k(ce()),ready=je();if(ready.chatKey&&ready.identity?.kind==='ready'&&S(I(current),ready.identity.owner))return;"})});
 if(edits.length!==1)return anchorDiagnostic(body,'存储生命周期',edits.length, diagnostics);
 for(const edit of edits.reverse())body=body.slice(0,edit.at)+edit.text+body.slice(edit.at);return body;
}

export function projectOriginalConnectionHooks(body, diagnostics = []){
 if(!body.includes('api_button_openai')||!body.includes('secret-id key=api_key_custom'))return body;
 body=checkedSourceReplace(body,'n=!!i(t)','n=!!(await i(t))','连接异步结果', diagnostics);
 const edits=[],tree=parse(body,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true});
 walk(tree,node=>{if(node.type==='FunctionDeclaration'&&node.async&&node.params.length===4&&node.params.every(p=>p.type==='Identifier')){const source=body.slice(node.body.start,node.body.end);if(source.includes('api_button_openai')&&source.includes('secret-id key=api_key_custom'))edits.push({at:node.body.start+1,text:'if(globalThis.__dshApplyMainConnection)return globalThis.__dshApplyMainConnection('+node.params[0].name+','+node.params[1].name+');'})}});
 if(edits.length!==1)return anchorDiagnostic(body,'连接保存入口',edits.length, diagnostics);
 for(const e of edits.reverse())body=body.slice(0,e.at)+e.text+body.slice(e.at);return body;
}
function originalStatusLayout(){
  // Keep nested map dialogs usable inside the isolated original-script window.
  const style=document.createElement('style');style.dataset.dshOriginalStatusLayout='true';
  style.textContent='.panel-popup.map-popup{height:min(82dvh,760px)!important;min-height:0!important}.map-popup .map-library{min-width:0!important;width:auto!important;flex:1 1 0%!important}.map-popup .map-alias-modal{box-sizing:border-box;justify-content:flex-start!important}.map-popup .map-alias-modal>*,.map-popup .map-alias-list{flex-shrink:0}.map-popup .map-alias-remove>*{pointer-events:none}';
  document.head.appendChild(style);
}
function originalCharacterStatus(){
  const host=document.getElementById('ac-statusbar-wrapper');if(!host)return;
  const hint=document.createElement('div');hint.dataset.dshCharacterStatus='true';hint.setAttribute('role','status');hint.style.cssText='padding:10px 14px;margin:8px;border:1px solid #8b9caf;border-radius:8px;background:#273445;color:#edf3ff;font:13px/1.7 system-ui';
  const text=document.createElement('span'),button=document.createElement('button');button.type='button';button.textContent='打开数据库';button.style.cssText='margin-left:10px;padding:4px 10px;cursor:pointer';button.onclick=()=>globalThis.AutoCardUpdaterAPI?.openVisualizer?.();hint.append(text,button);host.prepend(hint);
  function refresh(value){const tables=Object.values(value||globalThis.AutoCardUpdaterAPI?.exportTableAsJson?.()||{}).filter(t=>['主角信息表','恋爱对象表','重要角色表','在场角色表'].includes(t?.name));const hasRows=tables.some(t=>Array.isArray(t.content)&&t.content.slice(1).some(row=>row[t.content[0].indexOf('姓名')]));hint.hidden=hasRows;text.textContent=tables.length?'人物表目前没有姓名记录。先在数据库填入主角、重要角色或在场角色，状态栏才会显示人物；立绘可在人物资料中另行设置。':'当前表格模板不含状态栏的人物表。请导入配套模板，再填写人物资料。';}
  refresh();globalThis.AutoCardUpdaterAPI?.registerTableUpdateCallback(refresh);
}

/** Literal remote imports use the cached host projection; a bare entry import participates in readiness. */
export function projectTavernRemoteImports(source,scriptId) {
 let tree;try{tree=parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true})}catch{return source}
 const edits=[]
 walk(tree,(node,parent)=>{
  const ref=node.type==='ImportExpression'?node.source:['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)?node.source:null
  if(ref?.type==='Literal'&&typeof ref.value==='string'&&/^https?:\/\//i.test(ref.value)) {
   edits.push({start:ref.start,end:ref.end,text:JSON.stringify('/api/dsh-tavern/static-assets?url='+encodeURIComponent(ref.value)+'&scriptId='+encodeURIComponent(scriptId))})
   if(node.type==='ImportExpression'&&parent?.type==='ExpressionStatement'&&tree.body.includes(parent))edits.push({start:node.start,end:node.start,text:'await '})
  }
 })
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end)
 return source
}
