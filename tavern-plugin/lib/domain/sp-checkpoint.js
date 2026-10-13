import { spLayerManagement } from './sp-layer-storage.js'
import { validateTableData, sheetKeys } from './sp-database.js'
const clone=v=>structuredClone(v)
function safe(value){if(Array.isArray(value)){for(const v of value)safe(v)}else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw new Error('Checkpoint 包含危险键');safe(v)}}
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v}
// Wire-compatible with SP 9.2.4 shared/utils.ts hashUserInput_ACU (including its signed accumulator).
export function spCheckpointHash(payload){const s=JSON.stringify(canonical(payload)).trim().replace(/\r\n/g,'\n').replace(/\r/g,'\n');let hash=2166136261;for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash+=(hash<<1)+(hash<<4)+(hash<<7)+(hash<<8)+(hash<<24)}return hash.toString(36)}
function emptyRows(data){return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,k.startsWith('sheet_')?{...clone(v),content:[clone(v.content[0])]}:clone(v)]))}
export function exportSpCheckpoint(state){
 const data=validateTableData(state.data),template=emptyRows(data),guide=emptyRows(data)
 for(const key of sheetKeys(data)){const old=state.templateData?.[key];if(old&&old.uid===data[key].uid&&old.name===data[key].name&&JSON.stringify(old.content?.[0])===JSON.stringify(data[key].content[0]))template[key].content=clone(old.content);guide[key]={...clone(state.guideData?.[key]||{}),...guide[key]}}
 const payload={format:'acu-table-checkpoint',version:1,createdAt:Date.now(),source:{storageMode:'native'},tableSnapshot:data,templateSnapshot:{data:clone(template),presetName:state.template?.name||'本局模板'},guideSnapshot:{data:clone(guide)}}
 const result={...payload,integrity:{algorithm:'fnv1a',payloadHash:spCheckpointHash(payload)}};parseSpCheckpoint(result);return result
}
export function parseSpCheckpoint(input){
 const raw=typeof input==='string'?JSON.parse(input):clone(input);safe(raw)
 if(raw?.format!=='acu-table-checkpoint'||raw.version!==1)throw new Error('请选择 SP·数据库 Checkpoint v1 文件')
 if(!Number.isFinite(raw.createdAt)||!['native','sqlite'].includes(raw.source?.storageMode))throw new Error('Checkpoint 元数据无效')
 if(!raw.templateSnapshot?.data||!raw.guideSnapshot?.data)throw new Error('Checkpoint 缺少模板或指导表')
 const payload={format:raw.format,version:raw.version,createdAt:raw.createdAt,source:{storageMode:raw.source.storageMode},tableSnapshot:raw.tableSnapshot,templateSnapshot:{data:raw.templateSnapshot.data,presetName:typeof raw.templateSnapshot.presetName==='string'?raw.templateSnapshot.presetName:''},guideSnapshot:{data:raw.guideSnapshot.data}}
 if(raw.integrity?.algorithm!=='fnv1a'||raw.integrity.payloadHash!==spCheckpointHash(payload))throw new Error('Checkpoint 完整性校验失败，文件可能已损坏')
 const data=validateTableData(payload.tableSnapshot),template=validateTableData(payload.templateSnapshot.data),guide=validateTableData({...payload.guideSnapshot.data,mate:payload.guideSnapshot.data.mate||template.mate}),keys=sheetKeys(template).sort()
 if(JSON.stringify(keys)!==JSON.stringify(sheetKeys(guide).sort())||sheetKeys(data).some(k=>!keys.includes(k)))throw new Error('Checkpoint 表格、模板和指导表的范围不一致')
 for(const k of keys)for(const other of [data[k],guide[k]].filter(Boolean))if(other.name!==template[k].name||String(other.uid||k)!==String(template[k].uid||k)||JSON.stringify(other.content[0])!==JSON.stringify(template[k].content[0]))throw new Error('Checkpoint 的表头或表格身份不一致：'+k)
 return {...raw,tableSnapshot:data,templateSnapshot:{...payload.templateSnapshot,data:template},guideSnapshot:{data:guide}}
}
export function spDataManagement(chat,state){const messages=(chat.messages||[]).filter(m=>m.role==='assistant'&&!m.greeting);return {floors:messages.map((m,index)=>({floor:index+1,turn:m.turn})),...spLayerManagement(chat,state),snapshotCount:state.snapshots?.length||0,snapshotKinds:Object.fromEntries(['automatic','manual','floor','legacy'].map(kind=>[kind,(state.snapshots||[]).filter(row=>(row.purpose||'legacy')===kind).length])),retentionFloors:state.retentionFloors||100}}
