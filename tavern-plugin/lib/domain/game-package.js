import {randomUUID} from 'node:crypto'
import {createContentResourceStore} from './content-resource-store.js'
import {normalizeResourcePath} from './file-resources.js'
import {gamePackageJsonHash as hash} from './game-package-json.js'

const format = 'dsh-tavern-game'
const clone = structuredClone
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const configurationFiles = new Set(['tavern-tool-workbench.json','tavern-extension-settings.json', 'script-local-storage.json', 'script-files.json', 'tavern-script-library.json', 'script-variable-policies.json', 'tavern-remote-asset-pins.json', 'helper-worldbook-bindings.json', 'tavern-extensions.json', 'st-migration.json', 'tavern-settings.json'])
const contentFile = /^(preset-history|sp-floor-archives|sp-static-data|sp-vector-indexes|scene-images\/worldbooks|extension-packages)\/[a-f0-9]{64}\.json$/
export function validateGameDependency(row) {
  if (!row || !['resource', 'profile', 'media', 'cache', 'attachment', 'portrait'].includes(row.kind)) throw Error('整局包依赖类型无效')
  if (row.kind === 'resource' || row.kind === 'portrait') normalizeResourcePath(row.path, row.kind==='portrait'?'card':undefined)
  else if (row.kind === 'profile') {
    if (!configurationFiles.has(row.path) && !contentFile.test(row.path)) throw Error('整局包不支持写入配置路径：' + row.path)
  } else if(row.kind==='media') {
    if(!/^(?:script-images\/[a-f0-9]{64}\.json|scene-images\/[a-f0-9]{64}\/(?:[a-f0-9]{64}|references|plans)\.json)$/.test(row.path))throw Error('整局包媒体路径无效')
  } else if(!validHash(row.path))throw Error('整局包依赖标识无效')
  if (!['json', 'text', 'base64'].includes(row.encoding) || row.encoding !== 'json' && typeof row.value !== 'string' || row.sha256 !== hash(row.value)) throw Error('整局包依赖内容校验失败：' + row.path)
  return row
}
function archiveStore(objects = {}) {
  const values = new Map(Object.entries(objects).map(([sha, value]) => ['chat-resources/' + sha + '.json', value]))
  return {
    readReadonly: async name => values.get(name),
    version: async name => values.has(name) ? 'saved' : undefined,
    updateJson: async (name, work) => {const next = await work(values.get(name)); if (next !== undefined) values.set(name, next); return values.get(name)},
    objects: () => Object.fromEntries([...values].map(([name, value]) => [name.slice(15, -5), value]))
  }
}
/** A personal transfer archive: exact game state plus referenced resources, not a text-only chat export. */
export async function encodeGamePackage(payload, manifest) {
  const store = archiveStore(), contents = createContentResourceStore(store)
  const root = await contents.save(payload)
  const document = {format, version: 1, minimumReader: 'r3-c', manifest, root, objects: store.objects()}
  return {...document, sha256: hash(document)}
}
export async function decodeGamePackage(document) {
  if (!document || document.format !== format || document.version !== 1 || document.minimumReader !== 'r3-c') throw Error('整局包格式不支持，请使用相应版本恢复')
  const {sha256, ...body} = document
  if (!validHash(sha256) || hash(body) !== sha256) throw Error('整局包整体校验失败，未导入任何内容')
  for (const [id, value] of Object.entries(document.objects || {})) if (!validHash(id) || hash(value) !== id) throw Error('整局包内容块校验失败')
  const payload = clone(await createContentResourceStore(archiveStore(document.objects)).load(document.root))
  if (!payload?.chat?.id || !payload.chat.sessionId || !Array.isArray(payload.chat.messages) || !Array.isArray(payload.dependencies) || !Array.isArray(payload.sessions) || !payload.revisions || typeof payload.revisions !== 'object') throw Error('整局包缺少游戏、依赖或原生历史')
  const paths = new Set()
  for (const row of payload.dependencies) {validateGameDependency(row); const key = row.kind + ':' + row.path; if (paths.has(key)) throw Error('整局包依赖路径重复'); paths.add(key)}
  const ids = new Set()
  for (const record of payload.sessions) {
    if (!record?.header?.id || record.header.version !== 3 || !Array.isArray(record.events) || ids.has(record.header.id)) throw Error('整局包原生 Session 无效或重复')
    ids.add(record.header.id)
    for (const [index, event] of record.events.entries()) if (event.seq !== index || typeof event.type !== 'string') throw Error('整局包原生事件序号不连续')
  }
  if (!ids.has(payload.chat.sessionId)) throw Error('整局包缺少正文 Session')
  for (const [revision, chat] of Object.entries(payload.revisions)) if (!/^[1-9][0-9]*$/.test(revision) || chat.id !== payload.chat.id || chat._storageRevision !== Number(revision)) throw Error('整局包历史存档标识不一致')
  return payload
}
export function gamePackageDependency(kind, path, value, encoding = 'json') {return validateGameDependency({kind, path, encoding, value, sha256: hash(value)})}

/** IO is supplied by the live host. Publication is last; a retry resumes the same target IDs. */
export function createGamePackageService({store, chats, native, resources, isBusy = () => false, fault = async () => {}}) {
  const pending = new Map()
  async function exported(sessionId) {
    const source = await chats.forSession(sessionId)
    if (!source || isBusy(source)) throw Error('请等待当前生成和结算完成后导出整局包')
    const chat = clone(source), revisions = {}, required = new Set()
    const inspectCheckpoints = value => {for (const row of value.timeline?.checkpoints || []) if (row.beforeRevision) required.add(Number(row.beforeRevision))}
    inspectCheckpoints(chat)
    for (const revision of required) {
      const before = await chats.readRevision(chat.id, revision)
      if (!before) throw Error('整局包缺少回退历史版本 ' + revision)
      revisions[revision] = clone(before); inspectCheckpoints(before)
    }
    const ids = new Set([source.sessionId])
    for (const value of [chat, ...Object.values(revisions)]) for (const row of Object.values(value.timeline?.participants || {})) if (row.sessionId) ids.add(row.sessionId)
    const sessions = [], missing = []
    for (const id of ids) {
      const record = await native.capture(id)
      if (record) sessions.push(record)
      else if (id === source.sessionId) throw Error('正文 Session 无法读取，未生成不完整搬家包')
      else missing.push({kind: 'background-session', source: id, action: '导入后重建后台上下文'})
    }
    const collected = await resources.collect(chat, revisions, sessions)
    if (isBusy(await chats.forSession(sessionId)) || (await chats.forSession(sessionId))._storageRevision !== source._storageRevision) throw Error('导出期间游戏状态已变化，请重试')
    const payload = {chat, revisions, sessions, dependencies: collected.dependencies}
    const manifest = {
      createdAt: Date.now(), title: String(source.title || source.cardName || '游戏'), messages: chat.messages.length,
      storyCheckpoints: Object.keys(revisions).length, nativeSessions: sessions.length,
      dependencies: payload.dependencies.map(({kind, path, encoding, sha256}) => ({kind, path, encoding, sha256})),
      missing: missing.concat(collected.missing || []), privateData: true,
      notice: '本包包含剧情和脚本配置，可能包含扩展自行保存的密钥，供本人搬家使用。主模型账号凭据、安装程序和系统代理设置不在包内。'
    }
    return encodeGamePackage(payload, manifest)
  }
  async function preview(document) {
    const payload = await decodeGamePackage(document)
    const plan = await resources.preview(payload)
    return {sha256: document.sha256, ...document.manifest, ...plan, modes: ['follow', 'pinned']}
  }
  async function perform({document, operationId, mode = 'follow', trustResources = false}) {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(operationId || '') || !['follow', 'pinned'].includes(mode)) throw Error('整局导入标识或版本模式无效')
    const payload = await decodeGamePackage(document), file = 'game-package-imports/' + operationId + '.json'
    let journal = await store.readJson(file)
    if (journal && (journal.digest !== document.sha256 || journal.mode !== mode || journal.trustResources !== trustResources)) throw Error('同一次整局导入不能更换内容或选项')
    if (journal?.status === 'ready') return journal.result
    if (!journal) {
      const mappings = await resources.prepare(payload, {mode, trustResources})
      journal = {version: 1, digest: document.sha256, mode, trustResources, status: 'prepared', chatId: 'chat-' + randomUUID(), sessions: Object.fromEntries(payload.sessions.map(row => [row.header.id, 'session-' + randomUUID()])), mappings, revisionMap: {}}
      journal.mappings.targetChatId=journal.chatId
      await store.writeJson(file, journal)
    }
    try {
      await fault('prepared')
      await native.validate?.(payload.sessions, journal.sessions)
      await resources.install(payload, journal.mappings, {mode, trustResources})
      const targetSessionId = journal.sessions[payload.chat.sessionId]
      if (!targetSessionId) throw Error('整局导入缺少正文目标')
      for (const row of payload.sessions) await native.restore(row, journal.sessions, journal.mappings)
      await fault('native-written')
      function prepareChat(value) {
        const chat = resources.remap(clone(value), journal.mappings, {mode})
        chat.id = journal.chatId; chat.sessionId = targetSessionId
        chat._storageRevision = 0; chat.gamePackageImport = {operationId, digest: document.sha256, sourceChatId: payload.chat.id,sourceRevision:value._storageRevision||0}
        delete chat.taskMailbox; delete chat.candidateAgent; delete chat.pendingSurfaceRollback; delete chat.pendingRegeneration; delete chat.regenInProgress
        if (chat.timeline) {
          for (const row of chat.timeline.checkpoints || []) if (row.beforeRevision) {const revision = journal.revisionMap[row.beforeRevision]; if (!revision) throw Error('整局回退版本尚未写入'); row.beforeRevision = revision}
          for (const participants of [chat.timeline.participants, ...(chat.timeline.checkpoints || []).map(row => row.participants)]) for (const row of Object.values(participants || {})) {
            if (row.sessionId && journal.sessions[row.sessionId]) row.sessionId = journal.sessions[row.sessionId]
            else if (row.sessionId) {row.sessionId = ''; row.status = 'needs-session'; row.boundary = null}
          }
          chat.timeline.operations = {}
        }
        return chat
      }
      for (const revision of Object.keys(payload.revisions).map(Number).sort((a, b) => a - b)) {
        if (journal.revisionMap[revision]) continue
        const chat = prepareChat(payload.revisions[revision])
        const previous=await chats.read?.(journal.chatId)
        const saved=previous?.gamePackageImport?.operationId===operationId&&previous.gamePackageImport.sourceRevision===revision?previous:await chats.write(chat,{source:'game-package.history'})
        await fault('history-row-written')
        journal.revisionMap[revision] = saved._storageRevision; await store.writeJson(file, journal)
      }
      await fault('history-written')
      const existing = await chats.forSession(targetSessionId)
      if (existing && existing.gamePackageImport?.digest !== document.sha256) throw Error('整局目标已被另一游戏占用')
      await native.attach?.(targetSessionId)
      if (!existing) await chats.publish(prepareChat(payload.chat))
      await fault('published')
      journal = {...journal, status: 'ready', result: {chatId: journal.chatId, sessionId: targetSessionId, mode: payload.chat.mode || 'story', warnings: document.manifest.missing || []}}
      await store.writeJson(file, journal)
      return journal.result
    } catch(error) {
      // Preserve the allocated IDs and completed revision mappings so retrying
      // this operation resumes its existing import rather than creating a copy.
      await store.writeJson(file,{...journal,status:'failed'})
      throw error
    }
  }
  return {export: exported, preview, import(input) {
    const signature = hash([input.document?.sha256, input.mode || 'follow', input.trustResources === true]), old = pending.get(input.operationId)
    if (old) return old.signature === signature ? old.task : Promise.reject(Error('同一次整局导入正在处理其他内容'))
    const task = perform(input).finally(() => pending.delete(input.operationId)); pending.set(input.operationId, {signature, task}); return task
  }}
}
