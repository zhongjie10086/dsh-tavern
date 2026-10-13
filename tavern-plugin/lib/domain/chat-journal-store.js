import {createStorageFormat} from './storage-format.js'
import { appendFile, link, mkdir, open, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'

import { applyJsonChanges, applyJsonChangesShared, diffJson } from './json-mutation.js'
import { createDurableFilePromotion, renameWithRetry } from '../durable-file-promotion.js'

import { freezeJson, jsonBytes } from './readonly-json.js'
import {mutableJsonDraft,finishJsonDraft} from './json-draft.js'
import { retentionFile, applyRetentionFiles } from './retention-policy.js'
import {encodePackedJson,decodePackedJson,CARD_MVU_PENDING_CONTRACT} from '../packed-json.js'
import {createChatResourceCodec} from './chat-resource-codec.js'

const STORAGE_REVISION = '_storageRevision'
const migrationReceiptLimit = 4096
let migrationEncoderIdentity
function migrationEncoderRevision() {
  return migrationEncoderIdentity ||= Promise.all(['chat-journal-store.js','chat-resource-codec.js','chat-resource-codec-v3.js','resource-version-storage.js','content-resource-store.js','storage-format.js','../packed-json.js'].map(file=>readFile(new URL(file,import.meta.url)))).then(parts=>{
    const digest=createHash('sha256').update('resource-migration-receipt-v1')
    for(const part of parts)digest.update(part)
    return digest.digest('hex')
  }).catch(error=>{migrationEncoderIdentity=undefined;throw error})
}
const SNAPSHOT_PATTERN = /^(\d{12})\.json$/
const JOURNAL_PATTERN = /^(\d{12})-(open|(\d{12}))\.jsonl$/

function revisionOf(value) {
  return Math.max(0, Number(value && value[STORAGE_REVISION]) || 0)
}

function revisionName(value) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999999999999) throw new Error('Chat storage revision 超出范围: ' + String(value))
  return String(revision).padStart(12, '0')
}

function jsonClone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

// Canonicalize only changed payloads. The shared cache must have exactly the
// same values as JSON replay (optional object fields disappear, array holes
// and non-finite numbers become null), without serializing unchanged history.
function durableChanges(current, changes) {
  return jsonClone(changes.flatMap(change => {
    if (change.op !== 'set' || change.value !== undefined) return [change]
    let parent = current
    for (const key of change.path.slice(0, -1)) parent = parent?.[key]
    if (Array.isArray(parent)) return [{...change, value:null}]
    return parent && Object.hasOwn(parent, change.path.at(-1)) ? [{op:'delete', path:change.path}] : []
  }))
}

function requiredContract(chat) {
  const marker=chat?.tavernCardMvuContract
  const rows=Array.isArray(chat?.tavernHelperEventJournal)?chat.tavernHelperEventJournal:[]
  if((marker!==undefined&&marker!==1)||rows.some(row=>row?.cardMvu!==undefined&&(marker!==1||row.cardMvu?.version!==1))) {
    throw Object.assign(new Error('卡核心变量待办合同不受支持；请升级配套代码，或恢复升级前完整 Home 备份'),{code:'DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'})
  }
  return marker===1?CARD_MVU_PENDING_CONTRACT:undefined
}

function encodeSnapshot(value, chat=value) {
  return encodePackedJson(value,{storageVersion:3,requiredContract:requiredContract(chat)})
}

function encodeFrame(value, chat) {
  return encodePackedJson(value,{pretty:false,storageVersion:3,requiredContract:requiredContract(chat)})
}

function safeChatId(value) {
  const id = String(value || '')
  if (id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') throw new Error('Tavern Chat ID 不合法')
  return process.platform === 'win32' ? id.toLowerCase() : id
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let handle
  try { handle = await open(directory, 'r'); await handle.sync() }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error }
  finally { await handle?.close() }
}

async function exists(target) {
  try { await stat(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function readJson(target) {
  try { return await decodePackedJson(await readFile(target, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}

/** Append-oriented JSON storage for one materialized Tavern Chat per directory. */
export function createChatJournalStore(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  const chatsRoot = path.join(dataRoot, 'chats')
  const legacyData = options.legacyData
  const resources = options.resourceCodec === false ? null : options.resourceCodec || createChatResourceCodec({dataRoot})
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const frameLimit = Math.max(1, Number(options.frameLimit) || 200)
  const byteLimit = Math.max(1, Number(options.byteLimit) || 1024 * 1024)
  const mutationTails = new Map(), readFlights = new Map(), readCache = new Map()
  const mutationLocks = createDurableFilePromotion(),storageFormat=createStorageFormat(dataRoot)
  const revisionProtectors = new Set()
  function protectRevisions(provider) { revisionProtectors.add(provider); return () => revisionProtectors.delete(provider) }
  let formatChecked
  function checkFormat(){return formatChecked ||= storageFormat.read().catch(error=>{formatChecked=null;throw error})}
  let readCacheBytes = 0
  const readCacheLimit = 64 * 1024 * 1024
  if (String(options.dataRoot || '') === '') throw new Error('Chat Journal Store 缺少 dataRoot')

  const metric = (chatId, name, value = 1) => options.onMetric?.({ chatId, name, value })
  function copy(chatId, value) { return mutableJsonDraft(value, ({nodes,properties})=>{metric(chatId,'draftNodes',nodes);metric(chatId,'draftProperties',properties)}) }
  async function parsedFile(target, id) { const text = await readFile(target, 'utf8'); metric(id, 'parseBytes', Buffer.byteLength(text)); return decodePackedJson(text) }
  function cacheState(id, stamp, state) {
    if (!state) return
    freezeJson(state.chat)
    const bytes = jsonBytes(state.chat), previous = readCache.get(id)
    if (previous) { readCacheBytes -= previous.bytes; readCache.delete(id) }
    if (bytes > readCacheLimit) return
    while (readCache.size && (readCacheBytes + bytes > readCacheLimit || readCache.size >= 8)) {
      const oldest = readCache.keys().next().value; readCacheBytes -= readCache.get(oldest).bytes; readCache.delete(oldest)
    }
    readCache.set(id, { stamp, state, bytes }); readCacheBytes += bytes
  }
  async function loadState(id) {
    for(let attempt=0;;attempt++){try{return await loadStateOnce(id)}catch(error){if(error.code!=='ENOENT'||attempt>=4)throw error}}
  }
  async function loadStateOnce(id) {
    const stamp = await version(id), cached = readCache.get(id)
    if (cached?.stamp === stamp) { readCache.delete(id); readCache.set(id, cached); return cached.state }
    const key = id + '\n' + stamp
    let task = readFlights.get(key)
    if (!task) {
      task = (async () => { const state = await materialize(id); if (await version(id) === stamp) cacheState(id, stamp, state); return state })()
      readFlights.set(key, task); task.finally(() => { if (readFlights.get(key) === task) readFlights.delete(key) }).catch(() => {})
    }
    return task
  }

  function warnMaintenance(message, error) {
    // A logger failure must not turn a committed write into a retryable error.
    try { logger?.warn?.(message, String(error?.message || error)) } catch {}
  }

  function layout(chatId) {
    const id = safeChatId(chatId)
    const root = path.join(chatsRoot, id)
    return {
      id,
      root,
      snapshots: path.join(root, 'snapshots'),
      journals: path.join(root, 'journals'),
      legacy: path.join(chatsRoot, id + '.json'),
      legacyRelative: 'chats/' + id + '.json'
    }
  }

  function serialize(chatId, operation) {
    const id = safeChatId(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    // Keep the lock outside the removable chat directory. Hold it from the
    // latest materialization through append/rotation (and deletion).
    const current = previous.catch(function () {}).then(() => mutationLocks.withLock(path.join(chatsRoot, id), operation, { waitMs: 30_000 }))
    mutationTails.set(id, current)
    return current.finally(function () { if (mutationTails.get(id) === current) mutationTails.delete(id) })
  }

  async function legacyRead(paths) {
    if (legacyData && typeof legacyData.readJson === 'function') return await legacyData.readJson(paths.legacyRelative)
    return await readJson(paths.legacy)
  }

  async function snapshotRows(paths) {
    let names
    try { names = await readdir(paths.snapshots) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = SNAPSHOT_PATTERN.exec(name)
      return match === null ? null : { name, revision: Number(match[1]), path: path.join(paths.snapshots, name) }
    }).filter(Boolean).sort(function (left, right) { return left.revision - right.revision })
  }

  async function journalRows(paths) {
    let names
    try { names = await readdir(paths.journals) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = JOURNAL_PATTERN.exec(name)
      if (match === null) return null
      return {
        name,
        start: Number(match[1]),
        end: match[2] === 'open' ? Number.POSITIVE_INFINITY : Number(match[3]),
        open: match[2] === 'open',
        path: path.join(paths.journals, name)
      }
    }).filter(Boolean).sort(function (left, right) { return left.start - right.start || Number(left.open) - Number(right.open) })
  }

  async function parseJournal(row, afterRevision, targetRevision, chatId) {
    const text = await readFile(row.path, 'utf8')
    metric(chatId, 'parseBytes', Buffer.byteLength(text))
    const lines = text.split('\n')
    const frames = []
    let validBytes = 0
    let invalidLine = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line === '') {
        validBytes += index < lines.length - 1 ? 1 : 0
        continue
      }
      let frame
      try { frame = await decodePackedJson(line) } catch (error) {
        if (['DSH_TAVERN_PACKED_JSON_INVALID','DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'].includes(error.code)) throw error
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal 尾行损坏，忽略该行及后续内容:', row.path + ':' + invalidLine, String(error?.message || error))
        break
      }
      validBytes += Buffer.byteLength(line + '\n')
      const revision = Number(frame && frame.revision)
      if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(frame.changes)) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal frame 不合法，忽略该行及后续内容:', row.path + ':' + invalidLine)
        break
      }
      if (revision > afterRevision && revision <= targetRevision) frames.push(frame)
    }
    return { frames, lineCount: frames.length, bytes: Buffer.byteLength(text), validBytes, invalidLine }
  }

  async function materializeDirectory(paths, targetRevision = Number.POSITIVE_INFINITY) {
    const snapshots = await snapshotRows(paths)
    const eligible = snapshots.filter(function (row) { return row.revision <= targetRevision })
    const latest = eligible.at(-1)
    if (latest === undefined) throw Object.assign(new Error('Chat Journal 缺少可用 snapshot: ' + paths.id), {code: targetRevision === Infinity ? 'DSH_TAVERN_SNAPSHOT_MISSING' : 'DSH_TAVERN_REVISION_NOT_FOUND'})
    let chat, selected
    for (const row of eligible.toReversed()) {
      try {
        const value = await parsedFile(row.path, paths.id)
        if (!value || typeof value !== 'object' || Array.isArray(value) || revisionOf(value) !== row.revision) throw new SyntaxError('快照修订号无效')
        chat = resources ? await resources.decodeChat(value) : value; requiredContract(chat); selected = row; break
      } catch (error) {
        if (!(error instanceof SyntaxError) && error.code !== 'DSH_TAVERN_PACKED_JSON_INVALID') throw error
        warnMaintenance('dsh-tavern: snapshot 损坏，尝试完整恢复链：' + row.path, error)
      }
    }
    if (!selected) throw Object.assign(new Error('Chat 快照损坏且没有可用恢复链：' + paths.id), {code:'DSH_TAVERN_SNAPSHOT_CORRUPT'})
    let revision = selected.revision
    let open = null
    let openFrameCount = 0
    let openValidBytes = 0
    let openInvalidLine = 0
    const changes = []
    for (const row of await journalRows(paths)) {
      if (row.end <= revision || row.start > targetRevision) continue
      const parsed = await parseJournal(row, revision, targetRevision, paths.id)
      for (const frame of parsed.frames) {
        if (Number(frame.baseRevision) !== revision || Number(frame.revision) !== revision + 1) {
          const error = new Error('Chat journal revision 不连续: ' + row.path + '，期望 ' + (revision + 1) + '，实际 ' + frame.revision)
          error.code = 'DSH_TAVERN_JOURNAL_GAP'
          throw error
        }
        if (!Array.isArray(frame.changes)) throw new Error('JSON mutation changes 必须是数组')
        for (const change of resources ? await resources.decodeChanges(frame.changes) : frame.changes) changes.push(change)
        revision = Number(frame.revision)
      }
      if (row.open) {
        open = row
        openFrameCount = parsed.frames.length
        openValidBytes = parsed.validBytes
        openInvalidLine = parsed.invalidLine
      }
    }
    if (revision < latest.revision) throw Object.assign(new Error('Chat 最新快照损坏且恢复日志不完整，未回退丢失已保存内容：' + paths.id), {code:'DSH_TAVERN_SNAPSHOT_CORRUPT'})
    if (targetRevision !== Number.POSITIVE_INFINITY && revision !== targetRevision) {
      const error = new Error('Chat Journal 找不到 revision ' + targetRevision + ': ' + paths.id)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    // Replay the ordered changes in one clone. Cloning the full card once per
    // journal frame makes initialization slower with every small script write.
    chat = applyJsonChangesShared(chat, changes)
    requiredContract(chat)
    chat[STORAGE_REVISION] = revision
    return { chat, revision, snapshot: selected, open, openFrameCount, openValidBytes, openInvalidLine }
  }

  async function materialize(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    await checkFormat()
    const paths = layout(chatId)
    if (await exists(paths.root) && ((await snapshotRows(paths)).length || (await journalRows(paths)).length)) return await materializeDirectory(paths, targetRevision)
    const chat = await legacyRead(paths)
    if (chat === undefined) return null
    const revision = revisionOf(chat)
    if (targetRevision !== Number.POSITIVE_INFINITY && targetRevision !== revision) {
      const error = new Error('Legacy Chat 只有 revision ' + revision + '，无法读取 revision ' + targetRevision)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    chat[STORAGE_REVISION] = revision
    const decoded=resources ? await resources.decodeChat(chat) : jsonClone(chat)
    requiredContract(decoded)
    return { chat: decoded, revision, snapshot: null, open: null, openFrameCount: 0, legacy: true }
  }

  async function writeSnapshot(paths, chat, revision, signal) {
    signal?.throwIfAborted()
    await storageFormat.mark()
    await mkdir(paths.snapshots, { recursive: true })
    const target = path.join(paths.snapshots, revisionName(revision) + '.json')
    // Only publish complete JSON. Readers may list snapshots during rotation.
    if (await exists(target)) return target
    const temporary = target + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp'
    try {
      const encoded=await encodeSnapshot(resources ? await resources.encodeChat(chat) : chat,chat)
      signal?.throwIfAborted()
      await writeFile(temporary, encoded, { encoding: 'utf8', flag: 'wx', flush: true })
      signal?.throwIfAborted()
      try { await link(temporary, target) } catch (error) {
        if (error?.code === 'EEXIST') return target
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes(error?.code)) throw error
        // The chat mutation lock makes rename's replacement semantics safe.
        // The complete temporary file is on the same filesystem as its target.
        const present=await exists(target);signal?.throwIfAborted()
        if (!present) await renameWithRetry(temporary, target)
      }
      await syncDirectory(paths.snapshots)
    } finally {
      try { await rm(temporary, { force: true }) } catch (error) { warnMaintenance('dsh-tavern: snapshot 临时文件清理失败，保留已发布快照:', error) }
    }
    return target
  }

  async function migrateLegacy(paths, current) {
    await mkdir(paths.journals, { recursive: true })
    await writeSnapshot(paths, current, revisionOf(current))
    if (!(await exists(paths.legacy)) && !(legacyData && typeof legacyData.remove === 'function')) return
    const backup = path.join(chatsRoot, paths.id + '.legacy-' + now() + '.json')
    await writeFile(backup, await encodeSnapshot(current), { encoding: 'utf8', flag: 'wx', flush: true })
    if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
    else await rm(paths.legacy, { force: true })
  }

  async function appendFrame(paths, frame, currentOpen, encoded, signal) {
    await storageFormat.mark()
    await mkdir(paths.journals, { recursive: true })
    signal?.throwIfAborted()
    const openPath = currentOpen === null
      ? path.join(paths.journals, revisionName(frame.revision) + '-open.jsonl')
      : currentOpen.path
    await appendFile(openPath, encoded, {encoding:'utf8', flush:true})
    if (currentOpen === null) await syncDirectory(paths.journals)
    return { path: openPath, start: currentOpen === null ? frame.revision : currentOpen.start, open: true }
  }

  async function maybeRotate(paths, state, open, frameCount, force = false) {
    const info = await stat(open.path)
    if (!force && frameCount < frameLimit && info.size < byteLimit) return
    await writeSnapshot(paths, state.chat, state.revision)
    const sealed = path.join(paths.journals, revisionName(open.start) + '-' + revisionName(state.revision) + '.jsonl')
    await renameWithRetry(open.path, sealed)
    await syncDirectory(paths.journals)
    if (options.retention !== false) await pruneLocked(paths, state.chat, {dryRun:false})
    return true
  }

  async function pruneLocked(paths, chat, {dryRun=true,protectedRevisions=[]}={}) {
    if (chat?.nativeHistoryEdit || chat?.pendingSurfaceRollback || chat?.pendingRegeneration) return {dryRun,files:[],bytes:0,protected:['unfinished-recovery']}
    const snapshots=await snapshotRows(paths),journals=await journalRows(paths),latest=snapshots.at(-1)
    if (!latest) return {dryRun,files:[],bytes:0}
    const encoded=await readJson(latest.path),verified=resources?await resources.decodeChat(encoded):encoded
    if (!verified || revisionOf(verified)!==latest.revision || verified.id!==paths.id) throw Error('最新 Chat 快照未通过回读验证，停止清理')
    const needed=[...protectedRevisions,...[...revisionProtectors].flatMap(provider=>provider(paths.id)),...await options.protectedRevisions?.(paths.id,chat)||[],...(chat?.timeline?.checkpoints||[]).filter(c=>c.before===undefined).map(c=>c.beforeRevision),...Object.values(chat?.timeline?.operations||{}).filter(op=>op.status==='running').map(op=>op.beforeRevision)].filter(n=>Number.isSafeInteger(n)&&n>=0)
    const retained=snapshots.slice(-Math.max(1,options.snapshotLimit||3))
    const target=Math.min(retained[0].revision,...needed),anchor=snapshots.findLast(s=>s.revision<=target)
    if (!anchor) return {dryRun,files:[],bytes:0,protected:['missing-reference-anchor']}
    const keep=new Set([...retained.map(row=>row.name),anchor.name]),rows=[]
    for(const row of snapshots)if(!keep.has(row.name))rows.push(await retentionFile(dataRoot,path.relative(dataRoot,row.path),'unreferenced-snapshot'))
    for(const row of journals)if(!row.open&&row.end<=anchor.revision)rows.push(await retentionFile(dataRoot,path.relative(dataRoot,row.path),'covered-journal'))
    return {...await applyRetentionFiles(dataRoot,rows,{dryRun}),protected:needed.length?[{anchor:anchor.revision,revisions:needed}]:[]}
  }
  async function retentionInputs(chatId){
    const chat=options.protectedRevisions&&options.protectedRevisionsUsesChat!==false?(await loadState(safeChatId(chatId)))?.chat:undefined
    return {id:chatId,protectedRevisions:[...[...revisionProtectors].flatMap(provider=>provider(chatId)),...await options.protectedRevisions?.(chatId,chat)||[]]}
  }
  async function prune(chatId,settings={}) {
    return serialize(chatId,async()=>{const paths=layout(chatId),state=await materialize(chatId);return pruneLocked(paths,state?.chat,settings)})
  }

  async function readReadonly(chatId) {
    const id = safeChatId(chatId)
    metric(id, 'chatReads')
    return freezeJson((await loadState(id))?.chat)
  }
  async function read(chatId) { return copy(safeChatId(chatId), await readReadonly(chatId)) }

  async function readRevision(chatId, revision) {
    const target = Number(revision)
    if (!Number.isSafeInteger(target) || target < 0) throw new Error('Chat storage revision 不合法: ' + String(revision))
    const state = await materialize(chatId, target)
    return state === null ? undefined : jsonClone(state.chat)
  }

  async function update(chatId, updater, metadata = {}) {
    metadata.signal?.throwIfAborted()
    if (typeof updater !== 'function') throw new Error('Chat Journal Store 缺少 updater')
    return await serialize(chatId, async function () {
      const paths = layout(chatId)
      const currentState = await loadState(paths.id)
      metadata.signal?.throwIfAborted()
      const current = currentState?.chat
      let produced = finishJsonDraft(await updater(copy(paths.id, current)))
      metadata.signal?.throwIfAborted()
      if (produced === undefined) return metadata.readonlyResult ? current : copy(paths.id, current)
      // The marker protects historical frames too. Completing/pruning pending
      // work or restoring an older logical branch must never unlock old readers.
      if(current?.tavernCardMvuContract===1&&produced&&typeof produced==='object'&&produced.tavernCardMvuContract===undefined)produced={...produced,tavernCardMvuContract:1}
      requiredContract(produced)
      const changes = current === undefined ? [] : durableChanges(current, diffJson(current, produced))
      const next = current === undefined ? jsonClone(produced) : applyJsonChangesShared(current, changes)
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('Chat Journal 只能保存 JSON object')
      if (currentState === null) {
        await mkdir(paths.journals, { recursive: true })
        await writeSnapshot(paths, next, revisionOf(next), metadata.signal)
        cacheState(paths.id, await version(paths.id), { chat: next, revision: revisionOf(next), snapshot: {revision:revisionOf(next)}, open: null, openFrameCount:0, openValidBytes:0 })
        metric(paths.id, 'journalWrites')
        return metadata.readonlyResult ? next : copy(paths.id, next)
      }
      const baseRevision = currentState.revision
      const revision = revisionOf(next)
      if (revision !== baseRevision + 1) throw new Error('Chat Journal 写入 revision 非连续，期望 ' + (baseRevision + 1) + '，实际 ' + revision)
      if (changes.length === 0) return current
      if (currentState.legacy) await migrateLegacy(paths, current)
      if (currentState.open !== null && currentState.openInvalidLine > 0) {
        await truncate(currentState.open.path, currentState.openValidBytes)
      }
      const frame = {
        schemaVersion: 1,
        chatId: paths.id,
        baseRevision,
        revision,
        timestamp: now(),
        source: String(metadata.source || 'unknown'),
        changes
      }
      if (metadata.requestId) frame.requestId = String(metadata.requestId)
      if (metadata.operationId) frame.operationId = String(metadata.operationId)
      const encodedFrame = await encodeFrame(resources ? {...frame,changes:await resources.encodeChanges(frame.changes)} : frame,next)
      metadata.signal?.throwIfAborted()
      const open = await appendFrame(paths, frame, currentState.open, encodedFrame, metadata.signal)
      let rotated = false, rotationFailed = false
      try {
        const unfinishedRotation = currentState.open && currentState.snapshot && currentState.open.start <= currentState.snapshot.revision
        rotated = await maybeRotate(paths, { chat: next, revision }, open, currentState.openFrameCount + 1, unfinishedRotation || (!!current.nativeHistoryEdit && !next.nativeHistoryEdit))
      } catch (error) {
        rotationFailed = true
        warnMaintenance('dsh-tavern: Chat 已提交，轮转暂缓，下次写入重试：' + paths.id, error)
      }
      const frameBytes = Buffer.byteLength(encodedFrame)
      if (!rotationFailed) cacheState(paths.id, await version(paths.id), { chat: next, revision, snapshot: rotated ? {revision} : currentState.snapshot, open: rotated ? null : open, openFrameCount: rotated ? 0 : currentState.openFrameCount + 1, openValidBytes: rotated ? 0 : (currentState.openValidBytes || 0) + frameBytes, openInvalidLine:0 })
      if(rotationFailed){const cached=readCache.get(paths.id);if(cached){readCacheBytes-=cached.bytes;readCache.delete(paths.id)}}
      metric(paths.id, 'journalWrites')
      return metadata.readonlyResult ? next : copy(paths.id, next)
    })
  }

  async function version(chatId) {
    for(let attempt=0;;attempt++){try{return await versionOnce(chatId)}catch(error){if(error.code!=='ENOENT'||attempt>=4)throw error}}
  }
  async function versionOnce(chatId) {
    const paths = layout(chatId)
    if (!(await exists(paths.root)) || (!(await snapshotRows(paths)).length && !(await journalRows(paths)).length)) {
      if (legacyData && typeof legacyData.version === 'function') return await legacyData.version(paths.legacyRelative)
      try {
        const info = await stat(paths.legacy, { bigint: true })
        return ['legacy', info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    }
    const snapshots = await snapshotRows(paths)
    const journals = await journalRows(paths)
    const latestSnapshot = snapshots[snapshots.length - 1]
    const latestJournal = journals[journals.length - 1]
    if (latestSnapshot === undefined && latestJournal === undefined) return ''
    let journalState = ''
    if (latestJournal !== undefined) {
      const info = await stat(latestJournal.path, { bigint: true })
      journalState = [latestJournal.name, info.size, info.mtimeNs].join(':')
    }
    const snapshotInfo=latestSnapshot?await stat(latestSnapshot.path,{bigint:true}):null
    return ['journal', latestSnapshot && latestSnapshot.name || '', snapshotInfo?[snapshotInfo.size,snapshotInfo.mtimeNs].join('-'):'', journalState].join(':')
  }

  async function remove(chatId) {
    await serialize(chatId, async function () {
      const paths = layout(chatId)
      const cached=readCache.get(paths.id);if(cached){readCacheBytes-=cached.bytes;readCache.delete(paths.id)}
      await rm(paths.root, { recursive: true, force: true })
      if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
      else await rm(paths.legacy, { force: true })
      let names
      try { names = await readdir(chatsRoot) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
      await Promise.all(names.filter(function (name) { return name.startsWith(paths.id + '.legacy-') && name.endsWith('.json') }).map(function (name) {
        return rm(path.join(chatsRoot, name), { force: true })
      }))
    })
  }

  /** Offline/maintenance migration, also safe to resume after any promoted file.
   * Every snapshot and frame is independently decodable in both formats, so no
   * directory swap or revision renumbering is needed. Recovery originals remain
   * untouched. A complete Home backup is still required for older-code rollback.
   */
  async function migrateResources(chatId) {
    if(!resources)throw Error('Chat 资源存储未启用')
    return serialize(chatId,async()=>{
      const paths=layout(chatId),before=await materialize(chatId)
      if(!before)return {chatId,files:0,changed:0,bytesBefore:0,bytesAfter:0}
      const snapshots=await snapshotRows(paths),journals=await journalRows(paths)
      const targets=[...snapshots.map(row=>({path:row.path,kind:'snapshot'})),...journals.map(row=>({path:row.path,kind:'journal'}))]
      if(before.legacy&&await exists(paths.legacy))targets.push({path:paths.legacy,kind:'snapshot'})
      const report={chatId,revision:before.revision,files:targets.length,changed:0,skippedEncoding:0,bytesBefore:0,bytesAfter:0}
      // Receipts skip only encoding. Actual archive bytes and every referenced
      // object are decoded again below, including on another process's first run.
      // Unknown custom codecs cannot inherit the standard encoder's receipts.
      const encoder=options.migrationEncoderRevision || (!options.resourceCodec?await migrationEncoderRevision():undefined)
      const receiptPath=path.join(dataRoot,'maintenance/resource-migration-receipts.json')
      const receiptRows=value=>value?.version===1&&value.encoder===encoder&&value.files&&typeof value.files==='object'&&!Array.isArray(value.files)?value.files:{}
      let receipt
      if(encoder){try{const bytes=await mutationLocks.read(receiptPath);if(bytes)receipt=JSON.parse(bytes)}catch(error){if(!(error instanceof SyntaxError))throw error}}
      const known=receiptRows(receipt),verified={}
      for(const target of targets){
        const source=await readFile(target.path,'utf8')
        const relative=path.relative(dataRoot,target.path).split(path.sep).join('/'),sourceHash=createHash('sha256').update(source).digest('hex')
        const reuse=encoder&&Object.hasOwn(known,relative)&&known[relative]===sourceHash
        let encoded
        if(target.kind==='snapshot'){
          const value=await resources.decodeChat(await decodePackedJson(source))
          if(reuse)encoded=source
          else{
            options.onMigrationEncode?.(target.kind,target.path)
            encoded=await encodeSnapshot(await resources.encodeChat(value),value)
            if(!isDeepStrictEqual(value,await resources.decodeChat(await decodePackedJson(encoded))))throw Error('迁移快照回读不一致')
          }
        }else{
          const lines=[]
          for(const line of source.split('\n')){
            if(!line.trim())continue
            const frame=await decodePackedJson(line)
            const changes=await resources.decodeChanges(frame.changes)
            let next=line
            if(!reuse){
              options.onMigrationEncode?.(target.kind,target.path)
              next=await encodeFrame({...frame,changes:await resources.encodeChanges(changes)},before.chat)
              if(!isDeepStrictEqual(changes,await resources.decodeChanges((await decodePackedJson(next)).changes)))throw Error('迁移日志回读不一致')
            }
            lines.push(next.trimEnd())
          }
          encoded=reuse?source:lines.length?lines.join('\n')+'\n':''
        }
        if(reuse)report.skippedEncoding++
        report.bytesBefore+=Buffer.byteLength(source);report.bytesAfter+=Buffer.byteLength(encoded)
        if(encoded!==source){await storageFormat.mark();await mutationLocks.write(target.path,encoded);report.changed++;await options.afterMigrationFile?.(report.changed,target.path)}
        if(encoder)verified[relative]=createHash('sha256').update(encoded).digest('hex')
      }
      const cached=readCache.get(paths.id);if(cached){readCacheBytes-=cached.bytes;readCache.delete(paths.id)}
      const after=await materialize(chatId)
      if(!isDeepStrictEqual(resources.logical(before.chat),resources.logical(after.chat)))throw Error('迁移后 Chat 内容不一致，请保留现场并恢复备份')
      report.logicalSha256=createHash('sha256').update(JSON.stringify(resources.logical(after.chat))).digest('hex')
      if(encoder)await mutationLocks.update(receiptPath,bytes=>{
        let current;try{current=bytes?JSON.parse(bytes):undefined}catch{}
        const files=Object.fromEntries([...Object.entries(receiptRows(current)).filter(([key])=>!Object.hasOwn(verified,key)),...Object.entries(verified)].slice(-migrationReceiptLimit))
        const next=Buffer.from(JSON.stringify({version:1,encoder,files})+'\n')
        return bytes?.equals(next)?undefined:next
      },{waitMs:30000})
      return report
    })
  }

  return Object.freeze({ read, readReadonly, readRevision, update, version, remove, prune, protectRevisions, retentionInputs, migrateResources })
}
