// Runtime-only, bounded summaries. Never keep request arguments or response bodies.
export function createPerformanceDiagnostics() {
  const methods = new Map()
  const slow = []
  let browser = null
  let http = null
  const openings = []
  const totals = new Map(), active = new Map(), turns = []
  const counters = ['chatReads','cloneBytes','parseBytes','journalWrites']
  return {
    storage({chatId,name,value=1}) {
      if(!counters.includes(name)||!Number.isFinite(value)||value<0)return
      const row=totals.get(chatId)||Object.fromEntries(counters.map(key=>[key,0]));row[name]+=value;totals.set(chatId,row)
      if(totals.size>128)totals.delete(totals.keys().next().value)
    },
    turnStart({chatId,sessionId,turn}) {
      if(active.get(sessionId)?.turn===turn)return
      active.set(sessionId,{chatId,sessionId,turn,started:performance.now(),base:{...totals.get(chatId)}})
      if(active.size>128)active.delete(active.keys().next().value)
    },
    turnEnd(sessionId) {
      const row=active.get(sessionId);if(!row)return
      active.delete(sessionId)
      turns.push({chatId:row.chatId,turn:row.turn,turnMs:Math.round(performance.now()-row.started),...Object.fromEntries(counters.map(key=>[key,Math.max(0,(totals.get(row.chatId)?.[key]||0)-(row.base[key]||0))]))})
      if(turns.length>100)turns.shift()
    },
    http(snapshot) { http = structuredClone(snapshot) },
    opening(value) {
      if (!value || !['resources', 'readCard', 'readExtensions', 'preview', 'prepare'].includes(value.stage)) return
      const row = { at: Date.now(), stage: value.stage }
      for (const key of ['durationMs', 'helperCount', 'regexCount', 'skippedCount', 'failedCount', 'cacheHitCount', 'sharedCount', 'cooldownCount']) {
        if (Number.isFinite(value[key]) && value[key] >= 0) row[key] = Math.min(1e12, Math.round(value[key]))
      }
      openings.push(row)
      if (openings.length > 60) openings.shift()
    },
    record(method, durationMs) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(method) || !Number.isFinite(durationMs)) return
      durationMs = Math.max(0, Math.round(durationMs))
      if (!methods.has(method) && methods.size >= 80) return
      const row = methods.get(method) || { count: 0, totalMs: 0, maxMs: 0, slowCount: 0 }
      row.count++; row.totalMs += durationMs; row.maxMs = Math.max(row.maxMs, durationMs)
      if (durationMs >= 1000) {
        row.slowCount++
        slow.push({ at: Date.now(), method, durationMs })
        if (slow.length > 30) slow.shift()
      }
      methods.set(method, row)
    },
    browser(value) {
      if (!value || typeof value !== 'object') return
      const clean = {}
      for (const key of ['observedMs', 'longTaskCount', 'longTaskTotalMs', 'longTaskMaxMs', 'slowRpcCount', 'slowRpcMaxMs']) {
        if (Number.isFinite(value[key]) && value[key] >= 0) clean[key] = Math.min(1e12, Math.round(value[key]))
      }
      if (Object.keys(clean).length) browser = { ...clean, receivedAt: Date.now(), longTaskSupported: value.longTaskSupported === true }
    },
    read() {
      return { version: 1, scope: 'server-process-and-last-reporting-browser', resetsOnRestart: true,
        turns: turns.map(row=>({...row})),
        ...(http ? { http: structuredClone(http) } : {}),
        ...(openings.length ? { openings: openings.map(row => ({ ...row })) } : {}),
        slowThresholdMs: 1000, browserLongTaskThresholdMs: 100, browser: browser && { ...browser },
        methods: [...methods].map(([method, row]) => ({ method, count: row.count, averageMs: Math.round(row.totalMs / row.count), maxMs: row.maxMs, slowCount: row.slowCount })),
        slow: slow.map(row => ({ ...row })) }
    }
  }
}
