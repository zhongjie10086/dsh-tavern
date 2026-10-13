export const SCENE_SESSION_METHODS = Object.freeze([
  'sceneImageStatus', 'recordSceneImageInteraction', 'generateSceneImage',
  'retrySceneImageSave', 'cancelSceneImage', 'removeSceneImage', 'setSceneImageReference'
])

function sessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 200) throw new Error('请指定当前 Profile 的有效会话')
  return value
}

/** Resolve ownership before image work, native resume, or conversation export. */
export function createProfileSessionAccess({ forSession, readChat, readIndex }) {
  async function foreground(id) {
    id = sessionId(id)
    const chat = await forSession(id)
    if (!chat || chat.sessionId !== id) throw new Error('会话不属于当前 Profile 的 Tavern 对话')
    return chat
  }

  async function background(id) {
    id = sessionId(id)
    if (!id.startsWith('background-')) throw new Error('请指定当前 Profile 的后台会话')
    for (const row of (await readIndex()).chats || []) {
      const chat = await readChat(row.id)
      if (Object.values(chat?.timeline?.participants || {}).some(participant => participant.sessionId === id)) return chat
    }
    throw new Error('后台会话不属于当前 Profile 的 Tavern 对话')
  }

  async function exportTarget(chatId, id) {
    if (!chatId) return foreground(id)
    if (typeof chatId !== 'string' || !(await readIndex()).chats?.some(row => row.id === chatId)) throw new Error('对话不属于当前 Profile')
    const chat = await readChat(chatId)
    if (!chat || (id && (await foreground(id)).id !== chat.id)) throw new Error('对话与会话绑定不匹配')
    return chat
  }

  async function assertRpc(method, args = {}) {
    if (SCENE_SESSION_METHODS.includes(method)) await foreground(args.sessionId)
    else if (method === 'getBackgroundSuppressedTurns') await background(args.sessionId)
  }

  return Object.freeze({ foreground, background, exportTarget, assertRpc })
}
