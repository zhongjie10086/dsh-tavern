import {isDeepStrictEqual} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {exportSillyTavernWorldBook,inspectWorldBookDocument} from './worldbook-resource.js'
import {finishJsonDraft} from './json-draft.js'
const copy=value=>structuredClone(value)
export const worldbookSourceKey=source=>source?.resourceId|| (source?.kind==='card'?'card:'+source.cardPath:source?.kind==='chat'?'chat:'+source.id:'standalone:'+source?.path)
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const native=document=>exportSillyTavernWorldBook(document||{entries:{}})
const meta=document=>Object.fromEntries(Object.entries(document).filter(([key])=>key!=='entries'))
function difference(before,after){const patch={};for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!isDeepStrictEqual(before[key],after[key]))Object.defineProperty(patch,key,{value:Object.hasOwn(after,key)?{value:copy(after[key])}:{deleted:true},enumerable:true,writable:true,configurable:true});return patch}
function apply(object,patch){const result=copy(object);for(const [key,row]of Object.entries(patch||{}))if(row.deleted)delete result[key];else Object.defineProperty(result,key,{value:copy(row.value),enumerable:true,writable:true,configurable:true});return result}
export function privateWorldbookState(chat){return chat.worldbookState||{version:1,revision:0,books:{},bindings:{}}}
/** Public content is a base. Automatic writes only record this chat's changes. */
export function projectPrivateWorldbook(chat,source,live){
 const key=worldbookSourceKey(source),local=finishJsonDraft(privateWorldbookState(chat)).books[key]
 if(local?.deleted)return null
 if(!live&&!local)return null
 const base=native(live?.document??live?.view?.raw??local.base),publicEntries=apply(base.entries,local?.entries),entries={},sourceUids={},aliases={...local?.aliases}
 const additions=local?.additions||{},used=new Set(Object.keys(additions)),reserved=new Set([...used,...Object.values(aliases).map(String)]),allIds=[...Object.keys(publicEntries),...reserved]
 let spare=Math.max(-1,...allIds.map(Number).filter(Number.isFinite))+1
 for(const [uid,value]of Object.entries(publicEntries)){
  let exposed=String(aliases[uid]??uid)
  if(used.has(exposed)||(!Object.hasOwn(aliases,uid)&&reserved.has(exposed))){while(used.has(String(spare))||reserved.has(String(spare)))spare++;exposed=String(spare++);aliases[uid]=Number(exposed)}
  used.add(exposed);entries[exposed]={...copy(value),uid:Number(exposed)};sourceUids[exposed]=uid
 }
 for(const [uid,value]of Object.entries(additions))entries[uid]=copy(value)
 const document={...apply(meta(base),local?.metadata),entries}
 return {source:copy(source),document,view:inspectWorldBookDocument(document),baseDocument:local?.base&&isDeepStrictEqual(local.base,base)?local.base:base,localChatId:chat.id,privateKey:key,sourceUids,aliases}
}
export function storePrivateWorldbook(chat,record,requested){
 if(!record?.source)throw Error('世界书缺少来源')
 const currentState=finishJsonDraft(privateWorldbookState(chat)),state={...currentState,books:{...currentState.books}},key=worldbookSourceKey(record.source),previous=state.books[key]
 const document=native(requested)
 let base,baseDigest
 if(previous?.base&&previous.baseDigest&&record.baseDocument===previous.base){
  base=previous.base;baseDigest=previous.baseDigest
 }else{
  const rawBase=native(record.baseDocument??record.document??record.view?.raw)
  baseDigest=digest(rawBase)
  base=previous?.base&&previous.baseDigest===baseDigest&&isDeepStrictEqual(previous.base,rawBase)?previous.base:rawBase
 }
 const sourceUids=record.sourceUids||Object.fromEntries(Object.keys(base.entries).map(uid=>[uid,uid])),desiredPublic={},additions={}
 for(const [uid,value]of Object.entries(document.entries)){
  const original=sourceUids[uid]
  if(original!==undefined)desiredPublic[original]={...copy(value),uid:Number(original)}
  else{
   const nextValue=copy(value),prevAdd=previous?.additions?.[uid]
   additions[uid]=prevAdd!==undefined&&isDeepStrictEqual(prevAdd,nextValue)?prevAdd:nextValue
  }
 }
 const entries=difference(base.entries,desiredPublic)
 for(const [k,row]of Object.entries(entries))if(Object.hasOwn(row,'value')&&previous?.entries?.[k]?.value!==undefined&&isDeepStrictEqual(previous.entries[k].value,row.value))entries[k]=previous.entries[k]
 const sameEntries=Boolean(previous?.entries)&&Object.keys(entries).length===Object.keys(previous.entries).length&&Object.keys(entries).every(k=>entries[k]===previous.entries[k]||(entries[k]?.deleted===true&&previous.entries[k]?.deleted===true))
 const sameAdditions=Boolean(previous?.additions)&&Object.keys(additions).length===Object.keys(previous.additions).length&&Object.keys(additions).every(u=>additions[u]===previous.additions[u])
 const rawAliases=copy(record.aliases||previous?.aliases||{}),rawMetadata=difference(meta(base),meta(document))
 const entry={source:previous?.source&&isDeepStrictEqual(previous.source,record.source)?previous.source:copy(record.source),name:document.name||record.view?.displayName||previous?.name||'',base,baseDigest,entries:sameEntries?previous.entries:entries,additions:sameAdditions?previous.additions:additions,aliases:previous?.aliases&&isDeepStrictEqual(previous.aliases,rawAliases)?previous.aliases:rawAliases,metadata:previous?.metadata&&isDeepStrictEqual(previous.metadata,rawMetadata)?previous.metadata:rawMetadata,...(previous?.created?{created:true}:{})}
 if(previous&&!previous.deleted&&entry.source===previous.source&&entry.name===previous.name&&entry.base===previous.base&&entry.baseDigest===previous.baseDigest&&entry.entries===previous.entries&&entry.additions===previous.additions&&entry.aliases===previous.aliases&&entry.metadata===previous.metadata&&Boolean(entry.created)===Boolean(previous.created))return false
 state.books[key]=entry;state.revision++;chat.worldbookState=state;chat.cardContextSnapshotVersion=0;delete chat.preparedWorldBook;return true
}
export function createPrivateWorldbook(chat,name,document){
 const source={kind:'chat',id:randomUUID()},record={source,baseDocument:{name,entries:{}},view:{displayName:name}}
 storePrivateWorldbook(chat,record,{...document,name});chat.worldbookState.books[worldbookSourceKey(source)].created=true;return source
}
export function deletePrivateWorldbook(chat,source){
 const currentState=finishJsonDraft(privateWorldbookState(chat)),key=worldbookSourceKey(source)
 if(currentState.books[key]?.deleted)return false
 const state={...currentState,books:{...currentState.books}}
 state.books[key]={...state.books[key],source:copy(source),deleted:true};state.revision++;chat.worldbookState=state;chat.cardContextSnapshotVersion=0;delete chat.preparedWorldBook;return true
}

/** Preserve exposed UIDs by source identity even when another book grows. */
export function mergePrivateWorldbooks(records,chat) {
 if(!records.length)return null
 if(records.length===1)return records[0]
 const saved=privateWorldbookState(chat).mergeUids||{},reserved=new Set(Object.values(saved).map(Number)),used=new Set(),mappings={},sources=[],entries={}
 const document={...copy(records[0].document),entries};delete document.originalData
 let displayIndex=0
 for(const record of records){const mapping=[]
  for(const entry of Object.values(record.document.entries).sort((a,b)=>Number(a.displayIndex??a.uid)-Number(b.displayIndex??b.uid))){
   const key=worldbookSourceKey(record.source)+':'+entry.uid;let uid=saved[key]??entry.uid
   if(used.has(uid)||saved[key]===undefined&&reserved.has(uid)){
    uid=parseInt(digest(key).slice(0,12),16);while(used.has(uid)||reserved.has(uid))uid++
   }
   used.add(uid);mappings[key]=uid;entries[uid]={...copy(entry),uid,displayIndex:displayIndex++};mapping.push({originalUid:entry.uid,uid})
  }
  sources.push({source:copy(record.source),name:record.view.displayName,entries:mapping})
 }
 return {source:records[0].source,document,view:inspectWorldBookDocument(document),mergedSources:sources,mergedRecords:records,mergeUids:mappings,localChatId:chat.id}
}
export function storeMergedPrivateWorldbook(chat,record,document){
 if(!record.mergedRecords)return storePrivateWorldbook(chat,record,document)
 const requested=native(document),known=new Set(),parts=record.mergedRecords.map(row=>({...copy(row.document),entries:{}}))
 for(let index=0;index<record.mergedRecords.length;index++){
  const row=record.mergedRecords[index],mapping=record.mergedSources[index]
  for(const {originalUid,uid}of mapping.entries){known.add(String(uid));const value=requested.entries[uid];if(!value)continue
   const next={...copy(value),uid:originalUid},original=row.document.entries[originalUid]
   if(value.displayIndex===record.document.entries[uid]?.displayIndex){if(original.displayIndex===undefined)delete next.displayIndex;else next.displayIndex=original.displayIndex}
   parts[index].entries[originalUid]=next
  }
 }
 const primary=parts[0],used=new Set(Object.keys(primary.entries));let spare=Math.max(-1,...used.values())+1
 for(const [uid,value]of Object.entries(requested.entries))if(!known.has(uid)){let id=uid;while(used.has(id))id=String(spare++);used.add(id);primary.entries[id]={...copy(value),uid:Number(id)}}
 Object.assign(primary,meta(requested));let changed=false
 for(let i=0;i<parts.length;i++)changed=storePrivateWorldbook(chat,record.mergedRecords[i],parts[i])||changed
 const currentState=finishJsonDraft(privateWorldbookState(chat));if(!isDeepStrictEqual(currentState.mergeUids,record.mergeUids)){chat.worldbookState={...currentState,mergeUids:copy(record.mergeUids),revision:(currentState.revision||0)+1};changed=true}
 return changed
}
