import { appendAssistantEvent, isTavernSurfaceMarker, surfaceRange } from './session-surface-edit.js'
import { sessionEvents, surfaceReplacementRange } from './session-events.js'
import { randomUUID } from 'node:crypto'

export function rewindBackgroundSurface(session, boundary) {
  if (!Number.isSafeInteger(boundary)) return 0
  const events = sessionEvents(session)
  const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const bySeq=new Map(events.map((event,index)=>[Number.isSafeInteger(event.seq)?event.seq:index,event]))
  const groups=[];let group=null
  for(const seq of nodes){
    const event=bySeq.get(seq),id=event?.data?.message?.id || event?.data?.id || ''
    const fixed=event?.type==='system/message'||String(id).startsWith('tavern-session-prefix:')||isTavernSurfaceMarker(event)&&!event.data.source.replacement.message.content.length
    if(fixed||!Number.isSafeInteger(seq)||seq<=boundary){group=null;continue}
    if(group===null){group=[];groups.push(group)}
    group.push(seq)
  }
  if(!groups.length)return 0
  let source = null
  let turn = 0
  let step = 1
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = bySeq.get(nodes[index])
    const candidate = event && event.data && event.data.message && event.data.message.source
    if (event && event.type === 'assistant/message' && candidate && candidate.kind === 'model') {
      source = candidate
      turn = Math.max(0, Number(event.data.turn) || 0)
      step = Math.max(1, Number(event.data.step) || 1)
      break
    }
  }
  // A failed task may contain only a user message; this source labels the
  // durable empty marker, not an invented model execution.
  if (source === null) source = { kind: 'model', provider: 'dsh-tavern', model: 'background-rewind' }
  for(const shadowed of groups) appendAssistantEvent(session, {
    turn,
    step,
    message: { id: randomUUID(), role: 'assistant', content: [], source }
  }, {
    surfaceOp: { op: 'replace', startSeq: shadowed[0], endSeq: shadowed[shadowed.length - 1] },
    sourceEventSeqs: shadowed
  })
  return groups.reduce((count,group)=>count+group.length,0)
}

// Rebuild display suppression from durable empty surface replacements, including
// rollbacks performed before the UI projection existed. Keep raw events intact.
export function backgroundSuppressedTurns(events) {
  const turns = new Set()
  for (const event of events) {
    const op = surfaceRange(event.surfaceOp)
    const empty = isTavernSurfaceMarker(event) ? !event.data.source.replacement.message.content.length : event.type === 'assistant/message' && event.data?.message?.content?.length === 0
    if (!op || !empty) continue
    for (const previous of events) {
      if (!Number.isSafeInteger(previous.seq) || previous.seq < surfaceReplacementRange(op).start || previous.seq > surfaceReplacementRange(op).end) continue
      const turn = previous.data?.turn
      if (Number.isSafeInteger(turn) && turn > 0) turns.add(turn)
    }
  }
  return [...turns].sort((a, b) => a - b)
}
