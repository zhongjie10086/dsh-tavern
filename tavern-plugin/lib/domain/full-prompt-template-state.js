import { isDeepStrictEqual } from 'node:util'
import {randomUUID} from 'node:crypto'
import { projectTavernHelperContext } from './tavern-helper-context.js'
import { assertPluginJson } from './tavern-chat-plugin-data.js'
import { immutableJsonSnapshot, mutableJsonDraft, finishJsonDraft } from './json-draft.js'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const fixedMessageFields = ['mes', 'is_user', 'is_system', 'name', 'swipe_id', 'swipes']
const protectedPluginFields = new Set(['message_id','message','role','send_date','swipes_data','pluginData','original_avatar','force_avatar'])
const pluginFields = row => Object.fromEntries(Object.entries(row || {}).filter(([key])=>![...fixedMessageFields,'variables','__dsh_message_key'].includes(key) && !protectedPluginFields.has(key)))

/** Detached upstream-shaped state, not a second authoritative chat history. */
export function projectFullPromptTemplateState(chat) {
  chat=finishJsonDraft(chat)
  const helper = projectTavernHelperContext(chat)
  const metadata=structuredClone(helper.chatMetadata);delete metadata.world_info
  if(chat.tavernChatWorldbook)metadata.world_info=chat.tavernChatWorldbook.name
  return {
    chatId: chat.id, sessionId: chat.sessionId, messageIdentityVersion:1,
    stateRevision: helper.stateRevision, lifecycleRevision: helper.lifecycleRevision,
    chat: helper.messages.map((message,index) => ({
      __dsh_message_key:chat.messages[index].tavernTemplateKey||[chat.id,index,chat.messages[index].tavernNativeMessageId||chat.messages[index].turn||0].join(':'),
      mes: message.message, is_user: message.role === 'user', is_system: message.role === 'system',
      name: message.name || '', swipe_id: message.swipe_id, swipes: structuredClone(message.swipes),
      variables: message.swipes_data.map(value => value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {}),
      ...structuredClone(pluginFields(message.pluginData))
    })),
    chat_metadata: { ...metadata, variables: structuredClone(helper.chatVariables) }
  }
}

function conflict(message) {
  const error = new Error(message)
  error.code = 'PROMPT_TEMPLATE_STATE_CONFLICT'
  throw error
}
function merge(base, current, desired, label) {
  const next = structuredClone(current)
  for (const key of new Set([...Object.keys(base), ...Object.keys(desired)])) {
    const equals = (a,b) => own(a,key) === own(b,key) && isDeepStrictEqual(a[key],b[key])
    if (equals(base,desired)) continue
    if (!equals(base,current) && !equals(desired,current)) conflict(label + '已被其他操作修改，请重新读取')
    if (own(desired,key)) Object.defineProperty(next,key,{value:structuredClone(desired[key]),enumerable:true,writable:true,configurable:true})
    else delete next[key]
  }
  return next
}
function identity(row) { return Object.fromEntries(fixedMessageFields.map(key=>[key,row?.[key]])) }

export function validateFullPromptTemplateSave(request) {
  if (!request || typeof request.chatId !== 'string' || !request.chatId
    || !Number.isSafeInteger(request.stateRevision) || request.stateRevision < 1
    || !Number.isSafeInteger(request.lifecycleRevision) || request.lifecycleRevision < 0
    || !Array.isArray(request.chat)) throw new Error('模板存档缺少有效的读取版本')
  if (Object.keys(request).some(key=>!['chatId','sessionId','stateRevision','lifecycleRevision','messageIdentityVersion','chat','chat_metadata'].includes(key))) throw new Error('模板存档包含不支持的字段')
  assertPluginJson(request.chat_metadata, '模板聊天元数据')
  if (!request.chat_metadata.variables || Array.isArray(request.chat_metadata.variables) || typeof request.chat_metadata.variables !== 'object') throw new Error('模板聊天变量必须是对象')
  for (const row of request.chat) {
    assertPluginJson(row, '模板消息')
    if (Object.keys(row).some(key=>protectedPluginFields.has(key))) throw new Error('模板消息包含受宿主管理的字段')
    if(row.__dsh_message_key!==undefined&&typeof row.__dsh_message_key!=='string')throw new Error('消息身份标记无效')
    if(row.__dsh_message_key===undefined&&row.variables===undefined)continue
    if (!Array.isArray(row.variables)) throw new Error('模板消息变量必须按 swipe 保存')
    row.variables.forEach(value=>assertPluginJson(value,'模板消息变量'))
  }
}

/** Merge only changed template state against an authoritative persisted baseline. */
export function applyFullPromptTemplateState(current, baseline, request, { allowMessageBodyChanges = new Set() } = {}) {
  validateFullPromptTemplateSave(request)
  if (!baseline || baseline.id !== request.chatId || baseline._storageRevision !== request.stateRevision
    || current.id !== request.chatId || current.sessionId !== baseline.sessionId
    || request.sessionId !== current.sessionId
    || (current.tavernHelperLifecycleRevision || 0) !== request.lifecycleRevision
    || (baseline.tavernHelperLifecycleRevision || 0) !== request.lifecycleRevision) conflict('模板读取版本已过期或聊天已切换')
  const base = projectFullPromptTemplateState(baseline), latest = projectFullPromptTemplateState(current)
  if (request.chat.length !== base.chat.length || latest.chat.length !== base.chat.length) conflict('聊天楼层已变化，模板存档未保存')
  const next = mutableJsonDraft(immutableJsonSnapshot(current))
  for (let index=0; index<base.chat.length; index++) {
    const before=base.chat[index], now=latest.chat[index], desired=request.chat[index]
    if (!isDeepStrictEqual(identity(before),identity(now))) conflict('聊天正文或 swipe 已变化，模板存档未保存')
    if (!isDeepStrictEqual(identity(before),identity(desired))) {
      const permitted = allowMessageBodyChanges.has(index) && typeof desired.mes === 'string'
        && isDeepStrictEqual({ ...identity(before), mes: desired.mes }, identity(desired))
      if (!permitted) {
        const error=new Error('模板正文修改需要原生历史操作，不能通过变量存档提交')
        error.code='PROMPT_TEMPLATE_HISTORY_UNSUPPORTED'; throw error
      }
      const message=next.messages[index], swipe=Number(message.swipeId)||0
      message.text=desired.mes; message.sessionText=desired.mes; message.displayText=desired.mes; message.sourceText=desired.mes; message.projectionText=desired.mes
      message.swipes=structuredClone(message.swipes || before.swipes); message.swipes[swipe]=desired.mes
    }
    const count=Math.max(before.variables.length,now.variables.length,1)
    if (desired.variables.length > Math.max(count,before.swipes.length)) conflict('模板变量指向不存在的 swipe')
    const variables=structuredClone(now.variables)
    for(let swipe=0;swipe<Math.max(before.variables.length,desired.variables.length);swipe++) {
      const b=before.variables[swipe] || {}, d=desired.variables[swipe] || {}, n=now.variables[swipe] || {}
      if (!isDeepStrictEqual(b,d)) variables[swipe]=merge(b,n,d,'消息变量')
    }
    if (!isDeepStrictEqual(variables,now.variables)) next.messages[index].variables=variables
    const fields = pluginFields
    const merged=merge(fields(before),fields(now),fields(desired),'模板消息标记')
    if (!isDeepStrictEqual(merged,fields(now))) {
      const data={...next.messages[index].tavernPluginData}
      for(const key of new Set([...Object.keys(fields(before)),...Object.keys(fields(now)),...Object.keys(merged)])) { if(own(merged,key)) Object.defineProperty(data,key,{value:merged[key],enumerable:true,writable:true,configurable:true}); else delete data[key] }
      next.messages[index].tavernPluginData=data
    }
  }
  if(request.chat_metadata.world_info!==base.chat_metadata.world_info)throw new Error('请通过世界书绑定操作修改本局世界书')
  const withoutVariables = value => Object.fromEntries(Object.entries(value).filter(([key])=>!['variables','world_info'].includes(key)))
  const metadata=merge(withoutVariables(base.chat_metadata),withoutVariables(latest.chat_metadata),withoutVariables(request.chat_metadata),'模板聊天元数据')
  // Merge the variable namespace per key, preserving unrelated concurrent MVU writes.
  metadata.variables=merge(base.chat_metadata.variables,latest.chat_metadata.variables,request.chat_metadata.variables,'聊天变量')
  next.variables=metadata.variables; delete metadata.variables
  next.tavernPluginMetadata={...Object.fromEntries(Object.entries(current.tavernPluginMetadata||{}).filter(([key])=>['variables','world_info'].includes(key))),...metadata}
  return next
}

/** saveChat can edit the native history; stable opaque keys retain floor identity through array edits. */
export function fullPromptTemplateHistoryChanged(base,request){
 return !base||base.chat.length!==request.chat.length||request.chat.some((row,i)=>row.__dsh_message_key!==base.chat[i].__dsh_message_key||!isDeepStrictEqual(identity(row),identity(base.chat[i])))
}
export function applyFullPromptTemplateHistoryState(current,baseline,request){
 validateFullPromptTemplateSave(request)
 if(!baseline||current._storageRevision!==baseline._storageRevision)conflict('聊天历史已变化，请重新读取后保存')
 const base=projectFullPromptTemplateState(baseline),neutral={...request,chat:base.chat},next=applyFullPromptTemplateState(current,baseline,neutral)
 const keyed=new Map(base.chat.map((row,i)=>[row.__dsh_message_key,i])),seen=new Set(),rows=[]
 for(const [position,desired]of request.chat.entries()){
  const key=desired.__dsh_message_key,index=key===undefined?undefined:keyed.get(key)
  if(key!==undefined&&(index===undefined||seen.has(key)))conflict('消息身份标记重复或不属于当前读取版本')
  if(key!==undefined)seen.add(key)
  if(typeof desired.mes!=='string'||typeof desired.is_user!=='boolean'||desired.is_system!==undefined&&typeof desired.is_system!=='boolean'||desired.is_user&&desired.is_system)throw new Error('消息正文或角色无效')
  const before=index===undefined?null:base.chat[index],row=index===undefined?{role:desired.is_user?'user':desired.is_system?'system':'assistant',ts:Date.now(),native:true,turn:current.messages[Math.min(position,current.messages.length-1)]?.turn||rows.at(-1)?.turn||1}:structuredClone(current.messages[index])
  row.tavernTemplateKey=key||'template:'+randomUUID()
  const swipes=structuredClone(desired.swipes||[desired.mes]),swipe=desired.swipe_id??0
  if(!Array.isArray(swipes)||!swipes.length||swipes.some(s=>typeof s!=='string')||!Number.isSafeInteger(swipe)||swipe<0||swipe>=swipes.length)throw new Error('消息 swipe 无效')
  let body=desired.mes
  if(before&&desired.mes===before.mes&&(swipe!==before.swipe_id||!isDeepStrictEqual(swipes,before.swipes)))body=swipes[swipe]
  swipes[swipe]=body
  const variables=structuredClone(desired.variables||[{}]);if(variables.length>swipes.length)throw new Error('消息变量指向不存在的 swipe')
  row.tavernPluginData=merge(before?pluginFields(before):{},row.tavernPluginData||{},pluginFields(desired),'模板消息标记')
  rows.push(row)
  Object.assign(row,{tavernRoleOverride:desired.is_user?'user':desired.is_system?'system':'assistant',name:String(desired.name||''),swipes,swipeId:swipe,variables})
  if(!before||!isDeepStrictEqual(identity(before),identity(desired))){Object.assign(row,{text:body,sessionText:body,sourceText:body,projectionText:body,displayText:body,displayMode:'markdown',projectionVersion:2});delete row.displayRuntime}
 }
 next.messages=rows;return next
}
