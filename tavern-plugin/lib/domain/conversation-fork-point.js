import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { sessionEvents } from './session-events.js'
import { tavernAssistantTurn } from './session-surface-edit.js'
import { assertConversationForkable } from './conversation-fork.js'

const turnOf = message => Number(message?.turn || (message?.greeting ? 1 : 0))
const lastAssistant = chat => (chat.messages || []).findLast(message => message?.role === 'assistant')

// Checkpoints are bounded in each Chat, but their beforeRevision links retain
// access to older journal states. Follow those links, including parent branches.
export async function conversationStateAtTurn(source, requestedTurn, readRevision) {
  const turn = requestedTurn === undefined || requestedTurn === 0 ? turnOf(lastAssistant(source)) : Number(requestedTurn)
  const targetIndex = (source.messages || []).findIndex(message => message?.role === 'assistant' && turnOf(message) === turn)
  if (!Number.isSafeInteger(turn) || turn < 1 || targetIndex < 0) throw new Error('找不到指定分叉回合')
  if (isRescuedHistoryMessage(source, source.messages[targetIndex])) throw new Error('存档救援导入的历史缺少原生状态，不能从此处分叉；请在新生成的轮次分叉')
  let state = source
  const visited = new Set()
  while (turnOf(lastAssistant(state)) !== turn) {
    const identity = state.id + ':' + state._storageRevision
    if (visited.has(identity)) throw new Error('历史快照链重复，无法安全分叉')
    visited.add(identity)
    const next = (state.timeline?.checkpoints || []).find(item => Number(item.turn) > turn && Number.isSafeInteger(item.beforeRevision))
    const parent = state.forkedFrom
    const chatId = next ? state.id : parent?.stateChatId || parent?.chatId
    const revision = next ? next.beforeRevision : parent?.stateRevision ?? parent?.storageRevision
    if (!chatId || !Number.isSafeInteger(revision)) throw new Error('该回合缺少完整历史状态快照，无法安全分叉')
    state = await readRevision(chatId, revision)
    if (!state || state._storageRevision !== revision) throw new Error('该回合历史状态快照不可用，无法安全分叉')
  }
  const prefix = source.messages.slice(0, targetIndex + 1)
  if (state.messages.length !== prefix.length || prefix.some((message, index) => {
    const old = state.messages[index]
    return message.role !== old.role || turnOf(message) !== turnOf(old) || (message.sourceText ?? message.text) !== (old.sourceText ?? old.text)
  })) throw new Error('历史快照与当前分支正文不一致，无法安全分叉')
  assertConversationForkable(state)
  return { turn, state }
}

// Native edits create new execution turns while retaining the Tavern story turn.
export function conversationForkTurnsByMessageId(session, visibleTurns) {
  const events = sessionEvents(session), visible = new Set(visibleTurns)
  const nodes = session?.surface?.nodes ? new Set(session.surface.nodes) : null
  const latest = new Map()
  for (const event of events) {
    if (event.type !== 'assistant/message' || (nodes && !nodes.has(event.seq))) continue
    const message = event.data?.message, turn = tavernAssistantTurn(event, events)
    if (!visible.has(turn) || message?.source?.kind !== 'model' || message.source.model === 'synthetic-trajectory') continue
    if (message.content?.some(block => block.type === 'text' && block.text)) latest.set(turn, message.id)
  }
  return Object.fromEntries([...latest].filter(([, id]) => id).map(([turn, id]) => [id, turn]))
}

export function conversationForkBoundary(session, state, turn, source = state) {
  const events = sessionEvents(session)
  const result = assistantResultForTurn(session, turn)
  // Only the current final story turn may use a later authored boundary. An
  // earlier edited reply must not bring subsequent story context into a fork.
  const authoredTurn = result && Number(result.event.data?.turn) !== turn && turnOf(lastAssistant(source)) === turn
    ? Number(result.event.data.turn) : 0
  const nativeTurn = authoredTurn || Number(state.regeneratedDshTurns?.[turn]) || turn
  const end = events.findLast(event => event.type === 'turn/end' && Number(event.data?.turn) === nativeTurn)
  if (!end || end.data?.reason?.kind !== 'completed') throw new Error('该回合缺少已完成的原生上下文边界')
  if (!result || result.event.seq > end.seq) throw new Error('该回合正文曾在后续上下文中修改，无法按旧边界安全分叉')
  return end.seq
}
