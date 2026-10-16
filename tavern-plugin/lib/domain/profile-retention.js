import {createProfileDataStore} from '../profile-data-store.js'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {retentionFiles,retentionFile,applyRetentionFiles,createRetentionService} from './retention-policy.js'
import {createRollingDiagnosticStorage} from './rolling-diagnostics.js'
import {retainModelRequests} from './model-request-retention.js'
import {decodePackedJson} from '../packed-json.js'
import {decodeSpFloorArchive} from './sp-floor-archive-format.js'
import {createStorageFormat} from './storage-format.js'

const digest=value=>createHash('sha256').update(String(value)).digest('hex')
const shared=/^(preset-history|chat-resources|resource-versions|sp-floor-archives|sp-static-data|sp-vector-indexes|scene-images\/worldbooks)\/([a-f0-9]{64})\.json$/
const ignored=/^(cache|model-requests|diagnostics)\//
const scanCaches=new Map()
function scanCache(root){
 const key=path.resolve(root);if(!scanCaches.has(key)){if(scanCaches.size>=4)scanCaches.delete(scanCaches.keys().next().value);scanCaches.set(key,{rows:new Map(),bytes:0})}return scanCaches.get(key)
}

/** Mark all retained snapshots, journals, recovery records and library resources before sweeping. */
export async function profileReferencePlan(dataRoot,{presetVersions=1,exclude=new Set(),onScan}={}){
  const marker=await createStorageFormat(dataRoot,{maximumVersion:5}).read()
  // Page graphs intentionally retain every immutable root and orphan in the
  // first format4 candidate. A legacy resource sweep cannot own their closure.
  if(marker?.formatVersion>=4)return {files:[],references:new Set(),protected:['format4-no-gc']}
  const archiveStore=createProfileDataStore({dataRoot}),cachedScan=scanCache(dataRoot),cache=cachedScan.rows
  const all=await retentionFiles(dataRoot),candidates=new Map(),references=new Set(),protectedFiles=[]
  function mark(value,target=references){
    if(typeof value==='string'){for(const match of value.matchAll(/[a-f0-9]{64}/g))target.add(match[0]);return}
    if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){mark(key,target);mark(child,target)}
  }
  for(const relative of all){
    if(exclude.has(relative)||ignored.test(relative)||!(/\.jsonl?$/.test(relative)))continue
    const info=await retentionFile(dataRoot,relative,'unreferenced-shared-resource')
    if(!info)continue
    if(info.bytes>128*1024*1024)throw Error('引用文件超过扫描容量，未删除共享资源：'+relative)
    let cached=cache.get(relative)
    if(!cached||cached.stamp!==info.stamp){
      const source=await readFile(path.join(dataRoot,relative),'utf8'),match=relative.match(shared)
      let values
      try{values=relative.endsWith('.jsonl')?await Promise.all(source.split('\n').filter(line=>line.trim()).map(line=>decodePackedJson(line))):[await decodePackedJson(source)]}
      catch{throw Error('引用文件无法解析，未删除共享资源：'+relative)}
      const dependencies=new Set()
      if(match){
        const encoded=values[0],value=match[1]==='preset-history'&&encoded?.$dshPresetArchive===2?await archiveStore.readReadonly(relative):encoded
        let valid=digest(JSON.stringify(value))===match[2]||match[1]==='preset-history'&&value.document&&digest(JSON.stringify(value.document))===match[2]
        if(match[1]==='sp-floor-archives'&&value.spFloorArchiveVersion===2){try{await decodeSpFloorArchive(value,match[2],async relative=>JSON.parse(await readFile(path.join(dataRoot,relative),'utf8')));valid=true}catch{valid=false}}
        mark(encoded,dependencies);mark(value,dependencies)
        cached={stamp:info.stamp,row:{hash:match[2],kind:match[1],resource:value.path||value.snapshot?.presetPath||'<builtin>',at:Number(value.at)||0,archiveKind:value.kind,dependencies,valid}}
      }else{
        const packageMatch=relative.match(/^extension-packages\/([a-f0-9]{64})\.json$/)
        if(packageMatch){const {digest:identity,...body}=values[0]||{};if(identity!==packageMatch[1]||digest(JSON.stringify(body))!==identity)throw Error('扩展包登记摘要不匹配，未删除共享资源：'+relative)}
        for(const value of values)mark(value,dependencies)
        cached={stamp:info.stamp,dependencies}
      }
      // Store only discovered hashes/metadata, never parsed package bodies.
      const old=cache.get(relative);if(old){cachedScan.bytes-=old.bytes;cache.delete(relative)}
      cached.bytes=512+relative.length*2+dependencies.size*160
      if(cached.bytes<=16*1024*1024){
        while(cache.size&&(cache.size>=8192||cachedScan.bytes+cached.bytes>16*1024*1024)){const key=cache.keys().next().value;cachedScan.bytes-=cache.get(key).bytes;cache.delete(key)}
        cache.set(relative,cached);cachedScan.bytes+=cached.bytes
      }
      onScan?.({path:relative,parsedBytes:Buffer.byteLength(source)})
    }else onScan?.({path:relative,cacheHit:true})
    if(cached.row){
      const row={...info,...cached.row};candidates.set(relative,row)
      if(!row.valid){references.add(row.hash);protectedFiles.push({path:relative,reason:'archive-integrity-unknown'})}
    }else for(const hash of cached.dependencies)references.add(hash)
  }

  // Each preset keeps one independently verified old copy even without a Chat reference.
  const newest=new Map()
  for(const row of candidates.values())if(row.kind==='preset-history'&&row.valid){
    if(row.archiveKind==='script-library')continue
    const key=row.resource,rows=newest.get(key)||[]
    rows.push(row);newest.set(key,rows)
  }
  for(const rows of newest.values())for(const row of rows.sort((a,b)=>b.at-a.at).slice(0,presetVersions))references.add(row.hash)
  const visited=new Set()
  while(true){let added=false;for(const row of candidates.values())if(references.has(row.hash)&&!visited.has(row.relative)){visited.add(row.relative);for(const hash of row.dependencies)references.add(hash);added=true}if(!added)break}
  return {files:[...candidates.values()].filter(row=>!references.has(row.hash)).map(({dependencies,hash,kind,valid,resource,at,archiveKind,...file})=>file),references,protected:protectedFiles}
}

export function createProfileRetention({dataRoot,store,journal,backups,remoteCache,readIndex,isBusy=()=>false,sqlitePrune,removeChatReceipts,policy={},commit=operation=>operation(),generation=()=>0,changeGeneration=generation,maintenance=operation=>operation(),onPlan,scanner}){
  const service=createRetentionService({policy}),diagnostics=createRollingDiagnosticStorage(store)
  const exclude=new Set();let tail=Promise.resolve(),preparedReferences=null,preparedSnapshots=null,preparedBackups=null,preparedRetentionInputs=null,cleanGeneration
  service.register('snapshots',async({dryRun})=>{
    const results=[]
    if(!dryRun&&preparedSnapshots){for(const plan of preparedSnapshots)results.push({...plan,...await applyRetentionFiles(dataRoot,plan.files||[],{dryRun:false})})}
    else if(scanner&&dryRun){
      const chats=[];for(const row of (await readIndex()).chats||[]){const id=typeof row==='string'?row:row.id;chats.push(await journal.retentionInputs(id))}
      preparedRetentionInputs=chats
      results.push(...await scanner.snapshots(dataRoot,{chats,snapshotLimit:service.limits.snapshots}))
    }else for(const row of (await readIndex()).chats||[])results.push(await journal.prune(typeof row==='string'?row:row.id,{dryRun}))
    if(dryRun)preparedSnapshots=results
    for(const result of results)for(const file of result.files||[])exclude.add(file.relative)
    return {dryRun,results,bytes:results.reduce((n,row)=>n+(row.bytes||0),0)}
  })
  if(remoteCache)service.register('remote-cache',options=>remoteCache.trim(options))
  if(backups)service.register('recovery-backups',async options=>{const result=await backups.prune({...options,...(!options.dryRun&&preparedBackups?{prepared:preparedBackups}:{})});if(options.dryRun)preparedBackups=result;for(const file of result.files)exclude.add(file.relative);return result})
  service.register('diagnostics',async({dryRun})=>{
    const files=(await retentionFiles(dataRoot,'diagnostics')).filter(file=>!['diagnostics/rolling.json','diagnostics/index.json'].includes(file)&&!file.startsWith('diagnostics/sessions/')&&file.endsWith('.json'))
    const plan=[]
    for(const file of files){const info=await retentionFile(dataRoot,file,'consolidated-diagnostics');if(info)plan.push(info)}
    const legacy=await retentionFile(dataRoot,'diagnostics/rolling.json','consolidated-diagnostics')
    if(!dryRun){await diagnostics.migrate();for(const file of plan)await diagnostics.updateJson(file.relative,current=>current)}
    if(legacy)plan.push(legacy)
    return {dryRun,files:plan,bytes:plan.reduce((n,row)=>n+row.bytes,0)}
  })
  service.register('model-requests',({dryRun,limits})=>retainModelRequests({dataRoot,store,dryRun,limits}))
  service.register('deleted-chats',async({dryRun})=>{
    const live=new Set(((await readIndex()).chats||[]).map(row=>typeof row==='string'?row:row.id)),files=[],protectedFiles=[]
    for(const relative of await retentionFiles(dataRoot,'recovery/deletions')){
      const value=await store.readJson(relative),chat=value?.chat
      if(value?.version!==1||value.cleanupPending!==true||typeof chat?.id!=='string'||!chat.id||/[\\/\0]/.test(chat.id)||['.','..'].includes(chat.id)||typeof chat.sessionId!=='string'||!chat.sessionId||relative!=='recovery/deletions/'+digest(chat.id)+'.json'||live.has(chat.id)){
        protectedFiles.push({path:relative,reason:'unknown-receipt-or-live-chat'});continue
      }
      const receipt=await retentionFile(dataRoot,relative,'completed-deletion-receipt')
      if(!receipt)continue
      try{
        const result=await removeChatArtifacts(chat,{dryRun})
        const removed=await applyRetentionFiles(dataRoot,[receipt],{dryRun})
        files.push(...result.files,...removed.files)
      }catch(error){protectedFiles.push({path:relative,reason:'cleanup-pending',error:String(error.message||error)})}
    }
    for(const file of files)exclude.add(file.relative)
    return {dryRun,files,bytes:files.reduce((sum,row)=>sum+row.bytes,0),protected:protectedFiles}
  })
  service.register('shared-resources',async({dryRun,limits})=>{
    const plan=!dryRun&&preparedReferences?preparedReferences:await (scanner?.references||profileReferencePlan)(dataRoot,{...limits,exclude})
    if(dryRun)preparedReferences=plan
    const result=await applyRetentionFiles(dataRoot,plan.files,{dryRun})
    const sqlite=sqlitePrune?await sqlitePrune(plan.references,{dryRun}):undefined
    return {...result,protected:plan.protected,...(sqlite?{sqlite}:{})}
  })
  function run(options={}){
    const job=tail.catch(()=>{}).then(()=>maintenance(async()=>{
      const marker=await createStorageFormat(dataRoot,{maximumVersion:5}).read()
      if(marker?.formatVersion===5){
       if(await isBusy())return {version:1,dryRun:options.dryRun!==false,status:'busy',results:[],policy:service.limits}
       const results=[],chats=(await readIndex()).chats||[]
       const idleCommit=options.automatic===true&&commit.tryWrite?commit.tryWrite:commit
       await onPlan?.({version:1,dryRun:true,categories:['snapshots']})
       if(!options.only||options.only.includes('snapshots'))for(const row of chats){
        const before=generation()
        results.push(await journal.prune(typeof row==='string'?row:row.id,{dryRun:options.dryRun!==false,commit:operation=>idleCommit(async()=>generation()!==before||await isBusy()?{dryRun:false,status:'changed',files:[],bytes:0}:operation())}))
       }
       const status=results.some(row=>row.status==='busy')?'busy':results.some(row=>row.status==='changed')?'changed':results.some(row=>row.status==='protected')?'protected':'complete'
       const independent=['remote-cache','diagnostics','model-requests'],only=options.only?options.only.filter(category=>independent.includes(category)):independent,auxiliary=await service.run({...options,only})
       const summary=results.reduce((total,row)=>{for(const [key,value]of Object.entries(row.summary||{}))total[key]=(total[key]||0)+value;return total},{ordinary:0,protected:0,expired:0,quarantine:0,confirmedFreedFiles:0,confirmedFreedBytes:0})
       return {version:1,dryRun:options.dryRun!==false,status,summary,results:[{category:'snapshots',results},...auxiliary.results],protected:['shared-resources-closure-unproven','recovery-backups','deleted-chats'],policy:service.limits}
      }
      if(marker?.formatVersion===4){
        if(await isBusy())return {version:1,dryRun:options.dryRun!==false,status:'busy',results:[],policy:service.limits}
        // Optional request evidence, rolling diagnostics and re-fetchable cache
        // are not history authority. Retain their existing cleanup contract.
        const independent=['remote-cache','diagnostics','model-requests'],only=options.only?options.only.filter(category=>independent.includes(category)):independent
        const result=await commit(()=>service.run({...options,only}))
        return {...result,status:'protected',reason:'format4-no-gc',protected:['snapshots','shared-resources','recovery-backups','deleted-chats']}
      }
      const changed=changeGeneration()
      if(options.automatic===true&&options.dryRun===false&&!options.only&&changed===cleanGeneration)return {version:1,dryRun:false,status:'unchanged',reason:'generation-unchanged',results:[],policy:service.limits}
      exclude.clear();preparedReferences=null;preparedSnapshots=null;preparedBackups=null;preparedRetentionInputs=null
      if(await isBusy())return {version:1,dryRun:options.dryRun!==false,status:'busy',results:[],policy:service.limits}
      const before=generation(),plan=await service.run({...options,dryRun:true})
      await onPlan?.(plan)
      if(options.dryRun!==false)return plan
      const independent=new Set(['remote-cache','diagnostics']),requested=options.only||plan.results.map(row=>row.category)
      const result=await commit(async()=>{
        // Released/duplicate borrowed reads need no extra protection. Only a new
        // protected revision can make the conservative scan unsafe.
        const latestInputs=preparedRetentionInputs?await Promise.all(preparedRetentionInputs.map(row=>journal.retentionInputs(row.id))):[]
        const protectionsChanged=latestInputs.some((row,index)=>row.protectedRevisions.some(revision=>!preparedRetentionInputs[index].protectedRevisions.includes(revision)))
        if(generation()!==before||protectionsChanged)return {...plan,dryRun:false,status:'changed',reason:protectionsChanged?'new-protection':'generation-changed',results:[],message:'扫描期间发生其他操作，本次暂缓删除，下次重新规划'}
        exclude.clear()
        return service.run({...options,dryRun:false,only:requested.filter(category=>!independent.has(category))})
      })
      if(result.status==='changed')return result
      // Re-fetchable bodies and diagnostics have their own cache/index locks.
      // They never delete plot/history authority and need no global write lease.
      const auxiliary=await service.run({...options,dryRun:false,only:requested.filter(category=>independent.has(category))})
      const results=new Map([...result.results,...auxiliary.results].map(row=>[row.category,row]))
      if(!options.only&&changeGeneration()===changed)cleanGeneration=changed
      return {...result,results:requested.flatMap(category=>results.has(category)?[results.get(category)]:[])}
    }))
    tail=job;return job
  }
  async function removeChatArtifacts(chat,{dryRun=false}={}){
    // A format4 delete only removes live route visibility. Retained immutable
    // roots can still reference images and recovery receipts; there is no GC.
    const pageMode=(await createStorageFormat(dataRoot,{maximumVersion:5}).read())?.formatVersion>=4
    if(await isBusy(chat))throw Error('对话任务尚未停止，未清理附属文件')
    const folders=[...pageMode?[]:['scene-images/'+digest(chat.id)],'model-requests/'+chat.id],rows=[]
    for(const folder of folders)for(const relative of await retentionFiles(dataRoot,folder))rows.push(await retentionFile(dataRoot,relative,'deleted-chat'))
    for(const relative of await retentionFiles(dataRoot,'diagnostics')){
      if(['diagnostics/rolling.json','diagnostics/index.json'].includes(relative)||relative.startsWith('diagnostics/sessions/'))continue
      const value=await store.readJson(relative)
      if(value?.chatId===chat.id||value?.sessionId===chat.sessionId)rows.push(await retentionFile(dataRoot,relative,'deleted-chat'))
    }
    const result=await applyRetentionFiles(dataRoot,rows,{dryRun})
    if(!dryRun){
      if(!pageMode)await removeChatReceipts?.(chat)
      await diagnostics.removeSession(chat.sessionId,chat.id)
      await store.updateJson('model-requests/index.json',value=>value?{...value,requests:(value.requests||[]).filter(row=>row.chatId!==chat.id)}:undefined)
    }
    return pageMode?{...result,status:'protected',reason:'format4-no-gc',logicalDeletion:true,physicalHistoryRetained:true}:result
  }
  return {...service,run,removeChatArtifacts}
}
