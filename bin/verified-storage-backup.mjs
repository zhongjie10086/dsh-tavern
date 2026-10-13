import fs from 'node:fs/promises'
import {constants} from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'

const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
async function present(target){try{await fs.lstat(target);return true}catch(error){if(error.code==='ENOENT')return false;throw error}}
function relativeFile(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.includes('\0')||path.posix.isAbsolute(value)||value.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('备份文件路径无效')
 return value
}
// Windows paths are case-insensitive; a receipt written for D:\Data matches d:\data.
const sameRoot=(a,b)=>typeof a==='string'&&(process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b)
const contains=(root,target)=>{const rel=path.relative(root,target);return !rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))}
async function linkHint(target){
 const real=await fs.realpath(target).catch(()=>null)
 return real?'（该处实际指向 '+real+'）；请改用不经过链接/联接的真实路径，或先制作不含联接的数据副本':'；请先移除或替换该链接'
}
// Check every existing ancestor, including ancestors outside the supplied root.
// A stopped copy containing a link/device is not a complete regular-file backup.
async function plainPath(input,{directory=false,missing=false}={}){
 const absolute=path.resolve(input),parts=absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean)
 let target=path.parse(absolute).root,info=await fs.lstat(target)
 for(let index=0;index<parts.length;index++){
  target=path.join(target,parts[index])
  try{info=await fs.lstat(target)}catch(error){if(missing&&error.code==='ENOENT')return absolute;throw error}
  if(info.isSymbolicLink())throw Error('备份和源目录及其祖先不能包含符号链接或联接：'+target+await linkHint(target))
  if(!info.isFile()&&!info.isDirectory())throw Error('备份和源目录不能包含特殊文件：'+target)
  if((index<parts.length-1||directory)&&!info.isDirectory())throw Error('备份和源路径需要普通目录')
 }
 if(directory&&!info.isDirectory())throw Error('备份和源路径需要普通目录')
 return absolute
}
async function inside(root,relative){return plainPath(path.join(root,relativeFile(relative)),{missing:true})}
async function readRegular(target){
 await plainPath(target)
 // O_NONBLOCK prevents a raced-in FIFO from blocking; fstat verifies the opened
 // object before reading. O_NOFOLLOW also closes the final-component link race.
 const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0))
 try{if(!(await handle.stat()).isFile())throw Error('备份文件必须是普通文件');return await handle.readFile()}finally{await handle.close()}
}
async function inventory(root){
 root=await plainPath(root,{directory:true});const files=[]
 async function visit(relative=''){
  for(const name of (await fs.readdir(path.join(root,relative))).sort()){
   const rel=relativeFile(relative?relative+'/'+name:name),target=await inside(root,rel),info=await fs.lstat(target)
   if(info.isDirectory())await visit(rel)
   else{const bytes=await readRegular(target);files.push({path:rel,sha256:hash(bytes),bytes:bytes.length})}
  }
 }
 await visit();return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
}
function validFiles(files){
 if(!Array.isArray(files))throw Error('备份文件清单无效')
 const seen=new Set()
 for(const row of files){
  if(!row||typeof row!=='object')throw Error('备份文件清单无效')
  relativeFile(row.path)
  if(seen.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))throw Error('备份文件清单无效')
  seen.add(row.path)
 }
 return files
}
function compareFiles(actual,files){
 const expected=new Map(files.map(row=>[row.path,row])),seen=new Set(),extra=[],changed=[]
 for(const row of actual){const prior=expected.get(row.path);if(!prior){extra.push(row.path);continue};seen.add(row.path);if(prior.bytes!==row.bytes||prior.sha256!==row.sha256)changed.push(row.path)}
 return {missing:files.filter(row=>!seen.has(row.path)).map(row=>row.path),extra,changed}
}
async function verify(root,files){
 validFiles(files)
 if(!await present(root))return false
 const {missing,extra,changed}=compareFiles(await inventory(root),files)
 return !missing.length&&!extra.length&&!changed.length
}
// Files the OS shell writes into folders it displays (Explorer, Finder).
const shellMetadata=new Set(['desktop.ini','thumbs.db','ehthumbs.db','ehthumbs_vista.db','.ds_store'])
const sample=list=>list.slice(0,5).join('、')+(list.length>5?' 等 '+list.length+' 个':'')
// A completed backup is never rewritten. When it no longer matches its receipt,
// say exactly what differs and what the operator can do about it.
async function verifyCompleted(backup,files){
 const data=path.join(backup,'data')
 if(!await present(data))throw Object.assign(Error('备份内容校验失败；已保留现有备份。'+data+' 不存在；已完成的备份被移动或删除，请改用新的备份目录'),{code:'BACKUP_DATA_MISSING'})
 const {missing,extra,changed}=compareFiles(await inventory(data),files)
 if(!missing.length&&!extra.length&&!changed.length)return
 const parts=[extra.length&&'多出 '+sample(extra),missing.length&&'缺少 '+sample(missing),changed.length&&'内容不同 '+sample(changed)].filter(Boolean).join('；')
 const onlyExtra=!missing.length&&!changed.length,onlyShell=onlyExtra&&extra.every(name=>shellMetadata.has(path.posix.basename(name).toLowerCase()))
 const hint=onlyShell?'这些是操作系统在浏览文件夹时自动生成的文件（如 desktop.ini、Thumbs.db），清单内的备份文件均完好：把它们移出 '+data+' 后重试即可，备份目录可继续使用'
  :onlyExtra?'清单内的备份文件均完好，但 '+data+' 下出现了清单外的文件：确认来源后把它们移出再重试，或改用新的备份目录'
  :'已完成的备份已被修改或损坏，不能再作为迁移前备份：请保留它以便排查，并改用新的备份目录'
 throw Object.assign(Error('备份内容校验失败；已保留现有备份。'+parts+'。'+hint),{code:onlyExtra?'BACKUP_EXTRA_FILES':'BACKUP_CONTENT_MISMATCH',extra,missing,changed})
}
async function checkCompletedReceipt(original,backup,bytes){
 const prior=JSON.parse(bytes)
 if(prior.version!==1||prior.complete!==true||prior.scope!=='plugin-data-only')throw Error('备份回执不匹配或未完成：'+backup+' 不是本工具完成的插件数据备份；请改用新的备份目录')
 if(!sameRoot(prior.dataRoot,original))throw Error('备份回执不匹配：该备份属于数据目录 '+prior.dataRoot+'，本次为 '+original+'；请改用新的备份目录')
 validFiles(prior.files)
 await verifyCompleted(backup,prior.files)
}

// An unfinished backup's intent names the data root it belongs to. Dry-run and
// apply read it the same way, so both refuse another root's leftover intent.
function checkPendingIntent(original,backup,bytes){
 if(!bytes)return null
 const intent=JSON.parse(bytes)
 if(intent.version!==1||!sameRoot(intent.dataRoot,original)||!Array.isArray(intent.files))throw Error('备份准备记录与源目录不匹配：'+backup+' 中未完成的备份属于 '+intent.dataRoot+'；请改用新的备份目录')
 validFiles(intent.files)
 return intent
}

/** Every check the apply path makes before its first write, without writing.
 * The migration dry-run runs this too, so dry-run and apply accept and refuse
 * the same source/backup layouts (links, devices, damaged completed backups,
 * another root's unfinished backup). */
export async function preflightVerifiedStorageBackup(original,backup){
 original=path.resolve(original)
 if(backup!==undefined){backup=path.resolve(backup);if(contains(original,backup)||contains(backup,original))throw Error('备份目录必须与源数据目录完全分离')}
 // Source bytes may have legitimately changed after a completed original backup.
 await inventory(original)
 if(backup===undefined)return {original}
 await plainPath(backup,{directory:true,missing:true})
 if(await present(backup)){
  await inventory(backup)
  const bytes=await createDurableFilePromotion().read(await inside(backup,'resource-storage-backup.json'))
  if(bytes)await checkCompletedReceipt(original,backup,bytes)
  else checkPendingIntent(original,backup,await createDurableFilePromotion().read(await inside(backup,'resource-storage-backup.pending.json')))
 }
 return {original,backup}
}

/** The manifest is the commit point. Never open SQLite in the source. A staged
 * copy can resume after a crash; an old incomplete data directory is preserved.
 * This receipt covers plugin data only. Full-Home recovery uses the separately
 * pinned recoveryPreflight receipt and readVerifiedHomeBackup. */
export async function ensureVerifiedStorageBackup(original,backup,{onProgress}={}){
 original=path.resolve(original);backup=path.resolve(backup)
 // Reject unsupported source/destination trees before any backup write.
 await preflightVerifiedStorageBackup(original,backup)
 const durable=createDurableFilePromotion(),manifest=await inside(backup,'resource-storage-backup.json')
 await durable.update(manifest,async bytes=>{
  if(bytes){await checkCompletedReceipt(original,backup,bytes);return undefined}
  const intentFile=await inside(backup,'resource-storage-backup.pending.json'),stage=await inside(backup,'data.staging'),final=await inside(backup,'data')
  let intent=checkPendingIntent(original,backup,await durable.read(intentFile))
  if(!intent){
   // A directory with no intent cannot be assumed to belong to this attempt.
   if(await present(stage))await fs.rename(stage,await inside(backup,'interrupted-staging-'+randomUUID()))
   intent={version:1,dataRoot:original,files:await inventory(original)}
   await durable.write(intentFile,JSON.stringify(intent))
  }
  if(JSON.stringify(await inventory(original))!==JSON.stringify(intent.files))throw Error('备份中断后源数据已变化；请使用新的备份目录，旧副本已保留')
  if(!await verify(final,intent.files)){
   await fs.mkdir(stage,{recursive:true})
   for(const row of intent.files){
    const target=await inside(stage,row.path),source=await readRegular(await inside(original,row.path))
    if(source.length!==row.bytes||hash(source)!==row.sha256)throw Error('备份期间源数据已变化：'+row.path)
    const current=await durable.read(target)
    if(!current||hash(current)!==row.sha256)await durable.write(target,source)
    onProgress?.({kind:'backup',path:row.path})
   }
   if(!await verify(stage,intent.files))throw Error('备份暂存副本校验失败')
   if(JSON.stringify(await inventory(original))!==JSON.stringify(intent.files))throw Error('备份期间源数据已变化；尚未开始迁移')
   if(await present(final))await fs.rename(final,await inside(backup,'interrupted-data-'+randomUUID()))
   await fs.rename(stage,final)
  }
  onProgress?.({kind:'backup-ready'})
  if(!await verify(final,intent.files))throw Error('备份最终副本校验失败')
  if(JSON.stringify(await inventory(original))!==JSON.stringify(intent.files))throw Error('备份期间源数据已变化；尚未开始迁移')
  return Buffer.from(JSON.stringify({version:1,complete:true,dataRoot:original,scope:'plugin-data-only',files:intent.files},null,2)+'\n')
 },{waitMs:30000})
}
