import { appendTavernEvent } from './session-message-source.js'
import { isTavernSurfaceMarker, surfaceRange, tavernAssistantTurn } from './session-surface-edit.js'
import { sessionEvents, surfaceReplacementRange } from './session-events.js'
import { randomUUID } from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {isTavernTurnInput,tavernTriggerTurnInput} from './tavern-turn-input.js'

function object(value) {
  return value !== null && typeof value === 'object' ? value : null
}

function eventAt(events, seq) {
  const direct = events[seq]
  if (direct && Number(direct.seq) === Number(seq)) return direct
  return events.find(event => event && Number(event.seq) === Number(seq)) || null
}

function modelSourceOf(event) {
  const data = object(event && event.data)
  const message = object(data && data.message)
  const source = object(message && message.source)
  return source && source.kind === 'model' ? source : null
}

function isRollbackUserTombstone(event) {
  if (isTavernSurfaceMarker(event)) return true
  const source = event && event.type === 'user/message' && event.data && event.data.source
  return source && source.kind === 'plugin' && (
    source.plugin === 'dsh-tavern-failed-turn-cleanup' ||
    source.plugin === 'dsh-tavern-regeneration-abort' ||
    source.plugin === 'dsh-tavern-context-window'
  )
}

function isRollbackAssistantTombstone(event, events) {
  if (isTavernSurfaceMarker(event)) event = { ...event, type: 'assistant/message', data: event.data.source.replacement }
  if (!event || event.type !== 'assistant/message' || modelSourceOf(event) === null) return false
  const content = event.data && event.data.message && event.data.message.content
  const op = surfaceRange(event.surfaceOp)
  if (!Array.isArray(content) || content.length !== 0 || !op || !op) return false
  const sources = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : []
  return sources.some(function (seq) {
    const sourceEvent = eventAt(events, seq)
    return sourceEvent && sourceEvent.type === 'user/message'
  })
}

function modelTurns(events, seqs) {
  const turns = new Set()
  for (const seq of seqs) {
    const event = eventAt(events, seq)
    const turn = Number(event && event.data && event.data.turn)
    if (event && event.type === 'assistant/message' && modelSourceOf(event) !== null && Number.isSafeInteger(turn) && turn > 0) turns.add(turn)
  }
  return [...turns].sort(function (left, right) { return left - right })
}

export function regenerationAttemptTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  return modelTurns(events, events.filter(function (event) {
    return event && Number.isSafeInteger(event.seq) && event.seq >= eventStart
  }).map(function (event) { return event.seq }))
}

export function abortedRegenerationTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const seqs = []
  for (const event of events) {
    const source = event && event.type === 'user/message' && event.data && event.data.source
    if (!source || source.kind !== 'plugin' || source.plugin !== 'dsh-tavern-regeneration-abort') continue
    if (Array.isArray(event.sourceEventSeqs)) seqs.push(...event.sourceEventSeqs)
  }
  return modelTurns(events, seqs)
}

// The native rollback may consume a failed-turn cleanup tombstone rather than
// its original streamed assistant node. Follow that provenance to hide the
// interrupted turn too; stopping alone must retain its visible error/partial reply.
export function rolledBackSurfaceTurns(events) {
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  const turns = new Set()
  const visited = new Set()
  function visit(seq) {
    if (visited.has(seq)) return
    visited.add(seq)
    const event = bySeq.get(seq)
    if (!event) return
    const turn = Number(event.data?.turn)
    if (event.type === 'assistant/message' && modelSourceOf(event) !== null && Number.isSafeInteger(turn) && turn > 0) turns.add(turn)
    if (event.surfaceOp?.op === 'replace') for (const source of event.sourceEventSeqs || []) visit(source)
  }
  for (const event of events) {
    if (!isRollbackAssistantTombstone(event, events)) continue
    for (const seq of event.sourceEventSeqs || []) visit(seq)
  }
  return [...turns].sort((left, right) => left - right)
}

export function foregroundSuppressedTurns(chat, events) {
  return Array.from(new Set((Array.isArray(chat?.suppressedDshTurns) ? chat.suppressedDshTurns : [])
    .concat(abortedRegenerationTurns({ events }), rolledBackSurfaceTurns(events))
    .map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))).sort((left, right) => left - right)
}

// Legacy regeneration left a durable empty replacement at the saved story turn.
// Surface replacement hides messages, not DSH's turn/end error nodes. Derive
// their display suppression without changing the immutable event history.
export function supersededRegenerationErrorTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const syntheticTurns = new Set((Array.isArray(input && input.suppressedDshTurns) ? input.suppressedDshTurns : []).map(Number))
  if (syntheticTurns.size === 0) return []
  const bySeq = new Map()
  const endings = new Map()
  const failures = []
  const hidden = new Set()
  for (let event of events) {
    if (!event || !Number.isSafeInteger(event.seq)) continue
    bySeq.set(event.seq, event)
    if (event.type === 'turn/end') {
      endings.set(Number(event.data.turn), event)
      if (event.data.reason && event.data.reason.kind === 'error') failures.push(event)
    }
    if (isTavernSurfaceMarker(event)) event = { ...event, type: 'assistant/message', data: event.data.source.replacement }
    const op = surfaceRange(event.surfaceOp)
    if (event.type !== 'assistant/message' || modelSourceOf(event) === null || !op || !op) continue
    const content = event.data.message.content
    if (!Array.isArray(content) || content.length !== 0) continue
    const body = bySeq.get(surfaceReplacementRange(op).end)
    const turn = Number(body && body.data && body.data.turn)
    const end = endings.get(turn)
    if (!body || body.type !== 'assistant/message' || modelSourceOf(body) === null || !syntheticTurns.has(turn) || turn === Number(event.data.turn)) continue
    if (!end || end.seq <= body.seq || end.seq >= event.seq || end.data.reason.kind !== 'completed') continue
    if (!Array.isArray(body.data.message.content) || !body.data.message.content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')) continue
    for (const failure of failures) {
      if (failure.seq >= surfaceReplacementRange(op).start && failure.seq <= surfaceReplacementRange(op).end) hidden.add(Number(failure.data.turn))
    }
  }
  return [...hidden].sort((a, b) => a - b)
}

export function locateRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const turn = Number(input && input.turn)
  if (!Number.isSafeInteger(turn) || turn < 1) return null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    let event = eventAt(events, nodes[index])
    if (isTavernSurfaceMarker(event) && event.data.source.replacement?.message?.content?.length === 0) event = { ...event, type: 'assistant/message', data: event.data.source.replacement }
    if (!event || event.type !== 'assistant/message' || tavernAssistantTurn(event, events) !== turn) continue
    const source = modelSourceOf(event)
    if (source === null) continue
    // Current swipes leave a non-empty replacement; legacy swipes can be empty.
    // Plugin cleanup markers and messages from other turns are not the saved story body.
    return Object.freeze({ assistantSeq: Number(nodes[index]), turn, source })
  }
  return null
}

/** Preflight may cover genuine empty rollback receipts, never later content. */
export function planRegenerationPreview(input){
 const events=input.events||[],nodes=input.nodes||[],start=nodes.indexOf(input.oldAssistantSeq)
 if(start<0)throw new Error('旧正文已经不在当前模型消息面中')
 const projection=[],ranges=new Map(),bySeq=new Map(events.filter(Boolean).map(event=>[event.seq,event]))
 for(const event of events){
  if(!event)continue
  if(event.surfaceOp==='append')projection.push(event.seq)
  else{
   const range=surfaceRange(event.surfaceOp)
   if(!range)continue
   const first=projection.indexOf(range.start),last=projection.indexOf(range.end)
   if(first<0||last<first)continue
   ranges.set(event.seq,projection.slice(first,last+1));projection.splice(first,last-first+1,event.seq)
  }
 }
 function validRollback(event){
  let replacement=event?.data
  if(isTavernSurfaceMarker(event)){
   const source=event.data.source;replacement=source.replacement
   if(source.kind!=='plugin'||event.data.role!=='user'||!Array.isArray(event.data.content)||event.data.content.length!==0||source.execution
    ||typeof replacement?.message?.id!=='string'||event.data.id!=='tavern-surface-edit:'+replacement.message.id)return false
  }else if(event?.type!=='assistant/message')return false
  const message=replacement?.message,turn=Number(replacement?.turn),shadowed=ranges.get(event.seq)
  if(message?.role!=='assistant'||message.source?.kind!=='model'||!Array.isArray(message.content)||message.content.length!==0
   ||!Number.isSafeInteger(turn)||turn<1||!shadowed?.length||!isDeepStrictEqual(event.sourceEventSeqs,shadowed))return false
  const first=bySeq.get(shadowed[0])
  if(first?.type!=='user/message'||!isTavernTurnInput(first.data))return false
  return shadowed.some(seq=>{
   const body=bySeq.get(seq)
   return body?.type==='assistant/message'&&tavernAssistantTurn(body,events)===turn
    &&isDeepStrictEqual(body.data?.message?.source,message.source)&&Array.isArray(body.data?.message?.content)&&body.data.message.content.length>0
  })
 }
 function validAbort(event){
  const source=event?.data?.source,shadowed=ranges.get(event?.seq)
  if(event?.type!=='user/message'||source?.kind!=='plugin'||source.plugin!=='dsh-tavern-regeneration-abort'||event.data.role!=='user'
   ||!Array.isArray(event.data.content)||event.data.content.length!==0||!String(event.data.id||'').endsWith(':abort')
   ||!shadowed?.length||!isDeepStrictEqual(event.sourceEventSeqs,shadowed))return false
  const leaves=[]
  function expand(seq){
   const nested=bySeq.get(seq)
   if(nested?.type==='user/message'&&nested.data?.source?.plugin==='dsh-tavern-failed-turn-cleanup'){
    const range=ranges.get(seq)
    if(nested.data.source.kind!=='plugin'||!Array.isArray(nested.data.content)||nested.data.content.length!==0||!range?.length
     ||!isDeepStrictEqual(nested.sourceEventSeqs,range))return false
    return range.every(expand)
   }
   leaves.push(seq);return true
  }
  if(!shadowed.every(expand))return false
  const first=bySeq.get(leaves[0])
  if(first?.type!=='user/message'||first.data?.role!=='user'||first.data?.source?.kind!=='plugin'||first.data.source.plugin!=='dsh-tavern-regen')return false
  const beginning=events.findLast(candidate=>candidate?.type==='turn/start'&&candidate.seq<first.seq)
  const ending=events.find(candidate=>candidate?.type==='turn/end'&&candidate.seq>first.seq&&candidate.seq<event.seq&&candidate.data?.turn===beginning?.data?.turn)
  return Boolean(beginning&&ending&&leaves.every(seq=>seq>beginning.seq&&seq<ending.seq)
   &&!events.some(candidate=>candidate?.type==='turn/start'&&candidate.seq>beginning.seq&&candidate.seq<ending.seq))
 }
 for(const seq of nodes.slice(start+1))if(!validRollback(bySeq.get(seq))&&!validAbort(bySeq.get(seq)))throw new Error('旧正文之后有非回退空标记或新的消息，拒绝重新生成')
 const shadowedSeqs=nodes.slice(start).map(Number)
 return Object.freeze({start:shadowedSeqs[0],end:shadowedSeqs.at(-1),shadowedSeqs:Object.freeze(shadowedSeqs)})
}

export function locateRollbackSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  let userIndex = -1
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    const source = event?.data?.source
    const isFrame = source?.kind === 'plugin' && source.plugin === 'dsh-tavern' && source.form === 'foreground-frame'
    if (event && event.type === 'user/message' && !isFrame && !isRollbackUserTombstone(event)) {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return null

  let assistantIndex = -1
  let assistantEvent = null
  let source = null
  for (let index = nodes.length - 1; index > userIndex; index -= 1) {
    const event = eventAt(events, nodes[index])
    const candidateSource = event && event.type === 'assistant/message' ? modelSourceOf(event) : null
    // A previous rollback leaves an empty, model-sourced replacement because
    // native DSH restore rejects plugin-owned assistant messages. It is a
    // projection tombstone, not the assistant reply paired with this user.
    if (candidateSource !== null && !isRollbackAssistantTombstone(event, events)) {
      assistantIndex = index
      assistantEvent = event
      source = candidateSource
      break
    }
  }
  if (assistantIndex < 0 || assistantEvent === null || source === null) return null

  const shadowedSeqs = nodes.slice(userIndex)
  return Object.freeze({
    userSeq: Number(nodes[userIndex]),
    assistantSeq: Number(nodes[assistantIndex]),
    endSeq: Number(shadowedSeqs[shadowedSeqs.length - 1]),
    turn: Math.max(0, tavernAssistantTurn(assistantEvent, events) || 0),
    step: Math.max(1, Number(assistantEvent.data && assistantEvent.data.step) || 1),
    source,
    shadowedSeqs: Object.freeze(shadowedSeqs.slice())
  })
}

export function planRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const oldAssistantSeq = Number(input && input.oldAssistantSeq)
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const oldAssistantIndex = nodes.indexOf(oldAssistantSeq)
  if (oldAssistantIndex < 0) throw new Error('旧正文已经不在当前模型消息面中')

  let finalAssistantIndex = -1
  for (let index = nodes.length - 1; index > oldAssistantIndex; index -= 1) {
    const seq = Number(nodes[index])
    if (seq < eventStart) continue
    const event = eventAt(events, seq)
    if (event && event.type === 'assistant/message' && modelSourceOf(event) !== null) {
      finalAssistantIndex = index
      break
    }
  }
  if (finalAssistantIndex < 0) throw new Error('重新生成流程未在当前模型消息面中产生正文')

  const shadowedSeqs = nodes.slice(oldAssistantIndex, finalAssistantIndex + 1).map(Number)
  if (shadowedSeqs.length === 0) throw new Error('重新生成流程没有需要替换的旧消息')
  return Object.freeze({
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    finalAssistantSeq: Number(nodes[finalAssistantIndex]),
    shadowedSeqs: Object.freeze(shadowedSeqs)
  })
}

export function planFailedTurnSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const turn = Math.max(0, Number(input && input.turn) || 0)
  let startSeq = -1
  let endSeq = -1
  for (const event of events) {
    if (!event || !Number.isSafeInteger(event.seq) || Number(event.data && event.data.turn) !== turn) continue
    if (event.type === 'turn/start') startSeq = Math.max(startSeq, event.seq)
    if (event.type === 'turn/end') endSeq = Math.max(endSeq, event.seq)
  }
  if (startSeq < 0 || endSeq <= startSeq) return null

  let firstIndex = -1
  let lastIndex = -1
  for (let index = 0; index < nodes.length; index += 1) {
    const seq = Number(nodes[index])
    if (seq <= startSeq || seq >= endSeq) continue
    if (firstIndex < 0) firstIndex = index
    lastIndex = index
  }
  if (firstIndex < 0 || lastIndex < firstIndex) return null

  const shadowedSeqs = nodes.slice(firstIndex, lastIndex + 1).map(Number)
  const outsideTurn = shadowedSeqs.find(function (seq) { return seq <= startSeq || seq >= endSeq })
  if (outsideTurn !== undefined) throw new Error('失败回合的模型消息面不是连续区间，无法安全清理: ' + outsideTurn)
  return Object.freeze({
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    shadowedSeqs: Object.freeze(shadowedSeqs)
  })
}

export function clearFailedTurnSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const cleanup = planFailedTurnSurface({
    events: sessionEvents(session),
    nodes: session.surface && session.surface.nodes,
    turn: input.turn
  })
  if (cleanup === null) return 0
  const makeId = typeof input.id === 'function' ? input.id : function () { return randomUUID() }
  // DSH permits plugin-injected user messages, but assistant messages must be
  // model-sourced on restore. Keep this empty tombstone explicitly plugin-owned.
  appendTavernEvent(session, 'user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }
  }, {
    surfaceOp: { op: 'replace', startSeq: cleanup.start, endSeq: cleanup.end },
    sourceEventSeqs: cleanup.shadowedSeqs
  })
  return cleanup.shadowedSeqs.length
}

/** Remove only the temporary DSH surface nodes appended by a regeneration attempt. */
export function clearRegenerationAttemptSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const suppliedId = typeof input.id === 'function' ? input.id() : null
  if (suppliedId && sessionEvents(session).some(event => event.data?.id === suppliedId && event.data?.source?.plugin === 'dsh-tavern-regeneration-abort')) return 0
  const nodes = session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const temporary = nodes.filter(function (seq) { return Number(seq) >= eventStart }).map(Number)
  if (temporary.length === 0) return 0
  const firstIndex = nodes.indexOf(temporary[0])
  const lastIndex = nodes.indexOf(temporary[temporary.length - 1])
  if (firstIndex < 0 || lastIndex < firstIndex || lastIndex - firstIndex + 1 !== temporary.length) {
    throw new Error('重新生成临时消息不是连续区间，无法安全清理')
  }
  const makeId = () => suppliedId || randomUUID()
  appendTavernEvent(session, 'user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin', plugin: 'dsh-tavern-regeneration-abort' }
  }, {
    surfaceOp: { op: 'replace', startSeq: temporary[0], endSeq: temporary[temporary.length - 1] },
    sourceEventSeqs: temporary
  })
  return temporary.length
}

export function hasRollbackMessages(messages,events=[]) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = object(list[index])
    if (!message || message.role !== 'assistant' || message.greeting === true) continue
    if(tavernTriggerTurnInput(events,Number(message.turn)))return true
    const user = object(list[index - 1])
    return user !== null && user.role === 'user'
  }
  return false
}
