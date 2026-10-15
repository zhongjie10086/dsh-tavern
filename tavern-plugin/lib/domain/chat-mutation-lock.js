import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'

const tails=new Map(),locks=createDurableFilePromotion()
export function canonicalChatId(value){
 const id=String(value||'')
 if(!id||id==='.'||id==='..'||/[\\/\0]/.test(id))throw Error('Tavern Chat ID 不合法')
 return process.platform==='win32'?id.toLowerCase():id
}
// Both journal and page writers use the original journal lock target, outside
// the removable chat directory. No adapter calls a locking writer under this.
export function withChatMutation(dataRoot,chatId,operation){
 const target=path.resolve(dataRoot,'chats',canonicalChatId(chatId)),key=process.platform==='win32'?target.toLowerCase():target
 const previous=tails.get(key)||Promise.resolve()
 const current=previous.catch(()=>{}).then(()=>locks.withLock(target,operation,{waitMs:30000}))
 tails.set(key,current)
 return current.finally(()=>{if(tails.get(key)===current)tails.delete(key)})
}
