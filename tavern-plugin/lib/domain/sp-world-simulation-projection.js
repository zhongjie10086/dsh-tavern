import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {replaceTavernHelperMessages} from './tavern-helper-context.js'
const start='<!-- qrf-world-simulation-projection:v2:start -->',end='<!-- qrf-world-simulation-projection:v2:end -->'
const block=/(?:\r?\n)*(?:<!-- qrf-world-simulation-projection:v1:start -->[\s\S]*?<!-- qrf-world-simulation-projection:v1:end -->|<!-- qrf-world-simulation-projection:v2:start -->[\s\S]*?<!-- qrf-world-simulation-projection:v2:end -->)(?:\r?\n)*/g
const defaultTemplate='<div hidden class="qrf-world-simulation-projection" style="display:none">\n<与此同时>\n$WORLD_SIGNALS\n</与此同时>\n</div>'
export function worldSimulationProjectedBody(body,ledger,template){
 const groups={encounter:[],rumor:[],ambient:[]},labels={encounter:'【此地此刻】',rumor:'【风闻轶事】',ambient:'【世界暗流】'}
 for(const signal of ledger.guidance.signals){if(!signal||!Object.hasOwn(groups,signal.voice)||typeof signal.text!=='string')throw Error('推演信号无效');const text=signal.text.trim();if(text)groups[signal.voice].push(text)}
 const lines=Object.keys(groups).flatMap(key=>groups[key].length?[labels[key]+'\n'+groups[key].map(text=>'- '+text).join('\n')]:[])
 const valid=typeof template==='string'&&template.trim()&&template.length<=4000&&template.split('$WORLD_SIGNALS').length===2&&!template.includes('qrf-world-simulation-projection:v')
 const projection=lines.length?start+'\n'+(valid?template:defaultTemplate).replace('$WORLD_SIGNALS',()=>lines.join('\n'))+'\n'+end:null,base=String(body??'').replace(block,'').trimEnd()
 return projection?base+(base?'\n\n':'')+projection:base
}
// Called only inside the existing plugin-data JSON transaction, after its CAS merge.
export function applyWorldSimulationProjection(current,next,baselines,request){
 const patch=request.worldSimulationProjection;if(!patch)return next
 const before=baselines.get(patch.stateRevision),index=patch.message_id,old=before?.messages?.[index],latest=current.messages?.[index]
 const identity=row=>row&&[row.id??null,row.role,row.turn??null,row.sourceText??row.text??'',row.swipeId??0,row.swipes??[]]
 if(!before||before.id!==current.id||before._storageRevision!==patch.stateRevision||before.tavernHelperLifecycleRevision!==current.tavernHelperLifecycleRevision||!old||!latest||old.role!=='assistant'||!isDeepStrictEqual(identity(old),identity(latest)))throw Error('推演锚点版本已变化')
 const previous=current.messages[0]?.tavernPluginData?._qrf_world_simulation,envelope=next.messages[0]?.tavernPluginData?._qrf_world_simulation,task=envelope?.task,commit=envelope?.timeline?.at(-1)
 if(typeof previous?.task?.activeRun?.runId!=='string'||!previous.task.activeRun.runId||!Number.isSafeInteger(envelope?.ledger?.revision)||!Number.isSafeInteger(previous?.ledger?.revision)||task?.status!=='completed'||task.activeRun!==null||task.taskId!==previous.task.taskId||commit?.kind!=='committed'||commit.runId!==previous.task.activeRun.runId||commit.taskId!==task.taskId||envelope.ledger.revision<previous.ledger.revision||envelope.ledger.revision===previous.ledger.revision&&!hasConfirmedRunProof(current,index,previous,envelope.ledger))throw Error('正文投影必须与原推演账本完成联合提交')
 const expected=worldSimulationProjectedBody(latest.sourceText??latest.text,envelope.ledger,envelope.settings?.projection?.template)
 if(patch.message!==expected)throw Error('推演投影之外的正文修改被拒绝')
 const display=latest.tavernTemplateDisplay,displaySource=latest.projectionText??latest.sourceText??latest.text
 replaceTavernHelperMessages(next,[{message_id:index,message:expected}]);delete next.messages[index].bodyEdit
 // The compiled display is durable output, not a cache to recompute. Preserve
 // its HTML, parts and extension fields; replace only the owned guidance block.
 if(display?.sourceText===displaySource&&typeof display.html==='string'){
  const projection=worldSimulationProjectedBody('',envelope.ledger,envelope.settings?.projection?.template),strip=text=>String(text).replace(block,''),append=text=>text+(projection?(text?'\n\n':'')+projection:'')
  const updated={...structuredClone(display),sourceText:next.messages[index].projectionText,html:append(strip(display.html))}
  if(Array.isArray(display.parts)){let inserted=false;updated.parts=display.parts.map(part=>{if(part.kind==='markdown'&&typeof part.text==='string')return{...structuredClone(part),text:strip(part.text)};if(part.kind!=='html'||typeof part.content!=='string')return structuredClone(part);const clean=strip(part.content);if(clean===part.content)return structuredClone(part);const content=inserted?clean:append(clean);inserted=true;return{...structuredClone(part),content}});if(!inserted&&projection)updated.parts.push({kind:'html',content:projection})}
  next.messages[index].tavernTemplateDisplay=updated
 }
 return next
}

// Original partial-write commits can finish without advancing the ledger again.
// Require a previously durable, validated proof for this exact host target/run.
function hasConfirmedRunProof(chat,index,envelope,ledger){
 const bucket=chat.messages[index]?.tavernPluginData?._qrf_world_simulation_run_writes,run=envelope.task.activeRun
 if(bucket?.schemaVersion!==1||!bucket.entries||typeof bucket.entries!=='object')return false
 const hash=value=>createHash('sha256').update(value).digest('hex'),canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value)
 const keys=['schemaVersion','runId','taskId','stageId','stageRevision','baseLedgerRevision','confirmedWrites','ledgerRevision','fingerprint','stateDigest','evidenceRefs','written']
 const candidates=Object.entries(bucket.entries).filter(([key,row])=>{const a=row?.anchor;return a&&a.kind!=='logical'&&!a.logicalRef&&a.chatIdentity===chat.id&&a.messageKey==='number:'+index&&a.swipeId===String(chat.messages[index].swipeId||0)&&[hash([a.chatIdentity,a.messageKey,a.swipeId].join('\n')),hash([a.chatIdentity,a.messageKey,a.swipeId,a.contentDigest].join('\n'))].includes(key)&&Number.isInteger(row.updatedAt)&&row.updatedAt>=0})
 const currentKey=hash([chat.id,'number:'+index,String(chat.messages[index].swipeId||0)].join('\n'));candidates.sort((a,b)=>b[1].updatedAt-a[1].updatedAt);const row=Object.hasOwn(bucket.entries,currentKey)?candidates.find(([key])=>key===currentKey)?.[1]:candidates[0]?.[1],proof=row?.value
 if(!proof||typeof proof!=='object'||keys.some(key=>!Object.hasOwn(proof,key))||Object.keys(proof).some(key=>!keys.includes(key))||proof.schemaVersion!==1||['runId','taskId','stageId','fingerprint','stateDigest'].some(key=>typeof proof[key]!=='string'||!proof[key].trim())||['stageRevision','baseLedgerRevision','confirmedWrites','ledgerRevision'].some(key=>!Number.isSafeInteger(proof[key])||proof[key]<0)||proof.confirmedWrites<1||proof.ledgerRevision<proof.baseLedgerRevision||!Array.isArray(proof.evidenceRefs)||proof.evidenceRefs.some(ref=>typeof ref!=='string'||!ref.trim())||!proof.written||typeof proof.written!=='object'||Array.isArray(proof.written)||Object.entries(proof.written).some(([key,values])=>!key.trim()||!Array.isArray(values)||!values.length||values.some(value=>typeof value!=='string'||!value.trim())))return false
 if(candidates.some(([,other])=>other.updatedAt===row.updatedAt&&!isDeepStrictEqual(other.value,proof)))return false
 let state;try{state=JSON.parse(proof.fingerprint)}catch{return false}
 if(!isDeepStrictEqual(state?.ledger?.guidance,ledger.guidance))return false
 return proof.runId===run.runId&&proof.taskId===envelope.task.taskId&&proof.stageId===envelope.activeStageId&&proof.stageRevision===run.stageRevision&&proof.baseLedgerRevision===run.baseLedgerRevision&&proof.ledgerRevision===envelope.ledger.revision&&proof.stateDigest===hash(canonical(Object.fromEntries(Object.entries(proof).filter(([key])=>key!=='stateDigest'))))
}
