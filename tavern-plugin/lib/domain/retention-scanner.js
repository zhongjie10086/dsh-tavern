import {Worker} from 'node:worker_threads'
/** Read-only scans run off the request event loop. Deletion always remains on
 * the main thread behind the generation check and short maintenance lease. */
export function createRetentionScanner(){
 let worker,sequence=0,closed=false;const pending=new Map()
 function rejectAll(error){for(const job of pending.values())job.reject(error);pending.clear()}
 function start(){
  if(closed)throw Error('维护扫描器已关闭')
  if(worker)return worker
  const current=new Worker(new URL('../workers/retention-scan.js',import.meta.url));worker=current
  current.on('message',({id,value,error})=>{const job=pending.get(id);if(!job)return;pending.delete(id);if(!pending.size)current.unref();error?job.reject(Object.assign(new Error(error.message),error)):job.resolve(value)})
  current.on('error',error=>rejectAll(error));current.on('exit',code=>{if(worker===current)worker=null;rejectAll(new Error('维护扫描线程已退出：'+code))})
  current.unref();return current
 }
 function scan(kind,dataRoot,options){return new Promise((resolve,reject)=>{try{const instance=start(),id=++sequence;pending.set(id,{resolve,reject});instance.ref();instance.postMessage({id,kind,dataRoot,options})}catch(error){reject(error)}})}
 return {references:(root,options)=>scan('references',root,{...options,exclude:[...options.exclude||[]]}),snapshots:(root,options)=>scan('snapshots',root,options),dispose:async()=>{closed=true;rejectAll(new Error('维护扫描已取消'));await worker?.terminate();worker=null}}
}
