import {decodeTavernSource} from './session-message-source.js'
import {sessionEvents} from './session-events.js'

/** A trigger is an attributed empty carrier, never text-based continuation. */
export function isTavernTriggerInput(message){
 const source=decodeTavernSource(message?.source)
 return message?.role==='user'&&Array.isArray(message.content)&&message.content.length===0&&source?.kind==='plugin'
  &&(source.plugin==='dsh-tavern-trigger'||source.plugin==='dsh-tavern-regen'&&source.inputKind==='trigger')
}

export function isTavernTurnInput(message){
 const source=decodeTavernSource(message?.source)
 return Boolean(message?.role==='user'&&source&&(source.kind==='user'||source.kind==='plugin'&&['dsh-tavern-regen','dsh-tavern-replay'].includes(source.plugin)||isTavernTriggerInput(message)))
}

/** An edit preserves its original request/source, but never starts another turn. */
export function isNewTavernTurnInput(event){
 return event?.type==='user/message'&&isTavernTurnInput(event.data)&&(!event.surfaceOp||event.surfaceOp==='append')
}

export function userMessageForTurn(session,turn){
 const events=sessionEvents(session)
 const start=events.findLastIndex(event=>event?.type==='turn/start'&&Number(event.data?.turn)===Number(turn))
 if(start<0)return null
 for(const event of events.slice(start+1)){
  if(event?.type==='turn/start'||event?.type==='turn/end')break
  if(isNewTavernTurnInput(event))return event.data
 }
 return null
}

export function tavernRequestIdOf(message){
 if(isTavernTriggerInput(message))return String(message.id||'').trim()
 const source=decodeTavernSource(message?.source)
 return source?.kind==='user'?String(source.rpcId||'').trim():''
}

export function requestIdForTurn(session,turn){return tavernRequestIdOf(userMessageForTurn(session,turn))}

/** Failed/rejected sends are residue, not story that can block recovery. */
export function storyPlayerInputs(events,from=0){
 const failed=new Set(events.filter(event=>event?.type==='turn/end'&&['error','aborted','interrupted'].includes(event.data?.reason?.kind)).map(event=>Number(event.data.turn)))
 let turn=0
 return events.filter(event=>{
  if(event?.type==='turn/start'){turn=Number(event.data.turn);return false}
  if(event?.type==='turn/end'){turn=0;return false}
  return event?.seq>=from&&isNewTavernTurnInput(event)&&decodeTavernSource(event.data.source)?.kind==='user'&&!failed.has(turn)
 })
}

/** Consult durable native attribution, including after restore/authored replies. */
export function tavernTriggerTurnInput(events,turn){
 let activeTurn=0,carrier=null
 for(const event of events||[]){
  if(event?.type==='turn/start')activeTurn=Number(event.data?.turn)||0
  if(isNewTavernTurnInput(event)&&Number(event.data?.turn??activeTurn)===Number(turn)){
   if(!isTavernTriggerInput(event.data))return null
   if(carrier)return null
   carrier=event.data
  }
  if(event?.type==='turn/end')activeTurn=0
 }
 return carrier
}
