import { createHash } from 'node:crypto'
import {persistSpVectorIndex,loadSpVectorIndex} from './sp-vector-index-store.js'
export const fingerprint = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || a.concat(b).some(v => !Number.isFinite(v))) throw new Error('Embedding 向量维度或数值无效')
  let ab = 0, aa = 0, bb = 0
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2 }
  if (!aa || !bb) throw new Error('Embedding 返回零向量')
  return ab / Math.sqrt(aa * bb)
}
export function vectorDocuments(data, config) {
  const rows = []
  for (const [sheet, table] of Object.entries(data)) {
    if (!sheet.startsWith('sheet_') || table.exportConfig?.enabled === false) continue
    if (!['selective', 'keyword'].includes(table.exportConfig?.entryType) && !/纪要|总结|事件|记忆/.test(table.name)) continue
    for (const row of table.content.slice(1)) {
      const source = table.name + '：' + table.content[0].map((h, i) => h + '=' + String(row[i] ?? '')).join('；')
      for (let start = 0; start < source.length; start += config.chunkChars) {
        const text = source.slice(start, start + config.chunkChars)
        rows.push({ id: fingerprint([sheet, row[0], start, text]), sheet, rowId: row[0], text })
      }
    }
  }
  return rows
}
export async function requestSpJson(url, body, key, signal, fetcher = fetch) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('API 地址无效')
  const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]),
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error('服务返回 HTTP ' + response.status)
  const raw = await response.text()
  if (raw.length > 32_000_000) throw new Error('服务响应超过大小限制')
  try { return JSON.parse(raw) } catch { throw new Error('服务没有返回合法 JSON') }
}
export function createSpVector({ secrets, fetcher = fetch, store }) {
  async function credential(config, rerank = false) {
    const value = await secrets(), key = value[rerank ? 'rerankKey' : 'embeddingKey'], endpoint = value[rerank ? 'rerankEndpoint' : 'embeddingEndpoint']
    if (key && endpoint !== (rerank ? config.rerankUrl : config.url)) throw new Error('服务地址已变化，请在当前地址下重新保存服务密钥')
    return key
  }
  async function embeddings(config, texts, signal) {
    if (!config.url || !config.model) throw new Error('请先设置 Embedding API 地址和模型')
    const response = await requestSpJson(config.url, { model: config.model, input: texts }, await credential(config), signal, fetcher)
    if (!Array.isArray(response.data) || response.data.length !== texts.length) throw new Error('Embedding 返回数量与输入不符')
    const ordered = [...response.data].sort((a, b) => a.index - b.index)
    if (ordered.some((item, i) => item.index !== i)) throw new Error('Embedding 返回索引无效')
    const vectors = ordered.map(item => item.embedding)
    vectors.forEach(v => cosine(vectors[0], v))
    return vectors
  }
  async function build(data, config, old, signal, progress = () => {}) {
    const previous=old
    old=await loadSpVectorIndex(old,store)
    signal?.throwIfAborted()
    const documents = vectorDocuments(data, config), signature = fingerprint([config.url, config.model, config.chunkChars])
    const cache = new Map((old?.signature === signature ? old.documents : []).map(row => [row.id, row]))
    const result = [], missing = documents.filter(row => !cache.has(row.id))
    for (let i = 0; i < missing.length; i += config.batchSize) {
      signal?.throwIfAborted()
      const batch = missing.slice(i, i + config.batchSize), vectors = await embeddings(config, batch.map(row => row.text), signal)
      batch.forEach((row, n) => cache.set(row.id, { ...row, vector: vectors[n] }))
      progress({ done: Math.min(missing.length, i + batch.length), total: missing.length })
    }
    for (const row of documents) result.push(cache.get(row.id))
    if(old?.signature===signature&&old.documents.length===result.length&&result.every((row,i)=>row.id===old.documents[i].id))return store?(previous?.spVectorIndex?previous:await persistSpVectorIndex(old,store)):old
    const index={ signature, documents: result, builtAt: Date.now() }
    signal?.throwIfAborted()
    return store?persistSpVectorIndex(index,store):index
  }
  async function recall(data, config, index, query, signal) {
    index=await loadSpVectorIndex(index,store)
    signal?.throwIfAborted()
    if (index?.signature !== fingerprint([config.url, config.model, config.chunkChars])) throw new Error('向量配置已变化，请先重建索引')
    const docs = vectorDocuments(data, config), current = new Set(docs.map(row => row.id))
    const indexed=new Set(index.documents.map(item=>item.id))
    if (docs.some(row => !indexed.has(row.id))) throw new Error('向量索引待更新，请先建立索引')
    if (!docs.length) return { rows: [], text: '', query }
    const [queryVector] = await embeddings(config, [query], signal)
    let scored = index.documents.filter(row => current.has(row.id)).map(row => ({ ...row, score: cosine(row.vector, queryVector) })).filter(row => row.score >= config.threshold).sort((a, b) => b.score - a.score).slice(0, config.topK * 3)
    if (config.rerankUrl || config.rerankModel) {
      if (!config.rerankUrl || !config.rerankModel) throw new Error('Rerank 地址与模型必须同时填写')
      if (scored.length) {
        const response = await requestSpJson(config.rerankUrl, { model: config.rerankModel, query, documents: scored.map(row => row.text), top_n: config.topK }, await credential(config, true), signal, fetcher)
        if (!Array.isArray(response.results)) throw new Error('Rerank 返回格式无效')
        const seen = new Set()
        scored = response.results.map(item => {
          if (!Number.isInteger(item.index) || !scored[item.index] || seen.has(item.index) || !Number.isFinite(item.relevance_score)) throw new Error('Rerank 返回索引或分数无效')
          seen.add(item.index); return { ...scored[item.index], score: item.relevance_score }
        })
      }
    }
    const selected = [], ids = new Set()
    const add = row => { const id = row.sheet + ':' + row.rowId; if (!ids.has(id)) { ids.add(id); selected.push(row) } }
    for (const row of docs.slice(-config.recentRows || docs.length)) add({ ...row, score: 1, recent: true })
    for (const row of scored) { if (selected.length >= config.topK + config.recentRows) break; add(row) }
    return { query, rows: selected.map(({ sheet, rowId, score, recent }) => ({ sheet, rowId, score, recent: !!recent })), text: selected.length ? '语义召回的已有记忆：\n' + selected.map(item => { const table = data[item.sheet], row = table.content.find((r, i) => i && String(r[0]) === String(item.rowId)); return table.name + '：' + table.content[0].map((header, i) => header + '=' + String(row[i] ?? '')).join('；') }).join('\n') : '' }
  }
  return { build, recall }
}
