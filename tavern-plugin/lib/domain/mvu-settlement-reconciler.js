function required(options, name) {
  if (typeof options[name] !== 'function') throw new Error('MVU Settlement Reconciler 缺少 ' + name)
  return options[name]
}

/**
 * Reconciles durable pending MVU submissions with the browser runtime.
 * Signals are hints: every attempt re-reads authoritative chat state.
 */
export function createMvuSettlementReconciler(options = {}) {
  const list = required(options, 'list')
  const resolve = required(options, 'resolve')
  const shouldResume = required(options, 'shouldResume')
  const isReady = required(options, 'isReady')
  const resume = required(options, 'resume')
  const schedule = typeof options.schedule === 'function' ? options.schedule : setTimeout
  const cancel = typeof options.cancel === 'function' ? options.cancel : clearTimeout
  const onError = typeof options.onError === 'function' ? options.onError : function () {}
  const retryDelayMs = Math.max(10, Number(options.retryDelayMs) || 1000)
  const maxAttempts = Math.max(1, Math.min(10, Number(options.maxAttempts) || 3))
  const inFlight = new Map()
  const retries = new Map()
  const failures = new Map()
  let disposed = false

  function retry(key, callback, error) {
    if (disposed || retries.has(key)) return
    const attempts = (failures.get(key)?.attempts || 0) + 1
    const blocked = attempts >= maxAttempts
    const delay = Math.min(30000, retryDelayMs * 2 ** (attempts - 1))
    const status = { attempts, blocked, retryAfterMs: blocked ? 0 : delay, message: blocked ? '后台结算连续失败，自动重试已停止。请检查错误后点击重试结算。' : '' }
    failures.set(key, status)
    try { Promise.resolve(onError(error, key === '@scan' ? '' : key, status)).catch(() => {}) } catch {}
    if (blocked) return
    const timer = schedule(async function () {
      retries.delete(key)
      if (!disposed) await callback()
    }, delay)
    retries.set(key, timer)
  }

  async function attempt(sessionId, observed) {
    if (disposed) return false
    try {
      const chat = await resolve(sessionId)
      if (!chat || !shouldResume(chat)) { failures.delete(sessionId); observed(); return false }
      const ready = isReady(sessionId)
      observed()
      if (!ready) return false
      await resume(chat.id)
      failures.delete(sessionId)
      return true
    } catch (error) {
      retry(sessionId, () => wake(sessionId), error)
      return false
    }
  }

  function wake(sessionId) {
    const id = String(sessionId || '')
    if (disposed || id === '' || retries.has(id) || failures.get(id)?.blocked) return Promise.resolve(false)
    const current = inFlight.get(id)
    if (current) { current.notifications++; return current.promise }
    const record = { notifications: 1, observed: 0, promise: null }
    // Coalesce hints seen before admission, but keep an actual new hint that
    // arrives while resume is saving a deferred job. Re-read durable state only
    // after that job ends; never rerun its effect or poll for runtime readiness.
    record.promise = Promise.resolve().then(async function () {
      let resumed = false
      do {
        resumed = await attempt(id, () => { record.observed = record.notifications }) || resumed
      } while (!disposed && !retries.has(id) && !failures.get(id)?.blocked && record.observed !== record.notifications)
      return resumed
    }).finally(function () { if (inFlight.get(id) === record) inFlight.delete(id) })
    inFlight.set(id, record)
    return record.promise
  }

  async function scan() {
    if (disposed || retries.has('@scan') || failures.get('@scan')?.blocked) return
    try {
      const rows = await list()
      failures.delete('@scan')
      await Promise.all(rows.map(row => wake(row.sessionId)))
    } catch (error) {
      retry('@scan', scan, error)
    }
  }

  function dispose() {
    disposed = true
    for (const timer of retries.values()) cancel(timer)
    retries.clear()
    failures.clear()
    for (const record of inFlight.values()) record.observed = record.notifications
  }

  function reset(sessionId) {
    const id = String(sessionId || '')
    if (retries.has(id)) cancel(retries.get(id))
    retries.delete(id)
    failures.delete(id)
    const record = inFlight.get(id)
    if (record) record.observed = record.notifications
  }
  return Object.freeze({ wake, scan, dispose, reset, status: sessionId => ({ ...failures.get(String(sessionId || '')) }) })
}
