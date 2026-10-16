import {encodeTavernMessage} from './domain/session-message-source.js'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { prependSystemInstruction } from './domain/system-append.js'
import { createBackgroundProgress } from './domain/background-progress.js'
import { rewindBackgroundSurface } from './domain/background-surface.js'
import { sessionEvents } from './domain/session-events.js'
import { randomUUID } from 'node:crypto'
import { readSceneImageSystemInstruction } from './scene-image-prompts.js'
import { CHARACTER_DESIGN_READ_TOOL } from './domain/character-design-document.js'
import {
  CHARACTER_DESIGN_FINISH_TOOL,
  createCharacterDesignStage
} from './domain/character-design-stage.js'
import { imageToolCall } from './domain/scene-plan-draft.js'
import { runtimePresetPhaseMessages } from './domain/runtime-preset-lifecycle.js'
import { ensureSessionStablePrefix, readSessionStablePrefix, sessionStablePrefixSections, withCurrentWorldbook } from './domain/session-stable-prefix.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

function backgroundPrompt(messages, turnContext, task, taskProtocol, input = {}) {
  const sections = []
  if (task === 'candidate' && str(input.systemPromptText).trim()) {
    sections.push('【人物卡系统提示】\n' + str(input.systemPromptText).trim())
  }
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push('【本轮权威状态】\n以下内容是当前最新状态；若与后台会话中的旧游标、姿势或指导冲突，以本节为准。\n' + authoritative)
  }
  const recent = (messages || []).map(function (message) {
    const role = task === 'phone'
      ? (message && message.role === 'assistant' ? '联系人' : '你')
      : (message && message.role === 'assistant' ? '正文' : '用户')
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  const taskName = task === 'image' ? '场景生图' : task === 'settlement' ? '状态结算' : task === 'phone' ? '手机私聊' : task === 'character-design' ? '人物设计' : '候选生成'
  sections.push('【最近剧情与本次任务】\n任务类型：' + taskName + '\n' + recent)
  const protocol = str(taskProtocol).trim()
  if (protocol !== '') sections.push('【DSH 后台任务协议（最终指令）】\n' + protocol)
  if (task === 'candidate' && str(input.postHistoryText).trim()) {
    sections.push('【人物卡历史后指令】\n' + str(input.postHistoryText).trim())
  }
  return sections.join('\n\n')
}

function finalMessage(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
    const text = content.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('').trim()
    if (text !== '') return { text, event, index: Number.isSafeInteger(event.seq) ? event.seq : index }
  }
  return null
}


function terminalError(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'turn/end') continue
    const reason = event.data && event.data.reason
    if (reason !== null && typeof reason === 'object' && reason.kind === 'max-tokens') {
      return new Error('后台 Agent 输出达到模型 token 上限，正式结果尚未生成')
    }
    if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') continue
    const detail = reason.error
    const message = str(detail && detail.message || detail).trim()
    if (message !== '') return new Error(message)
  }
  return null
}

export function maximumBackgroundTokens(selection) {
  const provider = str(selection && selection.provider).trim().toLowerCase()
  const model = str(selection && selection.model).trim().toLowerCase()
  if (provider === 'deepseek-official' && (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')) return 384000
  return undefined
}

export function traceError(error, traceSessionId, task) {
  const fallback = task === 'settlement' ? '后台状态结算失败' : task === 'phone' ? '手机私聊回复失败' : '后台候选生成失败'
  const wrapped = new Error(str(error && error.message || error) || fallback, { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

// A task operates on a leased DSH Agent; it does not create or retain sessions.
export function createBackgroundAgentTask(options) {
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
  const sharedBackgroundTools = Array.isArray(options.sharedTools) ? options.sharedTools.filter(function (item) {
    return item && item.tool && typeof item.tool.name === 'string' && typeof item.execute === 'function'
  }) : []
  const sharedByName = new Map(sharedBackgroundTools.map(function (item) { return [item.tool.name, item] }))
  const sharedAllowed = (item, input) => item && (typeof item.allowed !== 'function' || item.allowed(input) === true)
  const stableBackgroundTools = []
  const stableNames = new Set()
  const configuredBackgroundTools = Array.isArray(options.backgroundTools) ? options.backgroundTools : []
  const hasCharacterDesignTools = configuredBackgroundTools.some(function (tool) {
    return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
  })
  const backgroundToolCatalog = configuredBackgroundTools
    .concat(hasCharacterDesignTools ? [CHARACTER_DESIGN_FINISH_TOOL] : [])
    .concat(sharedBackgroundTools.map(function (item) { return item.tool }))
  for (const tool of backgroundToolCatalog) {
    if (!tool || typeof tool.name !== 'string' || stableNames.has(tool.name)) continue
    stableNames.add(tool.name)
    stableBackgroundTools.push(tool)
  }
  function completedBoundary(events) {
    for (let index = (events || []).length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/end' && Number.isSafeInteger(event.seq)) return event.seq
    }
    return null
  }

  function setupFor(state, descriptor, appendDescriptor) {
    const backgroundPersona = state.input.task === 'phone'
      ? '你是与故事正文隔离的手机私聊 Agent。你只代表指定联系人回复当前手机消息，不推进正文、不修改状态，也不把私聊虚构成已经发生的现场剧情。'
      : '你是与前台正文生成隔离的酒馆后台 Agent。你会在同一个剧情分支中依次承担状态结算与候选生成，并可在任务确有需要时加载人物设计 Skill；严格按每轮末尾追加的任务协议输出，不得把某类任务的输出格式混入另一类任务。最新权威状态优先于 Session 中的旧动态状态。'
    let descriptorAppended = !appendDescriptor
    return async function (childCtx) {
      if (setupAgent !== null) await setupAgent(childCtx)
      state.ctx = childCtx
      // The kernel snapshots this task's route at assembly, preserving the
      // resident Session while keeping in-flight requests on their old model.
      installModelSelection(childCtx, {
        get current() { return state.input.selection },
        assembled: undefined
      })
      childCtx.on('agent/request', async function (_payload, next) {
        const input = state.input || {}
        const resolved = await next()
        // rc.2 seeds later requests from the persisted header. Replace that
        // stale task budget here; policies installed by setupAgent/the host
        // wrap this scoped hook and may still impose a lower current limit.
        const { maxTokens: _previousMaxTokens, ...request } = resolved
        const requested = Number(input.maxTokens)
        const maxTokens = Number.isSafeInteger(requested) && requested > 0 ? requested : maximumBackgroundTokens(input.selection)
        if (maxTokens !== undefined) request.maxTokens = maxTokens
        return request
      })
      childCtx.on('agent/assistant-stream', ({ frame }) => state.progress?.frame(frame))
      childCtx.on('agent/pre-step', async function ({ agent, turn, step }, next) {
        const decision = await next()
        if (!descriptorAppended && decision.kind === 'enter') {
          descriptorAppended = true
          agent.session.append('subagent/descriptor', descriptor)
        }
        if (decision.kind !== 'enter') return decision
        const input = state.input || {}
        const snapshot = typeof options.resolveRuntimePresetSnapshot === 'function'
          ? await options.resolveRuntimePresetSnapshot({ sessionId: input.sessionId, operation: input.task || 'background' })
          : null
        const messageOptions = { scope: 'background', turn, step }
        if (typeof options.stageRuntimePresetSnapshot === 'function') {
          options.stageRuntimePresetSnapshot({ sessionId: agent.session.id, turn, step, snapshot, scope: 'background' })
        }
        const middleMessages = Number(step) === 1 ? runtimePresetPhaseMessages(snapshot, 'middle', messageOptions) : []
        return middleMessages.length === 0 ? decision : Object.assign({}, decision, {
          messages: middleMessages.concat(decision.messages)
        })
      })
      childCtx.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        complete: true,
        // DSH restores complete sections after the assembly waterfall, so the
        // additional instruction must be part of this authoritative text.
        text: () => {
          const assembly = { sections: [{ name: 'deployment:persona', text: state.input.task === 'image' ? readSceneImageSystemInstruction() : backgroundPersona }] }
          return prependSystemInstruction(assembly, options.systemAppend?.()).sections.map(section => section.text).join('\n\n')
        }
      })
      childCtx.systemPrompt.suppressRuntimeContext()
      if (state.input.task === 'image') {
        childCtx.tools.register({
          ...CHARACTER_DESIGN_READ_TOOL,
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          async execute(args, execution) {
            if (!state.imageReadTask) return JSON.stringify({ ok: false, error: '当前没有正在执行的绘图任务。' })
            return state.imageReadTask(args, execution)
          }
        })
      }
      let releaseRestriction, restrictionKey, restrictionScope
      function refreshRestriction() {
        const allow = state.input.task === 'image' || state.input.task === 'phone' ? [] : ['skill', ...(state.input.webSearchEnabled === true ? ['web_search'] : [])]
        const key = allow.join(',')
        const scope = typeof childCtx.tools.view === 'function' || typeof childCtx.tools.schemas === 'function' ? state.agentScope : undefined
        if (key === restrictionKey && scope === restrictionScope) return
        releaseRestriction?.()
        const inherited = childCtx.tools.view?.(scope)?.restrictableNames
        const registered = inherited ? Array.from(inherited) : childCtx.tools.schemas?.(scope).map(tool => tool.name)
        releaseRestriction = childCtx.tools.restrict({ allow: registered ? allow.filter(name => registered.includes(name)) : allow })
        restrictionKey = key
        restrictionScope = scope
      }
      refreshRestriction()
      childCtx.on('system-prompt/assemble', async function (_assembly, _context, next) {
        const assembly = await next()
        const sections = [...(assembly.sections || []), ...sessionStablePrefixSections(_context?.agent?.session)]
        assembly.sections = state.currentWorldbook === undefined ? sections : withCurrentWorldbook(sections, state.currentWorldbook)
        prependSystemInstruction(assembly, options.systemAppend?.())
        if (state.input.task === 'phone') {
          assembly.sections = (assembly.sections || []).filter(function (section) {
            return !section || typeof section.name !== 'string' || !section.name.startsWith('tool:')
          })
          assembly.tools = []
          return assembly
        }
        if (state.input.task !== 'image' && state.input.webSearchEnabled === true) return assembly
        assembly.sections = (assembly.sections || []).filter(function (section) { return section && section.name !== 'tool:web_search' })
        assembly.tools = (assembly.tools || []).filter(function (tool) { return tool && tool.name !== 'web_search' })
        return assembly
      })
      state.refreshConfiguredTools = function () {
        refreshRestriction()
        if (state.input.task === 'image') return
        const key = JSON.stringify([state.input.task, state.input.backgroundTasksSnapshot || null])
        if (state.configuredToolsKey === key) return
        for (const dispose of state.stableToolDisposers || []) dispose()
        state.configuredToolsKey = key
        state.stableToolDisposers = stableBackgroundTools.filter(function (tool) {
          const shared = sharedByName.get(tool.name)
          if (shared && !sharedAllowed(shared, state.input)) return false
          const tasks = state.input.backgroundTasksSnapshot
          if (tool.name === 'ledger_submit') return tasks?.ledger === true
          if (!tasks) return true
          if (tool.name === 'mvu_submit_update') return tasks.variables === true
          if (tool.name === 'posture_submit') return tasks.posture === true
          if (tool.name.startsWith('character_design_')) return tasks.characterDesign === true
          return true
        }).map(function (tool) {
          return childCtx.tools.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            output: {
              schema: { type: 'string' },
              render: function (_args, value) { return [{ type: 'text', text: value }] }
            },
            async execute(args, execution) {
              const active = state.activeToolTask
              if (active === null || active === undefined) {
                return JSON.stringify({ ok: false, retryable: true, error: '当前没有正在执行的后台任务，请等待下一条任务指令。' })
              }
              return active.execute(tool, args, execution)
            }
          })
        }).filter(function (dispose) { return typeof dispose === 'function' })
      }
      state.refreshConfiguredTools()
      childCtx.on('agent/request', async function (_payload, next) {
        const input = state.input || {}
        const request = await next()
        const temperature = state.characterDesignStage
          ? state.characterDesignStage.temperature(input.temperature)
          : input.temperature
        if (typeof temperature !== 'number' || input.selection && input.selection.provider === 'openai-codex') return request
        return Object.assign({}, request, { temperature })
      })
    }
  }

  function installTaskTools(state, input, session) {
    const eventStart = sessionEvents(session).length
    let tools = (Array.isArray(input.tools) ? input.tools : []).filter(tool => input.task !== 'image' || tool.name !== CHARACTER_DESIGN_READ_TOOL.name)
    const hasCharacterDesignTools = input.task !== 'image' && tools.some(function (tool) {
      return tool && (tool.name === 'character_design_read' || tool.name === 'character_design_save')
    })
    if (hasCharacterDesignTools && !tools.some(function (tool) { return tool && tool.name === CHARACTER_DESIGN_FINISH_TOOL.name })) {
      tools = tools.concat([CHARACTER_DESIGN_FINISH_TOOL])
    }
    const characterDesignStage = hasCharacterDesignTools
      ? createCharacterDesignStage({ temperature: input.characterDesignTemperature })
      : null
    state.characterDesignStage = characterDesignStage
    if (input.task === 'image') state.imageReadTask = async (args, execution) => {
      if (input.stopToolsWhen?.()) return JSON.stringify({ ok: false, error: '画面方案已提交，请结束本轮。' })
      if (++toolCallCount > maxToolCalls) {
        execution?.concludeTurn?.()
        return JSON.stringify({ ok: false, retryable: false, message: '当前任务的工具调用次数已达上限，请结束本轮。' })
      }
      input.signal?.throwIfAborted()
      const result = str(await input.onToolCall({ name: CHARACTER_DESIGN_READ_TOOL.name, arguments: args }))
      if (toolCallCount >= maxToolCalls) execution?.concludeTurn?.()
      return result
    }
    const maxToolCalls = Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    let toolCallCount = 0
    let removed = false
    const allowed = new Map(tools.map(function (tool) { return [tool.name, tool] }))
    if (stableBackgroundTools.length > 0 && input.task !== 'image') {
      state.activeToolTask = {
        async execute(tool, args, execution) {
          const shared = sharedByName.get(tool.name)
          const permittedShared = sharedAllowed(shared, input)
          const current = shared ? (permittedShared ? shared.tool : undefined) : allowed.get(tool.name)
          if (current === undefined) {
            return JSON.stringify({
              ok: false,
              retryable: true,
              error: '当前任务不允许调用 ' + tool.name + '；请改用：' + (Array.from(allowed.keys()).join('、') || '无工具')
            })
          }
          if (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen()) {
            return JSON.stringify({ ok: false, retryable: false, message: '当前任务已经提交完成，请结束本轮。' })
          }
          toolCallCount++
          if (toolCallCount > maxToolCalls) {
            execution?.concludeTurn?.()
            return JSON.stringify({ ok: false, retryable: false, message: input.toolLimitMessage || '当前任务的工具调用次数已达上限，请结束本轮。' })
          }
          const invoke = async function () {
            input.signal?.throwIfAborted()
            return shared
              ? str(await shared.execute({ input, args, execution }))
              : str(await input.onToolCall({ name: tool.name, arguments: args }))
          }
          const result = characterDesignStage
            ? str(await characterDesignStage.execute(tool.name, invoke))
            : await invoke()
          if (toolCallCount >= maxToolCalls || (typeof input.stopToolsWhen === 'function' && input.stopToolsWhen())) execution?.concludeTurn?.()
          return result
        }
      }
      return async function () {
        if (state.activeToolTask !== null && state.activeToolTask !== undefined) state.activeToolTask = null
        if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
      }
    }
    async function removeTools() {
      if (removed) return
      removed = true
      if (input.task === 'image') state.imageReadTask = null
      for (let index = disposers.length - 1; index >= 0; index--) await disposers[index]()
    }
    const disposers = tools.map(function (tool) {
      return state.ctx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'string' },
            render: function (_args, value) { return [{ type: 'text', text: value }] }
          },
          async execute(args, execution) {
            toolCallCount++
            if (toolCallCount > maxToolCalls) {
              execution?.concludeTurn?.()
              return JSON.stringify({ ok: false, retryable: false, message: input.toolLimitMessage || '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
            }
            const call = input.task === 'image' ? imageToolCall(tool.name, args, execution, sessionEvents(session), eventStart) : { name: tool.name, arguments: args }
            const invoke = async function () { input.signal?.throwIfAborted(); return str(await input.onToolCall(call)) }
            const result = characterDesignStage
              ? str(await characterDesignStage.execute(tool.name, invoke))
              : await invoke()
            if (toolCallCount >= maxToolCalls) execution?.concludeTurn?.()
            if (typeof input.stopToolsWhen === 'function') {
              const complete = input.stopToolsWhen()
              if (complete) execution?.concludeTurn?.()
              if (complete || toolCallCount >= maxToolCalls) await removeTools()
            }
            return result
          }
        })
    }).filter(function (dispose) { return typeof dispose === 'function' })
    return async function () {
      await removeTools()
      if (state.characterDesignStage === characterDesignStage) state.characterDesignStage = null
    }
  }

  async function execute({ agent, state, traceSessionId, persistent }, input) {
    const runtimeInput = state.input
    try {
      input.signal?.throwIfAborted()
      rewindBackgroundSurface(agent.session, input.rewindTo)
      // Assembly precedes agent/pre-step. Resolve the preset ancestors using
      // the leased Agent before followup can assemble the first request.
      state.agentScope = agent
      state.refreshConfiguredTools?.()
    } catch (error) { throw traceError(error, traceSessionId, input.task) }
    const progress = createBackgroundProgress({ idleMs: options.modelIdleTimeoutMs, onCancel: () => { state.abandoned = true; agent.cancel?.({ kind: 'user' }) } })
    state.progress = progress
    runtimeInput.signal = input.signal ? AbortSignal.any([input.signal, progress.signal]) : progress.signal
    const removeTaskTools = installTaskTools(state, runtimeInput, agent.session)
    const cancel = () => progress.cancel()
    input.signal?.addEventListener('abort', cancel, { once: true })

    try {
      input.signal?.throwIfAborted()
      if (persistent && typeof input.onPersistentSessionReady === 'function') {
        // Persist the native session before publishing its identity, even if the first task fails.
        if (typeof options.flushSession === 'function') await options.flushSession(agent.session)
        await input.onPersistentSessionReady(traceSessionId)
      }
      {
        const existing = readSessionStablePrefix(agent.session)
        const revision = typeof options.resolveStablePrefixRevision === 'function' ? await options.resolveStablePrefixRevision(input) : 0
        const background = existing && revision <= Number(existing.message.source.cardContextRevision || 0) ? existing.text : typeof options.resolveStablePrefix === 'function'
          ? await options.resolveStablePrefix(input) : input.backgroundContext
        const prefix = await ensureSessionStablePrefix(agent.session, background, options.stablePrefixStorage, revision)
        if (prefix && prefix.event !== existing?.event && typeof options.flushSession === 'function') await options.flushSession(agent.session)
      }
      state.currentWorldbook = typeof options.resolveCurrentWorldbook === 'function'
        ? await options.resolveCurrentWorldbook(input) : undefined
      const eventStart = sessionEvents(agent.session).length
      agent.followup(encodeTavernMessage({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: backgroundPrompt(input.messages, input.turnContext, input.task, input.system, input) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      },agent.session.header?.version))
      await progress.wait(agent.whenIdle())
      runtimeInput.signal.throwIfAborted()
      const rawResult = finalMessage(sessionEvents(agent.session), eventStart)
      if (rawResult === null) {
        const underlying = terminalError(sessionEvents(agent.session), eventStart)
        if (underlying !== null) throw underlying
        if (typeof runtimeInput.acceptWithoutText !== 'function' || runtimeInput.acceptWithoutText() !== true) {
          throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : '后台 Agent 没有返回候选文本')
        }
      }
      const text = rawResult === null ? '' : rawResult.text.trim()
      if (persistent && input.task === 'image' && typeof options.flushSession === 'function') {
        await options.flushSession(agent.session)
      }
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(sessionEvents(agent.session)) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      progress.dispose()
      state.progress = null
      input.signal?.removeEventListener('abort', cancel)
      await removeTaskTools()
    }
  }

  return Object.freeze({ setup: setupFor, execute })
}
