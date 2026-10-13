import { contextForFill } from './sp-context-rules.js'
import { compatibilityKeywordMatch } from './compatibility-worldbook.js'
const clone = value => structuredClone(value)
const keys = data => Object.keys(data || {}).filter(k => k.startsWith('sheet_'))
export const SP_FILL_DEFAULTS = Object.freeze({selectedNone:false,skipLatest:0,batchSize:3,minChars:0,manualDepth:1,manualBatchSize:1,manualExtraHint:'',worldbookSource:'bound',extraBooks:[],entrySelection:{},injectionTarget:'chat',promptSegments:[],tableEditLastPairOnly:true,discardUnauthorizedSql:true})
export function normalizeFillOptions(value={}) {
 const c={...clone(SP_FILL_DEFAULTS),...value}
 for(const [k,min,max] of [['skipLatest',0,10000],['batchSize',1,100],['minChars',0,100000],['manualDepth',1,10000],['manualBatchSize',1,100]])if(!Number.isSafeInteger(c[k])||c[k]<min||c[k]>max)throw new Error('填表参数无效：'+k)
 if(!['bound','manual'].includes(c.worldbookSource)||!Array.isArray(c.extraBooks)||c.extraBooks.some(s=>typeof s!=='string'))throw new Error('填表世界书范围无效')
 if(!c.entrySelection||typeof c.entrySelection!=='object'||Array.isArray(c.entrySelection)||Object.values(c.entrySelection).some(v=>typeof v!=='boolean'))throw new Error('世界书条目开关无效')
 if(typeof c.injectionTarget!=='string'||typeof c.manualExtraHint!=='string')throw new Error('填写配置格式无效')
 for(const k of ['tableEditLastPairOnly','discardUnauthorizedSql','selectedNone'])if(typeof c[k]!=='boolean')throw new Error('填写开关无效')
 if(!Array.isArray(c.promptSegments)||c.promptSegments.length>100)throw new Error('提示词分段过多')
 c.promptSegments=c.promptSegments.map(p=>{if(!p||!['system','user','assistant'].includes(p.role)||typeof p.content!=='string')throw new Error('提示词分段格式无效');return {name:String(p.name||''),role:p.role,enabled:p.enabled!==false,content:p.content}})
 return c
}
export function fillFloors(chat) { return (chat.messages||[]).filter(m=>m.role==='assistant'&&!m.greeting) }
export function fillMessages(chat,from,to) {
 const floors=fillFloors(chat),start=from>1?chat.messages.indexOf(floors[from-2])+1:0,end=chat.messages.indexOf(floors[to-1]);return end<0?[]:chat.messages.slice(start,end+1).filter(m=>!m.greeting)
}
export function planManualFill(chat,state,kind='manual-fill',overrides={}) {
 const c=normalizeFillOptions(state.settings.fill),all=fillFloors(chat),end=Math.max(0,all.length-(kind==='catch-up'?c.skipLatest:0))
 const selected=overrides.tables|| (c.selectedNone?[]:state.settings.selectedTables.length?state.settings.selectedTables:keys(state.data));if(!Array.isArray(selected)||!selected.length||selected.some(k=>!state.data[k]))throw new Error('请选择有效表格')
 const groupSize=overrides.groupSize??c.manualBatchSize,depth=overrides.depth??c.manualDepth;if(!Number.isInteger(groupSize)||groupSize<1||groupSize>100||!Number.isInteger(depth)||depth<1||depth>10000)throw new Error('手动填写范围无效')
 const plan=[];if(!end)throw new Error('当前没有可填写的 AI 正文楼层')
 const starts=Object.fromEntries(selected.map(k=>[k,kind==='catch-up'?Math.max(1,(state.fillProgress?.[k]?.floor||0)+1):Math.max(1,end-depth+1)]))
 for(let from=Math.min(...Object.values(starts));from<=end;from+=groupSize){const to=Math.min(end,from+groupSize-1),tables=selected.filter(k=>starts[k]<=from);if(tables.length)plan.push({from,to,tables,messages:fillMessages(chat,from,to)})
   // Start a separate group at a later table frontier instead of silently omitting it.
   const next=Math.min(...Object.values(starts).filter(n=>n>from&&n<=to));if(Number.isFinite(next)){plan.pop();plan.push({from,to:next-1,tables,messages:fillMessages(chat,from,next-1)});from=next-groupSize}
 }
 return plan.filter(p=>p.tables.length)
}
export function parseFillOutput(source,settings) {
 let result=String(source||'').trim(),pairs=[...result.matchAll(/<tableEdit\b[^>]*>([\s\S]*?)<\/tableEdit\s*>/gi)]
 if(pairs.length)result=settings.fill?.tableEditLastPairOnly!==false?pairs.at(-1)[1]:pairs.map(p=>p[1]).join('\n')
 return result.trim().replace(/^\x60\x60\x60(?:json|sql|sqlite)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'')
}
// Keep model-relevant table instructions; archival/UI/export settings stay in storage.
export function projectFillTables(tables,{sql=false}={}) {
 return Object.fromEntries(Object.entries(tables).map(([key,table])=>{
  if(!table||typeof table!=='object')return [key,table]
  const sourceData={...table.sourceData};if(sql)delete sourceData.ddl
  return [key,{name:table.name,content:table.content,...(table.description?{description:table.description}:{}),...(Object.keys(sourceData).length?{sourceData}:{})}]
 }))
}
export function fillPromptMessages(settings,{tables,locks,story,worldbook=''}) {
 const projected=projectFillTables(tables,{sql:settings.generationFormat==='sql'}),selectedLocks=Object.fromEntries(Object.entries(locks||{}).filter(([key])=>Object.hasOwn(tables,key)))
 const values={A:{tables:projected,locks:selectedLocks},B:story,C:worldbook},slots={A:JSON.stringify(values.A),B:JSON.stringify(story),C:worldbook},used=new Set()
 const messages=(settings.fill?.promptSegments||[]).filter(p=>p.enabled!==false).map(p=>({role:p.role,content:[{type:'text',text:p.content.replace(/\$([ABC])\b|\{\{(tables|story|worldbook)\}\}/g,(m,letter,name)=>{const key=letter||({tables:'A',story:'B',worldbook:'C'})[name];used.add(key);return slots[key]})}]}))
 const remaining={...(!used.has('A')?values.A:{}),...(!used.has('B')?{story}:{}),...(!used.has('C')&&worldbook?{worldbook}:{})}
 if(Object.keys(remaining).length)messages.push({role:'user',content:[{type:'text',text:JSON.stringify(remaining)}]})
 return messages
}
export async function fillReferenceText(chat,settings,books,{story}={}) {
 if(!books)return ''
 const c=normalizeFillOptions(settings.fill),entries=await books.entries(chat,c.worldbookSource==='manual'?c.extraBooks:[''])
 const source=typeof story==='string'?story:(story||contextForFill(chat.messages,settings)).map(m=>m.text||'').join('\n')
 return entries.filter(e=>e.enabled!==false&&!e.spMirror&&c.entrySelection[e.id]!==false).filter(e=>{
  if(c.worldbookSource==='manual'||c.entrySelection[e.id]===true)return true
  const primaryKeys=e.primaryKeys||e.keys||[]
  return e.constant===true||primaryKeys.length===0||compatibilityKeywordMatch({...e,primaryKeys},source)
 }).map(e=>e.title+'\n'+e.content).join('\n\n')
}
export function fillStory(chat,state,from,to){return contextForFill(fillMessages(chat,from,to),{...state.settings,contextTurns:Math.max(state.settings.contextTurns,to-from+1)*2})}
