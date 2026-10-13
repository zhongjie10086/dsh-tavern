import {createStorageFormat} from '../tavern-plugin/lib/domain/storage-format.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {retentionFiles} from '../tavern-plugin/lib/domain/retention-policy.js'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {ensureVerifiedStorageBackup,preflightVerifiedStorageBackup} from './verified-storage-backup.mjs'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function cloneVerified(from,to){
 const rows=[]
 for(const relative of await retentionFiles(from)){
  const source=await fs.readFile(path.join(from,relative)),target=path.join(to,relative)
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source,{flag:'wx'})
  if(hash(await fs.readFile(target))!==hash(source))throw Error('副本校验失败：'+relative)
  rows.push({path:relative,sha256:hash(source),bytes:source.length})
 }
 return rows
}
/** Offline data conversion. Deployment must separately back up code and native
 * Home/Session files; this command's receipt covers the plugin data root only. */
export async function migrateResourceStorage({dataRoot,backupRoot,apply=false,onProgress}={}){
 if(!dataRoot)throw Error('需要 dataRoot')
 const original=path.resolve(dataRoot);await retentionFiles(original)
 let root=original,temporary
 if(apply){
  const record=await fs.readFile(path.resolve(original,'../../../logs/tavern.pid.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e})
  if(record?.pid){let alive=false;try{process.kill(record.pid,0);alive=true}catch(e){if(e.code==='EPERM')alive=true}if(alive)throw Error('请先停止对应实例，或在数据副本运行迁移')}
  if(!backupRoot)throw Error('写入迁移必须指定备份目录；部署还需配套代码和原生 Home 备份')
  const backup=path.resolve(backupRoot),relative=path.relative(original,backup)
  if(!relative||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))throw Error('备份目录必须在数据目录外')
  await ensureVerifiedStorageBackup(original,backup,{onProgress})
 }else{
  // The dry-run applies the same source (and, when given, backup) checks as
  // apply: a data root with a link/junction inside it or on its ancestors, or a
  // damaged completed backup, is refused here instead of only at apply time.
  await preflightVerifiedStorageBackup(original,backupRoot)
  temporary=await fs.mkdtemp(path.join(tmpdir(),'dsh-resource-dry-run-'));root=temporary
 }
 try{
  if(temporary)await cloneVerified(original,root)
  const store=createProfileDataStore({dataRoot:root}),journal=createChatJournalStore({dataRoot:root}),ids=new Set()
  for(const file of await retentionFiles(root,'chats')){const match=file.match(/^chats\/([^/]+)\//)||file.match(/^chats\/([^/.]+)\.json$/);if(match)ids.add(match[1])}
  const chats=[]
  for(const id of ids){const result=await journal.migrateResources(id);chats.push(result);onProgress?.({kind:'chat',...result})}
  const archives=await store.migratePresetArchives(),result={version:3,apply,dataRoot:original,chats,archives,changed:chats.reduce((n,row)=>n+row.changed,0)+archives.changed}
  if(apply)await createStorageFormat(root).mark()
  return result
 }finally{
  if(temporary){const target=path.resolve(temporary);if(path.dirname(target)!==path.resolve(tmpdir())||!path.basename(target).startsWith('dsh-resource-dry-run-'))throw Error('临时目录校验失败');await fs.rm(target,{recursive:true,force:true,maxRetries:3})}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
 console.log(JSON.stringify(await migrateResourceStorage({dataRoot:value('--data-root'),backupRoot:value('--backup-root'),apply:args.includes('--apply')}),null,2))
}
