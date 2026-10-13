import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'
import {encodeSpFloorArchive,decodeSpFloorArchive} from '../tavern-plugin/lib/domain/sp-floor-archive-format.js'
const hash=value=>createHash('sha256').update(value).digest('hex')
function alive(pid){try{process.kill(pid,0);return true}catch(error){return error.code==='EPERM'}}
async function noLinks(root,relative){let current=path.resolve(root);for(const part of relative.split(/[\\/]/).filter(Boolean)){current=path.join(current,part);const info=await fs.lstat(current).catch(error=>{if(error.code!=='ENOENT')throw error});if(info?.isSymbolicLink())throw Error('数据目录含链接，停止迁移')}}

/** Offline format-only conversion: original logical floor hashes and journal revisions do not change. */
export async function compactSpFloorStorage({dataRoot,backupRoot,apply=false}){
 const root=path.resolve(dataRoot),backup=backupRoot&&path.resolve(backupRoot),files=createDurableFilePromotion(),archives=createProfileDataStore({dataRoot:root})
 if(apply){
  const rel=backup&&path.relative(root,backup)
  if(!backup||!rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)))throw Error('必须提供数据目录外的备份位置')
  const record=await fs.readFile(path.resolve(root,'../../../logs/tavern.pid.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error})
  if(Number.isSafeInteger(record?.pid)&&record.pid>0&&alive(record.pid))throw Error('请先停止此数据目录的 DSH Tavern 实例')
 }
 await noLinks(root,'sp-floor-archives');await noLinks(root,'sp-static-data')
 async function work(){
  const previous=apply?await fs.readFile(path.join(backup,'manifest.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error}):undefined
  if(previous&&(previous.dataRoot!==root||previous.format!=='sp-floor-v2'))throw Error('备份目录属于另一迁移')
  const backups=new Map((previous?.backups||[]).map(row=>[row.path,row])),rows=[],virtual=new Map()
  const writer=apply?archives:{async updateJson(name,fn){const current=virtual.get(name)??await archives.readJson(name),next=fn(current);if(next!==undefined)virtual.set(name,next)},async readReadonly(name){return virtual.get(name)??await archives.readReadonly(name)}}
  for(const name of await fs.readdir(path.join(root,'sp-floor-archives')).catch(error=>{if(error.code==='ENOENT')return[];throw error})){
   if(!/^[a-f0-9]{64}\.json$/.test(name))continue
   const relative='sp-floor-archives/'+name;await noLinks(root,relative)
   const target=path.join(root,relative),before=await fs.readFile(target,'utf8'),digest=name.slice(0,-5),value=JSON.parse(before)
   const logical=await decodeSpFloorArchive(value,digest,archives.readReadonly),encoded=await encodeSpFloorArchive(logical,writer)
   const after=JSON.stringify(encoded,null,2)+'\n'
   if(JSON.stringify(await decodeSpFloorArchive(encoded,digest,writer.readReadonly))!==JSON.stringify(logical))throw Error('转换后数据不一致')
   // Already converted files retain their bytes, even if the previous writer used different formatting.
   const changed=JSON.stringify(value)!==JSON.stringify(encoded)
   const row={path:relative,beforeHash:hash(before),afterHash:changed?hash(after):hash(before),beforeBytes:Buffer.byteLength(before),afterBytes:changed?Buffer.byteLength(after):Buffer.byteLength(before),changed}
   if(apply&&changed){
    const copy=path.join(backup,relative),existing=await fs.readFile(copy).catch(error=>{if(error.code!=='ENOENT')throw error})
    if(existing&&hash(existing)!==row.beforeHash)throw Error('备份目录已有另一版本，停止迁移')
    if(!existing){await fs.mkdir(path.dirname(copy),{recursive:true});await fs.writeFile(copy,before,{flag:'wx',flush:true})}
    if(hash(await fs.readFile(copy))!==row.beforeHash)throw Error('备份校验失败')
    backups.set(relative,row)
    await files.write(path.join(backup,'manifest.json'),Buffer.from(JSON.stringify({format:'sp-floor-v2',dataRoot:root,complete:false,backups:[...backups.values()]},null,2)))
    await files.update(target,current=>{if(!current||hash(current)!==row.beforeHash)throw Error('迁移期间归档发生变化');return Buffer.from(after)})
    await decodeSpFloorArchive(JSON.parse((await files.read(target)).toString()),digest,archives.readReadonly)
   }
   rows.push(row)
  }
  const result={format:'sp-floor-v2',dataRoot:root,apply,complete:true,files:rows.length,changed:rows.filter(row=>row.changed).length,beforeBytes:rows.reduce((n,row)=>n+row.beforeBytes,0),afterBytes:rows.reduce((n,row)=>n+row.afterBytes,0),rows}
  if(apply)await files.write(path.join(backup,'manifest.json'),Buffer.from(JSON.stringify({...result,backups:[...backups.values()]},null,2)))
  return result
 }
 return apply?files.withLock(path.join(root,'.sp-floor-format-migration'),work):work()
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
 if(!value('--data-root'))throw Error('需要 --data-root；写入还需 --apply --backup-root')
 const result=await compactSpFloorStorage({dataRoot:value('--data-root'),backupRoot:value('--backup-root'),apply:args.includes('--apply')})
 console.log(JSON.stringify({...result,rows:undefined},null,2))
}
