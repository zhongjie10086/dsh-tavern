import {createHash} from 'node:crypto'
import {RETENTION_DEFAULTS} from './retention-policy.js'
const wrappers=new WeakMap(),indexFile='diagnostics/index.json',legacyFile='diagnostics/rolling.json'
const bytes=value=>Buffer.byteLength(JSON.stringify(value,null,2)+'\n')
const hash=value=>createHash('sha256').update(String(value)).digest('hex')
const firstAt=value=>{const row=value?.records?.[0];return row?.at||row?.updatedAt||row?.lastSeenAt||row?.createdAt||0}
/** Session directories share one global budget; the index contains no log bodies. */
export function createRollingDiagnosticStorage(store) {
  if(wrappers.has(store))return wrappers.get(store)
  const limit=()=>store.retention?.diagnosticBytes||RETENTION_DEFAULTS.diagnosticBytes
  async function save(index,channel,value) {
    const session=value.sessionId||value.chatId||'global',file='diagnostics/sessions/'+hash(session)+'/'+hash(channel)+'.json'
    const old=index.channels[channel];await store.updateJson(file,()=>value)
    Object.defineProperty(index.channels,channel,{value:{file,bytes:bytes(value),firstAt:firstAt(value),sessionId:value.sessionId,chatId:value.chatId},enumerable:true,writable:true,configurable:true})
    if(old?.file&&old.file!==file)await store.remove?.(old.file)
  }
  async function bound(index) {
    let total=Object.values(index.channels).reduce((sum,row)=>sum+row.bytes,0)+bytes(index)
    while(total>limit()) {
      const [key,meta]=Object.entries(index.channels).sort(([,a],[,b])=>a.firstAt-b.firstAt)[0]||[]
      if(!key)throw Error('诊断容量配置不足')
      const value=await store.readJson(meta.file)
      if(value?.records?.length>1){
        let removed=0,estimated=0;const target=total-limit()
        while(removed<value.records.length-1&&estimated<target){estimated+=bytes(value.records[removed++])+4}
        value.records.splice(0,removed);value.dropped=(value.dropped||0)+removed;index.dropped+=removed;await save(index,key,value)
      }else{await store.remove?.(meta.file);delete index.channels[key];index.dropped+=(value?.records?.length||1)}
      total=Object.values(index.channels).reduce((sum,row)=>sum+row.bytes,0)+bytes(index)
    }
    return index
  }
  async function initialize(previous) {
    if(previous){if(previous.version!==2)throw Error('诊断索引版本无效');return previous}
    const legacy=await store.readJson(legacyFile),index={version:2,dropped:legacy?.dropped||0,channels:{}}
    for(const [channel,value]of Object.entries(legacy?.channels||{}))await save(index,channel,value)
    return index
  }
  async function finishLegacyMigration() {
    const verified=await store.readJson(indexFile),legacy=await store.readJson(legacyFile)
    if(verified?.version!==2||legacy===undefined)return
    // These copies were all imported before publishing the new index. Remove
    // old standalone copies too, so an evicted channel cannot reappear.
    for(const channel of Object.keys(legacy?.channels||{}))if(channel!==indexFile&&channel!==legacyFile&&!channel.startsWith('diagnostics/sessions/')&&await store.readJson(channel)!==undefined)await store.remove?.(channel)
    await store.remove?.(legacyFile)
  }
  const adapter={
    async readJson(channel){
      const index=await store.readJson(indexFile)
      if(index?.channels?.[channel])return store.readJson(index.channels[channel].file)
      if(index)return store.readJson(channel)
      const legacy=await store.readJson(legacyFile);return legacy?.channels?.[channel]??(legacy?.migrated?.includes(channel)?undefined:await store.readJson(channel))
    },
    async updateJson(channel,update){
      if(channel===indexFile||channel===legacyFile||channel.startsWith('diagnostics/sessions/'))throw Error('诊断内部文件不能作为日志通道')
      let result
      await store.updateJson(indexFile,async previous=>{
        const current=await initialize(previous),meta=current.channels[channel],legacy=await store.readJson(channel)
        const value=meta?await store.readJson(meta.file):legacy,next=await update(value)
        if(next!==undefined)await save(current,channel,next)
        await bound(current)
        if(legacy!==undefined)await store.remove?.(channel)
        result=current.channels[channel]?await store.readJson(current.channels[channel].file):undefined
        return current
      })
      await finishLegacyMigration()
      return result
    },
    async migrate(){await store.updateJson(indexFile,async previous=>bound(await initialize(previous)));await finishLegacyMigration()},
    async removeSession(sessionId,chatId){
      await store.updateJson(indexFile,async previous=>{
        const current=await initialize(previous)
        for(const [key,value]of Object.entries(current.channels))if(sessionId&&value.sessionId===sessionId||chatId&&value.chatId===chatId){await store.remove?.(value.file);if(await store.readJson(key)!==undefined)await store.remove?.(key);delete current.channels[key]}
        return bound(current)
      })
      await finishLegacyMigration()
    },
    async usage(){const index=await store.readJson(indexFile);return {bytes:index?Object.values(index.channels).reduce((sum,row)=>sum+row.bytes,bytes(index)):bytes(await store.readJson(legacyFile)||{}),limit:limit(),channels:Object.keys(index?.channels||{}).length,dropped:index?.dropped||0}}
  }
  wrappers.set(store,adapter);wrappers.set(adapter,adapter);return adapter
}
