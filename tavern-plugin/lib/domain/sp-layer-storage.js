import { createHash } from 'node:crypto'
const clone=v=>structuredClone(v)
const fields=['data','locks','template','templateData','guideData','fillProgress','dormant','lastFilledBody','summaryArchives']
const sheetKeys=data=>Object.keys(data||{}).filter(k=>k.startsWith('sheet_'))
const floorMessages=chat=>(chat.messages||[]).filter(m=>m.role==='assistant'&&!m.greeting)
function payload(state,history=false){const value=Object.fromEntries(fields.filter(k=>state[k]!==undefined).map(k=>[k,clone(state[k])]));value.companion={skills:clone(state.companion?.skills||{}),drafts:clone(state.companion?.drafts||[])};if(history)value.layerRecords=clone(state.layerRecords||{version:1,frames:[],checkpoints:{}});return value}
function apply(state,value){for(const key of [...fields,'layerRecords']){if(value[key]!==undefined)state[key]=clone(value[key]);else if(key!=='data')delete state[key]}state.companion={...state.companion,skills:clone(value.companion?.skills||{}),drafts:clone(value.companion?.drafts||[])};state.locks||={};state.fillProgress||={};state.lastFilledBody='';for(const key of ['vectorIndex','vectorRecall','vectorPreview','plot','agentResult','advancedPrepared'])delete state[key]}
export function normalizeIsolationCode(value){const code=String(value||'main').trim().normalize('NFC');if(!/^[\p{L}\p{N}_-]{1,64}$/u.test(code)||['__proto__','constructor','prototype'].includes(code))throw new Error('隔离标识仅支持 1–64 位文字、数字、下划线或短横线');return code}
function emptyPayload(state){const data=clone(state.templateData||state.data);for(const k of sheetKeys(data))data[k].content=[data[k].content[0]];return {data,locks:{},template:clone(state.template||null),templateData:clone(state.templateData||null),guideData:clone(state.guideData||null),fillProgress:{},dormant:{tables:{},columns:{}},layerRecords:{version:1,frames:[],checkpoints:{}}}}
function gc(history){history.checkpoints||={};const keep=new Set(history.frames.map(f=>f.hash));for(const hash of Object.keys(history.checkpoints))if(!keep.has(hash))delete history.checkpoints[hash]}
export function stampSpFloor(state,chat,reason='save',floorOverride){
 const messages=floorMessages(chat),floor=floorOverride??messages.length;if(!floor)return
 const h=state.layerRecords||={version:1,frames:[],checkpoints:{}},data=payload(state),hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');h.checkpoints||={};h.checkpoints[hash]=data
 h.frames=h.frames.filter(f=>f.floor!==floor).concat({floor,turn:messages[floor-1]?.turn??0,messageId:messages[floor-1]?.id||null,hash,at:Date.now(),reason}).sort((a,b)=>a.floor-b.floor)
 const cutoff=Math.max(1,messages.length-(state.retentionFloors||100)+1);h.frames=h.frames.filter(f=>f.floor>=cutoff);gc(h)
}
export function switchSpIsolation(state,chat,code){
 code=normalizeIsolationCode(code);const previous=state.isolationCode||'main';if(code===previous)return
 if(!state.layerRecords)stampSpFloor(state,chat,'迁移锚点')
 const spaces=state.isolationSpaces||={};spaces[previous]=payload(state,true);const target=spaces[code]||emptyPayload(state);delete spaces[code];apply(state,target);state.isolationCode=code;state.settings.selectedTables=state.settings.selectedTables.filter(k=>state.data[k]);state.settings.plotEnabled=false
}
export function cleanupSpFloors(state,chat,from,to){
 const floors=floorMessages(chat);to=to||floors.length;if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>floors.length)throw new Error('清理楼层范围无效')
 if(!state.layerRecords)stampSpFloor(state,chat,'迁移锚点')
 const h=clone(state.layerRecords);h.frames=h.frames.filter(f=>f.floor<from||f.floor>to)
 if(to===floors.length){const last=h.frames.at(-1);apply(state,last?h.checkpoints[last.hash]:emptyPayload(state))}
 gc(h);state.layerRecords=h;return {from,to,retained:h.frames.length}
}
export function captureSpDormant(state,next){
 const dormant=state.dormant||={tables:{},columns:{}},before=state.data
 for(const key of sheetKeys(before)){const table=before[key],id=table.uid||key,target=next.mapping[key];if(!target){dormant.tables[id]={key,table:clone(table),locks:clone(state.locks[key]||{}),at:Date.now()};continue}
 const headers=next.data[target].content[0];for(const [index,name] of table.content[0].entries())if(index>0&&!headers.includes(name)){const ck=JSON.stringify([id,name]);dormant.columns[ck]={key:target,uid:id,sheetName:table.name,header:name,index,values:Object.fromEntries(table.content.slice(1).map(row=>[String(row[0]),clone(row[index])])),sourceData:clone(table.sourceData||{}),at:Date.now()}}
 }
}
export function wakeSpDormant(state,kind,id){
 const dormant=state.dormant||{tables:{},columns:{}};
 if(kind==='table'){const item=dormant.tables[id];if(!item)throw new Error('休眠表不存在');if(state.data[item.key]||sheetKeys(state.data).some(k=>state.data[k].name===item.table.name))throw new Error('存在同名表或相同表标识，请先调整当前模板');state.data[item.key]=clone(item.table);state.locks[item.key]=clone(item.locks);if(state.templateData)state.templateData[item.key]=clone(item.table);delete dormant.tables[id]
 }else if(kind==='column'){const item=dormant.columns[id];if(!item)throw new Error('休眠列不存在');const key=sheetKeys(state.data).find(k=>(state.data[k].uid||k)===item.uid)||item.key,table=state.data[key];if(!table)throw new Error('请先唤醒所属表');if(table.content[0].includes(item.header))throw new Error('当前表已经有同名列');const at=Math.min(item.index,table.content[0].length);table.content[0].splice(at,0,item.header);for(const row of table.content.slice(1))row.splice(at,0,item.values[String(row[0])]??'');const lock=state.locks[key];if(lock){lock.columns=(lock.columns||[]).map(c=>c>=at?c+1:c);lock.cells=(lock.cells||[]).map(cell=>{const split=cell.lastIndexOf(':'),col=Number(cell.slice(split+1));return cell.slice(0,split)+':'+(col>=at?col+1:col)})}table.sourceData={...table.sourceData,ddl:''};if(state.templateData)state.templateData[key]=clone(table);delete dormant.columns[id]
 }else throw new Error('休眠类型无效');state.dormant=dormant
}
export function spLayerManagement(chat,state){
 const h=state.layerRecords||{frames:[]},dormant=state.dormant||{tables:{},columns:{}}
 return {isolationCode:state.isolationCode||'main',isolationCodes:[state.isolationCode||'main',...Object.keys(state.isolationSpaces||{})],layers:h.frames.map(({hash,...f})=>f),legacyAnchor:!state.layerRecords,dormant:[...Object.entries(dormant.tables).map(([id,e])=>({id,kind:'table',name:e.table.name,rows:e.table.content.length-1,columns:e.table.content[0].length,canWake:!state.data[e.key]})),...Object.entries(dormant.columns).map(([id,e])=>({id,kind:'column',name:e.sheetName+' · '+e.header,rows:Object.keys(e.values).length,canWake:true}))]}
}
