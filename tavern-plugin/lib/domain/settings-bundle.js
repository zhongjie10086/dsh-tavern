import { validatePromptOverrides } from './system-prompt-sets.js'
import { omitNativePresetConnectionFields } from './helper-native-presets.js'

const kinds = ['preset','systemPrompts','preferences']
const secrets = /(?:api[_-]?keys?|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|credentials)$/i
// Filter identified data fields only. Opaque prompt/script/URL text stays intact;
// this is deliberately not a claim to detect arbitrary embedded secrets.
export function withoutCredentials(value) {
  if (Array.isArray(value)) return value.map(withoutCredentials)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secrets.test(key)).map(([key,item]) => [key,withoutCredentials(item)]))
}
export function createSettingsBundle(parts) {
  const resources = []
  for (const kind of kinds) {
    if (parts[kind] === undefined) continue
    for (const item of Array.isArray(parts[kind]) ? parts[kind] : [parts[kind]]) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) throw Error('组合资源缺少名称')
      resources.push({kind,name:item.name,document:withoutCredentials(kind==='preset'?omitNativePresetConnectionFields(item.document):item.document)})
    }
  }
  if (!resources.length) throw Error('请选择至少一项导出内容')
  return {spec:'dsh-tavern.settings-bundle',version:1,resources}
}
export function inspectSettingsBundle(payload) {
  let bundle
  try { bundle = typeof payload === 'string' ? JSON.parse(payload) : structuredClone(payload) } catch { throw Error('组合文件 JSON 无效') }
  if (bundle?.spec !== 'dsh-tavern.settings-bundle' || bundle.version !== 1 || !Array.isArray(bundle.resources) || !bundle.resources.length || bundle.resources.length > 200) throw Error('组合文件格式无效')
  const resources = bundle.resources.map(item => {
    if (!kinds.includes(item?.kind) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 || !item.document || typeof item.document !== 'object' || Array.isArray(item.document)) throw Error('组合资源无效')
    const document = withoutCredentials(item.kind==='preset'?omitNativePresetConnectionFields(item.document):item.document)
    if (item.kind === 'systemPrompts') {
      if (document.spec !== 'dsh-tavern.system-prompts' || document.version !== 1 || !document.prompts || typeof document.prompts !== 'object') throw Error('系统提示词格式无效')
      validatePromptOverrides(Array.isArray(document.prompts) ? Object.fromEntries(document.prompts.map(prompt => [prompt.name,prompt.text])) : document.prompts)
    }
    if (item.kind === 'preferences' && document.spec !== 'dsh-tavern.user-preference-profile') throw Error('长期偏好格式无效')
    return {kind:item.kind,name:item.name,document}
  })
  return { ...bundle, resources }
}
// Existing format owners perform the writes. The import never selects or overwrites implicitly.
export async function importSettingsBundle(payload, { selected, conflicts = {}, importers }) {
  const bundle = inspectSettingsBundle(payload)
  const indexes = selected === undefined ? bundle.resources.map((_,index) => index) : selected
  if (!Array.isArray(indexes) || indexes.some(index => !Number.isInteger(index) || !bundle.resources[index])) throw Error('导入选择无效')
  const plan = [...new Set(indexes)].map(index => {
    const item = bundle.resources[index], choice = conflicts[index] || {action:'new'}
    if (!['new','replace','skip'].includes(choice.action)) throw Error('导入冲突处理无效')
    if (choice.action === 'replace' && (choice.confirmed !== true || !choice.target)) throw Error('覆盖导入需要明确选择目标并确认')
    if (choice.action !== 'skip' && typeof importers[item.kind] !== 'function') throw Error('此资源导入未连接: ' + item.kind)
    return {index,item,choice}
  })
  const results = []
  for (const {index,item,choice} of plan) {
    if (choice.action === 'skip') { results.push({index,skipped:true}); continue }
    // Stop with partial receipts: do not hide failures or retry completed imports.
    try { results.push({index,result:await importers[item.kind](item,{...choice,select:false})}) }
    catch (error) { return {results,error:'导入失败: ' + item.name + '：' + error.message,failedIndex:index} }
  }
  return {results}
}
