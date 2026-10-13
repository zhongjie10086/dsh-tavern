import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { encodeTavernMessage } from './session-message-source.js'

/** A host command owns and audits its native turn; an omitted text is a trigger. */
export function createTavernTrigger({ foreground, resolveAgent }) {
  const pending = new Map()
  async function execute(sessionId, chatId, admittedAfter, text) {
    const agent = await resolveAgent(sessionId)
    // Keep a queued command separate from an already-running player turn.
    // The controller owns this Agent, including its preset and lifetime.
    await agent.whenIdle()
    if (sessionEvents(agent.session).some(event => event.seq >= admittedAfter && event.type === 'turn/end' && event.data?.reason?.kind === 'aborted')) throw new Error('排队的命令生成已取消')
    const chat = await foreground(sessionId)
    if (chat.id !== chatId) throw new Error('当前对话绑定已变化，请重新打开后再生成')
    const id = randomUUID(), before = agent.session.seq
    agent.followup(encodeTavernMessage({ id, role: 'user', content: text === undefined ? [] : [{ type: 'text', text }],
      source: text === undefined ? { kind: 'plugin', plugin: 'dsh-tavern-trigger' } : { kind: 'user', rpcId: id } }))
    await agent.whenIdle()
    let turn = 0, ownTurn = 0, ended = null
    for (const event of sessionEvents(agent.session)) {
      if (event.seq < before) continue
      if (event.type === 'turn/start') turn = Number(event.data?.turn) || 0
      if (event.type === 'user/message' && event.data?.id === id) ownTurn = turn
      if (event.type === 'turn/end' && ownTurn && Number(event.data?.turn) === ownTurn) ended = event
    }
    if (ended?.data?.reason?.kind === 'error') throw new Error(ended.data.reason.error?.message || '命令生成失败')
    if (!ended || ended.data?.reason?.kind === 'aborted') throw new Error('命令生成已取消或未完成')
    const saved = await foreground(sessionId)
    if (saved.foregroundError?.requestId === id) throw new Error(saved.foregroundError.message || '命令正文保存失败')
    if (!saved.messages?.some(row => row.role === 'assistant' && Number(row.turn) === ownTurn)) throw new Error('命令生成未保存新的正文')
    return { submitted: true, requestId: id, turn: ownTurn }
  }
  async function start(args = {}) {
    if (args.scriptScope || args.scriptId || args.owner) throw new Error('命令生成须由当前对话的宿主消息界面提交')
    if (Object.hasOwn(args, 'text') && (typeof args.text !== 'string' || !args.text.trim())) throw new Error('开局输入须为非空文字')
    const chat = await foreground(args.sessionId)
    if (!['story', 'script'].includes(chat.mode || 'story')) throw new Error('当前会话不是游玩对话')
    const admittedAfter = (await resolveAgent(args.sessionId)).session.seq
    const prior = pending.get(args.sessionId) || Promise.resolve()
    const task = prior.catch(() => {}).then(() => execute(args.sessionId, chat.id, admittedAfter, args.text))
    pending.set(args.sessionId, task)
    const clear = () => { if (pending.get(args.sessionId) === task) pending.delete(args.sessionId) }
    task.then(clear, clear)
    return task
  }
  return Object.freeze({ start })
}
