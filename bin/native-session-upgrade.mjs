import {isDeepStrictEqual} from 'node:util'
import {randomUUID} from 'node:crypto'
import {cp,mkdir,mkdtemp,open,readFile,readdir,rm,unlink,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {zstdDecompressSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import {decodeZstdFrames} from './session-prefix-migration.mjs'
import {migrateTavernV0} from './tavern-session-migration.mjs'
import {promoteNativeSessionDirectory,sessionDirectoryFingerprint} from './native-session-promotion.mjs'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'
import {processBirth,processOwnerIsLive} from '../tavern-plugin/lib/process-identity.js'

// Pinned v0 storage vocabulary: packed provider deltas are expanded losslessly.
export function decodeLegacyTavernRecord(row){
 if(!['text-chunks','reasoning-chunks','tool-call-chunks'].includes(row?.type)){
  if(row?.sourceEventSeqs!==undefined){
   if(!Array.isArray(row.sourceEventSeqs)||!Number.isSafeInteger(row.seq))throw new Error('旧会话来源编号无效')
   const refs=[];let ranged=false
   for(const value of row.sourceEventSeqs){
    const range=Array.isArray(value);if(range&&value.length!==2)throw new Error('旧会话来源区间无效')
    const first=range?value[0]:value,last=range?value[1]:value
    if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||last<first||last>=row.seq||last-first+1>row.seq-refs.length)throw new Error('旧会话来源区间越界')
    for(let seq=first;seq<=last;seq++)refs.push(seq)
    ranged ||= range
   }
   if(ranged&&refs.some((n,i)=>i&&n<=refs[i-1]))throw new Error('旧会话来源区间顺序无效')
   row={...row,sourceEventSeqs:refs}
  }
  return [row]
 }
 const data=row.data,tool=row.type==='tool-call-chunks',members=tool?data?.args:data?.texts
 const exact=(object,keys)=>object&&Object.keys(object).length===keys.length&&keys.every(key=>Object.hasOwn(object,key))
 const keys=['turn','step','index','dt',tool?'args':'texts',...tool?['id',...Object.hasOwn(data||{},'name')?['name']:[]]:[]]
 if(!exact(row,['type','seq0','time0','data'])||!exact(data,keys)||!Number.isSafeInteger(row.seq0)||row.seq0<0||!Number.isSafeInteger(row.time0)||!['turn','step','index'].every(key=>Number.isFinite(data[key]))||!Array.isArray(members)||!members.length||members.some(x=>typeof x!=='string')||!Array.isArray(data.dt)||data.dt.length!==members.length-1||data.dt.some(x=>!Number.isSafeInteger(x))||tool&&(typeof data.id!=='string'||Object.hasOwn(data,'name')&&typeof data.name!=='string'))throw new Error('旧会话分块编码损坏：'+row.type)
 let time=row.time0
 return members.map((value,index)=>{
  if(index)time+=data.dt[index-1]
  if(!Number.isSafeInteger(time)||!Number.isSafeInteger(row.seq0+index))throw new Error('旧会话分块的时间或编号超出范围')
  const chunk=tool?{type:'tool-call-delta',index:data.index,id:data.id,...Object.hasOwn(data,'name')?{name:data.name}:{},argumentsDelta:value}:{type:row.type==='text-chunks'?'text-delta':'reasoning-delta',index:data.index,text:value}
  return {type:'assistant/chunk',seq:row.seq0+index,time,data:{turn:data.turn,step:data.step,chunk}}
 })
}
export function readLegacyTavernArtifact(bytes,compressed=false){
 const text=(compressed?decodeZstdFrames(bytes):bytes).toString('utf8')
 if(!text.endsWith('\n'))throw new Error('会话文件末尾不完整，不能升级')
 const [header,...records]=text.trimEnd().split('\n').map(JSON.parse)
 const events=records.flatMap(decodeLegacyTavernRecord)
 if(header.type!=='session'||header.version!==0||typeof header.id!=='string')throw new Error('不是已审计的 Tavern v0 会话')
 const {type,seedLength,...meta}=header
 if(seedLength!==undefined&&(!Number.isSafeInteger(seedLength)||seedLength<0||seedLength>events.length))throw new Error('旧会话继承边界无效')
 return {meta:{...meta,isSeeded:seedLength!==undefined},events,inheritedEventCount:seedLength||0}
}
export function legacyTavernTranscript(artifact){
 const nodes=[]
 for(const event of artifact.events){
  if(event.surfaceOp==='append')nodes.push(event)
  else if(event.surfaceOp?.op==='replace'){
   const a=nodes.findIndex(e=>e.seq===event.surfaceOp.start),b=nodes.findIndex(e=>e.seq===event.surfaceOp.end)
   if(a<0||b<a)throw new Error('旧会话可见历史区间无效')
   nodes.splice(a,b-a+1,event)
  }
 }
 return nodes.map(event=>event.type==='user/message'?event.data:['assistant/message','tool/result'].includes(event.type)?event.data.message:null).filter(m=>m?.role!=='system'&&m?.content?.length).map(m=>({role:m.role,content:m.content}))
}
async function sessionFiles(root){
 const output=[]
 async function visit(dir){let entries;try{entries=await readdir(dir,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}
 for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('升级不读取链接会话：'+file);if(entry.isDirectory())await visit(file);else if(entry.isFile()&&['session.jsonl','session.jsonl.zstd'].includes(entry.name))output.push(file)}}
 await visit(root);return output
}
async function sessionHeader(file){
 const handle=await open(file,'r');let bytes
 try{const buffer=Buffer.alloc(65536);const read=await handle.read(buffer,0,buffer.length,0);bytes=buffer.subarray(0,read.bytesRead)}finally{await handle.close()}
 if(file.endsWith('.zstd')){try{bytes=zstdDecompressSync(bytes)}catch{bytes=zstdDecompressSync(await readFile(file))}}
 let text=bytes.toString('utf8'),end=text.indexOf('\n');if(end<0){const full=await readFile(file);text=(file.endsWith('.zstd')?decodeZstdFrames(full):full).toString('utf8');end=text.indexOf('\n')}
 if(end<0)throw new Error('会话头不完整')
 const header=JSON.parse(text.slice(0,end));if(header.type!=='session'||typeof header.id!=='string'||!header.id)throw new Error('会话头无效')
 return header
}
async function runtimeModules(entry){
 let dir=path.dirname(path.resolve(entry))
 for(let index=0;index<8;index++,dir=path.dirname(dir)){
  try{if(JSON.parse(await readFile(path.join(dir,'package.json'),'utf8')).name==='@deepseek-ai/dsh')return path.join(dir,'node_modules','@deepseek-ai')}catch{}
 }
 throw new Error('找不到隔离 DSH 内核依赖，无法验证旧会话')
}
/** Run before starting the service. Existing v3 games take only a header scan. */
export async function cleanupAbandonedNativeValidation(root){
 root=path.resolve(root)
 let names;try{names=await readdir(root)}catch(error){if(error.code==='ENOENT')return;throw error}
 const files=createDurableFilePromotion(),markers=new Set(names.map(name=>name.match(/^(native-session-validation-owner-[a-f0-9-]+\.json)(?:\.pending-.*)?$/)?.[1]).filter(Boolean))
 let original
 for(const name of markers){
  const file=path.join(root,name)
  let owner;try{owner=JSON.parse((await files.read(file)).toString())}catch{continue}
  if(owner?.version!==1||!Number.isSafeInteger(owner.pid)||owner.pid<=0||processOwnerIsLive(owner))continue
  if(typeof owner.staging!=='string'||path.dirname(owner.staging)!==root||!/^sessions-v3-staging-[a-zA-Z0-9]+$/.test(path.basename(owner.staging)))continue
  if(typeof owner.config!=='string'||path.dirname(owner.config)!==root||!/^native-session-upgrade-validation-[a-f0-9-]+\.yml$/.test(path.basename(owner.config)))continue
  const bytes=await files.read(path.join(root,'native-session-upgrade-transaction.json'))
  if(bytes&&JSON.parse(bytes.toString()).staging===owner.staging)continue
  original??=await sessionDirectoryFingerprint(path.join(root,'sessions'))
  if(original!==owner.original)continue
  await rm(owner.staging,{recursive:true,force:true});await rm(owner.config,{force:true});await files.remove(file)
 }
}

export async function upgradeNativeTavernSessions({root,cwd,dshEntry,checkpoint}){
 root=path.resolve(root);const active=path.join(root,'sessions'),files=createDurableFilePromotion()
 await cleanupAbandonedNativeValidation(root)
 const journalBytes=await files.read(path.join(root,'native-session-upgrade-transaction.json'))
 if(journalBytes&&JSON.parse(journalBytes.toString()).phase!=='complete')await promoteNativeSessionDirectory({root,checkpoint})
 const originals=await sessionFiles(active),legacy=[],ids=new Set()
 for(const file of originals){
  const header=await sessionHeader(file)
  if(ids.has(header.id))throw new Error('会话存在重复的存储文件：'+header.id);ids.add(header.id)
  if(header.version===0)legacy.push({file,artifact:readLegacyTavernArtifact(await readFile(file),file.endsWith('.zstd'))})
  else if(header.version!==3)throw new Error('不支持自动升级的会话版本：'+header.version)
 }
 if(!legacy.length)return {upgraded:0}
 const before=await sessionDirectoryFingerprint(active),base=await runtimeModules(typeof dshEntry==='function'?await dshEntry():dshEntry)
 const [{boot},{Session},{AssistantStreamAccumulator}]=await Promise.all(['dsh-app-boot','dsh-session','dsh-llm'].map(name=>import(pathToFileURL(path.join(base,name,'lib','index.js')))))
 const staging=await mkdtemp(path.join(root,'sessions-v3-staging-'))
 const config=path.join(root,'native-session-upgrade-validation-'+randomUUID()+'.yml')
 const ownerFile=path.join(root,'native-session-validation-owner-'+randomUUID()+'.json')
 let ctx
 try {
 await files.write(ownerFile,JSON.stringify({version:1,pid:process.pid,birth:processBirth(),createdAt:Date.now(),staging,config,original:before}))
 for(const name of await readdir(active))await cp(path.join(active,name),path.join(staging,name),{recursive:true,errorOnExist:true,force:false})
 for(const item of legacy)await unlink(path.join(staging,path.relative(active,item.file)))
 await writeFile(config,JSON.stringify([{name:pathToFileURL(path.join(base,'dsh-session','lib','index.js')).href},{name:pathToFileURL(path.join(base,'dsh-session-persistence-jsonl','lib','index.js')).href,config:{root:staging}}]))
 await checkpoint?.('validation-prepared')
 ctx=await boot('tavern-native-upgrade',config)
 const sessions={},reports=[]
 const transcript=session=>session.deriveMessages().filter(m=>m.role!=='system'&&m.content?.length).map(m=>({role:m.role,content:m.content}))
 try{
  for(const {artifact} of legacy){
   const next=migrateTavernV0(artifact,{cwd:cwd||artifact.meta.cwd,Session,AssistantStreamAccumulator})
   const native=Session.fromRestore(next.header.id,next.events,next.header,next.inheritedEventCount,'detached')
   if(!isDeepStrictEqual(transcript(native),legacyTavernTranscript(artifact)))throw new Error('升级改变了模型可见历史：'+next.header.id)
   const writer=await ctx.sessionPersistence.create(next.header,{inheritedEventCount:next.inheritedEventCount})
   try{await writer.append(next.events);await writer.flush()}finally{await writer.close()}
   const reader=await ctx.sessionPersistence.open(next.header.id,'read')
   try{const stored=await reader.read();const restored=Session.fromRestore(reader.id,stored.events,reader.header,reader.inheritedEventCount,'detached');if(stored.events.length!==next.events.length||!isDeepStrictEqual(transcript(restored),transcript(native)))throw new Error('原生存储往返校验失败：'+next.header.id)}finally{await reader.close()}
   sessions[next.header.id]={seqMap:next.seqMap,eventCount:next.events.length};reports.push({id:next.header.id,before:artifact.events.length,after:next.events.length})
  }
 }finally{await ctx.fiber.dispose();ctx=null;await unlink(config).catch(()=>{})}
 if(await sessionDirectoryFingerprint(active)!==before)throw new Error('原会话在升级验证期间发生变化；未覆盖原目录，可重新验证')
 const previousBytes=await files.read(path.join(root,'data','native-session-upgrade.json'))
 const receipt={id:'tavern-native-v3-'+randomUUID(),version:3,previous:previousBytes?JSON.parse(previousBytes.toString()):undefined,sessions}
 const promotion=await promoteNativeSessionDirectory({root,staging,receipt,checkpoint})
 return {upgraded:legacy.length,backup:promotion.backup,reports}
 } finally {
  try { if(ctx)await ctx.fiber.dispose() }
  finally {
   await unlink(config).catch(error=>{if(error.code!=='ENOENT')throw error})
   // Only this invocation's staging is disposable. Published/recovery transactions own theirs.
   const transaction=await files.read(path.join(root,'native-session-upgrade-transaction.json'))
   const owner=transaction?JSON.parse(transaction.toString()):null
   if(!owner||owner.staging!==staging)await rm(staging,{recursive:true,force:true})
   await files.remove(ownerFile)
  }
 }
}
