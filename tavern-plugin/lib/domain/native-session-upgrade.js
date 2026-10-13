/** Apply recorded native sequence relocation to stored Chat revisions on read. */
export function applyNativeSessionUpgrade(chat, receipt) {
  if (!chat || !receipt?.id || chat.nativeSessionUpgrade === receipt.id || !receipt.sessions?.[chat.sessionId]) return chat
  const remap = (value, sessionId) => {
    if (!Number.isSafeInteger(value) || value < 0) return value
    let prior = receipt.previous
    while (prior && prior.id !== chat.nativeSessionUpgrade) prior = prior.previous
    const previous = prior?.sessions?.[sessionId]
    if (previous) {
      if (value === previous.eventCount) value = previous.seqMap.length
      else { const original = previous.seqMap.indexOf(value); if (original < 0) throw new Error('无法转换上一版升级后的引用：' + sessionId + '/' + value); value = original }
    }
    const mapping = receipt.sessions[sessionId]
    if (!mapping) return value
    if (value === mapping.seqMap.length) return mapping.eventCount
    if (mapping.seqMap[value] === undefined) throw new Error('旧聊天包含无法转换的 Session 引用：' + sessionId + '/' + value)
    return mapping.seqMap[value]
  }
  function walk(value, sessionId, parent = '') {
    if (!value || typeof value !== 'object') return
    const current = typeof value.sessionId === 'string' ? value.sessionId : sessionId
    for (const [key, entry] of Object.entries(value)) {
      if (['boundary','rewindTo','eventStart','eventEnd','eventSeq','eventIndex','assistantSeq','sourceEventSeq'].includes(key) || parent === 'bodyEdit' && key === 'seq') value[key] = remap(entry, current)
      else if (entry && typeof entry === 'object') walk(entry, current, key)
    }
  }
  for (const key of ['timeline','nativeCommits','contextCompaction','forkedFrom']) walk(chat[key], chat.sessionId, key)
  for (const message of chat.messages || []) walk(message.bodyEdit, chat.sessionId, 'bodyEdit')
  chat.nativeSessionUpgrade = receipt.id
  return chat
}
