import assert from 'node:assert/strict'
import path from 'node:path'
import {readFile,lstat} from 'node:fs/promises'
import {inventory,safeRelative} from './r5-candidate-tools.mjs'
import {pageDigest} from '../../tavern-plugin/lib/domain/page-chat-records.js'
import {recoverPageMigration} from '../../tavern-plugin/lib/domain/page-chat-migration.js'
import {createChatRecordsStore} from '../../tavern-plugin/lib/domain/chat-records-store.js'

/** Independently verify a published rehearsal Home with the CURRENT reader.
 * Also reject new files outside explicitly prepared data authority: public
 * native read APIs must not quietly rewrite/upgrade or stage native history. */
export async function verifyPublishedPageHome({home,backupManifestFile,expectedBackupManifestSha256,expectedPreparedReceiptSha256,dataRelative='profile-data/tavern/data'}={}){
 assert(/^[a-f0-9]{64}$/.test(expectedBackupManifestSha256||''));assert(/^[a-f0-9]{64}$/.test(expectedPreparedReceiptSha256||''));safeRelative(dataRelative)
 const bytes=await readFile(backupManifestFile);assert.equal(pageDigest(bytes),expectedBackupManifestSha256,'Original backup manifest changed')
 const backup=JSON.parse(bytes),actual=await inventory(home),original=new Map(backup.files.map(row=>[row.path,row])),current=new Map(actual.map(row=>[row.path,row])),markerPath=dataRelative+'/storage-format.json'
 const marker=JSON.parse(await readFile(path.join(home,markerPath))),base='maintenance/format4/'+marker.migrationId
 for(const row of backup.files)if(row.path!==markerPath)assert.deepEqual(current.get(row.path),row,'Original complete Home file changed: '+row.path)
 const allowed=[dataRelative+'/chats-v4',dataRelative+'/'+base,dataRelative+'/maintenance/format5',dataRelative+'/resource-versions',dataRelative+'/chat-resources']
 const added=[]
 for(const row of actual){if(original.has(row.path)||row.path===markerPath)continue
  assert(allowed.some(prefix=>row.path===prefix||row.path.startsWith(prefix+'/')||row.type==='directory'&&prefix.startsWith(row.path+'/')),'Unexpected write outside prepared page/resource authority: '+row.path);added.push(row)
 }
 const dataRoot=path.join(home,dataRelative),recovery=await recoverPageMigration({dataRoot,migrationId:marker.migrationId,expectedReceiptSha256:expectedPreparedReceiptSha256}),records=createChatRecordsStore({dataRoot})
 const prepared=JSON.parse(await readFile(path.join(dataRoot,base,'prepared.json'))),chats=[]
 for(const [chatId,entry]of Object.entries(prepared.manifest.chats)){const chat=await records.readReadonly(chatId);chats.push({chatId,storageRevision:chat._storageRevision,messages:chat.messages?.length||0,historyRevisions:entry.historyRevisions.length,firstRevision:entry.historyRevisions[0],lastRevision:entry.historyRevisions.at(-1)})}
 const inodes=new Set();let additionalUniqueInodeBytes=0
 for(const row of added.filter(row=>row.type==='file')){const info=await lstat(path.join(home,row.path),{bigint:true});assert(info.ino!==0n,'Filesystem inode identity unavailable for hardlink accounting');const key=info.dev+':'+info.ino;if(!inodes.has(key)){inodes.add(key);additionalUniqueInodeBytes+=Number(info.size)}}
 return {status:'passed',reader:'current',completeOriginalFilesPreservedExceptMarker:true,noNewNativeOrHomeWrites:true,recovery,chats,additionalFiles:added.filter(row=>row.type==='file').length,additionalLogicalFileBytes:added.reduce((n,row)=>n+(row.bytes||0),0),additionalUniqueInodeBytes,additionalUniqueInodes:inodes.size,costScope:'Added-file inode sizes deduplicated within added files; excludes filesystem allocation/metadata, not a whole-Home net-space claim',linksRecordedNotFollowed:backup.links?.length||0,models:0,ports:[]}
}
