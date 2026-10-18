function installTavernScriptStorage(options) {
  const { window: win, context, currentScript, call } = options;
  const values = structuredClone(context().scriptStorage || {}), queues = new Map();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const report = () => options.post?.({ type: 'dsh-tavern-script-storage-state', pending: [...queues.values()].filter(q => q.operations.length || q.task).length, failed: [...queues.values()].filter(q => q.error).length });
  function bucket(fixedOwner) { const owner = fixedOwner || currentScript().id; if (!own(values, owner)) Object.defineProperty(values, owner, { value: Object.create(null), enumerable: true }); return { owner, data: values[owner] }; }
  function queue(owner) { if (!queues.has(owner)) queues.set(owner, { owner, operations: [], task: null, timer: null, error: null, attempts: 0 }); return queues.get(owner); }
  function retryable(error){return !/生命周期|停用|授权|权限|身份|超过|容量|无效|冲突|绑定/.test(String(error?.message||error)) && !(Number(error?.status)>=400&&Number(error.status)<500&&![408,429].includes(Number(error.status)));}
  function retryLater(q){
    if(q.timer||q.task||!q.operations.length||!q.error||!retryable(q.error)||q.attempts>=3)return;
    q.timer=win.setTimeout(()=>{q.timer=null;void flush(q.owner,'automatic').catch(error=>win.console.error('脚本本机设置自动保存失败',error));},q.attempts>1?1000:250);
    q.timer?.unref?.();
  }
  function compact(operations) {
    const result = [];
    for (const op of operations) {
      if (op.kind === 'clear') result.length = 0;
      else { const index = result.findIndex(x => x.kind !== 'clear' && x.key === op.key); if (index >= 0) result.splice(index, 1); }
      result.push(op);
    }
    return result;
  }
  async function flush(owner, retry = false) {
    const q = queue(owner); if (q.timer) { win.clearTimeout(q.timer); q.timer = null; }
    if (q.task) await q.task;
    if (q.error && !retry) throw q.error;
    if(retry===true)q.attempts=0;
    q.error = null;
    while (q.operations.length) {
      const batch = q.operations.splice(0), identity = { scriptId: owner, lifecycleRevision: q.lifecycleRevision };
      const task = Promise.resolve().then(() => call('tavernScriptStorage', { operation: { kind: 'batch', operations: batch } }, identity));
      q.task = task; report();
      try { await task; q.attempts=0; }
      catch (error) { q.operations = compact([...batch, ...q.operations]); q.error = error; q.attempts++; throw error; }
      finally { q.task = null; retryLater(q); report(); }
    }
    report();
  }
  const protectedKey=(owner,key)=>owner==='extension-sp-database'&&String(key)==='__dsh_internal_sp129_vector_flush_v1';
  function change(kind, key, value, fixedOwner) {
    key = String(key); value = String(value);
    const { owner, data } = bucket(fixedOwner), q = queue(owner), lifecycle = Number(context().lifecycleRevision || 0);
    if ((q.operations.length || q.task || q.error) && q.lifecycleRevision !== lifecycle) throw new Error('脚本生命周期已变化，旧设置尚未保存');
    if(kind!=='clear'&&protectedKey(owner,key))throw new Error('SP 向量任务保留键不可通过普通设置修改');
    // An existing pending or failed write retains its receipt/retry state.
    if ((kind === 'set' && own(data,key) && data[key] === value) || (kind === 'remove' && !own(data,key)) || (kind === 'clear' && Object.keys(data).length === 0)) return;
    if (kind === 'set') { if (key.length > 4096 || value.length > 8000000) throw new DOMException('脚本存储超过容量', 'QuotaExceededError'); Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true }); }
    else if (kind === 'remove') delete data[key]; else for (const key of Object.keys(data)) {if(!protectedKey(owner,key))delete data[key];}
    q.lifecycleRevision = lifecycle; q.operations = compact([...q.operations, { kind, key, value }]); report();
    if(q.error&&retryable(q.error)){if(q.attempts>=3)q.attempts=0;retryLater(q);}
    if (!q.timer && !q.task && !q.error) q.timer = win.setTimeout(() => { q.timer = null; void flush(owner).catch(error => win.console.error('脚本本机设置保存失败', error)); }, 50);
  }
  function storageFor(owner) {
    const storage = {
      getItem(key) { const { data } = bucket(owner); return !protectedKey(owner,key)&&own(data, String(key)) ? data[String(key)] : null; },
      setItem(key,value) { change('set',key,value,owner); }, removeItem(key) { change('remove',key,undefined,owner); }, clear() { change('clear',undefined,undefined,owner); },
      key(index) { return Object.keys(bucket(owner).data).filter(key=>!protectedKey(owner,key))[Number(index)] ?? null; }
    };
    if(owner==='extension-sp-database'){
      const request=operation=>call('tavernScriptStorage',{operation:{...operation,kind:'sp-vector-flush'}},{scriptId:owner,lifecycleRevision:Number(context().lifecycleRevision||0)});
      storage.__dshSpVectorFlushSnapshot=()=>request({action:'read'});
      storage.__dshSpVectorFlushUpdate=operation=>request(operation);
    }
    Object.defineProperty(storage,'length',{get:()=>Object.keys(bucket(owner).data).filter(key=>!protectedKey(owner,key)).length,configurable:true});
    return new Proxy(storage,{get(target,key){return key in target || typeof key==='symbol' ? target[key] : target.getItem(key) ?? undefined},set(target,key,value){target.setItem(key,value);return true},deleteProperty(target,key){target.removeItem(key);return true},ownKeys(){return Object.keys(bucket(owner).data).filter(key=>!protectedKey(owner,key))},getOwnPropertyDescriptor(target,key){return !protectedKey(owner,key)&&own(bucket(owner).data,key)?{value:target.getItem(key),enumerable:true,configurable:true,writable:true}:Reflect.getOwnPropertyDescriptor(target,key)}});
  }
  const owned = new Map();
  win.__dshTavernStorageFor = owner => { owner=String(owner); if(!owner)throw new Error('脚本存储缺少身份'); if(!owned.has(owner))owned.set(owner,storageFor(owner));return owned.get(owner); };
  Object.defineProperty(win, 'localStorage', { value: storageFor(), configurable: true });
  win.__dshTavernFlushScriptStorage = async (retry = false) => { await Promise.all([...queues.keys()].map(owner => flush(owner,retry))); };
  if (options.token) win.addEventListener('message', event => { if(event.source === win.parent && event.data?.token === options.token && event.data.type === 'dsh-tavern-retry-script-storage') void win.__dshTavernFlushScriptStorage(true).catch(error => win.console.error('设置重试失败',error)); });
  return { flush,isPersisted:()=>[...queues.values()].every(q=>!q.operations.length&&!q.task&&!q.timer&&!q.error) };
}

function installTavernMessageStorage(token,context,install) {
  let next=0;const pending=new Map();
  function call(method,args){return new Promise((resolve,reject)=>{const requestId='storage:'+ ++next;pending.set(requestId,{resolve,reject});parent.postMessage({type:'dsh-tavern-helper-call',token,requestId,method,args},'*');});}
  addEventListener('message',event=>{const data=event.data;if(event.source!==parent||data?.token!==token||data.type!=='dsh-tavern-helper-response')return;const request=pending.get(data.requestId);if(!request)return;pending.delete(data.requestId);data.ok?request.resolve(data.result):request.reject(Error(data.error));});
  install({window,context:()=>context,currentScript:()=>({id:'__dsh_message__'}),call,token,post:state=>{
    if(state.pending||state.failed)parent.postMessage({type:'dsh-tavern-frame-stateful',token},'*');
    if(state.failed)parent.postMessage({type:'dsh-tavern-helper-error',token,name:'卡片设置',message:'本机设置尚未保存，请保留页面并重试'},'*');
  }});
}
