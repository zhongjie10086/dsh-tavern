import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {isDeepStrictEqual} from 'node:util'
import {createChatJournalStore,requiredChatStorageContract} from './chat-journal-store.js'
import {createStorageFormat} from './storage-format.js'
import {createPageChatRecords,pageDigest} from './page-chat-records.js'
import {withChatMutation,canonicalChatId} from './chat-mutation-lock.js'
import {freezeJson,isFrozenJson} from './readonly-json.js'
import {mutableJsonDraft,finishJsonDraft} from './json-draft.js'

const fail=(message,code='DSH_TAVERN_PAGE_CORRUPT')=>Object.assign(Error(message),{code})
const missing=()=>fail('Exact Chat revision not found','DSH_TAVERN_REVISION_NOT_FOUND')
const own=(value,key)=>Object.hasOwn(value,key)
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value))
const allowedKind=value=>!['chat-fields','chat-window','chat-slice'].includes(value?.kind)
function pointerParts(pointer){if(typeof pointer!=='string'||!pointer.startsWith('/')||/~(?![01])/.test(pointer))throw Error('Explicit valid JSON field pointer required');const parts=pointer.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));if(parts[0]==='messages')throw Error('History requires window/slice');return parts}
function lookup(value,parts){for(const key of parts){if(value===null||typeof value!=='object'||!own(value,key))return undefined;value=value[key]}return value}

export async function readChatRouteManifest(dataRoot,marker){
 const bytes=await readFile(path.join(dataRoot,marker.routeManifest))
 if(pageDigest(bytes)!==marker.routeManifestSha256)throw fail('Immutable route manifest checksum mismatch')
 const manifest=JSON.parse(bytes)
 if(manifest?.kind!=='tavern-chat-routes-v1'||manifest.migrationId!==marker.migrationId||!manifest.chats||typeof manifest.chats!=='object'||Array.isArray(manifest.chats))throw fail('Invalid selected route manifest')
 return freezeJson(manifest)
}

/** Journal-position records adapter. Format3 remains the default; only an
 * explicitly published format4 marker selects page authority. SP wraps this,
 * and chatPersistence still owns merging/logical revisions and draft refresh. */
export function createChatRecordsStore(options={}){
 const dataRoot=path.resolve(options.dataRoot||''),legacy=createChatJournalStore(options),pages=createPageChatRecords(options),format=createStorageFormat(dataRoot,{maximumVersion:4}),protectors=new Set(),cache=new Map(),legacySnapshotIds=new WeakMap()
 async function mode(){
  const marker=await format.read()
  if(marker?.formatVersion!==4)return {format:3}
  const manifest=await readChatRouteManifest(dataRoot,marker)
  return {format:4,marker,manifest}
 }
 async function selected(id,selection){
  selection ||= await mode()
  const canonical=canonicalChatId(id)
  const route=await pages.route(canonical,{required:own(selection.manifest.chats,canonical)})
  if(route&&route.migrationId!==selection.marker.migrationId)throw fail('Per-chat route belongs to another migration')
  return route
 }
 async function readReadonly(id){
  const current=await mode();if(current.format===3)return legacy.readReadonly(id)
  const route=await selected(id,current);if(!route||route.deleted)return undefined
  const key=canonicalChatId(id)+':'+route.snapshotId
  if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return value}
  const value=await pages.readSnapshot(id,route.snapshotId)
  if(value._storageRevision!==route.storageRevision)throw fail('Route logical revision differs from root')
  cache.set(key,value);while(cache.size>8)cache.delete(cache.keys().next().value)
  return value
 }
 const read=async id=>mutableJsonDraft(await readReadonly(id))
 async function readRevision(id,revision){
  if(!Number.isSafeInteger(Number(revision))||Number(revision)<0)throw Error('Invalid Chat revision')
  const current=await mode();if(current.format===3)return legacy.readRevision(id,revision)
  const route=await selected(id,current);if(!route||route.deleted)return undefined
  const snapshot=route.revisionRoots[String(revision)];if(!snapshot)throw missing()
  const value=await pages.readSnapshot(id,snapshot);if(value._storageRevision!==Number(revision))throw fail('Historical root logical identity mismatch')
  return mutableJsonDraft(value)
 }
 async function update(id,updater,metadata={}){
  metadata.signal?.throwIfAborted();if(typeof updater!=='function')throw Error('Missing Chat updater')
  const initial=await mode();if(initial.format===3)return legacy.update(id,async value=>{const produced=await updater(value);if(!allowedKind(produced))throw Error('Partial Chat projection cannot be written');return produced},metadata)
  return withChatMutation(dataRoot,id,async()=>{
   const currentMode=await mode();if(currentMode.format!==4)throw fail('Storage format changed during mutation')
   const route=await selected(id,currentMode),stored=route&&!route.deleted?await pages.readSnapshot(id,route.snapshotId):undefined
   metadata.signal?.throwIfAborted()
   let produced=finishJsonDraft(await updater(mutableJsonDraft(stored)))
   metadata.signal?.throwIfAborted()
   if(produced===undefined)return metadata.readonlyResult?stored:mutableJsonDraft(stored)
   if(!allowedKind(produced))throw Error('Partial Chat projection cannot be written')
   produced=clone(produced)
   if(stored?.tavernCardMvuContract===1&&produced.tavernCardMvuContract===undefined)produced.tavernCardMvuContract=1
   requiredChatStorageContract(produced)
   if(stored&&isDeepStrictEqual(stored,produced))return metadata.readonlyResult?stored:mutableJsonDraft(stored)
   if(stored&&produced._storageRevision!==stored._storageRevision+1)throw Error('Page Chat logical revision must be consecutive')
   const prepared=await pages.prepare(id,produced,{beforePublish:async()=>{metadata.signal?.throwIfAborted();await options.beforePagePublish?.(id)}})
   metadata.signal?.throwIfAborted()
   const next={kind:'tavern-chat-route-v1',chatId:canonicalChatId(id),migrationId:currentMode.marker.migrationId,generation:(route?.generation||0)+1,storageRevision:prepared.storageRevision,snapshotId:prepared.snapshotId,revisionRoots:{...route?.revisionRoots,[String(prepared.storageRevision)]:prepared.snapshotId},deleted:false}
   await options.beforeRoutePublish?.(id,next)
   await pages.publish(id,next)
   const saved=await pages.readSnapshot(id,prepared.snapshotId)
   return metadata.readonlyResult?saved:mutableJsonDraft(saved)
  })
 }
 async function version(id){const current=await mode();if(current.format===3)return legacy.version(id);const route=await selected(id,current);return route?`page:${current.marker.migrationId}:${route.generation}:${route.deleted?'deleted':route.snapshotId}`:''}
 async function remove(id){const initial=await mode();if(initial.format===3)return legacy.remove(id);return withChatMutation(dataRoot,id,async()=>{const current=await mode();if(current.format!==4)throw fail('Storage format changed');const route=await selected(id,current);if(route&&!route.deleted)await pages.publish(id,{...route,generation:route.generation+1,deleted:true})})}
 function protectRevisions(provider){protectors.add(provider);const release=legacy.protectRevisions(provider);return ()=>{protectors.delete(provider);release()}}
 async function retentionInputs(id){const current=await mode();if(current.format===3)return legacy.retentionInputs(id);const chat=options.protectedRevisions&&options.protectedRevisionsUsesChat!==false?await readReadonly(id):undefined;return {id,protectedRevisions:[...[...protectors].flatMap(fn=>fn(id)),...await options.protectedRevisions?.(id,chat)||[]]}}
 async function prune(id,settings={}){const initial=await mode();if(initial.format===3)return legacy.prune(id,settings);return withChatMutation(dataRoot,id,async()=>{await mode();return {dryRun:settings.dryRun!==false,files:[],bytes:0,protected:['format4-no-gc',...(await retentionInputs(id)).protectedRevisions]}})}
 async function migrateResources(id){const initial=await mode();if(initial.format===3)return legacy.migrateResources(id);return withChatMutation(dataRoot,id,async()=>{const chat=await readReadonly(id);return {chatId:id,revision:chat?._storageRevision,files:0,changed:0,bytesBefore:0,bytesAfter:0,alreadyEncoded:true,historyRetained:true}})}
 async function revisions(id){const current=await mode();if(current.format===3)return legacy.revisions(id);const route=await selected(id,current);return route&&!route.deleted?Object.keys(route.revisionRoots).map(Number).sort((a,b)=>a-b):[]}
 async function pin(id,options={}){
  const current=await mode(),canonical=canonicalChatId(id)
  if(current.format===3){
   const latest=await legacy.readReadonly(id),chat=options.pinnedRevision===undefined||latest?._storageRevision===options.pinnedRevision?latest:await legacy.readRevision(id,options.pinnedRevision)
   if(!chat)return undefined
   let snapshotId=isFrozenJson(chat)?legacySnapshotIds.get(chat):undefined
   if(!snapshotId){snapshotId='legacy-'+pageDigest(JSON.stringify(chat));if(isFrozenJson(chat))legacySnapshotIds.set(chat,snapshotId)}
   if(options.snapshotId!==undefined&&snapshotId!==options.snapshotId)throw fail('Pinned legacy snapshot mismatch')
   return {chatId:canonical,storageRevision:chat._storageRevision||0,snapshotId,messageCount:chat.messages?.length||0,field:path=>lookup(chat,pointerParts(path)),messages:indices=>indices.map(message_id=>({message_id,message:chat.messages[message_id]}))}
  }
  const route=await selected(id,current);if(!route||route.deleted)return undefined
  const revision=options.pinnedRevision??route.storageRevision,snapshotId=route.revisionRoots[String(revision)]
  if(!snapshotId)throw missing();if(options.snapshotId!==undefined&&options.snapshotId!==snapshotId)throw fail('Pinned page snapshot mismatch')
  const pinned=await pages.pin(id,snapshotId);if(pinned.storageRevision!==revision)throw fail('Pinned logical revision mismatch')
  return {chatId:canonical,storageRevision:revision,snapshotId,messageCount:pinned.head.messageCount,field:path=>pages.readField(pinned,path),messages:indices=>pages.readMessages(pinned,indices)}
 }
 const identity=p=>({chatId:p.chatId,storageRevision:p.storageRevision,snapshotId:p.snapshotId})
 async function fieldsAt(p,paths=[]){if(!Array.isArray(paths)||new Set(paths).size!==paths.length)throw Error('Unique field paths required');const rows=[];for(const path of paths){pointerParts(path);const value=await p.field(path);rows.push({path,found:value!==undefined,...value===undefined?{}:{value}})}return rows}
 async function readFields(id,options={}){if(!options.paths?.length)throw Error('Explicit field paths required');const p=await pin(id,options);if(!p)return undefined;return freezeJson({kind:'chat-fields',...identity(p),messageCount:p.messageCount,fields:await fieldsAt(p,options.paths)})}
 function indexOf(index,count,{end=false}={}){const n=index==='latest'?(end?count:count-1):index<0?count+index:index;if(!Number.isSafeInteger(n)||n<0||n>count-(end?0:1))throw Error('Absolute message index out of pinned snapshot');return n}
 async function readMessageWindow(id,options={}){
  const limit=options.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw Error('Window limit must be 1..500')
  const cursor=options.cursor;if(cursor&&(cursor.kind!=='chat-window-cursor'||cursor.chatId!==canonicalChatId(id)||options.before!==undefined))throw Error('Invalid or mixed window cursor')
  if(cursor&&(options.pinnedRevision!==undefined&&options.pinnedRevision!==cursor.storageRevision||options.snapshotId!==undefined&&options.snapshotId!==cursor.snapshotId))throw Error('Cursor and explicit pin differ')
  const p=await pin(id,cursor?{...options,pinnedRevision:cursor.storageRevision,snapshotId:cursor.snapshotId}:options);if(!p)return undefined
  if(cursor&&cursor.messageCount!==p.messageCount)throw fail('Cursor message count mismatch')
  const to=indexOf(cursor?cursor.before:options.before??'latest',p.messageCount,{end:true}),from=Math.max(0,to-limit)
  return freezeJson({kind:'chat-window',...identity(p),messageCount:p.messageCount,from,to,messages:await p.messages(Array.from({length:to-from},(_,n)=>from+n)),fields:await fieldsAt(p,options.fields),previousCursor:from?{kind:'chat-window-cursor',...identity(p),messageCount:p.messageCount,before:from}:null})
 }
 async function readMessageSlice(id,options={}){if(!Array.isArray(options.indices)||options.indices.length>500)throw Error('Explicit message indices required (max500)');const p=await pin(id,options);if(!p)return undefined;const indices=[...new Set(options.indices.map(index=>indexOf(index,p.messageCount)))];return freezeJson({kind:'chat-slice',...identity(p),messageCount:p.messageCount,messages:await p.messages(indices),fields:await fieldsAt(p,options.fields)})}
 return Object.freeze({read,readReadonly,readRevision,revisions,update,version,remove,prune,protectRevisions,retentionInputs,migrateResources,readFields,readMessageWindow,readMessageSlice})
}
