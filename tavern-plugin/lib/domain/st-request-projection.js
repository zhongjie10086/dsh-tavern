import { decodeTavernSource } from './session-message-source.js'
import { applyTavernRegexText } from './tavern-regex-display.js'
import {resolveRuntimeMacroText} from './runtime-content-projection.js'
import {seededTavernRandom} from './tavern-macro-engine.js'

const str = value => typeof value === 'string' ? value : ''
const textOf = message => (Array.isArray(message?.content) ? message.content : []).filter(block => block?.type === 'text').map(block => str(block.text)).join('')
const hasTools = message => message?.role === 'tool' || message?.tool_call_id || message?.tool_calls?.length

/** Reproject only authoritative story messages, before role normalization merges frames. */
export function projectStoryRegexRequest(request, context = {}) {
  if (!context.regexScripts?.length) return request
  const history = (context.history || []).filter(message => message && ['user', 'assistant'].includes(message.role)).map(message => {
    const projection = str(message.projectionText ?? message.sourceText ?? message.text)
    const saved = context.runtimeInputs?.[String(message.turn)]
    const initial = applyTavernRegexText(projection, context.regexScripts, { placement: message.role === 'user' ? 1 : 2, depth: 0 }).text
    return { role: message.role, projection,
      variants: [message.text, message.sourceText, message.projectionText, initial, message.role === 'user' ? saved?.text : undefined].filter(value => typeof value === 'string') }
  })
  if (context.currentInput) {
    const input = context.currentInput
    history.push({ role: 'user', current:true,projection: str(input.unfiltered ?? input.projectedText ?? input.sourceText),
      variants: [input.sourceText, input.projectedText, input.unfiltered].filter(value => typeof value === 'string') })
  }
  let cursor = history.length - 1
  let changed = false
  const messages = (request.messages || []).slice()
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || hasTools(message) || !['assistant', 'user'].includes(message.role)) continue
    if (message.source?.kind === 'plugin' && !['dsh-tavern-regen'].includes(message.source.plugin) &&
      !/opening|greeting/.test(str(message.source.form))) continue
    const text = textOf(message)
    let found = -1
    for (let candidate = cursor; candidate >= 0; candidate--) {
      if (history[candidate].role === message.role && history[candidate].variants.some(value => value.trim() === text.trim())) { found = candidate; break }
    }
    if (found < 0) continue
    cursor = found - 1
    let projected = applyTavernRegexText(history[found].projection, context.regexScripts, {
      placement: message.role === 'user' ? 1 : 2, isMarkdown: false, isEdit: false, depth: history.length - 1 - found
    }).text
    if(projected.includes('{{')&&context.macroContext)projected=resolveRuntimeMacroText(projected,{...context.macroContext,random:seededTavernRandom(context.macroContext.randomSeed,history[found].current?'prompt-only-input':'request-regex:'+found)}).text
    if (projected === text) continue
    let emitted = false
    const content = (message.content || []).flatMap(block => {
      if (block?.type !== 'text') return [block]
      if (emitted) return []
      emitted = true
      return projected.trim() ? [{ ...block, text: projected }] : []
    })
    messages[index] = { ...message, content }
    changed = true
  }
  return changed ? { ...request, messages: messages.filter(message => !Array.isArray(message.content) || message.content.length > 0) } : request
}
