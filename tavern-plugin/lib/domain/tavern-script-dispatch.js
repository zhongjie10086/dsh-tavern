import { redactDiagnostic, boundedRuntimeDiagnostics } from './mvu-diagnostics.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

// Settlement identity is created by the host adapter. An ordinary lifecycle
// event with the same name must retain its normal execution contract.
export function isMvuSettlementWork(work) {
  return work?.requiredRuntimeContract==='card-mvu-pending-v1' || str(work?.eventId ?? work?.id).startsWith('card-mvu:') || str(work?.eventId ?? work?.id).startsWith('mvu:') || Array.isArray(work?.onlyScriptIds) && work.onlyScriptIds.includes('__dsh_official_mvu__')
}

export const TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS = 60000
export const TAVERN_SCRIPT_CLAIM_TIMEOUT_MS = 15000

/**
 * Own the lifecycle of Host work that must execute in the browser Tavern
 * sandbox. Signals only wake an executor; this module remains authoritative.
 */
export function createTavernScriptDispatch(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const executionTimeoutMs = Math.max(100, Number(options.executionTimeoutMs || options.timeoutMs) || TAVERN_SCRIPT_EXECUTION_TIMEOUT_MS)
  const claimTimeoutMs = Math.max(100, Number(options.claimTimeoutMs) || TAVERN_SCRIPT_CLAIM_TIMEOUT_MS)
  const presenceTtlMs = Math.max(100, Number(options.presenceTtlMs) || 15000)
  const publishExternal = typeof options.publishSignal === 'function' ? options.publishSignal : function () {}
  const workListeners = new Set()
  function publishSignal(sessionId,signal){
    publishExternal(sessionId,signal)
    for(const item of workListeners)if(item.sessionId===sessionId){try{item.listener(signal)}catch{}}
  }
  function subscribeWork(sessionId,listener){const item={sessionId:str(sessionId),listener};workListeners.add(item);return()=>workListeners.delete(item)}
  function executingEvent(sessionId,runtimeId,eventId,leaseToken){
    const record=records.get(str(sessionId));
    if(!record||record.phase!=='executing'||record.offeredTo!==str(runtimeId)||record.event.id!==str(eventId)||leaseToken!==undefined&&record.leaseToken!==leaseToken)return null;
    return clone(record.event);
  }
  function retainedOwner(sessionId,runtimeId){const current=presence.get(str(sessionId));return !!current&&current.owner===str(runtimeId)&&!current.resetRequired&&!current.released;}
  const records = new Map()
  const presence = new Map()
  const readyListeners = new Set()
  const settledListeners = new Set()
  const idleWaiters = new Set()
  let sequence = 0
  let leaseSequence = 0

  function publishReady(sessionId) {
    for (const listener of readyListeners) {
      try { listener(sessionId) } catch {}
    }
  }

  function publishSettled(sessionId) {
    for (const listener of settledListeners) {
      try { listener(sessionId) } catch {}
    }
  }

  function resolveRecord(id, record, result) {
    if (records.get(id) !== record) return false
    records.delete(id)
    const owner = presence.get(id);
    if (record.event.displayedMessage && owner?.displayWork === record.event.id && !owner.operations) delete owner.displayWork;
    if (record.claimTimer !== null) clearTimeout(record.claimTimer)
    if (record.offerTimer !== null) clearTimeout(record.offerTimer)
    if (record.executionTimer !== null) clearTimeout(record.executionTimer)
    record.resolve(result)
    // A ready runtime can still be occupied by ordinary Helper work. Removing
    // that work is a capability transition for durable, unexecuted MVU work,
    // even if initialization readiness itself never changed. Failed/timed-out
    // work keeps its own receipt; this hint never retries the resolved record.
    const state = status(id)
    if (state.ready && !state.busy && !state.mvuValidationBlocked) publishSettled(id)
    return true
  }

  const unloadParticipants=scope=>scope?.participants||[{scriptId:scope?.scriptId,sourceDigest:scope?.sourceDigest}];
  const sameUnloadScope=(a,b)=>Boolean(a&&b&&a.chatId===b.chatId&&a.lifecycleRevision===b.lifecycleRevision&&a.scriptTreeRevision===b.scriptTreeRevision&&a.sourceDigest===b.sourceDigest&&a.packageDigest===b.packageDigest&&a.extensionRevision===b.extensionRevision&&a.scriptId==='extension-sp-database'&&b.scriptId==='extension-sp-database'&&JSON.stringify(unloadParticipants(a))===JSON.stringify(unloadParticipants(b)));
  function invalidateUnload(current){if(current?.unload)current.unload.invalid=true;}
  function admitWork(current){if(!current)return;current.admissionEpoch=(current.admissionEpoch||0)+1;if(current.unload&&(current.unload.reserved||current.unload.votes.some(p=>p.consumed)))invalidateUnload(current);}
  function issueUnloadTicket(sessionId,runtimeId,scope,random){
    const current=presence.get(str(sessionId));
    if(!current||current.owner!==str(runtimeId)||current.owner.startsWith('background:')||current.released||current.resetRequired||current.draining||current.quarantined||!scope||scope.scriptId!=='extension-sp-database')return null;
    if(current.unload&&!sameUnloadScope(current.unload.scope,scope)){invalidateUnload(current);return null;}
    const participants=unloadParticipants(scope);
    if(!participants.length||participants.some(p=>!p.scriptId||!p.sourceDigest)||new Set(participants.map(p=>p.scriptId)).size!==participants.length)return null;
    if(!current.unload)current.unload={id:random(),scope:clone(scope),votes:participants.map(p=>({...p,token:random(),consumed:false})),voted:false,reserved:false,invalid:false};
    const ticket=current.unload;if(ticket.invalid||ticket.votes.some(p=>p.consumed))return null;
    return {unloadId:ticket.id,lifecycleRevision:scope.lifecycleRevision,sourceDigest:scope.sourceDigest,participants:ticket.votes.map(p=>({scriptId:p.scriptId,sourceDigest:p.sourceDigest,token:p.token}))};
  }
  function acceptsUnloadTicket(sessionId,token,scope){const current=presence.get(str(sessionId)),ticket=current?.unload;return Boolean(ticket&&!ticket.invalid&&ticket.votes.some(p=>p.token===token&&!p.consumed)&&!current.released&&!current.resetRequired&&!current.quarantined&&sameUnloadScope(ticket.scope,scope)&&(!current.draining||current.drainKind==='unloading')&&(drainLive(current)||now()-current.seenAt<=presenceTtlMs));}
  function finalizeUnload(id,current){
    const ticket=current.unload;
    if(!ticket||ticket.invalid||!ticket.voted||!ticket.reserved||ticket.epoch!==(current.admissionEpoch||0)||current.operations>0||records.has(id)||current.resetRequired||current.quarantined||current.drainKind!=='unloading')return {released:false,pending:true};
    current.released=true;current.ready=false;current.generalReady=false;current.draining=false;ticket.finished=true;
    publishSignal(id,{kind:'runtime-work',version:'unload-released:'+ ++sequence});return {released:true,unloadResolved:true};
  }
  function voteUnload(sessionId,token,scope){
    const id=str(sessionId),current=presence.get(id);if(!acceptsUnloadTicket(id,token,scope))return {released:false,invalid:true};
    const ticket=current.unload;ticket.votes.find(p=>p.token===token).consumed=true;
    if(current.operations>0||records.has(id)){ticket.invalid=true;return {released:false,pending:true};}
    if(ticket.epoch!==undefined&&ticket.epoch!==(current.admissionEpoch||0)){ticket.invalid=true;return {released:false,invalid:true};}
    ticket.voted=ticket.votes.every(p=>p.consumed);ticket.epoch=current.admissionEpoch||0;return finalizeUnload(id,current);
  }
  function reserveUnload(sessionId,runtimeId,{unloadId,scope,hostIdle,durationMs}={}){
    const id=str(sessionId),current=presence.get(id),ticket=current?.unload;
    if(!current||current.owner!==str(runtimeId))return {reserved:false,superseded:true};
    if(current.released)return {reserved:false,released:true,...(ticket?.finished&&ticket.id===unloadId?{unloadResolved:true}:{})};
    const valid=ticket&&!ticket.invalid&&ticket.id===unloadId&&sameUnloadScope(ticket.scope,scope)&&hostIdle===true&&!current.resetRequired&&!current.quarantined&&(!current.draining||current.drainKind==='unloading');
    // Bad/missing proof never bypasses the existing drain, nor changes its kind.
    if(!valid)return reserveDrain(id,runtimeId,'',durationMs);
    if(!ticket.voted)ticket.epoch=current.admissionEpoch||0;
    if(current.operations>0||records.has(id)||ticket.epoch!==(current.admissionEpoch||0)){invalidateUnload(current);return reserveDrain(id,runtimeId,'',durationMs);}
    const reserved=reserveDrain(id,runtimeId,'',durationMs,false,'',true);ticket.reserved=true;current.drainKind='unloading';
    const result=finalizeUnload(id,current);return result.released?{reserved:false,...result}:reserved;
  }
  const drainLive=current=>current?.draining===true&&now()<current.drainUntil
  function touch(sessionId, runtimeId = 'legacy', ready = false, initializationError = '',leaseProtocol=0,mvuValidation) {
    const id = str(sessionId)
    const owner = str(runtimeId)
    if (id === '' || owner === '') return false
    const current = presence.get(id)
    if (current?.owner === owner && (current.resetRequired||current.released)) return false
    if (current && current.owner !== owner && (drainLive(current) || current.operations>0 || !current.released&&(now() - current.seenAt <= presenceTtlMs || records.get(id)?.phase === 'executing'))) return false
    const oldDisplay = records.get(id);
    if (current?.owner !== owner && oldDisplay?.event.displayedMessage) resolveRecord(id,oldDisplay,{handled:false,disposed:true,error:'正文显示执行窗口已变化',args:clone(oldDisplay.event.args)});
    if(current?.draining&&current.owner!==owner)try{options.onDrainLost?.(id,{runtimeId:current.owner,error:current.drainError||'SP 保存窗口失联，未确认工作未重放；请检查恢复记录'})}catch{}
    const wasReady = Boolean(current && current.owner === owner && now() - current.seenAt <= presenceTtlMs && current.ready === true)
    const error = redactDiagnostic(str(initializationError).slice(0, 4000)).trim()
    const errorChanged=Boolean(error&&(!current||current.owner!==owner||now()-current.seenAt>presenceTtlMs||current.initializationError!==error))
    ready = ready === true && error === '' && !current?.draining
    const activity=current?.owner===owner&&now()-current.seenAt<=presenceTtlMs&&!error?current.mvuActivity:undefined
    // Retain this object while admitted RPCs hold it; heartbeat must not lose
    // their operation count or allow a new owner to overlap their persistence.
    const next=current?.owner===owner?current:{operations:0,requiresRuntimeId:current?.requiresRuntimeId===true}
    Object.assign(next,{owner,seenAt:now(),ready,requiresRuntimeId:next.requiresRuntimeId||leaseProtocol===2})
    if(activity)next.mvuActivity=activity;else delete next.mvuActivity
    if(error)next.initializationError=error;else delete next.initializationError
    // R8 1.5: ordinary scripts can take lifecycle events while only the MVU core
    // (or a companion waiting for it) is unready. Settlement still needs `ready`.
    next.generalReady=ready||mvuValidation?.generalReady===true&&!current?.draining
    const wasValidationBlocked = current?.owner === owner && current.mvuValidation?.blocked === true
    const wasCardScopeReady=current?.owner===owner&&current.mvuValidation?.cardPendingVersion===1&&current.mvuValidation?.cardPendingScopeVersion===1
    // Transient and owner/lifecycle-scoped, never part of the persisted journal.
    if (mvuValidation && typeof mvuValidation.blocked === 'boolean') {
      const revision = Math.max(0, Number(mvuValidation.lifecycleRevision) || 0)
      if (!next.mvuValidation || revision >= next.mvuValidation.lifecycleRevision) next.mvuValidation = {
        blocked:mvuValidation.blocked, lifecycleRevision:revision, cardPendingVersion:mvuValidation.cardPendingVersion===1?1:0,cardPendingScopeVersion:mvuValidation.cardPendingScopeVersion===1?1:0,
        reason:redactDiagnostic(str(mvuValidation.reason).slice(0,4000))
      }
    }
    presence.set(id,next)
    const validationRecovered = wasValidationBlocked && next.mvuValidation?.blocked === false
    const cardScopeRecovered=!wasCardScopeReady&&next.mvuValidation?.cardPendingVersion===1&&next.mvuValidation?.cardPendingScopeVersion===1
    const waiting = records.get(id)
    if(waiting&&waiting.phase!=='executing'&&waiting.event.requiredRuntimeContract==='card-mvu-pending-v1'&&(next.mvuValidation?.cardPendingVersion!==1||next.mvuValidation?.cardPendingScopeVersion!==1))resolveRecord(id,waiting,{handled:false,unavailable:true,unsupportedRuntimeContract:true,phase:waiting.phase,args:clone(waiting.event.args)})
    if (!error && next.mvuValidation?.blocked && waiting && waiting.phase !== 'executing' && isMvuSettlementWork(waiting.event)) {
      resolveRecord(id,waiting,{handled:false,unavailable:true,mvuValidationBlocked:true,phase:waiting.phase,error:next.mvuValidation.reason,args:clone(waiting.event.args)})
    }
    if (error) {
      const record = records.get(id)
      // An ordinary event is never refused for the core: it waits for ordinary readiness
      // and, if none comes, the executor skips it as never delivered.
      if (record && record.event.general !== true) resolveRecord(id, record, { handled: false, initializationFailed: true, error, args: clone(record.event.args) })
    }
    if (ready && (!wasReady || validationRecovered || cardScopeRecovered)) publishReady(id)
    if ((ready && (!wasReady || validationRecovered || cardScopeRecovered)) || errorChanged) {
      publishSettled(id)
    }
    return true
  }

  function available(sessionId, runtimeId = '', requireReady = false) {
    const current = presence.get(str(sessionId))
    if (!current || !drainLive(current)&&now() - current.seenAt > presenceTtlMs) return false
    if (str(runtimeId) !== '' && current.owner !== str(runtimeId)) return false
    if (current.resetRequired||current.released) return false
    if (requireReady === 'general') return current.ready === true || current.generalReady === true
    return requireReady !== true || current.ready === true
  }
  const deliverable=(runtime,record)=>(!record?.event.displayedMessage || record.event.displayedMessage.runtimeId===runtime?.owner) && (runtime?.ready===true||runtime?.generalReady===true&&record?.event.general===true)

  function availableFrontend(sessionId){return available(sessionId)&&!presence.get(str(sessionId)).owner.startsWith('background:')}
  function heartbeat(sessionId,runtimeId,ready,initializationError,leaseProtocol=0,mvuValidation){
    const active=touch(sessionId,runtimeId,ready,initializationError,leaseProtocol,mvuValidation),record=records.get(str(sessionId))
    return {active,resetRequired:needsReset(sessionId,runtimeId),workPending:Boolean(active&&record&&deliverable(presence.get(str(sessionId)),record)&&record.phase!=='executing'&&(!record.offeredTo||record.offeredTo===str(runtimeId)))}
  }

  const persistenceMethods=new Set(['saveTavernChatData','saveTavernExtensionSettings','publishTavernSpAuthorityCache'])
  const saveRecoveryMethods=new Set([...persistenceMethods,'assertTavernSpOwnedTask','prepareTavernSpOwnedSaveRetry','checkpointTavernSpOwnedTask'])
  function beginOwnedSaveRecovery(sessionId,runtimeId,token,taskId,durationMs=91000){
    const current=presence.get(str(sessionId));
    if(!current||current.owner!==str(runtimeId)||!current.quarantined||current.resetRequired||current.released||current.operations>0||!str(token)||!str(taskId))throw new Error('SP 原保存恢复身份已失效');
    if(current.ownedSaveRecovery)throw new Error('SP 保存恢复已经执行');
    current.ownedSaveRecovery={token:str(token),taskId:str(taskId),until:now()+Math.min(91000,Math.max(1,durationMs)),error:current.drainError};current.seenAt=now();current.drainUntil=current.ownedSaveRecovery.until;
    return {reserved:true};
  }
  function finishOwnedSaveRecovery(sessionId,runtimeId,token,{resume=false}={}){
    const id=str(sessionId),current=presence.get(id),recovery=current?.ownedSaveRecovery;
    if(!current||current.owner!==str(runtimeId)||!recovery||recovery.token!==token||current.resetRequired||current.released)throw new Error('SP 保存恢复确认已失效');
    const valid=now()<recovery.until&&current.drainError===recovery.error&&current.operations===0&&!records.has(id);
    delete current.ownedSaveRecovery;
    if(resume&&!valid)throw new Error('SP 保存后仍有其他隔离或未完成工作');
    if(resume){current.quarantined=false;current.draining=false;current.ready=false;current.generalReady=false;delete current.drainError;delete current.recoveryToken;delete current.recoveryUntil;current.seenAt=now();}
    return {resumed:resume===true};
  }
  function quarantine(sessionId,runtimeId,error){
    const id=str(sessionId),current=presence.get(id)
    if(!current||current.owner!==str(runtimeId)||current.resetRequired)return {quarantined:false,superseded:true}
    invalidateUnload(current);current.quarantined=true;current.draining=true;current.ready=false;current.generalReady=false;current.drainUntil=now();
    delete current.recoveryToken;delete current.recoveryUntil;delete current.ownedSaveRecovery
    if(error)current.drainError=redactDiagnostic(str(error)).slice(0,2000)
    const record=records.get(id)
    if(record)resolveRecord(id,record,{handled:false,error:current.drainError||'SP 执行已隔离',phase:record.phase,args:clone(record.event.args)})
    return {quarantined:true,superseded:current.resetRequired===true}
  }
  async function runOwned(sessionId,runtimeId,work,recovery={}){
    const id=str(sessionId),owner=str(runtimeId),current=presence.get(id)
    if(!owner&&!current?.requiresRuntimeId)return work() // Legacy and preparation facades have no execution lease.
    if(!owner||!current||current.owner!==owner||current.resetRequired||current.released||(!drainLive(current)&&now()-current.seenAt>presenceTtlMs&&records.get(id)?.phase!=='executing'))throw new Error('脚本执行窗口已失效或缺少当前身份，请重新打开游戏')
    const save=current.ownedSaveRecovery;
    const ownedSave=save&&recovery.token===save.token&&now()<save.until&&recovery.scriptId==='extension-sp-database'&&saveRecoveryMethods.has(recovery.method)&&(!recovery.taskId||recovery.taskId===save.taskId);
    if(current.quarantined&&!ownedSave&&!(current.recoveryToken&&recovery.token===current.recoveryToken&&now()<current.recoveryUntil&&recovery.scriptId==='extension-sp-database'&&persistenceMethods.has(recovery.method)))throw new Error('SP 执行已隔离，仅允许当前显式保存重试')
    if(str(recovery.eventId).startsWith('display-render:')){
      const record=records.get(id);
      if(!record?.event.displayedMessage||record.event.id!==recovery.eventId||record.phase!=='executing'||record.cancelled)throw new Error('正文显示事件已结束，写入未执行');
    }
    admitWork(current);current.operations=(current.operations||0)+1
    try{return await work()}finally{current.operations--;
      if(current.displayWork&&!current.operations&&presence.get(id)===current){
        const record=records.get(id);
        if(record?.cancelled&&record.event.id===current.displayWork){
          // resolveRecord owns both release and the single settled hint.
          resolveRecord(id,record,{handled:false,disposed:true,error:'正文显示已取消',args:clone(record.event.args)});
          publishSignal(id,{kind:'runtime-work',version:'display-drained:'+ ++sequence});
        }else if(!record){
          // The event receipt/timeout preceded its admitted persistence drain.
          delete current.displayWork;
          publishSignal(id,{kind:'runtime-work',version:'display-drained:'+ ++sequence});
          const state=status(id);
          if(state.ready&&!state.busy&&!state.mvuValidationBlocked)publishSettled(id);
        }
      }
      if(current.released&&!current.unload?.finished&&!current.operations&&presence.get(id)===current){presence.delete(id);publishSignal(id,{kind:'runtime-work',version:'released:'+ ++sequence})}}
  }
  function reserveDrain(sessionId,runtimeId,error,durationMs=91000,retry=false,recoveryToken='',unloading=false){
    const id=str(sessionId),current=presence.get(id);
    if(!current||current.owner!==str(runtimeId)||current.released)return {reserved:false,released:true};
    if(current.resetRequired)return {reserved:false,superseded:true};
    if(!unloading){invalidateUnload(current);current.drainKind='ordinary';}
    if(current.quarantined&&(!retry||!str(recoveryToken)))return {reserved:false,quarantined:true};
    if(retry&&current.operations>0)return {reserved:false,pending:true};
    if(!drainLive(current)&&now()-current.seenAt>presenceTtlMs&&records.get(id)?.phase!=='executing')throw new Error('SP 原包保存租约已失效');
    if(!current.draining||retry)current.drainUntil=now()+Math.max(1,Math.min(91000,Number(durationMs)||91000));
    if(current.quarantined&&retry){current.recoveryToken=str(recoveryToken);current.recoveryUntil=current.drainUntil;}
    current.draining=true;current.ready=false;current.generalReady=false;current.seenAt=now();if(error)current.drainError=redactDiagnostic(str(error)).slice(0,2000);
    return {reserved:true,remainingMs:Math.max(0,current.drainUntil-now())};
  }
  function retirePresence(id){const current=presence.get(id);if(current?.released&&current.unload?.finished)return;if(current?.operations>0){current.released=true;current.ready=false;current.generalReady=false}else presence.delete(id)}

  // Transient, tied to the existing execution lease. Never written to a chat or global settings.
  function mvuActivity(chat) {
    if (chat?.mvu?.enabled !== true) return {};
    const value = presence.get(str(chat.sessionId))?.mvuActivity;
    return {mvuExtraAnalysis: Boolean(available(chat.sessionId) && value?.chatId === chat.id && value.lifecycleRevision === Number(chat.tavernHelperLifecycleRevision || 0) && value.value)};
  }
  function setMvuActivity(chat, runtimeId, value) {
    if (chat?.mvu?.enabled !== true || typeof value !== 'boolean') throw new Error('MVU 运行状态无效');
    if (!str(runtimeId) || !available(chat.sessionId, runtimeId)) throw new Error('MVU 执行窗口已失效');
    const current = presence.get(str(chat.sessionId));
    current.mvuActivity = {chatId:chat.id,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision || 0),value};
    publishSignal(chat.sessionId,{kind:'tavern-state',version:'mvu-activity:'+(++sequence)});
    return {updated:true,...mvuActivity(chat)};
  }

  function claim(sessionId, runtimeId = 'legacy', ready = false, initializationError = '',leaseProtocol=0,mvuValidation) {
    const id = str(sessionId)
    if (!touch(id, runtimeId, ready, initializationError,leaseProtocol,mvuValidation)) return { active: false, ready: false, event: null, ...(presence.get(id)?.drainError?{drainError:presence.get(id).drainError}:{}), ...(needsReset(id, runtimeId) ? { resetRequired: true } : {}) }
    const runtime = presence.get(id)
    const record = records.get(id)
    if (!record || !deliverable(runtime, record)) return { active: true, ready: runtime.ready === true, event: null }
    if (record.phase === 'executing') return { active: true, ready: true, event: null }
    if (record.offeredTo !== '' && record.offeredTo !== str(runtimeId)) return { active: true, ready: true, event: null }
    if (record.phase === 'queued') {
      record.phase = 'offered'
      record.offeredTo = str(runtimeId)
      record.leaseToken = record.event.id + ':lease-' + (++leaseSequence)
      if (record.claimTimer !== null) clearTimeout(record.claimTimer)
      record.claimTimer = null
      record.offerTimer = setTimeout(function () {
        if (records.get(id) !== record || record.phase !== 'offered') return
        record.phase = 'queued'
        record.offeredTo = ''
        record.leaseToken = ''
        record.offerTimer = null
        record.claimTimer = setTimeout(function () {
          if (records.get(id) === record && record.phase === 'queued') retirePresence(id)
          resolveRecord(id, record, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: clone(record.event.args) })
        }, claimTimeoutMs)
        publishSignal(id, { kind: 'runtime-work', version: record.event.id+':reoffer-'+(++leaseSequence) })
      }, claimTimeoutMs)
    }
    return { active: true, ready: true, event: clone(record.event), leaseToken: record.leaseToken }
  }

  function start(sessionId, eventId, leaseToken, runtimeId = 'legacy') {
    const id = str(sessionId)
    if (presence.get(id)?.owner!==str(runtimeId)||presence.get(id)?.resetRequired) return { started: false }
    const record = records.get(id)
    if (!record || record.event.id !== str(eventId) || record.offeredTo !== str(runtimeId) || record.leaseToken !== str(leaseToken)) return { started: false }
    if(record.cancelled)return {started:false};
    if (record.phase === 'executing') return { started: true, alreadyStarted: true }
    if (record.phase !== 'offered') return { started: false }
    admitWork(presence.get(id));record.phase = 'executing'
    if (record.offerTimer !== null) clearTimeout(record.offerTimer)
    record.offerTimer = null
    record.executionTimer = setTimeout(function () {
      resolveRecord(id, record, { handled: false, timedOut: true, phase: 'executing', args: clone(record.event.args) })
    }, record.executionTimeoutMs)
    return { started: true, alreadyStarted: false }
  }

  function complete(sessionId, eventId, args, runtimeId = 'legacy', leaseToken = '', error = '', diagnostics) {
    const id = str(sessionId)
    if (presence.get(id)?.owner!==str(runtimeId)||presence.get(id)?.resetRequired) return false
    const record = records.get(id)
    if (!record || record.phase !== 'executing' || record.event.id !== str(eventId)
      || record.offeredTo !== str(runtimeId) || record.leaseToken !== str(leaseToken)) return false
    if(record.cancelled){resolveRecord(id,record,{handled:false,disposed:true,error:'正文显示已取消',args:clone(record.event.args)});return false;}
    if(record.event.requiredRuntimeContract==='card-mvu-pending-v1'&&Array.isArray(diagnostics)&&diagnostics.some(item=>item.kind==='card-mvu-stale-v1'))return resolveRecord(id,record,{handled:false,stale:true,args:clone(record.event.args)})
    const guardedBeforeExecution = isMvuSettlementWork(record.event) && Array.isArray(diagnostics) && diagnostics.some(item => item.kind === 'mvu-validation-deferred')
    if (guardedBeforeExecution) {
      const owner=presence.get(id),reason=redactDiagnostic(str(error)).slice(0,4000)
      owner.mvuValidation={...(owner.mvuValidation || {lifecycleRevision:0}),blocked:true,reason}
      return resolveRecord(id,record,{handled:false,unavailable:true,mvuValidationBlocked:true,error:reason,args:clone(record.event.args)})
    }
    const extra = Array.isArray(diagnostics) ? { diagnostics: clone(boundedRuntimeDiagnostics(diagnostics)) } : {}
    const initializationFailed = extra.diagnostics?.some(item => item.kind === 'initialization' && item.initializationFailed)
    const message = initializationFailed ? redactDiagnostic(str(error).slice(0, 4000)).trim() : str(error).trim()
    return resolveRecord(id, record, message === ''
      ? { handled: true, args: clone(Array.isArray(args) ? args : record.event.args), ...extra }
      : { handled: false, error: message, args: clone(Array.isArray(args) ? args : record.event.args), ...extra,
        ...(initializationFailed ? { initializationFailed: true } : {}) })
  }

  async function dispatch(sessionId, name, args = [], context = null, work = {}) {
    const id = str(sessionId)
    const state = status(id)
    if(work.requiredRuntimeContract && (work.requiredRuntimeContract!=='card-mvu-pending-v1'||state.cardMvuPendingVersion!==1||state.cardMvuScopeVersion!==1||work.expectedCardMvu?.version!==1))return {handled:false,unavailable:true,unsupportedRuntimeContract:true,args:clone(args)}
    // An ordinary lifecycle event goes to the scripts that are ready; an MVU core
    // failure (even a terminal one) is not a reason to withhold it from them.
    const general = work.general === true && !work.requiredRuntimeContract && !isMvuSettlementWork(work)
    if (state.initializationError && !general) return { handled: false, initializationFailed: true, error: state.initializationError, args: clone(args) }
    if (state.mvuValidationBlocked && isMvuSettlementWork(work)) return {handled:false,unavailable:true,mvuValidationBlocked:true,error:state.mvuValidationReason,args:clone(args)}
    if (id === '' || !available(id, '', general ? 'general' : true)) return { handled: false, unavailable: true, args: clone(args) }
    if (state.busy) return { handled: false, busy: true, notExecuted: true, phase: 'queued', args: clone(args) }
    const event = {
      id: str(work && work.eventId).trim() || 'script-work-' + (++sequence),
      name: str(name),
      ...(work.displayedMessage?{displayedMessage:clone(work.displayedMessage)}:{}),
      ...(work.requiredRuntimeContract?{requiredRuntimeContract:str(work.requiredRuntimeContract),expectedLifecycleRevision:Number(work.expectedLifecycleRevision),expectedCardMvu:clone(work.expectedCardMvu)}:{}),
      ...(general?{general:true}:{}),
      args: clone(Array.isArray(args) ? args : []),
      context: clone(context),
      executionBudgetMs:Math.max(100,Math.min(91000,Number(work.executionTimeoutMs)||executionTimeoutMs)),
      excludedScriptIds:Array.isArray(work.excludedScriptIds)?clone(work.excludedScriptIds):[],
      onlyScriptIds:Array.isArray(work.onlyScriptIds)?clone(work.onlyScriptIds):null
    }
    return await new Promise(function (resolve) {
      const record = { event, resolve, phase: 'queued', executionTimeoutMs:Math.max(executionTimeoutMs,Math.min(91000,Number(work.executionTimeoutMs)||0)), offeredTo: '', leaseToken: '', claimTimer: null, offerTimer: null, executionTimer: null }
      record.claimTimer = setTimeout(function () {
        // A runtime that stays "ready" but cannot claim signalled work is no
        // longer a usable lease. Keeping that stale presence makes settlement
        // immediately redispatch forever. Its next real claim/heartbeat will
        // register a fresh ready transition and resume the deferred work once.
        if (records.get(id) === record && record.phase === 'queued') retirePresence(id)
        resolveRecord(id, record, { handled: false, unavailable: true, claimTimedOut: true, phase: 'queued', args: clone(event.args) })
      }, claimTimeoutMs)
      admitWork(presence.get(id));records.set(id, record)
      if(event.displayedMessage)presence.get(id).displayWork=event.id;
      publishSignal(id, { kind: 'runtime-work', version: event.id })
    })
  }

  // Fixed display event only. No caller-selected event name or arbitrary RPC.
  async function enqueueDisplayedMessage(sessionId,runtimeId,target,context) {
    const id=str(sessionId),owner=str(runtimeId);
    if(!owner||owner.startsWith('background:')||!available(id,owner,'general'))throw new Error('正文显示执行窗口已失效');
    if(status(id).busy)return {queued:false,pending:true};
    const completion=dispatch(id,'CHARACTER_MESSAGE_RENDERED',[target.messageId],context,{eventId:target.eventId,general:true,onlyScriptIds:target.scriptIds,displayedMessage:{...target,runtimeId:owner}});
    // dispatch creates its record synchronously before its terminal Promise.
    // Accepted work is observed through the ordinary claim/start/complete path.
    if(records.get(id)?.event.id===target.eventId)return {queued:true,eventId:target.eventId};
    const result=await completion;return {queued:false,pending:result.busy===true||result.unavailable===true,error:result.error};
  }
  function displayedMessageTarget(sessionId,eventId,runtimeId,leaseToken) {
    const record=records.get(str(sessionId));
    return record?.event.displayedMessage && !record.cancelled && record.event.id===str(eventId) && record.offeredTo===str(runtimeId) && record.leaseToken===str(leaseToken)
      ? clone(record.event.displayedMessage) : null;
  }
  function cancelDisplayedMessage(sessionId,eventId,runtimeId) {
    const id=str(sessionId),record=records.get(id),owner=presence.get(id);
    if(!record?.event.displayedMessage||record.event.id!==str(eventId)||record.event.displayedMessage.runtimeId!==str(runtimeId)||owner?.owner!==str(runtimeId))return {cancelled:false};
    record.cancelled=true;
    if(!owner.operations)resolveRecord(id,record,{handled:false,disposed:true,error:'正文显示已取消',args:clone(record.event.args)});
    return {cancelled:true,pending:owner.operations>0};
  }

  function subscribeReady(listener) {
    if (typeof listener !== 'function') return function () {}
    readyListeners.add(listener)
    return function () { readyListeners.delete(listener) }
  }

  function subscribeSettled(listener) {
    if (typeof listener !== 'function') return function () {}
    settledListeners.add(listener)
    return function () { settledListeners.delete(listener) }
  }

  function waitForIdle(sessionId, { signal, timeoutMs = executionTimeoutMs } = {}) {
    const id = str(sessionId)
    return new Promise((resolve, reject) => {
      let done = false, timer = null
      const stops = [], waiter = { id, fail: error => finish(error) }
      function finish(error, state) {
        if (done) return
        done = true; idleWaiters.delete(waiter)
        if (timer !== null) clearTimeout(timer)
        for (const stop of stops) stop()
        signal?.removeEventListener('abort', aborted)
        if (error) reject(error); else resolve(state)
      }
      function aborted() { finish(signal.reason || new Error('脚本空闲等待已取消')) }
      function check() {
        const state = status(id)
        if (!state.present) finish(new Error('脚本执行窗口已释放，未执行事件仍保留'))
        else if (!state.busy) finish(null, state)
      }
      if (signal?.aborted) { aborted(); return }
      idleWaiters.add(waiter)
      stops.push(subscribeWork(id, check), subscribeReady(changed => { if (changed === id) check() }), subscribeSettled(changed => { if (changed === id) check() }))
      signal?.addEventListener('abort', aborted, { once: true })
      timer = setTimeout(() => finish(new Error('脚本空闲等待超时，未执行事件仍保留')), Math.max(100, Number(timeoutMs) || executionTimeoutMs))
      // Register first, then recheck so a drain between dispatch and admission
      // cannot be lost. No polling or second work queue is involved.
      check()
    })
  }

  function dispose(sessionId, runtimeId = '') {
    const id = str(sessionId)
    if (runtimeId !== '' && presence.get(id)?.owner !== str(runtimeId)) return false
    if(presence.get(id)?.released&&presence.get(id)?.unload?.finished)return true
    retirePresence(id)
    for (const waiter of [...idleWaiters]) if (waiter.id === id) waiter.fail(new Error('脚本执行窗口已释放，未执行事件仍保留'))
    const record = records.get(id)
    if (!record) return true
    return resolveRecord(id, record, { handled: false, disposed: true, phase: record.phase, args: clone(record.event.args) })
  }

  function takeOver(sessionId,runtimeId){
    const id=str(sessionId),owner=str(runtimeId);if(!id||!owner||owner.length>200)throw new Error('脚本窗口身份无效')
    if(records.has(id)||presence.get(id)?.operations>0||drainLive(presence.get(id)))throw new Error('脚本事件或数据保存正在执行，请完成后再切换窗口')
    const abandoned=presence.get(id);if(abandoned?.draining)try{options.onDrainLost?.(id,{runtimeId:abandoned.owner,error:abandoned.drainError||'SP 保存窗口失联，未确认工作未重放；请检查恢复记录'})}catch{}
    presence.delete(id);return claim(id,owner,false,'',2)
  }

  function status(sessionId) {
    const current = presence.get(str(sessionId))
    const present = Boolean(current && !current.released && (drainLive(current)||now() - current.seenAt <= presenceTtlMs))
    const record = records.get(str(sessionId))
    return { present, ready: present && !current.resetRequired && current.ready === true, ...(present && !current.resetRequired && current.ready !== true && current.generalReady === true ? { generalReady: true } : {}), busy: Boolean(record || current?.displayWork && current.operations>0), phase: record ? record.phase : current?.draining?'draining':'idle', ...(current?.draining?{draining:true,...(current.drainError?{drainError:current.drainError}:{})}:{}),
      ...(present && current.mvuValidation?.cardPendingVersion===1?{cardMvuPendingVersion:1}:{}),
      ...(present && current.mvuValidation?.cardPendingScopeVersion===1?{cardMvuScopeVersion:1}:{}),
      ...(present && current.mvuValidation?.blocked ? {mvuValidationBlocked:true,mvuValidationReason:current.mvuValidation.reason} : {}),
      ...(present && current.initializationError ? { initializationError: current.initializationError } : {}) }
  }

  function needsReset(sessionId, runtimeId) { const current = presence.get(str(sessionId)); return current?.owner === str(runtimeId) && current.resetRequired === true }
  function invalidate(sessionId) {
    const id = str(sessionId), current = presence.get(id)
    if (current) { invalidateUnload(current);current.ready = false; current.generalReady = false; current.resetRequired = true }
    publishSignal(id, { kind: 'runtime-reset', version: String(++sequence) })
  }
  return Object.freeze({ touch, available,availableFrontend,heartbeat,subscribeWork,executingEvent,retainedOwner,runOwned,reserveDrain,beginOwnedSaveRecovery,finishOwnedSaveRecovery,issueUnloadTicket,acceptsUnloadTicket,voteUnload,reserveUnload,quarantine, mvuActivity, setMvuActivity, claim, takeOver, start, complete, dispatch, enqueueDisplayedMessage,displayedMessageTarget,cancelDisplayedMessage,subscribeReady, subscribeSettled,waitForIdle, dispose, status, invalidate, needsReset })
}
