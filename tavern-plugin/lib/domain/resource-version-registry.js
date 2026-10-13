import {randomUUID} from 'node:crypto'
import {normalizeResourcePath,resourceKind} from './file-resources.js'
const file='resource-versions.json'
const empty=()=>({version:1,revision:0,resources:{},paths:{}})
/** Host-owned identity survives edits/renames. Deletion retires it permanently. */
export function createResourceVersionRegistry(store){
 const read=async()=>await (store.readReadonly||store.readJson)(file)||empty()
 async function claim(input){
  const path=normalizeResourcePath(input),state=await read(),existing=state.paths[path]
  if(existing&&state.resources[existing]&&!state.resources[existing].deleted)return {...state.resources[existing]}
  let result
  await store.updateJson(file,value=>{const state=value||empty(),id=state.paths[path];if(id&&state.resources[id]&&!state.resources[id].deleted){result={...state.resources[id]};return undefined}const next=randomUUID();result={id:next,path,kind:resourceKind(path),deleted:false,scriptVariableScope:state.scriptVariableScopes===1?'shared':'legacy'};return {...state,revision:state.revision+1,resources:{...state.resources,[next]:result},paths:{...state.paths,[path]:next}}})
  return result
 }
 async function resolve(id){const row=(await read()).resources[id];return row?{...row}:null}
 async function project(operation){
  if(!['rename','remove'].includes(operation.kind))return
  const path=normalizeResourcePath(operation.path),target=operation.kind==='rename'?normalizeResourcePath(operation.result.path):null
  await store.updateJson(file,value=>{if(!value?.paths[path])return undefined;const id=value.paths[path],record=value.resources[id];if(!record)throw Error('资源版本身份不完整');if(target&&value.paths[target]&&value.paths[target]!==id)throw Error('目标已有另一资源身份');const paths={...value.paths};delete paths[path];if(target)paths[target]=id;return {...value,revision:value.revision+1,paths,resources:{...value.resources,[id]:{...record,path:target||record.path,deleted:!target}}}})
 }
 async function initializeVariableScopes(paths){
  if((await read()).scriptVariableScopes===1)return
  const existing=paths.map(path=>normalizeResourcePath(path))
  await store.updateJson(file,value=>{const state=value||empty();if(state.scriptVariableScopes===1)return
   const resources={...state.resources},mapping={...state.paths}
   for(const path of existing){const old=mapping[path],id=old&&resources[old]&&!resources[old].deleted?old:randomUUID();mapping[path]=id;resources[id]={...(resources[id]||{id,path,kind:resourceKind(path),deleted:false}),scriptVariableScope:resources[id]?.scriptVariableScope||'legacy'}}
   return {...state,revision:state.revision+1,scriptVariableScopes:1,resources,paths:mapping}
  })
 }
 return {claim,resolve,project,initializeVariableScopes}
}
