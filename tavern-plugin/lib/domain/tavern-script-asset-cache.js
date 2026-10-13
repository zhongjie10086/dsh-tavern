import {analyzeMvuInitialization} from './mvu-companion-plan.js'
import {createHash} from 'node:crypto'
import {finishJsonDraft} from './json-draft.js'
import {isFrozenJson} from './readonly-json.js'
function describeScript(content){const startup=analyzeMvuInitialization(content);Object.freeze(startup.unknown);Object.freeze(startup);return Object.freeze({mvuInitialization:startup,requiresNativePresetApi:!content.includes('tavernOriginalUi: extension-github')&&(/\bgetPresetManager\b/.test(content)||(!content.includes('tavernOriginalUi')&&/\bimport\s*\(/.test(content))),requiresPresetApi:/\b(getPreset|getPresetNames|replacePreset|createOrReplacePreset|updatePresetWith|getLoadedPresetName|loadPreset)\b/.test(content),originalUi:content.includes('tavernOriginalUi'),uiKind:content.includes('tavernOriginalUi: extension-github')?'extension-github':content.includes('tavernOriginalUi: extension-sp-database')?'extension-sp-database':content.includes('tavernOriginalUi: izumi')?'preset':content.includes('tavernOriginalUi: database-visualizer')?'database-visualizer':content.includes('tavernOriginalUi')?'companion':''})}
/** Immutable sources are fetched through the existing authenticated session RPC. */
export function createTavernScriptAssetCache({maxBytes=64*1024*1024,maxOwners=256}={}){
 const entries=new Map(),byContent=new Map(),objects=new WeakMap(),owners=new Map(),scriptOwners=new Map();let bytes=0,digests=0,analyses=0
 function contentOf(value){if(typeof value==='string')return value;value=finishJsonDraft(value);if(isFrozenJson(value)){if(!objects.has(value))objects.set(value,JSON.stringify(value));return objects.get(value)}return JSON.stringify(value)}
 function publish(sessionId,values,scriptIds=[]){
  const pending=values.map(value=>{
   const content=contentOf(value),old=byContent.get(content);if(old)return old
   const size=Buffer.byteLength(content);if(size>maxBytes)throw new Error('脚本资源超过缓存容量')
   digests++;return{content,size,digest:createHash('sha256').update(content).digest('hex')}
  })
  const keys=pending.map(item=>{const cached=entries.get(item.digest);if(cached){entries.delete(item.digest);entries.set(item.digest,cached)}else{entries.set(item.digest,item);byContent.set(item.content,item);bytes+=item.size}return item.digest})
  const owner=String(sessionId);owners.delete(owner);owners.set(owner,new Set(keys));const owned=new Map()
  keys.forEach((key,index)=>{if(!owned.has(key))owned.set(key,new Set());if(scriptIds[index])owned.get(key).add(String(scriptIds[index]))});scriptOwners.set(owner,owned)
  while(owners.size>maxOwners){const key=owners.keys().next().value;owners.delete(key);scriptOwners.delete(key)}
  while(bytes>maxBytes){const key=entries.keys().next().value,item=entries.get(key);bytes-=item.size;entries.delete(key);byContent.delete(item.content)}
  return keys
 }
 function read(sessionId,digest,scriptId){
  if(!owners.get(String(sessionId))?.has(digest))throw new Error('此资源不属于当前游戏')
  if(scriptId!==undefined&&!scriptOwners.get(String(sessionId))?.get(digest)?.has(scriptId))throw new Error('此资源不属于当前脚本')
  const entry=entries.get(digest);if(!entry)throw new Error('脚本资源已过期，请重新进入本局');return{content:entry.content}
 }
 function describe(digest){const entry=entries.get(digest);if(!entry)throw new Error('脚本资源已过期，请重新进入本局');if(!entry.description){analyses++;entry.description=describeScript(entry.content)}return entry.description}
 return{publish,read,describe,available:(sessionId,keys)=>keys.every(key=>owners.get(String(sessionId))?.has(key)&&entries.has(key)),stats:()=>({entries:entries.size,bytes,owners:owners.size,digests,analyses})}
}
