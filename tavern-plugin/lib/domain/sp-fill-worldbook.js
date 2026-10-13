import {worldbookSourceKey,privateWorldbookState} from './private-worldbooks.js'
import { exportSillyTavernWorldBook, inspectWorldBookDocument } from './worldbook-resource.js'
const clone=v=>structuredClone(v)
export function spWorldbookDocument(document,state,owner) {
 const result=exportSillyTavernWorldBook(document||{entries:{}}),entries={...result.entries};let uid=Math.max(-1,...Object.keys(entries).map(Number).filter(Number.isFinite))+1
 const existing=new Map();for(const [key,e]of Object.entries(entries))if(e.extensions?.dsh_sp_owner===owner){existing.set(e.extensions.dsh_sp_sheet,Number(key));delete entries[key]}
 for(const key of Object.keys(state.data).filter(k=>k.startsWith('sheet_'))){const table=state.data[key];if(table.exportConfig?.enabled===false)continue;const id=existing.get(key)??uid++
  entries[id]={uid:id,key:[table.name],keysecondary:[],comment:'SP·数据库 · '+table.name,content:JSON.stringify({name:table.name,content:table.content}),constant:table.exportConfig?.entryType==='constant',selective:true,disable:false,order:Number(table.orderNo)||100,position:0,extensions:{dsh_sp_owner:owner,dsh_sp_sheet:key}}
 }
 return {...result,entries}
}
export function filterSpWorldbookOwner(record,chat) {
 if(!record||!chat)return record;const raw=record.document||record.view?.raw;if(!raw?.entries)return record
 const list=Array.isArray(raw.entries)?raw.entries:Object.values(raw.entries);if(!list.some(e=>e.extensions?.dsh_sp_owner&&e.extensions.dsh_sp_owner!==chat.id))return record
 const data=clone(raw),keep=e=>!e.extensions?.dsh_sp_owner||e.extensions.dsh_sp_owner===chat.id
 data.entries=Array.isArray(data.entries)?data.entries.filter(keep):Object.fromEntries(Object.entries(data.entries).filter(([,e])=>keep(e)))
 return {...record,document:data,view:inspectWorldBookDocument(data,{filename:record.name||record.view?.name||''})}
}
export function projectSpWorldbookMirror(record,chat,state) {
 if(!record||!chat?.worldbookState?.spMirrors?.[worldbookSourceKey(record.source)])return record
 const document=spWorldbookDocument(record.document,state,chat.id)
 return {...record,document,view:inspectWorldBookDocument(document)}
}
export function removeSpWorldbookMirror(document,owner){
 const next=clone(document)
 if(next.entries&&!Array.isArray(next.entries))next.entries=Object.fromEntries(Object.entries(next.entries).filter(([,entry])=>entry.extensions?.dsh_sp_owner!==owner))
 return next
}
export function createSpFillWorldbook({chats,worldBooks,readCard,stateOf}) {
 const tails=new Map()
 async function execute(sessionId){
  const chat=await chats.forSession(sessionId);if(!chat)throw new Error('当前聊天不存在');const state=stateOf(chat),target=state.settings.fill.injectionTarget
  if(target==='chat')return {synced:false,reason:'本局直接使用数据库记忆'}
  await worldBooks.migrateChat(chat)
  const record=target==='bound'?await worldBooks.boundCard(chat.cardPath,await readCard(chat),chat):await worldBooks.getForChat(chat,{kind:'standalone',path:target})
  if(!record)throw Error('角色卡没有可写入的绑定世界书')
  const source=record.source,key=chat.id+':'+worldbookSourceKey(source),previous=tails.get(key)||Promise.resolve()
  const task=previous.catch(()=>{}).then(async()=>{
   const latest=await chats.forSession(sessionId)
   if(stateOf(latest).revision!==state.revision||stateOf(latest).settings.fill.injectionTarget!==target)throw new Error('表格或写入目标已变化，请重新同步')
   await chats.update(chat.id,async current=>{const next=stateOf(current);if(next.revision!==state.revision)throw Error('表格已变化，请重新同步')
    await worldBooks.migrateChat(current);await worldBooks.ensurePrivateBase(current,source)
    const local=clone(privateWorldbookState(current));local.spMirrors={...local.spMirrors,[worldbookSourceKey(source)]:{source,owner:'sp-database'}};local.revision++;current.worldbookState=local;current.cardContextSnapshotVersion=0;delete current.preparedWorldBook
    next.worldbookSync={at:Date.now(),target,name:record.view.displayName,status:'completed',storage:'derived'};current.spDatabase=next;return current
   },{source:'sp-worldbook.sync'})
   return {synced:true,target,name:record.view.displayName}
  });tails.set(key,task);try{return await task}finally{if(tails.get(key)===task)tails.delete(key)}
 }
 async function sync(sessionId){try{return await execute(sessionId)}catch(error){const chat=await chats.forSession(sessionId);if(chat)await chats.update(chat.id,current=>{const state=stateOf(current);state.worldbookSync={at:Date.now(),status:'failed',error:error.message};current.spDatabase=state;return current},{source:'sp-worldbook.sync-failed'});throw error}}
 return {sync}
}
