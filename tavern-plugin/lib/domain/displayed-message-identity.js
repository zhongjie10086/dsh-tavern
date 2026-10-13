import {createHash} from 'node:crypto'
import {sessionEvents} from './session-events.js'
import {tavernAssistantTurn} from './session-surface-edit.js'

// Read the selected Helper floor and adopted native body without projecting
// variable snapshots, worldbooks, storage, SQL or the complete session view.
export function readDisplayedMessageIdentity(chat,session,messageId,scriptIds) {
  if(!Number.isSafeInteger(messageId)||messageId<0)return null;
  const rows=(chat?.messages||[]).filter(row=>row&&typeof row==='object'),source=rows[messageId];
  if(!source||source.role!=='assistant'||source.tavernRoleOverride&&source.tavernRoleOverride!=='assistant')return null;
  const turn=Math.max(0,Number(source.turn)||(source.greeting===true?1:0));if(!turn)return null;
  if(rows.slice(messageId+1).some(row=>(row.tavernRoleOverride|| (row.role==='tavern-helper'?row.tavernRole||'assistant':row.role==='user'?'user':'assistant'))==='assistant'&&Math.max(0,Number(row.turn)||(row.greeting===true?1:0))===turn))return null;
  const events=sessionEvents(session),nodes=new Set(session?.surface?.nodes||[]);let bodyId='';
  for(const event of events){
    if(event.type!=='assistant/message'||!nodes.has(event.seq)||event.data?.message?.source?.model==='synthetic-trajectory'||!event.data?.message?.content?.some(block=>block.type==='text'&&block.text))continue;
    if(tavernAssistantTurn(event,events)===turn)bodyId=event.data.message.id;
  }
  if(!bodyId)return null;
  const count=Math.max(source.swipes?.length||0,source.variables?.length||0,1),swipeId=Math.max(0,Math.min(count-1,Number(source.swipeId)||0));
  const text=source.swipes?.length?String(source.swipes[swipeId]??source.swipes[0]??''):String(source.sourceText||source.text||'');
  return {bodyId,messageDigest:createHash('sha256').update(text).digest('hex'),swipeId,lifecycleRevision:Math.max(0,Number(chat.tavernHelperLifecycleRevision)||0),scriptIds};
}
