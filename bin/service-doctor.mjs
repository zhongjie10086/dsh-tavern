import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createDurableFilePromotion} from '../tavern-plugin/lib/durable-file-promotion.js'
import {promoteNativeSessionDirectory} from './native-session-promotion.mjs'
import {migrateSessionPrefixEvents} from './session-prefix-migration.mjs'
import {processOwnerIsLive} from '../tavern-plugin/lib/process-identity.js'
import {isPortOpen,webUrlFromLogChunk} from './service-lifecycle.mjs'
import {DSH_ROOT,LOG_DIR,PID_FILE,SERVICE_FILE,LOG_FILE,CLI_PORT,PROFILE} from './launcher-environment.mjs'

async function optional(file) { try { return await readFile(file) } catch(error) { if(error.code==='ENOENT')return undefined;throw error } }
const portValid=port=>Number.isInteger(port)&&port>0&&port<=65535

// The same host token exchange used by the browser. Never follow redirects to
// another origin, print the token, or send it to a port supplied by the peer.
export async function requestTavernDoctor({port,record,log,repair=false}) {
 const origin='http://127.0.0.1:'+port
 const offset=Number.isSafeInteger(record.logOffset)&&record.logOffset>=0?record.logOffset:0
 const candidate=webUrlFromLogChunk(Buffer.from(log).subarray(offset).toString('utf8'))
 let url;try{url=new URL(candidate)}catch{throw Error('没有当前服务的访问凭据，请在服务就绪后重试。')}
 if(url.origin!==origin||url.username||url.password||url.pathname!=='/')throw Error('当前服务访问地址与已记录端口不符')
 const auth=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(3000)})
 await auth.body?.cancel()
 const cookie=auth.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
 if(auth.status!==303||!cookie)throw Error('宿主身份验证失败，请重新打开当前服务的访问链接。')
 const response=await fetch(origin+'/api/dsh-tavern/doctorTavern',{method:'POST',redirect:'error',headers:{'content-type':'application/json',cookie},body:JSON.stringify({repair}),signal:AbortSignal.timeout(60000)})
 if(!response.ok){await response.body?.cancel();throw Error('状态检查失败：HTTP '+response.status)}
 let size=0;const chunks=[]
 for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('诊断结果超过 4 MiB，请在界面分局检查');chunks.push(chunk)}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 if(result.error)throw Error(result.error)
 return result
}

export async function doctorService({repair=false}={}) {
 const locks=createDurableFilePromotion(),files=createDurableFilePromotion({mode:0o600})
 async function inspect() {
  const raw=await optional(PID_FILE),saved=await optional(SERVICE_FILE)
  let record,service
  try{record=raw?JSON.parse(raw):null}catch{}
  try{service=saved?JSON.parse(saved):null}catch{}
  const valid=record&&Number.isSafeInteger(record.pid)&&record.pid>0&&portValid(record.port)
  const report={version:1,repair,launcher:{status:'stopped'},runtime:{status:'offline',message:'启动服务后可检查和恢复聊天状态。'}}
  if(saved&&(!service||service.version!==1||!portValid(service.port))){report.launcher={status:'blocked',message:'服务端口记录损坏，已保留原件。'};return report}
  const ports=[...new Set([CLI_PORT,service?.port,record?.port].filter(portValid))],occupied=[]
  for(const port of ports)if(await isPortOpen(port))occupied.push(port)
  const alive=valid&&processOwnerIsLive({pid:record.pid,birth:record.processBirth,createdAt:Date.parse(record.startedAt)})
  if(alive){
   report.launcher={status:'running',pid:record.pid,port:record.port}
   try{report.runtime=await requestTavernDoctor({port:record.port,record,log:await optional(LOG_FILE)||'',repair})}
   catch(error){report.runtime={status:'blocked',message:error.message}}
   return report
  }
  if(occupied.length){report.launcher={status:'blocked',message:'已记录端口存在未识别进程，未进行修复。',ports:occupied};return report}
  if(raw){
   report.launcher={status:valid?'stale-pid':'invalid-pid'}
   if(repair){
    const backup=path.join(LOG_DIR,'recovery','pid-'+createHash('sha256').update(raw).digest('hex')+'.json')
    await files.write(backup,raw)
    if(!(await readFile(backup)).equals(raw))throw Error('进程记录备份校验失败')
    const current=await optional(PID_FILE)
    if(!current?.equals(raw))throw Error('进程记录已变化，停止修复')
    await files.remove(PID_FILE)
    report.launcher={status:'recovered',backup}
   }
  }
  const root=path.join(DSH_ROOT,'profile-data',PROFILE),tx=await optional(path.join(root,'native-session-upgrade-transaction.json'))
  if(tx){
   try{
    const value=JSON.parse(tx);report.upgrade={status:['complete','abandoned'].includes(value.phase)?'healthy':'pending',phase:value.phase}
    if(repair&&report.upgrade.status==='pending')report.upgrade={status:'recovered',...await promoteNativeSessionDirectory({root})}
   }catch(error){report.upgrade={status:'blocked',message:error.message}}
  }
  if(report.upgrade?.status !== 'blocked') {
   const errors=[],options={sessionsRoot:path.join(root,'sessions'),backupRoot:path.join(DSH_ROOT,'backups/tavern-stable-prefix-v1'),quarantineRoot:path.join(DSH_ROOT,'recovery/session-prefix'),logger:null,onError:value=>errors.push(value)}
   try {
    const planned=await migrateSessionPrefixEvents({...options,dryRun:true})
    if(repair && planned.length) await migrateSessionPrefixEvents(options)
    const remaining=repair && planned.length?await migrateSessionPrefixEvents({...options,dryRun:true}):planned
    report.sessions={status:errors.length?'blocked':remaining.length?'repairable':planned.length?'recovered':'healthy',planned,remaining,errors}
   } catch(error) { report.sessions={status:'blocked',message:error.message} }
  }
  return report
 }
 // Dry-run does not create directories, lock files, or repair promotion remnants.
 return repair?locks.withLock(path.join(LOG_DIR,'tavern.start'),inspect,{waitMs:35000}):inspect()
}
