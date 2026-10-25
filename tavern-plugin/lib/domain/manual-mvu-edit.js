import { isDeepStrictEqual } from 'node:util'
import { readTavernHelperVariables } from './tavern-helper-context.js'

export function currentMvuEditSnapshot(chat) {
  if(!chat||typeof chat!=='object')throw Error('当前会话没有绑定游戏')
  for (let index = (chat.messages || []).length - 1; index >= 0; index--) {
    if (chat.messages[index]?.role === 'tavern-helper') continue
    const option = {type:'message',message_id:index}
    const variables = readTavernHelperVariables(chat,option)
    if (variables.stat_data && typeof variables.stat_data === 'object' && !Array.isArray(variables.stat_data)) {
      const message=chat.messages[index], count=Math.max(message.variables?.length||0,message.swipes?.length||0,1)
      return {option:{...option,swipe_id:Math.max(0,Math.min(count-1,Number(message.swipeId)||0))},variables,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision)||0}
    }
  }
  throw Error('当前对话尚无可编辑的 MVU stat_data')
}
export function validateManualMvuEdit(chat, option, before, after) {
  const snapshot = currentMvuEditSnapshot(chat)
  if (!isDeepStrictEqual(snapshot.option,option)) throw Error('MVU 所在楼层已变化，请重新读取')
  if (!before || !after || !after.stat_data || typeof after.stat_data !== 'object' || Array.isArray(after.stat_data)) throw Error('stat_data 必须是 JSON 对象')
  const without = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'stat_data'))
  if (!isDeepStrictEqual(without(before),without(after))) throw Error('人工编辑只能修改 stat_data')
  return !isDeepStrictEqual(before.stat_data,after.stat_data)
}
// Invoke inside updateVariables' existing atomic update, after its CAS check.
export function stageManualMvuNotice(chat, before, after) {
  if (isDeepStrictEqual(before.stat_data,after.stat_data)) return false
  const prior = chat.manualMvuNotice
  const revision=Math.max(Number(chat.manualMvuNoticeRevision)||0,Number(prior?.revision)||0)+1
  chat.manualMvuNoticeRevision=revision
  chat.manualMvuNotice = { revision,
    before:structuredClone(prior?.before ?? before.stat_data), after:structuredClone(after.stat_data) }
  return true
}
export function manualMvuPrompt(chat, requestId) {
  const notice = requestId ? chat.manualMvuRequests?.[requestId]?.notice : chat.manualMvuNotice
  return notice ? {role:'system',content:'【玩家手动调整了当前 MVU 状态，请以调整后的状态继续正文】\n调整前：'+JSON.stringify(notice.before)+'\n调整后：'+JSON.stringify(notice.after)} : null
}
export function bindManualMvuNotice(chat, request) {
  if (!request?.requestId) return null
  if (!Number.isInteger(Number(request.turn))) throw Error('正文请求身份无效')
  const records=chat.manualMvuRequests||{}, existing=records[request.requestId]
  const lifecycleRevision=Number(chat.tavernHelperLifecycleRevision)||0
  if(existing){
    if(existing.lifecycleRevision!==lifecycleRevision)throw Error('正文请求绑定已失效')
    if(existing.turn!==Number(request.turn)) {
      const continuation=Object.values(chat.timeline?.operations||{}).some(operation=>operation.kind==='body'&&operation.status==='failed'&&operation.turn===existing.turn&&operation.manualMvuRequestId===request.requestId)
      if(!continuation)throw Error('正文请求绑定已失效')
      existing.turn=Number(request.turn)
    }
    return structuredClone(existing.notice)
  }
  chat.manualMvuRequests={...records,[request.requestId]:{turn:Number(request.turn),lifecycleRevision,notice:structuredClone(chat.manualMvuNotice||null)}}
  return structuredClone(chat.manualMvuNotice||null)
}
export function commitManualMvuNotice(chat, request) {
  const record=chat.manualMvuRequests?.[request?.requestId]
  if(!record||record.turn!==Number(request.turn)||record.lifecycleRevision!==(Number(chat.tavernHelperLifecycleRevision)||0))return false
  if(record.notice)acknowledgeManualMvuNotice(chat,record.notice.revision)
  delete chat.manualMvuRequests[request.requestId]
  return true
}
export function restoreManualMvuState(chat, snapshot) {
  if(!chat.manualMvuNotice&&!snapshot?.manualMvuNotice&&!chat.manualMvuRequests)return
  const revision=Math.max(Number(chat.manualMvuNoticeRevision)||0,Number(snapshot?.manualMvuNotice?.revision)||0)+1
  chat.manualMvuNoticeRevision=revision
  delete chat.manualMvuRequests
  if(snapshot?.manualMvuNotice)chat.manualMvuNotice={...structuredClone(snapshot.manualMvuNotice),revision}
  else delete chat.manualMvuNotice
}
// Record exact revision on the durable body request; clear only upon successful body commit.
export function acknowledgeManualMvuNotice(chat, revision) {
  if (!chat.manualMvuNotice || chat.manualMvuNotice.revision !== revision) return false
  delete chat.manualMvuNotice
  return true
}
