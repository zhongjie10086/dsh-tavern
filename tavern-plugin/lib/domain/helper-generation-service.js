import { randomUUID } from 'node:crypto'
import { generateHelperRaw } from './helper-generation.js'
import { mainGenerationSampling } from './preset-sampling.js'
import { safeOutboundFetch, readBoundedResponse, validateCustomModelFields } from './outbound-network-policy.js'
import {readJsonEventStream} from './json-event-stream.js'
export function helperApiUrl(value, endpoint = 'chat/completions') {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('API URL 无效')
  const base = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/$/, '') || '/v1'
  url.pathname = base + '/' + endpoint
  return url.href
}
export async function callHelperCustomApi(options, fetcher, network = {}) {
  const api = options.customApi || {}, key = String(api.key || '')
  if (!String(api.model || '').trim()) throw new Error('请填写自定义 API 模型')
  if (api.source && !['openai', 'custom', 'deepseek', 'mistralai'].includes(api.source)) throw new Error('此独立连接需要 OpenAI 兼容接口：' + api.source)
  const messages = [...(options.system ? [{role:'system',content:[{type:'text',text:options.system}]}] : []),...options.messages].map(m => ({ role: m.role, content: m.content.map(part => part.type === 'image' ? { type: 'image_url', image_url: { url: part.url } } : { type: 'text', text: part.text }) }))
  const body = { model: api.model, messages, stream: true }
  for (const field of ['max_tokens', 'temperature', 'frequency_penalty', 'presence_penalty', 'top_p', 'top_k']) if (typeof api[field] === 'number') body[field] = api[field]
  if (options.tools) { body.tools = options.tools; body.tool_choice = options.toolChoice || 'auto' }
  if (options.jsonSchema) body.response_format = { type: 'json_schema', json_schema: { name: options.jsonSchema.name, description: options.jsonSchema.description, schema: options.jsonSchema.value, strict: options.jsonSchema.strict !== false } }
  if (api.source === 'custom') {
    validateCustomModelFields(api.custom_include_body ?? {}, api.custom_exclude_body ?? [], api.custom_include_headers ?? {})
    Object.assign(body, api.custom_include_body || {})
    for (const field of api.custom_exclude_body || []) delete body[field]
  }
  const response = await safeOutboundFetch(helperApiUrl(api.apiurl), { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(api.source === 'custom' ? api.custom_include_headers || {} : {}) },
    body: JSON.stringify(body), signal: options.signal || AbortSignal.timeout(300000) }, { ...network, purpose: 'model', fetcher })
  if (!response.ok) throw new Error('自定义 API 请求失败：HTTP ' + response.status)
  let text = '', calls = new Map()
  function apply(chunk) {
    if (chunk.error) throw new Error('自定义 API 返回错误：' + String(chunk.error.type || chunk.error.code || 'unknown'))
    const delta = chunk.choices?.[0]?.delta || chunk.choices?.[0]?.message
    if (delta?.content) { text += delta.content; options.onDelta?.(delta.content) }
    for (const piece of delta?.tool_calls || []) {
      const index = piece.index || 0, previous = calls.get(index) || { id: piece.id || '', type: 'function', function: { name: '', arguments: '' } }
      if (piece.id) previous.id = piece.id
      if (piece.function?.name) previous.function.name += piece.function.name
      if (piece.function?.arguments) previous.function.arguments += piece.function.arguments
      calls.set(index, previous)
    }
    const finish = chunk.choices?.[0]?.finish_reason
    if (finish === 'length') throw new Error('自定义 API 输出达到 token 上限')
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) apply(JSON.parse((await readBoundedResponse(response, 8_000_000)).toString('utf8')))
  else {
    for await(const value of readJsonEventStream(response,{signal:options.signal,maxBytes:8_000_000,label:'自定义 API'}))apply(value)
  }
  if (calls.size) return { content: text, tool_calls: [...calls.values()] }
  if (!text.trim()) throw new Error('自定义 API 返回为空')
  return text
}
export function createHelperGenerationService({ context, callModel, selection, fetcher, lookup, allowedModelOrigins, networkPolicy=async()=>({}), store, assertOwner = async () => {} }) {
  const jobs = new Map(), journalFile = 'helper-generation-jobs.json'
  let disposed = false
  async function remember(job, admission = false) {
    if (!store) return
    await store.updateJson(journalFile, value => {
      const journal = { ...value }
      if (admission && Object.hasOwn(journal,job.id)) throw new Error('生成 ID 已发送过；重启后不会自动重发，请核对结果后使用新 ID')
      for (const [id, row] of Object.entries(journal)) if (row.at < Date.now() - 86400000) delete journal[id]
      if (admission && Object.keys(journal).length >= 2000) throw new Error('独立生成记录达到当日上限')
      Object.defineProperty(journal, job.id, { value: { owner: job.owner, id: job.id, at: Date.now(), status: job.status, lifecycleRevision: job.lifecycleRevision }, enumerable: true, configurable: true, writable: true })
      return journal
    })
  }
  async function start(sessionId, config, raw, scriptId, lifecycleRevision, {exactMessages = false} = {}) {
    if (disposed) throw new Error('脚本模型服务已停止')
    await assertOwner(sessionId, scriptId, lifecycleRevision)
    const state = await context(sessionId, config, scriptId, lifecycleRevision), id = String(config.generation_id || randomUUID()), owner = sessionId + ':' + String(scriptId || '')
    if(exactMessages)config={...config,custom_api:mainGenerationSampling(state.preset,config.custom_api)}
    if (exactMessages) { state.scriptPrompts = []; delete state.consumePrompts }
    if (disposed) throw new Error('脚本模型服务已停止')
    if (!id || id.length > 160) throw new Error('生成 ID 无效')
    if (jobs.has(id)) throw new Error('生成 ID 已存在，不能重复发送')
    if ([...jobs.values()].filter(j => j.status === 'running').length >= 4) throw new Error('已有 4 个独立生成任务')
    for (const [key, job] of jobs) if (job.status !== 'running' && Date.now() - job.at > 120000) jobs.delete(key)
    const controller = new AbortController(), job = { owner, id, status: 'running', text: '', at: Date.now(), controller, lifecycleRevision, bytes:0 }
    jobs.set(id, job)
    try { await remember(job, true); await assertOwner(sessionId, scriptId, lifecycleRevision); if(disposed)throw new Error('脚本模型服务已停止') } catch (error) { jobs.delete(id); throw error }
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)])
    job.promise = Promise.resolve().then(() => generateHelperRaw(config, { ...state, raw, sessionId, signal, onDelta: delta => {
      signal.throwIfAborted()
      if (typeof delta !== 'string' || job.bytes + Buffer.byteLength(delta) > 8000000) { controller.abort(new Error('生成结果超过 8MB')); signal.throwIfAborted() }
      job.bytes += Buffer.byteLength(delta); job.text += delta
    },
      callModel: async options => {
        await assertOwner(sessionId, scriptId, lifecycleRevision); signal.throwIfAborted()
        const custom = options.customApi
        if (custom?.apiurl) return callHelperCustomApi(options, fetcher, { lookup, allowedModelOrigins,...await networkPolicy(sessionId,scriptId) })
        const selected = selection(sessionId)
        if (custom?.proxy_preset) options.modelSelection = { provider: custom.proxy_preset, model: custom.model || selected?.model }
        else if (custom?.model) options.modelSelection = { ...selected, model: custom.model }
        if (typeof custom?.temperature === 'number') options.temperature = custom.temperature
        if (typeof custom?.max_tokens === 'number') options.maxTokens = custom.max_tokens
        return callModel({...options,networkPolicy:await networkPolicy(sessionId,scriptId)})
      }
    })).then(async result => {
      signal.throwIfAborted(); await assertOwner(sessionId, scriptId, lifecycleRevision); signal.throwIfAborted()
      job.status = 'completed'; job.result = result
    }).catch(error => { job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; delete job.result }).finally(async () => {
      job.at = Date.now()
      try { await state.consumePrompts?.() } catch(error) {job.status='failed';job.error='一次性提示词清理失败：'+error.message;delete job.result}
      try { await remember(job) } catch { job.status = 'failed'; job.error = '模型已执行，但结果记录保存失败；请核对结果，不会自动重发'; delete job.result }
      job.settled=true
    })
    return { id }
  }
  async function poll(sessionId, id, scriptId, offset = 0, lifecycleRevision) {
    await assertOwner(sessionId, scriptId, lifecycleRevision)
    const owner = sessionId + ':' + String(scriptId || ''), job = jobs.get(id)
    if (!job) {
      const saved = (await store?.readJson(journalFile))?.[id]
      if (saved?.owner === owner) return { id, status: 'interrupted', offset: 0, delta: '', error: '任务执行器已重启或结果已过期，无法确认完整结果；不会自动重发' }
      throw new Error('生成任务已中断或不属于此脚本')
    }
    if (job.owner !== owner || job.lifecycleRevision !== lifecycleRevision) throw new Error('生成任务已中断或不属于此脚本实例')
    return { id, status: job.settled || job.status==='cancelled' ? job.status : 'running', delta: job.text.slice(Math.max(0, offset)), offset: job.text.length, result: job.settled ? job.result : undefined, error: job.error }
  }
  function stop(sessionId, id, scriptId, lifecycleRevision) {
    let stopped = false
    for (const job of jobs.values()) if (job.owner === sessionId + ':' + String(scriptId || '') && job.lifecycleRevision === lifecycleRevision && (!id || job.id === id) && job.status === 'running') {
      stopped = true; job.status = 'cancelled'; job.error = '生成已停止'; job.controller.abort(new Error(job.error))
    }
    return { stopped }
  }
  async function models(api, sessionId, scriptId, lifecycleRevision) {
    await assertOwner(sessionId, scriptId, lifecycleRevision)
    const response = await safeOutboundFetch(helperApiUrl(api.apiurl, 'models'), { headers: api.key ? { Authorization: 'Bearer ' + api.key } : {}, redirect: 'error', signal: AbortSignal.timeout(30000) }, { purpose: 'model', fetcher, lookup, allowedModelOrigins,...await networkPolicy(sessionId,scriptId) })
    if (!response.ok) throw new Error('模型列表请求失败：HTTP ' + response.status)
    const body = JSON.parse((await readBoundedResponse(response, 2_000_000)).toString('utf8'))
    return { models: (body.data || []).map(m => m.id).filter(id => typeof id === 'string') }
  }
  async function stopSession(sessionId){const active=[...jobs.values()].filter(job=>job.owner.startsWith(sessionId+':'));for(const job of active)job.controller.abort();await Promise.allSettled(active.map(job=>job.promise));for(const job of active)jobs.delete(job.id)}
  return { start, poll, stop, stopSession, models, busy(scriptId,sessionId){return [...jobs.values()].some(job=>!job.settled&&(!scriptId||job.owner.endsWith(':'+scriptId))&&(!sessionId||job.owner.startsWith(sessionId+':')))}, dispose() { disposed = true; for (const job of jobs.values()) job.controller.abort(); jobs.clear() } }
}
