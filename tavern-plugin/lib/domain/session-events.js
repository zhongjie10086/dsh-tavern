import { appendAssistantEvent } from './session-surface-edit.js'
import { appendTavernEvent, decodeTavernEvent } from './session-message-source.js'

const EMPTY = Object.freeze([])
const views = new WeakMap()

// Expose decoded Tavern metadata as an immutable read view. Keep native event
// objects untouched and preserve snapshot identity when no decoding is needed.
export function sessionEvents(session) {
  if (!session) return EMPTY
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
  if (!Array.isArray(events)) return EMPTY
  const cached = views.get(events)
  if (cached) return cached
  let result = events
  for (let index = 0; index < events.length; index++) {
    const decoded = decodeTavernEvent(events[index])
    if (decoded !== events[index]) {
      if (result === events) result = events.slice()
      result[index] = decoded
    }
  }
  if (Object.isFrozen(events)) {
    if (result !== events) Object.freeze(result)
    // Only cache arrays whose nested values cannot change under this view.
    if (events.every(event => Object.isFrozen(event))) views.set(events, result)
  }
  return result
}

// The rc2 host owns system message emission inside an open turn/step.
// Do not insert an out-of-turn placeholder before Tavern seeds.

// Normalize only new writes at the host boundary. Existing events, seqs and
// provenance stay untouched; V3 migrations remain owned by DSH.
export function sessionEventData(session, type, data) {
  return session?.header?.version >= 3 && type === 'assistant/message' && data.stream === undefined
    ? { ...data, stream: [] } : data
}

export function appendSessionEvent(session, type, data, intent) {
  if (session?.header?.version >= 3) {
    if (intent) {
      intent = { ...intent }
      const op = intent.surfaceOp
      if (op && typeof op === 'object' && op.op === 'replace' && 'start' in op) {
        intent.surfaceOp = { op: 'replace', startSeq: op.start, endSeq: op.end }
      }
      if (type === 'assistant/message' && intent.surfaceOp === 'append') delete intent.sourceEventSeqs
    }
  }
  data = sessionEventData(session, type, data)
  if (session?.header?.version >= 3 && type === 'assistant/message' && intent?.surfaceOp?.op === 'replace') return appendAssistantEvent(session, data, intent)
  return appendTavernEvent(session, type, data, intent)
}

export function surfaceReplacementRange(op) {
  return { start: op.startSeq ?? op.start, end: op.endSeq ?? op.end }
}
