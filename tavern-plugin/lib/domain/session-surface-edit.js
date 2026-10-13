import { appendTavernEvent } from './session-message-source.js'
import { sessionEvents } from './session-events.js'

const PREFIX = 'tavern-surface-edit:'
export function surfaceRange(op) {
  return op?.op === 'replace' ? { start: op.startSeq ?? op.start, end: op.endSeq ?? op.end } : null
}
export function isTavernSurfaceMarker(event) {
  return event?.type === 'user/message' && event.data?.source?.plugin === 'dsh-tavern-surface-edit' && Boolean(event.data.source.replacement?.message)
}
export function pendingAssistantEdit(session, id) {
  return sessionEvents(session).find(event => isTavernSurfaceMarker(event) && event.data.id === PREFIX + id)
}

/** Authored replies still need a real native step, including after a turn ends. */
export function authoredExecution(events) {
  let turn = null, step = null, lastTurn = 0, lastStep = 0
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data.turn; lastTurn = Math.max(lastTurn, turn); lastStep = 0 }
    else if (event.type === 'turn/end') { lastTurn = Math.max(lastTurn, event.data.turn); turn = null; step = null }
    else if (event.type === 'step/start') { step = event.data.step; lastStep = step }
    else if (event.type === 'step/end') step = null
  }
  return { turn: turn ?? lastTurn + 1, step: step ?? (turn === null ? 1 : lastStep + 1), ownsTurn: turn === null, ownsStep: step === null }
}

export function createTavernTurnIndex(events) {
 const history=new Map(),surface=new Map()
 for(const event of events){if(event.type!=='user/message')continue;const source=event.data?.source;if(source?.plugin==='dsh-tavern-history-edit')for(const [id,turn]of Object.entries(source.turnMappings||{}))history.set(id,Number(turn));if(isTavernSurfaceMarker(event)&&!surface.has(event.data.id))surface.set(event.data.id,Number(source.replacement?.turn))}
 return {history,surface}
}
export function tavernAssistantTurn(event, events, index) {
  if (event?.type !== 'assistant/message') return 0
  if (event.data.message?.source?.provider === 'dsh-tavern' && event.data.message.source.model === 'history-edit') {
    if(index?.history.has(event.data.message.id))return index.history.get(event.data.message.id)
    const marker=index?null:events.findLast(e=>e.type==='user/message' && e.data.source?.plugin==='dsh-tavern-history-edit' && Object.hasOwn(e.data.source.turnMappings||{},event.data.message.id))
    if(marker)return Number(marker.data.source.turnMappings[event.data.message.id])
  }
  if (event.data.message?.source?.provider === 'dsh-tavern' && event.data.message.source.model === 'surface-edit') {
    if(index?.surface.has(PREFIX+event.data.message.id))return index.surface.get(PREFIX+event.data.message.id)
    const marker = index?null:events.find(e => isTavernSurfaceMarker(e) && e.data.id === PREFIX + event.data.message.id)
    if (marker) return Number(marker.data.source.replacement.turn)
  }
  return Number(event.data.turn)
}
export function authoredTurnMappings(session) {
  const events = sessionEvents(session), nodes = new Set(session?.surface?.nodes || []), result = {}, index=createTavernTurnIndex(events)
  for (const event of events) {
    if (event.type !== 'assistant/message' || !nodes.has(event.seq)) continue
    const turn = tavernAssistantTurn(event, events,index)
    if (turn > 0 && turn !== event.data.turn) result[turn] = event.data.turn
  }
  return result
}

function finishAuthoredMessage(session, marker, data) {
  const recorded = marker.data.source.execution
  // Old conversions had no separate execution envelope; preserve their receipt.
  if (!recorded) {
    const existing = sessionEvents(session).find(e => e.type === 'assistant/message' && e.data.message.id === data.message.id)
    if (existing) return existing
    throw new Error('旧版正文编辑缺少执行边界，需升级存档后恢复')
  }
  const stages = [
    ...recorded.ownsTurn ? [['turn/start', { turn: recorded.turn }]] : [],
    ...recorded.ownsStep ? [['step/start', { turn: recorded.turn, step: recorded.step }]] : [],
    ['assistant/message', { ...data, turn: recorded.turn, step: recorded.step, stream: [],
      message: { ...data.message, source: { kind: 'model', provider: 'dsh-tavern', model: 'surface-edit' } } }, { surfaceOp: 'append' }],
    ...recorded.ownsStep ? [['step/end', { turn: recorded.turn, step: recorded.step }]] : [],
    ...recorded.ownsTurn ? [['turn/end', { turn: recorded.turn, reason: { kind: 'completed' } }]] : []
  ]
  let result
  for (let index = 0; index < stages.length; index++) {
    const [type, payload, intent] = stages[index]
    const tail = sessionEvents(session).filter(e => e.seq > marker.seq && e.type !== 'session/end-seed')
    let event = tail[index]
    if (event) {
      if (event.type !== type || JSON.stringify(event.data) !== JSON.stringify(payload)) throw new Error('未完成的正文编辑被其他事件推进，拒绝重复写入')
    } else event = intent ? session.append(type, payload, intent) : session.append(type, payload)
    if (type === 'assistant/message') result = event
  }
  return result
}

/** Empty markers may replace any current range. Nonempty authored replies are
 * appended after the marker, so their replacement must still cover the tail. */
export function appendAssistantEvent(session, data, intent = { surfaceOp: 'append' }) {
  const range = surfaceRange(intent.surfaceOp)
  if (!range) {
    if (intent.sourceEventSeqs?.length) throw new Error('Assistant append cannot cite earlier events')
    return session.append('assistant/message', { ...data, stream: data.stream || [] }, { surfaceOp: 'append' })
  }
  const id = data.message?.id
  if (!id) throw new Error('正文替换缺少消息标识')
  let marker = pendingAssistantEdit(session, id)
  if (marker) {
    if (JSON.stringify(marker.data.source.replacement) !== JSON.stringify(data)) throw new Error('正文替换标识已用于不同内容')
  } else {
    const nodes = [...session.surface.nodes]
    const start = nodes.indexOf(range.start), end = nodes.indexOf(range.end)
    if (start < 0 || end < start || (data.message.content.length > 0 && end !== nodes.length - 1)) throw new Error('正文替换必须覆盖当前消息尾部；上下文已经变化')
    const shadowed = nodes.slice(start, end + 1)
    if (!Array.isArray(intent.sourceEventSeqs) || shadowed.some(seq => !intent.sourceEventSeqs.includes(seq))) throw new Error('正文替换缺少原始消息来源')
    const execution = data.message.content.length ? authoredExecution(sessionEvents(session)) : null
    marker = appendTavernEvent(session, 'user/message', {
      id: PREFIX + id, role: 'user', content: [],
      source: { kind: 'plugin', plugin: 'dsh-tavern-surface-edit', replacement: data, ...execution ? { execution } : {} }
    }, { surfaceOp: { op: 'replace', startSeq: range.start, endSeq: range.end }, sourceEventSeqs: shadowed })
  }
  if (!data.message.content.length) return marker
  return finishAuthoredMessage(session, marker, data)
}

/** Replay only the exact interrupted operation; never resubmit to a model. */
export function recoverAssistantEdits(session) {
  for (const event of sessionEvents(session)) {
    if (!isTavernSurfaceMarker(event) || !event.data.source.replacement?.message?.content?.length) continue
    const data = event.data.source.replacement
    const existing = sessionEvents(session).find(e => e.type === 'assistant/message' && e.data.message?.id === data.message.id)
    if (!existing && session.surface.nodes.at(-1) !== event.seq) throw new Error('未完成的正文编辑之后出现了新消息，无法自动恢复')
    finishAuthoredMessage(session, event, data)
  }
}
export function syncAuthoredAgentPhase(agent) {
  if (agent?.phase?.kind !== 'idle' || !agent.session) return
  const lastTurn = sessionEvents(agent.session).reduce((n, e) => e.type === 'turn/end' ? Math.max(n, e.data.turn) : n, 0)
  agent.phase.lastTurn = Math.max(agent.phase.lastTurn || 0, lastTurn)
}
