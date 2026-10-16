import { assertRescueHistoryEditable } from './chat-history-rescue.js'
import { historyRecoveryRecord, restoreHistoryChat, recoverRoundHistory } from './round-history-recovery.js'
import { appendAssistantEvent, syncAuthoredAgentPhase, pendingAssistantEdit } from './session-surface-edit.js'
import { rewindBackgroundSurface } from './background-surface.js'
import { sessionEvents, appendSessionEvent } from './session-events.js'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { projectPlayerContent } from './player-input-content.js'
import { clearRegenerationAttemptSurface, locateRegenerationSurface, locateRollbackSurface, planRegenerationSurface, planRegenerationPreview, regenerationAttemptTurns, regenerationSurfaceRecord, applyRegenerationSurface } from './rollback-surface.js'
import { assertRegenerationSourceCurrent, replaceLastRound } from './last-round-replacement.js'
import { diagnosticIdentity, regenerationTargetDiagnostic } from './regeneration-diagnostics.js'
import {originalSpRollbackNeedsMaterialization,originalSpFloorCarries} from './sp-authority.js'
import {tavernTriggerTurnInput} from './tavern-turn-input.js'
import {encodeTavernMessage,appendTavernEvent} from './session-message-source.js'
import {characterDesignStamp} from './character-design-rollback.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function selectRegenerationTarget(chat, session, observe) {
  const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
  const eventStart = sessionEvents(session).length
  const msgs0 = chat.messages || []
  let oldAssistantIndex = -1
  for (let i = msgs0.length - 1; i >= 0; i--) {
    const m = msgs0[i]
    if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
      oldAssistantIndex = i
      break
    }
  }
  function report(reason, target) {
    if (typeof observe !== 'function') return
    try { observe(regenerationTargetDiagnostic(chat, session, { reason, assistantIndex: oldAssistantIndex, target })) } catch { /* Diagnostics never change selection. */ }
  }
  const inputKind=tavernTriggerTurnInput(sessionEvents(session),Number(msgs0[oldAssistantIndex]?.turn))?'trigger':'player'
  if (inputKind!=='trigger'&&(oldAssistantIndex < 1 || msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' || msgs0[oldAssistantIndex - 1].role !== 'user')) {
    report(oldAssistantIndex < 0 ? 'no-non-greeting-assistant' : oldAssistantIndex === 0 ? 'assistant-at-start'
      : msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' ? 'previous-message-invalid' : 'previous-message-not-user')
    throw new Error('没有可重新生成的玩家输入与正文组合')
  }
  const target = locateRegenerationSurface({ events: sessionEvents(session), nodes, turn: msgs0[oldAssistantIndex].turn })
  if (target === null) { report('native-target-missing'); throw new Error('原生消息流中找不到与当前剧情轮次对应的正文消息') }
  report('selected', target)
  const oldSeq = target.assistantSeq
  const oldTurn = target.turn
  const oldSource = target.source
  const nativeBody=sessionEvents(session).find(event=>event.seq===oldSeq)
  const targetAssistantId=nativeBody?.data?.message?.id||nativeBody?.data?.source?.replacement?.message?.id
  return { nodes, eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource,inputKind,targetAssistantId }
}

/**
 * Own replacement/rollback ordering across stored story, DSH surface and scripts.
 * Timeline owns revisions; this module owns the workflow, including aborts.
 * Callers supply host adapters, never intermediate rollback or swipe state.
 */
export function createRoundHistory({ chats, sessions, scripts, timeline, queueSettlement, afterCommit, cancelSettlement, present, diagnostics, checkOriginalSpInstalled, prepareOriginalSpRollback, prepareOriginalSpRollbackDeletion }) {
  const { read: readChat, forSession: chatForSession, readCard: readChatCard,
    readRevision: readChatRevision, write: writeChat, update: updateChat } = chats
  const chatForSessionReadonly = chats.forSessionReadonly || chatForSession
  const { read: readScript, continuity: scriptContinuity } = scripts
  const tavernScriptHostAdapter = scripts
  const storyTimeline = timeline
  const view = present
  const pendingRollbacks = new Set()

  async function stopRollbackGeneration(chat) {
    const agent = sessions.get(chat.sessionId)
    if (agent?.phase?.kind !== 'running') return
    if (typeof agent.cancel !== 'function') throw new Error('当前宿主不支持停止生成，请先停止后再回退')
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
  }

  function rollbackBodyMessages(chat) {
    return (chat.messages || []).map(({ role, turn, text, sourceText, content, inputAttachments, greeting, swipes, swipeId }) => ({ role, turn, text, sourceText, content, inputAttachments, greeting, swipes, swipeId }))
  }

  function assertRollbackSnapshot(current, expected) {
    if (!isDeepStrictEqual(current, expected)) throw new Error('回退期间聊天已被其他操作修改，请刷新后重试')
  }

  function completeLegacyBefore(before) {
    const keys = ['messages','presentation','presentationWarnings','macroState','tavernScriptPrompts','runtimeInputs','spDatabase',
      'resolvedRuntimePreset','posture','ledger','scriptState','candidates','settleStatus','settleError','lastSettle',
      'preparedWorldBookContext','preparedWorldBook','worldBookReads','participants']
    if (!before || !keys.every(key => Object.hasOwn(before, key)) || !Array.isArray(before.messages)) {
      throw new Error('旧存档缺少完整历史快照，不能安全回退或重新生成；原存档保持不变')
    }
    return structuredClone(before)
  }

  async function recover(sessionId, chatId, {signal} = {}) {
    signal?.throwIfAborted()
    const chat = str(chatId) ? await readChat(chatId) : await chatForSession(sessionId)
    signal?.throwIfAborted()
    if (!chat || (!chat.pendingSurfaceRollback && !chat.pendingRegeneration)) return { status: 'unchanged', chat }
    let agent = sessions.get(chat.sessionId), session = agent?.session || sessions.getSession?.(chat.sessionId), handle
    try {
      if (!session && sessions.resume) { handle = await sessions.resume(chat.sessionId); agent = handle.agent; session = agent?.session }
      signal?.throwIfAborted()
      return await recoverRoundHistory({ chat, agent, session, update: updateChat, flush: sessions.flush, timeline: storyTimeline, signal })
    } finally { if (handle) await handle.dispose() }
  }

  async function prepareRollbackIntent(chat, intent) {
    // Installation is authoritative even before a frontend provider claims the
    // chat. Derive this inside the workflow, never from an RPC-supplied flag.
    intent = { ...intent, preserveSpDatabase: chat.spAuthority?.owner === 'original' ||
      Boolean(checkOriginalSpInstalled && await checkOriginalSpInstalled(chat.sessionId)) }
    return await resolveRollbackIntent(chat, intent)
  }

  async function resolveRollbackIntent(chat, intent) {
    const target = storyTimeline.rollbackTarget({ chat })
    if (target === null) {
      if (storyTimeline.inspect({ chat }).checkpointCount > 0) return intent
      return { ...intent, legacyBefore: completeLegacyBefore(intent.legacyBefore) }
    }
    const beforeChat = await readChatRevision(chat.id, target.beforeRevision)
    if (beforeChat === undefined) throw new Error('找不到剧情 checkpoint 对应的历史 Chat revision: ' + target.beforeRevision)
    return Object.assign({}, intent, { beforeChat })
  }

  async function rollbackPreview(sessionId, chatId) {
    const chat = str(chatId) === '' ? await chatForSessionReadonly(sessionId) : await readChat(chatId)
    if (!chat) throw new Error('聊天不存在: ' + str(chatId))
    if (sessionId && chat.sessionId !== sessionId) throw new Error('对话与原生会话绑定不一致')
    assertRescueHistoryEditable(chat)
    if (!['story', 'script'].includes(chat.mode || 'story')) throw new Error('仅游玩模式支持回退本轮')
    const assistantIndex = (chat.messages || []).findLastIndex(message => message?.role === 'assistant' && !message.greeting)
    if (assistantIndex < 0) throw new Error('没有可回退的剧情 checkpoint')
    const expectedTurn = Number(chat.messages[assistantIndex].turn)
    let legacyBefore
    if (storyTimeline.inspect({ chat }).checkpointCount === 0) {
      const userText = str(chat.messages[assistantIndex - 1]?.text).trim()
      const keys = Object.keys(chat.nativeCommits || {}).map(Number).filter(Number.isFinite).sort((a, b) => b - a)
      const commit = keys.map(key => ({ key, commit: chat.nativeCommits[String(key)] })).find(row =>
        chat.messages[assistantIndex - 1]?.role === 'user' ? str(row.commit?.userText).trim() === userText : row.key === expectedTurn)
      legacyBefore = completeLegacyBefore(commit?.commit?.before)
    }
    const intent = await resolveRollbackIntent(chat, { legacyBefore })
    return { expectedTurn, ...storyTimeline.rollbackPreview({ chat, intent }) }
  }

  function assertConfirmedDesigns(chat, expectedStamp) {
    if (expectedStamp !== undefined && characterDesignStamp(chat) !== expectedStamp) throw new Error('人物档案已变化，请重新确认受影响的档案')
  }
  // 1.7: with the original SP installed a rollback deletes the latest floors the
  // way SillyTavern deletes messages. The original's live instance applies its
  // own delete guard (grafting replay roots onto survivors; the removed floors'
  // logs are not restored) and returns the survivors' changed fields; the
  // timeline commits them. DSH never materializes or rebuilds the tables here.
  async function prepareOriginalSpDeletion(chat, intent){
    if(intent.preserveSpDatabase!==true||!prepareOriginalSpRollbackDeletion)return intent
    const restored=storyTimeline.apply({ chat: structuredClone(chat), intent }).chat
    const keep=(restored.messages||[]).length
    if(keep<1||keep>=(chat.messages||[]).length||restored.messages.some((message,index)=>message.id!==chat.messages[index]?.id))throw new Error('回退后的剧情与当前楼层前缀不一致，SP 原包无法按删楼撤销；未回退')
    if(!chat.messages.slice(keep).some(originalSpFloorCarries))return { ...intent, originalSpDeletion: { kept: keep, receipt: null } }
    const receipt=await prepareOriginalSpRollbackDeletion(chat,{keep})
    const latest=await readChat(chat.id)
    if(!latest||!isDeepStrictEqual(rollbackBodyMessages(latest),rollbackBodyMessages(chat)))throw Error('SP 原包准备期间剧情已变化，请刷新后重试；原件已保留')
    return { ...intent, originalSpDeletion: { kept: keep, receipt } }
  }
  async function prepareOriginalSp(chat){
    if(!prepareOriginalSpRollback || !(chat.spAuthority?.owner==='original'||checkOriginalSpInstalled&&await checkOriginalSpInstalled(chat.sessionId)))return chat
    const next=await prepareOriginalSpRollback(chat,{materialize:originalSpRollbackNeedsMaterialization(chat)})||await readChat(chat.id)
    if(!next||next.id!==chat.id||next.sessionId!==chat.sessionId||!isDeepStrictEqual(rollbackBodyMessages(next),rollbackBodyMessages(chat)))throw Error('SP 原包准备期间剧情已变化，请刷新后重试；原件已保留')
    return next
  }
  async function regenBody(chatId, guidance, sessionId, expectedTurn) {
    let chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    if (expectedTurn !== undefined && Number(chat.messages?.findLast(m=>m.role==='assistant'&&!m.greeting)?.turn) !== expectedTurn) throw new Error('最新轮次已变化，请重新确认重生成目标')
    assertRescueHistoryEditable(chat)
    const activeRound = Object.values(storyTimeline.inspect({ chat }).operations || {}).find(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'completed' &&
        operation.background && ['pending', 'running'].includes(str(operation.background.phase))
    })
    if (chat.pendingSurfaceRollback || chat.pendingRegeneration) throw new Error('上次历史修改尚未恢复，请先恢复再操作')
    if (chat.regenInProgress === true) throw new Error('正文正在重新生成，请等待完成')
    const card = await readChatCard(chat)
    const storedSessionId = chat.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    let selection, evidence
    try { selection = selectRegenerationTarget(chat, session, diagnostics ? value => { evidence = value } : undefined) }
    finally {
      if (evidence) {
        try { await diagnostics.record(chat.sessionId, { stage: 'regeneration-target', diagnosticId: randomUUID(),
          outcome: evidence.reason === 'selected' ? 'selected' : 'rejected', ...evidence,
          guidanceProvided: typeof guidance === 'string' && guidance.trim().length > 0,
          binding: { requested: diagnosticIdentity(sessionId), stored: diagnosticIdentity(storedSessionId), effective: diagnosticIdentity(chat.sessionId),
            overridden: Boolean(sessionId && sessionId !== storedSessionId) },
          agent: { phase: ['running', 'idle'].includes(agent.phase?.kind) ? agent.phase.kind : 'other', lastTurn: Number.isFinite(agent.phase?.lastTurn) ? agent.phase.lastTurn : null } }) }
        catch { /* Recording failure must not affect regeneration or replace its error. */ }
      }
    }
    const { eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource,inputKind,targetAssistantId } = selection
    const previewSpan=planRegenerationPreview({events:sessionEvents(session),nodes:session.surface?.nodes||[],oldAssistantSeq:oldSeq})
    // V3 hosts may reject assistant replacements. Check an isolated copy before
    // rolling back the Chat, cancelling settlement or paying for a new reply.
    if (session.header?.version >= 3) {
      const preview = session.constructor.fromRestore(session.id, structuredClone(session.snapshotEvents ? session.snapshotEvents() : sessionEvents(session)), structuredClone(session.header), session.inheritedEventCount, 'detached')
      try {
        let span=previewSpan
        if(previewSpan.preserved?.length){
          const carrier=appendTavernEvent(preview,'user/message',{id:randomUUID(),role:'user',content:[],source:{kind:'plugin',plugin:'dsh-tavern-regen'}},{surfaceOp:'append'})
          span={start:carrier.seq,end:carrier.seq,shadowedSeqs:[carrier.seq]}
        }
        appendSessionEvent(preview, 'assistant/message', {
          turn: oldTurn, step: 1,
          message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: msgs0[oldAssistantIndex].text }], source: oldSource }
        }, { surfaceOp: { op: 'replace', start: span.start, end: span.end }, sourceEventSeqs: span.shadowedSeqs })
      } catch (error) {
        throw new Error('当前 DSH 不支持正文替换，未启动重新生成。' + str(error?.message || error), { cause: error })
      }
    }
    const originalUserText = inputKind==='trigger'?'':str(msgs0[oldAssistantIndex - 1].text).trim()
    chat = await prepareOriginalSp(chat)
    const originalChat = structuredClone(chat)
    const regenerationRecord = historyRecoveryRecord(originalChat, { kind: 'regeneration', phase: 'generating', eventStart })
    let restored = false
    async function restoreFailedRegen() {
      if (restored) return
      const abortedTurns = regenerationAttemptTurns({ events: sessionEvents(session), eventStart })
      await updateChat(chat.id, current => {
        if (current.pendingRegeneration?.id !== regenerationRecord.id) throw new Error('重新生成恢复记录已变化')
        current.pendingRegeneration.phase = 'aborting'
        return current
      }, { source: 'foreground.regen-aborting' })
      clearRegenerationAttemptSurface({ session, eventStart, id: () => regenerationRecord.id + ':abort' })
      if (sessions.flush) await sessions.flush(session)
      await updateChat(chat.id, current => {
        if (current.pendingRegeneration?.id !== regenerationRecord.id) throw new Error('重新生成恢复记录已变化')
        return restoreHistoryChat(current, regenerationRecord, storyTimeline, abortedTurns)
      }, { source: 'foreground.regen-abort' })
      restored = true
    }
    let legacyBefore = null
    if (storyTimeline.inspect({ chat }).checkpointCount === 0) {
      let rollbackCommit = null
      if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
        const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
        for (const key of keys) {
          const value = chat.nativeCommits[String(key)]
          if (value && (inputKind==='trigger'?key===oldTurn:str(value.userText).trim() === originalUserText)) { rollbackCommit = value; break }
        }
      }
      const before = rollbackCommit && rollbackCommit.before && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : {}
      legacyBefore = completeLegacyBefore(before)
      if ((chat.mode || 'story') === 'script') {
        const script = await readScript(chat.cardPath)
        if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法重新生成正文')
        const revision = before.scriptRevision && typeof before.scriptRevision === 'object' ? before.scriptRevision : null
        const reference = rollbackCommit && rollbackCommit.scriptReference && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
        legacyBefore.scriptState = scriptContinuity.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision, reference } }).state
      }
    }
    const rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: oldTurn, legacyBefore })
    const lifecycleRevision = Math.max(0, Number(originalChat.tavernHelperLifecycleRevision) || 0) + 1
    chat = await updateChat(chat.id, function (current) {
      assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: oldAssistantIndex,inputKind })
      const next = storyTimeline.apply({ chat: current, intent: rollbackIntent }).chat
      next.tavernHelperLifecycleRevision = lifecycleRevision
      next.regenInProgress = true
      next.pendingRegeneration = regenerationRecord
      return next
    }, { source: 'rollback.regen' })
    if (activeRound !== undefined && typeof cancelSettlement === 'function') await cancelSettlement(chat.id)
    const rolledMessageCount = (chat.messages || []).length
    const guide = str(guidance).trim()
    const syntheticText = originalUserText + (guide !== '' ? '\n\n【本轮补充要求】\n' + guide : '')
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    try {
      agent.followup(encodeTavernMessage({
        id: randomUUID(),
        role: 'user',
        content: inputKind==='trigger'?[]:projectPlayerContent(msgs0[oldAssistantIndex - 1].inputAttachments, syntheticText),
        source: { kind: 'plugin', plugin: 'dsh-tavern-regen',regenerationId:regenerationRecord.id,...inputKind==='trigger'?{inputKind,targetAssistantId,guidance:guide}:{} }
      },agent.session.header?.version))
      await agent.whenIdle()
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    const syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
    const latest = await readChat(chat.id)
    if (latest === undefined) {
      await restoreFailedRegen()
      throw new Error('聊天不存在: ' + chat.id)
    }
    const latestMsgs = latest.messages || []
    const addedMessages=inputKind==='trigger'?1:2
    const nativeFailure=sessionEvents(session).findLast(event=>event.seq>=eventStart&&event.type==='turn/end'&&Number(event.data?.turn)===syntheticTurn&&event.data?.reason?.kind==='error')
    if (latestMsgs.length !== rolledMessageCount + addedMessages) {
      await restoreFailedRegen()
      throw new Error(str(nativeFailure?.data?.reason?.error?.message)||'重新生成流程未产生新的用户/助手回合')
    }
    const regeneratedUser = latestMsgs[latestMsgs.length - 2]
    const newAssistant = latestMsgs[latestMsgs.length - 1]
    if (inputKind!=='trigger'&&(regeneratedUser === null || typeof regeneratedUser !== 'object' || regeneratedUser.role !== 'user') ||
        newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant' || Number(newAssistant.turn) !== syntheticTurn) {
      await restoreFailedRegen()
      throw new Error('重新生成流程未产生正文')
    }
    const body = str(newAssistant.text).trim()
    if (body === '') {
      await restoreFailedRegen()
      throw new Error('重新生成失败：模型返回空文本')
    }
    let replacement
    try {
      replacement = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface?.nodes || [], oldAssistantSeq: oldSeq, eventStart })
    } catch (error) { await restoreFailedRegen(); throw error }
    const surface = regenerationSurfaceRecord(replacement,
      { turn: oldTurn, step: 1, message: { id: regenerationRecord.id, role: 'assistant', content: [{ type: 'text', text: body }], source: oldSource } },regenerationRecord.id)
    let committedChat
    try { committedChat = await updateChat(latest.id, function (current) {
      const currentMessages = Array.isArray(current && current.messages) ? current.messages : []
      const currentUser = currentMessages[currentMessages.length - 2]
      const currentAssistant = currentMessages[currentMessages.length - 1]
      if (currentMessages.length !== rolledMessageCount + addedMessages || inputKind!=='trigger'&&(currentUser === null || typeof currentUser !== 'object' || currentUser.role !== 'user') ||
          currentAssistant === null || typeof currentAssistant !== 'object' || currentAssistant.role !== 'assistant' || Number(currentAssistant.turn) !== syntheticTurn ||
          str(currentAssistant.text).trim() !== body) throw new Error('重新生成流程的正文已被另一项操作修改')
      const merged = replaceLastRound({ originalChat, regeneratedChat: current, assistantIndex: oldAssistantIndex,inputKind, preserveOriginalSp: rollbackIntent.preserveSpDatabase })
      const next = merged.chat
      if (next.nativeCommits !== null && typeof next.nativeCommits === 'object') delete next.nativeCommits[String(syntheticTurn)]
      next.nativeCommits = next.nativeCommits && typeof next.nativeCommits === 'object' ? structuredClone(next.nativeCommits) : {}
      if (originalChat.nativeCommits && originalChat.nativeCommits[String(oldTurn)]) next.nativeCommits[String(oldTurn)] = structuredClone(originalChat.nativeCommits[String(oldTurn)])
      delete next.regenInProgress
      next.settleStatus = 'pending'
      next.settleError = null
      next.tavernHelperLifecycleRevision = lifecycleRevision + 1
      next.suppressedDshTurns = Array.from(new Set((Array.isArray(next.suppressedDshTurns) ? next.suppressedDshTurns : []).concat([syntheticTurn]))).sort(function (left, right) { return left - right })
      next.regeneratedDshTurns = next.regeneratedDshTurns && typeof next.regeneratedDshTurns === 'object' && !Array.isArray(next.regeneratedDshTurns)
        ? structuredClone(next.regeneratedDshTurns) : {}
      next.regeneratedDshTurns[String(oldTurn)] = syntheticTurn
      next.pendingRegeneration = { ...regenerationRecord, phase: 'adopted', surface }
      return scripts.stageRegeneration ? scripts.stageRegeneration(next,regenerationRecord.id) : next
    }, { source: 'foreground.regen-commit' })
    } catch (error) { await restoreFailedRegen(); throw error }
    try { applyRegenerationSurface(session, surface) }
    catch (error) {
      // If the native marker exists, adoption began; recovery must finish it.
      if (!pendingAssistantEdit(session, surface.data.message.id)) await restoreFailedRegen()
      throw error
    }
    if (sessions.flush) await sessions.flush(session)
    syncAuthoredAgentPhase(agent)
    committedChat = await updateChat(latest.id, current => {
      if (current.pendingRegeneration?.id !== regenerationRecord.id) throw new Error('重新生成提交记录已变化')
      delete current.pendingRegeneration
      return current
    }, { source: 'foreground.regen-surface-saved' })
    let settledChat = committedChat
    try {
      if (afterCommit) await afterCommit(committedChat)
      else await queueSettlement(committedChat.id)
      settledChat = await readChat(committedChat.id) || committedChat
    } catch (error) {
      const message = str(error?.message || error) || '后台结算失败'
      settledChat = await updateChat(committedChat.id, function (current) {
        if (!current || typeof current !== 'object') return current
        current.settleStatus = 'failed'
        current.settleError = message
        return current
      }, { source: 'settlement.regen-failed' })
    }
    const result = await view(settledChat, card)
    return { ...result, adopted: { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn } }
  }

  // ---------- 回退本轮（删除最近一次用户输入 + LLM 输出） ----------
  async function rollbackTurn(sessionId, chatId, expectedTurn, expectedCharacterDesignStamp) {
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    assertRescueHistoryEditable(chat)
    assertConfirmedDesigns(chat, expectedCharacterDesignStamp)
    if (expectedTurn !== undefined && Number(chat.messages?.findLast(m=>m.role==='assistant'&&!m.greeting)?.turn) !== expectedTurn) throw new Error('最新轮次已变化，请重新确认回退目标')
    if (pendingRollbacks.has(chat.id)) throw new Error('正在回退本轮，请等待完成')
    pendingRollbacks.add(chat.id)
    try { return await rollbackChat(chat, expectedTurn, expectedCharacterDesignStamp) }
    finally { pendingRollbacks.delete(chat.id) }
  }

  async function rollbackChat(chat, confirmedTurn, expectedCharacterDesignStamp) {
    await stopRollbackGeneration(chat)
    chat = await readChat(chat.id)
    if (chat.pendingSurfaceRollback || chat.pendingRegeneration) throw new Error('上次历史修改尚未恢复，请先恢复再操作')
    assertRescueHistoryEditable(chat)
    assertConfirmedDesigns(chat, expectedCharacterDesignStamp)
    if (confirmedTurn !== undefined && Number(chat.messages?.findLast(m=>m.role==='assistant'&&!m.greeting)?.turn) !== confirmedTurn) throw new Error('最新轮次已变化，请重新确认回退目标')
    let originalChat = structuredClone(chat)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const events = sessionEvents(session)
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const rollbackSurface = locateRollbackSurface({ events, nodes })
    if (rollbackSurface === null) throw new Error('原生消息流中找不到可回退的用户输入与正文组合')
    const hiddenTurn = rollbackSurface.turn
    const shadowedSeqs = rollbackSurface.shadowedSeqs
    const regeneratedDshTurns = originalChat.regeneratedDshTurns && typeof originalChat.regeneratedDshTurns === 'object' && !Array.isArray(originalChat.regeneratedDshTurns)
      ? originalChat.regeneratedDshTurns : {}
    const regeneratedVisibleTurn = Number(regeneratedDshTurns[String(hiddenTurn)])

    // 1) 定位要回退的最后一组 user + assistant
    const msgs = chat.messages || []
    let assistantIndex = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        assistantIndex = i
        break
      }
    }
    const inputKind=tavernTriggerTurnInput(events,Number(msgs[assistantIndex]?.turn))?'trigger':'player'
    if (assistantIndex < 0 || inputKind!=='trigger'&&assistantIndex - 1 < 0) throw new Error('没有可回退的用户输入与正文组合')
    if (inputKind!=='trigger'&&(msgs[assistantIndex - 1] === null || typeof msgs[assistantIndex - 1] !== 'object' || msgs[assistantIndex - 1].role !== 'user')) throw new Error('最后一组消息不是用户输入 + 正文')
    const expectedTurn = Number(msgs[assistantIndex].turn)
    if (expectedTurn > 0 && hiddenTurn !== expectedTurn && hiddenTurn !== Number(regeneratedDshTurns[String(expectedTurn)])) {
      throw new Error('该轮已不在当前模型上下文中，不能直接回退；历史正文仍可通过 history_recall 检索')
    }
    const removedUserText = inputKind==='trigger'?'':str(msgs[assistantIndex - 1].text).trim()
    const removedAssistantText = str(msgs[assistantIndex].text).trim()
    // 2) 旧对话从 native commit 生成一次性迁移 checkpoint；新对话直接使用权威 checkpoint
    let rollbackCommit = null
    let rollbackCommitKey = ''
    if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
      const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
      for (const key of keys) {
        const commit = chat.nativeCommits[String(key)]
        if (commit !== null && typeof commit === 'object' && (inputKind==='trigger'?key===expectedTurn:str(commit.userText).trim() === removedUserText)) {
          rollbackCommit = commit
          rollbackCommitKey = String(key)
          break
        }
      }
    }
    const before = rollbackCommit !== null && rollbackCommit.before !== null && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : null
    const legacyBefore = storyTimeline.inspect({ chat }).checkpointCount === 0 ? completeLegacyBefore(before) : null
    if (mode === 'script' && storyTimeline.inspect({ chat }).checkpointCount === 0) {
      const script = await readScript(chat.cardPath)
      if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法回退剧本状态')
      const revision = before !== null && before.scriptRevision !== null && typeof before.scriptRevision === 'object'
        ? before.scriptRevision
        : (before !== null && before.scriptState !== null && typeof before.scriptState === 'object' ? before.scriptState : null)
      const reference = rollbackCommit !== null && rollbackCommit.scriptReference !== null && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
      legacyBefore.scriptState = scriptContinuity.transition({ script: script, state: chat.scriptState, event: { kind: 'restore', revision: revision, reference: reference } }).state
    }
    originalChat = structuredClone(chat)
    let rollbackWarning = ''
    let rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: hiddenTurn, legacyBefore })
    storyTimeline.rollbackPreview({ chat, intent: rollbackIntent }) // Reject incomplete character history before SP or cancellation.
    rollbackIntent = await prepareOriginalSpDeletion(chat, rollbackIntent)
    await stopRollbackGeneration(chat)
    if (typeof cancelSettlement === 'function') {
      try { await cancelSettlement(chat.id, { wait: false }) }
      catch (error) { rollbackWarning = '正文已回退，后台停止请求失败：' + str(error?.message || error) }
    }
    for (const participant of Object.values(storyTimeline.inspect({ chat }).participants || {})) {
      const worker = sessions.get(participant.sessionId)
      if (worker && worker !== agent && typeof worker.cancel === 'function') {
        try { worker.cancel({ kind: 'parent' }) } catch { /* Old results are rejected by the new branch. */ }
      }
    }
    const record = historyRecoveryRecord(originalChat, { kind: 'rollback', phase: 'adopted', surface: {
      data: { turn: rollbackSurface.turn, step: rollbackSurface.step,
        message: { id: randomUUID(), role: 'assistant', content: [], source: rollbackSurface.source } },
      intent: { surfaceOp: { op: 'replace', startSeq: rollbackSurface.userSeq, endSeq: rollbackSurface.endSeq }, sourceEventSeqs: shadowedSeqs }
    } })
    chat = await updateChat(chat.id, current => {
      assertConfirmedDesigns(current, expectedCharacterDesignStamp)
      if (!isDeepStrictEqual(rollbackBodyMessages(current), rollbackBodyMessages(originalChat)) || current.timeline?.branchId !== originalChat.timeline?.branchId) throw new Error('回退期间正文已被其他操作修改，请刷新后重试')
      const next = storyTimeline.apply({ chat: current, intent: rollbackIntent }).chat
      next.regenInProgress = false
      if (rollbackCommitKey !== '') delete next.nativeCommits[rollbackCommitKey]
      next.tavernHelperLifecycleRevision = Math.max(0, Number(current.tavernHelperLifecycleRevision) || 0) + 1
      next.suppressedDshTurns = [...new Set([...(next.suppressedDshTurns || []), hiddenTurn,
        ...(Number.isSafeInteger(regeneratedVisibleTurn) && regeneratedVisibleTurn > 0 ? [regeneratedVisibleTurn] : [])])].sort((a, b) => a - b)
      next.regeneratedDshTurns = { ...next.regeneratedDshTurns }
      delete next.regeneratedDshTurns[String(hiddenTurn)]
      next.pendingSurfaceRollback = record
      next.updatedAt = Date.now()
      return next
    }, { source: 'rollback' })
    try { appendAssistantEvent(session, record.surface.data, record.surface.intent) }
    catch (error) {
      if (pendingAssistantEdit(session, record.surface.data.message.id)) throw error
      try {
        await updateChat(chat.id, current => {
          assertRollbackSnapshot(current, chat)
          return restoreHistoryChat(current, record, storyTimeline)
        }, { source: 'rollback.abort' })
      } catch (restoreError) {
        throw new Error('回退失败且剧情恢复未完成：' + str(error?.message || error) + '；' + str(restoreError?.message || restoreError), { cause: error })
      }
      throw error
    }
    if (sessions.flush) await sessions.flush(session)
    chat = await updateChat(chat.id, current => {
      if (current.pendingSurfaceRollback?.id !== record.id) throw new Error('回退提交记录已变化')
      delete current.pendingSurfaceRollback
      return current
    }, { source: 'rollback.surface-saved' })
    // Rewind immediately after the foreground commit; retain the timeline's retry
    // boundary so the next task can safely retry if this best-effort step fails.
    for (const participant of Object.values(storyTimeline.inspect({ chat }).participants || {})) {
      if (participant.status !== 'needs-rewind' || !participant.sessionId) continue
      let restoredHandle
      try {
        let worker = sessions.get(participant.sessionId)
        let background = worker?.session || sessions.getSession?.(participant.sessionId)
        if (!background && typeof sessions.resume === 'function') {
          restoredHandle = await sessions.resume(participant.sessionId)
          worker = restoredHandle.agent
          background = worker?.session
        }
        if (!background) throw new Error('后台会话尚未加载，将在下次后台任务启动时重试')
        if (worker?.phase?.kind === 'running') {
          worker.cancel({ kind: 'parent' })
        }
        if (typeof worker?.whenIdle === 'function') {
          let timeout
          try {
            await Promise.race([worker.whenIdle(), new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('后台尚未停止，将在下次任务启动时重试')), 3000)
            })])
          } finally { clearTimeout(timeout) }
        }
        if (typeof sessions.flush !== 'function') throw new Error('当前宿主未提供后台会话保存接口')
        rewindBackgroundSurface(background, participant.rewindTo)
        await sessions.flush(background)
      } catch (error) {
        rollbackWarning = [rollbackWarning, '正文已回退，后台上下文回退未完成：' + str(error?.message || error)].filter(Boolean).join('；')
      } finally {
        if (restoredHandle) {
          try { await restoredHandle.dispose() }
          catch (error) { rollbackWarning = [rollbackWarning, '后台回退临时会话释放失败：' + str(error?.message || error)].filter(Boolean).join('；') }
        }
      }
    }
    // Notify scripts only after both authoritative story and native surface have committed.
    try {
      // An ordinary event (R8 1.5): an unready MVU core no longer holds the rollback reply for 91 s.
      await tavernScriptHostAdapter.dispatchEvent({ sessionId: chat.sessionId, chat, name: 'MESSAGE_DELETED', args: [(chat.messages || []).length], work: { general: true } })
    } catch (error) { rollbackWarning = '回退已完成，但脚本联动失败：' + str(error?.message || error) }
    const result = await view(chat, card)
    return { ...result, ...(rollbackWarning !== '' ? { rollbackWarning } : {}), rolledBack: { hiddenTurn, removedUserText, removedAssistantText } }
  }

  async function withNativeSession(chatId, sessionId, action) {
    const chat = str(chatId) ? await readChat(chatId) : await chatForSession(sessionId)
    if (!chat) throw new Error('聊天不存在: ' + str(chatId))
    if (sessionId && chat.sessionId !== sessionId) throw new Error('对话与原生会话绑定不一致')
    let handle
    try {
      if(!sessions.get(chat.sessionId)){
        if(sessions.ensureForeground)await sessions.ensureForeground(chat.sessionId)
        else if(sessions.resume)handle=await sessions.resume(chat.sessionId)
      }
      return await action()
    } finally { if (handle) await handle.dispose() }
  }
  return Object.freeze({
    regenerate: (chatId, guidance, sessionId, expectedTurn) => withNativeSession(chatId, sessionId, () => regenBody(chatId, guidance, sessionId, expectedTurn)),
    rollback: (sessionId, chatId, expectedTurn, expectedCharacterDesignStamp) => withNativeSession(chatId, sessionId, () => rollbackTurn(sessionId, chatId, expectedTurn, expectedCharacterDesignStamp)),
    rollbackPreview,
    recover
  })
}
