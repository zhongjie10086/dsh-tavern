import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { appendTavernEvent, decodeTavernEvent } from './session-message-source.js'
import { sessionEvents } from './session-events.js'
import { authoredExecution, tavernAssistantTurn, createTavernTurnIndex } from './session-surface-edit.js'

const plugin = 'dsh-tavern-history-edit'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const isHistoryEditMarker = event => event?.type === 'user/message' && event.data?.source?.plugin === plugin
export function nativeHistoryItems(session) {
  const events=sessionEvents(session), bySeq=new Map(events.map(event=>[event.seq,event])),turnIndex=createTavernTurnIndex(events)
  return session.surface.nodes.map(seq=>{
    const event=bySeq.get(seq)
    return { event, message: structuredClone(event.type==='user/message'?event.data:event.data.message), logicalTurn: tavernAssistantTurn(event,events,turnIndex) }
  })
}

/** Plan an immutable suffix replacement. Native roles, attachments and tool pairs survive. */
export function planNativeHistoryEdit(session, items, { id=randomUUID() }={}) {
  const before=nativeHistoryItems(session), execution=authoredExecution(sessionEvents(session))
  if(!execution.ownsTurn)throw new Error('原生回合尚未结束，不能修改历史')
  let prefix=0
  while(prefix<before.length && prefix<items.length && before[prefix].event.seq===items[prefix].event?.seq && isDeepStrictEqual(before[prefix].message,items[prefix].message))prefix++
  if(prefix===before.length && prefix===items.length)return null
  // Validate the retained prefix as well as the replacement. Deleting a result
  // can otherwise leave its unchanged call outside the rebuilt suffix.
  const pending=new Set()
  for(const item of items){
    for(const block of item.message.content||[])if(block.type==='tool-call'){if(pending.has(block.id))throw Error('历史工具调用编号重复');pending.add(block.id)}
    if(item.event?.type==='tool/result'){
      const ids=new Set((item.message.content||[]).filter(block=>block.type==='tool-result').map(block=>block.toolCallId));if(item.message.source?.callId)ids.add(item.message.source.callId)
      if(!ids.size)throw Error('历史工具结果缺少调用编号');for(const id of ids){if(!pending.delete(id))throw Error('历史工具结果没有对应调用')}
    }
  }
  if(pending.size)throw Error('历史包含未配对的工具调用，不能单独删除或截断工具结果')
  // A replacement cannot split a native tool invocation from its results.
  while(prefix>0 && items[prefix]?.event?.type==='tool/result')prefix--
  const nodes=session.surface.nodes.slice(prefix), stages=[], mappings={}, bindings={}, calls=new Map()
  const turn=execution.turn; let step=0, open=false, turnOpen=false
  const add=(type,data,intent)=>stages.push({type,data,...intent?{intent}:{}})
  const openStep=()=>{ if(!turnOpen){add('turn/start',{turn});turnOpen=true} if(!open){add('step/start',{turn,step:++step});open=true} }
  const closeStep=()=>{if(open){if(calls.size)throw new Error('历史包含未配对的工具结果，无法提交');add('step/end',{turn,step});open=false}}
  for(const [index,item]of items.slice(prefix).entries()) {
    const message=structuredClone(item.message), oldId=message.id
    message.id='tavern-history:'+id+':'+index
    if(item.floorKey)bindings[item.floorKey]=message.id
    if(message.role==='user' && item.event?.type!=='tool/result') {
      closeStep();add('user/message',message,{surfaceOp:'append'})
    } else if(message.role==='system'||message.role==='developer') {
      openStep();add(message.role==='developer'?'developer/message':'system/message',{turn,step,message,...message.role==='developer'&&item.event?.data?.headerSeq!==undefined?{headerSeq:item.event.data.headerSeq}:{}},{surfaceOp:'append'})
    } else if(message.role==='assistant') {
      closeStep();openStep()
      const toolCalls=[]
      for(const block of message.content)if(block.type==='tool-call') {
        if(calls.has(block.id))throw new Error('历史工具调用编号重复')
        const prior=block.id, next='tavern-history-tool:'+id+':'+index+':'+toolCalls.length
        calls.set(prior,next);block.id=next;toolCalls.push(block)
      }
      mappings[message.id]=Number(item.logicalTurn)||0
      message.source={kind:'model',provider:'dsh-tavern',model:'history-edit'}
      add('assistant/message',{turn,step,message,stream:[]},{surfaceOp:'append'})
      for(const block of toolCalls)add('tool/call',{turn,step,callId:block.id,name:block.name,arguments:typeof block.arguments==='string'?block.arguments:JSON.stringify(block.arguments)})
    } else if(item.event?.type==='tool/result') {
      const oldCall=message.source?.callId, callId=calls.get(oldCall)
      if(!open||!callId)throw new Error('历史工具结果没有对应调用: '+oldId)
      message.source={...message.source,callId}
      if(session.header?.version>=4)message.toolCallId=callId
      for(const block of message.content)if(block.type==='tool-result')block.toolCallId=callId
      calls.delete(oldCall)
      add('tool/result',{...item.event?.data,turn,step,message},{surfaceOp:'append'})
    } else throw new Error('不支持的原生消息角色: '+message.role)
  }
  closeStep();if(turnOpen)add('turn/end',{turn,reason:{kind:'completed'}})
  const plan={version:1,id,sessionId:session.id,expectedSeq:session.seq,nodes,stages,mappings,bindings}
  return {...plan,digest:hash(plan)}
}

/** Resume an exact durable plan; neither the model nor historical tools are invoked. */
export async function synchronizeNativeHistoryEdit(session, plan, flush) {
  if(!plan)return false
  const {digest,...body}=plan
  if(plan.version!==1||plan.sessionId!==session.id||digest!==hash(body))throw new Error('历史操作记录校验失败')
  let events=sessionEvents(session), marker=events.find(e=>isHistoryEditMarker(e)&&e.data.id==='tavern-history-marker:'+plan.id)
  if(marker) {
    if(marker.data.source.digest!==digest)throw new Error('历史操作编号已经用于另一份内容')
  } else {
    if(session.seq<plan.expectedSeq || events.some(e=>e.seq>=plan.expectedSeq && e.type!=='session/end-seed') || !isDeepStrictEqual(plan.nodes.length?session.surface.nodes.slice(-plan.nodes.length):[],plan.nodes))throw new Error('模型上下文已变化，请重新读取历史')
    const intent=plan.nodes.length?{surfaceOp:{op:'replace',startSeq:plan.nodes[0],endSeq:plan.nodes.at(-1)},sourceEventSeqs:plan.nodes}:{surfaceOp:'append'}
    marker=appendTavernEvent(session,'user/message',{id:'tavern-history-marker:'+plan.id,role:'user',content:[],source:{kind:'plugin',plugin,digest,turnMappings:plan.mappings}},intent)
  }
  for(const [index,stage]of plan.stages.entries()) {
    events=sessionEvents(session)
    const existing=events.filter(e=>e.seq>marker.seq && e.type!=='session/end-seed')[index]
    const expected=decodeTavernEvent(stage)
    if(existing) {
      if(existing.type!==stage.type||!isDeepStrictEqual(existing.data,expected.data))throw new Error('未完成的历史操作被其他事件推进，拒绝重复提交')
    } else appendTavernEvent(session,stage.type,stage.data,stage.intent)
  }
  await flush(session)
  return true
}

/** The Chat renderer reads the immutable log; remove only explicitly replaced messages. */
export function projectNativeHistoryVisibility(session, chat = {}) {
  const events = sessionEvents(session), active = new Set(session?.surface?.nodes || [])
  const replaced = new Set(events.filter(event => isHistoryEditMarker(event) || event.type === 'user/message' && event.data?.source?.plugin === 'dsh-tavern-surface-edit').flatMap(event => event.sourceEventSeqs || []))
  const removedSeqs = events.filter(event => replaced.has(event.seq) && !active.has(event.seq)).map(event => event.seq)
  const messageTurns = {}, userTurns = {}, rows = new Map()
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  for (const [index, row] of messages.entries()) if (row.tavernNativeMessageId) rows.set(row.tavernNativeMessageId, Number(row.turn) || (row.greeting ? 1 : Number(messages.slice(index + 1).find(item => item.role === 'assistant')?.turn)) || 0)
  for (const event of events) {
    if (!active.has(event.seq)) continue
    if (event.type === 'assistant/message' && event.data.message.source?.provider === 'dsh-tavern' && ['history-edit','surface-edit'].includes(event.data.message.source.model)) messageTurns[event.data.message.id] = tavernAssistantTurn(event, events)
    else if (event.type === 'user/message' && rows.has(event.data.id)) userTurns[event.seq] = rows.get(event.data.id)
  }
  return { removedSeqs, messageTurns, userTurns }
}
