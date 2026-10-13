import { decodeTavernSource } from './session-message-source.js'
import { inputAttachments, projectPlayerContent } from './player-input-content.js'
import { createEphemeralCompatibilityRequest, isCompatibilityConversationRequest } from './compatibility-request.js'
import { projectRuntimePresetRequest } from './runtime-preset-lifecycle.js'
import { projectStoryRegexRequest } from './st-request-projection.js'
import {isTavernTriggerInput,isTavernTurnInput} from './tavern-turn-input.js'
import { projectExpiredFramePrompts } from './foreground-frame-session-adapter.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function contentText(message) {
  return (Array.isArray(message && message.content) ? message.content : [])
    .filter(function (item) { return item && item.type === 'text' })
    .map(function (item) { return str(item.text) })
    .join('\n')
}

function isTurnInput(message) {
  return isTavernTurnInput(message)
}

function userTextOf(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isTurnInput).map(contentText).filter(Boolean).join('\n').trim()
}

function replaceTurnInput(messages, text) {
  const result = Array.isArray(messages) ? messages.slice() : []
  for (let index = result.length - 1; index >= 0; index--) {
    const message = result[index]
    if (!isTurnInput(message)) continue
    result[index] = Object.assign({}, message, {
      content: isTavernTriggerInput(message)?[]:projectPlayerContent(message.content, str(text).trim())
    })
    break
  }
  return result
}

function isRegenerationInput(message) {
  const source = decodeTavernSource(message && message.source)
  return source && source.kind === 'plugin' && source.plugin === 'dsh-tavern-regen'
}

function triggerGuidanceMessages(message){
 if(!isTavernTriggerInput(message)||!isRegenerationInput(message))return []
 const metadata=decodeTavernSource(message.source),guidance=str(metadata.guidance).trim()
 return guidance?[{id:message.id,role:'user',content:[{type:'text',text:'【本轮补充要求】\n'+guidance}],source:{kind:'plugin',plugin:'dsh-tavern-regen'}}]:[]
}

function isOriginalPlayerInput(message) {
  const source = decodeTavernSource(message && message.source)
  return message && message.role === 'user' && source && source.kind === 'user'
}

/**
 * A body replacement is executed as a new append-only Agent turn, but the
 * provider request must look like a fresh sample of the replaced story turn.
 * Keep the original player-message identity, replace only its projected text,
 * and remove the old turn frame/assistant plus the internal retry carrier.
 */
export function projectRegenerationRequestMessages(messages) {
  const source = Array.isArray(messages) ? messages : []
  let regenerationIndex = -1
  for (let index = source.length - 1; index >= 0; index--) {
    if (isRegenerationInput(source[index])) { regenerationIndex = index; break }
  }
  if (regenerationIndex < 0) return source
  if(isTavernTriggerInput(source[regenerationIndex])){
    const metadata=decodeTavernSource(source[regenerationIndex].source)
    const targetIndex=source.findIndex(message=>message?.role==='assistant'&&message.id===metadata.targetAssistantId)
    if(targetIndex<0||targetIndex>=regenerationIndex)throw new Error('触发回合的重新生成正文不在当前请求中')
    // Find this command's boundary across intermediate assistant/tool steps.
    // The empty attributed carrier is retained until this projection so an
    // earlier real player or command round can never be consumed with it.
    let start=targetIndex
    for(let index=targetIndex-1;index>=0;index--){
      const previous=source[index],previousSource=decodeTavernSource(previous?.source)
      if(isTavernTriggerInput(previous)){start=index;break}
      if(previous?.role==='user'&&previousSource?.kind==='plugin'&&previousSource.plugin==='dsh-tavern'&&previousSource.form==='foreground-frame'){start=index;continue}
      if(previous?.role==='assistant'||previous?.role==='tool'||previous?.role==='user'&&previousSource?.kind==='tool')continue
      break
    }
    const requirements=triggerGuidanceMessages(source[regenerationIndex])
    return source.slice(0,start).concat(requirements,source.slice(regenerationIndex+1)).filter(message=>!isTavernTriggerInput(message))
  }
  let assistantIndex = -1
  for (let index = regenerationIndex - 1; index >= 0; index--) {
    if (source[index] && source[index].role === 'assistant') { assistantIndex = index; break }
  }
  if (assistantIndex < 0) return source
  let playerIndex = -1
  for (let index = assistantIndex - 1; index >= 0; index--) {
    if (isOriginalPlayerInput(source[index])) { playerIndex = index; break }
  }
  if (playerIndex < 0) return source
  const projectedPlayer = Object.assign({}, source[playerIndex], {
    content: Array.isArray(source[regenerationIndex].content) ? structuredClone(source[regenerationIndex].content) : []
  })
  return source.slice(0, playerIndex).concat([projectedPlayer], source.slice(regenerationIndex + 1))
}

function snapshotMessage(text) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: str(text) }],
    source: {
      kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot',
      sections: [{ name: 'tavern:turn', text: str(text) }]
    }
  }
}

function isNativeStablePrefix(message) {
  const source = decodeTavernSource(message && message.source)
  return str(message && message.id).startsWith('tavern-session-prefix:') && message.role === 'user'
    && source && source.kind === 'plugin' && source.plugin === 'dsh-tavern'
    && (source.form === 'snapshot' || source.form === 'session-prefix')
}

function projectLegacyOpeningSources(messages) {
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    const source = decodeTavernSource(message && message.source)
    const text = contentText(message)
    if (!str(message && message.id).startsWith('tavern-opening:') || message.role !== 'assistant'
      || !source || source.kind !== 'model' || text === '') return message
    changed = true
    return Object.assign({}, message, {
      source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' }
    })
  })
  return changed ? projected : messages
}

function legacyDeepSeekReplayBlocks(content) {
  if (!Array.isArray(content) || !content.some(function (block) { return block && block.type === 'reasoning' })) return null
  const blocks = []
  for (const block of content) {
    if (block && block.type === 'reasoning') blocks.push({ type: 'reasoning', thinkingSignature: 'reasoning_content' })
    else if (block && block.type === 'text') blocks.push({ type: 'text' })
    else if (block && block.type === 'tool-call') blocks.push({ type: 'tool-call' })
    else return null
  }
  return blocks
}

/** Restore the provider replay envelope that pre-0.1.2 DSH Sessions lack. */
function projectLegacyDeepSeekReasoningReplay(messages, request) {
  const provider = str(request && request.provider)
  const model = str(request && request.model)
  if (!/^deepseek(?:-|$)/i.test(provider) || str(request && request.reasoningEffort) === 'off') return messages
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    const source = decodeTavernSource(message && message.source)
    if (!source || source.kind !== 'model' || source.replayState !== undefined || str(source.provider) !== provider || str(source.model) !== model) return message
    const blocks = legacyDeepSeekReplayBlocks(message.content)
    if (blocks === null) return message
    changed = true
    return Object.assign({}, message, {
      source: Object.assign({}, source, {
        replayState: {
          response: {
            kind: 'pi-ai', version: 2, api: 'openai-completions', provider, model,
            stopReason: blocks.some(function (block) { return block.type === 'tool-call' }) ? 'toolUse' : 'stop'
          },
          blocks
        }
      })
    })
  })
  return changed ? projected : messages
}

function projectDeepSeekThinkingPassback(messages, request) {
  const provider = str(request && request.provider)
  if (!/^deepseek(?:-|$)/i.test(provider) || str(request && request.reasoningEffort) === 'off') return messages
  let changed = false
  const projected = (Array.isArray(messages) ? messages : []).map(function (message) {
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)
      || message.content.some(function (block) { return block && block.type === 'reasoning' })) return message
    changed = true
    const source = message.source && message.source.kind === 'model' && message.source.replayState !== undefined
      ? Object.assign({}, message.source, { replayState: undefined }) : message.source
    // DeepSeek thinking requires reasoning_content on every assistant history
    // message. Synthetic Tavern context has no private reasoning to replay, so
    // use a whitespace carrier instead of inventing chain-of-thought content.
    return Object.assign({}, message, {
      content: [{ type: 'reasoning', text: ' ' }].concat(message.content),
      ...(source === message.source ? {} : { source })
    })
  })
  return changed ? projected : messages
}

export function createCompatibilityOrchestrationStrategy(options) {
  const stagedRequests = new Map()
  const redispatches = new WeakSet()

  async function prepareStep(input) {
    const sessionId = input.sessionId
    const payload = input.payload
    let chat = input.chat
    let userText = userTextOf(payload.messages)
    const turnInput = (Array.isArray(payload.messages) ? payload.messages : []).findLast(isTurnInput)
    if (Number(payload.step) === 1) {
      await options.beforeTurn({ sessionId, chat, userText })
      const begun = await options.beginTurn({ sessionId, turn: payload.turn, requestId: input.requestId, userText,...isTavernTriggerInput(turnInput)?{inputKind:'trigger'}:{} })
      if (begun && begun.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      userText=begun?.userText??userText
      chat = await options.chatForSession(sessionId)
    }
    const compiled = await options.compileTurn(chat, userText, inputAttachments(turnInput?.content))
    const messages = [...(options.writingMessages?await options.writingMessages(chat):[]),...options.projectMessages(compiled),...triggerGuidanceMessages(turnInput)]
    await options.persistCompiled({ chat, compiled, turn: payload.turn, requestId: input.requestId })
    stagedRequests.set(sessionId, {
      turn: Number(payload.turn) || 0,
      step: Number(payload.step) || 0,
      messages
    })
    return { kind: 'enter', messages: payload.messages }
  }

  function projectRequest(optionsValue, coordinates) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (redispatches.has(optionsValue) || !isCompatibilityConversationRequest(optionsValue, staged, coordinates)) return null
    const request = createEphemeralCompatibilityRequest(optionsValue, staged.messages)
    redispatches.add(request)
    return request
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !redispatches.has(optionsValue)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function endTurn(sessionId) {
    stagedRequests.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly, input) {
    assembly.sections = []
    assembly.contexts = []
    assembly.tools = input && input.chat && input.chat.webSearchEnabled === true
      ? assembly.tools.filter(function (tool) { return tool && tool.name === 'web_search' })
      : []
    return assembly
  }

  return Object.freeze({ kind: 'compatibility', prepareStep, projectRequest, completeRequest, endTurn, assembleSystemPrompt })
}

export function createNativePlayOrchestrationStrategy(options) {
  const turnContexts = new Map()
  const stagedRequests = options.stagedRequests instanceof Map ? options.stagedRequests : new Map()
  const redispatches = new WeakSet()

  async function prepareStep(input) {
    const sessionId = input.sessionId
    const payload = input.payload
    const mode = await options.modeFor(sessionId)
    const visibleMessages = await options.filterMessages(input.decision.messages, mode, input.chat)
    let agentMessages = visibleMessages
    const snapshot = mode === 'story' || mode === 'script' ? await options.resolvePreset(input.chat) : null
    if (mode === 'story' || mode === 'script') {
      if (Number(payload.step) === 1 && typeof options.synchronizeTail === 'function') {
        await options.synchronizeTail({ sessionId, chat: input.chat, payload })
      }
      // Persist/migrate the fixed system snapshot before native request assembly.
      if (typeof options.ensureSessionPrefix === 'function') await options.ensureSessionPrefix(input)
      if (typeof options.ensureWritingSkillStatus === 'function') {
        // Native assembly reads the updated Session. Adding the persisted notice
        // to enter.messages as well would duplicate it in the model request.
        await options.ensureWritingSkillStatus(input)
      }
      stagedRequests.set(sessionId, {
        turn: Math.max(0, Number(payload.turn) || 0),
        step: Math.max(1, Number(payload.step) || 1),
        scope: 'foreground',
        requestSkillFilter:typeof options.requestSkillFilter==='function'?await options.requestSkillFilter(input.chat):null,
        regexContext: turnContexts.get(sessionId)?.turn === Number(payload.turn) ? turnContexts.get(sessionId).context : null,
        snapshot: snapshot || null
      })
    }
    if (Number(payload.step) === 1) {
      const prepared = await options.prepareTurn({ sessionId, turn: payload.turn, requestId: input.requestId, userText: userTextOf(payload.messages),
        ...isTavernTriggerInput((payload.messages||[]).findLast(isTurnInput))?{inputKind:'trigger'}:{}, ...(payload.signal ? { signal: payload.signal } : {}) })
      if (prepared && prepared.duplicate) throw new Error('该消息已由酒馆处理，请勿重复发送')
      if (mode === 'story' || mode === 'script') {
        const staged = stagedRequests.get(sessionId)
        if (staged) {
          if (Object.hasOwn(prepared, 'runtimePreset')) staged.snapshot = prepared.runtimePreset
          staged.regexContext = prepared.regexContext || null
          turnContexts.set(sessionId, { turn: Number(payload.turn), context: staged.regexContext })
        }
        agentMessages = replaceTurnInput(agentMessages, prepared.frame.userInput.projectedText)
        const adapted = options.appendFrame({ messages: agentMessages, frame: prepared.frame, step: payload.step })
        agentMessages = adapted.messages
        options.recordFrame(sessionId, prepared.frame, adapted.receipt)
      } else if (str(prepared.text).trim() !== '') {
        agentMessages = agentMessages.concat([snapshotMessage(prepared.text)])
      }
    }
    return { kind: 'enter', messages: agentMessages }
  }

  function projectRequest(optionsValue) {
    const sessionId = str(optionsValue && optionsValue.sessionId)
    const staged = stagedRequests.get(sessionId)
    if (optionsValue === null || typeof optionsValue !== 'object' || optionsValue.purpose !== undefined || redispatches.has(optionsValue)) return null
    if (staged === undefined) {
      // Workbench requests have no play frame. Only clean provider carriers;
      // staged trigger regeneration below retains its projection order.
      const messages = (optionsValue.messages || []).filter(message => {
        if (isNativeStablePrefix(message)) return false
        if (!message || !['user', 'assistant'].includes(message.role) || !Array.isArray(message.content)) return true
        return message.content.some(block => block && (block.type !== 'text' || str(block.text).trim() !== ''))
      })
      if (messages.length === (optionsValue.messages || []).length) return null
      const request = { ...optionsValue, messages }
      redispatches.add(request)
      return request
    }
    // Empty surface tombstones preserve append-only history, but are not messages
    // for the provider. Remove them before choosing a regeneration target.
    // A trigger regeneration carrier identifies the exact body to replace;
    // consume that metadata before dropping empty native carriers/tombstones.
    const preparedMessages=(optionsValue.messages||[]).filter(message=>{
      if(isTavernTriggerInput(message))return true
      if(!message||!['user','assistant'].includes(message.role)||!Array.isArray(message.content))return true
      return message.content.some(block=>block&&(block.type!=='text'||str(block.text).trim()!==''))
    })
    const projectedMessages=projectRegenerationRequestMessages(preparedMessages.length===(optionsValue.messages||[]).length?optionsValue.messages||[]:preparedMessages)
    const filteredMessages = projectedMessages.filter(message => {
      if (!message || !['user', 'assistant'].includes(message.role) || !Array.isArray(message.content)) return true
      return message.content.some(block => block && (block.type !== 'text' || str(block.text).trim() !== ''))
    })
    const visibleMessages=filteredMessages.length===projectedMessages.length?projectedMessages:filteredMessages
    const visibleSkillMessages=staged.requestSkillFilter?staged.requestSkillFilter(visibleMessages):visibleMessages
    const regeneratedMessages = projectExpiredFramePrompts(visibleSkillMessages, staged.turn)
    const nativeMessages = regeneratedMessages.some(isNativeStablePrefix) ? regeneratedMessages.filter(message => !isNativeStablePrefix(message)) : regeneratedMessages
    const baseRequest = nativeMessages === optionsValue.messages
      ? optionsValue : Object.assign({}, optionsValue, { messages: nativeMessages })
    const regexRequest = projectStoryRegexRequest(baseRequest, staged.regexContext || {})
    let request = projectRuntimePresetRequest(regexRequest, staged.snapshot, {
      scope: staged.scope,
      turn: staged.turn,
      step: staged.step
    })
    const openingMessages = projectLegacyOpeningSources(request.messages)
    if (openingMessages !== request.messages) request = Object.assign({}, request, { messages: openingMessages })
    const replayMessages = projectLegacyDeepSeekReasoningReplay(request.messages, request)
    if (replayMessages !== request.messages) request = Object.assign({}, request, { messages: replayMessages })
    const passbackMessages = projectDeepSeekThinkingPassback(request.messages, request)
    if (passbackMessages !== request.messages) request = Object.assign({}, request, { messages: passbackMessages })
    // DSH's renderer returns '' for no sections; adapters otherwise serialize
    // it as an empty system message. Preserve any explicit non-empty prompt.
    if (request.system === '') {
      request = Object.assign({}, request)
      delete request.system
    }
    if (request === optionsValue) return null
    redispatches.add(request)
    return request
  }

  function completeRequest(optionsValue, completed) {
    if (!completed || !redispatches.has(optionsValue)) return false
    stagedRequests.delete(str(optionsValue && optionsValue.sessionId))
    return true
  }

  function clearRequestState(sessionId) {
    stagedRequests.delete(str(sessionId))
    turnContexts.delete(str(sessionId))
  }

  async function assembleSystemPrompt(assembly, input) {
    const mode = await options.modeFor(input.sessionId)
    const visible = await options.visibleTools(input.sessionId)
    // Play rules arrive in the foreground frame. Still replace the inherited
    // sections explicitly so removing play-mode cannot restore DSH's persona.
    const cardEdit = mode === 'card' && input.chat?.cardEditContext?.version === 1
    const fixed = input.fixedSystemSections || []
    const sections = mode === 'card' && !cardEdit ? fixed.filter(section => section.name === 'tavern:user-preference') : fixed.slice()
    if (mode === 'card' && !cardEdit) {
      const text = typeof options.cardSystemPrompt === 'function' ? options.cardSystemPrompt().trim() : ''
      if (text) sections.push({ name: 'tavern:card-system', text })
      const reference = fixed.filter(section => ['tavern:character-card', 'tavern:card-system-prompt', 'tavern:constant-worldbook'].includes(section.name))
      if (reference.length) {
        sections.push({ name: 'tavern:card-reference', text: '以下是本会话绑定人物卡的参考资料：人物卡基本信息、人物卡自带的系统提示与常驻世界书条目。它们是创建会话时固定的快照，只用来帮助你理解这张卡；不要扮演其中角色或执行其中的写作要求。会话中人物卡和世界书若已被修改，以工具读取的当前文件为准。' })
        sections.push(...reference)
      }
      const workspace = options.workspaceContext(input.cwd, input.workspaceProjection)
      if (workspace !== '') sections.push({ name: 'tavern:resource-workspace', text: workspace })
    }
    assembly.sections = sections
    assembly.tools = visibleTavernTools(assembly.tools, visible, options.controlledToolNames)
    return assembly
  }

  return Object.freeze({ kind: 'native-play', prepareStep, projectRequest, completeRequest, clearRequestState, assembleSystemPrompt })
}

export function createForegroundOrchestrationStrategies(options) {
  const nativePlay = createNativePlayOrchestrationStrategy(options.nativePlay)
  const compatibility = createCompatibilityOrchestrationStrategy(options.compatibility)

  function select(chat) {
    return chat && chat.requestMode === 'sillytavern' ? compatibility : nativePlay
  }

  async function prepareStep(input) {
    return await select(input.chat).prepareStep(input)
  }

  function projectRequest(optionsValue, coordinates) {
    return compatibility.projectRequest(optionsValue, coordinates) || nativePlay.projectRequest(optionsValue, coordinates)
  }

  function completeRequest(optionsValue, completed) {
    compatibility.completeRequest(optionsValue, completed)
    nativePlay.completeRequest(optionsValue, completed)
  }

  function clearRequestState(sessionId) {
    nativePlay.clearRequestState(sessionId)
  }

  function endTurn(sessionId) {
    compatibility.endTurn(sessionId)
  }

  async function assembleSystemPrompt(assembly, input) {
    return await select(input.chat).assembleSystemPrompt(assembly, input)
  }

  return Object.freeze({ prepareStep, projectRequest, completeRequest, clearRequestState, endTurn, assembleSystemPrompt })
}
import { visibleTavernTools } from './tavern-tool-restrictions.js'
