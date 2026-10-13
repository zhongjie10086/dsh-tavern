import {cardMvuContextIdentity} from './card-mvu-work-identity.js'
import { resourceSaveSummary, observeResourceSave } from './resource-save-summary.js'
import { templateInputView, persistTemplateInputView } from './full-prompt-template-input.js'
import { projectFullPromptTemplateState, applyFullPromptTemplateState, validateFullPromptTemplateSave, fullPromptTemplateHistoryChanged, applyFullPromptTemplateHistoryState } from './full-prompt-template-state.js'
import { mutateScriptPrompts } from './tavern-script-prompts.js'
import { exportSillyTavernWorldBook, inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { isDeepStrictEqual } from 'node:util'
import {mergeConcurrentVariables} from './chat-persistence.js'
import { applyChatPluginData, validateChatPluginRequest, assertPluginJson } from './tavern-chat-plugin-data.js'
import {
  appendTavernHelperMessages, deleteTavernHelperMessages, rotateTavernHelperMessages,
  lastTavernHelperVariables,
  readTavernHelperVariables,
  projectTavernHelperContext,
  replaceTavernHelperMessages,
  replaceTavernHelperVariables
} from './tavern-helper-context.js'
import {
  projectTavernHelperWorldbook,
  mergeTavernHelperWorldbookEntries,
  replaceTavernHelperWorldbookOperations
} from './tavern-helper-worldbook.js'
import { createMvuSettlementEffect } from './mvu-settlement-effect.js'
import {projectScriptSettings,assertScriptSettings} from './card-permissions.js'
import {validateExtensionSettingsPatch} from './tavern-extension-settings.js'
import {randomUUID} from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOfficialMvuData(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.stat_data !== undefined && value.schema !== undefined
}

// Pinned upstream src/function/update/index.ts throttles MESSAGE_RECEIVED at
// 3000ms. Re-entering sooner returns the old Promise and schedules a late write.
const MVU_RETRY_AFTER_MS = 3100

/**
 * Translate the Tavern-shaped host API exposed to card scripts into mutations
 * of dsh-tavern's authoritative chat and worldbook state.
 */
export function createTavernScriptHostAdapter(options = {}) {
  const mutationTails = new Map()
  const settlementTransactions = new Map()

  function assertDependencies() {
    for (const name of ['resolveChat', 'writeChat', 'readCard', 'worldBooks', 'scriptDispatch']) {
      if (!options[name]) throw new Error('Tavern Script Host Adapter 缺少依赖: ' + name)
    }
  }
  assertDependencies()

  function runtimeGlobals(chat, variables) {
    const activity = options.scriptDispatch.mvuActivity?.(chat);
    return activity ? {...variables, ...(typeof activity.mvuExtraAnalysis === 'boolean' ? {extra_analysis:activity.mvuExtraAnalysis} : {})} : variables;
  }
  async function saveRuntimeGlobals(chat, variables, expectedVariables) {
    if (chat?.mvu?.enabled !== true) return options.globalVariables.save(variables,expectedVariables);
    const stored = await options.globalVariables.read();
    // Preserve the underlying global value for CAS; the read-only runtime overlay is never persisted.
    const strip = value => { if(value === undefined)return value;const result={...value};delete result.extra_analysis;if(Object.hasOwn(stored,'extra_analysis'))result.extra_analysis=stored.extra_analysis;return result; };
    return runtimeGlobals(chat,await options.globalVariables.save(strip(variables),strip(expectedVariables)));
  }

  function assertMvuEnabled(chat) {
    if (!chat || !chat.mvu || chat.mvu.enabled !== true) throw new Error('当前人物卡未启用 MVU 兼容运行时')
  }

  async function assertScriptEnabled(chat) {
    if (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat)) throw new Error('当前会话没有绑定游玩对话')
    if (chat?.mvu?.enabled === true) return
    if (typeof options.hasScripts !== 'function' || !await options.hasScripts(chat)) throw new Error('当前人物卡没有启用脚本运行时')
  }

  function mutationIsCurrent(chat, expectedLifecycleRevision) {
    if (chat?.tavernScriptMutationFence && (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null)) throw new Error('脚本写入缺少当前生命周期，旧执行器已过期')
    if (expectedLifecycleRevision === undefined || expectedLifecycleRevision === null) return true
    return Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0) === Math.max(0, Number(expectedLifecycleRevision) || 0)
  }

  function staleMutation(chat) {
    return { updated: false, stale: true, context: projectTavernHelperContext(chat) }
  }

  async function resolveChat(sessionId) {
    const recovered = options.history ? await options.history.recover(str(sessionId)) : undefined
    const chat = recovered || await options.resolveChat(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    return chat
  }

  function assertTransactionEvent(transaction, eventId) {
    if (transaction?.closed) throw new Error('MVU 结算事件已经结束，已拒绝迟到写入')
    if (transaction === undefined && str(eventId).startsWith('mvu:')) throw new Error('MVU 结算事件已经结束，已拒绝迟到写入')
    if (transaction !== undefined && transaction.eventId !== str(eventId)) {
      const error = new Error('脚本写入不属于当前 MVU 结算事件')
      error.code = 'MVU_SETTLEMENT_EVENT_MISMATCH'
      throw error
    }
  }

  async function mutationChat(sessionId, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    return transaction === undefined ? await resolveChat(sessionId) : transaction.draft
  }

  function transactionResult(sessionId, target, multiple = false, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction === undefined) return null
    transaction.mutations++
    return {
      updated: true,
      transactional: true,
      ...(multiple ? { targets: target } : { target }),
      context: projectTavernHelperContext(transaction.draft)
    }
  }

  async function updatePrompts(sessionId, operation, expectedLifecycleRevision, eventId) {
    return serializeWorldbook('script-prompts:' + sessionId, async function () {
      // Timer/UI work belongs to the live chat, not the MVU event's draft.
      // Only writes carrying its authenticated root event join the transaction.
      const transactionalEvent = str(eventId).startsWith('mvu:')
      const chat = transactionalEvent ? await mutationChat(sessionId, eventId) : await resolveChat(sessionId)
      await assertScriptEnabled(chat)
      if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
      if (!mutateScriptPrompts(chat, operation,options.promptLimits)) return { updated: false, context: projectTavernHelperContext(chat) }
      const transactional = transactionalEvent ? transactionResult(sessionId, { type: 'prompts' }, false, eventId) : null
      if (transactional !== null) return transactional
      await options.writeChat(chat, { source: 'tavern-helper.prompts' })
      return { updated: true, context: projectTavernHelperContext(chat) }
    })
  }

  async function updateVariables(sessionId, option, variables, expectedLifecycleRevision, eventId, expectedVariables, mutationMode) {
    const transactionalEvent = str(eventId).startsWith('mvu:')
    let chat = transactionalEvent ? await mutationChat(sessionId, eventId) : await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    if (!transactionalEvent && ['chat','message'].includes(option?.type)) {
      if (mutationMode !== undefined && !['patch','replace'].includes(mutationMode)) throw Error('变量更新方式无效')
      const desired = structuredClone(variables && typeof variables === 'object' ? variables : {})
      let target, savedVariables, stale
      const apply = async current => {
        await assertScriptEnabled(current)
        if (!mutationIsCurrent(current, expectedLifecycleRevision)) {stale=current;return current}
        const input = templateInputView(current), draft = input.input ? input.chat : current
        const latest = readTavernHelperVariables(draft, option)
        let next = desired
        if (expectedVariables !== undefined) {
          if (mutationMode === 'patch') {
            next = mergeConcurrentVariables(expectedVariables,latest,desired,current.id)
          } else if (!isDeepStrictEqual(latest, expectedVariables) && !isDeepStrictEqual(latest, desired)) {
            throw Object.assign(Error('变量已被其他脚本修改，请重新读取后再整体替换'), {code:'DSH_TAVERN_VARIABLE_CONFLICT'})
          }
        }
        target = replaceTavernHelperVariables(draft, {option,variables:next})
        savedVariables = readTavernHelperVariables(draft, option)
        return persistTemplateInputView(draft,input.input)
      }
      const saved = options.updateChat
        ? await options.updateChat(chat.id,apply,{source:'tavern-helper.variables'})
        : await serializeWorldbook('local-variables:'+sessionId,async()=>{const next=await apply(await resolveChat(sessionId));if(!stale)await options.writeChat(next,{source:'tavern-helper.variables'});return next})
      return stale ? staleMutation(stale) : {updated:true,target,variables:savedVariables,context:projectTavernHelperContext(templateInputView(saved).chat)}
    }
    if(option?.type==='preset'||option?.type==='extension') {
      if(transactionalEvent)throw new Error('MVU 结算事务不能修改共享变量')
      assertPluginJson(variables,'共享变量');if(!variables||typeof variables!=='object'||Array.isArray(variables))throw new Error('变量必须是对象')
      if(option.type==='preset'){if(!options.presetVariables)throw new Error('预设变量存储未连接');return {updated:true,target:{type:'preset'},presetVariables:await options.presetVariables.save(chat,variables,expectedVariables)}}
      if(!option.extension_id||typeof option.extension_id!=='string'||!options.fullExtensionSettings)throw new Error('扩展变量缺少有效的扩展 ID')
      const current=await options.fullExtensionSettings.read(),next=structuredClone(current);
      if(expectedVariables!==undefined&&!isDeepStrictEqual(expectedVariables,current[option.extension_id]||{})&&!isDeepStrictEqual(variables,current[option.extension_id]||{}))throw new Error('扩展变量已被其他窗口修改，请重新读取');
      Object.defineProperty(next,option.extension_id,{value:structuredClone(variables),enumerable:true,configurable:true,writable:true});const saved=await options.fullExtensionSettings.save(next,current)
      return {updated:true,target:{type:'extension'},extensionSettings:saved}
    }
    if (option && option.type === 'global') {
      if (!options.globalVariables || typeof options.globalVariables.save !== 'function') throw new Error('全局变量存储未连接')
      const transaction = transactionalEvent && settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的全局变量')
      const saved = await saveRuntimeGlobals(chat,variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {},expectedVariables)
      return { updated: true, target: { type: 'global' }, globalVariables: structuredClone(saved) }
    }
    if (option && option.type === 'character') {
      if (!options.characterVariables || typeof options.characterVariables.save !== 'function') throw new Error('人物卡变量存储未连接')
      const transaction = transactionalEvent && settlementTransactions.get(str(sessionId))
      if (transaction) throw new Error('MVU 结算事务不能修改跨对话的人物卡变量')
      const saved = await serializeWorldbook('card-variables:' + str(chat.cardPath), function () {
        return options.characterVariables.save(chat.cardPath, variables && typeof variables === 'object' && !Array.isArray(variables) ? variables : {}, str(sessionId))
      })
      return { updated: true, target: { type: 'character' }, characterVariables: structuredClone(saved) }
    }
    if(option?.type==='script'&&options.scriptVariables&&!transactionalEvent){
      const saved=await options.scriptVariables.save(chat,option.script_id,variables,expectedVariables)
      if(saved.handled)return {updated:true,target:{type:'script',scriptId:option.script_id},context:{...projectTavernHelperContext(templateInputView(saved.chat).chat),scriptVariables:saved.variables}}
    }
    if(option?.type==='script'&&transactionalEvent&&options.scriptVariables?.stage)variables=await options.scriptVariables.stage(chat,option.script_id,variables,expectedVariables)
    const inputView=transactionalEvent?null:templateInputView(chat)
    if(inputView?.input)chat=inputView.chat
    const updated = replaceTavernHelperVariables(chat, { option, variables })
    const transactional = transactionalEvent ? transactionResult(sessionId, updated, false, eventId) : null
    if (transactional !== null) {
      if(options.scriptVariables?.effective)transactional.context.scriptVariables=await options.scriptVariables.effective(chat)
      return transactional
    }
    const projected=projectTavernHelperContext(chat)
    try { await options.writeChat(persistTemplateInputView(chat,inputView?.input), { source: 'tavern-helper.variables' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, target: updated, context: projected }
  }

  async function updateMessages(sessionId, messages, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    const chat = transaction === undefined ? await resolveChat(sessionId) : transaction.draft
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    const inputView=transaction?null:templateInputView(chat)
    if(inputView?.input && Array.isArray(messages) && messages.length && messages.every(row=>row.message_id==='latest'||Number(row.message_id)===-1||Number(row.message_id)===inputView.input.floor)){
      const targets=replaceTavernHelperMessages(inputView.chat,messages),context=projectTavernHelperContext(inputView.chat)
      await options.writeChat(persistTemplateInputView(inputView.chat,inputView.input),{source:'tavern-helper.input'})
      return {updated:true,targets,context}
    }
    if(!transaction && options.history && (Array.isArray(messages)?messages:[]).some(patch=>patch && ['message','swipes','swipe_id','role','is_hidden','name'].some(key=>Object.hasOwn(patch,key)))) {
      const saved=await options.history.mutate(chat,draft=>replaceTavernHelperMessages(draft,messages))
      return {updated:true,targets:saved.targets,context:projectTavernHelperContext(saved.chat)}
    }
    const patches = transaction === undefined ? messages : (Array.isArray(messages) ? messages : []).map(function (raw) {
      const patch = raw && typeof raw === 'object' ? structuredClone(raw) : raw
      if (!patch || Number(patch.message_id) !== transaction.messageId) return patch
      const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id') ? Number(patch.swipe_id) : transaction.swipeId
      if (swipeId !== transaction.swipeId) return patch
      delete patch.message
      return patch
    })
    const updated = replaceTavernHelperMessages(chat, patches)
    if (chat.mvu && chat.mvu.owner === 'official') {
      const opening = Array.isArray(chat.messages) ? chat.messages[0] : null
      const snapshots = opening && Array.isArray(opening.variables) ? opening.variables : []
      if (snapshots.length > 0 && snapshots.every(isOfficialMvuData)) {
        chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() }
      }
    }
    const transactional = transactionResult(sessionId, updated, true, eventId)
    if (transactional !== null) return transactional
    try { await options.writeChat(chat, { source: 'tavern-helper.messages' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    return { updated: true, targets: updated, context: projectTavernHelperContext(chat) }
  }

  async function createMessages(sessionId, messages, option, expectedLifecycleRevision, eventId) {
    const transaction = settlementTransactions.get(str(sessionId))
    assertTransactionEvent(transaction, eventId)
    if (transaction !== undefined) throw new Error('MVU 结算事务不能创建额外聊天楼层')
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (!mutationIsCurrent(chat, expectedLifecycleRevision)) return staleMutation(chat)
    if(options.history) {
      const saved=await options.history.mutate(chat,draft=>appendTavernHelperMessages(draft,messages,option))
      return {updated:true,targets:saved.targets,context:projectTavernHelperContext(saved.chat)}
    }
    const created = appendTavernHelperMessages(chat, messages, option)
    try { await options.writeChat(chat, { source: 'tavern-helper.messages.create' }) }
    catch (error) {
      if (error && error.code === 'DSH_TAVERN_CHAT_CONFLICT') {
        const latest = await options.resolveChat(str(sessionId))
        if (latest !== undefined && !mutationIsCurrent(latest, expectedLifecycleRevision)) return staleMutation(latest)
      }
      throw error
    }
    if (typeof options.publishCreatedMessages === 'function') await options.publishCreatedMessages(chat, created)
    return { updated: true, targets: created, context: projectTavernHelperContext(chat) }
  }

  async function mutateHistory(sessionId,operation,expectedLifecycleRevision,eventId) {
    assertTransactionEvent(settlementTransactions.get(str(sessionId)),eventId)
    if(settlementTransactions.has(str(sessionId)))throw new Error('MVU 结算期间不能删除或移动历史')
    const chat=await resolveChat(sessionId);await assertScriptEnabled(chat)
    if(!mutationIsCurrent(chat,expectedLifecycleRevision))return staleMutation(chat)
    if(!options.history)throw new Error('原生历史服务未连接')
    const saved=await options.history.mutate(chat,draft=>{
      if(operation.kind==='delete')return deleteTavernHelperMessages(draft,operation.message_ids)
      if(operation.kind==='rotate')return rotateTavernHelperMessages(draft,operation.begin,operation.middle,operation.end)
      throw new Error('未知历史操作')
    })
    return {updated:true,targets:saved.targets,context:projectTavernHelperContext(saved.chat)}
  }

  async function worldbookRecord(sessionId, requestedName, template = false, unpublishedChat) {
    const chat = unpublishedChat || await resolveChat(sessionId)
    if (template) assertTemplateChat(chat); else await assertScriptEnabled(chat)
    await options.worldBooks.migrateChat?.(chat)
    const card = await options.readCard(chat)
    let record = await (options.worldBooks.boundCard||options.worldBooks.bound)(chat.cardPath, card, chat)
    if(options.resourceLibrary && requestedName && requestedName!=='current' && requestedName!==record?.view?.displayName){const row=await options.resourceLibrary.locate(chat,requestedName);record=await options.worldBooks.getForChat(chat,row.source)}
    if (record === null) throw new Error('当前人物卡没有绑定世界书')
    const name = str(requestedName).trim()
    if (!options.resourceLibrary && name !== '' && name !== 'current' && name !== str(record.view.displayName)) {
      throw new Error('当前兼容层只能访问人物卡绑定的世界书: ' + name)
    }
    return { chat, record }
  }

  async function serializeWorldbook(cardPath, work) {
    const key = str(cardPath)
    const previous = mutationTails.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(key, current)
    try { return await current }
    finally { if (mutationTails.get(key) === current) mutationTails.delete(key) }
  }

  async function getWorldbook(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldbook: projectTavernHelperWorldbook(resolved.record.view) }
  }

  async function replaceWorldbook(sessionId, name, entries, expectedEntries, eventId) {
    if(str(eventId).startsWith('mvu:')){assertTransactionEvent(settlementTransactions.get(str(sessionId)),eventId);throw new Error('MVU 结算事务不能修改跨存储的世界书')}
    const initial = await worldbookRecord(sessionId, name)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const currentEntries = projectTavernHelperWorldbook(resolved.record.view).entries
      const requested = expectedEntries !== undefined && !isDeepStrictEqual(currentEntries, expectedEntries)
        ? mergeTavernHelperWorldbookEntries(currentEntries, entries, expectedEntries) : entries
      const operations = replaceTavernHelperWorldbookOperations(resolved.record.view, requested)
      const updated = operations.length === 0
        ? resolved.record
        : await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', projectTavernHelperWorldbook(resolved.record.view).entries, entries), () => updateBoundWorldbook(resolved, { operations }), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: operations.length > 0, createdUids: operations.filter(operation => operation.op === 'add').map(operation => operation.uid), worldbook: projectTavernHelperWorldbook(updated.view) }
    })
  }

  async function updateBoundWorldbook(resolved, request, nativeDocument) {
    if (nativeDocument !== undefined) {
      if (!nativeDocument || typeof nativeDocument !== 'object' || !nativeDocument.entries ||
          typeof nativeDocument.entries !== 'object' || Array.isArray(nativeDocument.entries)) throw new Error('原生世界书需要 entries 对象')
      for (const [key, entry] of Object.entries(nativeDocument.entries)) {
        if (!entry || !Number.isSafeInteger(entry.uid) || entry.uid < 0 || String(entry.uid) !== key) throw new Error('世界书条目编号无效或重复')
      }
    }
    const document = nativeDocument === undefined
      ? updateWorldBookDocument(resolved.record.document, request).document
      : structuredClone(nativeDocument)
    // Reuse native worldbook validation before publishing the chat-local version.
    const view = inspectWorldBookDocument(document)
    replaceTavernHelperWorldbookOperations(view, projectTavernHelperWorldbook(view).entries)
    const updated=await options.worldBooks.replaceForChat(resolved.chat,resolved.record,document)
    await options.writeChat(resolved.chat, { source: 'tavern-helper.local-worldbook' })
    return updated
  }

  async function exportBoundWorldbook(record) {
    return record.localChatId ? exportSillyTavernWorldBook(record.document)
      : (await options.worldBooks.export(record.source)).document
  }

  function worldbookKey(record) {
    if (record.localChatId) return 'chat:' + record.localChatId
    return record.source.kind === 'card' ? 'card:' + record.source.cardPath : 'standalone:' + record.source.path
  }

  async function loadWorldInfo(sessionId, name) {
    const resolved = await worldbookRecord(sessionId, name)
    return { worldInfo: await exportBoundWorldbook(resolved.record) }
  }

  async function saveWorldInfo(sessionId, name, worldInfo, expectedWorldInfo, template = false, eventId) {
    if(str(eventId).startsWith('mvu:')){assertTransactionEvent(settlementTransactions.get(str(sessionId)),eventId);throw new Error('MVU 结算事务不能修改跨存储的世界书')}
    if (!expectedWorldInfo) throw new Error('保存前请先读取世界书')
    const initial = await worldbookRecord(sessionId, name, template)
    return await serializeWorldbook(worldbookKey(initial.record), async function () {
      const resolved = await worldbookRecord(sessionId, name, template)
      if (worldbookKey(resolved.record) !== worldbookKey(initial.record)) throw new Error('世界书绑定已变化，请重新读取后重试')
      const current = await exportBoundWorldbook(resolved.record)
      if (!isDeepStrictEqual(current, expectedWorldInfo)) throw new Error('世界书已被其他操作修改，请重新读取后重试')
      const updated = await observeResourceSave(resourceSaveSummary('worldbook', resolved.record.localChatId ? 'session' : resolved.record.source.kind === 'card' ? 'card' : 'worldbook', current.entries, worldInfo.entries, true), () => updateBoundWorldbook(resolved, {}, worldInfo), summary => options.recordResourceSave?.(sessionId, summary))
      return { updated: true, worldbook: projectTavernHelperWorldbook(updated.view), worldInfo: await exportBoundWorldbook(updated) }
    })
  }

  async function saveChatData(sessionId, request, eventId) {
    const validation=request?.reload===true?{...request}:request
    if(request?.reload===true)delete validation.reload
    const revisions = validateChatPluginRequest(validation)
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (chat.id !== request.chatId) throw new Error('聊天已切换，插件数据未保存')
    if(request.reload===true){
      if(Number(chat.tavernHelperLifecycleRevision||0)!==Number(request.lifecycleRevision||0))throw new Error('聊天版本已变化，请重新打开当前脚本')
      if(request.messages.length||request.metadata)throw new Error('重新读取不能同时提交插件数据')
      return {updated:false,context:projectTavernHelperContext(chat)}
    }
    if (!options.readChatRevision || !options.updateChat) throw new Error('插件聊天存储未连接')
    if(str(eventId).startsWith('mvu:')){assertTransactionEvent(settlementTransactions.get(str(sessionId)),eventId);throw new Error('临时 MVU 结算期间不能保存聊天插件数据，请稍后重试')}
    const baselines = new Map(await Promise.all(revisions.map(async revision => [revision, await options.readChatRevision(chat.id, revision)])))
    const saved = await options.updateChat(chat.id, async function (latest) {
      await assertScriptEnabled(latest)
      if (latest.sessionId && str(latest.sessionId) !== str(sessionId)) throw new Error('聊天绑定已变化，插件数据未保存')
      return applyChatPluginData(latest, baselines, request)
    }, { source: 'tavern-helper.chat-plugin-data' })
    if (!saved) throw new Error('聊天已不存在，插件数据未保存')
    return { updated: true, context: projectTavernHelperContext(saved) }
  }

  function assertTemplateChat(chat) {
    if (!chat || !['story', 'script'].includes(chat.mode) || (typeof options.isPlayChat === 'function' && !options.isPlayChat(chat))) throw new Error('当前会话没有绑定游玩对话')
  }

  async function readFullPromptTemplateState(sessionId, unpublishedChat) {
    const chat = unpublishedChat || await resolveChat(sessionId)
    assertTemplateChat(chat)
    const card = await options.readCard(chat)
    const record = await (options.worldBooks.boundCard||options.worldBooks.bound)(chat.cardPath, card, chat)
    const bookCatalog=options.resourceLibrary?await options.resourceLibrary.catalog(chat):null
    const book = record ? await exportBoundWorldbook(record) : null
    const worldName = str(record?.view?.displayName)
    const extensionSettings = options.fullExtensionSettings ? await options.fullExtensionSettings.read() : {}
    extensionSettings.variables = { ...extensionSettings.variables, global: runtimeGlobals(chat,options.globalVariables ? await options.globalVariables.read() : {}) }
    if (!Array.isArray(extensionSettings.regex)) extensionSettings.regex = []
    const textFields=Object.fromEntries(['name','description','personality','scenario','first_mes','mes_example','creator_notes','creatorcomment','system_prompt','post_history_instructions','creator'].map(key=>[key,str(card[key] ?? card.data?.[key])]))
    const character = { ...card, ...textFields, data: { ...card.data, ...card, ...textFields, alternate_greetings: card.alternate_greetings || [], extensions: { ...card.extensions, ...(worldName ? { world: worldName } : {}) } } }
    return {
      state: projectFullPromptTemplateState(templateInputView(chat).chat),
      environment: { characters: [character], name1: str(chat.macroState?.userName) || '你', name2: str(card.name),
        this_chid: 0, extension_settings: extensionSettings,
        world_names: bookCatalog?.names || (worldName ? [worldName] : []), selected_world_info:bookCatalog?.global||[],
        worldbooks: worldName && book ? { [worldName]: book } : {} }
    }
  }

  async function saveFullPromptTemplateGlobals(sessionId, variables, expectedVariables) {
    const chat = await resolveChat(sessionId);assertTemplateChat(chat)
    if (!expectedVariables || typeof expectedVariables !== 'object' || Array.isArray(expectedVariables)) throw new Error('缺少全局变量读取版本')
    if (!options.globalVariables) throw new Error('全局变量存储未连接')
    const saved = await saveRuntimeGlobals(chat,variables, expectedVariables)
    return { updated: true, variables: saved }
  }

  async function saveFullPromptTemplateSettings(sessionId, settings, expectedSettings) {
    assertPluginJson(settings, '模板设置')
    if (expectedSettings !== undefined) assertPluginJson(expectedSettings, '模板设置读取版本')
    assertTemplateChat(await resolveChat(sessionId))
    if (!options.fullExtensionSettings) throw new Error('完整模板设置存储未连接')
    const current = await options.fullExtensionSettings.read()
    const base = { ...current }
    if (expectedSettings === undefined) delete base.EjsTemplate
    else base.EjsTemplate = expectedSettings
    const saved = await options.fullExtensionSettings.save({ ...current, EjsTemplate: settings }, base)
    return { updated: true, settings: saved.EjsTemplate }
  }

  async function saveFullPromptTemplateState(sessionId, request) {
    validateFullPromptTemplateSave(request)
    const chat = await resolveChat(sessionId)
    assertTemplateChat(chat)
    if (!options.readChatRevision || !options.updateChat) throw new Error('模板原生存储未连接')
    if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
    const baseline = await options.readChatRevision(chat.id, request.stateRevision)
    const baseState=baseline?projectFullPromptTemplateState(templateInputView(baseline).chat):null
    if(request.messageIdentityVersion===undefined&&baseState&&request.chat.length===baseState.chat.length&&!request.chat.some(row=>row.__dsh_message_key!==undefined))request={...request,chat:request.chat.map((row,i)=>({...row,__dsh_message_key:baseState.chat[i].__dsh_message_key}))};
    if(options.history && fullPromptTemplateHistoryChanged(baseState,request)) {
      if(templateInputView(chat).input)throw new Error('本轮正在准备输入，请结束本轮后修改聊天历史')
      const result=await options.history.mutate(chat,draft=>{
        Object.assign(draft,applyFullPromptTemplateHistoryState(draft,baseline,request))
        return request.chat.map((_,messageId)=>({messageId}))
      },{template:false})
      return {updated:true,state:projectFullPromptTemplateState(result.chat)}
    }
    const saved = await options.updateChat(chat.id, async latest => {
      assertTemplateChat(latest)
      if (settlementTransactions.has(str(sessionId))) throw new Error('MVU 结算进行中，模板存档不能覆盖结算事务')
      if (str(latest.sessionId) !== str(sessionId)) throw new Error('模板聊天已切换')
      const currentView=templateInputView(latest),baseView=templateInputView(baseline)
      if(currentView.input?.operationId!==baseView.input?.operationId)throw new Error('模板当前输入已过期')
      return persistTemplateInputView(applyFullPromptTemplateState(currentView.chat,baseView.chat,request),currentView.input)
    }, { source: 'prompt-template.state' })
    if (!saved) throw new Error('模板聊天已不存在')
    return { updated: true, state: projectFullPromptTemplateState(saved) }
  }

  async function saveExtensionSettings(sessionId, settings, expectedSettings, scriptId, lifecycleRevision, settingsPatches) {
    const chat = await resolveChat(sessionId)
    await assertScriptEnabled(chat)
    if (!options.extensionSettings) throw new Error('插件设置存储未连接')
    if(settingsPatches!==undefined){
      const patches=validateExtensionSettingsPatch(settingsPatches)
      const assertCurrent=async()=>{
        if(!scriptId)return
        await options.assertOwner?.(sessionId,scriptId,lifecycleRevision)
        const current=await resolveChat(sessionId),permission=await options.scriptPolicy?.(current,scriptId)||{},policy={sharedSettings:permission.capabilities?.includes('shared-settings'),namespaces:permission.namespaces}
        for(const item of patches){const marker=item.path.length===2?{__userscripts:Object.fromEntries([[item.path[1],null]])}:Object.fromEntries([[item.path[0],null]]);assertScriptSettings(marker,scriptId,policy)}
      }
      await assertCurrent()
      const result=await options.extensionSettings.savePatch(patches,{assertCurrent})
      if(result.updated)await options.extensionSettingsChanged?.(str(sessionId))
      return result
    }
    if (scriptId) {
      await options.assertOwner?.(sessionId,scriptId,lifecycleRevision)
      const permission = await options.scriptPolicy?.(chat,scriptId) || {}, policy = {sharedSettings:permission.capabilities?.includes('shared-settings'),namespaces:permission.namespaces}
      if(!policy.sharedSettings){
        for(const value of [settings,expectedSettings])if(!isDeepStrictEqual(projectScriptSettings(value,scriptId,policy),value || {}))throw Error('脚本无权访问其他设置命名空间')
        for(const key of new Set([...Object.keys(settings || {}),...Object.keys(expectedSettings || {})]))if(!isDeepStrictEqual(settings?.[key],expectedSettings?.[key]))assertScriptSettings({[key]:settings?.[key]},scriptId,policy)
        settings=projectScriptSettings(settings,scriptId,{...policy,writable:true});expectedSettings=projectScriptSettings(expectedSettings,scriptId,{...policy,writable:true})
      }
      const current = await options.extensionSettings.read(), base = {...current}, next = {...current}
      for (const key of new Set([...Object.keys(settings || {}),...Object.keys(expectedSettings || {})])) {
        if (key === '__userscripts' && !policy.sharedSettings) {
          base[key] = {...current[key]}; next[key] = {...current[key]}
          for (const [target, values] of [[base,expectedSettings],[next,settings]]) { if (Object.hasOwn(values?.[key] || {},scriptId)) Object.defineProperty(target[key],scriptId,{value:values[key][scriptId],enumerable:true,configurable:true,writable:true});else delete target[key][scriptId] }
        } else {
          for (const [target,values] of [[base,expectedSettings],[next,settings]]) { if (Object.hasOwn(values || {},key)) Object.defineProperty(target,key,{value:values[key],enumerable:true,configurable:true,writable:true});else delete target[key] }
        }
      }
      const saved = await options.extensionSettings.save(next,base)
      const updated=options.extensionSettings.changed?.(saved)??true
      if(updated)await options.extensionSettingsChanged?.(str(sessionId))
      return {updated,extensionSettings:projectScriptSettings(saved,scriptId,policy)}
    }
    if (isDeepStrictEqual(settings, expectedSettings)) return { updated: false, extensionSettings: await options.extensionSettings.read() }
    const extensionSettings = await observeResourceSave(resourceSaveSummary('regex', 'global', expectedSettings?.regex, settings?.regex, true), () => options.extensionSettings.save(settings, expectedSettings), summary => options.recordResourceSave?.(sessionId, summary))
    const updated=options.extensionSettings.changed?.(extensionSettings)??true
    if(updated)await options.extensionSettingsChanged?.(str(sessionId))
    return {updated,extensionSettings}
  }

  async function context(sessionId, chatValue, transientUserText = '') {
    const chat = chatValue || await resolveChat(sessionId)
    const inputView=templateInputView(chat),draft = structuredClone(inputView.chat)
    const userText = str(transientUserText).trim()
    if (userText !== '' && !inputView.input) {
      const previousVariables = lastTavernHelperVariables(draft.messages)
      const message = { role: 'user', text: userText, swipeId: 0, swipes: [userText], variables: [] }
      if (previousVariables !== undefined) message.variables = [structuredClone(previousVariables)]
      draft.messages.push(message)
    }
    const projected = {...projectTavernHelperContext(draft),...options.scriptDispatch.mvuActivity?.(chat)}
    if(options.scriptVariables?.effective)projected.scriptVariables=await options.scriptVariables.effective(draft)
    if(options.presetVariables)projected.presetVariables=await options.presetVariables.read(chat)
    if (options.globalVariables && typeof options.globalVariables.read === 'function') {
      projected.globalVariables = runtimeGlobals(chat,await options.globalVariables.read())
    }
    try {
      const resolved = await worldbookRecord(sessionId, 'current')
      projected.worldbook = projectTavernHelperWorldbook(resolved.record.view)
    } catch {}
    return projected
  }

  async function dispatchEvent(input = {}) {
    if (options.hasScripts && !await options.hasScripts(input.chat || await resolveChat(input.sessionId))) return { handled: true, args: input.args || [] }
    const executionContext=async()=>{
      if(input.work?.requiredRuntimeContract==='card-mvu-pending-v1'){
        const current=await resolveChat(input.sessionId)
        return {...await context(input.sessionId,current,input.transientUserText),cardMvuWorkIdentity:cardMvuContextIdentity(current,input)}
      }
      return input.context||await context(input.sessionId,input.chat,input.transientUserText)
    }
    if(options.eventExecutor)return options.eventExecutor({...input,context:executionContext})
    const eventContext = await executionContext()
    return await options.scriptDispatch.dispatch(input.sessionId, input.name, input.args, eventContext,input.work)
  }

  async function validateDisplayedMessage(input) {
    const {sessionId,runtimeId,messageId,lifecycleRevision,swipeId,bodyId,messageDigest,scriptIds}=input || {};
    if(!str(sessionId)||!str(runtimeId)||!Number.isSafeInteger(messageId)||messageId<0||!Number.isSafeInteger(lifecycleRevision)||lifecycleRevision<0
      ||!Number.isSafeInteger(swipeId)||swipeId<0||!str(bodyId)||bodyId.length>200||!/^[a-f0-9]{64}$/.test(messageDigest||'')
      ||!Array.isArray(scriptIds)||!scriptIds.length||scriptIds.length>64||scriptIds.some(id=>!str(id)||id.length>200))throw new Error('正文显示身份无效');
    if(!options.scriptDispatch.available(sessionId,runtimeId,'general')||!options.scriptDispatch.availableFrontend(sessionId))throw new Error('正文显示执行窗口已失效');
    const actual=await options.readDisplayedMessageIdentity?.(sessionId,messageId);
    if(!actual||actual.lifecycleRevision!==lifecycleRevision||actual.swipeId!==swipeId||actual.bodyId!==bodyId||actual.messageDigest!==messageDigest
      ||scriptIds.some(id=>!actual.scriptIds.includes(id)))throw new Error('正文显示消息、版本或脚本来源已变化');
    return actual;
  }
  async function enqueueDisplayedMessage(input) {
    if(!str(input?.eventId).startsWith('display-render:'+str(input?.runtimeId)+':')||input.eventId.length>300)throw new Error('正文显示事件身份无效');
    await validateDisplayedMessage(input);
    const eventContext=await context(input.sessionId);
    // Check again after context/resource awaits, immediately before reserving.
    await validateDisplayedMessage(input);
    if(settlementTransactions.has(input.sessionId))return {queued:false,pending:true};
    return options.scriptDispatch.enqueueDisplayedMessage(input.sessionId,input.runtimeId,input,eventContext);
  }
  async function startDisplayedMessageWork(input) {
    const target=options.scriptDispatch.displayedMessageTarget(input.sessionId,input.eventId,input.runtimeId,input.leaseToken);
    if(!target)return {started:false};
    try {await validateDisplayedMessage(target);}
    catch(error){options.scriptDispatch.cancelDisplayedMessage(input.sessionId,input.eventId,input.runtimeId);throw error;}
    return options.scriptDispatch.start(input.sessionId,input.eventId,input.leaseToken,input.runtimeId);
  }

  /** Run one internal MVU command against an isolated draft and commit once. */
  async function settleMvuUpdate(input = {}) {
    const sessionId = str(input.sessionId)
    async function record(stage, details = {}) {
      try { await options.diagnostics?.record(sessionId, { diagnosticId: input.diagnosticId, messageId: input.messageId, swipeId: input.swipeId, stage, ...details }) } catch {}
    }
    if (settlementTransactions.has(sessionId)) throw new Error('当前对话已有 MVU 变量结算正在执行')
    const current = await resolveChat(sessionId)
    assertMvuEnabled(current)
    const operationId = str(input.operationId).trim()
    if (operationId === '') throw new Error('MVU 变量结算缺少 operationId')
    const expectedLifecycleRevision = Math.max(0, Number(input.expectedLifecycleRevision) || 0)
    if (!mutationIsCurrent(current, expectedLifecycleRevision)) return { updated: false, stale: true, context: projectTavernHelperContext(current) }
    const messageId = Number(input.messageId)
    if (!Number.isInteger(messageId) || messageId < 0 || messageId >= current.messages.length) throw new Error('MVU 变量结算楼层不存在')
    const message = current.messages[messageId]
    const swipeId = Number(input.swipeId)
    if (!Number.isInteger(swipeId) || swipeId < 0 || swipeId !== Math.max(0, Number(message.swipeId) || 0)) {
      return { updated: false, stale: true, context: projectTavernHelperContext(current) }
    }
    const command = str(input.command).trim()
    if (command === '') throw new Error('MVU 变量结算命令为空')
    await options.ensureRuntime?.(sessionId)
    const originalText = str((message.swipes && message.swipes[swipeId]) ?? message.sourceText ?? message.text)
    const transaction = {
      draft: structuredClone(current),
      eventId: 'mvu:' + randomUUID() + ':' + operationId,
      messageId,
      swipeId,
      mutations: 0
    }
    settlementTransactions.set(sessionId, transaction)
    let executionStarted = false, prepared = false, rejectedResult
    try {
      const eventContext = await context(sessionId, transaction.draft)
      const projected = eventContext.messages[messageId]
      if (!projected) throw new Error('MVU 变量结算投影楼层不存在')
      const internalText = str(input.storyText).trim() + '\n\n' + command
      projected.message = internalText
      if (!Array.isArray(projected.swipes)) projected.swipes = [originalText]
      projected.swipes[swipeId] = internalText
      const availability = options.scriptDispatch.status?.(sessionId)
      const hasMvuSnapshot = value => value && value.stat_data !== undefined && value.schema !== undefined
      const currentSnapshot = hasMvuSnapshot(projected.variables) === true
      const priorSnapshot = eventContext.messages.slice(0, messageId).some(item => hasMvuSnapshot(item.variables))
      await record('runtime-dispatch', { availability, baseline: { currentSnapshot, priorSnapshot, usesCurrentFallback: currentSnapshot && !priorSnapshot } })
      async function initializationRejected(error) {
        const validation = { changes: [], sideEffects: [], failures: [{ message: error }] }
        await record('runtime-initialization-failed', { error })
        return { updated: false, rejected: true, retryable: false, validation,
          diagnostics: [{ kind: 'initialization', level: 'error', initializationFailed: true, message: error }],
          context: projectTavernHelperContext(current) }
      }
      if (availability?.initializationError) return await initializationRejected(availability.initializationError)
      // MVU is a local capability of the chat. A temporarily absent browser
      // executor is scheduling state, not a failed settlement. Return the
      // prepared transaction immediately so the caller can persist and resume
      // it when the executor registers again.
      if (availability && (availability.ready !== true || availability.mvuValidationBlocked === true || availability.busy === true)) {
        await record('runtime-deferred', { availability })
        return { updated: false, deferred: true, context: projectTavernHelperContext(current) }
      }
      const eventWork={eventId:transaction.eventId,onlyScriptIds:['__dsh_official_mvu__']}
      executionStarted = true
      const dispatched=options.eventExecutor?await options.eventExecutor({sessionId,name:'MESSAGE_RECEIVED',args:[messageId],context:eventContext,work:eventWork,returnFailure:true}):await options.scriptDispatch.dispatch(sessionId,'MESSAGE_RECEIVED',[messageId],eventContext,eventWork)
      await record('runtime-completed', { handled: dispatched.handled === true, timedOut: dispatched.timedOut === true, claimTimedOut: dispatched.claimTimedOut === true, phase: dispatched.phase, disposed: dispatched.disposed === true, error: dispatched.error, diagnostics: dispatched.diagnostics || [] })
      if (dispatched.handled !== true) {
        if (dispatched.initializationFailed === true) return await initializationRejected(str(dispatched.error))
        if (dispatched.unavailable === true || dispatched.busy === true) {
          executionStarted = false
          await record('runtime-deferred', { availability: options.scriptDispatch.status?.(sessionId) })
          return { updated: false, deferred: true, context: projectTavernHelperContext(current) }
        }
        if (str(dispatched.error).trim() !== '' && !dispatched.timedOut && !dispatched.disposed
          && !/超时|timed?\s*out|timeout/i.test(str(dispatched.error))) {
          const validation = { changes: [], sideEffects: [], failures: [{ message: str(dispatched.error) }] }
          await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
          return rejectedResult = { updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
            validation, diagnostics: dispatched.diagnostics || [], context: projectTavernHelperContext(current) }
        }
        if (dispatched.timedOut === true) throw new Error('MVU 脚本执行回执超时，本轮结算未确认完成，请重试结算')
        if (dispatched.disposed === true) throw new Error('MVU 浏览器执行器已断开，本轮结算中断，请重试结算')
        throw new Error(str(dispatched.error).trim() || '官方 MVU 浏览器运行时尚未就绪，本轮未执行变量结算')
      }
      const settled = transaction.draft.messages[messageId]
      if (!settled || Math.max(0, Number(settled.swipeId) || 0) !== swipeId) {
        return { updated: false, stale: true, context: projectTavernHelperContext(current) }
      }
      if (!Array.isArray(settled.swipes)) settled.swipes = [originalText]
      settled.swipes[swipeId] = originalText
      settled.sourceText = originalText
      settled.projectionText = originalText
      settled.text = originalText
      settled.sessionText = originalText
      settled.displayText = originalText
      const beforeVariables = projectTavernHelperContext(current).messages[messageId].variables
      const proposedContext = projectTavernHelperContext(transaction.draft)
      const validation = typeof input.validate === 'function'
        ? await input.validate({ before: beforeVariables, after: proposedContext.messages[messageId].variables })
        : null
      if (validation && validation.failures.length > 0) {
        await record('validation-rejected', { failures: validation.failures, externalEffects: transaction.externalEffects === true })
        return rejectedResult = {
          updated: false, rejected: true, retryable: transaction.externalEffects !== true, retryAfterMs: MVU_RETRY_AFTER_MS,
          validation, diagnostics: dispatched.diagnostics || [], context: projectTavernHelperContext(current)
        }
      }
      // The browser event can take time; recheck the target before committing its draft.
      const latest = await resolveChat(sessionId)
      if (!mutationIsCurrent(latest, expectedLifecycleRevision)
        || Number(latest.messages[messageId]?.swipeId || 0) !== swipeId) return staleMutation(latest)
      const effect = createMvuSettlementEffect({
        operationId, chatId: current.id, sessionId,
        branchId: input.branchId, basedOnRevision: input.basedOnRevision,
        expectedLifecycleRevision, messageId, swipeId,
        before: current, after: transaction.draft
      })
      await record('prepared', { mutations: transaction.mutations })
      prepared = true
      return {
        updated: true,
        validation,
        diagnostics: dispatched.diagnostics || [],
        mutations: transaction.mutations,
        messageId,
        swipeId,
        effect,
        context: projectTavernHelperContext(transaction.draft)
      }
    } catch (error) {
      await record('runtime-or-persistence-failed', { error: str(error && error.message || error) })
      throw error
    } finally {
      transaction.closed = true
      try { if (executionStarted && !prepared) {
        // Persist a new lifecycle before releasing the failed transaction. Old
        // frames, including legacy calls without an event ID, cannot write back.
        options.scriptDispatch.invalidate?.(sessionId)
        const fence = draft => {
          if (Math.max(0, Number(draft.tavernHelperLifecycleRevision) || 0) !== expectedLifecycleRevision) return draft
          draft.tavernHelperLifecycleRevision = expectedLifecycleRevision + 1
          draft.tavernScriptMutationFence = { revision: expectedLifecycleRevision + 1, eventId: transaction.eventId }
          return draft
        }
        const latest = await options.resolveChat(sessionId)
        if (latest && Math.max(0, Number(latest.tavernHelperLifecycleRevision) || 0) === expectedLifecycleRevision) {
          if (options.updateChat) await options.updateChat(latest.id, fence, { source: 'mvu.runtime-fence' })
          else await options.writeChat(fence(latest), { source: 'mvu.runtime-fence' })
        }
        if (rejectedResult?.retryable) {
          const fenced = await options.resolveChat(sessionId)
          // Only this transaction's verified fence can advance the internal
          // retry baseline. A concurrent edit must still make the retry stale.
          if (fenced?.tavernScriptMutationFence?.eventId === transaction.eventId
            && fenced.tavernHelperLifecycleRevision === expectedLifecycleRevision + 1) {
            rejectedResult.retryLifecycleRevision = fenced.tavernHelperLifecycleRevision
          } else rejectedResult.retryable = false
        }
        await options.runtimeInvalidated?.(sessionId)
      } } finally { settlementTransactions.delete(sessionId) }
    }
  }

  return Object.freeze({
    context,
    dispatchEvent,
    enqueueDisplayedMessage,startDisplayedMessageWork,
    settleMvuUpdate,
    updatePrompts,
    updateVariables,
    updateMessages, mutateHistory,
    createMessages,
    getWorldbook,
    replaceWorldbook,
    readFullPromptTemplateState,
    saveFullPromptTemplateState,
    async loadFullPromptTemplateWorldInfo(sessionId, name, unpublishedChat) { const resolved = await worldbookRecord(sessionId, name, true, unpublishedChat); return {worldInfo: await exportBoundWorldbook(resolved.record)} },
    saveFullPromptTemplateWorldInfo: (sessionId, name, worldInfo, expectedWorldInfo) => saveWorldInfo(sessionId, name, worldInfo, expectedWorldInfo, true),
    saveFullPromptTemplateSettings,
    saveFullPromptTemplateGlobals,
    saveExtensionSettings,
    saveChatData,
    loadWorldInfo,
    saveWorldInfo,
    claimWork: function (sessionId, runtimeId, ready, initializationError,leaseProtocol,mvuValidation) { return options.scriptDispatch.claim(sessionId, runtimeId, ready, initializationError,leaseProtocol,mvuValidation) },
    startWork: function (sessionId, eventId, leaseToken, runtimeId) { return options.scriptDispatch.start(sessionId, eventId, leaseToken, runtimeId) },
    heartbeatRuntime: function (sessionId, runtimeId, ready, initializationError,leaseProtocol,mvuValidation) { return options.scriptDispatch.heartbeat(sessionId,runtimeId,ready,initializationError,leaseProtocol,mvuValidation) },
    completeEvent: function (sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) { return options.scriptDispatch.complete(sessionId, eventId, args, runtimeId, leaseToken, error, diagnostics) },
    releaseRuntime: function (sessionId, runtimeId) { return options.scriptDispatch.dispose(sessionId, runtimeId) }
  })
}
