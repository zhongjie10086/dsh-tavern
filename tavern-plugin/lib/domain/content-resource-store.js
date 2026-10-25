import {createHash} from 'node:crypto'
import {finishJsonDraft} from './json-draft.js'
import {freezeJson} from './readonly-json.js'
const object=value=>value!==null&&typeof value==='object'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const own=(value,key)=>object(value)&&Object.hasOwn(value,key)
export const contentReference=value=>object(value)&&[1,2].includes(value.$dshChatResource)&&typeof value.sha256==='string'&&Object.keys(value).every(key=>['$dshChatResource','sha256','meta'].includes(key))
const location=sha=>'chat-resources/'+sha+'.json'
function failure(ref,message){return Object.assign(new Error(message+'：'+location(ref.sha256)+'；请恢复包含 chat-resources 的完整备份'),{code:'DSH_CHAT_RESOURCE_INVALID',resourcePath:location(ref.sha256)})}

/** Storage-only DAG. Explicit link manifests distinguish user data from references. */
export function createContentResourceStore(store){
 const encoded=new WeakMap(),verified=new WeakSet()
 const waiters=[];let activeReads=0
 async function readObject(location){
  while(activeReads>=16)await new Promise(resolve=>waiters.push(resolve))
  activeReads++
  try{return await store.readReadonly(location)}finally{activeReads--;waiters.shift()?.()}
 }
 async function raw(ref,allowMissing=false){
  if(!/^[a-f0-9]{64}$/.test(ref.sha256))throw failure(ref,'Chat 资源引用损坏')
  const value=await readObject(location(ref.sha256))
  if(value===undefined&&allowMissing)return undefined
  if(value===undefined||!verified.has(value)&&hash(value)!==ref.sha256)throw failure(ref,'Chat 资源缺失或校验失败')
  if(object(value))verified.add(value)
  return value
 }
 const rawOnce=async(ref,reads,allowMissing=false)=>{
  if(!reads.has(ref.sha256))reads.set(ref.sha256,raw(ref,allowMissing))
  const value=await reads.get(ref.sha256)
  if(value===undefined&&!allowMissing)throw failure(ref,'Chat 资源缺失或校验失败')
  return value
 }
 async function visit(ref,ancestors,reads,expand){
  if(!contentReference(ref))return expand?ref:undefined
  if(ancestors.has(ref.sha256)||ancestors.size>=256)throw failure(ref,'Chat 资源循环或层数超限')
  const value=await rawOnce(ref,reads)
  // Old flat resources must also expand to independent runtime trees. Only
  // raw reads are shared; a current-state draft must not mutate its checkpoint.
  if(ref.$dshChatResource===1)return expand?freezeJson(object(value)?structuredClone(value):value):undefined
  if(!value||value.$dshChatObject!==2||!own(value,'value')||!Array.isArray(value.links))throw failure(ref,'Chat 资源格式不支持')
  // The JSON contract is a tree: physical dedup must never alias two mutable
  // runtime paths. Clone the small inline body and expand each link separately.
  let result=expand&&object(value.value)?structuredClone(value.value):value.value
  {
   const next=new Set(ancestors).add(ref.sha256),keys=new Set()
   for(const link of value.links){
    if(!link||typeof link.key!=='string'||keys.has(link.key)||!own(result,link.key)||result[link.key]!==null||!contentReference(link.ref))throw failure(ref,'Chat 子资源引用损坏')
    keys.add(link.key)
   }
   const children=await Promise.all(value.links.map(link=>visit(link.ref,next,reads,expand)))
   if(expand){
    for(const [index,link]of value.links.entries())Object.defineProperty(result,link.key,{value:children[index],enumerable:true,configurable:true,writable:true})
    result=freezeJson(result)
   }
  }
  if(ref.meta!==undefined){
   if(!object(result)||Array.isArray(result)||!Array.isArray(ref.meta))throw failure(ref,'Chat 资源元数据损坏')
   const entries=Object.entries(result),keys=new Set(entries.map(([key])=>key))
   for(const entry of ref.meta){
    if(!Array.isArray(entry)||entry.length!==3||typeof entry[0]!=='string'||keys.has(entry[0])||!Number.isSafeInteger(entry[2])||entry[2]<0||entry[2]>entries.length)throw failure(ref,'Chat 资源元数据位置损坏')
    keys.add(entry[0]);entries.splice(entry[2],0,[entry[0],entry[1]])
   }
   return expand?freezeJson(Object.fromEntries(entries)):undefined
  }
  if(expand&&object(result)&&Object.isFrozen(result)){
   if(!encoded.has(result))encoded.set(result,new Map())
   encoded.get(result).set('',ref)
  }
  return expand?result:undefined
 }
 const load=(ref,ancestors=new Set(),reads=new Map())=>visit(ref,ancestors,reads,true)
 // Validate the identical graph/metadata contract without materializing a tree
 // that a writer would immediately discard. Every operation still reads storage.
 const verify=(ref,ancestors=new Set(),reads=new Map())=>visit(ref,ancestors,reads,false)
 async function save(input,{metadata=[]}={},reads=new Map()){
  const value=finishJsonDraft(input)
  if(value===undefined||value===null)return value
  const cacheKey=metadata.join(','),cached=object(value)&&Object.isFrozen(value)?encoded.get(value)?.get(cacheKey):null
  if(cached){await verify(cached,new Set(),reads);return cached}
  const meta=[],links=[],payload=Array.isArray(value)?[]:object(value)?{}:value
  if(object(value))for(const [index,[key,child]]of Object.entries(value).entries()){
   if(!Array.isArray(value)&&metadata.includes(key)){meta.push([key,child,index]);continue}
   // Metadata rules never reach arbitrary script variables or table values.
   const childMetadata=(key==='snapshot'||key==='runtimePresetSnapshot')?['createdAt','digest']:[]
   const part=await save(child,{metadata:childMetadata},reads)
   const referenced=part!==child&&contentReference(part)
   Object.defineProperty(payload,key,{value:referenced?null:child,enumerable:true,configurable:true,writable:true})
   if(referenced)links.push({key,ref:part})
  }
  const node={$dshChatObject:2,value:payload,links},text=JSON.stringify(node)
  if(!links.length&&Buffer.byteLength(text)<4096)return value
  const sha256=createHash('sha256').update(text).digest('hex'),ref={$dshChatResource:2,sha256,...(meta.length?{meta}:{})}
  // The immutable read both establishes existence and validates actual content.
  // Missing targets still use the store's pending recovery and locked creation.
  if(await rawOnce(ref,reads,true)===undefined){
   await store.updateJson(location(sha256),current=>{if(current!==undefined&&hash(current)!==sha256)throw failure(ref,'Chat 资源内容校验失败');return current===undefined?node:undefined})
   reads.delete(sha256)
  }
  if(object(value)&&Object.isFrozen(value)){if(!encoded.has(value))encoded.set(value,new Map());encoded.get(value).set(cacheKey,ref)}
  return ref
 }
 return {save,load,verify}
}
