import {createHash} from 'node:crypto'
import {finishJsonDraft, immutableJsonSnapshot} from './json-draft.js'
import {isFrozenJson, jsonBytes} from './readonly-json.js'

const versions=new WeakMap()
export function projectionVersion(value) {
 if(isFrozenJson(value)&&versions.has(value))return versions.get(value)
 const version=createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex')
 if(isFrozenJson(value))versions.set(value,version)
 return version
}

// The storage reader already validates file versions. Its immutable snapshot
// identity is a version token; fresh mutable wrappers must not rehash every
// unchanged history branch. Live dependencies can produce fresh immutable JSON
// wrappers; validate their complete values while retaining input identity rules.
function sameVersion(a,b,compareFrozen=false) {
 if(Object.is(a,b))return true
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false
 if(Array.isArray(a)&&a.length!==b.length)return false
 if(!compareFrozen&&isFrozenJson(a)&&isFrozenJson(b))return false
 const keys=Object.keys(a)
 return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameVersion(a[key],b[key],compareFrozen))
}

/** Memoize the expensive projection, never the reads which establish its validity.
 * Every non-input dependency must be read through use(). Its current value is
 * version-checked on every hit, including errors/deletions and mutable runtime state.
 * Immutable snapshots reuse their identity; mutable inputs are compared in full.
 */
export function createDependencyProjectionCache({maxEntries=4,maxBytes=512*1024*1024}={}) {
 const entries=new Map();let bytes=0,hits=0,builds=0
 async function observe(read) {
  try{return{value:finishJsonDraft(await read()),error:null}}
  catch(error){return{value:{message:String(error?.message||error),code:error?.code,status:error?.status},error}}
 }
 async function valid(dependencies) {
  for(const dependency of dependencies){const current=await observe(dependency.read);if(Boolean(current.error)!==dependency.failed||!sameVersion(dependency.value,current.value,true))return false}
  return true
 }
 async function read(key,input,build) {
  const old=entries.get(key)
  if(old&&sameVersion(old.input,finishJsonDraft(input))&&await valid(old.dependencies)) {
   hits++;if(entries.get(key)===old){entries.delete(key);entries.set(key,old)}return old.value
  }
  for(let attempt=0;attempt<3;attempt++) {
   const source=immutableJsonSnapshot(input),dependencies=[]
   const use=async read=>{const current=await observe(read),value=immutableJsonSnapshot(current.value);dependencies.push({read,value,failed:Boolean(current.error)});if(current.error)throw current.error;return value}
   builds++;const value=immutableJsonSnapshot(await build(use))
   if(!sameVersion(source,finishJsonDraft(input))||!await valid(dependencies)) {
    // A streaming source can keep changing. Return the latest fresh projection,
    // but never publish it as a reusable cache entry.
    if(attempt===2)return value
    continue
   }
   const size=jsonBytes(source)+jsonBytes(value)+dependencies.reduce((sum,row)=>sum+jsonBytes(row.value),0)
   if(size<=maxBytes&&maxEntries>0) {
    const previous=entries.get(key);if(previous){bytes-=previous.size;entries.delete(key)}
    while(entries.size&&(entries.size>=maxEntries||bytes+size>maxBytes)){const first=entries.keys().next().value;bytes-=entries.get(first).size;entries.delete(first)}
    entries.set(key,{input:source,dependencies,value,size});bytes+=size
   }
   return value
  }
 }
 return{read,stats:()=>({entries:entries.size,bytes,hits,builds})}
}
