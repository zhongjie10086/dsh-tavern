import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {encodePackedJson,decodePackedJson} from '../tavern-plugin/lib/packed-json.js'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'

const hash=value=>createHash('sha256').update(value).digest('hex')
const allowed=/^(?:preset-history\/[a-f0-9]{64}\.json|chats\/[^/]+\.json|chats\/[^/]+\/(?:snapshots\/\d{12}\.json|journals\/\d{12}-(?:open|\d{12})\.jsonl))$/
async function paths(root,relative,result=[]){
  const target=path.resolve(root,relative)
  const rel=path.relative(root,target)
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('数据路径越界')
  const info=await fs.lstat(target).catch(e=>{if(e.code!=='ENOENT')throw e})
  if(!info)return result
  if(info.isSymbolicLink())throw Error('数据目录含链接，停止迁移')
  if(info.isDirectory())for(const name of await fs.readdir(target))await paths(root,path.join(relative,name),result)
  else if(info.isFile()&&allowed.test(relative.replaceAll('\\','/')))result.push(relative.replaceAll('\\','/'))
  return result
}
async function logicalDocuments(text,relative){
  return relative.endsWith('.jsonl')?await Promise.all(text.split('\n').filter(s=>s.trim()).map(s=>decodePackedJson(s))):[await decodePackedJson(text)]
}
function processAlive(pid){try{process.kill(pid,0);return true}catch(e){return e.code==='EPERM'}}

/** Offline only. Each changed file has a verified original before any publication. */
export async function compactChatStorage({dataRoot,backupRoot,apply=false,unpack=false}){
  const root=path.resolve(dataRoot),files=createDurableFilePromotion(),backup=backupRoot&&path.resolve(backupRoot)
  if(apply){
    const rel=backup&&path.relative(root,backup)
    if(!backup||!rel||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep)))throw Error('必须提供数据目录外的备份位置')
    const record=await fs.readFile(path.resolve(root,'../../../logs/tavern.pid.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e})
    if(record&&Number.isSafeInteger(record.pid)&&record.pid>0&&processAlive(record.pid))throw Error('请先停止此数据目录的 DSH Tavern 实例')
  }
  const rows=[],started=Date.now()
  async function work(){
    const previous=apply?await fs.readFile(path.join(backup,'manifest.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e}):undefined
    if(previous&&(previous.dataRoot!==root||previous.unpack!==unpack))throw Error('备份目录属于另一迁移')
    const backups=new Map((previous?.backups||[]).map(row=>[row.path,row]))
    const targets=[...await paths(root,'chats'),...await paths(root,'preset-history')]
    const encodedDocuments=(text,relative)=>relative.endsWith('.jsonl')?text.split('\n').filter(s=>s.trim()).map(JSON.parse):[JSON.parse(text)]
    // This maintenance tool predates mandatory execution contracts. Preflight
    // every input before touching a source or backup: converting a string tag
    // through Number() would silently remove its old-reader rejection barrier.
    for(const relative of targets){
      const rows=encodedDocuments(await fs.readFile(path.join(root,relative),'utf8'),relative)
      if(rows.some(row=>Object.hasOwn(row||{},'$dshPackedJson')&&![1,2,3].includes(row.$dshPackedJson)))throw Error('compact/unpack 不支持新合同存档，禁止移除 card-mvu 读取保护；回退请恢复匹配代码和升级前完整 Home 备份')
    }
    // Compression removal is not a storage-format downgrade. Reference-based
    // formats require the matching code and complete data, never a bare JSON swap.
    if(unpack)for(const relative of targets){const rows=encodedDocuments(await fs.readFile(path.join(root,relative),'utf8'),relative);if(rows.some(row=>Number(row?.$dshPackedJson)>=2))throw Error('资源引用存档不能用 --unpack 降级；请同时恢复配套代码和完整 Home 备份')}
    for(const relative of targets){
      const target=path.join(root,relative),before=await fs.readFile(target,'utf8'),documents=await logicalDocuments(before,relative)
      const versions=encodedDocuments(before,relative).map(row=>Number(row?.$dshPackedJson)||1)
      const after=(await Promise.all(documents.map((v,index)=>unpack?JSON.stringify(v,null,relative.endsWith('.jsonl')?undefined:2)+'\n':encodePackedJson(v,{pretty:!relative.endsWith('.jsonl'),storageVersion:versions[index]})))).join('')
      const logicalHash=hash(JSON.stringify(documents)),reopened=await logicalDocuments(after,relative)
      if(hash(JSON.stringify(reopened))!==logicalHash)throw Error('迁移回读与原数据不一致：'+relative)
      const row={path:relative,beforeBytes:Buffer.byteLength(before),afterBytes:Buffer.byteLength(after),beforeHash:hash(before),afterHash:hash(after),logicalHash,changed:before!==after}
      if(apply&&row.changed){
        const copy=path.join(backup,relative),existing=await fs.readFile(copy).catch(e=>{if(e.code!=='ENOENT')throw e})
        if(existing&&hash(existing)!==row.beforeHash)throw Error('备份目录已有另一版本，停止迁移：'+relative)
        if(!existing){await fs.mkdir(path.dirname(copy),{recursive:true});await fs.writeFile(copy,before,{flag:'wx',flush:true})}
        if(hash(await fs.readFile(copy))!==row.beforeHash)throw Error('备份校验失败')
        backups.set(relative,row)
        await files.write(path.join(backup,'manifest.json'),Buffer.from(JSON.stringify({version:1,dataRoot:root,unpack,complete:false,backups:[...backups.values()]},null,2)))
        await files.update(target,current=>{if(!current||hash(current)!==row.beforeHash)throw Error('迁移时文件被另一写者修改，停止：'+relative);return Buffer.from(after)})
        if(hash(JSON.stringify(await logicalDocuments((await files.read(target)).toString(),relative)))!==logicalHash)throw Error('已发布文件校验失败：'+relative)
      }
      rows.push(row)
    }
    const result={version:1,dataRoot:root,unpack,apply,complete:true,files:rows.length,changed:rows.filter(r=>r.changed).length,beforeBytes:rows.reduce((n,r)=>n+r.beforeBytes,0),afterBytes:rows.reduce((n,r)=>n+r.afterBytes,0),durationMs:Date.now()-started,rows}
    if(apply)await files.write(path.join(backup,'manifest.json'),Buffer.from(JSON.stringify({...result,backups:[...backups.values()]},null,2)))
    return result
  }
  return apply?files.withLock(path.join(root,'.packed-storage-migration'),work):work()
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]}
  if(!value('--data-root'))throw Error('需要 --data-root；写入还需 --apply --backup-root。--unpack 可还原普通 JSON')
  const result=await compactChatStorage({dataRoot:value('--data-root'),backupRoot:value('--backup-root'),apply:args.includes('--apply'),unpack:args.includes('--unpack')})
  console.log(JSON.stringify({...result,rows:undefined},null,2))
}
