import {createHash,randomUUID} from 'node:crypto'
import {lstat,mkdir,open,readdir,readFile,rename,rm} from 'node:fs/promises'
import path from 'node:path'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'

const absent=async file=>{try{return await lstat(file)}catch(error){if(error.code==='ENOENT')return null;throw error}}
export async function sessionDirectoryFingerprint(directory){
 const result=[]
 async function walk(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const file=path.join(dir,entry.name)
  if(entry.isSymbolicLink())throw new Error('会话升级拒绝链接目录或文件：'+file)
  if(entry.isDirectory())await walk(file)
  else if(entry.isFile())result.push([path.relative(directory,file),createHash('sha256').update(await readFile(file)).digest('hex')])
  else throw new Error('会话目录包含非普通文件：'+file)
 }}
 await walk(directory);return createHash('sha256').update(JSON.stringify(result)).digest('hex')
}
/** Offline transaction: the backup survives success, and every crash point is resumable. */
export async function promoteNativeSessionDirectory({root,staging,receipt,verify=async()=>{},checkpoint=async()=>{}}){
 root=path.resolve(root)
 const files=createDurableFilePromotion(),journalFile=path.join(root,'native-session-upgrade-transaction.json'),lockFile=path.join(root,'native-session-upgrade.lock')
 const active=path.join(root,'sessions'),receiptFile=path.join(root,'data','native-session-upgrade.json')
 await mkdir(root,{recursive:true})
 if((await lstat(root)).isSymbolicLink())throw new Error('会话升级根目录不能是链接')
 let lock
 try{lock=await open(lockFile,'wx')}catch(error){
  if(error.code!=='EEXIST')throw error
  const stat=await lstat(lockFile);let owner;try{owner=JSON.parse(await readFile(lockFile,'utf8'))}catch{}
  let alive=true
  if(Number.isSafeInteger(owner?.pid)){try{process.kill(owner.pid,0)}catch(e){alive=e.code==='EPERM'}}
  else alive=Date.now()-stat.mtimeMs<60000
  if(alive)throw new Error('另一个进程正在升级会话')
  await rm(lockFile);lock=await open(lockFile,'wx')
 }
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,id:randomUUID()}));await lock.sync()
  const read=async file=>{const bytes=await files.read(file);return bytes===undefined?null:JSON.parse(bytes.toString())}
  let tx=await read(journalFile)
  if(tx?.phase==='complete'||tx?.phase==='abandoned'){
   if(!staging)return {recovered:false,abandoned:tx.phase==='abandoned',receipt:await read(receiptFile)}
   tx=null
  }
  function sibling(target){
   const value=path.resolve(target)
   if(path.dirname(value)!==root||value===root)throw new Error('升级路径必须位于指定会话根目录内：'+value)
   return value
  }
  const dataDir=await absent(path.dirname(receiptFile));if(dataDir?.isSymbolicLink())throw new Error('升级回执目录不能是链接')
  if(!tx){
   if(!staging)return {recovered:false}
   staging=sibling(staging)
   if(staging===active)throw new Error('升级暂存目录与活动目录相同')
   const backup=sibling(path.join(root,'sessions-before-native-v3-'+randomUUID()))
   if(!receipt?.id||!receipt.sessions)throw new Error('升级缺少经过验证的迁移映射')
   await verify(staging)
   tx={version:1,id:receipt.id,phase:'prepared',active,staging,backup,
    original:await sessionDirectoryFingerprint(active),candidate:await sessionDirectoryFingerprint(staging),receipt:{...receipt,backup}}
   await files.write(journalFile,JSON.stringify(tx));await checkpoint('prepared')
  }
  if(tx.version!==1||tx.active!==active||!tx.receipt?.id)throw new Error('升级事务回执无效')
  const staged=sibling(tx.staging),backup=sibling(tx.backup)
  for(const value of [active,staged,backup])if((await absent(value))?.isSymbolicLink())throw new Error('升级事务目标已变成链接：'+value)
  let hasActive=!!await absent(active),hasStaged=!!await absent(staged),hasBackup=!!await absent(backup)
  if(!hasBackup){
   const changed=!hasActive||!hasStaged||await sessionDirectoryFingerprint(active)!==tx.original||await sessionDirectoryFingerprint(staged)!==tx.candidate
   if(changed&&hasActive&&tx.phase==='prepared'){
    // Nothing has moved: preserve both directories and retire only the stale plan.
    const bytes=await files.read(journalFile),archive=path.join(root,'recovery','session-upgrades',createHash('sha256').update(bytes).digest('hex')+'.json')
    for(const directory of [path.dirname(path.dirname(archive)),path.dirname(archive)])if((await absent(directory))?.isSymbolicLink())throw new Error('升级恢复目录不能是链接')
    await files.write(archive,bytes)
    if(!(await files.read(archive)).equals(bytes))throw new Error('升级恢复备份验证失败')
    tx={...tx,phase:'abandoned',recoveryBackup:archive,reason:'prepared-input-changed'}
    await files.write(journalFile,JSON.stringify(tx))
    return {recovered:true,abandoned:true,backup:archive}
   }
   if(changed)throw new Error('升级前的会话或暂存副本已变化')
   await rename(active,backup);hasBackup=true;hasActive=false;await checkpoint('backup-renamed')
   tx.phase='backed-up';await files.write(journalFile,JSON.stringify(tx));await checkpoint('backed-up')
  }
  if(await sessionDirectoryFingerprint(backup)!==tx.original)throw new Error('升级备份已变化，停止自动恢复')
  if(!hasActive){
   if(!hasStaged||await sessionDirectoryFingerprint(staged)!==tx.candidate)throw new Error('升级暂存副本已变化；原存档仍保留在 '+backup)
   await rename(staged,active);hasActive=true;hasStaged=false;await checkpoint('active-renamed')
   tx.phase='activated';await files.write(journalFile,JSON.stringify(tx));await checkpoint('activated')
  }
  if(hasStaged||await sessionDirectoryFingerprint(active)!==tx.candidate)throw new Error('升级目录状态冲突，拒绝覆盖已有会话')
  // Only a verified, active directory may acquire the new sequence map.
  await files.write(receiptFile,JSON.stringify(tx.receipt));await checkpoint('receipt-written')
  tx.phase='complete';await files.write(journalFile,JSON.stringify(tx));await checkpoint('complete')
  return {recovered:!staging,backup,receipt:tx.receipt}
 }finally{await lock.close().catch(()=>{});await rm(lockFile,{force:true})}
}
