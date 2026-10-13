import { createHash } from 'node:crypto'
import { historyRecoveryRecord } from './round-history-recovery.js'
import { locateRegenerationSurface } from './rollback-surface.js'
import {createRecoveryDeadline} from './recovery-deadline.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const running = value => value?.status === 'running'
function issuesOf(chat) {
  const issues = []
  if (chat.pendingSurfaceRollback || chat.pendingRegeneration) issues.push('history-intent')
  else if (chat.regenInProgress) issues.push('legacy-regeneration')
  if (chat.legacyRegenerationRecovery?.status === 'unknown') issues.push('legacy-regeneration-unknown')
  if (chat.legacyRegenerationRecovery?.status === 'reviewed' && chat.legacyRegenerationRecovery.retentionPending) issues.push('reviewed-backup-retention')
  if (Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && running(op))) issues.push('foreground')
  if (chat.scriptState?.prepared || chat.workspace?.prepared) issues.push('preparation')
  if (['pending','running'].includes(chat.settleStatus) || Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'agent' && running(op))) issues.push('background')
  if (running(chat.contextCompaction?.operation)) issues.push('compaction')
  if (['activity','maintenance','inspiration'].some(key => running(chat.spDatabase?.[key]))) issues.push('database')
  if (Object.values(chat.taskMailbox?.tasks || {}).some(task => ['queued','running'].includes(task.status))) issues.push('mailbox')
  return issues
}

/** A shared, fact-based path for startup, doctor and UI. Never sends model work. */
export function createRuntimeRecovery(options) {
  const deadline=createRecoveryDeadline(options)
  options=deadline.options
  const pending = new Map()
  const scans = new Set()
  const latest = new Map()
  let scanSequence = 0
  const healthFields=row=>Object.fromEntries(['chatId','status','issues','code','resourcePath','checkedAt'].filter(key=>row[key]!==undefined).map(key=>[key,structuredClone(row[key])]))
  function remember(row,sequence){
    if(sequence<(latest.get(row.chatId)?.sequence||0))return
    latest.delete(row.chatId);latest.set(row.chatId,{sequence,row:healthFields({...row,checkedAt:Date.now()})})
    while(latest.size>2048)latest.delete(latest.keys().next().value)
  }
  function status(chatId){const row=latest.get(chatId)?.row;return row&&!['healthy','recovered','busy'].includes(row.status)?structuredClone(row):null}
  async function inspect(chat) {
    const issues = issuesOf(chat)
    if (!issues.length) return { chatId: chat.id, sessionId: chat.sessionId, status: 'healthy', issues }
    if (options.isActive(chat)) return { chatId: chat.id, sessionId: chat.sessionId, status: 'busy', issues }
    if (issues.every(issue=>issue==='legacy-regeneration-unknown')) return {chatId:chat.id,sessionId:chat.sessionId,status:'unknown',issues,error:chat.legacyRegenerationRecovery.error,manualReview:{revision:chat._storageRevision}}
    if (issues.every(issue=>issue==='reviewed-backup-retention')) return {chatId:chat.id,sessionId:chat.sessionId,status:'repairable',issues,facts:{known:true,source:'manual-review-receipt'}}
    const facts = await options.facts(chat)
    return { chatId: chat.id, sessionId: chat.sessionId, status: facts.known ? 'repairable' : 'unknown', issues, facts }
  }
  async function log(entry) {
    await options.store.updateJson('recovery/history.json', current => ({ version: 1, records: [...(current?.records || []), { at: Date.now(), ...entry }].slice(-100) }))
  }
  async function backup(chat, facts, issues) {
    const path = 'recovery/chats/' + hash(chat.id) + '/' + hash(chat) + '.json'
    await options.store.writeJson(path, { version: 1, chat })
    if (hash((await options.store.readJson(path))?.chat) !== hash(chat)) throw new Error('恢复前备份回读校验失败')
    await log({ chatId: chat.id, backup: path, issues, facts: { exists: facts.exists, source: facts.source }, result: 'prepared' })
    return path
  }
  async function legacyRecord(chat, facts) {
    for (let revision = Number(chat._storageRevision) - 1, count = 0; revision > 0 && count < 64; revision--, count++) {
      const before = await options.readRevision(chat.id, revision)
      if (!before || before.id !== chat.id || before.sessionId !== chat.sessionId) break
      if (before.regenInProgress) continue
      const assistant = before.messages?.at(-1)
      if (assistant?.role !== 'assistant' || before.messages?.at(-2)?.role !== 'user') break
      const target = locateRegenerationSurface({ events: facts.events || [], nodes: facts.nodes || [], turn: assistant.turn })
      if (!target) break
      const prefix = before.messages.slice(0, -2).map(m => [m.role, m.turn, m.text])
      if (JSON.stringify(prefix) !== JSON.stringify((chat.messages || []).slice(0, prefix.length).map(m => [m.role,m.turn,m.text]))) break
      return historyRecoveryRecord(before, { kind: 'regeneration', phase: 'generating', eventStart: target.assistantSeq + 1, recoveredLegacyRevision: revision })
    }
    throw new Error('旧重生成缺少可验证的连续历史与原生正文，已保留备份，需人工核对')
  }
  async function repairOne(id) {
    let chat = await options.read(id)
    if (!chat) return { chatId: id, status: 'missing', issues: [] }
    const diagnosis = await inspect(chat)
    if (diagnosis.status !== 'repairable') return diagnosis
    if(chat.legacyRegenerationRecovery?.status==='reviewed'&&chat.legacyRegenerationRecovery.retentionPending){await finishManualReview(chat);return repairOne(id)}
    const { facts, issues } = diagnosis
    let savedBackup
    try {
      savedBackup = await backup(chat, facts, issues)
      let legacy = null, legacyError = null
      if (issues.includes('legacy-regeneration')) {
        try { legacy = await legacyRecord(chat, facts) }
        catch (error) { legacyError = String(error.message || error) }
      }
      const script = chat.scriptState?.prepared ? await options.readScript(chat.cardPath) : null
      const revision = chat._storageRevision
      chat = await options.update(id, current => {
        if (options.isActive(current)) throw new Error('恢复前任务已经启动，保留备份并停止本次修复')
        if (current._storageRevision !== revision) throw new Error('恢复期间存档已变化，请重新诊断')
        if (legacy) current.pendingRegeneration = legacy
        if (legacyError) {
          current.legacyRegenerationRecovery = {status:'unknown',error:legacyError,backup:savedBackup,at:Date.now()}
          current.regenInProgress = false
        }
        if (current.pendingSurfaceRollback || current.pendingRegeneration) return current
        for (const op of Object.values(current.timeline?.operations || {})) {
          if (op.kind !== 'body' || !running(op)) continue
          const ended = (facts.events || []).findLast(e => e.type === 'turn/end' && e.data.turn === op.turn)
          op.status = 'interrupted'; op.completedAt = Date.now(); op.recoveryReason = ended?.data?.reason?.kind || (facts.exists ? 'no-live-task' : 'session-missing')
          delete current.foregroundFrames?.[op.id]
          delete current.pendingCardChanges?.[String(op.turn)]
        }
        if (current.scriptState?.prepared) {
          if (!script) throw new Error('剧本不存在，无法安全恢复 prepared 游标')
          current.scriptState = options.scripts.transition({ script, state: current.scriptState, event: { kind: 'restore', revision: null, reference: current.scriptState.prepared } }).state
        }
        if (current.workspace?.prepared) current.workspace.prepared = null
        current = options.timeline.apply({ chat: current, intent: { kind: 'background.recover' } }).chat
        if (running(current.contextCompaction?.operation)) Object.assign(current.contextCompaction.operation, { status: 'interrupted', completedAt: Date.now(), message: '上次压缩已中断，可以重试。' })
        for (const key of ['activity','maintenance','inspiration']) if (running(current.spDatabase?.[key])) Object.assign(current.spDatabase[key], { status: 'interrupted', finishedAt: Date.now(), error: '上次任务已中断，可以重试。' })
        for (const task of Object.values(current.taskMailbox?.tasks || {})) if (['queued','running'].includes(task.status)) {
          Object.assign(task, { status: 'interrupted', stage: 'interrupted', error: '上次任务已中断，可以重试。', updatedAt: Date.now(), version: (task.version || 0) + 1 })
          current.taskMailbox.version = (current.taskMailbox.version || 0) + 1
        }
        return current
      }, { source: 'runtime.recovery' })
      if (chat.pendingSurfaceRollback || chat.pendingRegeneration) {
        const result = await options.recoverHistory(chat.sessionId, chat.id)
        if (result.status === 'busy') throw new Error('原生会话已开始任务，历史恢复已暂缓')
        chat = await options.read(id)
        if (chat.pendingSurfaceRollback || chat.pendingRegeneration) throw new Error('历史恢复未完成，已停止重复尝试并保留原记录')
        if (issuesOf(chat).length) return await repairOne(id)
      }
      const remaining = issuesOf(chat)
      await log({ chatId: id, backup: savedBackup, result: remaining.length ? 'partial' : 'recovered', remaining })
      if(!remaining.length&&savedBackup)await options.onBackupCompleted?.('chat:'+id,savedBackup)
      return { chatId: id, sessionId: chat.sessionId, status: remaining.length ? 'partial' : 'recovered', issues, remaining, backup: savedBackup }
    } catch (error) {
      await log({ chatId: id, backup: savedBackup, result: 'blocked', error: String(error.message || error) })
      return { chatId: id, sessionId: chat.sessionId, status: 'blocked', issues, backup: savedBackup, error: String(error.message || error) }
    }
  }
  function repair(chat) {
    const key = chat.sessionId || chat.id
    if (pending.has(key)) return pending.get(key)
    const task = repairOne(chat.id).finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
  async function runImpl({ repair: apply = false, chatId, prepare = false } = {}) {
    const sequence=++scanSequence
    const rows = chatId ? [{ id: chatId }] : await options.list()
    const results = new Array(rows.length)
    let cursor=0
    async function visit(row) {
      let phase='storage-read'
      try {
      return await deadline.run(row,async()=>{
      let chat = await options.read(row.id)
      if(chat&&apply&&prepare&&options.prepare){phase='startup-prepare';await options.prepare(chat);chat=await options.read(row.id)}
      phase=apply?'repair':'inspect'
      if (chat) {
        const result = apply ? await repair(chat) : await inspect(chat)
        if (options.sidecars) {
          try {
            result.images = await options.sidecars(chat, { repair: apply })
            const status = ['blocked','repairable','busy','recovered'].find(status => result.images.some(image => image.status === status))
            if (status && ['healthy','recovered'].includes(result.status)) result.status = status
            if (result.images.length) result.issues = [...result.issues, 'image-owner']
          } catch (error) { result.status = 'blocked'; result.error = error.message }
        }
        result.title = chat.title || chat.cardName || chat.id
        return result
      } else return {chatId:row.id,status:'missing',issues:[]}
      })
      } catch(error) { return {chatId:row.id,status:error.code==='DSH_TAVERN_RECOVERY_TIMEOUT'?'unknown':phase==='storage-read'?'unreadable':'blocked',issues:[phase],error:String(error.message||error),...(error.code?{code:error.code}:{}),...(error.resourcePath?{resourcePath:error.resourcePath}:{})} }
    }
    await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{while(cursor<rows.length){const index=cursor++;results[index]=await visit(rows[index]);remember(results[index],sequence)}}))
    // Raw native events are evidence for internal reconciliation, not a UI log.
    return { version: 1, repair: apply, results: results.map(({ facts, ...row }) => ({ ...row, ...(facts ? { facts: { known: facts.known, exists: facts.exists, source: facts.source } } : {}) })) }
  }
  function run(input = {}) {
    const task=runImpl(input)
    if(input.repair){scans.add(task);task.then(()=>scans.delete(task),()=>scans.delete(task))}
    return task
  }
  async function finishManualReview(chat) {
    const record=chat.legacyRegenerationRecovery
    if(record?.status!=='reviewed'||!record.retentionPending)return
    // The Chat receipt precedes retention registration, so a restart can finish
    // this step without reintroducing an unresolved finding or losing the backup.
    if(typeof options.onBackupCompleted!=='function')throw Error('恢复副本回收登记尚未连接，已保留核对回执')
    if(record.backup)await options.onBackupCompleted('chat:'+chat.id,record.backup)
    await options.update(chat.id,current=>{
      if(current.legacyRegenerationRecovery?.reviewId!==record.reviewId)return
      current.legacyRegenerationRecovery={status:'reviewed',reviewId:record.reviewId,at:record.at};return current
    },{source:'runtime.recovery.review-completed'})
    await log({chatId:chat.id,result:'manually-reviewed',reviewId:record.reviewId,backup:record.backup})
  }
  async function acknowledge(chatId,expectedRevision) {
    const chat=await options.read(chatId)
    if(!chat)throw Error('对话不存在')
    const diagnosis=await inspect(chat)
    if(!diagnosis.manualReview||diagnosis.manualReview.revision!==expectedRevision)throw Error('对话状态已变化，请重新检查后核对')
    const backupPath=chat.legacyRegenerationRecovery.backup,backupValue=backupPath?await options.store.readJson(backupPath):null
    if(!backupValue||backupValue.version!==1||backupValue.chat?.id!==chat.id||backupValue.chat.sessionId!==chat.sessionId)throw Error('原恢复副本无法校验，请先检查备份')
    const reviewed=await options.update(chat.id,current=>{
      if(options.isActive(current)||current._storageRevision!==expectedRevision||current.legacyRegenerationRecovery?.status!=='unknown'||current.pendingRegeneration||current.pendingSurfaceRollback)throw Error('对话状态已变化，请重新检查后核对')
      current.legacyRegenerationRecovery={status:'reviewed',reviewId:hash([chat.id,expectedRevision,Date.now()]),at:Date.now(),retentionPending:true,backup:backupPath};return current
    },{source:'runtime.recovery.manual-review'})
    await finishManualReview(reviewed)
    return inspect(await options.read(chatId))
  }
  async function exportDiagnostic(chatId){
    if(typeof chatId!=='string'||!(await options.list()).some(row=>row.id===chatId))throw Error('对话不属于当前 Profile 或已不存在')
    const report=await run({chatId,repair:false}),diagnosis=healthFields({...report.results[0],checkedAt:Date.now()})
    if(diagnosis.resourcePath!==undefined){
      // Invalid CAS references can contain arbitrary source bytes in their
      // error location. Export only a valid digest or the resource's logical label.
      const location=String(diagnosis.resourcePath),kind=/^(chat-resources|resource-versions)\//.exec(location)?.[1]
      diagnosis.resourcePath=/^(chat-resources|resource-versions)\/[a-f0-9]{64}\.json$/.test(location)?location:kind?kind+'/[invalid-reference].json':'[unavailable-resource]'
    }
    return {filename:'dsh-storage-'+chatId.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,100)+'.json',text:JSON.stringify({version:1,kind:'dsh-tavern-storage-diagnostic',createdAt:Date.now(),dataDirectory:'profile-data/tavern/data',diagnosis,runtime:{node:process.version,platform:process.platform}},null,2)+'\n'}
  }
  return { run, status, exportDiagnostic, acknowledge:(id,revision)=>deadline.run({id},()=>acknowledge(id,revision),{exclusive:true}), waitSession:async sessionId=>{await Promise.all([...scans]);await deadline.waitSession(sessionId)} }
}
