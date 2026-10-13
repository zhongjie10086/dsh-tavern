import { applyJsonChanges, diffJson } from './json-mutation.js'
import { createHash } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const ALLOWED_ROOTS = new Set(['messages', 'variables', 'mvu', 'tavernScriptPrompts', 'tavernHelperScriptVariables'])
function pathHash(root,path){
  let value=root,present=true;
  for(const key of path){if(!value||typeof value!=='object'||!Object.hasOwn(value,key)){present=false;break}value=value[key]}
  return createHash('sha256').update(JSON.stringify([present,present?value:null],(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex');
}

function assertIdentity(chat, effect) {
  if (!effect || effect.version !== 1 || str(effect.operationId) === '') throw new Error('MVU Settlement Effect 不合法')
  if (str(chat && chat.id) !== str(effect.chatId) || str(chat && chat.sessionId) !== str(effect.sessionId)) throw new Error('MVU Settlement Effect 对话目标已变化')
  const timeline = chat && chat.timeline
  if (!timeline || !str(timeline.branchId) || !Number.isSafeInteger(timeline.revision) || timeline.revision < 0 || str(timeline.branchId) !== str(effect.branchId) || timeline.revision !== effect.basedOnRevision) {
    const error = new Error('MVU Settlement Effect 剧情版本已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
  if (Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) !== Number(effect.expectedLifecycleRevision)) {
    const error = new Error('MVU Settlement Effect 脚本生命周期已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
  const message = Array.isArray(chat && chat.messages) ? chat.messages[Number(effect.messageId)] : null
  if (!message || Math.max(0, Number(message.swipeId) || 0) !== Number(effect.swipeId)) {
    const error = new Error('MVU Settlement Effect Swipe 已变化')
    error.code = 'STALE_SETTLEMENT_EFFECT'
    throw error
  }
}

/** Create a serializable, operation-scoped effect without persisting Chat state. */
export function createMvuSettlementEffect(input = {}) {
  const changes = diffJson(input.before, input.after).filter(function (change) {
    return Array.isArray(change.path) && ALLOWED_ROOTS.has(String(change.path[0] || ''))
  })
  return {
    version: 1,
    operationId: str(input.operationId),
    chatId: str(input.chatId),
    sessionId: str(input.sessionId),
    branchId: str(input.branchId ?? input.before?.timeline?.branchId),
    basedOnRevision: Number(input.basedOnRevision ?? input.before?.timeline?.revision),
    expectedLifecycleRevision: Math.max(0, Number(input.expectedLifecycleRevision) || 0),
    messageId: Number(input.messageId),
    swipeId: Number(input.swipeId),
    changes: structuredClone(changes),
    // Independent plugin timers may persist while MVU evaluates its draft.
    // Check only changed paths so unrelated metadata survives; never silently
    // overwrite a second writer of the same value, even within an array.
    checks:[...new Map(changes.map(change=>[JSON.stringify(change.path),change.path])).values()].map(path=>({path,before:pathHash(input.before,path),after:pathHash(input.after,path)}))
  }
}

/** Apply one effect at the Story Timeline commit seam while preserving unrelated projections. */
export function applyMvuSettlementEffect(chat, effect) {
  assertIdentity(chat, effect)
  const already=new Set();
  for(const check of effect.checks||[]){
    const hash=pathHash(chat,check.path);
    if(hash===check.after)already.add(JSON.stringify(check.path));
    else if(hash!==check.before)throw Object.assign(new Error('MVU 结算期间目标值已被其他操作修改，请重试结算：'+check.path.join('.')),{code:'MVU_SETTLEMENT_CONFLICT'});
  }
  const applied = applyJsonChanges(chat, effect.changes.filter(change=>!already.has(JSON.stringify(change.path))))
  for (const root of ALLOWED_ROOTS) {
    if (Object.hasOwn(applied, root)) chat[root] = structuredClone(applied[root])
    else delete chat[root]
  }
  return chat
}
