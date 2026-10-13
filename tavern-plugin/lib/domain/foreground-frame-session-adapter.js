import { encodeTavernMessage, decodeTavernSource } from './session-message-source.js'
import { foregroundFrameText } from './agent-input-frame.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function frameIdOf(message) {
  const source = decodeTavernSource(message && message.source)
  return str(source && source.trace && source.trace.frameId)
}

/** Adapt one ForegroundFrame to the current DSH agent/pre-step message seam. */
export function createForegroundFrameSessionAdapter(options = {}) {
  const makeId = typeof options.id === 'function' ? options.id : function () { return crypto.randomUUID() }

  function append(input = {}) {
    const messages = Array.isArray(input.messages) ? input.messages : []
    const frame = input.frame
    if (!frame || frame.kind !== 'foreground') throw new Error('Session Adapter 只接受 ForegroundFrame')
    if (Number(input.step) !== 1) return { messages, receipt: { appended: false, reason: 'not-first-step', frameId: frame.frameId } }
    if (messages.some(function (message) { return frameIdOf(message) === frame.frameId })) {
      return { messages, receipt: { appended: false, reason: 'duplicate', frameId: frame.frameId } }
    }
    const contributions = frame.contributions
    const text = foregroundFrameText({ contributions })
    if (text === '') return { messages, receipt: { appended: false, reason: 'empty', frameId: frame.frameId } }
    const sections = contributions.map(function (item, index) {
      return {
        name: 'tavern:foreground:' + str(item.slot) + ':' + (index + 1),
        text: str(item.text),
        source: item.source
      }
    })
    return {
      messages: messages.concat([encodeTavernMessage({
        id: makeId(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-tavern',
          form: 'foreground-frame',
          sections,
          trace: {
            frameId: frame.frameId,
            chatId: frame.chatId,
            branchId: frame.branchId,
            basedOnRevision: frame.basedOnRevision,
            operationId: frame.operationId,
            turn: frame.turn
          }
        }
      })]),
      receipt: { appended: true, reason: 'appended', frameId: frame.frameId }
    }
  }

  return Object.freeze({ append })
}

// Native history keeps complete frame receipts. Their one-turn instructions
// must expire in later provider requests without rewriting that audit history.
export function projectExpiredFramePrompts(messages, currentTurn) {
  if (!Number.isSafeInteger(currentTurn) || currentTurn < 1) return messages
  let changed = false
  const result = messages.flatMap(message => {
    const source = decodeTavernSource(message?.source)
    if (message?.role !== 'user' || source?.kind !== 'plugin' || source.plugin !== 'dsh-tavern' || source.form !== 'foreground-frame'
      || !Number.isSafeInteger(source.trace?.turn) || source.trace.turn < 1 || source.trace.turn >= currentTurn || !Array.isArray(source.sections)) return [message]
    const sections = source.sections.filter(section => !(section?.source?.stage === 'tavern-script-prompt'
      && (section.source.once === true || section.source.id === '__dsh_opening__:system')))
    if (sections.length === source.sections.length) return [message]
    const frameText = values => foregroundFrameText({contributions: values})
    // Only rewrite the exact text carrier this adapter produced. Unknown or
    // manually edited content is not evidence of an owned frame contribution.
    if (message.content?.length !== 1 || message.content[0]?.type !== 'text'
      || message.content[0].text !== frameText(source.sections)) return [message]
    changed = true
    const text = frameText(sections)
    return text ? [encodeTavernMessage({...message, content: [{...message.content[0], text}], source: {...source, sections}})] : []
  })
  return changed ? result : messages
}
