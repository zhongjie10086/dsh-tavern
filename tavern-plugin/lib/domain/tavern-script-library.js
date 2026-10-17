import {isDeepStrictEqual} from 'node:util'
import {inspectImportedVariables} from './import-variable-review.js'
import { createHash, randomUUID } from 'node:crypto'
import { presetHelperScripts, nativeScriptAdapter } from './st-preset-compatibility.js'
import { isHostOwnedMvu, projectTavernHelperScripts } from './tavern-helper-scripts.js'
import { inspectCardMvuDeclaration } from './mvu-runtime-selection.js'
const clone = value => structuredClone(value)
const immutableDigests=new WeakMap()
const hash = value => {const fixed=value&&typeof value==='object'&&isFrozenJson(value);if(fixed&&immutableDigests.has(value))return immutableDigests.get(value);const digest=createHash('sha256').update(JSON.stringify(value)).digest('hex');if(fixed)immutableDigests.set(value,digest);return digest}
const scopes = ['global', 'preset', 'character', 'chat']
function cloneScriptFields(item) {
  const entries=Object.entries(item),deferred=new Set(entries.filter(([key,value])=>key==='content'&&typeof value==='string'||key==='scripts'&&item.type==='folder').map(([key])=>key))
  const copied=clone(Object.fromEntries(entries.filter(([key])=>!deferred.has(key))))
  // Strings are immutable; folder children receive their own normalized copies.
  // Restore original key order while cloning every other, including unknown, field.
  return Object.fromEntries(entries.map(([key,value])=>[key,deferred.has(key)?value:copied[key]]))
}
export function normalizeScriptTrees(input) {
  if (!Array.isArray(input)) throw new Error('脚本集合必须是数组')
  const ids = new Set()
  const visit = (items, depth = 0) => {
    if (depth > 8) throw new Error('脚本分组超过 8 层')
    return items.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('脚本格式无效')
      const id = String(item.id || randomUUID())
      if (ids.has(id)) throw new Error('同一作用域中脚本 ID 重复：' + id)
      ids.add(id)
      const base = { ...cloneScriptFields(item), id, name: String(item.name || '未命名脚本'), enabled: item.enabled !== false }
      if (item.type === 'folder') return { ...base, type: 'folder', scripts: visit(item.scripts || [], depth + 1) }
      if (typeof item.content !== 'string' || item.content.length > 12_000_000) throw new Error('脚本内容无效或超过 12MB')
      const buttons = item.button?.buttons || item.buttons || []
      if (!Array.isArray(buttons) || buttons.some(b => typeof b?.name !== 'string')) throw new Error('脚本按钮格式无效')
      return { ...base, type: 'script', content: item.content, info: String(item.info || ''),
        button: { enabled: item.button?.enabled !== false, buttons: clone(buttons) }, data: clone(item.data || {}),
        export_with: { data: item.export_with?.data !== false, button: item.export_with?.button !== false } }
    })
  }
  const result = visit(input)
  if (ids.size > 1000) throw new Error('脚本数量超过 1000')
  return result
}
export function importScriptTrees(document, name = '导入脚本') {
  if (typeof document === 'string') return normalizeScriptTrees([{ type: 'script', name: name.replace(/\.(m?js)$/i, ''), content: document }])
  const input = Array.isArray(document) ? document : ['script', 'folder'].includes(document?.type) ? [document]
    : document?.scripts || document?.extensions?.tavern_helper?.scripts || document?.extension_settings?.tavern_helper?.script?.scripts
  return stripScriptResourceIds(normalizeScriptTrees(input))
}
/** A file cannot confer a host-created resource identity on itself. */
export function stripScriptResourceIds(trees) {
  return (trees || []).map(item=>{const {_dshResourceId,_dshSource,_dshVariableScope,...rest}=item;return item.type==='folder'?{...rest,scripts:stripScriptResourceIds(item.scripts)}:rest})
}
function admitScriptTrees(input, previous = [], restoring = false, confirmedUpdateIds = [], apiDefault = false) {
  return admitNormalizedScriptTrees(normalizeScriptTrees(input),previous,restoring,confirmedUpdateIds,apiDefault)
}
// Private: only a normalized tree or its shape-preserving filter/switch projection
// can enter here. Public import/edit paths retain complete normalization.
function admitNormalizedScriptTrees(input, previous = [], restoring = false, confirmedUpdateIds = [], apiDefault = false) {
  const known = new Map(scriptNodes(previous).map(item=>[item.id,item]))
  const confirmed = new Set(confirmedUpdateIds)
  function visit(items){return items.map(item=>{
    if(item.type==='folder')return {...item,scripts:visit(item.scripts)}
    const old=known.get(item.id), retain=old?._dshResourceId && (restoring || confirmed.has(item.id) || item._dshResourceId===old._dshResourceId)
    return {...item,_dshResourceId:retain?old._dshResourceId:randomUUID(),_dshVariableScope:old?(old._dshVariableScope||(old._dshResourceId||!apiDefault?'legacy':'shared')):'shared'}
  })}
  return visit(input)
}
function updateOrigin(script) {
  return script._dshSource || ''
}
export function flattenScriptTrees(trees, enabled = true, folder = '') {
  return (trees || []).flatMap(item => item.type === 'folder'
    ? flattenScriptTrees(item.scripts, enabled && item.enabled !== false, folder ? folder + '/' + item.name : item.name)
    : [{ ...cloneScriptFields(item), enabled: enabled && item.enabled !== false, folder }])
}

/** A frame can inspect its own presence without receiving other scripts or secrets. */
export function projectScriptLibraryForFrame(view, scriptId) {
  const own = trees => flattenScriptTrees(trees).filter(item => item.id === scriptId)
    .map(({id, name, enabled, type}) => ({id, name, enabled, type}));
  const project = value => Object.fromEntries(scopes.map(scope => [scope, own(value?.[scope])]));
  const current = project(view.current);
  return {revision:view.revision, lifecycleRevision:view.lifecycleRevision, current, library:project(view.library),
    digest:hash(current), history:[], diagnostics:[]};
}
export function scriptUpdateIdentity(script) {
  const source=String(script.content||'');
  const name=source.match(/^\s*[/][/]\s*@name\s+(.+)$/m)?.[1]?.trim(), namespace=source.match(/^\s*[/][/]\s*@namespace\s+(.+)$/m)?.[1]?.trim();
  return name&&namespace?'userscript:'+namespace+':'+name:'';
}
function updateName(script){
 return String(script.name||'').normalize('NFKC').trim().replace(/(?:[\s_-]*(?:v(?:ersion)?|版本|ver\.?)\s*\d+(?:\.\d+)*(?:[-+][a-z0-9.-]+)?|[\s_-]+\d+(?:\.\d+)+(?:[-+][a-z0-9.-]+)?)$/i,'').trim().toLowerCase()
}
// Update matching preserves each child's own switch; folder switches remain on their folder.
function preserveLegacyVariableScope(item,previous,chat){
 const legacy=previous&&previous._dshVariableScope!=='shared'&&(previous._dshResourceId||Object.hasOwn(chat?.tavernHelperScriptVariables||{},previous.id))
 return legacy?{...item,_dshVariableScope:'legacy'}:item
}
function scriptNodes(trees) { return (trees||[]).flatMap(item=>item.type==='folder'?scriptNodes(item.scripts):[item]); }
// Which installed identity stands for which card/preset source script. follow
// records it; change() records it too when a scope is saved before any follow.
function embeddedMembership(source,trees){return scriptNodes(source).map(item=>{const row=scriptNodes(trees).find(row=>row.updateSource?.importedId===item.id||row.id===item.id);return {sourceId:item.id,id:row?.id||item.id,resourceId:row?._dshResourceId||'',enabled:item.enabled!==false}})}
/** Generic matches are preview suggestions; explicit target choices win. */
export function planScriptUpdate(existing,incoming,previous=[],selections={}) {
  if(!selections||typeof selections!=='object'||Array.isArray(selections))throw Error('脚本更新选择无效')
  const trees=normalizeScriptTrees(existing), imports=normalizeScriptTrees(incoming), installed=scriptNodes(trees), history=scriptNodes(previous), decisions=[], used=new Set();
  const byId=new Map();for(const item of installed.concat(history))if(!byId.has(item.id))byId.set(item.id,item);
  const candidates=[...byId.values()],importedIds=new Set(scriptNodes(imports).map(item=>item.id));
  if(Object.keys(selections).some(id=>!importedIds.has(id)))throw Error('导入脚本已变化，请刷新预览')
  function prepare(item){
    if(item.type==='folder')return {...item,scripts:item.scripts.map(prepare)};
    const identity=scriptUpdateIdentity(item),name=updateName(item),source=updateOrigin(item);
    const groups=[['id',candidates.filter(old=>old.id===item.id)],['source',source?candidates.filter(old=>updateOrigin(old)===source):[]],['name',name?candidates.filter(old=>updateName(old)===name):[]],['userscript',identity?candidates.filter(old=>scriptUpdateIdentity(old)===identity):[]]];
    const [matchBy,matching]=groups.find(([,rows])=>rows.length)||['',[]],active=matching.filter(old=>installed.some(row=>row.id===old.id)),matches=active.length?active:matching;
    const selected=Object.hasOwn(selections,item.id),choice=selections[item.id];
    if(selected&&choice!=='new'&&!(typeof choice==='string'&&choice.startsWith('replace:')))throw Error('脚本更新目标无效')
    let old=selected?(choice==='new'?null:byId.get(choice.slice(8))):matches.length===1?matches[0]:null;
    if(selected&&choice!=='new'&&!old)throw Error('选择的更新目标已不存在，请刷新预览')
    if(old&&used.has(old.id))throw Error('多个导入脚本不能同时替换同一目标，请调整预览选择');if(old)used.add(old.id);
    const sameSource=old && (hash(old.content)===hash(item.content) || source && updateOrigin(old)===source)
    const next=old?{...item,id:old.id,enabled:old.enabled,data:{...item.data,...old.data},button:old.button,...(source?{}:old._dshSource?{_dshSource:old._dshSource}:{}),...(sameSource&&old._dshResourceId?{_dshResourceId:old._dshResourceId}:{}),
      updateSource:{importedId:item.id,identity,previousDigest:hash(old.content),at:Date.now()}}:{...item,...(byId.has(item.id)?{id:randomUUID()}: {})};
    decisions.push({importedId:item.id,id:next.id,name:item.name,previousName:old?.name||'',kind:old?(installed.some(row=>row.id===old.id)?'update':'restore'):'add',identity,matchBy:selected?'chosen':matchBy,choice:selected?choice:old?'replace:'+old.id:matches.length>1?'':'new',requiresChoice:!selected&&matches.length>1,candidates:matches.map(row=>row.id),changed:old?.content!==item.content});return next;
  }
  const prepared=imports.map(prepare), replacements=new Map(scriptNodes(prepared).filter(item=>installed.some(old=>old.id===item.id)).map(item=>[item.id,item]));
  function apply(list){return list.map(item=>item.type==='folder'?{...item,scripts:apply(item.scripts)}:replacements.get(item.id)||item)}
  const result=apply(trees);
  function add(list,target){for(const item of list){if(item.type==='folder'){const match=target.find(row=>row.type==='folder'&&row.id===item.id);const children=[];add(item.scripts,match?match.scripts:children);if(!match&&children.length)target.push({...item,scripts:children});}else if(!replacements.has(item.id))target.push(item)}}
  add(prepared,result);return {trees:normalizeScriptTrees(result),decisions,incoming:imports,selections:clone(selections),targets:candidates.map(row=>({id:row.id,name:row.name,scope:row.updateScope||'',installed:installed.some(item=>item.id===row.id)}))};
}
export function scriptScopeTrees(chat, cardScripts = []) {
  const preset = chat?.runtimePresetSnapshot || {}
  const library = preset.scriptLibrary || {}
  return clone(chat?.tavernScriptTrees || { global: library.global || [], preset: library.preset || presetHelperScripts(preset.compatibilityPresetDocument),
    character: library.characters?.[chat?.cardPath] || stripScriptResourceIds(cardScripts), chat: [] })
}
/** Freeze only this card's scripts when a game is admitted. */
export function pinScriptScopeSnapshot(preset,cardPath,cardScripts=[]) {
  if(!preset&&!cardScripts.length)return null
  if(preset&&!preset.scriptLibrary&&!cardScripts.length&&!presetHelperScripts(preset.compatibilityPresetDocument).length)return clone(preset)
  const base=clone(preset||{presetPath:'',presetName:'内置设置',front:{entries:[],text:''},middle:{entries:[],text:''},back:{entries:[],text:''},sources:[],regexSources:[],regexScripts:[]})
  const library=base.scriptLibrary||{}
  const character=clone(library.characters?.[cardPath]??stripScriptResourceIds(cardScripts))
  base.scriptLibrary={...library,global:library.global||[],preset:library.preset||presetHelperScripts(base.compatibilityPresetDocument),characters:{[cardPath]:character}}
  base.scriptLibrary.digest=hash({global:base.scriptLibrary.global,preset:base.scriptLibrary.preset,character})
  return base
}
import {mutableJsonDraft,finishJsonDraft,immutableJsonSnapshot} from './json-draft.js'
import {isFrozenJson} from './readonly-json.js'
const emptyResolutionPart=immutableJsonSnapshot({}),emptyResolutionScripts=immutableJsonSnapshot([]),resolvedScriptCache=new WeakMap()
export function resolveTavernScripts(chat,cardScripts){
 const source=finishJsonDraft(chat?.tavernScriptTrees||chat?.runtimePresetSnapshot||emptyResolutionPart),metadata=finishJsonDraft(chat?.tavernScriptMetadata||emptyResolutionPart),card=finishJsonDraft(cardScripts||emptyResolutionScripts),cardPath=chat?.cardPath||''
 if(!isFrozenJson(source)||!isFrozenJson(metadata)||!isFrozenJson(card))return resolveTavernScriptsUncached(chat,cardScripts)
 const versions=resolvedScriptCache.get(source)||[],cached=versions.find(row=>row.metadata===metadata&&row.card===card&&row.cardPath===cardPath)
 if(cached)return mutableJsonDraft(cached.value)
 const value=immutableJsonSnapshot(resolveTavernScriptsUncached(chat,cardScripts));versions.push({metadata,card,cardPath,value});if(versions.length>8)versions.shift();resolvedScriptCache.set(source,versions)
 return mutableJsonDraft(value)
}
function resolveTavernScriptsUncached(chat, cardScripts) {
  const trees = scriptScopeTrees(chat, cardScripts), byId = new Map(), diagnostics = []
  for (const scope of scopes) for (const item of flattenScriptTrees(trees[scope])) {
    const previous = byId.get(item.id)
    if (previous) diagnostics.push({ scriptId: item.id, status: 'override', message: scope + ' 覆盖 ' + previous.scope + ' 中相同 ID 的脚本' })
    byId.set(item.id, { ...item, scope })
  }
  const scripts = []
  for (const item of byId.values()) {
    const mvu = inspectCardMvuDeclaration(item)
    const adapter = isHostOwnedMvu(item) && !mvu?.explicit ? 'mvu' : mvu?.explicit ? null : nativeScriptAdapter(item)
    if (adapter && adapter !== 'izumi-controls') diagnostics.push({ scriptId: item.id, name: item.name, status: 'host-owned', message: '由原生 ' + adapter + ' 运行，不重复启动脚本' })
    else {
      const metadata = chat?.tavernScriptMetadata?.[item.id] || {}
      scripts.push({ ...item, ...(metadata.info === undefined ? {} : { info: metadata.info }), ...(metadata.buttons ? { button: { ...item.button, buttons: metadata.buttons } } : {}) })
    }
  }
  return { trees, scripts, diagnostics }
}
export function createTavernScriptLibrary({ store, chats, readCardScripts, historyBytes=256*1024*1024, resourceVariableDefault=async()=>false, isBusy=chat=>Object.values(chat.timeline?.operations||{}).some(op=>op.status==='running') }) {
  const file = 'tavern-script-library.json'
  const state = async () => await (store.readReadonly||store.readJson)(file) || { version: 1, revision: 0, scopes: {}, history: [] }
  function retainHistory(rows){
    const latest=new Map();for(const row of rows)latest.set(row.scope,row)
    const kept=[...latest.values()]
    if(Buffer.byteLength(JSON.stringify(kept))>historyBytes)throw new Error('脚本历史备份超过容量上限，原数据和已有备份均已保留；请先导出备份并缩减脚本')
    return kept
  }
  function retainLocalHistory(rows){
    const counts=new Map(),kept=[]
    for(const row of rows.slice().reverse()){const count=counts.get(row.scope)||0;if(count<3){kept.push(row);counts.set(row.scope,count+1)}}
    kept.reverse()
    if(Buffer.byteLength(JSON.stringify(kept))>historyBytes)throw new Error('脚本历史备份超过容量上限，原数据和已有备份均已保留；请先导出备份并缩减脚本')
    return kept
  }
  function checkLocalRevision(current,expectedLifecycleRevision,options){
    if(Number(current.tavernHelperLifecycleRevision||0)!==Number(expectedLifecycleRevision))throw new Error('本局版本已变化，请刷新')
    if(options.expectedTreeRevision!==undefined&&Number(current.tavernScriptTreeRevision||0)!==Number(options.expectedTreeRevision))throw new Error('本局脚本集合已变化，请刷新')
    if(options.expectedConfigRevision!==undefined&&Number(current.playConfigRevision||0)!==Number(options.expectedConfigRevision))throw new Error('本局设置已变化，请刷新')
    if(isBusy(current))throw new Error('请等待当前任务结束后再重载脚本')
  }
  function localArchive(current,scope,trees){return {id:randomUUID(),scope,revision:Number(current.tavernHelperLifecycleRevision)||0,at:Date.now(),digest:hash(trees),trees:clone(trees)}}
  function finishLocalChange(current,trees){
    current.tavernScriptTrees=trees
    current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1
    current.tavernScriptTreeRevision=Number(current.tavernScriptTreeRevision||0)+1
    current.playConfigRevision=Number(current.playConfigRevision||0)+1
    delete current.resolvedRuntimePreset;delete current.preparedForegroundFrame
    return current
  }
  async function context(sessionId) {
    const chat = sessionId ? await chats.forSession(sessionId) : null
    return { chat, card: chat ? await readCardScripts(chat) : [] }
  }
  function key(scope, chat) {
    if (!scopes.includes(scope)) throw new Error('脚本作用域无效')
    if (scope === 'global') return scope
    if (!chat) throw new Error('请先进入一局游玩')
    if (scope === 'chat') return 'chat'
    const path = scope === 'preset' ? chat.runtimePresetSnapshot?.presetPath : chat.cardPath
    if (!path) throw new Error('当前局没有绑定' + (scope === 'preset' ? '外部预设' : '角色卡'))
    return scope + ':' + path
  }
  function cardTree(current,card,previousMembers=[],apiDefault=false) {
    const incoming=stripScriptResourceIds(card||[])
    const planned=planScriptUpdate(current,incoming)
    const members=scriptNodes(incoming).map(item=>{const row=scriptNodes(planned.trees).find(row=>row.updateSource?.importedId===item.id||row.id===item.id);return {sourceId:item.id,id:row.id,resourceId:row._dshResourceId||'',enabled:item.enabled!==false}})
    const removed=new Set(previousMembers.filter(row=>!members.some(next=>next.id===row.id)).map(row=>row.id))
    const sourceById=new Map(members.map(row=>[row.id,row])),previousById=new Map(previousMembers.map(row=>[row.id,row]))
    function project(rows){return rows.filter(row=>!removed.has(row.id)).map(row=>{if(row.type==='folder')return {...row,scripts:project(row.scripts)};const next=sourceById.get(row.id),prior=previousById.get(row.id);return next&&prior&&row.enabled===prior.enabled?{...row,enabled:next.enabled}:row})}
    const trees=admitNormalizedScriptTrees(project(planned.trees),current,false,planned.decisions.filter(row=>row.kind!=='add').map(row=>row.id),apiDefault)
    // Update provenance timestamps do not create a new executable version.
    const comparable=rows=>rows.map(({updateSource,_dshResourceId,...row})=>row.type==='folder'?{...row,scripts:comparable(row.scripts)}:row)
    return scriptNodes(current).every(item=>item._dshResourceId)&&hash(comparable(trees))===hash(comparable(normalizeScriptTrees(current)))?current:trees
  }
  async function cardReplacement(chat) {
    const card=await readCardScripts(chat),trees=scriptScopeTrees(chat,card)
    const character=cardTree(trees.character||[],card,[],await resourceVariableDefault('character',chat))
    if(character===trees.character)return {}
    return {tavernScriptTrees:{...trees,character},tavernHelperLifecycleRevision:Number(chat.tavernHelperLifecycleRevision||0)+1,
      tavernScriptTreeRevision:Number(chat.tavernScriptTreeRevision||0)+1}
  }
  const followCache=new WeakMap()
  async function follow(chat,modes={}) {
    let saved=await state();const raw=await readCardScripts(chat),cardDigest=hash(raw)
    const path=chat.cardPath,origin=saved.cardVersions?.[path],characterKey='character:'+path,characterApiDefault=await resourceVariableDefault('character',chat)
    const presetPath=chat.runtimePresetSnapshot?.presetPath,embedded=presetHelperScripts(chat.runtimePresetSnapshot?.compatibilityPresetDocument),presetKey='preset:'+presetPath,embeddedDigest=hash(embedded)
    const presetApiDefault=presetPath?await resourceVariableDefault('preset',chat):false
    const followsPreset=presetPath&&chat.resourceBindings?.preset?.mode!=='pinned'&&modes.preset!=='pinned'
    if(path&&origin!==cardDigest||followsPreset&&saved.presetVersions?.[presetPath]!==embeddedDigest){
      await store.updateJson(file,value=>{
        let current=value||{version:1,revision:0,scopes:{},history:[]},changed=false
        // Both decisions use the latest locked value, never the pre-lock read.
        if(path&&current.cardVersions?.[path]!==cardDigest){
          const prior=current.scopes[characterKey]
          const update=!prior||current.cardVersions?.[path]!==undefined||chat.cardScriptsDigest!==cardDigest
          const trees=update?cardTree(prior||scriptScopeTrees(chat,raw).character||[],raw,current.embeddedMembers?.[characterKey]||[],characterApiDefault):prior
          const members=embeddedMembership(raw,trees)
          current={...current,embeddedMembers:{...current.embeddedMembers,[characterKey]:members},revision:current.revision+1,cardVersions:{...current.cardVersions,[path]:cardDigest},scopes:update?{...current.scopes,[characterKey]:trees}:current.scopes};changed=true
        }
        if(followsPreset&&current.presetVersions?.[presetPath]!==embeddedDigest){
          const prior=current.scopes[presetKey]||scriptScopeTrees(chat,raw).preset||[],trees=cardTree(prior,embedded,current.embeddedMembers?.[presetKey]||[],presetApiDefault)
          const members=embeddedMembership(embedded,trees)
          current={...current,revision:current.revision+1,presetVersions:{...current.presetVersions,[presetPath]:embeddedDigest},embeddedMembers:{...current.embeddedMembers,[presetKey]:members},scopes:{...current.scopes,[presetKey]:trees}};changed=true
        }
        return changed?current:undefined
      });saved=await state()
    }
    const source=finishJsonDraft(chat.tavernScriptTrees),modeKey=JSON.stringify(modes),preset=finishJsonDraft(chat.runtimePresetSnapshot?.compatibilityPresetDocument)
    const cacheable=source&&isFrozenJson(source)&&isFrozenJson(saved)&&isFrozenJson(raw)
    const cached=cacheable?followCache.get(source):null
    if(cached&&cached.saved===saved&&cached.card===raw&&cached.preset===preset&&cached.modeKey===modeKey)return cached.result
    const trees=scriptScopeTrees(chat,raw),current=trees
    function preserveData(incoming,previous){const byId=new Map(scriptNodes(previous).map(item=>[item.id,item]));function visit(item){if(item.type==='folder')return {...item,scripts:item.scripts.map(visit)};const old=byId.get(item.id);return old?{...preserveLegacyVariableScope(item,old,chat),data:{...item.data,...old.data}}:item}return clone(incoming).map(visit)}
    for(const scope of scopes.filter(scope=>scope!=='chat')){
      if(modes[scope]==='pinned')continue
      let incoming;try{incoming=saved.scopes[key(scope,chat)]}catch{}
      if(incoming===undefined&&scope==='preset')incoming=presetHelperScripts(chat.runtimePresetSnapshot?.compatibilityPresetDocument)
      if(incoming===undefined&&scope==='character')incoming=cardTree(current.character||[],raw,[],characterApiDefault)
      if(incoming!==undefined)trees[scope]=preserveData(incoming,current[scope]||[])
    }
    const result={trees:isDeepStrictEqual(trees,chat.tavernScriptTrees)?chat.tavernScriptTrees:trees,revision:saved.revision,cardDigest}
    if(cacheable)followCache.set(source,{saved,card:raw,preset,modeKey,result})
    return result
  }
  async function versionStatus(chat,current) {
    const saved=await state(),changes=[]
    for(const scope of scopes.filter(scope=>scope!=='chat')){
      let library;try{library=saved.scopes[key(scope,chat)]}catch{continue}
      if(!library)continue
      const before=new Map(scriptNodes(current[scope]).map(item=>[item.id,item]))
      for(const item of scriptNodes(library)){const old=before.get(item.id);if(!old||old.content!==item.content||old.name!==item.name||old.enabled!==item.enabled||JSON.stringify(old.button)!==JSON.stringify(item.button))changes.push(item.id);before.delete(item.id)}
      changes.push(...before.keys())
    }
    return {available:changes.length>0,revision:saved.revision,lifecycleRevision:chat?.tavernHelperLifecycleRevision||0}
  }
  // Shared by the read-only already-applied check and the existing write path.
  // Keep owner, legacy scope and local data preservation identical in both.
  function applicationTrees(current, saved, card, selectedScopes, characterApiDefault) {
    const trees = scriptScopeTrees(current, card)
    for (const scope of selectedScopes) {
      try { if (saved.scopes[key(scope, current)]) trees[scope] = clone(saved.scopes[key(scope, current)]).map(function preserve(item){if(item.type==='folder')return {...item,scripts:item.scripts.map(preserve)};const previous=scriptNodes(trees[scope]).find(row=>row.id===item.id);return previous?{...preserveLegacyVariableScope(item,previous,current),data:{...item.data,...previous.data}}:item});else if(scope==='character')trees.character=cardTree(trees.character||[],card,[],characterApiDefault) } catch(error) { if(scope==='character')throw error }
    }
    return trees
  }
  async function get(sessionId,{includeApplyStatus=false}={}) {
    const saved = await state(), { chat, card } = await context(sessionId)
    const current = scriptScopeTrees(chat, card), library = {},characterApiDefault=chat?await resourceVariableDefault('character',chat):false
    for (const scope of scopes) {
      try { library[scope] = scope === 'chat' ? current.chat : saved.scopes[key(scope, chat)] ?? (scope==='character'&&chat?cardTree(current[scope]||[],card,[],characterApiDefault):current[scope]) }
      catch { library[scope] = current[scope] || [] }
    }
    const changes=[]
    for(const scope of scopes){const before=new Map(scriptNodes(current[scope]).map(item=>[item.id,item]));for(const item of scriptNodes(library[scope])){const old=before.get(item.id);if(!old||old.content!==item.content||old.name!==item.name||old.enabled!==item.enabled)changes.push({scope,id:item.id,name:item.name,kind:old?'update':'add'});before.delete(item.id)}for(const item of before.values())changes.push({scope,id:item.id,name:item.name,kind:'remove'})}
    const resolved=resolveTavernScripts(chat,card)
    const applicationStatus = includeApplyStatus ? {appliedToCurrent:!!chat && isDeepStrictEqual(current,applicationTrees(chat,saved,card,scopes.filter(scope=>scope!=='chat'),characterApiDefault))} : {}
    return { ...applicationStatus, configRevision:Number(chat?.playConfigRevision)||0,versionStatus:{mode:'follow',scopes:{global:'follow',preset:'follow',character:'follow',...chat?.resourceBindings?.scripts},available:changes.length>0,changes},revision: saved.revision, current, library, lifecycleRevision: chat?.tavernHelperLifecycleRevision || 0,
      digest: hash(current), history: (chat?.tavernScriptHistory||[]).concat(saved.history).map(({ trees, ...item }) => item), diagnostics: resolved.diagnostics.concat(projectTavernHelperScripts(resolved.scripts).diagnostics.filter(row=>row.status==='patch-missed')) }
  }
  async function change(sessionId, command, expectedRevision, {confirmedUpdateIds = []} = {}) {
    const { chat, card } = await context(sessionId), scope = command.scope || 'chat', scopeKey = key(scope, chat),apiDefault=chat?await resourceVariableDefault(scope,chat):false
    if (scope === 'chat') {
      await chats.update(chat.id, current => {
        if (Number(current.tavernHelperLifecycleRevision || 0) !== Number(command.expectedLifecycleRevision)) throw new Error('本局脚本版本已变化，请刷新')
        const trees = scriptScopeTrees(current, card)

        if(command.restore){const version=(current.tavernScriptHistory||[]).find(v=>v.id===command.restore&&v.scope==='chat');if(!version)throw new Error('找不到此版本');command={...command,trees:version.trees};}
        current.tavernScriptHistory=retainLocalHistory((current.tavernScriptHistory||[]).concat([{id:randomUUID(),scope:'chat',revision:Number(current.tavernHelperLifecycleRevision)||0,at:Date.now(),digest:hash(trees.chat),trees:clone(trees.chat)}]));
        trees.chat = admitScriptTrees(command.trees,trees.chat,!!command.restore,confirmedUpdateIds,apiDefault)
        current.tavernScriptTrees = trees
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      return current
      }, { source: 'scripts.chat' })
    } else {
      const embedded = scope === 'character' ? card : scope === 'preset' ? presetHelperScripts(chat?.runtimePresetSnapshot?.compatibilityPresetDocument) : null
      await store.updateJson(file, value => {
        const saved = value || { version: 1, revision: 0, scopes: {}, history: [] }
        if (saved.revision !== expectedRevision) throw new Error('脚本库已变化，请刷新后重试')
        const restored = command.restore ? saved.history.find(h => h.id === command.restore && h.scope === scopeKey) : null
        if (command.restore && !restored) throw new Error('找不到此版本')
        const previousTrees = saved.scopes[scopeKey] || scriptScopeTrees(chat,card)[scope] || []
        const trees = admitScriptTrees(restored ? restored.trees : command.trees,restored?restored.trees:previousTrees,!!restored,confirmedUpdateIds,apiDefault)
        // Saving a card/preset scope before any follow pins identities. Without
        // membership the embedded scripts would lose the grant they inherit until
        // some later follow records it, mid-event included (Z76 rework).
        const members = embedded && saved.embeddedMembers?.[scopeKey] === undefined ? { embeddedMembers: { ...saved.embeddedMembers, [scopeKey]: embeddedMembership(embedded, trees) } } : {}
        return { ...saved, ...members, revision: saved.revision + 1, scopes: { ...saved.scopes, [scopeKey]: trees },
          history: retainHistory([...saved.history, { id: randomUUID(), scope: scopeKey, revision: saved.revision, at: Date.now(), digest: hash(previousTrees), trees: previousTrees }]) }
      })
    }
    return await get(sessionId)
  }
  async function apply(sessionId, expectedLifecycleRevision, options={}) {
    const selectedScopes=options.scopes===undefined?scopes.filter(scope=>scope!=='chat'):options.scopes
    if(!Array.isArray(selectedScopes)||!selectedScopes.length||new Set(selectedScopes).size!==selectedScopes.length||selectedScopes.some(scope=>!scopes.includes(scope)||scope==='chat'))throw new Error('脚本作用域无效')
    if(options.mode!==undefined&&!['follow','pinned'].includes(options.mode))throw new Error('资源模式无效')
    const { chat, card } = await context(sessionId)
    if (!chat) throw new Error('请先进入一局游玩')
    const saved = await state(),characterApiDefault=await resourceVariableDefault('character',chat)
    if(options.expectedLibraryRevision!==undefined&&saved.revision!==options.expectedLibraryRevision)throw new Error('脚本库已变化，请重新预览')
    await chats.update(chat.id, async current => {
      checkLocalRevision(current,expectedLifecycleRevision,options)
      const latest=await state();if(options.expectedLibraryRevision!==undefined&&latest.revision!==options.expectedLibraryRevision)throw new Error('脚本库已变化，请重新预览');if(latest.revision!==saved.revision||hash(latest.scopes)!==hash(saved.scopes))throw new Error('脚本库已变化，请重新预览')
      const before=scriptScopeTrees(current,card),trees=applicationTrees(current,saved,card,selectedScopes,characterApiDefault)
      current.tavernScriptHistory=retainLocalHistory((current.tavernScriptHistory||[]).concat(selectedScopes.filter(scope=>!isDeepStrictEqual(before[scope],trees[scope])).map(scope=>localArchive(current,scope,before[scope]))))
      if(options.mode)current.resourceBindings={...current.resourceBindings,version:1,scripts:{...current.resourceBindings?.scripts,...Object.fromEntries(selectedScopes.map(scope=>[scope,options.mode]))}}
      // Legacy callers pass no selection and use lifecycle as their only token.
      if(options.scopes===undefined){current.tavernScriptTrees=trees;current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1;return current}
      return finishLocalChange(current,trees)
    }, { source: 'scripts.apply' })
    return await get(sessionId)
  }
  async function restoreLocal(sessionId,options){
    const {scope,archiveId,expectedLifecycleRevision}=options
    if(!scopes.includes(scope)||scope==='chat')throw new Error('本局恢复只支持共享脚本作用域；本局脚本请用原恢复入口')
    const {chat,card}=await context(sessionId);if(!chat)throw new Error('请先进入一局游玩')
    const saved=await state();if(options.expectedLibraryRevision!==undefined&&saved.revision!==options.expectedLibraryRevision)throw new Error('脚本库已变化，请刷新')
    await chats.update(chat.id,async current=>{
      checkLocalRevision(current,expectedLifecycleRevision,options)
      const latest=await state();if(latest.revision!==saved.revision||hash(latest.scopes)!==hash(saved.scopes))throw new Error('脚本库已变化，请刷新')
      const archive=(current.tavernScriptHistory||[]).find(row=>row.id===archiveId&&row.scope===scope)
      if(!archive)throw new Error('找不到此作用域的本局版本')
      const trees=scriptScopeTrees(current,card)
      const restored=normalizeScriptTrees(archive.trees)
      current.tavernScriptHistory=retainLocalHistory((current.tavernScriptHistory||[]).concat([localArchive(current,scope,trees[scope])]))
      trees[scope]=restored
      current.resourceBindings={...current.resourceBindings,version:1,scripts:{...current.resourceBindings?.scripts,[scope]:'pinned'}}
      return finishLocalChange(current,trees)
    },{source:'scripts.restore-local'})
    return get(sessionId)
  }
  async function snapshot(preset) {
    const saved = await state()
    if (!preset && !Object.keys(saved.scopes).length) return null
    preset ||= { presetPath: '', presetName: '内置设置', front: { entries: [], text: '' }, middle: { entries: [], text: '' }, back: { entries: [], text: '' }, sources: [], regexSources: [], regexScripts: [] }
    return { ...preset, scriptLibrary: { revision: saved.revision, global: clone(saved.scopes.global || []),
      preset: clone(saved.scopes['preset:' + preset?.presetPath] || presetHelperScripts(preset?.compatibilityPresetDocument)),
      characters: Object.fromEntries(Object.entries(saved.scopes).filter(([k]) => k.startsWith('character:')).map(([k, v]) => [k.slice(10), clone(v)])) } }
  }
  async function runtimeEdit(sessionId, command, lifecycleRevision, scriptId, {ownMetadataOnly = false} = {}) {
    if (ownMetadataOnly && command.kind !== 'metadata') throw new Error('修改脚本集合需要卡片授权')
    const { chat, card } = await context(sessionId)
    if (!chat) throw new Error('当前游戏不存在')
    let result
    await chats.update(chat.id, current => {
      if (Number(current.tavernHelperLifecycleRevision || 0) !== Number(lifecycleRevision || 0)) throw new Error('脚本生命周期已变化')
      const trees = scriptScopeTrees(current, card)
      if (!(scriptId === '__dsh_official_mvu__' && current.mvu?.enabled) && !resolveTavernScripts(current, card).scripts.some(s => s.id === scriptId && s.enabled !== false)) throw new Error('脚本不存在或已经停用')
      if (command.kind === 'metadata') {
        if (!(scriptId === '__dsh_official_mvu__' && current.mvu?.enabled) && !resolveTavernScripts(current, card).scripts.some(s => s.id === scriptId)) throw new Error('脚本不存在')
        const value = { ...(current.tavernScriptMetadata?.[scriptId] || {}) }
        if (command.info !== undefined) value.info = String(command.info)
        if (command.buttons !== undefined) {
          if (!Array.isArray(command.buttons) || command.buttons.some(b => typeof b?.name !== 'string')) throw new Error('按钮格式无效')
          value.buttons = clone(command.buttons)
        }
        current.tavernScriptMetadata = { ...current.tavernScriptMetadata, [scriptId]: value }
      } else {
        if (!scopes.includes(command.scope)) throw new Error('脚本作用域无效')
        if (Number(current.tavernScriptTreeRevision || 0) !== Number(command.expectedRevision || 0)) throw new Error('脚本集合已被修改，请重新读取')
        if(command.scope!=='chat')current.resourceBindings={...current.resourceBindings,version:1,scripts:{...current.resourceBindings?.scripts,[command.scope]:'pinned'}}
        trees[command.scope] = admitScriptTrees(command.trees,trees[command.scope])
        current.tavernScriptTrees = trees
        current.tavernScriptTreeRevision = Number(current.tavernScriptTreeRevision || 0) + 1
      }
      result = { updated: true, context: { chatId: current.id, lifecycleRevision: Number(current.tavernHelperLifecycleRevision || 0), scriptTrees: trees,
        scriptTreeRevision: Number(current.tavernScriptTreeRevision || 0), scriptMetadata: clone(current.tavernScriptMetadata || {}) } }
      return current
    }, { source: 'scripts.runtime', coalesce: command.kind === 'metadata' })
    if (ownMetadataOnly) {
      delete result.context.scriptTrees
      result.context.scriptMetadata = {[scriptId]: result.context.scriptMetadata[scriptId]}
    }
    return result
  }
  async function planImport(sessionId,scope,document,name,existing,verifiedSource,selections={}) {
    const {chat,card}=await context(sessionId),saved=await state(),scopeKey=key(scope,chat),current=scriptScopeTrees(chat,card);
    const latest=scope==='chat'?current.chat:saved.scopes[scopeKey]??current[scope];
    const archives=scope==='chat'?(chat.tavernScriptHistory||[]):saved.history.filter(h=>h.scope===scopeKey);
    const previous=archives.slice().reverse().flatMap(h=>h.trees).concat(current[scope]||[]);
    const others=scopes.filter(s=>s!==scope).reverse().flatMap(other=>{
      let scopeTrees=current[other]||[];
      try { if(other!=='chat')scopeTrees=saved.scopes[key(other,chat)]??scopeTrees; } catch {}
      return scriptNodes(scopeTrees).map(item=>({...item,updateScope:other}));
    });
    const imported=importScriptTrees(document,name)
    // Filenames and imported provenance are labels, not proof of update identity.
    // Local replacements are confirmed by the host's existing import preview.
    for(const item of scriptNodes(imported))item._dshSource=verifiedSource || ''
    const result=planScriptUpdate(existing??latest,imported,previous.concat(others),selections);
    result.variableReview=inspectImportedVariables(imported,'脚本');
    const ownIds=new Set(scriptNodes((existing??latest)||[]).concat(scriptNodes(previous)).map(item=>item.id));
    for(const decision of result.decisions){const owner=others.find(item=>item.id===decision.id);if(owner&&!ownIds.has(decision.id))Object.assign(decision,{kind:'override',previousScope:owner.updateScope});}
    return result;
  }
  async function resourceId(chat,script) {
    if(script?._dshResourceId)return script._dshResourceId
    if(!script?.scope)return ''
    const saved=await state()
    // Match pre-identity game snapshots to exact installed code in their own
    // scope. An imported script ID alone never confers the installed grant.
    let scopeKey;try{scopeKey=key(script.scope,chat)}catch{return ''}
    const rows=script.scope==='chat'?scriptNodes(chat.tavernScriptTrees?.chat):scriptNodes(saved.scopes[scopeKey])
    const old=rows.find(item=>item.id===script.id && item.content===script.content)
    return old?._dshResourceId || ''
  }
  async function embeddedOwner(chat,script) {
    if(!['character','preset'].includes(script?.scope))return null
    const scopeKey=key(script.scope,chat),saved=await state(),id=await resourceId(chat,script)
    const member=saved.embeddedMembers?.[scopeKey]?.find(row=>row.id===script.id)
    const owner=script.scope==='character'?{kind:'card',path:chat.cardPath}:{kind:'preset',path:chat.runtimePresetSnapshot?.presetPath}
    if(member?.resourceId)return member.resourceId===id?owner:null
    // Upgrade earlier host records only with exact source/code evidence. A file
    // claiming a familiar ID, or a deleted/recreated installed identity, is not proof.
    const raw=script.scope==='character'?await readCardScripts(chat):presetHelperScripts(chat.runtimePresetSnapshot?.compatibilityPresetDocument)
    const source=scriptNodes(raw).find(row=>row.id===(member?.sourceId||script.id))
    if(!source||source.content!==script.content)return null
    if(id){const installed=scriptNodes(saved.scopes[scopeKey]).find(row=>row.id===script.id);if(!member||installed?._dshResourceId!==id||installed.content!==source.content)return null}
    return owner
  }
  return { get, change, apply, restoreLocal, snapshot, runtimeEdit, planImport, resourceId, embeddedOwner, cardReplacement, versionStatus, follow }
}
