import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { spSqlSchema } from './sp-sql.js'
import { checkScriptStorageBudget, scriptStorageLimits } from './script-storage-budget.js'
// One original table whose DDL no longer matches its header (an earlier template
// state an undo can restore) must not take the whole session view down. Such a
// table has no SQL view; the others keep theirs and the snapshot says why.
function snapshotSchema(data) {
  try { return { schema: spSqlSchema(data) } } catch (error) {
    const schema = [], schemaErrors = [], names = new Set()
    for (const key of Object.keys(data || {}).filter(key => key.startsWith('sheet_'))) {
      try {
        for (const table of spSqlSchema({ [key]: data[key] })) {
          if (names.has(table.name.toLowerCase())) { schemaErrors.push(table.name + ' 与其他表重名'); continue }
          names.add(table.name.toLowerCase()); schema.push(table)
        }
      } catch (sheetError) { schemaErrors.push(String(sheetError?.message || sheetError)) }
    }
    return { schema, schemaErrors: schemaErrors.length ? schemaErrors : [String(error?.message || error)] }
  }
}
export function scriptDatabaseSnapshot(state) {
  const { schema, schemaErrors } = snapshotSchema(state.data), dataRevision = createHash('sha256').update(JSON.stringify([state.data, schema])).digest('hex')
  return { revision: state.revision, dataRevision, data: structuredClone(state.data), settings: structuredClone(state.settings), schema, ...(schemaErrors ? { schemaErrors } : {}), activity: structuredClone(state.activity || null) }
}
export function createTavernScriptServices({ database, store, chats, assertOwner = async () => {}, fileLimits = scriptStorageLimits.files }) {
  async function commit(sessionId, command, expectedRevision, lifecycleRevision) {
    const chat = await chats.forSession(sessionId)
    if (!chat || Number(chat.tavernHelperLifecycleRevision || 0) !== Number(lifecycleRevision || 0)) throw new Error('脚本生命周期已变化')
    const next = await database.update(sessionId, { ...command, expectedHelperLifecycleRevision: lifecycleRevision || 0 }, expectedRevision)
    return { database: scriptDatabaseSnapshot(next), changes: next.changes }
  }
  async function files(sessionId, operation, scriptId, lifecycleRevision) {
    await assertOwner(sessionId, scriptId, lifecycleRevision)
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('找不到当前游戏')
    const logicalOwner = String(scriptId || 'shared'),owner=chat.scriptStorageOwners?.[logicalOwner]||logicalOwner
    const file = 'script-files.json', prefix = '/user/files/'
    if (operation.kind === 'write') {
      const content = String(operation.data || '')
      if (Buffer.byteLength(content) > 32_000_000) throw new Error('脚本文件超过 32MB')
      if (String(operation.name).length > 1024) throw new Error('脚本文件名过长')
      const id = createHash('sha256').update(owner + ':' + String(operation.name)).digest('hex')
      await store.updateJson(file, async value => {
        await assertOwner(sessionId, scriptId, lifecycleRevision)
        if (value?.[id]?.owner === owner && value[id].data === content) return undefined
        const next = { ...value, [id]: { owner, name: String(operation.name), data: content, at: Date.now() } }
        checkScriptStorageBudget(value, next, owner, fileLimits, '脚本文件')
        return next
      })
      return { path: prefix + id + '.json', url: prefix + id + '.json' }
    }
    const saved = await store.readJson(file) || {}
    const identify = value => { const name = decodeURIComponent(String(value || '').split('/').at(-1)); return /^[a-f0-9]{64}\.json$/.test(name) ? name.slice(0, -5) : createHash('sha256').update(owner + ':' + name).digest('hex') }
    if (operation.kind === 'verify') return Object.fromEntries((operation.paths || []).map(path => [path, saved[chat.scriptFileAliases?.[identify(path)]||identify(path)]?.owner === owner]))
    const rawId=identify(operation.path),id=chat.scriptFileAliases?.[rawId]||rawId, record = saved[id]
    if (!record && operation.kind === 'read') return { missing: true }
    if (!record || record.owner !== owner) throw new Error('脚本文件不存在')
    if (operation.kind === 'read') return { data: record.data, name: record.name }
    if (operation.kind === 'delete') {
      await store.updateJson(file, async value => { await assertOwner(sessionId, scriptId, lifecycleRevision); if (value?.[id] && value[id].owner !== owner) throw new Error('脚本文件不存在'); const next = { ...value }; delete next[id]; return next })
      return { success: true }
    }
    throw new Error('脚本文件操作无效')
  }
  async function fill(sessionId, lifecycleRevision) {
    const chat = await chats.forSession(sessionId)
    if (!chat || Number(chat.tavernHelperLifecycleRevision || 0) !== Number(lifecycleRevision || 0)) throw new Error('脚本生命周期已变化')
    const result = await database.fill(sessionId, { automatic: false, expectedHelperLifecycleRevision: lifecycleRevision || 0 })
    return { database: scriptDatabaseSnapshot(result) }
  }
  async function storageSnapshot(owners,chat,{readonly=false}={}) {
    const saved = await (readonly&&store.readReadonly?store.readReadonly:store.readJson)('script-local-storage.json') || {}
    return Object.fromEntries(owners.filter(owner => Object.hasOwn(saved, chat?.scriptStorageOwners?.[owner]||owner)).map(owner => {const value=saved[chat?.scriptStorageOwners?.[owner]||owner];return [owner,readonly?value:structuredClone(value)]}))
  }
  const messageOwner=chat=>'card:'+createHash('sha256').update(chat.cardPath).digest('hex')+':message'
  async function checkStorageOwner(sessionId,scriptId,lifecycleRevision) {
    const chat=await chats.forSession(sessionId)
    if(!chat)throw Error('脚本存储没有当前游戏')
    if(scriptId==='__dsh_message__'){
      if(Number(chat.tavernHelperLifecycleRevision||0)!==Number(lifecycleRevision))throw Error('脚本生命周期已变化')
      const owner=messageOwner(chat);return chat.scriptStorageOwners?.[owner]||owner
    }
    await assertOwner(sessionId,scriptId,lifecycleRevision)
    if(!scriptId)throw Error('脚本存储缺少身份')
    return chat.scriptStorageOwners?.[scriptId]||scriptId
  }
  async function messageStorageSnapshot(chat,options) {
    const owner=messageOwner(chat),saved=await storageSnapshot([owner],chat,options)
    return {'__dsh_message__':saved[owner] || {}}
  }
  async function storage(sessionId, operation, scriptId, lifecycleRevision) {
    const owner=await checkStorageOwner(sessionId,scriptId,lifecycleRevision)
    if(operation.kind==='read')return (await storageSnapshot([owner]))[owner] || {}
    const operations = operation.kind === 'batch' ? operation.operations : [operation]
    if (!Array.isArray(operations) || !operations.length || operations.length > 2000) throw new Error('脚本存储批次无效')
    let updated = false
    await store.updateJson('script-local-storage.json', async saved => {
      if(await checkStorageOwner(sessionId,scriptId,lifecycleRevision)!==owner)throw Error('脚本身份已变化')
      const next = { ...saved }, data = { ...next[owner] }
      for (const op of operations) {
        const key = String(op.key), value = String(op.value)
        if (key.length > 4096 || value.length > 8000000) throw new Error('脚本存储超过容量')
        if (op.kind === 'set') Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true })
        else if (op.kind === 'remove') delete data[key]
        else if (op.kind === 'clear') for (const key of Object.keys(data)) delete data[key]
        else throw new Error('存储操作无效')
      }
      if (isDeepStrictEqual(data,saved?.[owner] || {})) return undefined
      if (Object.keys(data).length > 4096) throw new Error('脚本存储超过 4096 键')
      if (Buffer.byteLength(JSON.stringify(data)) > 16000000) throw new Error('脚本存储超过 16MB')
      updated = true
      Object.defineProperty(next, owner, { value: data, enumerable: true, writable: true, configurable: true })
      return next
    })
    return { updated }
  }
  return { commit, files, fill, storageSnapshot, messageStorageSnapshot, storage }
}
