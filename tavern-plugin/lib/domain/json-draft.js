// Plain objects/arrays with lazy, writable properties. Unlike Proxy drafts these
// remain compatible with structuredClone and the existing mutable domain APIs.
import {freezeJson,isFrozenJson} from './readonly-json.js'
const drafts=new WeakMap()
const object=value=>value!==null&&typeof value==='object'
const plain=value=>Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null
const put=(target,key,value)=>Object.defineProperty(target,key,{value,enumerable:true,writable:true,configurable:true})

export function mutableJsonDraft(input,onMaterialize){
 const source=finishJsonDraft(input),copies=new WeakMap()
 function copy(value){
  if(!object(value))return value
  if(!plain(value))return structuredClone(value)
  if(copies.has(value))return copies.get(value)
  const result=Array.isArray(value)?new Array(value.length):{},state={source:value,keys:Object.keys(value),accessed:new Map(),getters:new Map()}
  copies.set(value,result);drafts.set(result,state)
  onMaterialize?.({nodes:1,properties:state.keys.length})
  for(const key of state.keys){
   if(!object(value[key])){put(result,key,value[key]);continue}
   const get=()=>{if(!state.accessed.has(key))state.accessed.set(key,copy(value[key]));return state.accessed.get(key)}
   state.getters.set(key,get)
   Object.defineProperty(result,key,{enumerable:true,configurable:true,get,set(next){put(result,key,next)}})
  }
  return result
 }
 return copy(source)
}

/** Retain the original identity of untouched JSON branches; never freeze inputs. */
export function finishJsonDraft(input){
 const finished=new WeakMap(),visiting=new WeakSet()
 function finish(value){
  if(!object(value)||!plain(value))return value
  if(finished.has(value))return finished.get(value)
  if(visiting.has(value))throw Error('Chat JSON 不允许循环引用')
  const state=drafts.get(value)
  if(!state&&isFrozenJson(value))return value
  visiting.add(value)
  const keys=Object.keys(value)
  const shapeChanged=state&&(keys.length!==state.keys.length||keys.some((key,i)=>key!==state.keys[i])||Array.isArray(value)&&value.length!==state.source.length)
  let result=shapeChanged?(Array.isArray(value)?new Array(value.length):{}):undefined
  for(const key of keys){
   const getter=state?.getters.get(key)
   const originalGetter=getter&&Object.getOwnPropertyDescriptor(value,key).get===getter
   const before=originalGetter?(state.accessed.has(key)?state.accessed.get(key):state.source[key]):value[key]
   const next=originalGetter&&!state.accessed.has(key)?before:finish(before)
   const changed=state?!Object.hasOwn(state.source,key)||next!==state.source[key]:next!==before
   if(changed&&!result){const base=state?state.source:value;result=Array.isArray(base)?Object.assign(base.slice(),base):{...base}}
   if(result)put(result,key,next)
  }
  const next=result||(state?state.source:value)
  visiting.delete(value);finished.set(value,next);return next
 }
 return finish(input)
}

/** Copy caller-owned mutable branches before freezing; storage-owned branches share. */
export function immutableJsonSnapshot(input){
 const source=finishJsonDraft(input),copies=new WeakMap()
 function copy(value){
  if(!object(value)||isFrozenJson(value))return value
  if(!plain(value))return structuredClone(value)
  if(copies.has(value))return copies.get(value)
  const result=Array.isArray(value)?new Array(value.length):{};copies.set(value,result)
  for(const key of Object.keys(value))put(result,key,copy(value[key]))
  return result
 }
 return freezeJson(copy(source))
}
