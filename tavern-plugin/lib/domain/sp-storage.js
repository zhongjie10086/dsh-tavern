import {createProfileDataStore} from '../profile-data-store.js'
import { createHash } from 'node:crypto'
import { mkdir,stat,lstat } from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {freezeJson,jsonBytes} from './readonly-json.js'
import {encodeSpFloorArchive,decodeSpFloorArchive} from './sp-floor-archive-format.js'
import {persistSpVectorIndex} from './sp-vector-index-store.js'
import {mutableJsonDraft,finishJsonDraft} from './json-draft.js'
import {createStorageFormat} from './storage-format.js'

function copySpBranches(input) {
  input=finishJsonDraft(input)
  const checkpoints = input?.timeline?.checkpoints || []
  const hasCheckpointSp = checkpoints.some(checkpoint => checkpoint.before?.spDatabase)
  if (!input?.spDatabase && !hasCheckpointSp) return input
  const chat = { ...input }
  if (input.spDatabase) chat.spDatabase = mutableJsonDraft(input.spDatabase)
  if (hasCheckpointSp) chat.timeline = { ...input.timeline, checkpoints: checkpoints.map(checkpoint => checkpoint.before?.spDatabase
    ? { ...checkpoint, before: { ...checkpoint.before, spDatabase: mutableJsonDraft(checkpoint.before.spDatabase) } }
    : checkpoint) }
  return chat
}

/** Immutable SQL snapshots are written before the journal references them. */
export function createSpStorageStore(journal, { dataRoot, readOnly = false }) {
  const denyWrite=()=>{throw Error('SP storage is read-only')}
  const decoded = new WeakMap()
  const archives=createProfileDataStore({dataRoot}),writtenLayers=new Set();
  async function archiveLayers(value){if(!value||typeof value!=='object')return;const records=value.layerRecords?.checkpoints;if(records)for(const [hash,payload]of Object.entries(records)){if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('楼层记录标识损坏');if(payload?.spLayerArchive)continue;if(createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==hash)throw new Error('楼层记录内容损坏');if(!writtenLayers.has(hash)){const encoded=await encodeSpFloorArchive(payload,archives);await archives.updateJson('sp-floor-archives/'+hash+'.json',async current=>{if(current){await decodeSpFloorArchive(current,hash,archives.readReadonly);return undefined}return encoded});writtenLayers.add(hash);if(writtenLayers.size>1024)writtenLayers.delete(writtenLayers.values().next().value)}records[hash]={spLayerArchive:hash};}for(const [k,child]of Object.entries(value))if(!['layerRecords','data','templateData','guideData','vectorIndex'].includes(k))await archiveLayers(child);if(Array.isArray(value.snapshots))for(const snapshot of value.snapshots)if(snapshot.layerRecords&&Object.hasOwn(snapshot.layerRecords,'checkpoints')){snapshot.layerRecords={...snapshot.layerRecords};delete snapshot.layerRecords.checkpoints}}
  async function archiveVectors(value){
    if(!value||typeof value!=='object')return
    if(value.vectorIndex?.documents)value.vectorIndex=await persistSpVectorIndex(value.vectorIndex,archives)
    for(const [key,child]of Object.entries(value))if(!['data','templateData','guideData','vectorIndex'].includes(key))await archiveVectors(child)
  }
  const layerCache=new Map();let layerCacheBytes=0
  async function resolveLayer(hash){
    if(!/^[a-f0-9]{64}$/.test(hash))throw Error('楼层引用损坏')
    const raw=await archives.readReadonly('sp-floor-archives/'+hash+'.json')
    const cached=layerCache.get(hash)
    if(cached?.raw===raw&&raw)return cached.value
    const value=freezeJson(await decodeSpFloorArchive(raw,hash,archives.readReadonly))
    const bytes=jsonBytes(value)
    if(bytes<=16*1024*1024){
      const old=layerCache.get(hash);if(old){layerCacheBytes-=old.bytes;layerCache.delete(hash)}
      while(layerCache.size && (layerCache.size>=64 || layerCacheBytes+bytes>32*1024*1024)){const key=layerCache.keys().next().value;layerCacheBytes-=layerCache.get(key).bytes;layerCache.delete(key)}
      layerCache.set(hash,{raw,value,bytes});layerCacheBytes+=bytes
    }
    return value
  }
  let connection
  async function db() {
    if (!connection) connection = (async () => {
      const { DatabaseSync } = await import('node:sqlite')
      if(readOnly){
        const file=path.resolve(dataRoot,'sp-database.sqlite'),info=await lstat(file)
        if(!info.isFile()||info.isSymbolicLink())throw Error('SQLite read-only snapshot must be a regular existing file')
        const wal=await stat(file+'-wal').catch(error=>{if(error.code==='ENOENT')return null;throw error})
        // immutable mode cannot see committed WAL pages. Never ignore them or
        // checkpoint a backup; require an independently checkpointed offline copy.
        if(wal?.size)throw Error('SQLite read-only validation requires a checkpointed offline copy; nonempty WAL is present')
        const uri=pathToFileURL(file);uri.searchParams.set('immutable','1')
        return new DatabaseSync(uri,{allowExtension:false,readOnly:true})
      }
      await mkdir(dataRoot, { recursive: true })
      const sql = new DatabaseSync(path.join(dataRoot, 'sp-database.sqlite'), { allowExtension: false })
      sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sp_snapshots (hash TEXT PRIMARY KEY, data TEXT NOT NULL);')
      if(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sp_rows'").get()){
        sql.exec('DROP TABLE sp_rows; PRAGMA wal_checkpoint(TRUNCATE); VACUUM');
      }
      return sql
    })()
    return connection
  }
  async function encode(input) {
    if(readOnly)denyWrite()
    if (!input) return input
    const chat = copySpBranches(input)
    if (chat === input) return input
    if(chat.spDatabase)await archiveLayers(chat.spDatabase);for(const checkpoint of chat.timeline?.checkpoints||[])if(checkpoint.before?.spDatabase)await archiveLayers(checkpoint.before.spDatabase);
    if(chat.spDatabase)await archiveVectors(chat.spDatabase);for(const checkpoint of chat.timeline?.checkpoints||[])if(checkpoint.before?.spDatabase)await archiveVectors(checkpoint.before.spDatabase);
    if (chat.spDatabase?.settings?.storageMode !== 'sqlite') return finishJsonDraft(chat)
    const sql = await db()
    async function visit(value) {
      if (!value || typeof value !== 'object') return
      if (value.data?.mate && Object.keys(value.data).some(k => k.startsWith('sheet_'))) {
        const data = value.data, encoded = JSON.stringify(data), hash = createHash('sha256').update(encoded).digest('hex')
        sql.exec('BEGIN IMMEDIATE')
        try {
          sql.prepare('INSERT OR IGNORE INTO sp_snapshots(hash,data) VALUES (?,?)').run(hash, encoded)
          sql.exec('COMMIT')
        } catch (error) { sql.exec('ROLLBACK'); throw error }
        value.data = { spSqliteSnapshot: hash }
      }
      for (const child of Object.values(value)) await visit(child)
    }
    // Only database state and its own snapshots, never arbitrary card/user objects.
    if (chat.spDatabase) await visit(chat.spDatabase)
    for (const checkpoint of chat.timeline?.checkpoints || []) if (checkpoint.before?.spDatabase) await visit(checkpoint.before.spDatabase)
    return finishJsonDraft(chat)
  }
  function hasSqliteSnapshot(value) {
    if (!value || typeof value !== 'object') return false
    if (value.data && Object.hasOwn(value.data, 'spSqliteSnapshot')) return true
    for (const [key, child] of Object.entries(value)) if (key !== 'data' && hasSqliteSnapshot(child)) return true
    return false
  }
  async function decode(input) {
    if (!input) return input
    if (!hasSqliteSnapshot(input.spDatabase) && !(input.timeline?.checkpoints || []).some(checkpoint => hasSqliteSnapshot(checkpoint.before?.spDatabase))) return input
    const chat = copySpBranches(input)
    if (chat === input) return input
    async function visit(value) {
      if (!value || typeof value !== 'object') return
      if(readOnly&&value.data&&Object.hasOwn(value.data,'spSqliteSnapshot')&&(typeof value.data.spSqliteSnapshot!=='string'||! /^[a-f0-9]{64}$/.test(value.data.spSqliteSnapshot)||Object.keys(value.data).length!==1))throw Error('数据库快照引用损坏')
      if (value.data?.spSqliteSnapshot) {
        const hash = value.data.spSqliteSnapshot
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('数据库快照引用损坏')
        const record = (await db()).prepare('SELECT data FROM sp_snapshots WHERE hash=?').get(hash)
        if (!record || createHash('sha256').update(record.data).digest('hex') !== hash) throw new Error('SQLite 数据库快照缺失或损坏，请恢复数据目录备份')
        value.data = JSON.parse(record.data)
      }
      for (const [key, child] of Object.entries(value)) if (key !== 'data') await visit(child)
    }
    if (chat.spDatabase) await visit(chat.spDatabase)
    for (const checkpoint of chat.timeline?.checkpoints || []) if (checkpoint.before?.spDatabase) await visit(checkpoint.before.spDatabase)
    return finishJsonDraft(chat)
  }
  async function pruneSnapshots(references,{dryRun=true}={}){
    if(readOnly)denyWrite()
    if((await createStorageFormat(dataRoot,{maximumVersion:5}).read())?.formatVersion>=4)return {dryRun,snapshots:0,bytes:0,status:'protected',reason:'format4-no-gc'}
    if(!connection&&!await stat(path.join(dataRoot,'sp-database.sqlite')).catch(e=>{if(e.code==='ENOENT')return null;throw e}))return {dryRun,snapshots:0,bytes:0}
    const sql=await db(),rows=sql.prepare('SELECT hash,length(CAST(data AS BLOB)) AS bytes FROM sp_snapshots').all().filter(row=>!references.has(row.hash))
    if(!dryRun&&rows.length){sql.exec('BEGIN IMMEDIATE');try{for(const row of rows){sql.prepare('DELETE FROM sp_snapshots WHERE hash=?').run(row.hash)}sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}sql.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM')}
    return {dryRun,snapshots:rows.length,bytes:rows.reduce((n,row)=>n+row.bytes,0)}
  }
  async function decodeProjection(id,envelope,paths=[]){
    if(!envelope||!paths.some(pointer=>pointer==='/spDatabase'||pointer.startsWith('/spDatabase/')))return envelope
    const full=await journal.readFields(id,{paths:['/spDatabase'],pinnedRevision:envelope.storageRevision,snapshotId:envelope.snapshotId})
    const field=full.fields[0],decoded=field.found?(await decode({spDatabase:field.value})).spDatabase:undefined
    const fields=envelope.fields.map(row=>{
      if(row.path!=='/spDatabase'&&!row.path.startsWith('/spDatabase/'))return row
      let value=decoded
      for(const part of row.path.slice('/spDatabase'.length).split('/').slice(1).map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'))){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part)){value=undefined;break}value=value[part]}
      return {path:row.path,found:value!==undefined,...value===undefined?{}:{value}}
    })
    return freezeJson({...envelope,fields})
  }
  return { ...journal, ...(readOnly?{remove:denyWrite,prune:denyWrite,migrateResources:denyWrite}:{}), resolveLayer,pruneSnapshots,
    ...(journal.readFields?{readFields:async(id,options={})=>decodeProjection(id,await journal.readFields(id,options),options.paths),
      readMessageWindow:async(id,options={})=>decodeProjection(id,await journal.readMessageWindow(id,options),options.fields),
      readMessageSlice:async(id,options={})=>decodeProjection(id,await journal.readMessageSlice(id,options),options.fields)}:{}),
    readReadonly: async id => {
      const value = await (journal.readReadonly || journal.read)(id)
      if (!value) return value
      if (!decoded.has(value)) decoded.set(value, freezeJson(await decode(value)))
      return decoded.get(value)
    },
    read: async id => mutableJsonDraft(await decode(await journal.read(id))),
    readRevision: async (id, revision) => mutableJsonDraft(await decode(await journal.readRevision(id, revision))),
    update: async (id, mutation, metadata) => {if(readOnly)denyWrite();const raw=await journal.update(id, async stored => encode(await mutation(mutableJsonDraft(await decode(stored)))), metadata);const saved=await decode(raw);if(metadata?.readonlyResult){const frozen=freezeJson(saved);if(raw&&typeof raw==='object')decoded.set(raw,frozen);return frozen}return mutableJsonDraft(saved)},
    close: async () => { if(!readOnly){if(connection)(await connection).close();connection=null;return}const pending=connection;connection=null;if(pending){const sql=await pending.catch(()=>null);sql?.close()} }
  }
}
