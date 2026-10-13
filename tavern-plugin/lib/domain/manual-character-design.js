import { CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL, CHARACTER_DESIGN_SAVE_TOOL_NAME } from './character-design-document.js'

// Upstream 41ddec09 and follow-ups (an explicit 设计人物 task), adapted locally (user 2026-10-09):
// the button runs one background task that only designs the characters the player names, whether
// or not the game's 人物设计档案 switch is on. Saves go through the same design tools as the switch
// path, so every saved design is stored at once together with its private worldbook entry
// (87c4b25a); the task commit only records the outcome. A failure keeps what was already saved.
const str = value => typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))

export const MANUAL_CHARACTER_DESIGN_SYSTEM = '本次是玩家手动发起的人物设计任务，只做人物设计，不写正文、不结算变量、不生成候选项。按玩家写明的人物与要求，先调用 skill 加载 tavern-character-design，用 character_design_read 查看已有档案（已有人物优先补充或修订），再用 character_design_save 保存完整方案；可一次设计多人。全部保存后调用 character_design_finish 结束。'

export function createManualCharacterDesign({ store, tasks, runAgent, selection, designs, ensureSession = async () => {}, assertIdle = () => {}, now = Date.now, onError = error => console.error('dsh-tavern: 人物设计保存状态失败', str(error && error.message || error)) }) {
  // jobs: runs alive in this process; outcomes: how the latest run of each game ended, kept
  // before its final write so a view holding an older snapshot (or a failed write) still shows it.
  const jobs = new Map(), outcomes = new Map()
  function runtime(chatId) {
    return { running: jobs.has(chatId), outcome: outcomes.get(chatId) || null }
  }
  // Views read runtime() through their projection cache's use(), so a run ending is a dependency.
  function project(chat, live = runtime(chat && chat.id)) {
    const state = chat && chat.characterDesignTask || { status: 'idle' }
    if (state.status !== 'running' || live.running) return state
    if (live.outcome && live.outcome.startedAt === state.startedAt) return live.outcome.state
    return { ...state, status: 'failed', error: '人物设计已中断，请重试。' }
  }
  async function setTask(chatId, value, source) {
    await store.updateChat(chatId, current => { if (!current) return undefined; current.characterDesignTask = value; return current }, { source })
  }
  async function start({ sessionId, guidance }) {
    const request = str(guidance).trim()
    if (!request) throw new Error('请写明要设计的人物和要求')
    if (request.length > 4000) throw new Error('设计要求最多 4000 字')
    const chat = await store.chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    if (!['story', 'script'].includes(chat.mode || 'story')) throw new Error('人物设计只用于游玩对话')
    if (jobs.has(chat.id)) throw new Error('人物设计正在进行中')
    assertIdle(chat)
    // Reserve before the asynchronous model read so repeated clicks cannot
    // start two tasks or clear another task's running marker on failure.
    jobs.set(chat.id, true)
    const startedAt = now()
    let taskRun, model
    try {
      model = await selection(chat)
      if (!model) throw new Error('请先选择后台模型')
      taskRun = await tasks.begin(chat, 'character-design', {})
      await setTask(chat.id, { status: 'running', guidance: request, error: '', startedAt }, 'character-design.manual-start')
    } catch (error) {
      jobs.delete(chat.id)
      if (taskRun) await taskRun.fail(error).catch(() => {})
      throw error
    }
    const task = execute(taskRun.chat || chat, request, model, sessionId, taskRun, startedAt).catch(onError).finally(() => jobs.delete(chat.id))
    jobs.set(chat.id, task)
    return { status: 'running' }
  }
  async function execute(chat, guidance, model, sessionId, taskRun, startedAt) {
    const saved = new Set()
    let run, lastError = ''
    try {
      // Upstream ef5ec5b5: the button may run while the game's agent is not live (after a restart,
      // before any turn); the shared background agent is created under it.
      await ensureSession(sessionId)
      const card = await store.readCard(chat)
      const recent = (chat.messages || []).filter(message => message.role === 'user' || message.role === 'assistant').slice(-12)
        .map(message => ({ role: message.role, text: str(message.sourceText || message.text) }))
      const participantRequest = taskRun.participantRequest || {}
      run = await runAgent({
        task: 'character-design', sessionId, selection: model, temperature: 0.7,
        persistent: true, persistentSessionId: str(participantRequest.sessionId), rewindTo: participantRequest.rewindTo,
        onPersistentSessionReady: id => taskRun.bindSession(id),
        backgroundTasks: { characterDesign: true },
        system: MANUAL_CHARACTER_DESIGN_SYSTEM,
        messages: [{ id: 'character-design-' + now().toString(36), role: 'user', source: { kind: 'plugin', plugin: 'dsh-tavern' },
          content: [{ type: 'text', text: JSON.stringify({ guidance, card: { name: card?.name, description: card?.description, personality: card?.personality, scenario: card?.scenario }, recent }) }] }],
        tools: [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL],
        onToolCall: async call => {
          const output = await designs.execute(chat.id, call)
          if (call && call.name === CHARACTER_DESIGN_SAVE_TOOL_NAME) {
            const result = JSON.parse(output)
            if (result.ok === true) { saved.add(result.name); lastError = '' } else lastError = str(result.error)
          }
          return output
        },
        maxToolCalls: 12,
        acceptWithoutText: () => saved.size > 0
      })
      if (!saved.size) throw new Error(lastError
        ? '人物档案保存失败：' + lastError + '。模型未完成修正，请重试。'
        : '模型未调用人物档案保存工具，本次未保存设计档案。请重试；若持续出现，请检查后台模型是否支持工具调用。')
      const names = [...saved], done = { status: 'done', guidance, error: '', saved: names, finishedAt: now() }
      outcomes.set(chat.id, { startedAt, state: done })
      const completed = await taskRun.commit({ stateChanged: true, participant: taskRun.participant(run), apply(draft) { draft.characterDesignTask = done } })
      // The designs are already stored; a story that moved on meanwhile does not undo them.
      if (completed.status !== 'committed') await setTask(chat.id, done, 'character-design.manual-done')
    } catch (error) {
      const failed = { status: 'failed', guidance, error: str(error && error.message || error), saved: [...saved] }
      outcomes.set(chat.id, { startedAt, state: failed })
      await taskRun.fail(run || error).catch(() => {})
      await setTask(chat.id, failed, 'character-design.manual-failed')
    }
  }
  return { start, project, runtime, wait: chatId => jobs.get(chatId) }
}
