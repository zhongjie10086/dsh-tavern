import createTavernSlashSyntax from '../../src/client/modules/slash-syntax.cjs'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { resolveDisplayIdentityMacros } from './reply-presentation.js'

const syntax = createTavernSlashSyntax()
const systemPromptId = '__dsh_opening__:system'

// The visible preparation floor retains MVU state, while its owned prompt is
// the only provider input. Ordinary system history has no such host marker.
export function openingCommandHistory(messages) {
  return (messages || []).filter(message => !(message?.role === 'system' && message.tavernOpeningCommand?.version === 1 && message.tavernOpeningCommand.kind === 'system'))
}

export function openingCommandPrompt(chat) {
  const prompt = (chat.tavernScriptPrompts || []).find(prompt => prompt.id === systemPromptId && prompt.once === true)
  return prompt ? structuredClone(prompt) : null
}

export function consumeOpeningCommandPrompt(chat, expected, request = {}) {
  if (expected?.id !== systemPromptId || expected.once !== true) return
  if (!(chat.tavernScriptPrompts || []).some(prompt => JSON.stringify(prompt) === JSON.stringify(expected))) return
  chat.tavernScriptPrompts = (chat.tavernScriptPrompts || []).filter(prompt => JSON.stringify(prompt) !== JSON.stringify(expected))
  if (Number(request.turn) > 0 && request.requestId) chat.openingCommandPending = {
    turn: Number(request.turn), requestId: String(request.requestId),
    lifecycleRevision: Number(chat.tavernHelperLifecycleRevision || 0), prompt: structuredClone(expected)
  }
  return true
}

// Reuse the foreground's durable failure/commit boundary. Only the exact owned
// opening prompt is recoverable; unrelated script-once prompts keep their rules.
export function settleOpeningCommandPrompt(chat, request, failed = false) {
  const pending = chat.openingCommandPending
  if (!pending || pending.turn !== Number(request.turn) || (request.requestId && pending.requestId !== String(request.requestId))) return false
  if (pending.lifecycleRevision !== Number(chat.tavernHelperLifecycleRevision || 0)) return false
  const committed = Object.values(chat.nativeCommits || {}).some(commit => Number(commit.turn) >= pending.turn)
  const current = (chat.tavernScriptPrompts || []).find(prompt => prompt.id === systemPromptId)
  if (failed && !committed && (!current || JSON.stringify(current) === JSON.stringify(pending.prompt))) {
    if (!current) chat.tavernScriptPrompts = [...(chat.tavernScriptPrompts || []), structuredClone(pending.prompt)]
    // Keep attribution until a new explicit retry consumes it or this same
    // staged request succeeds after an internal provider retry.
    return true
  }
  if (!failed || committed) consumeOpeningCommandPrompt(chat, pending.prompt)
  delete chat.openingCommandPending
  return true
}

// Compile a narrow pre-game language. Never execute Slash against an existing session.
export function parseOpeningCommand(line) {
  const parts = syntax.segments(String(line || '').trim()).map(part => {
    if (!part.startsWith('/')) throw new Error('开局命令必须使用 / 命令')
    return syntax.parse(part)
  })
  const tail = parts.pop()
  if (tail?.name !== 'trigger') throw new Error('开局命令需要以 /trigger 结束')
  if (tail.hasText || Object.keys(tail.named).some(key => key !== 'await') ||
      (Object.hasOwn(tail.named, 'await') && !['true', 'false'].includes(tail.named.await))) throw new Error('/trigger 只接受 await=true 或 await=false')
  const trigger = { input: '', triggerOnly: true }
  if (!parts.length) return trigger
  const head = parts.shift()
  if (!['sys', 'send'].includes(head.name) || Object.keys(head.named).length || !head.text.trim()) throw new Error('开局命令只支持 /sys 或 /send 文本后接 /trigger')
  const cut = parts[0]
  const removeGreeting = parts.length === 1 && cut.name === 'cut' && !Object.keys(cut.named).length && cut.text === '0'
  if (parts.length && (!removeGreeting || head.name !== 'sys')) throw new Error('准备页只支持 /sys … | /cut 0 | /trigger；不能删除其他楼层或执行其他管道')
  return head.name === 'send' ? { input: head.text.trim(), triggerOnly: false }
    : { ...trigger, systemText: head.text.trim(), removeGreeting }
}

export function applyOpeningCommand(chat, command, variables, now, promptLimits) {
  if (!command?.systemText) return
  const text = resolveDisplayIdentityMacros(command.systemText, { macroState: chat.macroState, charName: chat.cardName })
  // Validate and prepare the owned once-prompt before changing any unpublished floors.
  const draft = { tavernScriptPrompts: structuredClone(chat.tavernScriptPrompts || []) }
  mutateScriptPrompts(draft, { kind: 'inject', once: true, prompts: [{ id: systemPromptId,
    content: text, role: 'system', position: 'in_chat', depth: 0 }] }, promptLimits)
  if (command.removeGreeting) {
    chat.messages = chat.messages.filter(message => !message.greeting)
    chat.openingText = ''
  }
  chat.messages.push({ role: 'system', text, sourceText: text, ts: now(), tavernOpeningCommand: { version: 1, kind: 'system' },
    swipeId: 0, swipes: [text], variables: [structuredClone(variables || {})] })
  chat.tavernScriptPrompts = draft.tavernScriptPrompts
  if (command.removeGreeting && chat.mvu?.enabled && variables?.stat_data !== undefined && variables?.schema !== undefined) {
    chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: now() }
  }
}
