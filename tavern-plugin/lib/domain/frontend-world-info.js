import {inspectWorldBookDocument} from './worldbook-resource.js'
import {selectCompatibilityWorldInfo} from './compatibility-worldbook.js'

// Pure selection of already scoped, client-supplied documents. No resource lookup
// or persistence: temporary Choice per-entry overrides cannot edit a worldbook.
export function selectFrontendWorldInfo(input, chat, settings = {}) {
  if (!input || !Array.isArray(input.documents) || input.documents.length > 100 || !Array.isArray(input.messages) || input.messages.some(m=>typeof m !== 'string')) throw Error('世界书扫描参数无效')
  const entries = input.documents.flatMap((doc,i)=>inspectWorldBookDocument(doc).entries.map(entry=>({...entry,ref:i+':'+entry.ref})))
  if (entries.length > 10000) throw Error('世界书扫描条目过多')
  const result = selectCompatibilityWorldInfo({chat:{...chat,messages:input.messages.slice().reverse().map(text=>({role:'assistant',text}))},entries,input:'',settings:{...settings,max_context:Math.min(128000,Math.max(1,Number(input.maxContext)||8192))}})
  return {worldInfoBefore:result.before,worldInfoAfter:result.after,worldInfoDepth:result.depth.map(row=>({depth:row.depth,role:row.role,entries:[row.content]})),worldInfoExamples:[...result.examplesBefore,...result.examplesAfter].map(content=>({content})),anBefore:[],anAfter:[],diagnostics:result.diagnostics}
}
