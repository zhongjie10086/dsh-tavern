import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'

/** Preserve native multimodal blocks and provenance across upstream template insertion. */
export function projectTemplateMessages(messages) {
  return messages.map((message, index) => ({
    role: message.role, content: structuredClone(message.content || []), dshMessageIndex: index
  }))
}
export function restoreTemplateMessages(originals, messages) {
  if (!Array.isArray(messages)) throw new Error('模板返回的消息列表无效')
  return messages.map(message => {
    if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('模板返回的消息角色无效')
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : structuredClone(message.content)
    if (!Array.isArray(content) || content.some(block => !block || typeof block.type !== 'string')) throw new Error('模板返回的消息内容无效')
    const original = Number.isSafeInteger(message.dshMessageIndex) ? originals[message.dshMessageIndex] : undefined
    return original ? { ...original, role: message.role, content } : { id: randomUUID(), role: message.role, content }
  })
}
export function createFullTemplateRequestProcessor(execute) {
  const prepared=new WeakSet(),objects=new WeakMap(),sessions=new Map()
  return {
    has:request=>prepared.has(request),
    clear:sessionId=>sessions.delete(sessionId),
    async prepare(sessionId,request,identity) {
      if(prepared.has(request))return request
      const digest=createHash('sha256').update(JSON.stringify([request.system,request.messages])).digest('hex')
      const key=identity===undefined?null:JSON.stringify([identity,digest])
      let entries=sessions.get(sessionId)
      if(key&&!entries){entries=new Map();sessions.set(sessionId,entries);if(sessions.size>8)sessions.delete(sessions.keys().next().value)}
      let operation=objects.get(request)||entries?.get(key)
      if(!operation) {
        operation=(async()=>{
          const messages=projectTemplateMessages(request.messages)
          if(typeof request.system==='string'&&request.system)messages.unshift({role:'system',content:request.system})
          const result=await execute(sessionId,{kind:'request',messages},{signal:request.signal})
          return restoreTemplateMessages(request.messages,structuredClone(result.messages))
        })()
        objects.set(request,operation)
        if(key){entries.set(key,operation);while(entries.size>2)entries.delete(entries.keys().next().value)}
      }
      const messages=await operation
      if(request.signal?.aborted)throw request.signal.reason||new Error('模板请求已取消')
      const next={...request,messages:structuredClone(messages)}
      delete next.system;prepared.add(next);return next
    }
  }
}
