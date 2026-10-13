import { sessionEvents } from './session-events.js'
import {decodeTavernEvent} from './session-message-source.js'
const installations = new WeakMap()
function authored(session, event, context) {
  if (event?.type !== 'assistant/message' || event.data?.usage !== undefined || Array.isArray(event.data?.stream)) return false
  const message = event.data.message, source = message?.source
  if (source?.kind !== 'model') return false
  if (source.provider === 'dsh-tavern' && source.model === 'synthetic-trajectory' && message.id?.startsWith('tavern-seed-trajectory:')) return true
  if (!['tavern', 'tavern-background'].includes(context().preset)) return false
  if (source.provider !== 'dsh-tavern' || source.model !== 'surface-edit') return false
  return context().markers.has(message.id)
}
/** Meter-only compatibility for authored content. Never mutates native history or relaxes provider validation. */
export function installTavernTokenMeter(meter) {
  if (!meter || typeof meter._foldEvent !== 'function' || typeof meter._sync !== 'function') throw new Error('当前 DSH Token Meter 不支持 Tavern 消息统计适配，请检查 DSH 版本')
  let entry = installations.get(meter)
  if (!entry) {
    const original = meter._foldEvent, sync = meter._sync
    const ownFold = Object.hasOwn(meter, '_foldEvent'), ownSync = Object.hasOwn(meter, '_sync')
    const cursors=new WeakMap()
    function before(session,state,seq){
      let cursor=cursors.get(state)
      if(!cursor||cursor.session!==session||seq<cursor.next){cursor={session,next:0,preset:session?.header?.agentPreset,markers:new Set()};cursors.set(state,cursor)}
      const events=typeof session.eventAt==='function'?null:sessionEvents(session)
      const at=index=>events?events[index]:session.eventAt(index)
      if(cursor.next>0 && at(cursor.next-1)!==cursor.tip){cursor={session,next:0,preset:session?.header?.agentPreset,markers:new Set()};cursors.set(state,cursor)}
      while(cursor.next<seq){const raw=at(cursor.next),prior=decodeTavernEvent(raw);cursor.tip=raw;cursor.next++;if(prior?.type==='agent-preset/selected')cursor.preset=prior.data?.agentPreset;if(prior?.type==='user/message'&&prior.data.source?.plugin==='dsh-tavern-surface-edit')cursor.markers.add(prior.data.source.replacement?.message?.id)}
      return cursor
    }
    let active
    function synchronize(session, ...rest) {
      const previous = active; active = session
      try { return sync.call(this, session, ...rest) } finally { active = previous }
    }
    function fold(...args) {
      const session = args.length === 3 ? args[0] : active, index = args.length - 1, event = args[index]
      if (authored(session, event,()=>before(session,args[args.length-2],event.seq))) args[index] = { ...event, type: 'user/message', data: event.data.message }
      return original.apply(this, args)
    }
    meter._sync = synchronize; meter._foldEvent = fold
    entry = { original, sync, ownFold, ownSync, users: 0 }; installations.set(meter, entry)
  }
  entry.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--entry.users) return
    if (entry.ownFold) meter._foldEvent = entry.original; else delete meter._foldEvent
    if (entry.ownSync) meter._sync = entry.sync; else delete meter._sync
    installations.delete(meter)
  }
}
