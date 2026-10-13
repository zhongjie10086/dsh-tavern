import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { immutableJsonSnapshot, mutableJsonDraft } from './json-draft.js'
const clone=structuredClone
/** Project the admitted native input during a running turn. It is not another chat log. */
export function templateInputView(source) {
  if(!source)return {chat:source,input:null}
  const operation=Object.values(source.timeline?.operations||{}).filter(op=>op.kind==='body'&&op.status==='running'&&(!op.basedOn?.branchId||op.basedOn.branchId===source.timeline?.branchId)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]
  if(!operation || !String(operation.userText||'').trim())return {chat:source,input:null}
  const pending=source.fullPromptTemplatePendingInput?.operationId===operation.id?source.fullPromptTemplatePendingInput:null
  const floor=pending?.floor ?? source.messages.length
  const text=String(pending?.text ?? operation.userText)
  // A prepared reply already contains the admitted input as a real Chat floor.
  if(source.messages.length>floor && source.messages[floor]?.role==='user')return {chat:source,input:null}
  const chat=mutableJsonDraft(immutableJsonSnapshot(source)),variables=clone(pending?.variables||[lastTavernHelperVariables(chat.messages)||{}])
  chat.messages.push({role:'user',turn:operation.turn,text,sourceText:text,swipes:[text],swipeId:0,variables,...pending?.tavernPluginData?{tavernPluginData:clone(pending.tavernPluginData)}:{}})
  return {chat,input:{operationId:operation.id,floor,sourceText:text,turn:operation.turn,branchId:source.timeline?.branchId,lifecycleRevision:Number(source.tavernHelperLifecycleRevision)||0}}
}
export function persistTemplateInputView(chat,input) {
  if(!input)return chat
  if(chat.messages.length!==input.floor+1)throw new Error('模板当前输入楼层已经变化')
  const row=chat.messages.pop()
  if(row.role!=='user')throw new Error('正在发送的输入必须保留用户角色')
  const previous=chat.fullPromptTemplatePendingInput?.operationId===input.operationId?chat.fullPromptTemplatePendingInput:{}
  chat.fullPromptTemplatePendingInput={...previous,...input,text:row.sourceText??row.text,variables:clone(row.variables||[]),tavernPluginData:clone(row.tavernPluginData||{})}
  return chat
}
/** Attach request-time user variables to the same floor when the reply commits. */
export function consumeTemplateInput(chat) {
  const pending=chat.fullPromptTemplatePendingInput
  if(!pending)return chat
  if((pending.branchId!==undefined&&pending.branchId!==chat.timeline?.branchId)||(pending.lifecycleRevision!==undefined&&pending.lifecycleRevision!==(Number(chat.tavernHelperLifecycleRevision)||0))){delete chat.fullPromptTemplatePendingInput;return chat}
  const row=chat.messages[pending.floor]
  if(!row||row.role!=='user'||Number(row.turn)!==Number(pending.turn))return chat
  row.variables=clone(pending.variables||[])
  if(typeof pending.text==='string' && row.text!==pending.text)Object.assign(row,{text:pending.text,sourceText:pending.text,projectionText:pending.text,swipes:[pending.text]})
  // A MESSAGE_SENT skipped for an unready runtime (R8 1.5) is not delivered late as history.
  if((chat.tavernHelperEventJournal||[]).some(event=>event.inputOperationId===pending.operationId&&event.name==='MESSAGE_SENT'&&(event.status==='completed'||event.status==='discarded'&&event.runtimeUnavailable===true)))row.tavernHelperInputDelivered=true
  row.tavernPluginData={...row.tavernPluginData,...clone(pending.tavernPluginData||{})}
  row.swipeId=0;row.swipes ||= [row.sourceText??row.text]
  delete chat.fullPromptTemplatePendingInput
  return chat
}
