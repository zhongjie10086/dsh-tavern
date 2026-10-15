import { createRecoveryDeadline } from './recovery-deadline.js'
import { createForegroundFrameSessionAdapter } from './foreground-frame-session-adapter.js'
import { decodeTavernSource } from './session-message-source.js'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { sessionEvents } from './session-events.js'
import { tavernAssistantTurn, appendAssistantEvent, pendingAssistantEdit, surfaceRange } from './session-surface-edit.js'
import { assertHistoryRecovery } from './round-history-recovery.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const text = message => (message?.content || []).filter(row => row.type === 'text').map(row => row.text || '').join('\n').trim()
const bodyText = message => String(message?.sourceText ?? message?.text ?? '').trim()
const nodes = session => [...(session?.surface?.nodes || [])]
const nativeStamp = session => hash([session?.id, session?.header, sessionEvents(session), nodes(session)])
function chatStamp(chat) {
  const { _storageRevision, updatedAt, pendingStoryAlignment, storyAlignmentReceipt, ...owned } = chat
  return hash(owned)
}
function openTurn(events) {
  const active = new Set()
  for (const event of events) {
    if (event.type === 'turn/start') active.add(event.data?.turn)
    if (event.type === 'turn/end') active.delete(event.data?.turn)
  }
  return active.size > 0
}

/** Raw native comparisons are read-only; they confer no right to adopt or settle a round. */
export function inspectStoryAlignment(chat, session) {
  const events = sessionEvents(session), bySeq = new Map(events.map(row => [row.seq, row])), visible = nodes(session)
  const findings = []
  if (!session || session.id !== chat.sessionId) return { status:'unknown', findings:[{code:'native-unavailable'}] }
  if (chat.pendingRegeneration || chat.pendingSurfaceRollback || chat.regenInProgress || chat.nativeHistoryEdit) return {status:'diagnostic',findings:[{code:'history-operation-pending'}]}
  if (openTurn(events)) return {status:'busy',findings:[{code:'native-turn-open'}]}
  const commits = chat.nativeCommits || {}, suppressed = new Set((chat.suppressedDshTurns || []).map(Number))
  const endings = new Map(events.filter(row=>row.type==='turn/end').map(row=>[Number(row.data?.turn),row.data?.reason?.kind]))
  const native = new Map()
  for (const seq of visible) {
    const event=bySeq.get(seq)
    if(event?.type!=='assistant/message'||event.data?.message?.source?.kind!=='model'||!text(event.data.message))continue
    const turn=tavernAssistantTurn(event,events)
    if (/^(?:tavern-opening:|tavern-seed-trajectory:)/.test(event.data.message.id || ''))continue
    if(!['completed','max-tokens'].includes(endings.get(Number(event.data.turn))))continue
    native.set(turn,event)
  }
  for(const [turn,event] of native) {
    if(suppressed.has(turn)) {findings.push({code:'rolled-back-visible',turn,seq:event.seq});continue}
    const saved=(chat.messages || []).findLast(row=>row.role==='assistant'&&!row.greeting&&Number(row.turn)===turn)
    if(saved) {if(bodyText(saved)!==text(event.data.message))findings.push({code:'body-text-mismatch',turn,seq:event.seq});continue}
    if(!Object.keys(commits).length){findings.push({code:'legacy-without-commit-evidence',turn});continue}
    // A source-bearing user message must have been appended in this same turn.
    const start=events.findLastIndex(row=>row.type==='turn/start'&&Number(row.data?.turn)===Number(event.data.turn))
    const end=events.findIndex((row,index)=>index>start&&row.type==='turn/end'&&Number(row.data?.turn)===Number(event.data.turn))
    const inputs=events.slice(start+1,end).filter(row=>row.type==='user/message'&&row.surfaceOp==='append'&&row.data?.source?.kind==='user')
    if(start>=0&&end>start&&inputs.length===1&&inputs[0].data.source.rpcId) findings.push({code:'uncommitted-player-round',turn,seq:event.seq,settlement:'unproven'})
    else findings.push({code:'unattributed-native-round',turn,seq:event.seq})
  }
  const tail=(chat.messages || []).findLast(row=>row.role==='assistant'&&!row.greeting)
  if(tail&&Number.isSafeInteger(Number(tail.turn))&&!native.has(Number(tail.turn)))findings.push({code:'saved-tail-not-visible',turn:Number(tail.turn)})
  return {status:findings.length?'diagnostic':'aligned',findings}
}

function safeRollbackPlan(chat, session, revision) {
  const record=revision?.pendingSurfaceRollback
  if(!record||record.kind!=='rollback'||record.phase!=='adopted'||record.surface?.data?.message?.content?.length!==0||record.surface.cleanups?.length)return null
  try {assertHistoryRecovery(chat,record)}catch{return null}
  if(!isDeepStrictEqual(revision.messages,chat.messages)||!isDeepStrictEqual(revision.suppressedDshTurns,chat.suppressedDshTurns)||!isDeepStrictEqual(revision.nativeCommits,chat.nativeCommits))return null
  const original=record.original, assistant=original.messages?.at(-1), user=original.messages?.at(-2), turn=Number(assistant?.turn)
  if(assistant?.role!=='assistant'||assistant.greeting||user?.role!=='user'||!(chat.suppressedDshTurns || []).includes(turn)||chat.nativeCommits?.[String(turn)]||!original.nativeCommits?.[String(turn)]?.requestId)return null
  if(!isDeepStrictEqual(chat.messages,original.messages.slice(0,-2)))return null
  const plan=structuredClone(record.surface),op=plan.intent?.surfaceOp,events=sessionEvents(session),surface=nodes(session)
  if(op?.op!=='replace')return null
  const start=surface.indexOf(op.startSeq ?? op.start),end=surface.indexOf(op.endSeq ?? op.end)
  if(start<0||end!==surface.length-1||end<start)return null
  const owned=surface.slice(start,end+1)
  if(!isDeepStrictEqual(owned,plan.intent.sourceEventSeqs))return null
  const bySeq=new Map(events.map(row=>[row.seq,row])), selected=owned.map(seq=>bySeq.get(seq))
  const input=selected[0],reply=selected.at(-1)
  if(input?.type!=='user/message'||input.surfaceOp!=='append'||input.data?.source?.kind!=='user'||input.data.source.rpcId!==original.nativeCommits[String(turn)].requestId||text(input.data)!==bodyText(user))return null
  if(reply?.type!=='assistant/message'||Number(reply.data.turn)!==turn||tavernAssistantTurn(reply,events)!==turn||reply.data.message?.source?.kind!=='model'||text(reply.data.message)!==bodyText(assistant))return null
  function ownedFrame(row) {
    if(row?.type!=='user/message'||row.surfaceOp!=='append')return false
    const source=row.data?.source,frame=original.foregroundFrames?.[source?.trace?.operationId],operation=original.timeline?.operations?.[source?.trace?.operationId]
    if(!frame||Number(frame.turn)!==turn||frame.chatId!==chat.id||operation?.kind!=='body'||Number(operation.turn)!==turn||!['completed','foreground-completed'].includes(operation.status))return false
    const expected=createForegroundFrameSessionAdapter({id:()=>row.data.id}).append({messages:[],frame,step:1}).messages[0]
    return expected&&isDeepStrictEqual(decodeTavernSource(expected.source),source)&&isDeepStrictEqual(expected.content,row.data.content)
  }
  // Only an exact persisted ForegroundFrame may accompany ordinary model replies.
  // Helper, trigger, authored/replayed regeneration or unrelated surface stays diagnostic.
  if(selected.slice(1).some(row=>!ownedFrame(row)&&(row?.type!=='assistant/message'||Number(row.data.turn)!==turn||row.data.message?.source?.kind!=='model'||row.data.message.source.provider==='dsh-tavern')))return null
  if(!events.some(row=>row.type==='turn/end'&&Number(row.data?.turn)===turn&&['completed','max-tokens'].includes(row.data.reason?.kind)))return null
  plan.data.message.id='alignment-rollback:'+randomUUID()
  return {plan,turn,sourceRevision:revision._storageRevision,sourceRecoveryId:record.id}
}

/** Repairs replay only a completed rollback receipt; missing narrative/settlement stays diagnostic. */
export function createStoryAlignment(options) {
  const deadline=createRecoveryDeadline({...options,facts:options.native})
  options={...deadline.options,native:chat=>deadline.options.facts(chat)}
  async function read(id) {
    if(!(await options.list()).some(row=>row.id===id))throw Error('对话不属于当前 Profile')
    const chat=await options.read(id)
    if(!chat||!['story','script'].includes(chat.mode))throw Error('请选择游玩对话')
    return chat
  }
  async function plan(chat,session) {
    if(chat.pendingStoryAlignment)return {pending:true,record:chat.pendingStoryAlignment}
    if(inspectStoryAlignment(chat,session).findings.some(row=>row.code==='rolled-back-visible')) {
      for(let r=Number(chat._storageRevision)-1,count=0;r>0&&count<64;r--,count++) {
        const revision=await options.readRevision(chat.id,r)
        if(!revision||revision.sessionId!==chat.sessionId)break
        const planned=safeRollbackPlan(chat,session,revision)
        if(planned)return planned
      }
    }
    return null
  }
  async function inspectOne(id) {
    const chat=await read(id),session=await options.native(chat)
    const report=inspectStoryAlignment(chat,session)
    if(options.busy(chat))return {chatId:id,title:chat.title||chat.cardName,status:'busy',findings:[{code:'task-active'}]}
    const proposed=session&&report.status!=='busy'&&!report.findings.some(row=>row.code==='history-operation-pending')&&await plan(chat,session)
    return {chatId:id,title:chat.title||chat.cardName,...report,...(proposed?{status:'repairable',repairKind:'replay-verified-rollback',turn:proposed.turn||proposed.record?.turn}:{}),expectedStamp:hash([chat.id,chat.sessionId,chat._storageRevision,nativeStamp(session)])}
  }
  const inspect=id=>deadline.run({id},()=>inspectOne(id))
  async function repair(id,expectedStamp) {
    if(typeof expectedStamp!=='string'||!/^[a-f0-9]{64}$/.test(expectedStamp))throw Error('对账版本凭据无效，请重新检查')
    const diagnosis=await inspect(id)
    if(diagnosis.expectedStamp!==expectedStamp)throw Error('对账版本已变化，请重新检查：读取快照已更新')
    if(diagnosis.status!=='repairable')throw Error('缺少可验证的完整回退回执，或任务正在运行，仅能诊断')
    // The adapter must acquire the actual core runMaintenance lease and Tavern maintenance writer.
    return options.exclusive(id,async({agent,signal})=>{
      let chat=await read(id),session=agent.session
      const check=()=>{signal.throwIfAborted();if(options.agent(chat.sessionId)!==agent||agent.session!==session||agent.phase?.kind!=='maintenance'||options.busy(chat))throw Error('对话任务或原生会话身份已变化，未继续修复')}
      check()
      if(hash([chat.id,chat.sessionId,chat._storageRevision,nativeStamp(session)])!==expectedStamp)throw Error('对账版本已变化，请重新检查：原生会话已载入')
      if(openTurn(sessionEvents(session)))throw Error('原生轮次尚未结束，不能修复')
      const planned=await plan(chat,session);check()
      if(!planned)throw Error('缺少可验证的完整回退回执，仅能诊断')
      let record=planned.record
      if(!record) {
        const backup='recovery/story-alignment/'+hash([chat.id,expectedStamp])+'.json',value={version:1,chat,session:{id:session.id,header:session.header,events:sessionEvents(session),nodes:nodes(session)},repair:planned}
        await options.store.writeJson(backup,value)
        if(hash(await options.store.readJson(backup))!==hash(value))throw Error('对账备份回读验证失败')
        check()
        if(nativeStamp(session)!==nativeStamp({id:value.session.id,header:value.session.header,events:value.session.events,surface:{nodes:value.session.nodes}}))throw Error('备份期间原生历史已变化')
        record={version:1,id:randomUUID(),...planned,backup,backupDigest:hash(value),preparedRevision:chat._storageRevision+1,baseDigest:chatStamp(chat),nativeBefore:nativeStamp(session),eventsDigest:hash(sessionEvents(session)),eventCount:sessionEvents(session).length,nodes:nodes(session)}
        chat=await options.update(id,current=>{check();if(current._storageRevision!==chat._storageRevision||chatStamp(current)!==record.baseDigest)throw Error('备份期间存档已变化');current.pendingStoryAlignment=record;return current},{source:'story-alignment.prepare'})
      }
      check()
      if(!/^recovery\/story-alignment\/[a-f0-9]{64}\.json$/.test(record.backup || ''))throw Error('对账恢复备份路径无效')
      const verified=await options.store.readJson(record.backup);check()
      if(!verified || hash(verified)!==record.backupDigest || verified.chat?.id!==chat.id || verified.chat?.sessionId!==chat.sessionId
        || chatStamp(verified.chat)!==record.baseDigest || !isDeepStrictEqual(verified.repair?.plan,record.plan))throw Error('对账恢复回执或备份校验失败')
      if(chatStamp(chat)!==record.baseDigest||chat._storageRevision!==record.preparedRevision||record.version!==1)throw Error('待恢复回执与存档不一致，仅能诊断')
      const events=sessionEvents(session),marker=pendingAssistantEdit(session,record.plan.data.message.id)
      const seedBoundary=event=>event?.type==='session/end-seed'&&!event.surfaceOp&&isDeepStrictEqual(event.data,{})
      const prefixIntact=hash(events.slice(0,record.eventCount))===record.eventsDigest&&isDeepStrictEqual(session.header,verified.session.header)
      const originalNative=nativeStamp(session)===record.nativeBefore||prefixIntact&&events.slice(record.eventCount).every(seedBoundary)&&isDeepStrictEqual(nodes(session),record.nodes)
      const resumed=marker&&prefixIntact&&events[record.eventCount]===marker&&events.slice(record.eventCount+1).every(seedBoundary)
        &&isDeepStrictEqual(marker.data.source.replacement,record.plan.data)&&isDeepStrictEqual(surfaceRange(marker.surfaceOp),surfaceRange(record.plan.intent.surfaceOp))
        &&isDeepStrictEqual(marker.sourceEventSeqs,record.plan.intent.sourceEventSeqs)
        &&isDeepStrictEqual(nodes(session),record.nodes.slice(0,record.nodes.indexOf(surfaceRange(record.plan.intent.surfaceOp).start)).concat(marker.seq))
      if(!originalNative&&!resumed)throw Error('原生历史已变化，保留备份及恢复意图')
      appendAssistantEvent(session,record.plan.data,record.plan.intent)
      const after=nativeStamp(session)
      await options.flush(session);check()
      if(nativeStamp(session)!==after)throw Error('落盘期间原生历史已变化，保留恢复意图')
      const receipt={id:record.id,kind:'verified-rollback-shadow',turn:record.turn,backup:record.backup,sourceRevision:record.sourceRevision,sourceRecoveryId:record.sourceRecoveryId,nativeBefore:record.nativeBefore,nativeAfter:after,at:Date.now()}
      await options.update(id,current=>{check();if(current.pendingStoryAlignment?.id!==record.id||current._storageRevision!==record.preparedRevision||chatStamp(current)!==record.baseDigest)throw Error('恢复提交期间存档已变化');delete current.pendingStoryAlignment;current.storyAlignmentReceipt=receipt;return current},{source:'story-alignment.complete'})
      const warnings=[]
      try {await options.onBackupCompleted?.('chat:'+id,record.backup)}catch(error){warnings.push('修复已完成；备份保留登记失败，原备份已保留：'+String(error.message||error))}
      return {chatId:id,status:'repaired',receipt,warnings}
    })
  }
  return {inspect,repair}
}
