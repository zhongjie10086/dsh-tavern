import {createHash} from 'node:crypto'
import {boundDisplayCaptures} from './display-capture-budget.js'

export function displayMessageIdentity(chat,message){
 return JSON.stringify([chat.id,chat.sessionId,Number(chat.tavernHelperLifecycleRevision)||0,message.turn,message.tavernHistoryKey||message.id||'',
  createHash('sha256').update(JSON.stringify([message.text,message.sourceText,message.displayText,message.swipeId])).digest('hex')])
}
const locator=frame=>JSON.stringify([Number(frame.partIndex)||0,String(frame.panelId||'')])

/** Captured DOM is diagnostic evidence, not a durable part of the story. */
export function createDisplayDiagnostics({maxBytes=16*1024*1024,maxFrames=128}={}){
 const rows=new Map();let bytes=0
 function remove(key){const row=rows.get(key);if(row){bytes-=row.bytes;rows.delete(key)}}
 function put(chat,message,frame){
  boundDisplayCaptures([frame])
  const identity=displayMessageIdentity(chat,message),key=JSON.stringify([identity,locator(frame)])
  const copy=structuredClone(frame),size=Buffer.byteLength(JSON.stringify(copy));remove(key)
  if(size>maxBytes)return
  rows.set(key,{identity,frame:copy,bytes:size});bytes+=size
  while(rows.size>maxFrames||bytes>maxBytes)remove(rows.keys().next().value)
 }
 function read(chat,message){
  const identity=displayMessageIdentity(chat,message),saved=message.displayRuntime
  const frames=new Map((saved?.frames||[]).map(frame=>[locator(frame),frame]))
  for(const row of rows.values())if(row.identity===identity)frames.set(locator(row.frame),row.frame)
  if(!frames.size)return null
  return {version:2,sourceActivityAt:saved?.sourceActivityAt,frames:boundDisplayCaptures([...frames.values()]).map(frame=>{
   const available=Object.hasOwn(frame,'dom')||Object.hasOwn(frame,'console')||Object.hasOwn(frame,'errors')||Object.hasOwn(frame,'network')
   return {...structuredClone(frame),...(available?{}:{status:'仅保留定位信息；运行证据已过期或服务已重启，请重新打开页面采集。'})}
  })}
 }
 return {put,read,stats:()=>({frames:rows.size,bytes})}
}
