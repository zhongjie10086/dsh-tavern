import {immutableJsonSnapshot} from './json-draft.js'
import {jsonBytes} from './readonly-json.js'

/** Version-checked immutable cache; never caches a read spanning a source change. */
export function createVersionedJsonCache({maxBytes=64*1024*1024,maxEntries=32}={}){
 const entries=new Map(),flights=new Map();let bytes=0,hits=0,loads=0
 async function read(key,version,load){
  for(let attempt=0;attempt<3;attempt++){
   const stamp=await version(),old=entries.get(key)
   if(old?.stamp===stamp){entries.delete(key);entries.set(key,old);hits++;return old.value}
   const flightKey=JSON.stringify([key,stamp]);let pending=flights.get(flightKey)
   if(!pending){pending=(async()=>{loads++;const value=immutableJsonSnapshot(await load());if(await version()!==stamp)return{stale:true};const size=jsonBytes(value);if(size<=maxBytes&&maxEntries>0){const previous=entries.get(key);if(previous){bytes-=previous.bytes;entries.delete(key)}while(entries.size&&(bytes+size>maxBytes||entries.size>=maxEntries)){const first=entries.keys().next().value;bytes-=entries.get(first).bytes;entries.delete(first)}entries.set(key,{stamp,value,bytes:size});bytes+=size}return{value}})();flights.set(flightKey,pending);pending.finally(()=>{if(flights.get(flightKey)===pending)flights.delete(flightKey)}).catch(()=>{})}
   const result=await pending;if(!result.stale)return result.value
  }
  throw Error('资源正在连续修改，请稍后重试')
 }
 function invalidate(key){const entry=entries.get(key);if(entry){bytes-=entry.bytes;entries.delete(key)}}
 return{read,invalidate,stats:()=>({entries:entries.size,bytes,hits,loads})}
}
