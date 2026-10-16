import path from 'node:path'
import {mkdir,readdir,readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {createStorageFormat} from './storage-format.js'
import {pageDigest,writePageAuthority,createPageChatRecords} from './page-chat-records.js'
import {readChatRouteManifest} from './chat-records-store.js'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {safePagePath,ensurePageDirectory} from './page-path-safety.js'
import {pageProcessActivity} from './page-process-activity.js'
export async function initializePageRetentionHome(dataRoot){
 dataRoot=path.resolve(dataRoot);await mkdir(dataRoot,{recursive:true});await safePagePath(dataRoot,dataRoot,{directory:true})
 const files=createDurableFilePromotion(),migrationId=randomUUID(),routeManifest='maintenance/format4/'+migrationId+'/routes.json',manifest={kind:'tavern-chat-routes-v1',migrationId,chats:{}}
 return files.withLock(path.join(dataRoot,'.initialize-format5'),async()=>{
  const entries=(await readdir(dataRoot)).filter(name=>name!=='.initialize-format5.write-lock');if(entries.length)throw Error('Format5 initialization requires an empty new data directory; migrate existing Home instead')
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n');await mkdir(path.dirname(path.join(dataRoot,routeManifest)),{recursive:true});await writePageAuthority(files,path.join(dataRoot,routeManifest),manifest)
  const marker={formatVersion:5,minimumReader:'r17-p5',retentionPolicy:'current-plus-three-ordinary-v1',pageFormat:'tavern-chat-records-v1',migrationId,routeManifest,routeManifestSha256:pageDigest(bytes)}
  await writePageAuthority(files,path.join(dataRoot,'storage-format.json'),marker)
  return {status:'initialized',dataRoot,formatVersion:5}
 })
}
export async function upgradePageRetention(dataRoot,{expectedMarkerSha256}={}){
 dataRoot=path.resolve(dataRoot);await safePagePath(dataRoot,dataRoot,{directory:true})
 const files=createDurableFilePromotion(),target=path.join(dataRoot,'storage-format.json'),pages=createPageChatRecords({dataRoot})
 return pageProcessActivity(pages.root).exclusive(()=>files.withLock(path.join(dataRoot,'.upgrade-format5'),async()=>{
  await safePagePath(dataRoot,target);const source=await readFile(target),digest=pageDigest(source)
  if(expectedMarkerSha256!==undefined&&digest!==expectedMarkerSha256)throw Error('Format marker differs from explicitly selected upgrade source')
  const marker=await createStorageFormat(dataRoot,{maximumVersion:5}).read()
  if(marker?.formatVersion===5)return {status:'already-upgraded',dataRoot,formatVersion:5}
  if(marker?.formatVersion!==4)throw Error('Format4 page migration required before retention upgrade')
  const manifest=await readChatRouteManifest(dataRoot,marker)
  for(const id of Object.keys(manifest.chats)){const route=await pages.route(id,{required:true});await pages.store.readHead(id,{snapshotId:route.snapshotId})}
  const backup='maintenance/format5/marker-format4-'+digest+'.json';await ensurePageDirectory(dataRoot,path.dirname(path.join(dataRoot,backup)));const saved=await files.write(path.join(dataRoot,backup),source);if(saved.status!=='promoted'||!(await readFile(path.join(dataRoot,backup))).equals(source))throw Error('Previous marker backup was not durably published')
  if(pageDigest(await readFile(target))!==digest)throw Error('Format marker changed during upgrade')
  await writePageAuthority(files,target,{...marker,formatVersion:5,minimumReader:'r17-p5',retentionPolicy:'current-plus-three-ordinary-v1'})
  return {status:'upgraded',dataRoot,formatVersion:5,previousMarker:backup,previousMarkerSha256:digest,retainedRoots:'all existing roots retained; classification unchanged'}
 }))
}

/** Existing unmarked or legacy data is never implicitly migrated. */
export async function initializeNewPageHomeIfEmpty(dataRoot){
 dataRoot=path.resolve(dataRoot);await mkdir(dataRoot,{recursive:true});await safePagePath(dataRoot,dataRoot,{directory:true})
 const entries=await readdir(dataRoot);if(entries.length)return {status:'existing-data-preserved',dataRoot}
 return initializePageRetentionHome(dataRoot)
}
