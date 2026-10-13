import { encodeTavernMessage } from '../tavern-plugin/lib/domain/session-message-source.js'

import { authoredExecution } from '../tavern-plugin/lib/domain/session-surface-edit.js'

const SUPPORTED = new Set(['permission/preset','sandbox/mode','approval/policy','agent-preset/selected','subagent/descriptor',
  'user/message','assistant/message','assistant/chunk','tool/call','tool/result','agent/inbox/spliced',
  'turn/start','step/start','step/end','turn/end','request/header','request/context','session/title',
  'session/title-llm-request','model/selection','session/end-seed','dsh-tavern/stable-prefix','dsh-tavern/duplicate-stable-prefix'])
const clone = value => structuredClone(value)
function canonicalMessage(value) {
  const message = clone(value), source = message.source
  if (source?.kind === 'model' && source.provider === 'dsh-tavern') {
    message.source = {kind:'model',provider:source.provider,model:source.model,...source.replayState ? {replayState:source.replayState}:{}}
  }
  if (source?.kind === 'user' && source.importSource) delete message.source.importSource
  return encodeTavernMessage(message)
}
/**
 * Upgrade the Tavern-authored v0 dialect into native v3 events. The caller keeps
 * the original artifact, verifies both model transcripts and a native disk
 * roundtrip, and publishes the new directory only after every session passes.
 * Unknown event vocabulary is refused, never silently dropped.
 */
export function migrateTavernV0(artifact, { cwd, Session, AssistantStreamAccumulator }) {
  if (artifact.meta?.version !== 0) throw new Error('此转换器只处理已审计的 Tavern v0 存档')
  const header = {...artifact.meta,version:3,cwd},events=[],map=[],nodes=[]
  let systemSeq,systemText='',inheritedEventCount=0,seedTurnStart,hasSeedAssistant=false
  const streams=new Map(),bySeq=new Map(artifact.events.map(e=>[e.seq,e]))
  const append=(type,data,intent,time,ignorable)=>{
    const event={type,seq:events.length,time,data,...intent,...ignorable?{ignorable:true}:{}}
    if(intent?.surfaceOp==='append')nodes.push(event.seq)
    else if(intent?.surfaceOp?.op==='replace'){
      const a=nodes.indexOf(intent.surfaceOp.startSeq),b=nodes.indexOf(intent.surfaceOp.endSeq)
      if(a<0||b<a)throw new Error('迁移遇到无效的消息替换区间')
      nodes.splice(a,b-a+1,event.seq)
    }
    events.push(event);return event
  }
  const ref=n=>{if(!Number.isSafeInteger(n)||map[n]===undefined)throw new Error('迁移遇到未知历史引用 '+n);return map[n]}
  for(const old of artifact.events) {
    if(!SUPPORTED.has(old.type))throw new Error('尚未审计的 Tavern 事件：'+old.type)
    if(old.seq!==map.length)throw new Error('旧存档事件不连续')
    let type=old.type,data=clone(old.data),intent,ignorable=old.ignorable===true,authored
    if(header.isSeeded && old.seq===artifact.inheritedEventCount) { inheritedEventCount=events.length; append('session/end-seed',{inherited:true},undefined,old.time) }
    if (type==='turn/start' && data.turn===1 && hasSeedAssistant) { map.push(seedTurnStart); continue }
    if (hasSeedAssistant && data.turn===1 && Number.isSafeInteger(data.step)) data.step++
    const op=old.surfaceOp
    if(op==='append')intent={surfaceOp:'append'}
    else if(op?.op==='replace')intent={surfaceOp:{op:'replace',startSeq:ref(op.start),endSeq:ref(op.end)}}
    if(old.sourceEventSeqs?.length&&type!=='assistant/message')intent={...intent,sourceEventSeqs:old.sourceEventSeqs.map(ref)}
    if(type==='assistant/chunk') {
      const key=data.turn+':'+data.step
      const list=streams.get(key)||[];list.push({time:old.time,chunk:data.chunk});streams.set(key,list)
      // Preserve every original timestamp and failed/unsettled attempt as opaque
      // diagnostic events as well as the successful embedded provider streams.
      ignorable=true
    } else if(type==='assistant/message') {
      const seed = data.message?.source?.model==='synthetic-trajectory' && /^tavern-seed-trajectory:/.test(data.message.id||'')
      if (seed) {
        if (hasSeedAssistant) throw new Error('重复的初始化回复')
        seedTurnStart=append('turn/start',{turn:1},undefined,old.time).seq
        append('step/start',{turn:1,step:1},undefined,old.time)
        hasSeedAssistant=true
      }
      data.message=canonicalMessage(data.message)
      data.turn=Math.max(1,data.turn)
      const accumulator=new AssistantStreamAccumulator()
      const chunks=Array.isArray(old.sourceEventSeqs) ? old.sourceEventSeqs.map(seq=>bySeq.get(seq)).filter(e=>e?.type==='assistant/chunk').map(e=>({time:e.time,chunk:e.data.chunk})) : streams.get(old.data.turn+':'+old.data.step)||[]
      for(const timed of chunks)accumulator.push(timed)
      data.stream=accumulator.snapshot()
      if (seed) data.step=1
      if(op?.op==='replace'){
        const first=nodes.indexOf(intent.surfaceOp.startSeq),last=nodes.indexOf(intent.surfaceOp.endSeq)
        if(first<0||last!==nodes.length-1)throw new Error('历史正文替换不是完整尾部，拒绝改变消息顺序')
        authored=data.message.content.length ? authoredExecution(events) : null
        const marker=append('user/message',encodeTavernMessage({id:'tavern-surface-edit:'+data.message.id,role:'user',content:[],
          source:{kind:'plugin',plugin:'dsh-tavern-surface-edit',replacement:{...data,stream:[]},...authored?{execution:authored}:{}}}),
          {...intent,sourceEventSeqs:nodes.slice(first)},old.time)
        if(!data.message.content.length){map.push(marker.seq);continue}
        if(authored.ownsTurn)append('turn/start',{turn:authored.turn},undefined,old.time)
        if(authored.ownsStep)append('step/start',{turn:authored.turn,step:authored.step},undefined,old.time)
        data={...data,turn:authored.turn,step:authored.step,stream:[],message:{...data.message,source:{kind:'model',provider:'dsh-tavern',model:'surface-edit'}}}
      }
      intent={surfaceOp:'append'}
    } else if(type==='user/message')data=canonicalMessage(data)
    else if(type==='agent/inbox/spliced')data.inserted=data.inserted.map(canonicalMessage)
    else if(type==='request/header'){
      const next=data.header.system||''
      const turn=artifact.events.slice(0,old.seq).findLast(e=>e.type==='step/start')?.data||{turn:1,step:1}
      if(systemSeq===undefined||next!==systemText){
        const event=append('system/message',{turn:turn.turn,step:turn.step,message:{id:'tavern-upgrade-system:'+header.id+':'+old.seq,role:'system',
          content:next?[{type:'text',text:next}]:[],source:{kind:'plugin',plugin:'@deepseek-ai/dsh-system-prompt'}}},
          systemSeq===undefined?{surfaceOp:'append'}:{surfaceOp:{op:'replace',startSeq:systemSeq,endSeq:systemSeq},sourceEventSeqs:[systemSeq]},old.time)
        systemSeq=event.seq;systemText=next
      }
      delete data.header.system
    } else if(type==='session/title'||type==='session/title-llm-request'){
      if(data.messageSeqs)data.messageSeqs=data.messageSeqs.map(ref)
      if(data.messages)data.messages=data.messages.map(canonicalMessage)
    } else if(type==='session/end-seed')delete data.inherited
    const event=append(type,data,intent,old.time,ignorable)
    map.push(event.seq)
    if(authored?.ownsStep)append('step/end',{turn:authored.turn,step:authored.step},undefined,old.time)
    if(authored?.ownsTurn)append('turn/end',{turn:authored.turn,reason:{kind:'completed'}},undefined,old.time)
    if (type==='assistant/message' && data.message.source?.model==='synthetic-trajectory') append('step/end',{turn:1,step:1},undefined,old.time)
  }
  if(hasSeedAssistant && !events.some(event=>event.type==='turn/end' && event.data.turn===1)) append('turn/end',{turn:1,reason:{kind:'completed'}},undefined,events.at(-1)?.time||header.createdAt)
  if(header.isSeeded && artifact.inheritedEventCount===artifact.events.length) { inheritedEventCount=events.length; append('session/end-seed',{inherited:true},undefined,artifact.events.at(-1)?.time||header.createdAt) }
  if(header.isSeeded) {
    // The inherited marker belongs to the child, exactly at its transformed cut.
    const marker=events[inheritedEventCount]
    if(marker?.type==='session/end-seed')marker.data.inherited=true
    else throw new Error('无法确认分支的继承边界')
  } else inheritedEventCount=0
  Session.fromRestore(header.id,events,header,inheritedEventCount,'detached')
  return {header,events,inheritedEventCount,seqMap:map}
}
