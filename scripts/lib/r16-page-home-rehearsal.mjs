import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises'
import {readVerifiedHomeBackup} from './r5-recovery-tools.mjs'
import {copyInventory,inventory,newOutput,safeRelative,fileHash} from './r5-candidate-tools.mjs'
import {preparePageMigration,publishPageMigration,recoverPageMigration,verifyPageSpClosure} from '../../tavern-plugin/lib/domain/page-chat-migration.js'
import {pageDigest} from '../../tavern-plugin/lib/domain/page-chat-records.js'
import {createChatRecordsStore} from '../../tavern-plugin/lib/domain/chat-records-store.js'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'

/** Complete retained Home backup -> fresh isolated copy -> explicit page route.
 * Every original Home file survives byte-for-byte except the final format marker.
 * External dependency junctions are recorded, never followed or recreated. */
export async function rehearsePageHomeMigration({backup,manifestSha256,output,bootModule,dataRelative='profile-data/tavern/data',offlineCopy=false,oldProcessesStopped=false,sourceLabel}={}){
 assert(offlineCopy===true&&oldProcessesStopped===true,'Explicit offline-copy and stopped-process attestation required')
 assert(sourceLabel?.trim(),'Source label required')
 assert(bootModule,'Read-only native rc.2 boot module required')
 const sourceFiles=['tavern-plugin/lib/domain/page-retention.js','tavern-plugin/lib/domain/page-retention-upgrade.js','tavern-plugin/lib/domain/page-process-activity.js','tavern-plugin/lib/domain/page-path-safety.js','tavern-plugin/lib/domain/maintenance-gate.js','scripts/lib/r16-page-home-rehearsal.mjs','scripts/lib/r5-recovery-tools.mjs','scripts/lib/r5-candidate-tools.mjs','tavern-plugin/lib/domain/page-chat-migration.js','tavern-plugin/lib/domain/page-chat-records.js','tavern-plugin/lib/domain/chat-records-store.js','tavern-plugin/lib/domain/chat-journal-store.js','tavern-plugin/lib/domain/chat-mutation-lock.js','tavern-plugin/lib/domain/storage-format.js','tavern-plugin/lib/domain/sp-storage.js','tavern-plugin/lib/profile-data-store.js','tavern-plugin/lib/domain/b5-shadow-page-store.js','tavern-plugin/lib/domain/b5-incremental-json-state.js','tavern-plugin/lib/domain/b5-buffered-json-records.js','tavern-plugin/lib/domain/b5-copy-json-tree.js']
 const codeIdentity=await Promise.all(sourceFiles.map(async file=>({file,sha256:pageDigest(await readFile(new URL('../../'+file,import.meta.url)))})))
 safeRelative(dataRelative)
 const verified=await readVerifiedHomeBackup(backup,manifestSha256),destination=await newOutput(output,[verified.root]),home=path.join(destination,'home'),dataRoot=path.join(home,dataRelative)
 await mkdir(home);await copyInventory(path.join(verified.root,'home'),home,verified.receipt.files)
 assert.deepEqual(await inventory(home),verified.receipt.files,'Full Home copy differs from independently verified backup')
 const report={version:1,status:'running',kind:'r16-format4-full-home-rehearsal',sourceLabel,backupManifestSha256:manifestSha256,codeIdentity,originalFiles:verified.receipt.files.filter(row=>row.type==='file').length,linksRecordedNotFollowed:verified.links.length,models:0,ports:[],native:[],resourceProofs:[],format4Default:false,home}
 const config=path.join(destination,'native-reader.yml'),bootUrl=pathToFileURL(bootModule),nativeRoot=path.join(home,'profile-data/tavern/sessions')
 const encodings=new Set(verified.receipt.files.filter(row=>row.type==='file'&&row.path.startsWith('profile-data/tavern/sessions/')&&/\/session\.v\d+\.jsonl(?:\.zstd)?$/.test(row.path)).map(row=>row.path.endsWith('.zstd')?'zstd':'none'))
 assert.equal(encodings.size,1,'Native root must have one explicit matching compression encoding')
 const nativeCompression=[...encodings][0];report.nativeCompression=nativeCompression
 const packages=['dsh-session','dsh-session-persistence-jsonl','dsh-attachment-local']
 await writeFile(config,packages.map(name=>'- name: '+new URL('../../'+name+'/lib/index.js',bootUrl).href+(name==='dsh-session-persistence-jsonl'?'\n  config:\n    root: '+nativeRoot.replaceAll('\\','/')+'\n    compression: '+nativeCompression:name==='dsh-attachment-local'?'\n  config:\n    dshHome: '+home.replaceAll('\\','/'):'')+'\n').join(''))
 const {boot}=await import(bootUrl.href),ctx=await boot('r16-full-home-closure',config),profile=createProfileDataStore({dataRoot}),nativeProofs=new Map(),resourceProofs=new Map(),attachmentProofs=new Map()
 async function regular(relative){safeRelative(relative);const target=path.join(dataRoot,relative),info=await lstat(target);assert(info.isFile()&&!info.isSymbolicLink(),'Missing/nonregular resource: '+relative);return target}
 async function native(id){if(nativeProofs.has(id))return;const reader=await ctx.sessionPersistence.open(id,'read');try{const value=await reader.read();assert.equal(reader.header.id,id);assert.equal(reader.header.version,3,'Native Session upgrade must precede B5 migration');nativeProofs.set(id,{id,events:value.events.length,logicalSha256:pageDigest(JSON.stringify({header:reader.header,events:value.events,inheritedEventCount:reader.inheritedEventCount}))})}finally{await reader.close()}}
 async function scan(value){
  if(!value||typeof value!=='object')return
  for(const [key,folder]of [['spLayerArchive','sp-floor-archives'],['spStaticArchive','sp-static-data'],['spVectorIndex','sp-vector-indexes']])if(value[key]!==undefined){assert(/^[a-f0-9]{64}$/.test(value[key]),'Invalid dependency ref');const relative=folder+'/'+value[key]+'.json';if(!resourceProofs.has(relative)){const file=await regular(relative),decoded=await profile.readReadonly(relative);resourceProofs.set(relative,{path:relative,sha256:await fileHash(file)});await scan(decoded)}}
  if(typeof value.attachmentId==='string'&&Number.isSafeInteger(value.bytes)&&!attachmentProofs.has(value.attachmentId)){
   const data=value.mediaType?Buffer.from((await ctx.attachments.readImage(value)).data):await (async()=>{const chunks=[];for await(const chunk of ctx.attachments.readFileStream(value))chunks.push(Buffer.from(chunk));return Buffer.concat(chunks)})();assert.equal(data.length,value.bytes);attachmentProofs.set(value.attachmentId,{attachmentId:value.attachmentId,bytes:data.length,sha256:pageDigest(data)})
  }
  for(const child of Object.values(value))if(child&&typeof child==='object')await scan(child)
 }
 async function verifyChat(chat){
  if(chat.sessionId)await native(chat.sessionId)
  for(const row of Object.values(chat.timeline?.participants||{}))if(row.sessionId)await native(row.sessionId)
  for(const name of [chat.cardPath,chat.runtimePresetPath,chat.runtimePresetSnapshot?.presetPath].filter(Boolean)){
   const relative='resources/'+name;if(!resourceProofs.has(relative)){const file=await regular(relative);resourceProofs.set(relative,{path:relative,sha256:await fileHash(file)})}
  }
  await scan(chat)
  for(const checkpoint of chat.timeline?.checkpoints||[])if(checkpoint.before)await verifyChat(checkpoint.before)
 }
 let prepared
 try{
  prepared=await preparePageMigration({dataRoot,offlineCopy:true,oldProcessesStopped:true,verifyChat})
  const preparedPath=path.join(dataRoot,'maintenance/format4',prepared.receipt.migrationId,'prepared.json'),receiptSha256=await fileHash(preparedPath)
  report.preparedRecovery=await recoverPageMigration({dataRoot,migrationId:prepared.receipt.migrationId,expectedReceiptSha256:receiptSha256})
  report.published=await publishPageMigration(prepared,{offlineCopy:true,oldProcessesStopped:true})
  report.restartRecovery=await recoverPageMigration({dataRoot,migrationId:prepared.receipt.migrationId,expectedReceiptSha256:receiptSha256})
  const records=createChatRecordsStore({dataRoot});for(const proof of prepared.receipt.proofs){const chat=await records.readRevision(proof.chatId,proof.revision);await verifyPageSpClosure(chat,{dataRoot});await verifyChat(chat)}
  const actual=await inventory(home),lookup=new Map(actual.map(row=>[row.path,row])),marker=dataRelative+'/storage-format.json'
  for(const row of verified.receipt.files)if(row.path!==marker)assert.deepEqual(lookup.get(row.path),row,'Original Home bytes changed: '+row.path)
  report.native=[...nativeProofs.values()];report.resourceProofs=[...resourceProofs.values()];report.attachments=[...attachmentProofs.values()];report.originalHomePreservedExceptMarker=true
  report.chats=Object.entries(prepared.receipt.manifest.chats).map(([chatId,row])=>({chatId,revisions:row.historyRevisions.length,currentRevision:row.initialStorageRevision,historyRevisions:row.historyRevisions}))
  report.originalChatsLogicalProofs=prepared.receipt.proofs.map(({chatId,revision,logicalSha256,sp})=>({chatId,revision,logicalSha256,sp}))
  for(const row of codeIdentity)assert.equal(pageDigest(await readFile(new URL('../../'+row.file,import.meta.url))),row.sha256,'Implementation changed during frozen Home rehearsal: '+row.file)
  report.preparedReceiptSha256=receiptSha256;report.status='passed';report.scope='Complete regular-file Home copy; actual retained natural history; graph/native/SP/resource/attachment closure; no CLI first-open/browser/model or production adoption claim'
 }catch(error){report.status='failed';report.error=String(error.stack||error);throw error}
 finally{await ctx.fiber.dispose();await writeFile(path.join(destination,'rehearsal.json'),JSON.stringify(report,null,2)+'\n')}
 return {output:destination,status:report.status,chats:report.chats,nativeSessions:report.native.length,manifestSha256:await fileHash(path.join(destination,'rehearsal.json'))}
}
