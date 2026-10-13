import { parseOpeningCommand } from './opening-command.js'
import createTavernSlashSyntax from '../../src/client/modules/slash-syntax.cjs'
import { assertScriptPromptBudget } from './tavern-script-prompts.js'
import { resolveDisplayIdentityMacros } from './reply-presentation.js'
import { projectTavernHelperScripts } from './tavern-helper-scripts.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { projectTavernHelperContext, replaceTavernHelperVariables, replaceTavernHelperMessages } from './tavern-helper-context.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { selectMvuRuntime } from './mvu-runtime-selection.js'
import { randomUUID } from 'node:crypto'
import { cardOpeningChoices } from './card-openings.js'
import { inspectWorldBookDocument, updateWorldBookDocument, exportSillyTavernWorldBook } from './worldbook-resource.js'
import { projectTavernHelperWorldbook, replaceTavernHelperWorldbookOperations } from './tavern-helper-worldbook.js'

const copy = value => structuredClone(value)

/** Private pre-game host state. No Session or shared resource is written here. */
export function createOpeningPreparation({ readCard, worldBooks, templateRuntime, generateRaw, readRuntimeExtensions, promptLimits,fullTemplateEnabled = async () => false,lightTemplateEnabled, now = Date.now }) {
  const drafts = new Map()
  let creating = 0
  const lifetime = 2 * 60 * 60 * 1000
  let expiryTimer = null, disposed = false
  function sweep() {
    expiryTimer = null
    for (const [id, draft] of drafts) if (!draft.inUse && now()-draft.touchedAt>=lifetime) drafts.delete(id)
    if (disposed || !drafts.size) return
    const delay = Math.max(1000, Math.min(...[...drafts.values()].map(draft=>draft.inUse?lifetime:lifetime-(now()-draft.touchedAt))))
    expiryTimer = setTimeout(sweep, delay)
    expiryTimer.unref?.()
  }
  function requireDraft(id) {
    const draft = drafts.get(id)
    if (!draft || now() - draft.touchedAt > lifetime) {
      drafts.delete(id)
      throw new Error('开局准备已过期，请重新打开人物卡')
    }
    draft.touchedAt = now()
    return draft
  }
  function runtimeContext(draft) {
    return { ...projectTavernHelperContext(draft.chat), worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null,
      characterName: draft.card.name, playerName: draft.userName, character: copy(draft.card),
      globalVariables: { ...copy(draft.globalVariables || {}), ...(draft.mvuSelection ? { extra_analysis: draft.mvuExtraAnalysis === true } : {}) }, characterVariables: copy(draft.characterVariables || {}),
      scriptMetadata: copy(draft.chat.tavernScriptMetadata || {}), extensionSettings: copy(draft.extensionSettings), regexScripts: { global: [], character: [] } }
  }
  function present(draft) {
    const selection = draft.mvuSelection
    const core = selection?.owner === 'official' ? [{ id: '__dsh_official_mvu__', name: 'MVU', system: 'official-mvu', assetUrl: OFFICIAL_MVU_VERSION.assetUrl, mvuVersionSelection: selection }]
      : selection?.status === 'incompatible' ? [{ id: selection.scriptId || '__dsh_card_mvu_blocked__', name: '人物卡 MVU', system: 'card-mvu', mvuVersionSelection: selection, content: 'throw new Error(' + JSON.stringify(selection.message) + ');' }] : []
    const scripts = (draft.helperScripts || []).map(script => script.system === 'card-mvu' ? {...script,mvuVersionSelection:selection} : script)
    scripts.sort((a,b) => Number(b.system === 'card-mvu') - Number(a.system === 'card-mvu'))
    return copy({ id: draft.id, cardPath: draft.cardPath, openings: draft.openings,
      openingId: draft.openingId || draft.openings[0]?.id, diagnostics: copy(draft.diagnostics || []),
      runtime: draft.runtimeEnabled ? { context: runtimeContext(draft), mvuVersionSelection: selection, scripts: core.concat(scripts) } : null,
      worldbook: draft.document ? projectTavernHelperWorldbook(inspectWorldBookDocument(draft.document)) : null })
  }
  return {
    async create(cardPath, settings = {}) {
      if (disposed) throw new Error('开局准备服务已关闭')
      if (creating >= 8) throw new Error('正在创建的准备页过多，请稍后重试')
      creating++
      try {
      for (const [id, draft] of drafts) if (!draft.inUse && now() - draft.touchedAt > lifetime) drafts.delete(id)
      const card = settings.card || await readCard(cardPath)
      if (!card) throw new Error('人物卡不存在')
      const record = await (worldBooks.boundCard||worldBooks.bound)(cardPath, card, settings.sourceChat)
      const draft = { id: randomUUID(), cardPath, openings: cardOpeningChoices(card),
        document: record ? copy(record.view.raw) : null, mergedSources:copy(record?.mergedSources||[]), source: record ? copy(record.source) : null, touchedAt: now() }
      draft.sourceSessionId = settings.sourceChat?.sessionId || ''
      draft.sourceLifecycleRevision = Number(settings.sourceChat?.tavernHelperLifecycleRevision) || 0
      draft.card = copy(card)
      draft.userName = settings.userName || '你'
      const swipes = draft.openings.map(opening => opening.text)
      draft.chat = { id: draft.id, cardPath, mode: 'story', mvu: { enabled: settings.runtime === true }, _storageRevision: 0,
        variables: {}, messages: [{ role: 'assistant', text: swipes[0], sourceText: swipes[0], greeting: true, turn: 1, swipeId: 0, swipes, variables: swipes.map(() => ({})) }] }
      const extensions = settings.extensions || (readRuntimeExtensions ? await readRuntimeExtensions(cardPath) : {})
      const projected = projectTavernHelperScripts(extensions.helperScripts)
      draft.mvuSelection = selectMvuRuntime(extensions.helperScripts, { enabled: settings.runtime === true || projected.scripts.some(script => script.system === 'card-mvu') })
      draft.helperScripts = projected.scripts
      draft.diagnostics = projected.diagnostics.concat(extensions.diagnostics || [])
      draft.runtimeEnabled = projected.scripts.length > 0 || Boolean(draft.mvuSelection)
      draft.extensionSettings = {}
      const templateInputs={card,worldbook:record}
      if (settings.runtime === true && templateRuntime && (lightTemplateEnabled?await lightTemplateEnabled(draft.chat,templateInputs):!await fullTemplateEnabled(draft.chat,templateInputs))) {
        const runtime = await templateRuntime()
        const initialized = runtime.initializeVariables(record?.view.entries || [], { charName: card.name, userName: draft.userName })
        if (initialized.diagnostics.length) throw new Error('开场模板初始变量解析失败：' + initialized.diagnostics.map(item => item.code).join('、'))
        draft.chat.variables = copy(initialized.initial)
        draft.extensionSettings.EjsTemplate = { enabled: true }
        draft.runtimeEnabled = true
      }
      if (drafts.size >= 64) {
        const oldest = [...drafts.values()].filter(item => !item.inUse).sort((a,b)=>a.touchedAt-b.touchedAt)[0]
        if (!oldest) throw new Error('所有准备页正在开局，请稍后重试')
        drafts.delete(oldest.id)
      }
      if (disposed) throw new Error('开局准备服务已关闭')
      drafts.set(draft.id, draft)
      if (!expiryTimer) sweep()
      return present(draft)
      } finally { creating-- }
    },
    release(id) {
      const draft = drafts.get(id)
      if (draft?.inUse) { draft.releaseRequested = true; return { released:false } }
      const released=drafts.delete(id)
      if(!drafts.size){clearTimeout(expiryTimer);expiryTimer=null}
      return { released }
    },
    acquire(id) {
      const draft = requireDraft(id)
      if (draft.inUse) throw new Error('当前准备页正在开局，请等待完成')
      draft.inUse = true
      let finished = false
      return consume => {
        if (finished) return
        finished = true; draft.inUse = false
        if (consume || draft.releaseRequested) drafts.delete(id)
        if(!drafts.size){clearTimeout(expiryTimer);expiryTimer=null}
      }
    },
    get retainedDrafts() { return drafts.size },
    dispose() { disposed = true; clearTimeout(expiryTimer); expiryTimer = null; drafts.clear() },
    get(id) { return present(requireDraft(id)) },
    async callRuntime(id, method, args = {}, openingId = '') {
      const draft = requireDraft(id)
      if (method === 'prepareOpeningCommand' || method === 'triggerTavernSlash') {
        if (draft.inUse) throw new Error('当前准备页正在开局，请等待完成')
        const line = String(args.line || '').trim(), syntax = createTavernSlashSyntax()
        const parts = syntax.segments(line), head = syntax.parse(parts[0])
        if (method === 'triggerTavernSlash' && parts.length === 1 && ['pass', 'echo'].includes(head.name) && !Object.keys(head.named).length) {
          return { pipe: resolveDisplayIdentityMacros(head.text, { macroState: { userName: draft.userName }, charName: draft.card.name }) }
        }
        const command = parseOpeningCommand(line)
        if (!openingId || !draft.openings.some(opening => opening.id === openingId)) throw new Error('人物卡开场白不存在')
        if (command.systemText) assertScriptPromptBudget([{ id: '__dsh_opening__:system', content: command.systemText }], promptLimits)
        // Validate everything before altering selection or storing this private command.
        draft.startCommand = { openingId, command: copy(command) }
        draft.openingId = openingId
        draft.chat.messages[0].swipeId = draft.openings.findIndex(opening => opening.id === openingId)
        return { startCommand: copy(command), pipe: '' }
      }
      // The host names the opening whose preview frame is calling: the player is looking at
      // it, so "the message" means that opening's slot, as after a script-driven swipe (Z92).
      const viewed = openingId ? draft.openings.findIndex(opening => opening.id === openingId) : -1
      if (viewed >= 0) {
        draft.openingId = openingId
        if (draft.chat.messages[0]) draft.chat.messages[0].swipeId = viewed
      }
      if (method === 'generateTavernHelperRaw') {
        if (!generateRaw) throw new Error('独立生成服务尚未就绪')
        return { text: await generateRaw(args.config, { sessionId: draft.sourceSessionId,
          history: projectTavernHelperContext(draft.chat).messages.map(message => ({ role: message.role, text: message.message })) }) }
      }
      if (!draft.runtimeEnabled) throw new Error('准备页脚本运行时未初始化')
      if (method === 'loadTavernWorldInfo') return { worldInfo: exportSillyTavernWorldBook(draft.document) }
      if (method === 'getTavernHelperWorldbook') return { worldbook: present(draft).worldbook }
      if (method === 'replaceTavernHelperWorldbook') {
        const result = await this.replaceWorldbook(id, args.entries, args.expectedEntries)
        return { updated: true, worldbook: result.worldbook }
      }
      if (method === 'editTavernRuntimeScripts') {
        const scriptId = args.scriptId, command = args.command || {}
        if (!(scriptId === '__dsh_official_mvu__' && draft.chat.mvu.enabled) && !draft.helperScripts.some(script => script.id === scriptId)) throw new Error('脚本不存在或已经停用')
        if (command.kind !== 'metadata') throw new Error('开局准备只能设置脚本按钮和说明；请在扩展程序中管理脚本库')
        const value = { ...(draft.chat.tavernScriptMetadata?.[scriptId] || {}) }
        if (command.info !== undefined) value.info = String(command.info)
        if (command.buttons !== undefined) {
          if (!Array.isArray(command.buttons) || command.buttons.some(button => typeof button?.name !== 'string')) throw new Error('按钮格式无效')
          value.buttons = copy(command.buttons)
        }
        draft.chat.tavernScriptMetadata = { ...draft.chat.tavernScriptMetadata, [scriptId]: value }
      } else if (method === 'updateTavernHelperPrompts') {
        mutateScriptPrompts(draft.chat, args.operation,promptLimits)
      } else if (method === 'setTavernMvuActivity') {
        const coreId = draft.mvuSelection?.owner === 'official' ? '__dsh_official_mvu__' : draft.mvuSelection?.scriptId
        if (draft.mvuSelection?.status !== 'selected' || args.scriptId !== coreId || typeof args.value !== 'boolean') throw new Error('只有本草稿选定的 MVU 可以发布额外解析状态')
        draft.mvuExtraAnalysis = args.value
        return { updated: true, mvuExtraAnalysis: args.value, context: runtimeContext(draft) }
      } else if (method === 'updateTavernHelperVariables') {
        const type = args.option?.type
        if (type === 'global') draft.globalVariables = copy(args.variables)
        else if (type === 'character') draft.characterVariables = copy(args.variables)
        else replaceTavernHelperVariables(draft.chat, args)
      } else if (method === 'updateTavernHelperMessages') {
        // The variable framework may write data, but cannot invent a story floor.
        for (const patch of args.messages || []) {
          if (Number(patch.message_id) !== 0 || Object.keys(patch).some(key => !['message_id', 'data', 'swipes_data'].includes(key))) throw new Error('准备阶段变量运行时只能更新开场变量')
        }
        replaceTavernHelperMessages(draft.chat, args.messages)
      } else if (method === 'saveTavernExtensionSettings') {
        if (JSON.stringify(draft.extensionSettings) !== JSON.stringify(args.expectedSettings)) throw new Error('设置已变化，请重新读取')
        draft.extensionSettings = copy(args.settings)
        draft.chat._storageRevision++
        return { updated: true, extensionSettings: copy(draft.extensionSettings), context: runtimeContext(draft) }
      } else if (method === 'recordMvuRuntimeDiagnostic' || method === 'recordMvuLoadDiagnostic') {
        draft.diagnostics = (draft.diagnostics || []).concat(copy(args.diagnostic || {})).slice(-50)
        return { recorded: true }
      } else throw new Error('准备阶段暂不支持此宿主操作：' + method)
      draft.chat._storageRevision++
      return { updated: true, context: runtimeContext(draft) }
    },
    select(id, openingId) {
      const draft = requireDraft(id)
      const index = draft.openings.findIndex(opening => opening.id === openingId)
      if (index < 0) throw new Error('人物卡开场白不存在')
      draft.openingId = openingId
      // Script writes to "the message" after a switch land in the chosen slot. (upstream 2b1c897d)
      if (draft.chat.messages[0]) draft.chat.messages[0].swipeId = index
      return { saved: true, openingId }
    },
    async replaceWorldbook(id, entries, expectedEntries) {
      const draft = requireDraft(id)
      if (!draft.document) throw new Error('当前人物卡没有绑定世界书')
      const view = inspectWorldBookDocument(draft.document)
      if (JSON.stringify(projectTavernHelperWorldbook(view).entries) !== JSON.stringify(expectedEntries)) {
        throw new Error('世界书已被其他操作修改，请重新读取后重试')
      }
      const operations = replaceTavernHelperWorldbookOperations(view, entries)
      draft.document = updateWorldBookDocument(draft.document, { operations }).document
      return present(draft)
    },
    resolve(id, cardPath, openingId) {
      const draft = requireDraft(id)
      if (draft.cardPath !== cardPath) throw new Error('开局草稿与人物卡不匹配')
      const selected = openingId || draft.openingId || draft.openings[0]?.id || ''
      const selectedIndex = draft.openings.findIndex(opening => opening.id === selected)
      if ((selected || draft.openings.length) && selectedIndex < 0) throw new Error('人物卡开场白不存在')
      return copy({ startCommand: draft.startCommand?.openingId === selected ? draft.startCommand.command : undefined, openingVariables: Object.fromEntries(draft.openings.map((opening, index) => [opening.id, draft.chat.messages[0]?.variables?.[index] || {}])), variables: draft.chat.variables || {}, messageVariables: draft.chat.messages[0]?.variables?.[selectedIndex < 0 ? draft.chat.messages[0]?.swipeId || 0 : selectedIndex] || {}, openingId: selected, sourceSessionId: draft.sourceSessionId, sourceLifecycleRevision: draft.sourceLifecycleRevision, worldbookSnapshot: { version: 1, source: draft.source, document: draft.document, mergedSources:draft.mergedSources } })
    }
  }
}
