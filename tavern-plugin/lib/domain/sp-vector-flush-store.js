// Finite durable operations for SP 1.2.9's original vector flush-task store.
// The caller executes these under the existing profile JSON update lock.
const keyPart=value=>String(value||'').trim();
const isolation=value=>String(value??'').trim()||'default';
const status=value=>['queued','flushing','ready','failed_retryable','failed_terminal','invalidated','blocked_needs_rebuild'].includes(value)?value:'dirty';
const mode=value=>value==='append'?'append':'sync';
const numericFields=['generation','requestedAt','debounceUntil','attemptCount','updatedAt','targetMessageIndex','lastAttemptAt','lastSuccessAt'];
function finiteTask(value){for(const field of numericFields)if(Object.hasOwn(value,field)&&!Number.isFinite(value[field]))throw Error('SP 向量任务数值必须有限：'+field);return value}
export function cloneSpVectorFlushTask(t){
 return finiteTask({scopeKey:keyPart(t.scopeKey),chatKey:keyPart(t.chatKey),isolationKey:keyPart(t.isolationKey),sourceTableKey:keyPart(t.sourceTableKey),...Number.isFinite(Number(t.targetMessageIndex))?{targetMessageIndex:Number(t.targetMessageIndex)}:{},generation:Math.max(0,Number(t.generation)||0),mode:mode(t.mode),status:status(t.status),requestedAt:Math.max(0,Number(t.requestedAt)||0),debounceUntil:Math.max(0,Number(t.debounceUntil)||0),attemptCount:Math.max(0,Number(t.attemptCount)||0),...Number.isFinite(Number(t.lastAttemptAt))?{lastAttemptAt:Number(t.lastAttemptAt)}:{},...Number.isFinite(Number(t.lastSuccessAt))?{lastSuccessAt:Number(t.lastSuccessAt)}:{},...t.lastError?{lastError:String(t.lastError)}:{},updatedAt:Math.max(0,Number(t.updatedAt)||0)});
}
export function applySpVectorFlushTask(current,operation,now){
 if(!Number.isFinite(now))throw Error('SP 向量任务时间必须有限');
 if(operation.action==='delete')return{write:current!==null,value:null,result:null};
 const old=current===null?null:cloneSpVectorFlushTask(current),t=operation.task;

 if(operation.action==='mark-ready'){
  const generation=Math.max(0,Number(operation.generation)||0);if(!Number.isFinite(generation))throw Error('SP 向量任务数值必须有限：generation');const matches=!!old&&old.generation===generation&&old.status==='flushing';
  return matches?{write:true,value:finiteTask({...old,status:'ready',lastSuccessAt:now,updatedAt:now}),result:true}:{write:false,result:false};
 }
 if(!t||typeof t!=='object'||Array.isArray(t))throw Error('SP 向量任务内容无效');
 const scopeKey=keyPart(t.scopeKey),chatKey=keyPart(t.chatKey),isolationKey=isolation(t.isolationKey),sourceTableKey=keyPart(t.sourceTableKey);
 if(!scopeKey||!chatKey)throw Error('SP 向量任务 scope 不完整');
 if(operation.action==='invalidate'){
  if(!sourceTableKey)throw Error('持久化交火向量 flush 失效墓碑失败：scope 不完整');
  const value={scopeKey,chatKey,isolationKey,sourceTableKey,...old?.targetMessageIndex!=null?{targetMessageIndex:old.targetMessageIndex}:{},generation:(old?.generation||0)+1,mode:old?.mode||'sync',status:'invalidated',requestedAt:old?.requestedAt||now,debounceUntil:old?.debounceUntil||now,attemptCount:old?.attemptCount||0,...old?.lastAttemptAt?{lastAttemptAt:old.lastAttemptAt}:{},...old?.lastSuccessAt?{lastSuccessAt:old.lastSuccessAt}:{},lastError:'flush_scope_invalidated',updatedAt:now};
  return{write:true,value:finiteTask(value),result:cloneSpVectorFlushTask(value)};
 }
 if(operation.action!=='upsert')throw Error('SP 向量任务操作无效');
 const generation=Math.max(0,Number(t.generation)||0);if(old&&generation<old.generation)return{write:false,result:old};
 const nextStatus=status(t.status),value={scopeKey,chatKey,isolationKey,sourceTableKey,...Number.isFinite(Number(t.targetMessageIndex))?{targetMessageIndex:Number(t.targetMessageIndex)}:old?.targetMessageIndex!=null?{targetMessageIndex:old.targetMessageIndex}:{},generation:Math.max(old?.generation||0,generation),mode:mode(t.mode),status:nextStatus,requestedAt:Math.max(0,Number(t.requestedAt??old?.requestedAt??now)||now),debounceUntil:Math.max(0,Number(t.debounceUntil??old?.debounceUntil??now)||now),attemptCount:nextStatus==='flushing'?(old?.attemptCount||0)+1:old?.attemptCount||0,...nextStatus==='flushing'?{lastAttemptAt:now}:old?.lastAttemptAt?{lastAttemptAt:old.lastAttemptAt}:{},...nextStatus==='ready'?{lastSuccessAt:now}:old?.lastSuccessAt?{lastSuccessAt:old.lastSuccessAt}:{},...t.lastError?{lastError:String(t.lastError)}:nextStatus==='ready'?{}:old?.lastError?{lastError:old.lastError}:{},updatedAt:now};
 return{write:true,value:finiteTask(value),result:cloneSpVectorFlushTask(value)};
}
