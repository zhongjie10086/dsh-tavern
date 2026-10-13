import YAML from 'yaml'

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function unescapePath(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

function pathParts(value) {
  const result = []
  const source = unescapePath(value)
  const pattern = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]/g
  source.replace(pattern, function (_match, number, quote, quoted) {
    result.push(quote ? quoted.replace(/\\([\\"'])/g, '$1') : (number === undefined ? _match : number))
    return _match
  })
  return result
}

function valueAt(source, path) {
  const parts = pathParts(path)
  if (parts.length === 0) return null
  let value = source
  for (const part of parts) {
    if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(Object(value), part)) return null
    value = value[part]
  }
  return value
}

function withoutInternalKeys(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const result = []
    seen.set(value, result)
    for (const item of value) result.push(withoutInternalKeys(item, seen))
    return result
  }
  const result = {}
  seen.set(value, result)
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('$')) continue
    result[key] = withoutInternalKeys(item, seen)
  }
  return result
}

function scopeVariables(scopes, type) {
  return object(scopes && scopes[type])
}

function macroValue(scopes, type, path) {
  return withoutInternalKeys(valueAt(scopeVariables(scopes, type), path))
}

const FORMAT_IN_PREFIX = /^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/im

function replaceFormatted(scopes, _substring, prefix, type, path) {
  const previous = prefix.match(FORMAT_IN_PREFIX)
  if (previous) {
    prefix = replaceFormatted(scopes, '', previous[1], previous[2], previous[3]) + prefix.slice(previous[0].length)
  }
  const value = macroValue(scopes, type, path)
  const rendered = typeof value === 'string'
    ? value
    : YAML.stringify(value, { blockQuote: 'literal' }).trimEnd()
  const indent = Math.min(prefix.length, 256)
  const lines = rendered.split('\n').length - 1
  if (rendered.length + prefix.length + lines * indent > 8*1024*1024) throw new Error('格式化变量超过 8 MiB 字符预算')
  return prefix + rendered.replaceAll('\n', '\n' + ' '.repeat(indent))
}

/**
 * Port of Tavern Helper's get_xxx_variable and format_xxx_variable prompt macros.
 * It intentionally runs after normal SillyTavern macros and prompt assembly.
 */
export function renderTavernHelperVariableMacros(value, scopes = {}) {
  let replacements = 0
  let text = typeof value === 'string' ? value : String(value ?? '')
  if (text.length > 8*1024*1024 || (text.match(/\{\{(?:format|get)_(?:message|chat|character|preset|global)_variable::/gi) || []).length > 512) throw new Error('变量宏超过 8 MiB 字符或 512 次展开预算')
  let expandedChars = text.length
  function withinBudget(value, original) { expandedChars += value.length - original.length; if (expandedChars > 8*1024*1024) throw new Error('变量宏展开超过 8388608 字符'); return value }
  text = text.replace(/\{\{get_(message|chat|character|preset|global)_variable::(.*?)\}\}/gi, function (_substring, type, path) {
    replacements += 1
    const result = macroValue(scopes, type, path)
    return withinBudget(typeof result === 'string' ? result : JSON.stringify(result) ?? 'undefined', _substring)
  })
  replacements += Array.from(text.matchAll(/\{\{format_(?:message|chat|character|preset|global)_variable::.*?\}\}/gi)).length
  text = text.replace(/^(.*)\{\{format_(message|chat|character|preset|global)_variable::(.*?)\}\}/gim, function (...args) {
    return withinBudget(replaceFormatted(scopes, ...args.slice(0, 4)), args[0])
  })
  return { text, replacements }
}

export function applyTavernHelperVariableMacros(messages, scopes = {}) {
  let replacements = 0
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    if (!message || typeof message.content !== 'string') return message
    const rendered = renderTavernHelperVariableMacros(message.content, scopes)
    replacements += rendered.replacements
    return Object.assign({}, message, { content: rendered.text })
  })
  return { messages: projected, replacements }
}
