import { createHash } from 'node:crypto'
import { nativeRegexScriptsOf, regexScriptsOf } from './preset-reading.js'
import { regexFromString } from './tavern-regex-display.js'
import {projectTavernHelperScripts} from './tavern-helper-scripts.js'
import {knownPresetDisplay} from './known-preset-display.js'

const str = value => typeof value === 'string' ? value : ''
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Read attached scripts without evaluating user JavaScript or rewriting its source. */
export function presetHelperScripts(document) {
  const helper = document?.extensions?.tavern_helper
  const source = Array.isArray(helper?.scripts) ? helper.scripts : helper?.script?.scripts
  const result = []
  function visit(items, enabled = true) {
    for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
      if (!record(item)) continue
      const active = enabled && item.enabled !== false
      if (Array.isArray(item.scripts)) { visit(item.scripts, active); continue }
      if (item.type !== 'script' && !str(item.content)) continue
      const {_dshResourceId,_dshSource,...imported}=structuredClone(item)
      result.push({ ...imported, type: 'script', enabled: active,
        id: str(item.id) || 'preset-script-' + hash([index, item.content]).slice(0, 16),
        name: str(item.name) || '附带脚本 ' + (result.length + 1), content: str(item.content) })
    }
  }
  visit(source)
  return result
}

export function nativeScriptAdapter(script) {
  const source = str(script?.content)
  // Match a capability signature, not a preset filename or a translated title.
  if (source.includes('izumi_advice') && source.includes('prompt_order') && source.includes('<advice>')) return 'izumi-controls'
  return ''
}

const regexAdapters = new WeakMap()
export function nativeRegexAdapter(script) {
  const pattern = str(script?.findRegex)
  const replacement = str(script?.replaceString)
  const cached = script && regexAdapters.get(script)
  if (cached?.pattern === pattern && cached.replacement === replacement) return cached.adapter
  const adapter = /send_textarea/.test(replacement) && /<(?:branches|options)>/.test(pattern) ? 'choices'
    : /用户.*本轮输入/.test(pattern) && replacement.includes('AutoCardUpdaterAPI') && /qrf_/i.test(replacement) ? 'multicolor-input'
    : knownPresetDisplay(replacement)?.adapter || ''
  if (script && typeof script === 'object') regexAdapters.set(script, { pattern, replacement, adapter })
  return adapter
}

export function presetNativeFeatures(document) {
  const scripts = presetHelperScripts(document)
  const controls = scripts.filter(script => script.enabled && nativeScriptAdapter(script) === 'izumi-controls')
  return { version: 1, izumi: controls.length > 0,
    scripts: scripts.map(script => ({ id: script.id, name: script.name, enabled: script.enabled,
      adapter: nativeScriptAdapter(script), digest: hash(script.content), data: structuredClone(script.data || {}) })) }
}

const macroNames = new Set(['user', 'char', 'lastusermessage', 'lastcharmessage', 'lastmessage', 'getvar', 'setvar',
  'addvar', 'incvar', 'decvar', 'hasvar', 'deletevar', 'getglobalvar', 'setglobalvar', 'addglobalvar',
  'incglobalvar', 'decglobalvar', 'hasglobalvar', 'deleteglobalvar', 'if', 'else', 'random', 'roll', 'trim', 'date', 'time','pick','newline','noop','reverse','weekday','isodate','datetimeformat'])

/** Capability report describes runtime support, never treats a saved bundle as executed. */
export function inspectPresetCompatibility(document, inspected = {}) {
  const items = []
  const add = (kind, key, name, enabled, status, message, extra = {}) => items.push({ kind, key, name, enabled, status, message, ...extra })
  for (const entry of inspected.entries || []) {
    const active = entry.enabled !== false && entry.ordered === true && entry.injectable === true && !entry.marker
    const unknown = [...new Set([...str(entry.content).matchAll(/\{\{\s*([^\s:{}]+)(?:::|\s|\}\})/g)]
      .map(match => match[1]).filter(name => !name.startsWith('//') && !name.startsWith('.') && !name.startsWith('$') && !macroNames.has(name.replace(/^\//, '').toLowerCase())))]
    add('prompt', entry.entryKey, entry.name, active, unknown.length ? 'unsupported' : 'supported',
      entry.marker ? '由 DSH 提供人物卡、世界书或聊天内容。' : !entry.ordered ? '未排入发送顺序。' : unknown.length ? '尚未支持的宏：' + unknown.join('、') : '按导入文件的顺序、开关和三段位置使用。', { unknownMacros: unknown })
  }
  const native = nativeRegexScriptsOf(document)
  const regexes = native.length ? native : regexScriptsOf(document)
  for (const [index, script] of regexes.entries()) {
    const adapter = nativeRegexAdapter(script)
    let status = 'supported', message = adapter === 'choices' ? '运行该预设原有选项美化，通过兼容输入框写入本局草稿。' : adapter === 'multicolor-input' ? '原生多彩消息展示与本局数据库联动。' : '按显示／模型请求、楼层深度和编辑开关处理。'
    if(adapter.startsWith('izumi-'))message='已审核版本：原版弹幕／思维面板在隔离消息页运行，支持展开、收起和动画；外部字体、背景图不可用时保留基础显示与操作。'
    try { regexFromString(script.findRegex) } catch (error) { status = 'unsupported'; message = '正则无效：' + error.message }
    if (!adapter && /AutoCardUpdaterAPI|SillyTavern\s*\.|(?:parent|top)\.document|send_textarea/.test(script.replaceString)) {
      status = 'unsupported'; message = '此展示规则依赖尚未适配的宿主接口；原文保留。'
    } else if (!adapter && /<script\b|\bonclick\s*=|https?:\/\/[^\s"']+\.js\b/i.test(script.replaceString)) {
      status = 'dependency'; message = '交互 HTML 使用现有消息运行环境；外部脚本和资源需要可用，效果需验证。'
    }
    if (Number(script.substituteRegex) > 0) { status = 'dependency'; message += ' 查找表达式需要按本局宏状态展开。' }
    add('regex', script.id + '#' + index, script.name, script.enabled, status, message, { adapter,reviewedVersion:adapter.startsWith('izumi-') })
  }
  const helperScripts=presetHelperScripts(document),patchDiagnostics=projectTavernHelperScripts(helperScripts).diagnostics.filter(row=>row.status==='patch-missed')
  for (const script of helperScripts) {
    const adapter = nativeScriptAdapter(script)
    const diagnostics=patchDiagnostics.filter(row=>row.scriptId===script.id)
    add('script', script.id, script.name, script.enabled, diagnostics.length?'dependency':adapter ? 'supported' : 'dependency',
      diagnostics.length?diagnostics.map(row=>row.message).join('；'):adapter ? '使用原生预设控制、方案和 Advice 面板。' : '新开局时加载附带 JavaScript；可在脚本管理中查看、启停和重载，外部依赖需要可用。', { adapter,diagnostics })
  }
  return { version: 1, sourceDigest: hash(document), items,
    counts: Object.fromEntries(['supported', 'dependency', 'unsupported'].map(status => [status, items.filter(item => item.enabled && item.status === status).length])),
    scope: 'global-selection-new-games', nativeFeatures: presetNativeFeatures(document) }
}
