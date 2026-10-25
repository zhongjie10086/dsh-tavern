import {applySpVectorFlushTask} from './sp-vector-flush-store.js'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { spSqlSchema } from './sp-sql.js'
import {archivedSpTableAliases} from './sp-template-aliases.js'
import { checkScriptStorageBudget, scriptStorageLimits } from './script-storage-budget.js'
// One original table whose DDL no longer matches its header (an earlier template
// state an undo can restore) must not take the whole session view down. Such a
// table has no SQL view; the others keep theirs and the snapshot says why.
function snapshotSchema(data,tableAliases) {
  try { return { schema: spSqlSchema(data,{tableAliases}) } } catch (error) {
    const schema = [], schemaErrors = [], names = new Set()
    for (const key of Object.keys(data || {}).filter(key => key.startsWith('sheet_'))) {
      try {
        for (const table of spSqlSchema({ [key]: data[key] },{tableAliases})) {
          if (names.has(table.name.toLowerCase())) { schemaErrors.push(table.name + ' 与其他表重名'); continue }
          names.add(table.name.toLowerCase()); schema.push(table)
        }
      } catch (sheetError) { schemaErrors.push(String(sheetError?.message || sheetError)) }
    }
    return { schema, schemaErrors: schemaErrors.length ? schemaErrors : [String(error?.message || error)] }
  }
}
export function scriptDatabaseSnapshot(state,{chat}={}) {
  const aliases=chat?archivedSpTableAliases(chat,state.data,state.isolationCode):state.sqlTableAliases
  const { schema, schemaErrors } = snapshotSchema(state.data,aliases), dataRevision = createHash('sha256').update(JSON.stringify([state.data, schema])).digest('hex')
  return { revision: state.revision, dataRevision, data: structuredClone(state.data), settings: structuredClone(state.settings), schema, ...(schemaErrors ? { schemaErrors } : {}), activity: structuredClone(state.activity || null) }
}
const SP_VECTOR_QUEUE_KEY='__dsh_internal_sp129_vector_flush_v1'
function readSpVectorQueue(raw){if(raw===undefined)return{version:1,records:{}};if(typeof raw!=='string')throw Error('SP 向量任务持久集合无效');const value=JSON.parse(raw);if(value?.version!==1||!value.records||typeof value.records!=='object'||Array.isArray(value.records))throw Error('SP 向量任务持久集合无效');return value}
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
    return Object.fromEntries(owners.filter(owner => Object.hasOwn(saved, chat?.scriptStorageOwners?.[owner]||owner)).map(owner => {const value=saved[chat?.scriptStorageOwners?.[owner]||owner],visible=(owner==='extension-sp-database'||owner===(chat?.scriptStorageOwners?.['extension-sp-database']||'extension-sp-database'))&&Object.hasOwn(value||{},SP_VECTOR_QUEUE_KEY)?Object.fromEntries(Object.entries(value).filter(([key])=>key!==SP_VECTOR_QUEUE_KEY)):value;return [owner,readonly?visible:structuredClone(visible)]}))
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
    // One protected record stays inside the mapped owner, so existing raw
    // bundle collection/import carries the queue and its invalidation tombstones.
    const protectedKey=key=>scriptId==='extension-sp-database'&&String(key)===SP_VECTOR_QUEUE_KEY
    if(operation.kind==='sp-vector-flush'){
      if(scriptId!=='extension-sp-database')throw Error('SP 向量任务存储身份无效')
      if(operation.action==='read'){
        const saved=await store.readJson('script-local-storage.json')||{}
        return{records:readSpVectorQueue(saved[owner]?.[SP_VECTOR_QUEUE_KEY]).records}
      }
      if(!['upsert','invalidate','mark-ready','delete'].includes(operation.action)||typeof operation.scopeKey!=='string'||!operation.scopeKey.trim()||operation.scopeKey.length>4096)throw Error('SP 向量任务操作无效')
      const key=operation.scopeKey.trim();if(operation.task&&String(operation.task.scopeKey||'').trim()!==key)throw Error('SP 向量任务 scope 无效')
      let result
      await store.updateJson('script-local-storage.json',async saved=>{
        if(await checkStorageOwner(sessionId,scriptId,lifecycleRevision)!==owner)throw Error('脚本身份已变化')
        const previous=saved?.[owner]||{},queue=readSpVectorQueue(previous[SP_VECTOR_QUEUE_KEY]),raw=Object.hasOwn(queue.records,key)?queue.records[key]:null
        if(raw!==null&&typeof raw!=='string')throw Error('SP 向量任务持久记录无效')
        const change=operation.action==='delete'?{write:raw!==null,value:null,result:null}:applySpVectorFlushTask(raw===null?null:JSON.parse(raw),operation,Date.now());result=change.result
        if(!change.write)return undefined
        const records={...queue.records};if(change.value===null)delete records[key];else{const value=JSON.stringify(change.value);Object.defineProperty(records,key,{value,enumerable:true,writable:true,configurable:true})}
        const encoded=JSON.stringify({...queue,records})
        const data={...previous};Object.defineProperty(data,SP_VECTOR_QUEUE_KEY,{value:encoded,enumerable:true,writable:true,configurable:true});const next={...saved};Object.defineProperty(next,owner,{value:data,enumerable:true,writable:true,configurable:true});return next
      })
      return{result}
    }
    if(operation.kind==='read')return Object.fromEntries(Object.entries((await storageSnapshot([owner]))[owner]||{}).filter(([key])=>!protectedKey(key)))
    const operations = operation.kind === 'batch' ? operation.operations : [operation]
    if (!Array.isArray(operations) || !operations.length || operations.length > 2000) throw new Error('脚本存储批次无效')
    let updated = false
    await store.updateJson('script-local-storage.json', async saved => {
      if(await checkStorageOwner(sessionId,scriptId,lifecycleRevision)!==owner)throw Error('脚本身份已变化')
      const next = { ...saved }, data = { ...next[owner] }
      for (const op of operations) {
        const key = String(op.key), value = String(op.value)
        if (key.length > 4096 || value.length > 8000000) throw new Error('脚本存储超过容量')
        if(protectedKey(key)&&op.kind!=='clear')throw Error('SP 向量任务保留键不可通过普通设置修改')
        if (op.kind === 'set') Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true })
        else if (op.kind === 'remove') delete data[key]
        else if (op.kind === 'clear') for (const key of Object.keys(data)) {if(!protectedKey(key))delete data[key]}
        else throw new Error('存储操作无效')
      }
      if (isDeepStrictEqual(data,saved?.[owner] || {})) return undefined
      const ordinary=Object.fromEntries(Object.entries(data).filter(([key])=>!protectedKey(key)))
      if (Object.keys(ordinary).length > 4096) throw new Error('脚本存储超过 4096 键')
      if (Buffer.byteLength(JSON.stringify(ordinary)) > 16000000) throw new Error('脚本存储超过 16MB')
      updated = true
      Object.defineProperty(next, owner, { value: data, enumerable: true, writable: true, configurable: true })
      return next
    })
    return { updated }
  }
  return { commit, files, fill, storageSnapshot, messageStorageSnapshot, storage }
}
