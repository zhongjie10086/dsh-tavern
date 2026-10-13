import {remapGamePresetControls} from './st-game-features.js'
import {isDeepStrictEqual} from 'node:util'
const copy=value=>structuredClone(value)
const scopes=['global','preset','character']
export function gameResourceModes(chat){return {preset:chat.resourceBindings?.preset?.mode|| (chat.bypassPlanId?'pinned':'follow'),scripts:Object.fromEntries(scopes.map(scope=>[scope,chat.resourceBindings?.scripts?.[scope]||'follow']))}}
const signature=chat=>JSON.stringify([chat.worldbookState?.revision,chat.openingWorldbookSnapshot?.version,chat.resourceBindings||null,chat.runtimePresetSnapshot?.digest,chat.runtimePresetPath,chat.tavernScriptTreeRevision||0,chat.tavernHelperLifecycleRevision||0,chat.presetControls||null,chat.playConfigRevision||0])
/** Refresh only at idle/view or the start of a foreground request, never mid-flight. */
export function createGameResourceBindings({chats,presets,identities,resolveScripts,migrateChat=async()=>false,isBusy=()=>false,mapControls=remapGamePresetControls,onChange=()=>{}}){
 const tails=new Map()
 function serialize(id,work){const previous=tails.get(id)||Promise.resolve(),job=previous.catch(()=>{}).then(work);tails.set(id,job);return job.finally(()=>{if(tails.get(id)===job)tails.delete(id)})}
 async function resolve(chat){
  const modes=gameResourceModes(chat),binding=copy(chat.resourceBindings||{version:1,scripts:modes.scripts}),next={...chat},warnings=[]
  const migrated=await migrateChat(next)
  let path=chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath||'',presetChanged=false
  binding.scripts={...modes.scripts}
  if(path&&!binding.preset?.id){const identity=await identities.claim(path);binding.preset={...binding.preset,id:identity.id,path,mode:modes.preset}}
  if(binding.preset?.id){const identity=await identities.resolve(binding.preset.id);if(identity&&!identity.deleted)path=identity.path;else warnings.push('绑定的共享预设已删除，当前局保留最后可用版本。')}
  if(path&&modes.preset==='follow'&&!warnings.length){
   let preset;try{preset=await presets.read(path)}catch{preset=null}
   if(!preset?.valid||!preset.recognized)warnings.push('共享预设不存在或不可读，当前局保留最后可用版本。')
   else if(binding.preset?.revision!==preset.revision){
    const value=await presets.runtime.fullSnapshot(path,{omitScriptLibraryDecoration:!!next.tavernScriptTrees})
    // A concurrent resource edit must not publish an incoherent snapshot.
    if((await presets.read(path))?.revision!==preset.revision)throw Error('预设正在更新，请稍后重试')
    next.runtimePresetSnapshot=value;next.runtimePresetPath=path;presetChanged=true
    binding.preset={...binding.preset,path,revision:preset.revision,mode:'follow'}
   }
  }
  if(!binding.preset)binding.preset={mode:modes.preset,path:''}
  if(!chat.resourceBindings&&chat.presetControls?.scope!=='local'){
   const controls=chat.presetControls||{}
   if(Object.keys(controls.entries||{}).length||Object.keys(controls.regexes||{}).length)binding.legacyControls={entries:copy(controls.entries||{}),regexes:copy(controls.regexes||{})}
   next.presetControls={...controls,entries:{},regexes:{},version:Number(controls.version||0)+1}
  }else if(presetChanged&&chat.presetControls?.scope==='local'){
   const mapped=mapControls(chat.presetControls,chat.runtimePresetSnapshot,next.runtimePresetSnapshot)
   if(mapped.unmatched?.length){warnings.push('本局覆盖有条目无法唯一映射，已保留原预设版本：'+mapped.unmatched.join('、'));next.runtimePresetSnapshot=chat.runtimePresetSnapshot;next.runtimePresetPath=chat.runtimePresetPath;binding.preset={...chat.resourceBindings?.preset};presetChanged=false}
   else next.presetControls=mapped.controls||mapped
  }
  next.resourceBindings=binding
  const scripts=await resolveScripts(next,modes.scripts)
  if(scripts){next.tavernScriptTrees=scripts.trees;binding.scriptRevision=isDeepStrictEqual(scripts.trees,chat.tavernScriptTrees)&&chat.resourceBindings?.scriptRevision!==undefined?chat.resourceBindings.scriptRevision:scripts.revision;binding.cardScriptsDigest=scripts.cardDigest}
  // A preset's library decoration is only an input to scope resolution. Once
  // selected trees exist, retaining all other cards here creates a second mirror
  // that the next startup migration archives and strips again.
  const removedLibrary=!!scripts?.trees&&Object.hasOwn(next.runtimePresetSnapshot||{},'scriptLibrary')
  if(removedLibrary){next.runtimePresetSnapshot={...next.runtimePresetSnapshot};delete next.runtimePresetSnapshot.scriptLibrary}
  const scriptsChanged=!isDeepStrictEqual(next.tavernScriptTrees,chat.tavernScriptTrees),controlsChanged=!isDeepStrictEqual(next.presetControls,chat.presetControls)
  next.resourceBindingWarnings=warnings
  const changed=migrated||presetChanged||scriptsChanged||controlsChanged||removedLibrary||!isDeepStrictEqual(binding,chat.resourceBindings)||!isDeepStrictEqual(warnings,chat.resourceBindingWarnings||[])
  if(!changed)return {changed:false,chat}
  if(scriptsChanged||presetChanged){next.tavernScriptTreeRevision=Number(chat.tavernScriptTreeRevision||0)+1;next.tavernHelperLifecycleRevision=Number(chat.tavernHelperLifecycleRevision||0)+1}
  next.playConfigRevision=Number(chat.playConfigRevision||0)+1
  delete next.resolvedRuntimePreset;delete next.preparedForegroundFrame
  return {changed:true,chat:next}
 }
 async function refresh(sessionId,{requestBoundary=false}={}){return serialize(sessionId,async()=>{
  for(let attempt=0;attempt<3;attempt++){
   const chat=await chats.forSession(sessionId);if(!chat||!['story','script'].includes(chat.mode||'story')||!requestBoundary&&isBusy(chat))return chat
   const before=signature(chat),result=await resolve(chat);if(!result.changed)return chat
   let retried=false
   const saved=await chats.update(chat.id,current=>{
    if(signature(current)!==before||!requestBoundary&&isBusy(current)){retried=true;return undefined}
    const variableFields=['tavernHelperScriptVariables','scriptVariableMigration']
    if(variableFields.some(key=>result.chat[key]!==chat[key]&&!isDeepStrictEqual(current[key],chat[key]))){retried=true;return undefined}
    for(const key of variableFields)if(result.chat[key]!==chat[key])current[key]=result.chat[key]
    for(const key of ['worldbookState','openingWorldbookSnapshot','cardContextSnapshotVersion','runtimePresetSnapshot','runtimePresetPath','resourceBindings','resourceBindingWarnings','presetControls','tavernScriptTrees','tavernScriptTreeRevision','tavernHelperLifecycleRevision','playConfigRevision'])if(result.chat[key]!==undefined)current[key]=result.chat[key]
    delete current.resolvedRuntimePreset;delete current.preparedForegroundFrame;return current
   },{source:'resources.follow'})
   if(retried)continue
   await onChange(saved);return saved
  }
  throw Error('本局资源配置正在变化，请稍后重试')
 })}
 async function setMode(sessionId,{kind,scope,mode},expectedRevision){
  if(!['follow','pinned'].includes(mode)||!['preset','script'].includes(kind)||kind==='script'&&!scopes.includes(scope))throw Error('资源跟随设置无效')
  await serialize(sessionId,async()=>{const chat=await chats.forSession(sessionId);if(!chat)throw Error('当前局不存在');await chats.update(chat.id,current=>{
   if(isBusy(current))throw Error('请等待当前生成和后台任务结束')
   if(Number(current.playConfigRevision||0)!==Number(expectedRevision))throw Error('本局设置已变化，请刷新')
   const binding=copy(current.resourceBindings||{version:1,scripts:gameResourceModes(current).scripts,preset:{mode:'follow',path:current.runtimePresetPath||current.runtimePresetSnapshot?.presetPath||''}})
   if(kind==='preset')binding.preset={...binding.preset,mode};else binding.scripts={...binding.scripts,[scope]:mode}
   current.resourceBindings=binding;current.playConfigRevision=Number(current.playConfigRevision||0)+1;return current
  },{source:'resources.mode'})})
  return refresh(sessionId)
 }
 return {refresh,setMode,resolve}
}
