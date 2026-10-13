import {open} from 'node:fs/promises'
import path from 'node:path'
import {retentionFiles,retentionFile,applyRetentionFiles} from './retention-policy.js'
const bytes=value=>Buffer.byteLength(JSON.stringify(value,null,2)+'\n')
const identity=file=>file.match(/^model-requests\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\.json$/)
const key=row=>row.chatId+'/'+row.id
async function prefix(root,file){const fd=await open(path.join(root,file),'r');try{const buffer=Buffer.alloc(1024);const {bytesRead}=await fd.read(buffer,0,buffer.length,0);return buffer.subarray(0,bytesRead).toString('utf8')}finally{await fd.close()}}

/** Request logs are optional evidence, never live-task or recovery authority. */
export async function retainModelRequests({dataRoot,store,dryRun,limits}){
 const indexPath='model-requests/index.json',records=[],unknown=[],rewrites=[]
 let requestIndex
 const indexInfo=await retentionFile(dataRoot,indexPath,'request-index')
 if(indexInfo&&indexInfo.bytes<=limits.modelRequestBytes*limits.modelRequests)try{requestIndex=await store.readJson(indexPath)}catch(error){if(!(error instanceof SyntaxError))throw error}
 const indexRows=new Map((Array.isArray(requestIndex?.requests)?requestIndex.requests:[]).filter(row=>row&&typeof row.id==='string'&&typeof row.chatId==='string').map(row=>[key(row),row]))
 for(const file of await retentionFiles(dataRoot,'model-requests')){
  if(file===indexPath)continue
  const info=await retentionFile(dataRoot,file,'superseded-model-request');if(!info)continue
  const parts=identity(file)
  if(!parts){unknown.push(info);continue}
  const chatId=parts[1],id=parts[2],row=indexRows.get(chatId+'/'+id)
  let body
  if(info.bytes<=limits.modelRequestBytes)try{body=await store.readJson(file)}catch(error){if(!(error instanceof SyntaxError))throw error}
  if(info.bytes<=limits.modelRequestBytes&&(!body||body.chatId!==chatId||body.id!==id)){unknown.push(info);continue}
  const value=body||{version:1,id,chatId,createdAt:Number(row?.createdAt)||Number(info.stamp.split(':')[1])/1e6,status:'unknown',truncated:true,originalBytes:info.bytes,preview:await prefix(dataRoot,file)}
  records.push({file:info,value,row})
 }
 records.sort((a,b)=>Number(b.value.createdAt||0)-Number(a.value.createdAt||0)||b.file.relative.localeCompare(a.file.relative))
 const keep=records.slice(0,limits.modelRequests),discarded=records.slice(limits.modelRequests).map(r=>r.file).concat(unknown)
 const nextRows=[]
 for(const item of keep){
  const {file,row}=item;let value=item.value
  const fields={id:value.id,chatId:value.chatId,turn:Number.isSafeInteger(value.turn)?value.turn:undefined,scope:['foreground','background'].includes(value.scope)?value.scope:undefined,sessionId:typeof value.sessionId==='string'&&value.sessionId.length<=256?value.sessionId:undefined,createdAt:Number.isFinite(Number(value.createdAt))?Number(value.createdAt):0}
  let entry={...fields,version:row?.version||value.version,requestBytes:row?.requestBytes,completion:row?.completion}
  // Reserve index framing as well as its receipt. A huge legacy body is never fully parsed.
  if(file.bytes+bytes(entry)+128>limits.modelRequestBytes||file.bytes>limits.modelRequestBytes){
   const merged={...value,...row?.completion}
   value={version:1,...fields,status:['running','completed','failed'].includes(merged.status)?merged.status:'unknown',truncated:true,originalBytes:value.originalBytes||file.bytes,preview:typeof value.preview==='string'?value.preview:JSON.stringify(merged).slice(0,1024)}
   entry={...fields,version:1}
   while(value.preview.length&&bytes(value)+bytes(entry)+128>limits.modelRequestBytes)value.preview=value.preview.slice(0,Math.floor(value.preview.length/2))
   if(bytes(value)+bytes(entry)+128>limits.modelRequestBytes)throw new Error('模型请求日志限额不足以保留身份回执，未裁剪原记录')
   rewrites.push({relative:file.relative,beforeBytes:file.bytes,afterBytes:bytes(value)})
   item.replacement=value
  }
  nextRows.push(entry)
 }
 if(!dryRun){
  for(const item of keep)if(item.replacement)await store.writeJson(item.file.relative,item.replacement)
  // The maintenance gate excludes live writers. Atomic write also replaces a corrupt index.
  await store.writeJson(indexPath,{version:1,requests:nextRows})
 }
 return {...await applyRetentionFiles(dataRoot,discarded,{dryRun}),rewrites,protected:[]}
}
