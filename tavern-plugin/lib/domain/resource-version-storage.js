import {createHash} from 'node:crypto'
import {createContentResourceStore,contentReference} from './content-resource-store.js'
import {finishJsonDraft} from './json-draft.js'
import {freezeJson} from './readonly-json.js'

const object=value=>value!==null&&typeof value==='object'
const plain=value=>object(value)&&!Array.isArray(value)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const location=sha=>'resource-versions/'+sha+'.json'
const own=(value,key)=>object(value)&&Object.hasOwn(value,key)
const kinds=new Set(['preset','scripts','script-history','worldbooks','card-context'])
export const versionOverlay=value=>plain(value)&&value.$dshResourceOverlay===1&&kinds.has(value.kind)
function invalid(ref,message){return Object.assign(Error(message+'：'+location(ref?.sha256||'unknown')+'；请恢复包含 resource-versions 和 chat-resources 的配套完整备份'),{code:'DSH_RESOURCE_VERSION_INVALID',resourcePath:location(ref?.sha256||'unknown')})}

// Separate only fields whose storage role is known. Variable names/content are
// never used to infer story state. Unknown worldbook fields remain in the overlay.
function split(kind,input){
 const overrides=[]
 function strip(value,path,predicate,descend){
  if(!object(value))return value
  const result=Array.isArray(value)?[]:{}
  for(const [index,[key,child]]of Object.entries(value).entries()){
   const part=path.concat(Array.isArray(value)?Number(key):key)
   if(predicate(key,child)){overrides.push({path:part,index,value:child});continue}
   Object.defineProperty(result,key,{value:descend?descend(child,part,key):child,enumerable:true,writable:true,configurable:true})
  }
  return result
 }
 function tree(value,path){
  if(Array.isArray(value))return value.map((item,index)=>tree(item,path.concat(index)))
  if(!plain(value))return value
  return strip(value,path,key=>key==='data',(child,part,key)=>key==='scripts'&&value.type==='folder'?tree(child,part):child)
 }
 function library(value,path){
  if(!plain(value))return value
  return strip(value,path,()=>false,(child,part,key)=>key==='characters'&&plain(child)?strip(child,part,()=>false,(rows,p)=>tree(rows,p)):['global','preset','character','chat'].includes(key)?tree(child,part):child)
 }
 if(kind==='preset')return {base:strip(input,[],key=>['createdAt','digest'].includes(key),(child,path,key)=>key==='scriptLibrary'?library(child,path):child),overrides}
 if(kind==='scripts')return {base:library(input,[]),overrides}
 if(kind==='script-history')return {base:Array.isArray(input)?input.map((row,index)=>strip(row,[index],key=>['at'].includes(key),(child,path,key)=>key==='trees'?(Array.isArray(child)?tree(child,path):library(child,path)):child)):input,overrides}
 if(kind==='worldbooks')return {base:strip(input,[],key=>key!=='books',(books,path)=>!plain(books)?books:strip(books,path,()=>false,(book,p)=>strip(book,p,key=>!['base','source','name','baseDigest'].includes(key)))),overrides}
 return {base:input,overrides}
}

function applyOverlay(input,rows,ref){
 if(!Array.isArray(rows))throw invalid(ref,'资源本局改动格式无效')
 let result=input
 const paths=new Set()
 // Path copying preserves JSON tree independence without cloning unchanged
 // script source and worldbook bodies once per individual override.
 for(const row of rows){
  if(!row||!Array.isArray(row.path)||!row.path.length||row.path.length>256||!Number.isSafeInteger(row.index)||row.index<0||!own(row,'value'))throw invalid(ref,'资源本局改动路径无效')
  const identity=JSON.stringify(row.path)
  if(paths.has(identity)||row.path.some(key=>typeof key!=='string'&&(!Number.isSafeInteger(key)||key<0)))throw invalid(ref,'资源本局改动路径重复或无效')
  paths.add(identity)
  function insert(value,depth){
   const key=row.path[depth]
   if(!object(value)||Array.isArray(value)&&(!Number.isSafeInteger(key)||key<0))throw invalid(ref,'资源本局改动目标无效')
   if(depth<row.path.length-1){
    if(!own(value,key))throw invalid(ref,'资源本局改动父项缺失')
    const copy=Array.isArray(value)?value.slice():{...value}
    Object.defineProperty(copy,key,{value:insert(value[key],depth+1),enumerable:true,writable:true,configurable:true});return copy
   }
   if(own(value,key)||Array.isArray(value))throw invalid(ref,'资源本局改动覆盖了版本定义')
   const entries=Object.entries(value)
   if(row.index>entries.length)throw invalid(ref,'资源本局改动顺序无效')
   entries.splice(row.index,0,[key,row.value]);return Object.fromEntries(entries)
  }
  result=insert(result,0)
 }
 return freezeJson(result)
}

/** One immutable version plus explicit per-instance overrides for every supported
 * resource kind. Following/pinning remains a game binding policy; loading a save
 * never silently resolves a newer public resource or changes its plot state. */
export function createResourceVersionStorage(store){
 const resources=createContentResourceStore(store),verified=new WeakSet()
 async function encode(kind,input){
  if(!kinds.has(kind))throw Error('未知资源版本类别')
  if(input===undefined||input===null)return input
  const value=finishJsonDraft(input),parts=split(kind,value),context={objects:new Map(),versions:new Map()}
  const definition=await resources.save(parts.base,{},context.objects),record={$dshResourceVersion:1,kind,definition,reference:definition!==parts.base&&contentReference(definition)}
  const sha256=hash(record),ref={kind,sha256}
  if(await readVersion(ref,context,false,true)===undefined){
   await store.updateJson(location(sha256),previous=>{if(previous!==undefined&&hash(previous)!==sha256)throw invalid(ref,'资源版本校验失败');return previous===undefined?record:undefined})
   context.versions.delete(sha256)
  }
  const overrides=await resources.save(parts.overrides,{},context.objects)
  return {$dshResourceOverlay:1,kind,version:sha256,overrides,overrideReference:overrides!==parts.overrides&&contentReference(overrides)}
 }
 async function readVersion(ref,context,expand=true,allowMissing=false){
  if(!/^[a-f0-9]{64}$/.test(ref.sha256||''))throw invalid(ref,'资源版本编号无效')
  if(context&&!context.versions.has(ref.sha256))context.versions.set(ref.sha256,store.readReadonly(location(ref.sha256)))
  const row=await (context?context.versions.get(ref.sha256):store.readReadonly(location(ref.sha256)))
  if(row===undefined&&allowMissing)return undefined
  if(!plain(row)||row.$dshResourceVersion!==1||row.kind!==ref.kind||!own(row,'definition')||!verified.has(row)&&hash(row)!==ref.sha256)throw invalid(ref,'资源版本缺失或校验失败')
  verified.add(row)
  if(!expand){if(row.reference)await resources.verify(row.definition,new Set(),context?.objects);return row}
  return row.reference?await resources.load(row.definition,new Set(),context?.objects):structuredClone(row.definition)
 }
 async function decode(value,kind,context){
  if(!versionOverlay(value)||value.kind!==kind)throw invalid({sha256:value?.version},'资源版本类别或覆盖格式无效')
  const ref={kind,sha256:value.version},definition=await readVersion(ref,context)
  const overrides=value.overrideReference?await resources.load(value.overrides,new Set(),context?.objects):structuredClone(value.overrides)
  return applyOverlay(definition,overrides,ref)
 }
 return {encode,decode}
}
