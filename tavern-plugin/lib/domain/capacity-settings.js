import {scriptStorageLimits,storedJsonBytes} from './script-storage-budget.js'
import {SP_SQL_LIMITS} from './sp-sql.js'
import {SCRIPT_PROMPT_LIMITS} from './tavern-script-prompts.js'
import {RETENTION_DEFAULTS} from './retention-policy.js'

export const CAPACITY_DEFAULTS=Object.freeze({files:scriptStorageLimits.files,images:scriptStorageLimits.images,sql:SP_SQL_LIMITS,prompts:SCRIPT_PROMPT_LIMITS,audio:{itemBytes:4*1024**2,totalBytes:32*1024**2},storage:{historyBytes:256*1024**2,remoteBytes:RETENTION_DEFAULTS.remoteBytes,diagnosticBytes:RETENTION_DEFAULTS.diagnosticBytes},process:{nodeHeapMiB:8192,rpcBytes:32*1024**2}})
export function normalizeCapacitySettings(value={}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('容量设置必须为对象')
  const result={}
  for(const [group,defaults]of Object.entries(CAPACITY_DEFAULTS)){
    const input=value[group]||{};if(typeof input!=='object'||Array.isArray(input))throw Error('容量分组无效：'+group)
    result[group]={...defaults}
    for(const [key,number]of Object.entries(input)){if(!(key in defaults)||!Number.isSafeInteger(number)||number<1)throw Error('容量上限无效：'+group+'.'+key);result[group][key]=number}
  }
  for(const key of Object.keys(value))if(!(key in result))throw Error('未知容量分组：'+key)
  return result
}
export async function readCapacitySettings(store,logger=console){
  try{return normalizeCapacitySettings(await store.readJson('capacity-settings.json')||{})}
  catch(error){logger.warn('dsh-tavern: 可选容量设置无效，使用默认值',String(error.message||error));return normalizeCapacitySettings()}
}
const usage=records=>{
 const owners={},total={count:0,bytes:0};for(const row of Object.values(records||{})){const owner=owners[row.owner||'legacy']||={count:0,bytes:0},bytes=Number.isSafeInteger(row.bytes)?row.bytes:storedJsonBytes(row);owner.count++;owner.bytes+=bytes;total.count++;total.bytes+=bytes}
 return {...total,largestOwnerCount:Math.max(0,...Object.values(owners).map(row=>row.count)),largestOwnerBytes:Math.max(0,...Object.values(owners).map(row=>row.bytes))}
}
export function createCapacitySettings({store,active,readChats=async()=>[],remoteUsage=async()=>null,diagnosticUsage=async()=>null}){
 async function status(){
  const [files,images,library,remote,diagnostics,chats]=await Promise.all([store.readJson('script-files.json'),store.readJson('script-images/.quota.json'),store.readJson('tavern-script-library.json'),remoteUsage(),diagnosticUsage(),readChats()]);
  return {active,configured:await readCapacitySettings(store),restartRequired:JSON.stringify(active)!==JSON.stringify(await readCapacitySettings(store)),usage:{files:usage(files),images:usage(images?.records),historyBytes:Buffer.byteLength(JSON.stringify(library?.history||[])),remoteBytes:remote?.beforeBytes||0,diagnosticBytes:diagnostics?.bytes||0,audioBytes:Math.max(0,...chats.map(chat=>Buffer.byteLength(JSON.stringify(chat.tavernAudio||{})))),promptBytes:Math.max(0,...chats.map(chat=>Buffer.byteLength(JSON.stringify(chat.tavernScriptPrompts||[])))),promptCount:Math.max(0,...chats.map(chat=>chat.tavernScriptPrompts?.length||0)),nodeHeapBytes:process.memoryUsage().heapUsed}}
 }
 return {status,async save(value){const next=normalizeCapacitySettings(value);await store.updateJson('capacity-settings.json',()=>next);return {configured:next,restartRequired:JSON.stringify(active)!==JSON.stringify(next)}}}
}
