import { playRuntimeSettings, applyPlayRuntimePatch } from './play-runtime-settings.js'
import { randomUUID, createHash } from 'node:crypto'
const clone=v=>structuredClone(v)
export function presetSwitchStatus(chat){
 const reasons=[],controls=chat.presetControls||{},bindings=chat.resourceBindings||{}
 if(bindings.preset?.mode==='pinned'||chat.bypassPlanId)reasons.push('当前预设已固定或选用了本局方案')
 if(Object.keys(controls.entries||{}).length||Object.keys(controls.regexes||{}).length||(controls.plans||[]).length)reasons.push('有本局条目、正则开关或保存的方案')
 if(bindings.scripts?.preset==='pinned')reasons.push('预设脚本已固定')
 const last=chat.presetHistory?.at(-1),path=chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath||''
 return {requiresConfirmation:reasons.length>0,reasons,undo:last?.undoable&&last.appliedPresetPath===path?{archive:last.archive,name:last.presetName||'内置设置'}:null}
}
export function personaFrameInput(chat) {
 const p=chat?.tavernPersona;if(!p?.description?.trim())return []
 return [{kind:'foreground.writing-rules',required:true,text:'玩家身份：'+(p.name||chat.macroState?.userName||'你')+'\n'+p.description,source:{stage:'player-persona',personaId:p.id||''}}]
}
/** The library is shared; games follow the selected resource unless explicitly pinned. */
export function createPlayManagement({store,chats,presets,readScripts,builtinSnapshot=async()=>null,snapshotDatabase,isBusy=()=>false,settings=async()=>({}),validateModel=async()=>{}}) {
 const file='tavern-personas.json'
 async function library(){return await store.readJson(file)||{revision:0,personas:[]}}
 async function context(sessionId){const chat=await chats.forSession(sessionId);if(!chat||chat.mode==='card')throw new Error('请先进入游玩对话');return chat}
 async function read(sessionId){const chat=await context(sessionId);return {...await library(),current:clone(chat.tavernPersona||{id:'',name:chat.macroState?.userName||'你',description:''}),runtimeSettings:playRuntimeSettings(chat,await settings()),presetPath:chat.runtimePresetSnapshot?.presetPath||'',resourceBindings:clone(chat.resourceBindings||{}),resourceWarnings:clone(chat.resourceBindingWarnings||[]),presetSwitch:presetSwitchStatus(chat),configRevision:Number(chat.playConfigRevision)||0,lifecycleRevision:Number(chat.tavernHelperLifecycleRevision)||0}}
 async function archive(value){const encoded=JSON.stringify(value),digest=createHash('sha256').update(encoded).digest('hex'),path='preset-history/'+digest+'.json';await store.updateJson(path,current=>{if(current&&JSON.stringify(current)!==encoded)throw new Error('预设归档校验失败');return current?undefined:value});return path}
 async function compactState(current){
  if(current.presetHistory?.some(p=>p.snapshot!==undefined)){const entries=[];for(const p of current.presetHistory){if(p.snapshot===undefined){entries.push(p);continue}entries.push({at:p.at,presetPath:p.snapshot?.presetPath||'',presetName:p.snapshot?.presetName||'内置设置',archive:await archive(p)})}current.presetHistory=entries}
  if(current.tavernScriptTrees&&current.runtimePresetSnapshot?.scriptLibrary){current.runtimePresetSnapshot.scriptLibraryArchive=await archive({kind:'script-library',value:current.runtimePresetSnapshot.scriptLibrary});delete current.runtimePresetSnapshot.scriptLibrary}
  return current
 }
 async function compact(chatId,{signal}={}){signal?.throwIfAborted();return chats.update(chatId,async current=>{signal?.throwIfAborted();const next=isBusy(current)?current:await compactState(current);signal?.throwIfAborted();return next},{source:'play-management.archive',signal})}
 async function editPersona(operation,expectedRevision){
  let selected
  await store.updateJson(file,current=>{current||={revision:0,personas:[]};if(current.revision!==expectedRevision)throw new Error('身份库已变化，请重新读取');const next=clone(current),index=next.personas.findIndex(p=>p.id===operation.id)
   if(operation.kind==='delete'){if(index<0)throw new Error('身份不存在');next.personas.splice(index,1)}
   else if(operation.kind==='save'){
    const name=String(operation.persona?.name||'').trim(),description=String(operation.persona?.description||''),title=String(operation.persona?.title||'').slice(0,200)
    if(!name||name.length>80||description.length>50000)throw new Error('姓名需为 1–80 字，身份描述最多 50000 字')
    if(operation.id&&index<0)throw new Error('身份已被删除')
    selected={id:operation.id||randomUUID(),name,title,description,updatedAt:Date.now()};if(index<0)next.personas.push(selected);else next.personas[index]=selected
   }else throw new Error('未知身份操作')
   next.revision++;return next
  });return {library:await library(),saved:selected}
 }
 async function apply(sessionId,operation,expectedRevision){
  const chat=await context(sessionId);let value,trees,restored
  if(operation.kind==='runtime'){value=applyPlayRuntimePatch(chat,await settings(),operation.patch);if(value.backgroundModelSelection)await validateModel(value.backgroundModelSelection)}
  else if(operation.kind==='persona-default'){value={id:'',name:'你',description:''}}
  else if(operation.kind==='persona'){value=(await library()).personas.find(p=>p.id===operation.id);if(!value)throw new Error('身份不存在')}
  else if(operation.kind==='preset'){
   const path=String(operation.path||'');if(path){const p=await presets.read(path);if(!p?.valid||!p.recognized)throw new Error('该文件不是可用预设');value=await presets.runtime.fullSnapshot(path)}else value=await builtinSnapshot()
   trees=await readScripts(chat)
  }else if(operation.kind==='preset-undo'){
   const undo=presetSwitchStatus(chat).undo
   if(!undo||undo.archive!==operation.archive)throw Error('可撤销的预设切换已变化，请刷新')
   restored=await store.readJson(undo.archive)
   if(!restored||!Object.hasOwn(restored,'snapshot')||!Array.isArray(restored.presetScripts))throw Error('预设归档不存在或不完整，未改变本局')
   value=restored.snapshot;trees=await readScripts(chat)
  }else throw new Error('未知游玩设置操作')
  await chats.update(chat.id,async current=>{
   if(Number(current.playConfigRevision||0)!==expectedRevision||Number(current.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0))throw new Error('本局设置已变化，请重新读取')
   if(isBusy(current)||Object.values(current.timeline?.operations||{}).some(op=>op.kind==='body'&&op.status==='running'))throw new Error('请等本轮生成和后台任务完成后再切换')
   if(operation.kind==='runtime')Object.assign(current,value)
   else if(['persona','persona-default'].includes(operation.kind)){current.tavernPersona=clone(value);current.macroState={...current.macroState,userName:value.name}}
   else {
    if(!current.spDatabase&&snapshotDatabase)current.spDatabase=snapshotDatabase(current)
    if(restored&&presetSwitchStatus(current).undo?.archive!==operation.archive)throw Error('可撤销的预设切换已变化，请刷新')
    const previous={at:Date.now(),snapshot:clone(current.runtimePresetSnapshot||null),controls:clone(current.presetControls||{}),presetScripts:clone(trees.preset||[]),presetBinding:clone(current.resourceBindings?.preset||{path:current.runtimePresetPath||current.runtimePresetSnapshot?.presetPath||'',mode:current.bypassPlanId?'pinned':'follow'}),scriptMode:current.resourceBindings?.scripts?.preset||'follow',bypassPlanId:current.bypassPlanId||''}
    current.presetHistory=retainPresetVersions((current.presetHistory||[]).map(row=>({...row,undoable:false})).concat([{at:previous.at,presetPath:previous.snapshot?.presetPath||'',presetName:previous.snapshot?.presetName||'内置设置',archive:await archive(previous),undoable:!restored,appliedPresetPath:value?.presetPath||''}]),store.retention?.presetVersions)
    current.resourceBindings={...current.resourceBindings,version:1,preset:clone(restored?.presetBinding||{path:value?.presetPath||'',mode:'follow'}),scripts:{...current.resourceBindings?.scripts,preset:restored?.scriptMode||'follow'}};current.resourceBindingWarnings=[]
    current.runtimePresetSnapshot=clone(value);current.runtimePresetPath=value?.presetPath||'';current.bypassPlanId=restored?.bypassPlanId||'';current.presetControls={...(restored?clone(restored.controls||{}):{entries:{},regexes:{},plans:[]}),version:(current.presetControls?.version||0)+1}
    current.tavernScriptTrees={...trees,preset:clone(restored?restored.presetScripts:value?.scriptLibrary?.preset||[])};current.tavernScriptTreeRevision=(current.tavernScriptTreeRevision||0)+1
    current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1
   }
   await compactState(current)
   delete current.resolvedRuntimePreset;delete current.preparedForegroundFrame;current.playConfigRevision=Number(current.playConfigRevision||0)+1;return current
  },{source:'play-management.'+operation.kind});return read(sessionId)
 }
 return {read,editPersona,apply,compact}
}
import {retainPresetVersions} from './retention-policy.js'
