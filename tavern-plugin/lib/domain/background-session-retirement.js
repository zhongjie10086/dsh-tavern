import { isDeepStrictEqual } from 'node:util'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { appendTavernEvent, decodeTavernEvent } from './session-message-source.js'

const path = 'background-session-retirement.json'
const plugin = 'dsh-tavern-background-retirement'
const providers = new Set(['dsh-tavern-background', ...[1,2,3,4].map(n => 'dsh-tavern-background-tools-v'+n)])
export const BACKGROUND_RETIREMENT_LIMITS = Object.freeze({ entries:1024, bytes:256*1024, positiveCache:256, negativeCache:256, concurrency:4, batch:32 })
const bytes = value => Buffer.byteLength(JSON.stringify(value,null,2)+'\n')
function failure(message, cause) { return Object.assign(new Error('后台会话退休状态：'+message,{cause}),{code:'BACKGROUND_RETIREMENT_BLOCKED'}) }
function index(value) {
  if(value===undefined)return {}
  if(!value || typeof value!=='object' || Array.isArray(value))throw failure('索引损坏，未裁剪旧记录')
  for(const [id,record] of Object.entries(value))if(!id || !record || typeof record.parentId!=='string' || !record.parentId ||
    record.retiredAt!==undefined && (!Number.isFinite(record.retiredAt) || record.retiredAt<0))throw failure('索引记录损坏，未裁剪旧记录')
  return value
}
function marker(record) {
  const {header,events,inheritedEventCount=0}=record
  let found
  for(const raw of events){
    if(raw.type!=='user/message' || raw.seq<inheritedEventCount)continue
    const event=decodeTavernEvent(raw),source=event.data.source
    if(source?.plugin!==plugin)continue
    const descriptor=foldSubagentDescriptor(events)
    if(source.kind!=='plugin' || source.plugin!==plugin || source.version!==1 || source.sessionId!==header.id ||
      typeof source.parentId!=='string' || !source.parentId || source.parentId!==header.parentSession || header.origin!=='subagent' || !providers.has(descriptor?.provider) ||
      !Number.isFinite(source.retiredAt) || source.retiredAt<0 || event.data.id!=='tavern-background-retirement:'+header.id ||
      event.data.role!=='user' || !Array.isArray(event.data.content) || event.data.content.length ||
      event.surfaceOp!=='append' || event.turn!==undefined || event.step!==undefined)throw failure('原生退休标记不匹配，未将未知身份视作可复用')
    const current={parentId:source.parentId,retiredAt:source.retiredAt}
    if(found && !isDeepStrictEqual(found,current))throw failure('原生退休标记冲突')
    found=current
  }
  return found || null
}

/** Append a known notice through the host's persistence seam, without activating an Agent. */
export function createNativeBackgroundRetirement({sessions,persistence,agents}) {
  function validated(handle,read) {
    const record={header:handle.header,events:read.events,inheritedEventCount:handle.inheritedEventCount||0}
    // Native replay validates provenance and event structure. Its seed delimiter is
    // only persisted when a new notice is appended, never during a read.
    const live=sessions.get(record.header.id)
    if(live && (!isDeepStrictEqual(live.header,record.header) || !isDeepStrictEqual(live.snapshotEvents().slice(0,record.events.length),record.events)))throw failure('原生持久记录与宿主会话不一致')
    const session=live || sessions.prepare(record.header.id,{seed:structuredClone(record.events),meta:record.header,inheritedEventCount:record.inheritedEventCount,eventState:'detached'})
    return {record,session}
  }
  async function read(id) {
    let handle,expected
    try{
      const live=sessions.get(id)
      expected=live?marker({header:live.header,events:live.snapshotEvents(),inheritedEventCount:live.inheritedEventCount}):null
      if(expected && !await sessions.flush(live))throw failure('运行会话的退休标记尚未核验持久化')
      handle=await persistence.open(id,'read')
      const found=marker(validated(handle,await handle.read()).record)
      // An attached writer exposes appended events to readers before flush. A
      // failed retirement must not evict its owner on that non-durable evidence.
      if(expected && !isDeepStrictEqual(found,expected))throw failure('运行会话的退休标记 flush 后不一致')
      if(found && live && !expected){
        if(!await sessions.flush(live))throw failure('运行会话的退休标记尚未核验持久化')
        if(!isDeepStrictEqual(marker(validated(handle,await handle.read()).record),found))throw failure('运行会话的退休标记 flush 后不一致')
      }
      return found
    }
    catch(error){if(error.name==='SessionPersistenceNotFoundError' && !expected)return null;throw error}
    finally{await handle?.close()}
  }
  async function persist(id,record,{session:supplied}={}) {
    const live=sessions.get(id)||agents?.get(id)?.session
    if(supplied && supplied!==live)throw failure('会话句柄不属于当前宿主')
    const phase=agents?.get(id)?.phase
    if(phase && phase.kind!=='idle')throw failure('会话仍在运行或维护，保留旧索引')
    let handle
    try{
      let session=live,original
      if(!session){handle=await persistence.open(id,'write');const loaded=validated(handle,await handle.read());session=loaded.session;original=loaded.record}
      const events=session.snapshotEvents(),header=session.header
      if(header.id!==id || header.origin!=='subagent' || header.parentSession!==record.parentId ||
        !providers.has(foldSubagentDescriptor(events)?.provider))throw failure('原生父身份或后台描述不匹配，保留旧索引')
      const existing=marker({header,events,inheritedEventCount:session.inheritedEventCount})
      if(existing && !isDeepStrictEqual(existing,record))throw failure('退休记录与原生标记冲突')
      const boundary=events.findLast(e=>e.type==='turn/start'||e.type==='turn/end')
      if(boundary?.type==='turn/start')throw failure('原生回合尚未结束，保留旧索引')
      if(!existing)appendTavernEvent(session,'user/message',{id:'tavern-background-retirement:'+id,role:'user',content:[],
        source:{kind:'plugin',plugin,version:1,sessionId:id,parentId:record.parentId,retiredAt:record.retiredAt}},{surfaceOp:'append'})
      if(handle){
        if(!existing)await handle.append(session.snapshotEvents().slice(original.events.length))
        await handle.flush()
        const saved=validated(handle,await handle.read()).record
        if(!isDeepStrictEqual(saved.header,original.header) || !isDeepStrictEqual(saved.events.slice(0,original.events.length),original.events) ||
          !isDeepStrictEqual(marker(saved),record))throw failure('原生日志 flush 后回读不一致')
      }else{
        if(!await sessions.flush(session))throw failure('宿主没有持久化会话的 flush 监听器')
        if(!isDeepStrictEqual(await read(id),record))throw failure('原生退休标记未持久化')
      }
      return record
    }finally{await handle?.close()}
  }
  // Only cold, unchanged persisted logs justify a negative cache entry. Live
  // events can precede persistence and must always be replayed by read().
  async function revision(id) {
    if(sessions.get(id) || agents?.get(id)?.session || typeof persistence.stat!=='function')return undefined
    const revision=(await persistence.stat(id))?.revision
    return sessions.get(id) || agents?.get(id)?.session ? undefined : revision
  }
  return {read,persist,revision}
}

/** Native Session logs remain readable; only retired Tavern workers lose discovery/reuse. */
export function createBackgroundSessionRetirement(store, { readState, isRunning, native, limits=BACKGROUND_RETIREMENT_LIMITS, report=console.warn } = {}) {
  const positive=new Map(),negative=new Map(),pending=new Map(),waiters=[]
  let active=0,tail=Promise.resolve(),scheduled,retryTimer,retryAt=Infinity,startup,closed=false,blocked=null,generation=0
  const overflow=value=>Object.keys(value).length>limits.entries || bytes(value)>limits.bytes
  async function records() { return index(await store.readJson(path)) }
  function remember(id,record){negative.delete(id);positive.delete(id);positive.set(id,record);while(positive.size>limits.positiveCache || positive.size && bytes(Object.fromEntries(positive))>limits.bytes)positive.delete(positive.keys().next().value)}
  async function slot(run){if(active>=limits.concurrency)await new Promise(resolve=>waiters.push(resolve));else active++;try{return await run()}finally{const next=waiters.shift();if(next)next();else active--}}
  function lookup(id){
    if(positive.has(id)){const record=positive.get(id);remember(id,record);return Promise.resolve(record)}
    if(!native)return Promise.resolve(null)
    if(pending.has(id))return pending.get(id)
    const epoch=generation
    const result=slot(async()=>{
      const revision=await native.revision?.(id)
      if(revision!==undefined && negative.get(id)===revision){negative.delete(id);negative.set(id,revision);return null}
      negative.delete(id)
      const record=await native.read(id)
      if(record)remember(id,record)
      else if(revision!==undefined && epoch===generation && revision===await native.revision(id)){
        negative.set(id,revision)
        while(negative.size>(limits.negativeCache??limits.positiveCache) || negative.size && bytes(Object.fromEntries(negative))>limits.bytes)negative.delete(negative.keys().next().value)
      }
      return record
    }).finally(()=>pending.delete(id))
    pending.set(id,result);return result
  }
  function serialize(run){const next=tail.catch(()=>{}).then(run);tail=next;return next}
  function diagnostic(error){return {code:String(error.code||'BACKGROUND_RETIREMENT_BLOCKED').slice(0,80),message:String(error.message||error).slice(0,240)}}
  function note(error,id){
    blocked={...diagnostic(error),...(id?{sessionId:id}:{})}
    try{report?.('dsh-tavern: 退休索引维护失败，已有退休权威保留',error)}catch{}
  }
  function quarantine(old,error){
    const attempts=Math.min(16,(Number.isSafeInteger(old.maintenance?.attempts)?old.maintenance.attempts:0)+1)
    return {...old,maintenance:{...diagnostic(error),attempts,retryAt:Date.now()+Math.min(30*60000,30000*2**(attempts-1))}}
  }
  const eligible=(record,retry)=>retry || !Number.isFinite(record.maintenance?.retryAt) || record.maintenance.retryAt<=Date.now()
  const due=value=>Object.values(value).some(record=>record.maintenance && eligible(record,false))
  // A quarantined intent is retried automatically once its own backoff is due,
  // below the cap too; nothing has to call maintain() for it to drain.
  function armRetry(value){
    if(closed)return
    let next=Infinity
    for(const record of Object.values(value))if(record?.maintenance && Number.isFinite(record.maintenance.retryAt))next=Math.min(next,record.maintenance.retryAt)
    if(!Number.isFinite(next) || retryTimer && retryAt<=next)return
    clearTimeout(retryTimer);retryAt=next
    retryTimer=setTimeout(()=>{retryTimer=undefined;retryAt=Infinity;schedule()},Math.max(0,next-Date.now()));retryTimer.unref?.()
  }
  async function compactBatch({retry=false,reserve=false}={}){
    const before=await records(),pressure=reserve||overflow(before)
    // Explicit maintenance can retry retained failures before their backoff.
    // Automatic work retries one only when due, so it never spins on poison.
    if(!pressure && !due(before) && !(retry && Object.values(before).some(record=>record.maintenance))){armRetry(before);return false}
    if(!native)throw failure('原生持久化不可用，索引暂时超限且未裁剪')
    const candidates=Object.entries(before).filter(([,record])=>eligible(record,retry) && (pressure||record.maintenance))
      .sort((a,b)=>Number(!eligible(a[1],false))-Number(!eligible(b[1],false))
        || (a[1].maintenance?.retryAt||0)-(b[1].maintenance?.retryAt||0)
        || (a[1].retiredAt||0)-(b[1].retiredAt||0)).slice(0,limits.batch)
    if(!candidates.length)return false
    const results=await Promise.allSettled(candidates.map(([id,old])=>slot(async()=>{
      if(isRunning?.(id))throw failure('会话仍在使用，索引暂时超限')
      const existing=old.retiredAt===undefined?await native.read(id):null
      if(existing && existing.parentId!==old.parentId)throw failure('退休父身份与原生标记冲突')
      const record={parentId:old.parentId,retiredAt:old.retiredAt??existing?.retiredAt??0}
      await native.persist(id,record);remember(id,record)
    })))
    // A failing candidate retains its own authority, not every healthy key in
    // the batch. Metadata stays in the existing index, never a second ledger.
    await store.updateJson(path,old=>{
      const current=index(old),next={...current}
      for(let i=0;i<candidates.length;i++){
        const [id,record]=candidates[i],result=results[i]
        if(!isDeepStrictEqual(current[id],record))continue
        if(result.status==='fulfilled')delete next[id]
        else next[id]=quarantine(record,result.reason)
      }
      return next
    })
    for(let i=0;i<results.length;i++)if(results[i].status==='rejected')note(results[i].reason,candidates[i][0])
    const after=await records()
    if(!Object.values(after).some(record=>record.maintenance))blocked=null
    armRetry(after)
    return overflow(after) && Object.values(after).some(record=>eligible(record,false))
  }
  function schedule(){
    if(closed || scheduled)return
    scheduled=setTimeout(()=>{scheduled=undefined;serialize(compactBatch).then(more=>{if(more)schedule()}).catch(note)},0);scheduled.unref?.()
  }
  const api={
    async isRetired(id) { const value=await records();if(overflow(value))schedule();armRetry(value);return Object.hasOwn(value,id) || Boolean(await lookup(id)) },
    async retire(id, parentId, supplied) {
      if (!id || !parentId) throw new Error('后台会话退休缺少会话编号')
      generation++;negative.delete(id)
      return serialize(async()=>{
        const before=await records(),existing=(Object.hasOwn(before,id)?before[id]:null) || await lookup(id)
        if(existing && existing.parentId!==parentId)throw failure('退休父身份不匹配')
        const known=existing?.retiredAt===undefined?await lookup(id):null
        if(known && known.parentId!==parentId)throw failure('退休父身份与原生标记冲突')
        const record=existing?{parentId:existing.parentId,retiredAt:existing.retiredAt??known?.retiredAt??0}:{parentId,retiredAt:Date.now()}
        let nativeError=!native?failure('原生持久化不可用'):null
        if(native){try{await native.persist(id,record,supplied);remember(id,record)}catch(error){nativeError=error}}
        // The index is also replayable intent while a canceled worker is not
        // idle. Capacity must never drop that identity on the floor. Any soft
        // overflow is explicit and shrinks only after verified native flush.
        const saved=nativeError && native?quarantine(record,nativeError):record
        try{await store.updateJson(path,old=>{
          const current=index(old)
          if(Object.hasOwn(current,id) && current[id].parentId!==parentId)throw failure('退休父身份不匹配')
          const next={...current,[id]:saved}
          // Verified native truth needs no extra hot entry when poison already
          // fills the index. Pending intents, however, may never be dropped.
          if(!nativeError && overflow(next))delete next[id]
          return next
        })}catch(error){note(error,id);throw error}
        if(nativeError){
          note(nativeError,id);armRetry({[id]:saved})
          if(overflow({...before,[id]:saved}))schedule()
          // Cancellation must not wait for unrelated cold-log maintenance. The
          // durable intent above already prevents reuse after an immediate exit.
          if(native)throw nativeError
        }
        if(!nativeError && overflow({...before,[id]:saved})){
          try{if(await compactBatch({reserve:true}))schedule()}catch(error){note(error)}
        }
        // Unrelated index maintenance must not turn durable success into failure.
      })
    },
    async status(){
      const value=await records(),quarantined=Object.entries(value).filter(([,record])=>record.maintenance)
      const first=quarantined[0]
      return {count:Object.keys(value).length,bytes:bytes(value),limits,overLimit:overflow(value),
        blocked:blocked || (first?{sessionId:first[0],...first[1].maintenance}:null),quarantined:quarantined.length,
        positiveCache:positive.size,negativeCache:negative.size}
    },
    async maintain(){return serialize(()=>compactBatch({retry:true})).catch(error=>{note(error);throw error})},
    async dispose(){closed=true;clearTimeout(scheduled);clearTimeout(retryTimer);clearTimeout(startup);await tail.catch(()=>{});await Promise.allSettled(pending.values())},
    async filter(rows, parentId) {
      const retired = await records(),uncertainParents=new Set()
      armRetry(retired)
      // Older releases did not record retirement. Fold only explicitly terminal,
      // superseded identities from Tavern's authority; never infer from the label alone.
      if (readState) {
        const parents = new Set(rows.filter(row => row.kind === 'child').map(row => row.parentId || parentId).filter(Boolean))
        for (const owner of parents) {
          let chat
          try{chat=await readState(owner)}catch(error){uncertainParents.add(owner);note(error,owner);continue}
          const current = chat?.timeline?.participants?.background?.sessionId
          if (!current) continue
          const operations = Object.values(chat.timeline.operations || {})
          const running = new Set(operations.filter(op => op.status === 'running').map(op => op.startedSessionId))
          for (const op of operations) {
            if (op.kind === 'agent' && ['failed', 'interrupted'].includes(op.status)
              && op.startedSessionId && op.startedSessionId !== current && !running.has(op.startedSessionId)) {
              Object.defineProperty(retired, op.startedSessionId, { value: {parentId: owner}, enumerable: true, configurable: true })
            }
          }
        }
      }
      if(overflow(retired))schedule()
      const visible=await Promise.all(rows.map(async row => {
        if(row.kind!=='child' || row.activity==='running' || isRunning?.(row.id)===true || row.hasChildren===true)return row
        const owner=row.parentId || parentId
        try {
          const record = (Object.hasOwn(retired,row.id)?retired[row.id]:null) || await lookup(row.id)
          // Never hide unrelated children, still-running consumers or a subtree.
          if(record && record.parentId === owner)return null
          // An unreadable owner may hold legacy superseded-retirement truth that
          // cannot be evaluated: keep the child listed, marked as uncertain, rather
          // than dropping it silently. Reuse is still decided by isRetired.
          return uncertainParents.has(owner) ? {...row,tavernRetirement:{status:'parent-unreadable',message:'父会话不可读，退休状态未确认'}} : row
        } catch(error) {
          // Uncertain is not confirmed active: quarantine just this row and
          // preserve all other list results. Reuse still throws from isRetired.
          note(error,row.id);return null
        }
      }))
      return visible.filter(Boolean)
    }
  }
  // Quarantined intents persisted before a restart are retried on their own
  // backoff even if no listing or reuse check happens to read the index first.
  startup=setTimeout(()=>{startup=undefined;records().then(armRetry,()=>{})},0);startup.unref?.()
  return api
}

/** Read-only discovery filter; native notice persistence is owned by the adapter above. */
export function installRetiredBackgroundFilter(subagents, retirement, sessionQuery) {
  const restore = []
  for (const method of ['listChildren', 'listDescendants']) {
    const original = subagents?.[method]
    if (typeof original !== 'function') continue
    const wrapped = async function (parentId, signal) {
      const rows = await original.call(this, parentId, signal)
      const result = await retirement.filter(rows, parentId)
      signal?.throwIfAborted()
      return result
    }
    subagents[method] = wrapped
    restore.push(() => { if (subagents[method] === wrapped) subagents[method] = original })
  }
  // The native header counts global Session summaries independently of the
  // child catalog. Apply the same visibility rule at its public read boundary.
  const original = sessionQuery?.listSessions
  if (typeof original === 'function') {
    const wrapped = async function (signal) {
      const records = await original.call(this, signal)
      const parents = new Set(records.map(row => row.header.parentSession).filter(Boolean))
      const rows = records.map(record => ({
        id: record.header.id,
        kind: record.header.origin === 'subagent' ? 'child' : 'session',
        parentId: record.header.parentSession,
        hasChildren: parents.has(record.header.id),
      }))
      const visible = new Map((await retirement.filter(rows)).map(row => [row.id, row]))
      signal?.throwIfAborted()
      return records.filter(record => visible.has(record.header.id)).map(record => {
        // Keep query fields/order intact, including the uncertainty notice from
        // the same filter used by child catalogs. Never mutate native headers.
        const tavernRetirement = visible.get(record.header.id).tavernRetirement
        return tavernRetirement ? { ...record, tavernRetirement } : record
      })
    }
    sessionQuery.listSessions = wrapped
    restore.push(() => { if (sessionQuery.listSessions === wrapped) sessionQuery.listSessions = original })
  }
  return () => { for (const undo of restore) undo() }
}
