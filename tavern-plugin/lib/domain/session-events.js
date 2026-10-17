import { appendAssistantEvent } from './session-surface-edit.js'
import { appendTavernEvent, decodeTavernEvent } from './session-message-source.js'

const EMPTY = Object.freeze([])
const views = new WeakMap()

// Expose decoded Tavern metadata as an immutable read view. Keep native event
// objects untouched and preserve snapshot identity when no decoding is needed.
export function sessionEvents(session) {
  if (!session) return EMPTY
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events
  if (!Array.isArray(events)) return EMPTY
  const cached = views.get(events)
  if (cached) return cached
  let result = events
  for (let index = 0; index < events.length; index++) {
    const decoded = decodeTavernEvent(events[index])
    if (decoded !== events[index]) {
      if (result === events) result = events.slice()
      result[index] = decoded
    }
  }
  if (Object.isFrozen(events)) {
    if (result !== events) Object.freeze(result)
    // Only cache arrays whose nested values cannot change under this view.
    if (events.every(event => Object.isFrozen(event))) views.set(events, result)
  }
  return result
}

// The rc2 host owns system message emission inside an open turn/step.
// Do not insert an out-of-turn placeholder before Tavern seeds.

// Normalize only new writes at the host boundary. Existing events, seqs and
// provenance stay untouched; V3 migrations remain owned by DSH.
export function sessionEventData(session, type, data) {
  return session?.header?.version >= 3 && type === 'assistant/message' && data.stream === undefined
    ? { ...data, stream: [] } : data
}

export function appendSessionEvent(session, type, data, intent) {
  if (session?.header?.version >= 3) {
    if (intent) {
      intent = { ...intent }
      const op = intent.surfaceOp
      if (op && typeof op === 'object' && op.op === 'replace' && 'start' in op) {
        intent.surfaceOp = { op: 'replace', startSeq: op.start, endSeq: op.end }
      }
      if (type === 'assistant/message' && intent.surfaceOp === 'append') delete intent.sourceEventSeqs
    }
  }
  data = sessionEventData(session, type, data)
  if (session?.header?.version >= 3 && type === 'assistant/message' && intent?.surfaceOp?.op === 'replace') return appendAssistantEvent(session, data, intent)
  return appendTavernEvent(session, type, data, intent)
}

export function surfaceReplacementRange(op) {
  return { start: op.startSeq ?? op.start, end: op.endSeq ?? op.end }
}

// V4 cold reads require a protected system head before authored prefix/seed
// messages. The first native prompt projection replaces this empty assembly;
// it is not an extra model turn or an out-of-step system placeholder.
export function ensureInitialSystemHead(session) {
 if(!(session?.header?.version>=4)||typeof session?.append!=='function')return false
 const events=sessionEvents(session),id='tavern-initial-system-head:'+session.id
 if(events.some(event=>event.type==='system/message'&&event.data.message?.id===id))return true
 if(session.surface?.nodes?.length)return false // Never rewrite an existing Session.
 const stages=[['turn/start',{turn:1}],['step/start',{turn:1,step:1}],['system/message',{turn:1,step:1,message:{id,role:'system',content:[],source:{kind:'system-prompt'}}},{surfaceOp:'append'}]]
 const execution=events.filter(event=>['turn/start','step/start','step/end','turn/end'].includes(event.type))
 if(execution.length>2||execution.some((event,index)=>event.type!==stages[index][0]||event.data.turn!==1||index===1&&event.data.step!==1))return false
 for(const [type,data,intent]of stages.slice(execution.length))appendTavernEvent(session,type,data,intent)
 return true
}
