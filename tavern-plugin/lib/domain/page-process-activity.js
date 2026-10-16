import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {mkdir,readdir,readFile,open,rm,rename} from 'node:fs/promises'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {safePagePath,ensurePageDirectory} from './page-path-safety.js'
const profiles=new Map(),locks=createDurableFilePromotion({writeLockStaleMs:Number.MAX_SAFE_INTEGER})
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){return error.code!=='ESRCH'}}
/** A process stays registered for its lifetime. PID reuse conservatively retains.
 * First-use registration and GC share one short registration/exclusive GC lock;
 * normal operations after registration do not acquire a filesystem lock. */
export function pageProcessActivity(root){
 root=path.resolve(root);const key=process.platform==='win32'?root.toLowerCase():root
 if(profiles.has(key))return profiles.get(key)
 const dir=path.join(root,'.processes'),target=path.join(root,'.activity'),own=path.join(dir,process.pid+'.json');let registered
 async function register(){
  if(!registered)registered=(async()=>{await safePagePath(path.dirname(root),path.dirname(root),{directory:true});await mkdir(root,{recursive:true});await safePagePath(root,root,{directory:true});return locks.withLock(target,async()=>{
   await ensurePageDirectory(root,dir);await safePagePath(root,dir,{directory:true})
   await safePagePath(root,own,{missing:true})
   const staging=own+'.registration-'+randomUUID(),handle=await open(staging,'wx')
   try{await handle.writeFile(JSON.stringify({kind:'page-process-v1',pid:process.pid})+'\n');await handle.sync()}finally{await handle.close()}
   await rename(staging,own)

  },{waitMs:30000})})().catch(error=>{registered=null;throw error})
  return registered
 }
 async function exclusive(operation){
  await register()
  try{return await locks.withLock(target,async()=>{
   await safePagePath(root,dir,{directory:true})
   for(const name of await readdir(dir)){
    const file=path.join(dir,name);await safePagePath(root,file)
    const match=name.match(/^([1-9][0-9]*)\.json(?:\.registration-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})?$/),pid=Number(match?.[1])
    if(!match||!Number.isSafeInteger(pid)||pid<=0)return {status:'busy',reason:'unknown-profile-process',files:[],bytes:0}
    // A canonical PID name is enough to prove an interrupted registration
    // belongs to a dead process, even when its JSON never became complete.
    // Permission/unknown liveness errors always keep it protected.
    if(!alive(pid)){await rm(file);continue}
    if(name!==pid+'.json'){if(pid===process.pid){await rm(file);continue}return {status:'busy',reason:'other-profile-process',files:[],bytes:0}}
    let entry;try{entry=JSON.parse(await readFile(file,'utf8'))}catch{return {status:'busy',reason:'unknown-profile-process',files:[],bytes:0}}
    if(entry.kind!=='page-process-v1'||entry.pid!==pid)return {status:'busy',reason:'unknown-profile-process',files:[],bytes:0}
    if(pid!==process.pid)return {status:'busy',reason:'other-profile-process',files:[],bytes:0}
   }
   return operation()
  })}catch(error){if(error.code==='DSH_TAVERN_WRITE_CONFLICT')return {status:'busy',reason:'profile-activity-lock',files:[],bytes:0};throw error}
 }
 const api={register,exclusive};profiles.set(key,api);return api
}
