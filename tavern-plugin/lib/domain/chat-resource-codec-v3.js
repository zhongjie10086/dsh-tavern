import {createProfileDataStore} from '../profile-data-store.js'
import {immutableJsonSnapshot} from './json-draft.js'
import {createContentResourceStore,contentReference} from './content-resource-store.js'
import {createResourceVersionStorage} from './resource-version-storage.js'

const fields=new Set(['runtimePresetSnapshot','tavernScriptTrees','tavernScriptHistory','openingWorldbookSnapshot','worldbookState','spDatabase','cardContextSnapshot'])
const versionKinds={runtimePresetSnapshot:'preset',tavernScriptTrees:'scripts',tavernScriptHistory:'script-history',worldbookState:'worldbooks',cardContextSnapshot:'card-context'}
const displayFields=new Set(['displayRuntime','displayText','displayParts','tavernTemplateDisplay'])
const object=value=>value!==null&&typeof value==='object'
const rootAt=path=>path.length===0||path.length===4&&path[0]==='timeline'&&path[1]==='checkpoints'&&Number.isInteger(Number(path[2]))&&path[3]==='before'
const derivedAt=path=>path[0]==='resolvedRuntimePreset'
const messageRoot=path=>path.length===2&&path[0]==='messages'&&Number.isInteger(Number(path[1]))
const invalid=()=>Object.assign(Error('资源版本快照格式无效；请恢复配套完整备份'),{code:'DSH_RESOURCE_VERSION_INVALID'})
const readContext=()=>({objects:new Map(),versions:new Map()})

/** v3 uses explicit resource definitions and local overlays. Legacy v1/v2 CAS
 * remains readable; plot state and unknown variable objects are never reclassified. */
export function createChatResourceCodecV3({dataRoot,store=createProfileDataStore({dataRoot})}){
 const resources=createContentResourceStore(store),versions=createResourceVersionStorage(store)
 async function visit(value,path,writing,versioned,context){
  if(derivedAt(path))return undefined
  if(writing&&context?.reuse){
   let before=context.base,encoded=context.encoded
   for(const key of path){before=before?.[key];encoded=encoded?.[key]}
   if(value===before&&(value===null||typeof value!=='object'||Object.isFrozen(value)))return encoded
  }
  const field=path.at(-1),parent=path.slice(0,-1)
  if(fields.has(field)&&rootAt(parent)||displayFields.has(field)&&messageRoot(parent)){
   const kind=rootAt(parent)?versionKinds[field]:undefined
   if(versioned&&kind&&value!==null&&value!==undefined)return writing?versions.encode(kind,value):versions.decode(value,kind,context)
   return writing?resources.save(value,{metadata:field==='runtimePresetSnapshot'?['createdAt','digest']:[]}):contentReference(value)?resources.load(value,new Set(),context?.objects):value
  }
  if(!object(value))return value
  if(!rootAt(path)&&!(path.length===1&&['timeline','messages'].includes(path[0]))&&!(path.length===2&&path[0]==='timeline'&&path[1]==='checkpoints')&&!(path.length===3&&path[0]==='timeline'&&path[1]==='checkpoints')&&!messageRoot(path))return value
  const result=Array.isArray(value)?[]:{...value}
  for(const key of Object.keys(value)){
   const childPath=path.concat(Array.isArray(value)?Number(key):key)
   if(derivedAt(childPath)){delete result[key];continue}
   Object.defineProperty(result,key,{value:await visit(value[key],childPath,writing,versioned,context),enumerable:true,writable:true,configurable:true})
  }
  return result
 }
 const directKind=path=>rootAt(path.slice(0,-1))?versionKinds[path.at(-1)]:undefined
 const contentPath=path=>path.some((field,index)=>fields.has(field)&&rootAt(path.slice(0,index)))||displayFields.has(path[2])&&messageRoot(path.slice(0,2))
 async function changes(rows,writing){
  const result=[],context=writing?undefined:readContext()
  for(const row of rows){
   if(derivedAt(row.path))continue
   if(!writing&&row.resourceEncoding!==undefined&&![2,3].includes(row.resourceEncoding))throw invalid()
   if(!writing&&[2,3].includes(row.resourceEncoding)){
    const {resourceEncoding,resourceIndices,...plain}=row
    async function restore(value,index,path){
     const decoded=resourceIndices?.includes(index)?await resources.load(value,new Set(),context.objects):value
     return resourceEncoding===3?visit(decoded,path,false,true,context):decoded
    }
    if(row.op==='set')plain.value=await restore(row.value,0,row.path)
    else if(row.op==='splice')plain.items=await Promise.all((row.items||[]).map((value,i)=>restore(value,i,row.path.concat(row.index+i))))
    result.push(plain);continue
   }
   if(writing&&['set','splice'].includes(row.op)){
    const input=row.op==='set'?[row.value]:row.items||[],indices=[],values=[]
    const partial=contentPath(row.path)&&!(row.op==='set'&&directKind(row.path))
    for(const [i,value]of input.entries()){
     const path=row.op==='set'?row.path:row.path.concat(row.index+i)
     const encoded=await visit(value,path,true,true)
     const saved=partial?await resources.save(encoded):encoded
     if(saved!==encoded&&contentReference(saved))indices.push(i)
     values.push(saved)
    }
    result.push({...row,...(row.op==='set'?{value:values[0]}:{items:values}),resourceEncoding:3,resourceIndices:indices});continue
   }
   if(row.op==='set')result.push({...row,value:await visit(row.value,row.path,writing,false,context)})
   else if(row.op==='splice')result.push({...row,items:await Promise.all((row.items||[]).map((value,i)=>visit(value,row.path.concat(row.index+i),writing,false,context)))})
   else result.push(row)
  }
  return result
 }
 async function encodeChat(value){return {$dshVersionedChat:1,_storageRevision:value?._storageRevision,value:await visit(value,[],true,true)}}
 async function decodeChat(value){
  if(Object.hasOwn(value||{},'$dshVersionedChat')&&!Object.hasOwn(value,'id')){
   if(value.$dshVersionedChat!==1)throw invalid()
   if(!object(value.value)||value._storageRevision!==value.value._storageRevision)throw invalid()
   return visit(value.value,[],false,true,readContext())
  }
  return visit(value,[],false,false,readContext())
 }
 async function encodeChatIncremental(value,base,encoded){return {$dshVersionedChat:1,_storageRevision:value?._storageRevision,value:await visit(value,[],true,true,{reuse:true,base,encoded})}}
 return Object.freeze({encodeChat,encodeChatIncremental,decodeChat,encodeChanges:rows=>changes(rows,true),decodeChanges:rows=>changes(rows,false),logical:value=>{const next={...value};delete next.resolvedRuntimePreset;return immutableJsonSnapshot(next)}})
}
