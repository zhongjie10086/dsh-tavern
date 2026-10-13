import {RETENTION_DEFAULTS} from './retention-policy.js'

/** One quota for re-fetchable remote bodies, including caches backed by different stores. */
export function createRemoteCacheBudget({maxBytes=RETENTION_DEFAULTS.remoteBytes}={}) {
  const stores=new Map()
  let tail=Promise.resolve()
  function register(name,store) { stores.set(name,store);return()=>stores.delete(name) }
  function trim({dryRun=false}={}) {
    const job=tail.catch(()=>{}).then(async()=>{
      const rows=[]
      for(const [name,store] of stores)for(const row of await store.entries())rows.push({...row,store:name})
      rows.sort((a,b)=>a.lastUsed-b.lastUsed||a.key.localeCompare(b.key))
      let totalBytes=rows.reduce((sum,row)=>sum+row.bytes,0)
      const beforeBytes=totalBytes,files=[],skipped=[]
      for(const row of rows){
        if(totalBytes<=maxBytes)break
        if(row.retain===true){skipped.push(row.key);continue}
        if(!dryRun&&await stores.get(row.store).remove(row)===false){skipped.push(row.key);continue}
        files.push({category:row.store,relative:row.key,bytes:row.bytes,reason:'remote-cache-lru'})
        totalBytes-=row.bytes
      }
      return {dryRun,maxBytes,beforeBytes,totalBytes,bytes:beforeBytes-totalBytes,files,skipped}
    })
    tail=job;return job
  }
  return {register,trim}
}
