import { createHash, randomUUID } from 'node:crypto'
import { appendAssistantEvent, syncAuthoredAgentPhase } from './session-surface-edit.js'
import { clearRegenerationAttemptSurface, regenerationAttemptTurns } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'

const owned = ['messages', 'presentation', 'presentationWarnings', 'macroState', 'tavernScriptPrompts', 'runtimeInputs',
  'worldbookState', 'openingWorldbookSnapshot', 'chatWorldbookBindings', 'characterDesignDocument',
  'variables', 'tavernHelperScriptVariables', 'tavernPluginMetadata',
  'spDatabase', 'resolvedRuntimePreset', 'posture', 'ledger', 'scriptState', 'candidates', 'settleStatus', 'settleError',
  'lastSettle', 'preparedWorldBookContext', 'preparedWorldBook', 'worldBookReads', 'timeline', 'nativeCommits',
  'candidateAgent', 'suppressedDshTurns', 'regeneratedDshTurns', 'regenInProgress', 'foregroundFrames']
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

// The journal retains this verified before-image until the native surface is flushed.
// It belongs to the unfinished transaction and must never be pruned as a spare backup.
export function historyRecoveryRecord(originalChat, details) {
  if (originalChat.pendingSurfaceRollback || originalChat.pendingRegeneration) throw new Error('上次历史修改尚未恢复，请先恢复再操作')
  const original = structuredClone(originalChat)
  return { version: 1, id: randomUUID(), createdAt: Date.now(), original, originalDigest: digest(original), ...details }
}

export function assertHistoryRecovery(chat, record) {
  if (record?.version !== 1 || !record.id || record.original?.id !== chat.id || record.original.sessionId !== chat.sessionId
    || record.originalDigest !== digest(record.original)) throw new Error('历史恢复记录校验失败，已保留原记录，停止自动恢复')
}

export function restoreHistoryChat(current, record, timeline, abortedTurns = []) {
  assertHistoryRecovery(current, record)
  const restored = structuredClone(current)
  for (const key of owned) {
    if(key==='spDatabase'&&current.spAuthority?.owner==='original')continue
    if (Object.hasOwn(record.original, key)) restored[key] = structuredClone(record.original[key])
    else delete restored[key]
  }
  const next = timeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: restored } }).chat
  next.tavernHelperLifecycleRevision = Math.max(Number(current.tavernHelperLifecycleRevision) || 0, Number(record.original.tavernHelperLifecycleRevision) || 0) + 1
  if (abortedTurns.length) next.suppressedDshTurns = [...new Set([...(next.suppressedDshTurns || []), ...abortedTurns])].sort((a, b) => a - b)
  delete next.pendingSurfaceRollback
  delete next.pendingRegeneration
  return next
}

export async function recoverRoundHistory({ chat, agent, session, update, flush, timeline, signal }) {
  signal?.throwIfAborted()
  const field = chat.pendingSurfaceRollback ? 'pendingSurfaceRollback' : 'pendingRegeneration'
  const record = chat[field]
  if (!record) return { status: 'unchanged', chat }
  if (agent?.phase?.kind === 'running') return { status: 'busy', chat }
  assertHistoryRecovery(chat, record)
  if (!session) throw new Error('历史恢复需要加载原生会话')
  let abortedTurns
  if (record.phase === 'generating' || record.phase === 'aborting') {
    abortedTurns = regenerationAttemptTurns({ events: sessionEvents(session), eventStart: record.eventStart })
    clearRegenerationAttemptSurface({ session, eventStart: record.eventStart, id: () => record.id + ':abort' })
  } else if (record.surface) appendAssistantEvent(session, record.surface.data, record.surface.intent)
  else throw new Error('历史恢复记录缺少原生消息面计划')
  if (typeof flush === 'function') await flush(session)
  signal?.throwIfAborted()
  syncAuthoredAgentPhase(agent)
  const saved = await update(chat.id, current => {
    signal?.throwIfAborted()
    if (current[field]?.id !== record.id) throw new Error('历史恢复期间记录已变化')
    if (abortedTurns) return restoreHistoryChat(current, record, timeline, abortedTurns)
    delete current[field]
    delete current.regenInProgress
    return current
  }, { source: 'history.recovered', signal })
  return { status: 'recovered', chat: saved }
}
