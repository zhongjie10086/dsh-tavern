// These tools never start services or open a source SQLite database. They only
// restore into fresh private directories and migrate an explicitly supplied copy.
import assert from 'node:assert/strict'
import {mkdir,readFile,readdir,symlink} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {copyInventory,fileHash,homeInventory,inventory,jsonFile,newOutput,plainRoot,safeRelative,sha256,verifyExecutionIdentity} from './r5-candidate-tools.mjs'
import {migrateResourceStorage} from '../../bin/migrate-resource-storage.mjs'
import {createChatRecordsStore,readChatRouteManifest} from '../../tavern-plugin/lib/domain/chat-records-store.js'
import {createStorageFormat} from '../../tavern-plugin/lib/domain/storage-format.js'
import {createChatResourceCodec} from '../../tavern-plugin/lib/domain/chat-resource-codec.js'
import {createSpStorageStore} from '../../tavern-plugin/lib/domain/sp-storage.js'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {decodeSpFloorArchive} from '../../tavern-plugin/lib/domain/sp-floor-archive-format.js'
import {loadSpVectorIndex} from '../../tavern-plugin/lib/domain/sp-vector-index-store.js'

// A Home without links keeps the original receipt shape and fingerprint.
const homeFingerprint=(files,links)=>sha256(JSON.stringify(links.length?{files,links}:files))
const linkCounts=links=>({internal:links.filter(row=>row.scope==='internal').length,external:links.filter(row=>row.scope==='external').length})
export async function recoveryPreflight({homeCopy,output,sourceLabel,offlineCopy=false,externalLinkRoots=[]}){
 assert(offlineCopy===true,'Requires explicit offline-copy attestation; do not point at a running or production Home')
 assert(typeof sourceLabel==='string'&&sourceLabel.trim(),'Explicit source label required; do not reuse backups across sources')
 assert(Array.isArray(externalLinkRoots),'externalLinkRoots must be a list of directories')
 // Links/junctions (a Windows Home keeps hundreds under profiles/) are recorded
 // with their final targets and never followed. Internal targets are ordinary
 // Home files and are copied as such; a link escaping the Home is accepted only
 // into an explicitly declared fixed dependency root, whose bytes are NOT part of
 // this backup. Devices and undeclared external/dangling links still fail closed.
 const scan=()=>homeInventory(homeCopy,{externalLinkRoots}),first=await scan(),source=first.root,before=first.files,links=first.links
 assert(before.some(row=>row.type==='file'),'Refusing an empty Home backup')
 const destination=await newOutput(output,[source,...first.externalLinkRoots]),backup=path.join(destination,'home')
 await mkdir(backup,{mode:0o700});await copyInventory(source,backup,before)
 const again=await scan()
 assert.deepEqual({files:again.files,links:again.links},{files:before,links},'Source changed during backup; output is incomplete and must not be used')
 assert.deepEqual(await inventory(backup),before,'Full-copy byte verification failed')
 const receipt={version:1,kind:'dsh-r5-home-copy-backup',sourceLabel,sourceFingerprint:homeFingerprint(before,links),complete:true,files:before,
  ...links.length?{links,linkPolicy:'recorded-not-followed',externalLinkRoots:first.externalLinkRoots}:{},
  scope:links.length?'All regular files and empty directories in the supplied offline Home copy, without exclusions; links/junctions are recorded with their final targets and not followed (internal targets are copied as ordinary Home files, declared external dependency targets are outside this backup); no live-source or application-consistency guarantee'
   :'All regular files and empty directories in the supplied offline Home copy, without exclusions; no live-source or application-consistency guarantee',
  detected:{profiles:before.some(r=>r.path.startsWith('profiles/tavern/')),nativeSessions:before.some(r=>r.path.startsWith('profile-data/tavern/sessions/')),nativeStaging:before.some(r=>/sessions-v3-staging-/.test(r.path)),logs:before.some(r=>r.path.startsWith('logs/')),browserRuntime:before.some(r=>r.path.startsWith('browser-runtime/'))},
  verification:{sourceUnchanged:true,backupBytesEqual:true,restoredBytesEqual:'not-run',nativeUpgrade:'not-run',firstOpen:'not-run',pairedOldCodeRollback:'not-run'},productionModified:false}
 await jsonFile(path.join(destination,'backup-manifest.json'),receipt)
 return {output:destination,manifestSha256:await fileHash(path.join(destination,'backup-manifest.json')),sourceFingerprint:receipt.sourceFingerprint,files:before.filter(r=>r.type==='file').length,linkCounts:linkCounts(links),detected:receipt.detected,verification:receipt.verification}
}
function validLinks(receipt,seen){
 const links=receipt.links===undefined?[]:receipt.links
 assert(Array.isArray(links),'Invalid backup link inventory')
 const rows=new Map(receipt.files.map(row=>[row.path,row]))
 for(const row of links){
  assert(row&&typeof row==='object'&&row.type==='link'&&['directory','file'].includes(row.targetType),'Invalid backup link inventory')
  safeRelative(row.path)
  assert(!seen.has(row.path),'Duplicate backup manifest paths');seen.add(row.path)
  const parent=path.posix.dirname(row.path)
  assert(parent==='.'||rows.get(parent)?.type==='directory','Backup link parent is not a recorded directory: '+row.path)
  assert(!receipt.files.some(file=>file.path.startsWith(row.path+'/')),'Backup inventory places files beneath a link: '+row.path)
  if(row.scope==='internal')assert(rows.get(safeRelative(row.target))?.type===row.targetType,'Internal link target is not a recorded Home entry: '+row.path)
  else assert(row.scope==='external'&&typeof row.target==='string'&&path.isAbsolute(row.target),'Invalid backup link inventory')
 }
 return links
}
// Internal links are recreated inside the restored Home (Windows: junctions with
// absolute targets; POSIX: relative symlinks). External dependency links are not
// recreated in a disposable rehearsal; the report lists them.
async function restoreInternalLinks(home,links){
 for(const row of links.filter(link=>link.scope==='internal')){
  const file=path.join(home,row.path),target=path.join(home,row.target)
  if(process.platform==='win32'&&row.targetType==='directory')await symlink(target,file,'junction')
  else await symlink(path.relative(path.dirname(file),target),file,row.targetType==='directory'?'dir':'file')
 }
}
export async function readVerifiedHomeBackup(backup,manifestSha256){
 const root=await plainRoot(backup),file=path.join(root,'backup-manifest.json')
 assert(/^[a-f0-9]{64}$/.test(manifestSha256||''),'Supply the independently retained backup manifest hash')
 // The inventory below rejects a manifest symlink before opening any data files.
 const outer=await inventory(root)
 assert(outer.some(r=>r.path==='backup-manifest.json'&&r.type==='file'),'Missing backup manifest')
 assert.equal(await fileHash(file),manifestSha256,'Backup manifest hash mismatch')
 const receipt=JSON.parse(await readFile(file,'utf8'))
 assert(receipt.version===1&&receipt.kind==='dsh-r5-home-copy-backup'&&receipt.complete===true&&Array.isArray(receipt.files),'Backup is incomplete or unsupported')
 const seen=new Set()
 for(const row of receipt.files){
  assert(row&&typeof row==='object','Invalid backup inventory row')
  safeRelative(row.path)
  assert(!seen.has(row.path),'Duplicate backup manifest paths');seen.add(row.path)
  assert(row.type==='directory'||row.type==='file','Unsupported backup inventory type')
  if(row.type==='file')assert(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&typeof row.sha256==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)&&typeof row.executable==='boolean','Invalid backup file inventory')
 }
 assert(receipt.files.some(row=>row.type==='file'),'Refusing an empty Home backup')
 const links=validLinks(receipt,seen)
 assert.equal(homeFingerprint(receipt.files,links),receipt.sourceFingerprint,'Backup source identity mismatch')
 assert.deepEqual(await inventory(path.join(root,'home')),receipt.files,'Backup has changed; never reuse it')
 return {root,receipt,links}
}
const groups={scriptTrees:['tavernScriptTrees','tavernScriptHistory'],presets:['runtimePresetSnapshot','runtimePresetPath'],worldbooks:['openingWorldbookSnapshot','worldbookState'],spSnapshots:['spDatabase','spAuthority'],story:['messages','variables','timeline']}
const realHomeAcceptance={fullHomeRestore:'not-run',nativeUpgrade:'not-run',firstOpen:'not-run',doubleMigration:'not-run',pairedOldCodeRollback:'not-run'}
export async function logicalInventory(dataRoot){
 const initialFiles=await inventory(dataRoot),journal=createChatRecordsStore({dataRoot}),codec=createChatResourceCodec({dataRoot}),archives=createProfileDataStore({dataRoot}),ids=new Set()
 const referenceProofs=[],rows=[],digest=value=>sha256(JSON.stringify(value))
 const summarize=chat=>{
  const logical=codec.logical(chat)
  return {logicalSha256:digest(logical),groups:Object.fromEntries(Object.entries(groups).map(([name,fields])=>[name,digest(fields.map(field=>({field,present:Object.hasOwn(logical,field),value:logical[field]})))]))}
 }
 // Reuse the real SP decoder for every SP state, including states loaded from
 // floor archives. The adapter only supplies in-memory values; no write API exists.
 let payload
 const sp=createSpStorageStore({readReadonly:async()=>({spDatabase:payload})},{dataRoot,readOnly:true})
 async function hydrateSp(value){
  if(!value||typeof value!=='object')return value
  payload=value
  const decoded=structuredClone((await sp.readReadonly()).spDatabase)
  async function visit(state){
   if(!state||typeof state!=='object')return
   if(state.vectorIndex){
    if(Object.hasOwn(state.vectorIndex,'spVectorIndex'))assert(typeof state.vectorIndex.spVectorIndex==='string'&&/^[a-f0-9]{64}$/.test(state.vectorIndex.spVectorIndex),'SP vector reference is malformed')
    state.vectorIndex=await loadSpVectorIndex(state.vectorIndex,archives)
   }
   if(state.layerRecords){
    const records=state.layerRecords,checkpoints=records.checkpoints||{},hashes=new Set([...Object.keys(checkpoints),...(records.frames||[]).map(frame=>frame.hash)]),resolved={}
    for(const hash of hashes){
     const row=checkpoints[hash]
     if(row?.spLayerArchive!==undefined)assert.equal(row.spLayerArchive,hash,'SP floor reference identity mismatch')
     const floor=!row||row.spLayerArchive!==undefined?await sp.resolveLayer(hash):await decodeSpFloorArchive(row,hash,archives.readReadonly)
     resolved[hash]=await hydrateSp(floor)
    }
    records.checkpoints=resolved
   }
   for(const [key,child] of Object.entries(state))if(!['data','templateData','guideData','layerRecords','vectorIndex'].includes(key))await visit(child)
  }
  await visit(decoded);return decoded
 }
 async function hydrateChat(chat){
  if(chat.spDatabase)chat.spDatabase=await hydrateSp(chat.spDatabase)
  for(const checkpoint of chat.timeline?.checkpoints||[])if(checkpoint.before)await hydrateChat(checkpoint.before)
  return chat
 }
 try{
  let entries;try{entries=await readdir(path.join(dataRoot,'chats'),{withFileTypes:true})}catch(error){if(error.code==='ENOENT')entries=[];else throw error}
  for(const row of entries){if(row.isDirectory())ids.add(row.name);else if(row.isFile()&&row.name.endsWith('.json')&&!row.name.includes('.legacy-'))ids.add(row.name.slice(0,-5))}
  const marker=await createStorageFormat(dataRoot,{maximumVersion:5}).read()
  if(marker?.formatVersion>=4){const manifest=await readChatRouteManifest(dataRoot,marker);for(const id of Object.keys(manifest.chats))ids.add(id);const pageEntries=await readdir(path.join(dataRoot,'chats-v4'),{withFileTypes:true});for(const row of pageEntries){assert(!row.isSymbolicLink(),'Linked format4 Chat directory');if(row.isDirectory()&&row.name!=='.processes')ids.add(row.name)}}
  for(const id of [...ids].sort()){
   const stored=await journal.readReadonly(id);if(!stored&&marker?.formatVersion>=4)continue;assert(stored,'Unreadable chat: '+id)
   const chat=await hydrateChat(structuredClone(stored)),queue=[{chat,revision:stored._storageRevision}],expanded=new Set([stored._storageRevision])
   rows.push({chatId:id,...summarize(chat)})
   // A current head can be perfectly readable while an older checkpoint's SQL
   // payload is gone. Read *every* reference with the journal, then hydrate its
   // full SP payload with the same real read-only decoders as the current head.
   for(let next=0;next<queue.length;next++){
    const {chat:owner,revision}=queue[next]
    async function checkpoints(value,prefix='timeline.checkpoints'){
     for(const [index,checkpoint]of (value.timeline?.checkpoints||[]).entries()){
      const location=prefix+'['+index+']'
      if(Object.hasOwn(checkpoint,'beforeRevision')){
       const proof={chatId:id,ownerRevision:revision,checkpoint:location,beforeRevision:checkpoint.beforeRevision,resolved:false}
       referenceProofs.push(proof)
       try{
        assert(Number.isSafeInteger(checkpoint.beforeRevision)&&checkpoint.beforeRevision>=0,'Invalid checkpoint beforeRevision')
        assert(checkpoint.beforeRevision<revision,'Checkpoint revision must precede its owner')
        const historical=await journal.readRevision(id,checkpoint.beforeRevision)
        assert(historical&&historical.id===id&&historical._storageRevision===checkpoint.beforeRevision,'Missing or mismatched checkpoint revision')
        const decoded=await hydrateChat(structuredClone(historical))
        Object.assign(proof,{resolved:true,...summarize(decoded)})
        if(!expanded.has(checkpoint.beforeRevision)){expanded.add(checkpoint.beforeRevision);queue.push({chat:decoded,revision:checkpoint.beforeRevision})}
       }catch(error){proof.error={code:error.code||'CHECKPOINT_REFERENCE_INVALID',message:error.message}}
      }
      if(checkpoint.before)await checkpoints(checkpoint.before,location+'.before.timeline.checkpoints')
     }
    }
    await checkpoints(owner)
   }
  }
  const resolved=referenceProofs.every(row=>row.resolved)
  assert(resolved,'Checkpoint references unresolved: '+referenceProofs.filter(row=>!row.resolved).map(row=>row.chatId+'@'+row.beforeRevision+': '+row.error.message).join('; '))
  return {chats:rows,referenceProofs,spReferencesResolved:resolved}
 }catch(error){
  error.referenceProofs=referenceProofs
  throw error
 }finally{
  await sp.close()
  assert.deepEqual(await inventory(dataRoot),initialFiles,'Logical verification changed files in the restored copy')
 }
}
function physicalChanges(before,after){
 const a=new Map(before.map(row=>[row.path,row])),b=new Map(after.map(row=>[row.path,row]))
 return [...new Set([...a.keys(),...b.keys()])].sort().filter(name=>JSON.stringify(a.get(name))!==JSON.stringify(b.get(name))).map(name=>({path:name,change:!a.has(name)?'added':!b.has(name)?'removed':'changed'}))
}
// acceptanceMode 'synthetic' (default) runs on any fixture and only reports the
// sample counts. 'real-home' is the deployment acceptance run: it requires a
// candidate with every dependency root, at least one timeline checkpoint
// reference and a first migration that actually changed data; otherwise the
// rehearsal fails instead of passing on zero samples.
export const acceptanceModes=['synthetic','real-home']
export async function recoveryRehearsal({backup,manifestSha256,output,dataRelative='profile-data/tavern/data',candidate,candidateManifestSha256,executionMode='candidate',acceptanceMode='synthetic'}){
 safeRelative(dataRelative)
 assert(acceptanceModes.includes(acceptanceMode),'Unsupported acceptance mode: '+acceptanceMode)
 const identityArgs={candidate,manifestSha256:candidateManifestSha256,executionMode,executionRoot:fileURLToPath(new URL('../../',import.meta.url)),entrypoint:process.argv[1],requireCompleteDependencies:acceptanceMode==='real-home'}
 const codeIdentity=await verifyExecutionIdentity(identityArgs)
 const {root,receipt,links}=await readVerifiedHomeBackup(backup,manifestSha256),destination=await newOutput(output,[root,codeIdentity.candidateRoot,codeIdentity.executionSourceRoot])
 const homeLinks={recorded:links.length,internalRestored:links.filter(row=>row.scope==='internal').length,externalNotRestored:links.filter(row=>row.scope==='external').map(row=>({path:row.path,target:row.target}))}
 const referenceChecks=[],sampleCounts={chats:null,checkpointReferences:[],firstMigrationChanged:null,secondMigrationChanged:null}
 let digestsEqual=false
 async function inspect(dataRoot,phase){
  try{const result=await logicalInventory(dataRoot);referenceChecks.push({phase,resolved:result.spReferencesResolved,references:result.referenceProofs});sampleCounts.checkpointReferences.push(result.referenceProofs.length);return result}
  catch(error){referenceChecks.push({phase,resolved:false,references:error.referenceProofs||[],error:{code:error.code||'LOGICAL_VERIFICATION_FAILED',message:error.message}});sampleCounts.checkpointReferences.push((error.referenceProofs||[]).length);throw error}
 }
 try{
 const restored=path.join(destination,'restored-home');await mkdir(restored,{mode:0o700})
 await copyInventory(path.join(root,'home'),restored,receipt.files);await restoreInternalLinks(restored,links)
 const restoredScan=await homeInventory(restored)
 assert.deepEqual(restoredScan.files,receipt.files,'Restored Home is not byte-for-byte equal')
 assert.deepEqual(restoredScan.links,links.filter(row=>row.scope==='internal'),'Restored Home links differ from the recorded internal links')
 const dataRoot=await plainRoot(path.join(restored,dataRelative)),before=await inspect(dataRoot,'before-migration')
 sampleCounts.chats=before.chats.length
 assert(before.chats.length>0,'No chats found; empty Home is not an acceptance rehearsal')
 const first=await migrateResourceStorage({dataRoot,backupRoot:path.join(destination,'migration-plugin-backup'),apply:true})
 sampleCounts.firstMigrationChanged=first.changed
 const after=await inspect(dataRoot,'after-first-migration'),second=await migrateResourceStorage({dataRoot,backupRoot:path.join(destination,'migration-plugin-backup'),apply:true})
 sampleCounts.secondMigrationChanged=second.changed
 assert.deepEqual(after,before,'Per-chat logical data changed during offline migration')
 assert.equal(second.changed,0,'Second migration was not idempotent')
 assert.deepEqual(await inspect(dataRoot,'after-second-migration'),before,'Second migration changed logical data')
 digestsEqual=true
 assert.deepEqual(await inventory(path.join(root,'home')),receipt.files,'Immutable full-Home backup changed')
 assert.equal(await fileHash(path.join(root,'backup-manifest.json')),manifestSha256,'Backup manifest changed')
 assert.deepEqual(await verifyExecutionIdentity(identityArgs),codeIdentity,'Execution identity changed during rehearsal')
 const zeroSamples=[...sampleCounts.checkpointReferences[0]===0?['checkpoint references 0 (no timeline beforeRevision was exercised)']:[],...first.changed===0?['first migration changed 0 (backup already at storage format 3 or nothing to migrate)']:[]]
 if(acceptanceMode==='real-home'&&zeroSamples.length){const error=Error('Real-Home acceptance cannot pass on zero samples: '+zeroSamples.join('; '));error.code='REAL_HOME_ZERO_SAMPLE';throw error}
 const changes=physicalChanges(receipt.files,(await homeInventory(restored)).files)
 const report={version:1,kind:'dsh-r5-offline-recovery-rehearsal',status:'passed',acceptanceMode,codeIdentity,sourceFingerprint:receipt.sourceFingerprint,backupManifestSha256:manifestSha256,
  scope:'Restore and plugin format-3 migration in a new disposable Home; no native runtime, first open, model call or production access',
  verification:{restoredBytesEqual:true,backupUnchanged:true,pluginLogicalDigestsEqual:true,spReferencesResolved:referenceChecks.length===3&&referenceChecks.every(check=>check.resolved&&check.references.every(row=>row.resolved)),secondMigrationChanged:second.changed,nativeUpgrade:'not-run',firstOpen:'not-run',pairedOldCodeRollback:'not-run'},
  sampleCounts,zeroSamples,realHomeAcceptance,homeLinks,referenceChecks,chats:before.chats.map(row=>({...row,afterLogicalSha256:after.chats.find(other=>other.chatId===row.chatId).logicalSha256,firstOpenChanges:'not-run'})),
  migrations:{first:{changed:first.changed,chats:first.chats,archives:first.archives},second:{changed:second.changed}},physicalChanges:changes,
  deploymentReady:false,blockers:['Native rc.2 upgrade and actual first-open per-chat comparison still required','0cec7bef code plus pre-upgrade full Home paired rollback still required','Real populated Home-copy acceptance and runtime/browser integrity still required','User approval of exact deployment time and backup/rollback arrangement still required']}
 await jsonFile(path.join(destination,'rehearsal-report.json'),report)
 return {output:destination,report,reportSha256:await fileHash(path.join(destination,'rehearsal-report.json'))}
 }catch(error){
  const report={version:1,kind:'dsh-r5-offline-recovery-rehearsal',status:'failed',acceptanceMode,codeIdentity,sourceFingerprint:receipt.sourceFingerprint,backupManifestSha256:manifestSha256,
   verification:{pluginLogicalDigestsEqual:digestsEqual,spReferencesResolved:referenceChecks.length===3&&referenceChecks.every(check=>check.resolved&&check.references.every(row=>row.resolved)),nativeUpgrade:'not-run',firstOpen:'not-run',pairedOldCodeRollback:'not-run'},
   sampleCounts,realHomeAcceptance,homeLinks,referenceChecks,error:{code:error.code||'RECOVERY_REHEARSAL_FAILED',message:error.message},deploymentReady:false}
  await jsonFile(path.join(destination,'rehearsal-report.json'),report)
  error.reportPath=path.join(destination,'rehearsal-report.json');throw error
 }
}
