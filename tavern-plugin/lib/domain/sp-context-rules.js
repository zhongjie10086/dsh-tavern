// Boundary semantics follow SP's helpers-context-tags; no script or regex execution.
const text = value => String(value ?? '')
export function normalizeContextRules(value, legacyTags = '') {
  const rules = Array.isArray(value) && value.length ? value : text(legacyTags).split(/[,，\n]/).map(tag => tag.trim()).filter(Boolean).map(tag => ({ start: '<' + tag, end: '</' + tag + '>' }))
  const seen = new Set(), result = []
  for (const item of rules) {
    const pair = typeof item === 'string' ? item.split('|') : [item?.start ?? item?.begin ?? item?.open, item?.end ?? item?.close ?? item?.finish]
    const start = text(pair[0]).trim(), end = text(pair[1]).trim(), key = JSON.stringify([start, end])
    if (start && end && !seen.has(key)) { seen.add(key); result.push({ start, end }) }
  }
  return result
}
export function lastBoundary(textValue, rule) {
  const source = text(textValue), lower = source.toLowerCase(), end = lower.lastIndexOf(rule.end.toLowerCase())
  if (end < 0) return null
  const start = lower.lastIndexOf(rule.start.toLowerCase(), Math.max(0, end - rule.start.length))
  return start < 0 || start + rule.start.length > end ? null : source.slice(start, end + rule.end.length)
}
function removeBoundaries(source, rule) {
  const lower = source.toLowerCase(), start = rule.start.toLowerCase(), end = rule.end.toLowerCase()
  if (start === end) {
    let at = 0, next, out = ''
    while ((next = lower.indexOf(start, at)) >= 0) { out += source.slice(at, next); at = next + start.length }
    return out + source.slice(at)
  }
  const stack = [], ranges = []
  let at = 0
  while (at < lower.length) {
    const left = lower.indexOf(start, at), right = lower.indexOf(end, at)
    if (left < 0 && right < 0) break
    if (left >= 0 && (right < 0 || left <= right)) { stack.push(left); at = left + start.length }
    else { if (stack.length) ranges.push([stack.pop(), right + end.length]); at = right + end.length }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push(range)
  }
  let out = '', position = 0
  for (const [begin, finish] of merged) { out += source.slice(position, begin); position = finish }
  return out + source.slice(position)
}
export function filterContext(value, { extractRules = [], excludeRules = [] } = {}) {
  let result = text(value)
  const extracted = normalizeContextRules(extractRules).map(rule => lastBoundary(result, rule)).filter(value => value !== null)
  if (extracted.length) result = extracted.join('\n\n')
  const excluded = normalizeContextRules(excludeRules)
  for (const rule of excluded) result = removeBoundaries(result, rule)
  return excluded.length ? result.replace(/\n{3,}/g, '\n\n').trim() : result
}
export function contextForFill(messages, settings) {
  return (messages || []).filter(message => ['user', 'assistant'].includes(message.role)).slice(-settings.contextTurns * 2)
    .map(message => ({ role: message.role, text: message.role === 'assistant'
      ? filterContext(message.projectionText || message.sourceText || message.text, { extractRules: settings.tableContextExtractRules, excludeRules: settings.tableContextExcludeRules })
      : text(message.sourceText || message.text) }))
}
