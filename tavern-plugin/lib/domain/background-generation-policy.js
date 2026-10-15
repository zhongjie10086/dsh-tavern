import { createHash } from 'node:crypto'

export const BACKGROUND_GENERATION_LIMIT = 20

// This identity describes the story that a detached script read. Variable/SP
// writes do not change it; a new floor, edit, swipe or lifecycle does.
export function helperGenerationScope(chat) {
  if (!chat || typeof chat.id !== 'string') throw new Error('找不到脚本所属的游戏')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  let floor = messages.length - 1
  while (floor >= 0 && messages[floor]?.role === 'tavern-helper') floor--
  const message = messages[floor], swipe = Number(message?.swipeId) || 0
  return { chatId: chat.id, sessionId: String(chat.sessionId || ''),
    lifecycleRevision: Number(chat.tavernHelperLifecycleRevision) || 0,
    turn: Number(chat.turn) || 0, floor, swipe,
    contentHash: createHash('sha256').update(JSON.stringify([message?.role, message?.turn,
      message?.swipes?.[swipe] ?? message?.sourceText ?? message?.text ?? ''])).digest('hex') }
}

export function sameHelperGenerationScope(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

// The original SP package owns an asynchronous foreground fill across the
// next story reply. Pin its source prefix, not the newest floor. Only the host
// selects this scope for its reserved original-package identity; ordinary
// scripts and background executions continue to use the exact live scope.
export function originalSpForegroundGenerationScope(chat,anchor) {
  const current=helperGenerationScope(chat)
  const appendOnly=anchor&&anchor.chatId===current.chatId&&anchor.sessionId===current.sessionId&&anchor.lifecycleRevision===current.lifecycleRevision&&current.floor>=anchor.floor&&current.turn>=anchor.turn
  const floor=appendOnly?anchor.floor:current.floor
  const messages=(chat.messages||[]).slice(0,floor+1)
  const value=helperGenerationScope({...chat,messages,turn:appendOnly?anchor.turn:current.turn})
  const prefix=messages.filter(row=>row?.role!=='tavern-helper').map(row=>[row.id??null,row.role,row.turn??null,Number(row.swipeId)||0,row.swipes??null,row.sourceText??row.text??''])
  return {...value,sourcePrefixHash:createHash('sha256').update(JSON.stringify(prefix)).digest('hex')}
}

export function normalizeBackgroundGeneration(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('后台脚本生成设置无效')
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('后台脚本生成开关无效')
  const disabled = value.disabledScripts ?? []
  if (!Array.isArray(disabled) || disabled.length > 2000 || disabled.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('后台脚本名单无效')
  return { enabled: value.enabled !== false, disabledScripts: [...new Set(disabled)] }
}

export function createBackgroundGenerationPolicy({ readChat, updateChat, settings, notify = () => {} }) {
  async function scope(sessionId) { return helperGenerationScope(await readChat(sessionId)) }
  async function admit(sessionId, scriptId, expectedScope) {
    const policy = normalizeBackgroundGeneration((await settings()).backgroundScriptGeneration)
    if (!policy.enabled || policy.disabledScripts.includes(scriptId)) throw new Error('后台模型调用已关闭；可在设置 → 后台脚本生成中开启。脚本自身开关仍然有效。')
    if (typeof scriptId !== 'string' || !scriptId) throw new Error('后台生成缺少脚本身份')
    let paused = false
    await updateChat(expectedScope.chatId, chat => {
      if (!sameHelperGenerationScope(helperGenerationScope(chat), expectedScope)) throw new Error('剧情已变化，本次脚本生成未发送')
      // Reloading a script must not reset its per-turn allowance. A real new
      // story round or swipe has a separate counter; variable changes do not.
      const round = JSON.stringify([expectedScope.turn, expectedScope.floor, expectedScope.swipe])
      const current = chat.backgroundScriptGenerationCounts
      const counts = current?.round === round ? { ...current.scripts } : {}
      const count = Number(counts[scriptId]) || 0
      if (count >= BACKGROUND_GENERATION_LIMIT) { paused = true; return }
      Object.defineProperty(counts, scriptId, { value: count + 1, enumerable: true, configurable: true, writable: true })
      chat.backgroundScriptGenerationCounts = { round, scripts: counts }
      return chat
    }, { source: 'helper-generation.background-admission' })
    if (paused) {
      const error = new Error('脚本在本轮后台已请求 20 次，继续请求已暂停；请检查脚本设置。前台操作不受这个后台限额影响。')
      error.code = 'BACKGROUND_GENERATION_LIMIT'
      await notify(sessionId, scriptId, error.message)
      throw error
    }
  }
  return { scope, admit }
}
