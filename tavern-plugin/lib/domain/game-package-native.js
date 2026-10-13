import {isDeepStrictEqual} from 'node:util'
/** Use rc.2 public restore contracts. Original events retain every sequence position. */
export function createGamePackageNative({sessions,persistence,agents,cwd,workspaces}) {
 async function capture(id){
  const session=sessions.get(id)||agents.get(id)?.session
  if(session){await sessions.flush(session);return {header:structuredClone(session.header),inheritedEventCount:session.inheritedEventCount,events:structuredClone(session.snapshotEvents())}}
  let handle
  try{handle=await persistence.open(id,'read');const record=await handle.read();return {header:structuredClone(handle.header),inheritedEventCount:handle.inheritedEventCount,events:structuredClone(record.events)}}
  catch(error){if(error.name==='SessionPersistenceNotFoundError')return null;throw error}
  finally{await handle?.close()}
 }
 function options(record,mapping){
  const header={...structuredClone(record.header),id:mapping[record.header.id],cwd:cwd(),agentPreset:record.header.agentPreset||'tavern'}
  if(header.parentSession){if(mapping[header.parentSession])header.parentSession=mapping[header.parentSession];else delete header.parentSession}
  return {seed:structuredClone(record.events),meta:header,inheritedEventCount:record.inheritedEventCount||0,eventState:'detached'}
 }
 function sameHistory(actual,record){
  if(!actual||!isDeepStrictEqual(actual.events.slice(0,record.events.length),record.events))return false
  const tail=actual.events.slice(record.events.length)
  // rc.2 appends its replay delimiter on restore, without changing source events.
  return tail.length===0||tail.length===1&&tail[0].seq===record.events.length&&tail[0].type==='session/end-seed'&&isDeepStrictEqual(tail[0].data,{})
 }
 async function validate(records,mapping){for(const record of records)if(!sessions.get(mapping[record.header.id]))sessions.prepare(mapping[record.header.id],options(record,mapping))}
 async function restore(record,mapping){
  const id=mapping[record.header.id],existing=await capture(id),configuration=options(record,mapping)
  if(existing&&sameHistory(existing,record))return
  if(existing&&!isDeepStrictEqual(existing.events,record.events.slice(0,existing.events.length)))throw Error('整局导入的原生历史已被修改，不能重复写入')
  let handle
  try{
   handle=existing?await persistence.open(id,'write'):await persistence.create(configuration.meta,{inheritedEventCount:configuration.inheritedEventCount})
   const offset=existing?.events.length||0
   await handle.append(record.events.slice(offset));await handle.flush()
   const read=await handle.read()
   if(!isDeepStrictEqual(read.events,record.events))throw Error('整局原生历史回读不一致')
  }finally{await handle?.close()}
  if(!sameHistory(await capture(id),record))throw Error('整局原生历史未持久化')
 }

 async function attach(id){
  const registry=typeof workspaces==='function'?workspaces():workspaces
  if(!registry)throw Error('宿主工作区服务尚未就绪')
  const workspace=await registry.create(cwd(),'酒馆');await workspace.attachSession(id)
 }
 return {capture,restore,validate,attach}
}
