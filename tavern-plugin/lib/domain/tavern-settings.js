import { compactionPolicy } from './auto-compaction.js'
import { normalizeBackgroundModel, configuredBackgroundModel, backgroundModelRevision } from './background-model-selection.js'
import {outboundDisabled} from './outbound-network-policy.js'
import { SYSTEM_PROMPT_NAMES } from '../prompt-catalog.js'
import { worldBookRecallLimit } from './worldbook-recall.js'
import { foregroundModelRevision } from './foreground-model-selection.js'
import { normalizeBackgroundGeneration } from './background-generation-policy.js'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function promptOverride(document, name) {
  const value = object(document.promptOverrides)[name]
  return typeof value === 'string' && (value.trim() !== '' || name === 'system-append') ? value : null
}

export function normalizeDisabledWritingSkills(value) {
  if(value===undefined||value===null)return []
  if(!Array.isArray(value)||value.length>500||value.some(name=>typeof name!=='string'||name.length>64||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)))throw Error('写作技能开关列表无效')
  return [...new Set(value)]
}

export function normalizeBackgroundTasks(value) {
  const tasks = object(value)
  return { posture: tasks.posture !== false, characterDesign: tasks.characterDesign === true, variables: tasks.variables !== false, ledger: tasks.ledger === true }
}

export function applyTavernSettingsPatch(current, patch) {
  const next = Object.assign({}, object(current))
  const input = object(patch)
  if (Object.hasOwn(input, 'backgroundScriptGeneration')) next.backgroundScriptGeneration = normalizeBackgroundGeneration(input.backgroundScriptGeneration)
  if (Object.hasOwn(input, 'fakeIpMode')) {
    if (input.fakeIpMode !== 'trusted-proxy') throw new Error('Fake-IP 仅支持信任本机代理模式')
    next.fakeIpMode = input.fakeIpMode
  }
  if (Object.hasOwn(input, 'candidateDismissMode')) {
    if (!['after-fill', 'after-send'].includes(input.candidateDismissMode)) throw new Error('无效的候选项收起方式')
    next.candidateDismissMode = input.candidateDismissMode
  }
  if (Object.hasOwn(input, 'worldBookRecallLimit')) {
    const limit = Number(input.worldBookRecallLimit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('每轮自动召回的世界书条目上限须为 1–10 的整数')
    next.worldBookRecallLimit = limit
  }
  if (Object.hasOwn(input, 'contextCompaction')) next.contextCompaction = { ...compactionPolicy(input.contextCompaction), revision: Date.now() }
  if (Object.prototype.hasOwnProperty.call(input, 'backgroundTasks')) {
    next.backgroundTasks = normalizeBackgroundTasks({ ...normalizeBackgroundTasks(next.backgroundTasks), ...object(input.backgroundTasks) })
  }
  if (Object.prototype.hasOwnProperty.call(input, 'compatibilityMode')) next.compatibilityMode = input.compatibilityMode === true
  if (Object.hasOwn(input, 'systemAppendEnabled')) next.systemAppendEnabled = input.systemAppendEnabled === true
  if (Object.prototype.hasOwnProperty.call(input, 'webSearchEnabled')) next.webSearchEnabled = input.webSearchEnabled === true
  if (Object.hasOwn(input, 'defaultBackgroundModel') || Object.hasOwn(input, 'backgroundModel')) {
    for (const key of ['defaultBackgroundModel','backgroundModel']) if (Object.hasOwn(input, key) && input[key] !== null && normalizeBackgroundModel(input[key]) === null) throw new Error('后台模型配置无效')
    const value = Object.hasOwn(input, 'defaultBackgroundModel') ? input.defaultBackgroundModel : input.backgroundModel
    const model = normalizeBackgroundModel(value)
    if (value !== null && model === null) throw new Error('后台模型配置无效')
    if (Object.hasOwn(input, 'defaultBackgroundModel') && Object.hasOwn(input, 'backgroundModel') && JSON.stringify(model) !== JSON.stringify(normalizeBackgroundModel(input.backgroundModel))) throw new Error('后台模型配置冲突')
    // Both APIs refer to one global selection; clearing either must clear both.
    next.defaultBackgroundModel = model
    if (model === null) delete next.backgroundModel
    else next.backgroundModel = model
    next.backgroundModelRevision = backgroundModelRevision(next) + 1
  }
  // Upstream 33c399df: presentation only; the data and requests are unchanged.
  if (Object.hasOwn(input,'hideContextAndReasoning')) {
    if (typeof input.hideContextAndReasoning !== 'boolean') throw new Error('无效的对话显示设置')
    next.hideContextAndReasoning = input.hideContextAndReasoning
  }
  for (const name of ['defaultForegroundModel','defaultWorkbenchModel']) if (Object.hasOwn(input,name)) {
    const model=normalizeBackgroundModel(input[name]);if(input[name]!==null&&!model)throw Error('默认模型配置无效');next[name]=model
    if (name === 'defaultForegroundModel') next.foregroundModelRevision = foregroundModelRevision(next) + 1
  }
  if (Object.hasOwn(input,'defaultBackgroundTasks')) next.defaultBackgroundTasks=normalizeBackgroundTasks({...normalizeBackgroundTasks(next.defaultBackgroundTasks ?? next.backgroundTasks),...object(input.defaultBackgroundTasks)})
  if (Object.hasOwn(input,'defaultWebSearchEnabled')) {if(typeof input.defaultWebSearchEnabled!=='boolean')throw Error('默认联网开关无效');next.defaultWebSearchEnabled=input.defaultWebSearchEnabled}
  if(Object.hasOwn(input,'defaultDisabledWritingSkills'))next.defaultDisabledWritingSkills=normalizeDisabledWritingSkills(input.defaultDisabledWritingSkills)
  const legacyStory = Object.prototype.hasOwnProperty.call(input, 'storyPrompt') ? { name: 'story', text: input.storyPrompt } : null
  const promptChange = Object.prototype.hasOwnProperty.call(input, 'systemPrompt') ? object(input.systemPrompt) : legacyStory
  if (promptChange !== null) {
    const name = typeof promptChange.name === 'string' ? promptChange.name : ''
    if (name === '') throw new Error('系统提示词名称不能为空')
    if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
    const overrides = Object.assign({}, object(next.promptOverrides))
    if (promptChange.text === null) {
      delete overrides[name]
    } else {
      if (typeof promptChange.text !== 'string' || (promptChange.text.trim() === '' && name !== 'system-append' && name !== 'card-system')) throw new Error('系统提示词不能为空')
      if (promptChange.text.length > 100000) throw new Error('系统提示词不能超过 100000 字符')
      overrides[name] = promptChange.text.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Object.prototype.hasOwnProperty.call(input, 'systemPrompts')) {
    const values = object(input.systemPrompts)
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const [name, value] of Object.entries(values)) {
      if (!SYSTEM_PROMPT_NAMES.includes(name)) throw new Error('未知系统提示词: ' + name)
      if (typeof value !== 'string' || (value.trim() === '' && name !== 'system-append' && name !== 'card-system')) throw new Error('系统提示词不能为空: ' + name)
      if (value.length > 100000) throw new Error('系统提示词不能超过 100000 字符: ' + name)
      overrides[name] = value.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Array.isArray(input.resetSystemPrompts)) {
    if (input.resetSystemPrompts.some(name => !SYSTEM_PROMPT_NAMES.includes(name))) throw new Error('未知系统提示词')
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const name of input.resetSystemPrompts) delete overrides[name]
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  } else if (input.resetSystemPrompts === true) delete next.promptOverrides
  return next
}

export function presentTavernSettings(document, defaults) {
  const prompts = Object.keys(object(defaults)).map(function (name) {
    const custom = promptOverride(object(document), name)
    return { name, text: custom === null ? String(defaults[name] || '') : custom, customized: custom !== null }
  })
  const story = prompts.find(function (item) { return item.name === 'story' }) || { text: '', customized: false }
  return {
    fakeIpMode: 'trusted-proxy',
    backgroundScriptGeneration: normalizeBackgroundGeneration(object(document).backgroundScriptGeneration),
    candidateDismissMode: object(document).candidateDismissMode === 'after-send' ? 'after-send' : 'after-fill',
    contextCompaction: compactionPolicy(object(document).contextCompaction),
    worldBookRecallLimit: worldBookRecallLimit(object(document).worldBookRecallLimit),
    defaultDisabledWritingSkills: normalizeDisabledWritingSkills(object(document).defaultDisabledWritingSkills),
    defaultForegroundModel: normalizeBackgroundModel(object(document).defaultForegroundModel),
    foregroundModelRevision: foregroundModelRevision(document),
    // Upstream 5390fffd: card workbench conversations; empty follows the new-game foreground default.
    defaultWorkbenchModel: normalizeBackgroundModel(object(document).defaultWorkbenchModel),
    // Hidden unless switched off (upstream b22f073b).
    hideContextAndReasoning: object(document).hideContextAndReasoning !== false,
    defaultBackgroundModel: configuredBackgroundModel(document),
    backgroundModelRevision: backgroundModelRevision(document),
    defaultBackgroundTasks: normalizeBackgroundTasks(object(document).defaultBackgroundTasks ?? object(document).backgroundTasks),
    defaultWebSearchEnabled: !outboundDisabled() && (object(document).defaultWebSearchEnabled ?? object(document).webSearchEnabled) === true,
    compatibilityMode: true,
    webSearchEnabled: !outboundDisabled() && object(document).webSearchEnabled === true,
    systemAppendEnabled: object(document).systemAppendEnabled === true,
    backgroundModel: configuredBackgroundModel(document),
    backgroundTasks: normalizeBackgroundTasks(object(document).backgroundTasks),
    // Legacy global preferences do not authorize executable imported content.
    trustedCardMode: false,
    systemPrompts: prompts,
    storyPrompt: story.text,
    storyPromptCustomized: story.customized
  }
}

export function resolveSystemPrompt(document, name, fallback) {
  const custom = promptOverride(object(document), name)
  if (custom !== null) return custom
  return fallback(name)
}
