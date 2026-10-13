import { RETENTION_DEFAULTS } from './retention-policy.js'
import { randomUUID } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function phaseEntries(messages, phase) {
  const name = 'tavern:runtime-preset-' + phase
  return (Array.isArray(messages) ? messages : []).filter(function (message) {
    return Array.isArray(message && message.source && message.source.sections) && message.source.sections.some(function (section) { return section && section.name === name })
  })
}

function redactRequestMetadata(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactRequestMetadata)
  if (typeof value.entries === 'function' && typeof value.get === 'function') value = Object.fromEntries(value.entries())
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(authorization|proxy-authorization|cookie|set-cookie|.*api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password)$/i.test(key) ? '[REDACTED]' : redactRequestMetadata(item)]))
}

function serializableRequest(options) {
  const result = {}
  for (const [key, value] of Object.entries(options || {})) {
    if (key === 'signal') continue
    result[key] = ['messages', 'tools', 'system'].includes(key) ? value : redactRequestMetadata({[key]: value})[key]
  }
  return JSON.parse(JSON.stringify(result))
}

function evidenceRecord(record,row){const result={...record,...row?.completion,version:1};if(!result.phases&&record.request){const messages=record.request.messages;result.phases={front:phaseEntries(messages,'front'),middle:phaseEntries(messages,'middle'),back:phaseEntries(messages,'back')}}return result}
export function createModelRequestLog(options = {}) {
  const readJson = options.readJson
  const writeJson = options.writeJson
  const updateJson = options.updateJson
  const now = typeof options.now === 'function' ? options.now : Date.now
  const id = typeof options.id === 'function' ? options.id : function () { return randomUUID() }
  if (typeof readJson !== 'function' || typeof writeJson !== 'function' || typeof updateJson !== 'function') throw new TypeError('模型请求日志缺少存储适配器')

  const maximum = Math.max(1, Number(options.maxRecords) || RETENTION_DEFAULTS.modelRequests)
  const maxBytes = Math.max(1024, Number(options.maxBytes) || RETENTION_DEFAULTS.modelRequestBytes)
  const indexPath = 'model-requests/index.json'
  const memory=new Map()
  const enabled = async () => typeof options.enabled === 'function' ? await options.enabled() === true : options.enabled === true
  function bounded(record,budget=maxBytes) {
    const text = JSON.stringify(record, null, 2) + '\n'
    if (Buffer.byteLength(text) <= budget) return record
    const result = {version:1,id:record.id,chatId:record.chatId,sessionId:record.sessionId,task:record.task,scope:record.scope,turn:record.turn,status:record.status,createdAt:record.createdAt,truncated:true,originalBytes:Buffer.byteLength(text),preview:text.slice(0,Math.floor(budget/4))}
    while(Buffer.byteLength(JSON.stringify(result,null,2)+'\n')>budget)result.preview=result.preview.slice(0,Math.floor(result.preview.length/2))
    return result
  }
  async function record(input) {
    const persistent=await enabled(),capture=await options.capture?.(input)
    if (!persistent&&!capture) return null
    const chat = input.chat
    const context = input.context
    const coordinates = input.coordinates
    const requestOptions = input.options
    const stamp = now()
    const requestId = stamp.toString(36) + '-' + id()
    const messages = Array.isArray(requestOptions && requestOptions.messages) ? requestOptions.messages : []
    const scope = context && context.scope === 'background' ? 'background' : 'foreground'
    const turn = scope === 'background' ? Math.max(0, Number(context.turn) || 0) : Math.max(0, Number(coordinates && coordinates.turn) || 0)
    if(capture){
      if(memory.size>=100)throw Error('自动化请求证据达到 100 条容量，停止测试以免丢失证据')
      const row={version:1,id:requestId,chatId:chat.id,ownerSessionId:chat.sessionId,scope,task:scope==='background'?str(context.task):'reply',turn,status:'running',createdAt:stamp}
      memory.set(requestId,row);return structuredClone(row)
    }
    let record = {
      version: 1,
      id: requestId,
      chatId: chat.id,
      scope,
      task: scope === 'background' ? str(context.task) : 'reply',
      sessionId: str(requestOptions && requestOptions.sessionId),
      turn,
      agentTurn: Math.max(0, Number(coordinates && coordinates.turn) || 0),
      step: Math.max(1, Number(coordinates && coordinates.step) || 1),
      createdAt: stamp,
      status: 'running',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      compatibility: chat.requestMode === 'sillytavern' && chat.compatibilityTraces && chat.compatibilityTraces[String(turn)]
        ? JSON.parse(JSON.stringify(chat.compatibilityTraces[String(turn)]))
        : null,
      frame: coordinates && coordinates.frame ? JSON.parse(JSON.stringify(coordinates.frame)) : null,
      bypassPlan: {
        id: str(chat.bypassPlanId || chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planId),
        name: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planName),
        digest: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.digest)
      },
      request: serializableRequest(requestOptions)
    }
    record=bounded(record,maxBytes-Math.min(256*1024,Math.floor(maxBytes/4)));record.version=2
    const requestBytes=Buffer.byteLength(JSON.stringify(record,null,2)+'\n')
    let discarded=[]
    await updateJson(indexPath, async current => {
      await writeJson('model-requests/'+chat.id+'/'+requestId+'.json',record)
      const rows=[...(current?.requests||[]),{id:requestId,chatId:chat.id,sessionId:record.sessionId,turn,scope,createdAt:stamp,version:2,requestBytes}]
      const keep=rows.slice(-maximum);discarded=rows.slice(0,-maximum)
      return {version:1,requests:keep}
    })
    for(const row of discarded)await options.remove?.('model-requests/'+row.chatId+'/'+row.id+'.json')
    return evidenceRecord(record)
  }

  async function complete(input = {}) {
    const captured=memory.get(input.id)
    if(captured?.chatId===input.chatId){const text=str(input.text),truncated=Buffer.byteLength(text)>128*1024;Object.assign(captured,{status:input.error?'failed':'completed',completedAt:now(),truncated,response:{text:truncated?text.slice(0,32768):text,error:str(input.error),finish:input.finish}});return structuredClone(captured)}
    let completed=null
    await updateJson(indexPath,async index=>{
      const at=index?.requests?.findIndex(row=>row.id===input.id&&row.chatId===input.chatId)??-1;if(at<0)return undefined
      const row=index.requests[at];let requestBytes=row.requestBytes
      if(row.version!==2){const record=await readJson('model-requests/'+input.chatId+'/'+input.id+'.json');if(!record)return undefined;requestBytes=Buffer.byteLength(JSON.stringify(record,null,2)+'\n')}
      const completedAt=now(),record={id:input.id,chatId:input.chatId,sessionId:row.sessionId,createdAt:row.createdAt,status:str(input.error)?'failed':'completed',completedAt,durationMs:Math.max(0,completedAt-Number(row.createdAt||completedAt)),response:{text:str(input.text),finish:input.finish===undefined?null:JSON.parse(JSON.stringify(input.finish)),error:str(input.error)||null}}
      completed=bounded(record,Math.max(512,maxBytes-requestBytes));index.requests[at]={...row,version:2,requestBytes,completion:completed};return index
    })
    return completed
  }

  async function evidence(chatId, turn) {
    const base = 'model-requests/' + chatId + '/'
    const index = await readJson(indexPath)
    const entries = Array.isArray(index && index.requests) ? index.requests.filter(function (item) {
      return item.chatId === chatId && (!Number.isSafeInteger(Number(turn)) || Number(turn) < 1 || Number(item.turn) === Number(turn))
    }) : []
    const requests = []
    for (const entry of entries) {
      const record = await readJson(base + entry.id + '.json')
      if (record) requests.push(evidenceRecord(record,entry))
    }
    return { loaded: true, chatId, requests:requests.concat([...memory.values()].filter(row=>row.chatId===chatId&&(!Number.isSafeInteger(Number(turn))||Number(turn)<1||Number(row.turn)===Number(turn))).map(row=>structuredClone(row))) }
  }

  // The retention index is the only authority. Do not revive discarded files or
  // expose a different foreground/background request under the same game.
  async function latestForSession(sessionId, chatId) {
    if (!sessionId || !chatId) return null
    const index = await readJson(indexPath)
    for (const entry of [...(index?.requests || [])].reverse()) {
      if (entry.chatId !== chatId || !/^[a-zA-Z0-9_-]+$/.test(entry.id)) continue
      const record = await readJson('model-requests/' + chatId + '/' + entry.id + '.json')
      if (record?.chatId === chatId && record.sessionId === sessionId) return evidenceRecord(structuredClone(record),entry)
    }
    return null
  }

  return Object.freeze({ record, complete, evidence,latestForSession,release(sessionId){for(const [id,row]of memory)if(row.ownerSessionId===sessionId)memory.delete(id)} })
}
