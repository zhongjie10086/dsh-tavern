import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { immutableJsonSnapshot, mutableJsonDraft } from './json-draft.js'
import {isDeepStrictEqual} from 'node:util'
import {diffJson,applyJsonChanges} from './json-mutation.js'
const clone=structuredClone
const scopeFields=['variables','promptTemplateInitialVariables']
const scopes=chat=>Object.fromEntries(scopeFields.map(key=>[key,Object.hasOwn(chat,key)?clone(chat[key]):{}]))
function at(value,path){for(const key of path){if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return {present:false};value=value[key]}return {present:true,value:clone(value)}}

/** Remember only writes owned by this admitted input, never a whole Chat undo. */
export function rememberTemplateInputScopes(chat,input){
 if(!input?.scopeBaseline)return chat
 const previous=chat.fullPromptTemplatePendingInput?.operationId===input.operationId?chat.fullPromptTemplatePendingInput:{}
 const after=scopes(chat),undo=[...(previous.scopeUndo||[])]
 for(const change of diffJson(input.scopeBaseline,after)){
  const path=change.path,key=JSON.stringify(path),index=undo.findIndex(row=>JSON.stringify(row.path)===key)
  const before=at(input.scopeBaseline,path),desired=at(after,path),prior=undo[index]
  const record={path,before:prior&&isDeepStrictEqual(prior.after,before)?prior.before:before,after:desired}
  if(index<0)undo.push(record);else undo[index]=record
 }
 const {scopeBaseline,...identity}=input
 chat.fullPromptTemplatePendingInput={...previous,...identity,scopeAbsent:previous.scopeAbsent||identity.scopeAbsent||[],scopeUndo:undo}
 return chat
}

/** Failed inputs undo only unchanged owned values; later successful writes win. */
export function discardTemplateInput(chat,{turn,exceptTurn}={}){
 const pending=chat.fullPromptTemplatePendingInput
 if(!pending||(turn!==undefined&&Number(pending.turn)!==Number(turn))||(exceptTurn!==undefined&&Number(pending.turn)===Number(exceptTurn)))return false
 if(pending.branchId===chat.timeline?.branchId&&pending.lifecycleRevision===(Number(chat.tavernHelperLifecycleRevision)||0)){
  let state=scopes(chat);const conflicts=[]
  for(const record of [...(pending.scopeUndo||[])].reverse()){
   if(!isDeepStrictEqual(at(state,record.path),record.after)){conflicts.push(record.path);continue}
   state=applyJsonChanges(state,[record.before.present?{op:'set',path:record.path,value:record.before.value}:{op:'delete',path:record.path}])
  }
  for(const field of scopeFields)if(pending.scopeAbsent?.includes(field)&&state[field]&&typeof state[field]==='object'&&!Object.keys(state[field]).length)delete chat[field];else chat[field]=state[field]
  if(conflicts.length)chat.fullPromptTemplateInputRecovery={operationId:pending.operationId,turn:pending.turn,status:'kept-newer-values',paths:conflicts}
 }
 delete chat.fullPromptTemplatePendingInput
 return true
}
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
  return {chat,input:{operationId:operation.id,floor,sourceText:text,turn:operation.turn,branchId:source.timeline?.branchId,lifecycleRevision:Number(source.tavernHelperLifecycleRevision)||0,scopeBaseline:scopes(source),scopeAbsent:scopeFields.filter(key=>!Object.hasOwn(source,key))}}
}
export function persistTemplateInputView(chat,input) {
  if(!input)return chat
  if(chat.messages.length!==input.floor+1)throw new Error('模板当前输入楼层已经变化')
  const row=chat.messages.pop()
  if(row.role!=='user')throw new Error('正在发送的输入必须保留用户角色')
  rememberTemplateInputScopes(chat,input)
  chat.fullPromptTemplatePendingInput={...chat.fullPromptTemplatePendingInput,text:row.sourceText??row.text,variables:clone(row.variables||[]),tavernPluginData:clone(row.tavernPluginData||{})}
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
