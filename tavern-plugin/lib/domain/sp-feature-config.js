import { SP_FILL_DEFAULTS, normalizeFillOptions } from './sp-fill-workbench.js'
const text = value => String(value ?? '')
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const number = (v, fallback, min, max, integer = true) => {
  const n = Number(v ?? fallback)
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) throw new Error(`数值应在 ${min} 至 ${max} 之间`)
  return n
}
const model = value => {
  if (!value) return null
  if (!record(value) || !text(value.provider).trim() || !text(value.model).trim()) throw new Error('模型选择无效')
  return { provider: text(value.provider).trim(), model: text(value.model).trim() }
}
export const SP_FEATURE_DEFAULTS = Object.freeze({
  flightMode: false, toastMuteEnabled: false, zeroTkOccupyMode: false, streamingEnabled: true,
  continuationPageEnabled: false, externalImportPageEnabled: false, contentReplaceEnabled: false, developerOptionsEnabled: false,
  storageMode: 'json', fill: SP_FILL_DEFAULTS,
  vector: { enabled: false, url: '', model: '', rerankUrl: '', rerankModel: '', topK: 12, threshold: 0.2, recentRows: 3, chunkChars: 1200, batchSize: 16, queryModel: null, queryPrompt: '' },
  agent: { mode: 'off', scope: [], model: null, skillModel: null, maxEntries: 12, maxChars: 12000, contextTurns: 3, prompt: '', skills: {} },
  summary: { enabled: false, model: null, sourceTables: [], keepRecent: 10, batchSize: 20, maxChars: 3000, prompt: '' },
  backfill: { groupSize: 5, from: 1, to: 0, tables: [], prompt: '' },
  replacement: { model: null, prompt: '检查并改善行文、重复和明显笔误，保持剧情事实、人物行为、变量更新标签和格式不变。只返回完整正文。', maxChars: 60000 },
  continuation: { rounds: 3, prompt: '继续当前剧情，保持人物行为和既有事实，不替玩家作出重大决定。' }
})
export function normalizeSpFeatures(value = {}) {
  const result = structuredClone(SP_FEATURE_DEFAULTS)
  for (const key of Object.keys(result)) {
    if (!Object.hasOwn(value, key)) continue
    if (typeof result[key] === 'boolean') { if (typeof value[key] !== 'boolean') throw new Error('开关值无效：' + key); result[key] = value[key] }
    else if (record(result[key])) { if (!record(value[key])) throw new Error('配置格式无效：' + key); result[key] = { ...result[key], ...value[key] } }
    else result[key] = value[key]
  }
  if (!['json', 'sqlite'].includes(result.storageMode)) throw new Error('存储模式无效')
  result.fill=normalizeFillOptions(result.fill)
  const v = result.vector, a = result.agent, s = result.summary, b = result.backfill
  for (const key of ['url', 'rerankUrl']) {
    v[key] = text(v[key]).trim()
    if (v[key]) { const url = new URL(v[key]); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('API 地址需要不含账户密码的 HTTP(S) 地址') }
  }
  for (const item of [v, s]) if (typeof item.enabled !== 'boolean') throw new Error('启用值无效')
  v.model = text(v.model).trim(); v.rerankModel = text(v.rerankModel).trim(); v.queryModel = model(v.queryModel); v.queryPrompt = text(v.queryPrompt)
  v.topK = number(v.topK, 12, 1, 100); v.threshold = number(v.threshold, .2, -1, 1, false); v.recentRows = number(v.recentRows, 3, 0, 100)
  v.chunkChars = number(v.chunkChars, 1200, 100, 12000); v.batchSize = number(v.batchSize, 16, 1, 128)
  if (!['off', 'observe', 'takeover'].includes(a.mode)) throw new Error('Agent 模式无效')
  for (const list of [a.scope, s.sourceTables, b.tables]) if (!Array.isArray(list) || list.some(k => typeof k !== 'string')) throw new Error('选择范围无效')
  a.model = model(a.model); a.skillModel = model(a.skillModel); a.maxEntries = number(a.maxEntries, 12, 1, 100); a.maxChars = number(a.maxChars, 12000, 200, 100000)
  a.contextTurns = number(a.contextTurns, 3, 1, 100); a.prompt = text(a.prompt)
  if (!record(a.skills) || Object.keys(a.skills).length > 10000) throw new Error('世界书描述配置无效')
  a.skills = Object.fromEntries(Object.entries(a.skills).map(([key, entry]) => [key, { description: text(entry?.description), trigger: text(entry?.trigger) }]))
  s.model = model(s.model); s.keepRecent = number(s.keepRecent, 10, 0, 500); s.batchSize = number(s.batchSize, 20, 2, 500); s.maxChars = number(s.maxChars, 3000, 100, 20000); s.prompt = text(s.prompt)
  b.groupSize = number(b.groupSize, 5, 1, 100); b.from = number(b.from, 1, 1, 100000); b.to = number(b.to, 0, 0, 100000); b.prompt = text(b.prompt)
  result.replacement.model = model(result.replacement.model); result.replacement.prompt = text(result.replacement.prompt); result.replacement.maxChars = number(result.replacement.maxChars, 60000, 100, 200000)
  result.continuation.rounds = number(result.continuation.rounds, 3, 1, 100); result.continuation.prompt = text(result.continuation.prompt)
  // Secrets never travel with chats, presets, branch copies or exported settings.
  delete v.apiKey; delete v.rerankApiKey
  return result
}
