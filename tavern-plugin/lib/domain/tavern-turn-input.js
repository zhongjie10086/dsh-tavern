import {decodeTavernSource} from './session-message-source.js'

/** A trigger is an attributed empty carrier, never text-based continuation. */
export function isTavernTriggerInput(message){
 const source=decodeTavernSource(message?.source)
 return message?.role==='user'&&Array.isArray(message.content)&&message.content.length===0&&source?.kind==='plugin'
  &&(source.plugin==='dsh-tavern-trigger'||source.plugin==='dsh-tavern-regen'&&source.inputKind==='trigger')
}

export function isTavernTurnInput(message){
 const source=decodeTavernSource(message?.source)
 return Boolean(source&&(source.kind==='user'||source.kind==='plugin'&&source.plugin==='dsh-tavern-regen'||isTavernTriggerInput(message)))
}

/** Consult durable native attribution, including after restore/authored replies. */
export function tavernTriggerTurnInput(events,turn){
 let activeTurn=0,carrier=null
 for(const event of events||[]){
  if(event?.type==='turn/start')activeTurn=Number(event.data?.turn)||0
  if(event?.type==='user/message'&&Number(event.data?.turn??activeTurn)===Number(turn)&&isTavernTurnInput(event.data)){
   if(!isTavernTriggerInput(event.data))return null
   if(carrier)return null
   carrier=event.data
  }
  if(event?.type==='turn/end')activeTurn=0
 }
 return carrier
}
