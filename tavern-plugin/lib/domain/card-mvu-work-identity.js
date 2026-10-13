import {createHash} from 'node:crypto'
import {projectTavernHelperContext} from './tavern-helper-context.js'

export function cardMvuTargetStamp(chat,event){
 const index=event.args?.[0],row=chat.messages?.[index]
 return createHash('sha256').update(JSON.stringify([index,row&&(row.tavernHistoryKey||'floor:'+index),row&&(row.tavernRoleOverride||row.tavernRole||row.role),row&&(row.sourceText??row.text??''),row?.swipeId||0,row?.swipes?.[row?.swipeId||0]])).digest('hex')
}
export function cardMvuContextIdentity(chat,event){
 return {chatId:String(chat.id||''),branchId:String(chat.timeline?.branchId||''),lifecycleRevision:Number(chat.tavernHelperLifecycleRevision)||0,targetStamp:cardMvuTargetStamp(chat,event)}
}
export function cardMvuExpectedIdentity(chat,event){
 const message=projectTavernHelperContext(chat).messages[event.args?.[0]],pending=event.cardMvu
 return {version:1,...cardMvuContextIdentity(chat,event),coreId:pending.coreId,sourceDigest:pending.sourceDigest,
  targetView:{messageId:Number(event.args?.[0]),message:String(message?.message||''),swipeId:Number(message?.swipe_id)||0,role:String(message?.role||'')}}
}
export function cardMvuPredecessor(chat,event,core){
 const rows=chat.tavernHelperEventJournal||[],index=rows.findIndex(row=>row.id===event.id)
 return rows.slice(0,index<0?rows.length:index).find(row=>row.cardMvu&&!['completed','discarded'].includes(row.cardMvu.status)
  &&row.cardMvu.coreId===core.id&&row.cardMvu.sourceDigest===String(core.sourceDigest||'')
  &&row.lifecycle===(Number(chat.tavernHelperLifecycleRevision)||0)&&row.branchId===(chat.timeline?.branchId||'')
  &&row.cardMvu.targetStamp===cardMvuTargetStamp(chat,row))
}
