import {createStorageFormat} from './storage-format.js'
import assert from 'node:assert/strict'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {mkdir,readdir,lstat,readFile,writeFile,link,realpath} from 'node:fs/promises'
import {createChatJournalStore} from './chat-journal-store.js'
import {createPageChatRecords,pageDigest,writePageAuthority} from './page-chat-records.js'
import {createChatRecordsStore,readChatRouteManifest} from './chat-records-store.js'
import {createProfileDataStore} from '../profile-data-store.js'
import {createChatResourceCodec} from './chat-resource-codec.js'
import {createSpStorageStore} from './sp-storage.js'
import {loadSpVectorIndex} from './sp-vector-index-store.js'
import {decodeSpFloorArchive} from './sp-floor-archive-format.js'
import {freezeJson} from './readonly-json.js'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {withChatMutation,canonicalChatId} from './chat-mutation-lock.js'

async function plainDataRoot(root){const resolved=path.resolve(root),info=await lstat(resolved);assert(info.isDirectory()&&!info.isSymbolicLink(),'Offline data root must not be a link');const actual=await realpath(resolved),canonical=value=>process.platform==='win32'?value.toLowerCase():value;assert.equal(canonical(actual),canonical(resolved),'Offline data root must use its canonical real path');return resolved}
export async function pageCopyInventory(root,{exclude=[]}={}){
 root=await plainDataRoot(root)
 const result=[]
 async function visit(relative){for(const entry of (await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=relative?relative+'/'+entry.name:entry.name;if(exclude.some(value=>rel===value||rel.startsWith(value+'/')))continue;const file=path.join(root,rel),info=await lstat(file);assert(!info.isSymbolicLink(),'Offline data copy contains a link: '+rel);if(info.isDirectory())await visit(rel);else{assert(info.isFile(),'Special file in offline data copy');const bytes=await readFile(file);result.push({path:rel,bytes:bytes.length,sha256:pageDigest(bytes)})}}}
 await visit('');return result
}
export async function verifyPageSpClosure(chat,{dataRoot}){
 const profile=createProfileDataStore({dataRoot});let payload;const sp=createSpStorageStore({readReadonly:async()=>({spDatabase:payload})},{dataRoot,readOnly:true}),seen=new Set();let layers=0,vectors=0
 async function visit(value){
  if(!value||typeof value!=='object')return
  if(value.vectorIndex){await loadSpVectorIndex(value.vectorIndex,profile);vectors++}
  const records=value.layerRecords
  if(records){const hashes=new Set([...Object.keys(records.checkpoints||{}),...(records.frames||[]).map(row=>row.hash)])
   for(const hash of hashes){if(seen.has(hash))continue;seen.add(hash);const row=records.checkpoints?.[hash];if(row?.spLayerArchive!==undefined)assert.equal(row.spLayerArchive,hash);const floor=row&&!row.spLayerArchive?await decodeSpFloorArchive(row,hash,profile.readReadonly):await sp.resolveLayer(hash);layers++;await hydrate(floor)}
  }
  for(const [key,child]of Object.entries(value))if(!['data','templateData','guideData','layerRecords','vectorIndex'].includes(key))await visit(child)
 }
 async function hydrate(state){payload=state;const decoded=(await sp.readReadonly()).spDatabase;await visit(decoded)}
 async function walk(value){if(value.spDatabase)await hydrate(value.spDatabase);for(const row of value.timeline?.checkpoints||[])if(row.before)await walk(row.before)}
 try{await walk(chat);return {layers,vectors}}finally{await sp.close()}
}
function revisionReferences(chat,result=new Set()){
 for(const row of chat.timeline?.checkpoints||[]){if(row.beforeRevision!==undefined){assert(Number.isSafeInteger(row.beforeRevision)&&row.beforeRevision>=0,'Invalid checkpoint revision');result.add(row.beforeRevision)}if(row.before)revisionReferences(row.before,result)}
 for(const row of Object.values(chat.timeline?.operations||{}))if(row.status==='running'&&row.beforeRevision!==undefined){assert(Number.isSafeInteger(row.beforeRevision)&&row.beforeRevision>=0,'Invalid pending operation revision');result.add(row.beforeRevision)}
 return result
}
function assertIdle(chat){
 assert(!chat.regenInProgress&&chat.settleStatus!=='running','Offline migration requires no running settlement')
 assert(!Object.values(chat.timeline?.operations||{}).some(row=>row.status==='running'),'Offline migration requires no active operation')
 // Failed/pending recovery journals and transactions remain data, not work to
 // replay during migration. They are preserved and validated, never executed.
}

/** Prepares a fresh graph inside an explicitly offline data COPY. No process
 * discovery can prove quiescence: caller attestation and source bytes/version
 * rechecks are both required. No script/model/native turn is executed here. */
export async function preparePageMigration({dataRoot,offlineCopy=false,oldProcessesStopped=false,expectedSourceInventory,protectedRevisions={},verifyChat=async()=>{},hooks={},promotionOptions={}}={}){
 assert(offlineCopy===true&&oldProcessesStopped===true,'Explicit offline COPY and stopped-old-process attestation required')
 dataRoot=path.resolve(dataRoot);const before=await pageCopyInventory(dataRoot)
 if(expectedSourceInventory)assert.deepEqual(before,expectedSourceInventory,'Offline source changed before migration')
 for(const row of before){assert(!row.path.includes('.pending-')&&!row.path.endsWith('.write-lock'),'Offline copy has pending promotion/write lock');assert(!row.path.endsWith('-wal')||row.bytes===0,'Checkpoint SQLite WAL before migration')}
 const markerPath=path.join(dataRoot,'storage-format.json'),sourceMarker=before.find(row=>row.path==='storage-format.json')
 const legacy=createChatJournalStore({dataRoot,retention:false}),migrationId=randomUUID(),relative='maintenance/format4/'+migrationId,stage=path.join(dataRoot,relative,'resource-stage'),output=path.join(dataRoot,'chats-v4')
 const marker=sourceMarker?JSON.parse(await readFile(markerPath,'utf8')):null;assert(!marker||Number(marker.formatVersion)<=3,'Already migrated or unsupported source format')
 await mkdir(output);await mkdir(stage,{recursive:true})
 const sourceStore=createProfileDataStore({dataRoot}),staged=createProfileDataStore({dataRoot:stage})
 const combined={readReadonly:async file=>await staged.readReadonly(file)??await sourceStore.readReadonly(file),version:async file=>await staged.version(file)||await sourceStore.version(file),updateJson:(file,mutation)=>staged.updateJson(file,async current=>mutation(current??await sourceStore.readReadonly(file)))}
 const codec=createChatResourceCodec({dataRoot,store:combined}),pages=createPageChatRecords({dataRoot,resourceCodec:codec,promotionOptions}),manifest={kind:'tavern-chat-routes-v1',migrationId,chats:Object.create(null)},proofs=[],sourceVersions=Object.create(null),createdResources=[],protections=new Map()
 for(const [id,revisions]of Object.entries(protectedRevisions)){assert(Array.isArray(revisions)&&revisions.every(value=>Number.isSafeInteger(value)&&value>=0),'Invalid protected revisions');const canonical=canonicalChatId(id);protections.set(canonical,[...protections.get(canonical)||[],...revisions])}
 const entries=await readdir(path.join(dataRoot,'chats'),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error}),ids=[...new Set(entries.flatMap(row=>row.isDirectory()?[canonicalChatId(row.name)]:row.isFile()&&row.name.endsWith('.json')&&!row.name.includes('.legacy-')?[canonicalChatId(row.name.slice(0,-5))]:[]))].sort()
 for(const id of ids){
  const current=await legacy.readReadonly(id);assert(current,'Unreadable source Chat: '+id);assertIdle(current);sourceVersions[id]=await legacy.version(id)
  const revisions=await legacy.revisions(id),roots={};assert(revisions.includes(current._storageRevision),'Current logical revision missing')
  const references=new Set(protections.get(id)||[])
  for(const revision of revisions){
   const value=await legacy.readRevision(id,revision);assert(value&&value._storageRevision===revision,'Inexact historical revision')
   revisionReferences(value,references)
   const sp=await verifyPageSpClosure(value,{dataRoot});await verifyChat(value,{chatId:id,revision,phase:'source'})
   const result=await pages.prepare(id,value);roots[String(revision)]=result.snapshotId
   proofs.push({chatId:id,revision,snapshotId:result.snapshotId,logicalSha256:pageDigest(JSON.stringify(codec.logical(value))),sp})
   await hooks.afterRevision?.({id,revision})
  }
  for(const revision of references)assert(roots[String(revision)],'Missing exact protected/checkpoint history: '+id+'@'+revision)
  const snapshotId=roots[String(current._storageRevision)],route={kind:'tavern-chat-route-v1',chatId:id,migrationId,generation:1,storageRevision:current._storageRevision,snapshotId,revisionRoots:roots,deleted:false}
  await pages.publish(id,route);manifest.chats[id]={initialStorageRevision:current._storageRevision,initialSnapshotId:snapshotId,sourceVersion:sourceVersions[id],protectedRevisions:[...references].sort((a,b)=>a-b),historyRevisions:revisions}
 }
 // New resource definitions use the SAME original codec paths. Staging avoids
 // marking format3 early or altering any source file while constructing graphs.
 for(const row of await pageCopyInventory(stage)){
  if(row.path==='storage-format.json')continue
  assert(/^(resource-versions|chat-resources)\/[a-f0-9]{64}\.json$/.test(row.path),'Unexpected staged resource')
  const target=path.join(dataRoot,row.path);await mkdir(path.dirname(target),{recursive:true})
  try{await link(path.join(stage,row.path),target);createdResources.push(row)}catch(error){if(error.code!=='EEXIST')throw error}
 }
 const files=createDurableFilePromotion(promotionOptions),manifestRelative=relative+'/routes.json',manifestPath=path.join(dataRoot,manifestRelative)
 await writePageAuthority(files,manifestPath,manifest)
 const sourceUnchanged=async()=>{
  for(const [id,version]of Object.entries(sourceVersions))assert.equal(await legacy.version(id),version,'Journal source changed during migration')
  const actual=await pageCopyInventory(dataRoot,{exclude:['chats-v4',relative]}),known=new Map(before.map(row=>[row.path,row])),added=new Map(createdResources.map(row=>[row.path,row]))
  for(const row of actual){const expected=known.get(row.path)||added.get(row.path);assert(expected,'Unexpected source addition: '+row.path);assert.deepEqual(row,expected,'Offline source bytes changed: '+row.path);known.delete(row.path)}
  assert.equal(known.size,0,'Offline source file disappeared')
 }
 await sourceUnchanged()
 // A fresh ordinary codec must resolve the complete graph without relying on
 // transaction buffers or the temporary resource staging overlay.
 const cold=createPageChatRecords({dataRoot})
 for(const proof of proofs){const value=await cold.readSnapshot(proof.chatId,proof.snapshotId);assert.equal(pageDigest(JSON.stringify(value)),proof.logicalSha256);await verifyPageSpClosure(value,{dataRoot});await verifyChat(value,{chatId:proof.chatId,revision:proof.revision,phase:'prepared'})}
 const nextMarker={formatVersion:4,minimumReader:'r16-b5',pageFormat:'tavern-chat-records-v1',migrationId,routeManifest:manifestRelative,routeManifestSha256:pageDigest(await readFile(manifestPath)),rollback:'Restore paired code and complete Home; no downgrade reads.'}
 const receipt={version:1,kind:'tavern-page-migration-prepared',migrationId,dataRoot,sourceInventory:before,createdResources,sourceVersions,manifest,nextMarker,proofs,sourceMarkerSha256:sourceMarker?.sha256||null,status:'prepared',noGarbageCollection:true}
 await writePageAuthority(files,path.join(dataRoot,relative,'prepared.json'),receipt)
 freezeJson(receipt)
 await hooks.afterPrepared?.(receipt)
 return {receipt,sourceUnchanged:()=>verifyPreparedPageSource(receipt)}
}

export async function verifyPreparedPageSource(receipt){
 const relative='maintenance/format4/'+receipt.migrationId,locks=Object.keys(receipt.manifest.chats).map(id=>'chats/'+id+'.write-lock')
 const actual=await pageCopyInventory(receipt.dataRoot,{exclude:['chats-v4',relative,...locks]}),known=new Map(receipt.sourceInventory.map(row=>[row.path,row])),added=new Map(receipt.createdResources.map(row=>[row.path,row]))
 for(const row of actual){const expected=known.get(row.path)||added.get(row.path);assert(expected,'Unexpected source addition: '+row.path);assert.deepEqual(row,expected,'Offline source bytes changed: '+row.path);known.delete(row.path)}
 assert.equal(known.size,0,'Offline source file disappeared')
}

async function verifyPreparedPageGraph(receipt){
 const file=path.join(receipt.dataRoot,receipt.nextMarker.routeManifest)
 assert.equal(pageDigest(await readFile(file)),receipt.nextMarker.routeManifestSha256,'Prepared route manifest changed')
 const pages=createPageChatRecords({dataRoot:receipt.dataRoot})
 for(const proof of receipt.proofs){const value=await pages.readSnapshot(proof.chatId,proof.snapshotId);assert.equal(pageDigest(JSON.stringify(value)),proof.logicalSha256,'Prepared history changed');await verifyPageSpClosure(value,{dataRoot:receipt.dataRoot})}
 for(const [id,expected]of Object.entries(receipt.manifest.chats)){const route=await pages.route(id,{required:true});assert.equal(route.migrationId,receipt.migrationId);assert.equal(route.snapshotId,expected.initialSnapshotId);assert.equal(route.storageRevision,expected.initialStorageRevision);assert.deepEqual(Object.keys(route.revisionRoots).map(Number).sort((a,b)=>a-b),expected.historyRevisions);for(const proof of receipt.proofs.filter(row=>row.chatId===id))assert.equal(route.revisionRoots[String(proof.revision)],proof.snapshotId)}
}

/** Restart-safe recovery requires the independently retained prepared receipt
 * hash. A published marker is verified as new authority; it never falls back. */
export async function recoverPageMigration({dataRoot,migrationId,expectedReceiptSha256,offlineCopy=false,oldProcessesStopped=false,publish=false,promotionOptions={},relocateFrom}={}){
 assert(/^[a-f0-9]{64}$/.test(expectedReceiptSha256||''),'Independent prepared receipt hash required')
 assert(/^[a-f0-9-]{36}$/.test(migrationId||''),'Invalid migration identity')
 dataRoot=await plainDataRoot(dataRoot);const bytes=await readFile(path.join(dataRoot,'maintenance/format4',migrationId,'prepared.json'));assert.equal(pageDigest(bytes),expectedReceiptSha256,'Prepared receipt changed')
 const original=freezeJson(JSON.parse(bytes));assert.equal(original.migrationId,migrationId)
 const relocated=original.dataRoot!==dataRoot
 if(relocated){assert(relocateFrom&&path.resolve(relocateFrom)===original.dataRoot,'Explicit relocation root must match original receipt');assert(offlineCopy===true&&oldProcessesStopped===true,'Relocation requires offline COPY and stopped-old-process attestation')}
 else if(relocateFrom!==undefined)assert.equal(path.resolve(relocateFrom),original.dataRoot,'Relocation root mismatch')
 const receipt=relocated?freezeJson({...original,dataRoot}):original,audit=relocated?{relocatedFrom:original.dataRoot}:{}
 const marker=await readFile(path.join(dataRoot,'storage-format.json')).catch(error=>{if(error.code==='ENOENT')return undefined;throw error}),parsed=marker?JSON.parse(marker):null
 if([4,5].includes(parsed?.formatVersion)){
  await createStorageFormat(dataRoot,{maximumVersion:5}).read()
  if(parsed.formatVersion===5){const {retentionPolicy,...baseMarker}=parsed;assert.deepEqual({...baseMarker,formatVersion:4,minimumReader:receipt.nextMarker.minimumReader},receipt.nextMarker,'Another page migration owns authority')}
  else
  assert.deepEqual(parsed,receipt.nextMarker,'Another page migration owns authority')
  const manifest=await readChatRouteManifest(dataRoot,parsed);assert.deepEqual(manifest,receipt.manifest,'Published migration manifest changed')
  const records=createChatRecordsStore({dataRoot}),pages=createPageChatRecords({dataRoot})
  for(const id of Object.keys(receipt.manifest.chats)){const route=await pages.route(id,{required:true});assert.equal(route.migrationId,migrationId);await records.readReadonly(id);for(const proof of receipt.proofs.filter(row=>row.chatId===id))assert.equal(route.revisionRoots[String(proof.revision)],proof.snapshotId,'Retained migration root changed')}
  for(const proof of receipt.proofs){const value=await pages.readSnapshot(proof.chatId,proof.snapshotId);assert.equal(pageDigest(JSON.stringify(value)),proof.logicalSha256);await verifyPageSpClosure(value,{dataRoot})}
  return {status:'published-verified',migrationId,chats:Object.keys(receipt.manifest.chats).length,revisions:receipt.proofs.length,...audit}
 }
 assert.equal(marker?pageDigest(marker):null,receipt.sourceMarkerSha256,'Source marker changed')
 await verifyPreparedPageSource(receipt);await verifyPreparedPageGraph(receipt)
 if(publish)return {...await publishPageMigration({receipt,sourceUnchanged:()=>verifyPreparedPageSource(receipt)},{offlineCopy,oldProcessesStopped,promotionOptions}),...audit}
 return {status:'prepared-verified',migrationId,receiptSha256:expectedReceiptSha256,authoritativeFormat:parsed?.formatVersion||0,...audit}
}

export async function publishPageMigration(prepared,{offlineCopy=false,oldProcessesStopped=false,hooks={},promotionOptions={}}={}){
 assert(offlineCopy===true&&oldProcessesStopped===true,'Explicit offline COPY and stopped-old-process attestation required')
 const {receipt,sourceUnchanged}=prepared;assert(receipt.kind==='tavern-page-migration-prepared'&&receipt.status==='prepared')
 const ids=Object.keys(receipt.manifest.chats).sort(),files=createDurableFilePromotion(promotionOptions)
 async function locked(index){if(index<ids.length)return withChatMutation(receipt.dataRoot,ids[index],()=>locked(index+1))
  // Check original files directly while our canonical mutation locks exist.
  await verifyPreparedPageSource(receipt)
  await verifyPreparedPageGraph(receipt)
  await hooks.beforePublish?.(receipt)
  await verifyPreparedPageSource(receipt)
  await verifyPreparedPageGraph(receipt)
  await writePageAuthority(files,path.join(receipt.dataRoot,'storage-format.json'),receipt.nextMarker)
 }
 await sourceUnchanged();await locked(0)
 const records=createChatRecordsStore({dataRoot:receipt.dataRoot})
 for(const proof of receipt.proofs){const value=await records.readRevision(proof.chatId,proof.revision);assert.equal(pageDigest(JSON.stringify(value)),proof.logicalSha256,'Published history mismatch')}
 await hooks.afterPublish?.(receipt)
 return {status:'published',migrationId:receipt.migrationId,chats:ids.length,revisions:receipt.proofs.length,format:4,historyRetained:true,noGarbageCollection:true}
}
