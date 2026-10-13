import {mutableJsonDraft} from './json-draft.js'
export function createTavernScriptOwnerGuard({ chatForSession, scripts }) {
  return async (sessionId, scriptId, lifecycleRevision) => {
    const chat = await chatForSession(sessionId)
    if (!chat || !scriptId) throw new Error('脚本没有当前游戏或身份')
    if (!Number.isSafeInteger(lifecycleRevision) || Number(chat.tavernHelperLifecycleRevision || 0) !== lifecycleRevision) throw new Error('脚本生命周期已变化')
    if (!(scriptId === '__dsh_official_mvu__' && chat.mvu?.enabled) && !(await scripts(chat)).some(s => s.id === scriptId && s.enabled !== false)) throw new Error('脚本已停用或不属于当前游戏')
    return mutableJsonDraft(chat)
  }
}
