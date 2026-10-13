import { isDeepStrictEqual } from 'node:util'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { freezeJson, jsonBytes } from './readonly-json.js'
import {mutableJsonDraft,finishJsonDraft,immutableJsonSnapshot} from './json-draft.js'

const STORAGE_REVISION = '_storageRevision'
const MISSING = Symbol('missing')

function clone(value) {
  // Preserve the merge sentinel so the parent omits deleted fields.
  return value === undefined || value === MISSING ? value : mutableJsonDraft(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function same(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return isDeepStrictEqual(left, right)
}

// Bookkeeping stamps that every writer bumps, not story data. Like the root
// updatedAt, two compatible writers (a settlement finishing and the next round
// starting) must not conflict over them; keep the later one. Entries inside the
// timeline stay strict. (upstream 7a2bfca8)
const MONOTONIC_STAMPS = new Set(['timeline.updatedAt'])

function conflict(chatId, path) {
  const error = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：' + (path || '<root>'))
  error.code = 'DSH_TAVERN_CHAT_CONFLICT'
  error.chatId = chatId
  error.path = path
  return error
}

// A reused draft must describe its new storage revision, including fields
// merged from other writers; otherwise its next save is "based on" the new
// revision and silently reverts them. Preserve edits its owner made during the
// await. (upstream 4aed2657; locally refreshed from the merge result, not the
// normalized copy, so a save without other writers never swaps out the
// caller's arrays and objects.)
function refreshDraft(input, desired, merged) {
  for (const key of new Set([...Object.keys(desired), ...Object.keys(merged)])) {
    const before = Object.hasOwn(desired, key) ? desired[key] : MISSING
    const after = Object.hasOwn(merged, key) ? merged[key] : MISSING
    if (same(before, after)) continue
    const current = Object.hasOwn(input, key) ? input[key] : MISSING
    if (object(current) && object(before) && object(after)) {
      refreshDraft(current, before, after)
    } else if (same(current, before)) {
      if (after === MISSING) delete input[key]
      else input[key] = clone(after)
    }
  }
}

function withoutDisplayCapture(messages) {
  return messages.map(function ({ displayRuntime: _capture, ...message }) { return message })
}

function sameCaptureTarget(left, right) {
  if (!object(left) || !object(right)) return false
  for (const key of ['id', 'role', 'turn', 'greeting']) if (!same(left[key], right[key])) return false
  if (Number(left.swipeId || 0) !== Number(right.swipeId || 0)) return false
  for (const key of ['text', 'sourceText', 'projectionText', 'sessionText', 'displayText']) {
    if (!same(left[key] ?? left.text, right[key] ?? right.text)) return false
  }
  return same(left.swipes ?? [left.text], right.swipes ?? [right.text])
}

function captureOf(message) {
  return object(message) && Object.hasOwn(message, 'displayRuntime') ? message.displayRuntime : MISSING
}

function mergeMessages(base, latest, desired, chatId) {
  // Display captures are observational data, not competing story edits. Keep
  // the authoritative array atomic: two distinct story/variable edits still
  // conflict, even when they affect different messages or also carry captures.
  const before = withoutDisplayCapture(base)
  const current = withoutDisplayCapture(latest)
  const proposed = withoutDisplayCapture(desired)
  let chosen, other
  if (same(proposed, before)) { chosen = latest; other = desired }
  else if (same(current, before) || same(current, proposed)) { chosen = desired; other = latest }
  else throw conflict(chatId, 'messages')
  const result = clone(chosen)
  for (let index = 0; index < result.length; index++) {
    const previousCapture = captureOf(base[index])
    const otherCapture = captureOf(other[index])
    if (same(otherCapture, previousCapture) || !same(captureOf(chosen[index]), previousCapture)) continue
    // Never attach a late capture to a replacement, reordered message or swipe.
    if (!sameCaptureTarget(base[index], chosen[index]) || !sameCaptureTarget(other[index], chosen[index])) continue
    if (otherCapture === MISSING) delete result[index].displayRuntime
    else result[index].displayRuntime = clone(otherCapture)
  }
  return result
}

function mergeValue(base, latest, desired, path, chatId, mergeCreatedObjects = false) {
  if (same(desired, base)) return clone(latest)
  if (same(latest, base) || same(latest, desired)) return clone(desired)
  if (path === 'messages' && [base, latest, desired].every(value => Array.isArray(value) && value.every(object))) {
    return mergeMessages(base, latest, desired, chatId)
  }
  if (mergeCreatedObjects && base === MISSING && object(latest) && object(desired)) base = {}
  if (object(base) && object(latest) && object(desired)) {
    const result = {}
    const keys = new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(desired)])
    for (const key of keys) {
      if (path === '' && (key === STORAGE_REVISION || key === 'updatedAt')) continue
      const childPath = path === '' ? key : path + '.' + key
      if (MONOTONIC_STAMPS.has(childPath)) {
        const stamps = [latest[key], desired[key]].filter(Number.isFinite)
        if (stamps.length) { result[key] = Math.max(...stamps); continue }
      }
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(latest, key) ? latest[key] : MISSING,
        Object.prototype.hasOwnProperty.call(desired, key) ? desired[key] : MISSING,
        childPath,
        chatId,
        mergeCreatedObjects
      )
      if (value !== MISSING) result[key] = value
    }
    return result
  }
  throw conflict(chatId, path)
}

/** Merge fields changed by one operation, preserving unrelated concurrent writes and rejecting overlap. */
export function mergeConcurrentFields(base, latest, desired, id) {
  return mergeValue(base, latest, desired, '', id)
}

/** Variable patches may concurrently introduce distinct keys in a new object. */
export function mergeConcurrentVariables(base, latest, desired, id) {
  // The wrapper also prevents Chat's metadata/message-array rules from applying
  // to user keys named updatedAt, _storageRevision or messages.
  return finishJsonDraft(mergeValue({variables:base}, {variables:latest}, {variables:desired}, '', id, true)).variables
}

/** Rebase a prepared foreground append inside the storage mutation, before completing its operation. */
export function mergeForegroundChat(base, latest, desired) {
  const before = base.messages || [], current = latest.messages || [], proposed = desired.messages || []
  if (current.length !== before.length || proposed.length < before.length) throw conflict(base.id, 'messages.length')
  const messages = before.map((message, index) => {
    for (const key of ['id', 'role', 'turn', 'greeting']) {
      if (!same(message[key], current[index]?.[key]) || !same(message[key], proposed[index]?.[key])) throw conflict(base.id, 'messages.identity')
    }
    return mergeValue(message, current[index], proposed[index], 'messages.' + index, base.id)
  })
  const appended = clone(proposed.slice(before.length))
  if (latest.mvu?.enabled === true && latest.mvu.owner === 'official') {
    const oldVariables = lastTavernHelperVariables(before) || {}
    const currentVariables = lastTavernHelperVariables(messages)
    if (currentVariables !== undefined && !same(oldVariables, currentVariables)) {
      for (const message of appended) {
        if (!['user', 'assistant'].includes(message.role)) continue
        const swipe = Math.max(0, Number(message.swipeId) || 0)
        const inherited = message.variables?.[swipe] ?? oldVariables
        message.variables ||= []
        message.variables[swipe] = mergeValue(oldVariables, currentVariables, inherited, 'messages.appended.variables', base.id)
      }
    }
  }
  messages.push(...appended)
  const owned = ['timeline', 'messages', 'settleStatus', 'settleError', 'foregroundError', 'presentationWarnings']
  const remainder = value => Object.fromEntries(Object.entries(value).filter(([key]) => !owned.includes(key)))
  const merged = mergeValue(remainder(base), remainder(latest), remainder(desired), '', base.id)
  for (const key of owned) if (key !== 'timeline' && Object.hasOwn(desired, key)) merged[key] = clone(desired[key])
  merged.messages = messages
  return merged
}

/**
 * Persist the authoritative Tavern Chat with optimistic three-way merging.
 * Callers keep a small read/write interface; revision tracking, stale-write
 * rejection and locality-preserving merges stay inside this implementation.
 */
export function createChatPersistence(options = {}) {
  const data = options.data
  const store = options.store
  const normalize = typeof options.normalize === 'function' ? options.normalize : function (value) { return value }
  const now = typeof options.now === 'function' ? options.now : Date.now
  // Cached merge baselines used to retain every complete chat revision forever.
  // Journal-backed stores can recover an evicted revision without losing CAS.
  const baselines = new Map()
  const normalizedViews = new WeakMap(), borrowed = new Set(), tracked = new WeakSet()
  const finalized = new FinalizationRegistry(ref => borrowed.delete(ref))
  function track(chat) { if(chat && !tracked.has(chat)){tracked.add(chat);const ref=new WeakRef(chat);borrowed.add(ref);finalized.register(chat,ref)}return chat }
  const baselineByteLimit = Math.max(1, Number(options.baselineByteLimit) || 64 * 1024 * 1024)
  const baselineEntryLimit = Math.max(1, Number(options.baselineEntryLimit) || 32)
  let baselineBytes = 0
  function forget(key) { const entry = baselines.get(key); if (entry) { baselineBytes -= entry.bytes; baselines.delete(key) } }
  function cacheBaseline(key, chat) {
    if (baselines.has(key)) return
    const bytes = jsonBytes(chat)
    if (bytes > baselineByteLimit) return
    while (baselines.size && (baselineBytes + bytes > baselineByteLimit || baselines.size >= baselineEntryLimit)) forget(baselines.keys().next().value)
    baselines.set(key, { value: Object.isFrozen(chat) ? chat : freezeJson(clone(chat)), bytes }); baselineBytes += bytes
  }

  function relative(chatId) {
    const id = String(chatId || '')
    if (id === '' || id.includes('/') || id.includes('\\')) throw new Error('Tavern Chat ID 不合法')
    return 'chats/' + id + '.json'
  }

  const records = store || (data && typeof data.readJson === 'function' && typeof data.updateJson === 'function' && typeof data.remove === 'function' ? {
    async read(chatId) { return await data.readJson(relative(chatId)) },
    async update(chatId, updater) { return await data.updateJson(relative(chatId), updater) },
    async remove(chatId) { await data.remove(relative(chatId)) },
    async version(chatId) { return typeof data.version === 'function' ? await data.version(relative(chatId)) : '' }
  } : null)
  if (records === null || typeof records.read !== 'function' || typeof records.update !== 'function' || typeof records.remove !== 'function') {
    throw new Error('Chat Persistence 缺少 Chat Store adapter')
  }

  records.protectRevisions?.(id => {
    const revisions=[]
    for(const ref of borrowed){const chat=ref.deref();if(!chat)borrowed.delete(ref);else if(chat.id===id)revisions.push(Number(chat._storageRevision)||0)}
    for(const [key]of baselines)if(key.startsWith(id+':'))revisions.push(Number(key.slice(id.length+1)))
    return revisions
  })
  function remember(chat) {
    if (!chat || typeof chat !== 'object') return chat
    const revision = Math.max(0, Number(chat[STORAGE_REVISION]) || 0)
    if(chat[STORAGE_REVISION]!==revision)chat={...chat,[STORAGE_REVISION]:revision}
    const snapshot=immutableJsonSnapshot(chat)
    cacheBaseline(snapshot.id + ':' + revision, snapshot)
    return track(mutableJsonDraft(snapshot))
  }

  async function read(chatId) {
    const value = await readReadonly(chatId)
    return track(mutableJsonDraft(value,({nodes,properties})=>{options.onMetric?.({chatId,name:'draftNodes',value:nodes});options.onMetric?.({chatId,name:'draftProperties',value:properties})}))
  }

  async function readReadonly(chatId) {
    const value = await (records.readReadonly || records.read)(chatId)
    if (value === undefined) return undefined
    if (Object.isFrozen(value) && normalizedViews.has(value)) return normalizedViews.get(value)
    const result = immutableJsonSnapshot(normalize(clone(value)))
    cacheBaseline(result.id+':'+Math.max(0,Number(result[STORAGE_REVISION])||0),result)
    if (Object.isFrozen(value)) normalizedViews.set(value, result)
    return result
  }

  async function write(input, metadata = {}) {
    metadata.signal?.throwIfAborted()
    if (!input || typeof input !== 'object' || String(input.id || '') === '') throw new Error('不能保存没有 id 的 Tavern Chat')
    const desired = clone(input)
    const chatId = String(desired.id)
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const basedOn = Math.max(0, Number(desired[STORAGE_REVISION]) || 0)
    let baseline = baselines.get(chatId + ':' + basedOn)?.value
    let merged
    const saved = await records.update(chatId, async function (stored) {
      merged = undefined
      metadata.signal?.throwIfAborted()
      if (stored === undefined) {
        if (basedOn !== 0) throw conflict(chatId, '<deleted>')
        desired[STORAGE_REVISION] = 1
        desired.updatedAt = touchUpdatedAt ? Math.max(Number(desired.updatedAt) || 0, now()) : Math.max(0, Number(desired.updatedAt) || 0)
        return desired
      }
      const latest = normalize(clone(stored))
      const latestRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      let next
      if (latestRevision === basedOn) {
        next = desired
      } else {
        if (baseline === undefined && typeof records.readRevision === 'function') {
          try { const old = await records.readRevision(chatId, basedOn); if (old !== undefined) baseline = normalize(old) }
          catch (error) { if (error.code !== 'DSH_TAVERN_REVISION_NOT_FOUND') throw error }
        }
        if (baseline === undefined) throw conflict(chatId, '<baseline>')
        next = mergeValue(baseline, latest, desired, '', chatId)
        merged = finishJsonDraft(next)
      }
      const candidate = { ...finishJsonDraft(next), [STORAGE_REVISION]: latestRevision, updatedAt: Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0) }
      metadata.signal?.throwIfAborted()
      if (!metadata.forceRevision && same(candidate, finishJsonDraft(latest))) return undefined
      next[STORAGE_REVISION] = latestRevision + 1
      next.updatedAt = touchUpdatedAt
        ? Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0, now())
        : Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0)
      return next
    }, {...metadata,readonlyResult:true})
    const normalized = remember(normalize(clone(saved)))
    if (merged !== undefined) refreshDraft(input, desired, merged)
    input[STORAGE_REVISION] = normalized[STORAGE_REVISION]
    input.updatedAt = normalized.updatedAt
    return normalized
  }

  async function update(chatId, mutation, metadata = {}) {
    metadata.signal?.throwIfAborted()
    if (typeof mutation !== 'function') throw new Error('Chat Persistence 缺少 mutation')
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const saved = await records.update(chatId, async function (stored) {
      metadata.signal?.throwIfAborted()
      if (stored === undefined) return undefined
      const latest = normalize(clone(stored))
      const currentRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      const result = await mutation(latest)
      metadata.signal?.throwIfAborted()
      if (result === undefined) return undefined
      const next = result === latest ? latest : normalize(result)
      if(!metadata.forceRevision && same(finishJsonDraft(next),finishJsonDraft(stored)))return undefined
      next[STORAGE_REVISION] = currentRevision + 1
      next.updatedAt = touchUpdatedAt ? Math.max(Number(next.updatedAt) || 0, now()) : Math.max(0, Number(next.updatedAt) || 0)
      return next
    }, {...metadata,readonlyResult:true})
    return saved === undefined ? undefined : remember(normalize(clone(saved)))
  }

  async function readRevision(chatId, revision) {
    if (typeof records.readRevision !== 'function') throw new Error('当前 Chat Store 不支持按 revision 读取')
    const value = await records.readRevision(chatId, revision)
    return value === undefined ? undefined : normalize(clone(value))
  }

  async function version(chatId) {
    return typeof records.version === 'function' ? await records.version(chatId) : ''
  }

  async function remove(chatId) {
    baselines.forEach(function (_value, key) { if (key.startsWith(String(chatId) + ':')) forget(key) })
    await records.remove(chatId)
  }

  return Object.freeze({ read, readReadonly, readRevision, write, update, version, remove, retainedRevisions: id => [...baselines.keys()].filter(key=>key.startsWith(id+':')).map(key=>Number(key.slice(id.length+1))), cacheStats: () => ({ entries: baselines.size, bytes: baselineBytes, byteLimit: baselineByteLimit, entryLimit: baselineEntryLimit }) })
}
