import { redactDiagnostic } from './mvu-diagnostics.js'

/** Bounded current-page notices; durable detail uses the existing diagnostic log. */
export function createRuntimeNotices({ publish, record, limit = 256, now = Date.now } = {}) {
  const notices = new Map()
  let sequence = 0
  function notify(sessionId) {
    try { publish?.(sessionId, { kind: 'runtime-notice', version: String(++sequence) }) } catch {}
  }
  function report(input, stage, error) {
    const id = String(input?.sessionId || '')
    if (!id || id.length > 200) return
    const turn = Number(input.turn) || 0, previous = notices.get(id)
    if (previous && previous.turn > turn) return
    const notice = Object.freeze({ stage, turn, at: now(), message: stage + '失败：' + String(redactDiagnostic(String(error?.message || error))).slice(0, 2000) })
    notices.delete(id); notices.set(id, notice)
    while (notices.size > limit) notices.delete(notices.keys().next().value)
    notify(id)
    try { Promise.resolve(record?.(id, notice)).catch(() => {}) } catch {}
    return notice
  }
  function clear(input, stage) {
    const id = String(input?.sessionId || ''), current = notices.get(id)
    if (!current || current.stage !== stage || current.turn > (Number(input.turn) || 0)) return false
    notices.delete(id); notify(id); return true
  }
  return Object.freeze({ report, clear, get: id => notices.get(id) || null, forget: id => notices.delete(id), dispose: () => notices.clear() })
}
