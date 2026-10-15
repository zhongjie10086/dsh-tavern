import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {readFile,rename,mkdir} from 'node:fs/promises'
import {createB5ShadowPageStore} from './b5-shadow-page-store.js'
import {createBufferedJsonRecords} from './b5-buffered-json-records.js'
import {createIncrementalJsonState} from './b5-incremental-json-state.js'
import {createChatResourceCodec} from './chat-resource-codec.js'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {canonicalChatId} from './chat-mutation-lock.js'
import {requiredChatStorageContract} from './chat-journal-store.js'
import {freezeJson} from './readonly-json.js'

export const pageDigest=value=>createHash('sha256').update(value).digest('hex')
const failure=(message,code='DSH_TAVERN_PAGE_CORRUPT')=>Object.assign(Error(message),{code})
const own=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true})
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value))
export async function writePageAuthority(files,target,value){
 const bytes=Buffer.from(JSON.stringify(value)+'\n'),result=await files.write(target,bytes)
 if(result.status!=='promoted'){
  // A deferred pending file must not become a later successful commit after
  // this mutation reported failure. Keep the uncommitted bytes for recovery.
  try{await rename(result.recoveryPath,target+'.unpublished-'+randomUUID())}catch(error){throw new AggregateError([failure('Page authority publication deferred','DSH_TAVERN_PAGE_DEFERRED'),error],'Cannot quarantine deferred authority')}
  throw failure('Page authority publication deferred; current authority unchanged','DSH_TAVERN_PAGE_DEFERRED')
 }
 const actual=await readFile(target)
 if(!actual.equals(bytes))throw failure('Published authority bytes differ')
}

/** Immutable encoded Chat graphs below the existing SP/resource/persistence
 * contracts. The per-chat route, not pageStore's construction pointer, is the
 * logical authority; a failed mutation can leave only unreachable graph data. */
export function createPageChatRecords({dataRoot,pageRoot='chats-v4',resourceCodec,promotionOptions={},onMetric,onPageIO}={}){
 const root=path.resolve(dataRoot,pageRoot),codec=resourceCodec===false?null:resourceCodec||createChatResourceCodec({dataRoot})
 const store=createB5ShadowPageStore({root,promotionOptions,onIO:event=>{onPageIO?.(event);onMetric?.(event)}}),files=createDurableFilePromotion(promotionOptions)
 const routePath=id=>path.join(root,canonicalChatId(id),'route.json')
 async function route(chatId,{required=false}={}){
  const id=canonicalChatId(chatId),bytes=await files.read(routePath(id))
  if(!bytes){if(required)throw failure('Missing selected page route: '+id);return undefined}
  const value=JSON.parse(bytes)
  if(value?.kind!=='tavern-chat-route-v1'||value.chatId!==id||!Number.isSafeInteger(value.generation)||value.generation<1||!value.revisionRoots||typeof value.revisionRoots!=='object'||Array.isArray(value.revisionRoots))throw failure('Invalid page route')
  if(typeof value.deleted!=='boolean'||!Number.isSafeInteger(value.storageRevision)||value.storageRevision<0||!value.revisionRoots[String(value.storageRevision)]||value.snapshotId!==value.revisionRoots[String(value.storageRevision)])throw failure('Page route current identity mismatch')
  for(const [revision,ref]of Object.entries(value.revisionRoots))if(!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))||!/^([a-f0-9]{64})$/.test(ref))throw failure('Invalid page revision map')
  return value
 }
 const tree=id=>createIncrementalJsonState({read:ref=>store.readRecord(id,ref),write:()=>{throw Error('Readonly page tree')}})
 async function pin(chatId,snapshotId){
  const id=canonicalChatId(chatId),head=await store.readHead(id,{snapshotId})
  if(!head||head.metadata?.kind!=='tavern-chat-records-v1'||head.metadata.chatId!==id||!Number.isSafeInteger(head.metadata.storageRevision)||!Array.isArray(head.metadata.keys))throw failure('Missing or invalid selected Chat root')
  return {id,head,snapshotId:head.snapshotCursor.snapshotId,storageRevision:head.metadata.storageRevision}
 }
 async function messageRefs(pinned){
  const pages=[];let cursor={snapshotId:pinned.snapshotId,before:pinned.head.messageCount}
  while(cursor){const page=await store.readHistoryPage(pinned.id,{cursor,limit:500});pages.unshift(page);cursor=page.previousCursor}
  const refs=[];for(const page of pages)for(const row of page.messages){if(row.position!==refs.length||typeof row.message.ref!=='string')throw failure('Noncontiguous page positions');refs.push(row.message.ref)}
  return refs
 }
 function wrapped(pinned,body){return pinned.head.metadata.resourceEncoding===3?{$dshVersionedChat:1,_storageRevision:pinned.storageRevision,value:body}:body}
 async function decode(pinned,body){const value=wrapped(pinned,body);return codec?codec.decodeChat(value):body}
 async function readSnapshot(chatId,snapshotId){
  const pinned=await pin(chatId,snapshotId),reader=tree(pinned.id),header=await reader.get(pinned.head.state.headerRef),refs=await messageRefs(pinned),messages=[]
  for(const ref of refs)messages.push(await reader.get(ref))
  const body={};for(const key of pinned.head.metadata.keys)own(body,key,key==='messages'?messages:header[key])
  const encoded=wrapped(pinned,body)
  if(pageDigest(JSON.stringify(encoded))!==pinned.head.metadata.encodedSha256)throw failure('Encoded Chat closure hash mismatch')
  const chat=await decode(pinned,body);requiredChatStorageContract(chat)
  if(chat?._storageRevision!==pinned.storageRevision||canonicalChatId(chat.id)!==pinned.id)throw failure('Decoded Chat identity mismatch')
  return freezeJson(chat)
 }
 async function prepare(chatId,value,{beforePublish}={}){
  const id=canonicalChatId(chatId);requiredChatStorageContract(value)
  if(!value||typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value._storageRevision)||value._storageRevision<0||canonicalChatId(value.id)!==id||Object.hasOwn(value,'messages')&&!Array.isArray(value.messages))throw Error('Invalid complete Chat for page commit')
  const encoded=codec?await codec.encodeChat(value):clone(value),body=codec?encoded.value:encoded,keys=Object.keys(body),header={}
  for(const key of keys)if(key!=='messages')own(header,key,body[key])
  const buffered=createBufferedJsonRecords({read:ref=>store.readRecord(id,ref),writeMany:values=>store.writeRecords(id,values)})
  const headerRef=await buffered.tree.create(header),refs=[]
  for(const message of body.messages||[])refs.push(await buffered.tree.create(message))
  await buffered.flush([headerRef,...refs])
  const metadata={kind:'tavern-chat-records-v1',chatId:id,storageRevision:value._storageRevision,keys,resourceEncoding:codec?3:0,encodedSha256:pageDigest(JSON.stringify(encoded))}
  const previous=await store.readHead(id),verifyBeforePublish=async snapshotId=>{
   const restored=await readSnapshot(id,snapshotId)
   const expected=codec?codec.logical(value):value
   if(JSON.stringify(restored)!==JSON.stringify(expected))throw failure('Page Chat roundtrip differs')
   await beforePublish?.({snapshotId})
  }
  let result
  if(!previous)result=await store.create(id,{state:{headerRef},metadata,messages:refs.map(ref=>({ref}))},{verifyBeforePublish})
  else{
   const old=await messageRefs(await pin(id,previous.snapshotCursor.snapshotId)),common=Math.min(old.length,refs.length),edits=[]
   for(let position=0;position<common;position++)if(old[position]!==refs[position])edits.push({position,message:{ref:refs[position]}})
   result=await store.commit(id,{expectedRevision:previous.revision,state:{headerRef},metadata,edits,truncateTo:common,append:refs.slice(common).map(ref=>({ref}))},{verifyBeforePublish})
  }
  // A construction head is not authoritative until the caller publishes route.
  await readSnapshot(id,result.snapshotId)
  return {...result,storageRevision:value._storageRevision}
 }
 async function publish(chatId,value){await mkdir(path.dirname(routePath(chatId)),{recursive:true});await writePageAuthority(files,routePath(chatId),value)}
 async function readField(pinned,pointer){
  const parts=pointer.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~')),key=parts.shift(),body={}
  own(body,'id',pinned.id);own(body,'_storageRevision',pinned.storageRevision)
  const encoded=await tree(pinned.id).get(pinned.head.state.headerRef,'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'))
  if(encoded===undefined)return undefined
  own(body,key,encoded);let value=(await decode(pinned,body))[key]
  for(const part of parts){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return undefined;value=value[part]}
  return value
 }
 async function readMessages(pinned,indices){
  const rows=[]
  for(const index of indices){const page=await store.readHistoryPage(pinned.id,{cursor:{snapshotId:pinned.snapshotId,before:index+1},limit:1}),row=page.messages[0]
   if(row?.position!==index)throw failure('Selected message position mismatch')
   const raw=await tree(pinned.id).get(row.message.ref),decoded=await decode(pinned,{id:pinned.id,_storageRevision:pinned.storageRevision,messages:[raw]})
   rows.push({message_id:index,message:decoded.messages[0]})
  }
  return rows
 }
 return Object.freeze({root,route,routePath,pin,prepare,publish,readSnapshot,readField,readMessages,store})
}
