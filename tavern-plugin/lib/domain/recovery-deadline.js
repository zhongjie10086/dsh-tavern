import {AsyncLocalStorage} from 'node:async_hooks'

// Deadlines stop publication, not just waiting. An uncooperative I/O operation
// remains quarantined until it settles, so another attempt cannot race it.
export function createRecoveryDeadline(input) {
  const context=new AsyncLocalStorage(),attempts=new Map()
  const timeoutMs=Math.max(1,Number(input.timeoutMs)||15000)
  const current=()=>context.getStore()
  const check=()=>current()?.controller.signal.throwIfAborted()
  const signal=()=>current()?.controller.signal
  async function call(fn,args){check();const value=await fn(...args);check();return value}
  const mutation=fn=>{const expected=signal();return async value=>{expected?.throwIfAborted();const result=await fn(value);expected?.throwIfAborted();return result}}
  const options={...input}
  options.read=async(...args)=>{
    check();const value=await input.read(...args),attempt=current()
    if(value?.sessionId&&attempt)attempt.sessionId=value.sessionId
    check();return value
  }
  for(const key of ['readRevision','readScript','onBackupCompleted'])if(input[key])options[key]=(...args)=>call(input[key],args)
  for(const key of ['facts','prepare'])if(input[key])options[key]=(value,details={})=>call(input[key],[value,{...details,signal:signal()}])
  if(input.recoverHistory)options.recoverHistory=(sessionId,chatId)=>call(input.recoverHistory,[sessionId,chatId,{signal:signal()}])
  if(input.sidecars)options.sidecars=(chat,details)=>call(input.sidecars,[chat,{...details,signal:signal()}])
  if(input.update)options.update=(id,fn,metadata={})=>call(input.update,[id,mutation(fn),{...metadata,signal:signal()}])
  if(input.store)options.store={...input.store,
    readJson:(...args)=>call(input.store.readJson,args),
    writeJson:(...args)=>call(input.store.writeJson,args),
    updateJson:(path,fn)=>call(input.store.updateJson,[path,mutation(fn)])}

  function run(row,operation,{exclusive=false}={}) {
    const previous=attempts.get(row.id)
    if(previous&&exclusive)throw new Error('此对话正在检查或恢复，请完成后重新核对。')
    if(previous)return previous.result
    const attempt={chatId:row.id,sessionId:row.sessionId,controller:new AbortController()}
    attempts.set(row.id,attempt)
    let timer
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
      const error=new Error('此对话恢复超过 '+timeoutMs+' ms，已停止后续写入；可稍后重新检查。其他对话可继续使用。')
      error.code='DSH_TAVERN_RECOVERY_TIMEOUT';attempt.controller.abort(error);reject(error)
    },timeoutMs)})
    const task=context.run(attempt,()=>Promise.resolve().then(operation))
    task.finally(()=>{clearTimeout(timer);if(attempts.get(row.id)===attempt)attempts.delete(row.id)}).catch(()=>{})
    attempt.result=Promise.race([task,expired])
    return attempt.result
  }
  async function waitSession(sessionId) {
    const own=[...attempts.values()].filter(row=>row.sessionId===sessionId)
    await Promise.all(own.map(row=>row.result.catch(()=>{})))
    const unfinished=[...attempts.values()].find(row=>row.sessionId===sessionId&&row.controller.signal.aborted)
    if(unfinished)throw new Error('此对话的恢复已超时，底层操作尚未退出；请稍后重试或重启服务。')
  }
  return {options,run,waitSession}
}
