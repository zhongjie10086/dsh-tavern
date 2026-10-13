import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
const copy = structuredClone
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const COMPATIBILITY_CAPABILITIES = Object.freeze(['same-origin', 'cross-card', 'shared-settings', 'shared-resources', 'network'])
const capabilities = new Set(COMPATIBILITY_CAPABILITIES)
export const READABLE_SCRIPT_SETTINGS = Object.freeze(['regex','tavern_helper','EjsTemplate','SPreset'])

/** A version fingerprint is evidence, not an expiry condition for a user's grant. */
export function cardExecutableIdentity({cardPath, card, scripts = [], regexScripts = [], preset = null}) {
  const document = card?.data || card || {}
  const htmlCode = value => [...String(value || '').matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>|\bon\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi)].map(match=>match[0])
  const cardCode = [document.description,document.personality,document.scenario,document.first_mes,...(document.alternate_greetings || []),document.mes_example].flatMap(htmlCode)
  const scriptCode = scripts.map(script => script.sourceDigest || script.content || '').sort()
  const presetCode = preset ? [preset.front?.text,preset.middle?.text,preset.back?.text].flatMap(htmlCode) : []
  regexScripts = regexScripts.map(rule=>({findRegex:rule.findRegex,replaceString:rule.replaceString}))
  return {cardPath:String(cardPath || ''), digest:hash({cardCode,scriptCode,regexScripts,presetCode})}
}

export function createCardPermissions({store, now = Date.now}) {
  const file = 'card-permissions.json'
  function document(value) {
    if (value && ![1,2].includes(value.version)) throw new Error('资源权限记录版本不受支持')
    return value || {version:2,cards:{},resources:{}}
  }
  async function read(identity) {
    const saved = document(await store.readJson(file)).cards?.[hash(identity.cardPath)]
    const grants = saved?.cardPath === identity.cardPath ? (saved.capabilities || []).filter(value => capabilities.has(value)) : []
    return {...identity, trustedCardMode:grants.includes('same-origin'), capabilities:grants, grantedAt:grants.length ? saved.grantedAt : null, codeUpdated:grants.length > 0 && typeof identity.digest === 'string' && saved.digest !== identity.digest, persistent:true}
  }
  async function change(identity, expectedDigest, requested) {
    if (!identity.cardPath || identity.digest !== expectedDigest) throw new Error('卡片可执行内容已变化，请重新读取后确认')
    if (!Array.isArray(requested) || requested.some(value => !capabilities.has(value))) throw new Error('卡片权限无效')
    await store.updateJson(file, value => {
      const current = document(value), cards = {...current.cards}
      Object.defineProperty(cards,hash(identity.cardPath),{value:{...identity,capabilities:[...new Set(requested)],grantedAt:now()},enumerable:true,configurable:true,writable:true})
      return {...current,version:2,cards}
    })
    return read(identity)
  }
  async function readResource(kind, id) {
    const saved = id ? document(await store.readJson(file)).resources?.[hash([kind,id])] : null
    const grants = saved?.kind === kind && saved.id === id ? (saved.capabilities || []).filter(value=>capabilities.has(value)) : []
    return {kind,id,configured: Boolean(saved?.kind===kind && saved.id===id),capabilities:grants,trustedCardMode:grants.includes('same-origin'),grantedAt:grants.length?saved.grantedAt:null,persistent:true}
  }
  async function changeResource(kind,id,requested) {
    if (!['script','preset'].includes(kind) || !id || !Array.isArray(requested) || requested.some(value=>!capabilities.has(value))) throw new Error('资源权限无效')
    await store.updateJson(file,value=>{const current=document(value);return {...current,version:2,resources:{...current.resources,[hash([kind,id])]:{kind,id,capabilities:[...new Set(requested)],grantedAt:now()}}}})
    return readResource(kind,id)
  }
  async function movePath(kind, from, to, operationId) {
    if (!['card','preset'].includes(kind) || from === to) return
    if (!operationId) throw new Error('资源权限迁移缺少操作身份')
    await store.updateJson(file, value => {
      const current = document(value)
      if (current.lastResourceOperation === operationId) return undefined
      const field = kind === 'card' ? 'cards' : 'resources', rows = {...current[field]}
      const key = path => kind === 'card' ? hash(path) : hash([kind,path])
      const saved = rows[key(from)]
      delete rows[key(from)]
      if (to) {
        // Also clear a stale grant at an untrusted resource's destination.
        delete rows[key(to)]
        if (saved && (kind === 'card' ? saved.cardPath === from : saved.kind === kind && saved.id === from))
          rows[key(to)] = {...saved, ...(kind === 'card' ? {cardPath:to} : {id:to})}
      }
      return {...current, version:2, [field]:rows, lastResourceOperation:operationId}
    })
  }
  return {read,change,readResource,changeResource,movePath}
}

export function mergeScriptPolicies(...policies) {
  const grants = [...new Set(policies.flatMap(policy=>policy?.capabilities || []))]
  return {...policies[0],capabilities:grants,trustedCardMode:grants.includes('same-origin')}
}

export function projectScriptSettings(settings, scriptId, {sharedSettings = false, namespaces = [], writable = false} = {}) {
  if (sharedSettings) return copy(settings || {})
  const allowed = new Set([scriptId,...namespaces,...(writable?[]:READABLE_SCRIPT_SETTINGS)]), result = {}
  for (const [key,value] of Object.entries(settings || {})) if (allowed.has(key)) Object.defineProperty(result,key,{value:copy(value),enumerable:true,configurable:true,writable:true})
  if (Object.hasOwn(settings?.__userscripts || {}, scriptId)) result.__userscripts = Object.fromEntries([[scriptId,copy(settings.__userscripts[scriptId])]])
  return result
}

export function assertScriptSettings(settings, scriptId, policy) {
  const projected = projectScriptSettings(settings,scriptId,{...policy,writable:true})
  if (!isDeepStrictEqual(projected,settings || {})) throw new Error('脚本无权访问其他设置命名空间')
  return projected
}

export function isOfficialMvuActivityWrite(args, selectedCore = args.scriptId === '__dsh_official_mvu__') {
  return args.scriptScope === 'frame' && selectedCore
    && args.option?.type === 'global' && args.variables && Object.keys(args.variables).length === 1
    && typeof args.variables.extra_analysis === 'boolean'
}

export async function authorizeScriptOperation(method, args, {assertOwner, chatForSession, policy, isMvuCore, isBoundWorldbook, onDenied}) {
  if (args.scriptScope !== 'frame') return
  const chat = args.scriptId === '__dsh_message__' ? await chatForSession(args.sessionId) : await assertOwner(args.sessionId,args.scriptId,args.expectedLifecycleRevision)
  if (!chat || Number(chat.tavernHelperLifecycleRevision || 0) !== args.expectedLifecycleRevision) throw new Error('脚本生命周期已变化')
  const mvuCore = ['setTavernMvuActivity','updateTavernHelperVariables'].includes(method) && (isMvuCore ? await isMvuCore(chat,args.scriptId) : args.scriptId === '__dsh_official_mvu__')
  if (method === 'setTavernMvuActivity' && !mvuCore) throw new Error('只有本局选定的 MVU 可以发布额外解析状态')
  const permission = await policy(chat,args.scriptId), grants = new Set(permission.capabilities || [])
  function deny(capability,message){onDenied?.({sessionId:args.sessionId,scriptId:args.scriptId,capability,method});throw new Error(message)}
  const shared = grants.has('shared-resources')
  if (['replaceTavernHelperWorldbook','saveTavernWorldInfo'].includes(method) && args.name && args.name !== 'current' && !shared && !(await isBoundWorldbook?.(chat,args.name))) deny('shared-resources','修改其他世界书需要共享资源写权限')
  const ownMetadata = method === 'editTavernRuntimeScripts' && args.command?.kind === 'metadata'
  const currentPresetRead = method === 'tavernHelperPresets' && ['read','native-catalog','native-read','native-read-all'].includes(args.command?.kind)
  const libraryRead = method === 'tavernHelperWorldbookLibrary' && ['list','read','catalog'].includes(args.operation?.kind)
  if (['changeTavernScriptLibrary','editTavernRuntimeScripts','tavernHelperPresets','tavernHelperWorldbookLibrary'].includes(method) && !shared && !ownMetadata && !currentPresetRead && !libraryRead) deny('shared-resources','这项共享资源操作需要授权，请在资源授信面板一次性设置')
  if (method === 'tavernHelperDatabaseTemplates' && args.operation?.scope === 'global' && !shared) deny('shared-resources','修改全局模板需要卡片授权')
  if (method === 'updateTavernHelperVariables') {
    const option = args.option || {}
    if (option.type === 'global' && !grants.has('shared-settings') && !isOfficialMvuActivityWrite(args,mvuCore) || ['preset','character'].includes(option.type) && !shared) deny(option.type==='global'?'shared-settings':'shared-resources','这项共享变量操作需要卡片授权')
    if (option.type === 'script' && option.script_id && option.script_id !== args.scriptId) throw new Error('脚本只能修改自身变量')
    if (option.type === 'extension') {try{assertScriptSettings({[option.extension_id]:args.variables},args.scriptId,{sharedSettings:grants.has('shared-settings'),namespaces:permission.namespaces})}catch(error){deny('shared-settings',error.message)}}
  }
  return permission
}
