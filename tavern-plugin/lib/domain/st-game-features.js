import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import { nativeRegexScriptsOf, regexScriptsOf } from './preset-reading.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

const clone = value => value === undefined ? undefined : structuredClone(value)
const str = value => typeof value === 'string' ? value : ''

export function gameRegexScripts(snapshot) {
  const document = snapshot?.compatibilityPresetDocument
  if (!document) {
    const rules=snapshot?.regexScripts || [],legacy=(snapshot?.migration?.globalRegexScripts || []).filter(rule=>rule.enabled)
    return legacy.length && isDeepStrictEqual(rules.slice(0,legacy.length),legacy) ? rules.slice(legacy.length) : rules
  }
  const native = nativeRegexScriptsOf(document)
  return native.length ? native : regexScriptsOf(document)
}


function regexKeys(snapshot) {
  const scripts=gameRegexScripts(snapshot),document=snapshot?.compatibilityPresetDocument
  const raw=document?.extensions?.regex_scripts?.length?document.extensions.regex_scripts:document?.extensions?.SPreset?.RegexBinding?.regexes||[]
  return scripts.map((script,index)=>{
    const id=String(raw[index]?.id||''),name=String(raw[index]?.scriptName||script.name||'')
    const key=id&&raw.filter(item=>String(item.id||'')===id).length===1?'id:'+encodeURIComponent(id)
      :name&&scripts.filter(item=>item.name===name).length===1?'name:'+encodeURIComponent(name)
      :'content:'+createHash('sha256').update(JSON.stringify(script)).digest('hex')+':'+scripts.slice(0,index).filter(item=>isDeepStrictEqual(item,script)).length
    return {key,script,index,id,name}
  })
}
/** Explicit overrides remap by evidence; ambiguous/deleted entries keep the prior usable preset. */
export function remapGamePresetControls(controls,before,after) {
  const next=clone(controls),unmatched=[];next.entries={};next.regexes={}
  const oldEntries=before?.compatibilityPreset?.entries||[],newEntries=after?.compatibilityPreset?.entries||[]
  for(const [key,value]of Object.entries(controls.entries||{})){
    const old=oldEntries.find(entry=>entry.entryKey===key)
    let found=old?newEntries.filter(entry=>entry.identifier===old.identifier):[]
    if(found.length>1||oldEntries.filter(entry=>entry.identifier===old?.identifier).length>1)found=found.filter(entry=>entry.name===old.name&&entry.role===old.role&&entry.content===old.content)
    if(found.length===1)next.entries[found[0].entryKey]=value;else unmatched.push(old?.name||key)
  }
  const oldRegex=regexKeys(before),newRegex=regexKeys(after)
  for(const [key,value]of Object.entries(controls.regexes||{})){
    const old=oldRegex.find(item=>item.key===key)||(/^\d+$/.test(key)?oldRegex[Number(key)]:null)
    let found=old?newRegex.filter(item=>item.key===old.key):[]
    if(found.length!==1&&old?.id)found=newRegex.filter(item=>item.id===old.id)
    if(found.length===1)next.regexes[found[0].key]=value;else unmatched.push(old?.name||key)
  }
  return {controls:next,unmatched}
}

export function effectiveGamePreset(chat) {
  const snapshot = chat?.runtimePresetSnapshot
  if (!snapshot) return null
  const controls = chat.presetControls || {}
  if (!controls.entries && !controls.regexes) return {...snapshot,regexScripts:gameRegexScripts(snapshot).filter(script=>script.enabled!==false)}
  const preset = snapshot.compatibilityPreset
  const next = clone(snapshot)
  if (preset) {
    for (const phase of ['front', 'middle', 'back']) next[phase] = { entries: [], text: '' }
    const entries = preset.entries || []
    const ordered = preset.dshPreset ? ['front','middle','back'].flatMap(phase => (preset.dshPreset[phase] || []).map(item => ({ phase,
      entry: Number.isInteger(item.source?.sourcePromptIndex) ? entries.find(entry => entry.sourcePromptIndex === item.source.sourcePromptIndex) : entries.find(entry => entry.entryKey === item.id) })))
      : entries.map(entry => ({ entry, phase: Number(entry.injectionPosition) === 1 ? 'middle' : 'front' }))
    for (const { entry, phase } of ordered) {
      if (!entry) continue
      if (!entry.ordered || entry.marker || !entry.injectable) continue
      const enabled = Object.hasOwn(controls.entries || {}, entry.entryKey) ? controls.entries[entry.entryKey] : entry.enabled !== false
      if (!enabled) continue
      next[phase].entries.push({ id: entry.entryKey, name: entry.name, role: entry.role, content: entry.content,
        source: { path: snapshot.presetPath, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name } })
    }
    for (const phase of ['front', 'middle', 'back']) next[phase].text = next[phase].entries.map(entry => entry.content).join('\n\n')
  }
  const regexes = regexKeys(snapshot)
  next.regexScripts = regexes.map(({script,key,index}) => ({ ...script,
    enabled: Object.hasOwn(controls.regexes || {}, key) ? controls.regexes[key] : Object.hasOwn(controls.regexes || {}, String(index)) ? controls.regexes[String(index)] : script.enabled !== false
  })).filter(script => script.enabled && str(script.findRegex) !== '')
  next.text = ['front', 'middle', 'back'].map(phase => next[phase]?.text || '').join('\n\n')
  return next
}

export function resolveGamePreset(chat, userText) {
  const last = [...(chat.messages || [])].reverse().find(message => message.role === 'assistant')
  return resolveRuntimePresetMacros(effectiveGamePreset(chat), { charName: chat.cardName, macroState: chat.macroState,
    lastUserMessage: str(userText), lastCharMessage: str(last?.sourceText ?? last?.text) })
}

export function gamePresetControls(chat) {
  const snapshot = chat?.runtimePresetSnapshot
  const controls = chat?.presetControls || {}
  const entries = (snapshot?.compatibilityPreset?.entries || []).filter(entry => entry.ordered && entry.injectable && !entry.marker)
    .map(entry => ({ key: entry.entryKey, name: entry.name, enabled: Object.hasOwn(controls.entries || {}, entry.entryKey) ? controls.entries[entry.entryKey] : entry.enabled !== false }))
  const regexes = regexKeys(snapshot)
    .map(({script,key,index}) => ({ key, name: script.name, enabled: Object.hasOwn(controls.regexes || {}, key) ? controls.regexes[key] : Object.hasOwn(controls.regexes || {}, String(index)) ? controls.regexes[String(index)] : script.enabled !== false }))
  return { name: snapshot?.presetName || '内置设置', izumi: snapshot?.nativeFeatures?.izumi === true,
    scope: controls.scope||'shared', resourceMode:chat?.resourceBindings?.preset?.mode||'follow', warnings:chat?.resourceBindingWarnings||[], configRevision:Number(chat?.playConfigRevision)||0, advice: controls.advice === true, colorful: controls.colorful !== false, entries, regexes,
    plans: (controls.plans || []).map(plan => ({ id: plan.id, name: plan.name })), version: Number(controls.version) || 0 }
}

export function changeGamePreset(chat, operation) {
  const view = gamePresetControls(chat)
  const controls = clone(chat.presetControls || { entries: {}, regexes: {}, plans: [] })
  controls.entries ||= {}; controls.regexes ||= {}; controls.plans ||= []
  if (operation.kind === 'entry' || operation.kind === 'regex') {
    const field = operation.kind === 'entry' ? 'entries' : 'regexes'
    if (!view[field].some(item => item.key === operation.key)) throw new Error('找不到本局预设条目')
    if (typeof operation.enabled !== 'boolean') throw new Error('开关值无效')
    controls[field][operation.key] = operation.enabled
  } else if (operation.kind === 'advice' || operation.kind === 'colorful') {
    if (typeof operation.enabled !== 'boolean') throw new Error('开关值无效')
    controls[operation.kind] = operation.enabled
  } else if (operation.kind === 'save-plan') {
    const name = str(operation.name).trim()
    if (!name) throw new Error('方案名称不能为空')
    const previous = controls.plans.find(plan => plan.name === name)
    const plan = { id: previous?.id || 'plan-' + crypto.randomUUID(), name,
      entries: clone(controls.entries), regexes: clone(controls.regexes), advice: controls.advice === true, colorful: controls.colorful !== false }
    controls.plans = controls.plans.filter(item => item.id !== plan.id).concat([plan])
  } else if (operation.kind === 'apply-plan') {
    const plan = controls.plans.find(item => item.id === operation.id)
    if (!plan) throw new Error('方案不存在')
    controls.entries = clone(plan.entries); controls.regexes = clone(plan.regexes); controls.advice = plan.advice; controls.colorful = plan.colorful
  } else if (operation.kind === 'delete-plan') {
    controls.plans = controls.plans.filter(item => item.id !== operation.id)
  } else if (operation.kind === 'reset') {
    controls.entries = {}; controls.regexes = {}; controls.advice = false; controls.colorful = true
  } else throw new Error('未知预设操作')
  controls.scope = operation.kind==='reset' ? 'shared' : 'local'
  controls.version = (Number(controls.version) || 0) + 1
  chat.presetControls = controls
  delete chat.resolvedRuntimePreset
  return chat
}

/** Old Advice saves keep the player's real text outside the placeholder message. */
export function realUserText(message) {
  return str(message?.tavernExtra?.izumi_advice?.text) || str(message?.extra?.izumi_advice?.text) || str(message?.tavernPluginData?.extra?.izumi_advice?.text) ||
    str(message?.sourceText) || str(message?.text) || str(message?.mes)
}

export function adviceFrameInput(chat, text) {
  if (chat?.presetControls?.advice !== true || !str(text).trim()) return []
  return [{ kind: 'foreground.guide', required: true,
    text: '本轮 Advice：将下面的玩家输入作为本轮演出指引，落实到接下来的剧情中。它表示希望发生的内容，不是已经发生的事实。\n<advice>\n' + str(text) + '\n</advice>',
    source: { stage: 'native-advice', scope: 'this-turn' } }]
}

export function createMigrationSettings(store, { originalTemplates = () => false } = {}) {
  const file = 'st-migration.json',settingsFile='tavern-extension-settings.json'
  async function migrate() {
    const state=await store.readJson(file)
    if(!state?.regexScripts?.length||state.globalRegexAuthority===settingsFile)return
    // Never replace an existing canonical array, including an intentional empty array.
    await store.updateJson(settingsFile,current=>{
      if(Array.isArray(current?.regex))return undefined
      return {...current,regex:state.regexScripts.map(script=>({...clone(script),scriptName:script.name,disabled:script.enabled===false}))}
    })
    await store.updateJson(file,current=>({...current,globalRegexAuthority:settingsFile,legacyRegexScripts:clone(current?.regexScripts||[]),regexScripts:[]}))
  }
  async function read() {
    await migrate()
    const state = (await store.readJson(file)) || { version: 1, regexScripts: [], companions: [], templates: [] }
    const canonical=await store.readJson(settingsFile)
    return { ...state, regexScripts:nativeRegexScriptsOf({extensions:{regex_scripts:canonical?.regex||[]}}), sources: (state.sources || []).map(({ document, ...metadata }) => metadata),
      templates: (state.templates || []).map(({ original, ...template }) => template) }
  }
  async function importConfiguration(document, name) {
    const rawRegex = Array.isArray(document) && document.some(item => item?.findRegex !== undefined) ? document
      : document?.regexScripts || document?.extensions?.regex_scripts || document?.extension_settings?.regex ||
        (document?.findRegex !== undefined ? [document] : null)
    const scripts = Array.isArray(document) && document.some(item => item?.type === 'script') ? document
      : document?.type === 'script' ? [document] : document?.scripts || document?.extension_settings?.tavern_helper?.script?.scripts
    if (!rawRegex && !Array.isArray(scripts)) throw new Error('请选择正则 JSON 或配套脚本 JSON；数据库表格请在表格页面导入。')
    const imported = { regexCount: 0, companions: [], unsupported: [] }
    if(rawRegex)await store.updateJson(settingsFile,current=>({...current,regex:clone(rawRegex)}))
    await store.updateJson(file, current => {
      const next = clone(current || { version: 1, regexScripts: [], companions: [], templates: [] })
      if (rawRegex) {
        const normalized = nativeRegexScriptsOf({ extensions: { regex_scripts: rawRegex } })
        next.regexScripts = []; next.globalRegexAuthority=settingsFile
        imported.regexCount = normalized.length
      }
      for (const script of Array.isArray(scripts) ? scripts : []) {
        const source = str(script.content)
        const adapter = source.includes('AutoCardUpdaterAPI') && /可视化前端/.test(script.name) ? 'database-workbench'
          : source.includes('AutoCardUpdaterAPI') && /灵感状态栏/.test(script.name) ? 'inspiration-panel' : ''
        if (!adapter) { imported.unsupported.push(str(script.name) || '未知脚本'); continue }
        next.companions = (next.companions || []).filter(item => item.adapter !== adapter).concat([{ adapter, name: str(script.name), enabled: script.enabled !== false }])
        imported.companions.push(str(script.name))
      }
      next.sources = (next.sources || []).filter(item => item.name !== str(name)).concat([{ name: str(name), document: clone(document), importedAt: Date.now() }])
      next.updatedAt = Date.now()
      next.sourceName = str(name)
      return next
    })
    return imported
  }
  async function snapshot(preset) {
    const state = await read()
    if (originalTemplates()) state.templates = []
    if (!state.companions?.length && !state.templates?.length && !state.databaseConfig && !state.companionConfig) return preset
    const next = clone(preset || { presetPath: '', presetName: '内置设置', front: { entries: [], text: '' }, middle: { entries: [], text: '' }, back: { entries: [], text: '' }, sources: [], regexSources: [], regexScripts: [] })
    next.migration = { version: 2, companions: clone(state.companions || []), templates: clone(state.templates || []), databaseConfig: clone(state.databaseConfig || {}), companionConfig: clone(state.companionConfig || null) }
    return next
  }
  return { read, migrate, import: importConfiguration, snapshot }
}
