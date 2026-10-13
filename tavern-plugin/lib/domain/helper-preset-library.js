import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {assertPluginJson} from './tavern-chat-plugin-data.js'
import {presetHelperScripts} from './st-preset-compatibility.js'
const copy=structuredClone
const settingsMap={temperature:'temperature',top_p:'top_p',frequency_penalty:'frequency_penalty',presence_penalty:'presence_penalty',max_context:'openai_max_context',max_tokens:'openai_max_tokens',stream:'stream_openai',should_stream:'stream_openai',max_completion_tokens:'openai_max_tokens',reply_count:'n',reasoning_effort:'reasoning_effort',request_thoughts:'show_thoughts',enable_function_calling:'function_calling',squash_system_messages:'squash_system_messages',enable_web_search:'enable_web_search',request_images:'request_images',top_a:'top_a',seed:'seed',n:'n',top_k:'top_k',min_p:'min_p',repetition_penalty:'repetition_penalty'}
const nameOf=path=>path.split('/').pop().replace(/\.json$/i,'')
function orderOf(document){return (document.prompt_order||[]).find(g=>Number(g.character_id)===100001)||(document.prompt_order||[]).at(-1)||{order:[]}}
export function helperPresetFromNative(document,controls={}){
 const raw=copy(document||{}),refs=orderOf(raw).order||[],byId=new Map((raw.prompts||[]).map(p=>[String(p.identifier||p.id),p])),used=new Set(),occurrences=new Map()
 function prompt(p,enabled){const id=String(p.identifier||p.id);const occurrence=(occurrences.get(id)||0)+1;occurrences.set(id,occurrence);const key=id+'#'+occurrence;
  const extra=Object.fromEntries(Object.entries(p).filter(([k])=>!['identifier','id','name','role','enabled','content','injection_position','injection_depth','injection_order'].includes(k)))
  return {id,name:p.name||id,role:p.role||'system',enabled:Object.hasOwn(controls.entries||{},key)?controls.entries[key]:enabled!==false,position:Number(p.injection_position)===1?{type:'in_chat',depth:p.injection_depth??4,order:p.injection_order??100}:{type:'relative'},...(typeof p.content==='string'?{content:p.content}:{}),extra}
 }
 const prompts=refs.map(ref=>{const id=String(ref.identifier);used.add(id);return byId.has(id)?prompt(byId.get(id),ref.enabled):null}).filter(Boolean)
 if(!refs.length)for(const p of raw.prompts||[]){used.add(String(p.identifier||p.id));prompts.push(prompt(p,p.enabled))}
 const settings={};for(const [helper,native]of Object.entries(settingsMap))if(raw[native]!==undefined)settings[helper]=raw[native]
 return {settings,prompts,prompts_unused:(raw.prompts||[]).filter(p=>!used.has(String(p.identifier||p.id))).map(p=>prompt(p,p.enabled)),extensions:copy(raw.extensions||{})}
}
export function nativePresetFromHelper(value,base={}){
 assertPluginJson(value,'Helper 预设');if(value.__dshNativeDocument)base=copy(value.__dshNativeDocument);if(!Array.isArray(value.prompts)||!Array.isArray(value.prompts_unused||[]))throw new Error('预设缺少提示词数组')
 if(value.prompts.length+(value.prompts_unused||[]).length>3000)throw new Error('预设条目超过 3000')
 const next=copy(base),known=new Map((base.prompts||[]).map(p=>[String(p.identifier||p.id),p])),ids=new Set()
 function prompt(p){if(!p||!String(p.id||'').trim()||!['system','user','assistant'].includes(p.role||'system'))throw new Error('提示词 ID 或角色无效');const id=String(p.id);if(ids.has(id))throw new Error('提示词 ID 重复：'+id);ids.add(id)
  const position=p.position||{type:'relative'};if(!['relative','in_chat'].includes(position.type))throw new Error('提示词位置无效')
  if(position.type==='in_chat'&&(!Number.isInteger(position.depth)||position.depth<0||!Number.isFinite(position.order)))throw new Error('提示词深度或顺序无效')
  return {...copy(known.get(id)||{}),...copy(p.extra||{}),identifier:id,name:String(p.name||id),role:p.role||'system',enabled:p.enabled!==false,...(typeof p.content==='string'?{content:p.content}:{}),injection_position:position.type==='in_chat'?1:0,injection_depth:position.depth??4,injection_order:position.order??100}
 }
 next.prompts=[...value.prompts,...value.prompts_unused||[]].map(prompt)
 const selected=orderOf(base),group={...copy(selected),character_id:selected.character_id??100001,order:value.prompts.map(p=>({identifier:p.id,enabled:p.enabled!==false}))}
 next.prompt_order=(base.prompt_order||[]).filter(g=>g!==selected).map(g=>copy(g)).concat([group]);next.extensions=copy(value.extensions??base.extensions??{})
 const initial=helperPresetFromNative(base).settings,grouped={};for(const [helper,native]of Object.entries(settingsMap))if(Object.hasOwn(value.settings||{},helper)){(grouped[native]||=[]).push(helper)}
 for(const [native,aliases]of Object.entries(grouped)){const changed=aliases.filter(k=>!isDeepStrictEqual(value.settings[k],initial[k]));if(changed.length>1&&changed.some(k=>!isDeepStrictEqual(value.settings[k],value.settings[changed[0]])))throw new Error('预设参数别名值冲突：'+aliases.join('/'));next[native]=copy(value.settings[changed[0]||aliases[0]])}
 return next
}
/** The loaded chat copy and named library preset have separate persistence semantics. */
export function createHelperPresetLibrary({presets,chats,store,assertOwner,isBusy=()=>false}){
 const tails=new Map()
 async function read(sessionId,{currentOnly=false}={}){const chat=await chats.forSession(sessionId);if(!chat)throw new Error('请先进入游玩');
  const snapshot=chat.runtimePresetSnapshot, catalog=currentOnly?{presets:snapshot?.compatibilityPresetDocument?[{path:snapshot.presetPath||'presets/内置设置.json',document:snapshot.compatibilityPresetDocument,valid:true,recognized:true}]:[]}:await (presets.nativeCatalog?presets.nativeCatalog():presets.catalog()),entries=[]
  for(const item of catalog.presets.filter(p=>p.valid&&p.recognized)){const document=item.document??await presets.readDocument(item.path);if(Array.isArray(document?.prompts))entries.push({name:nameOf(item.path),path:item.path,preset:helperPresetFromNative(document)})}
  return {advice:{enabled:chat.presetControls?.advice===true,config:chat.presetControls?.adviceConfig||{position:"tail",stripModelAdvice:true,displayAdviceForUser:true}},revision:Number(chat.helperPresetRevision)||0,loadedName:nameOf(chat.runtimePresetSnapshot?.presetPath||'内置设置'),inUse:helperPresetFromNative(chat.runtimePresetSnapshot?.compatibilityPresetDocument,chat.presetControls),entries}
 }
 async function archive(value){const text=JSON.stringify(value),digest=createHash('sha256').update(text).digest('hex'),path='preset-history/'+digest+'.json';await store.updateJson(path,current=>current?undefined:value);return path}
 async function mutate(sessionId,command,scriptId,lifecycle){
  const previous=tails.get(sessionId)||Promise.resolve();const task=previous.catch(()=>{}).then(async()=>{
   const chat=await chats.forSession(sessionId);await assertOwner(sessionId,scriptId,lifecycle);if(isBusy(chat)||Object.values(chat.timeline?.operations||{}).some(op=>op.status==='running'))throw new Error('请等待生成和后台任务完成后再修改预设')
   if(Number(command.expectedRevision)!==Number(chat.helperPresetRevision||0))throw new Error('预设已变化，请重新读取')
   const current=await read(sessionId),name=String(command.name||'in_use').trim(),entry=current.entries.find(e=>e.name===name)
   if(!name||name.length>160||/[\\/:*?"<>|]/.test(name)||['.','..'].includes(name))throw new Error('预设名称无效')
   if(command.kind==='replace'&&name!=='in_use'&&!entry)throw new Error('预设不存在：'+name)
   if(command.kind==='load'&&!entry)throw new Error('预设不存在：'+name)
   const base=name==='in_use'?chat.runtimePresetSnapshot?.compatibilityPresetDocument||{}:entry?await presets.readDocument(entry.path):{}
   if(command.expectedPreset&&!isDeepStrictEqual(command.expectedPreset,name==='in_use'?current.inUse:entry?.preset))throw new Error('预设内容已被其他操作修改，请刷新')
   let document,snapshot,loadedPath
   if(command.kind==='load'){loadedPath=entry.path;document=base;snapshot=await presets.runtime.fullSnapshot(entry.path)}
   else if(['replace','create'].includes(command.kind)){
    document=nativePresetFromHelper(command.preset,base)
    if(name==='in_use'){loadedPath=chat.runtimePresetSnapshot?.presetPath||'presets/内置设置.json';snapshot=await presets.snapshotDocument(loadedPath,document)}
    else if(entry){await archive({at:Date.now(),path:entry.path,document:base});await presets.replaceDocument(entry.path,document,base)}
    else await presets.import({name:name+'.json',text:JSON.stringify(document)})
   }else throw new Error('未知预设操作')
   // Named edits update the library. Following games refresh at their next idle/request boundary.
   if(name!=='in_use'&&command.kind!=='load')return {updated:true,presets:await read(sessionId)}
   await chats.update(chat.id,async latest=>{
    if(Number(latest.helperPresetRevision||0)!==Number(command.expectedRevision)||Number(latest.tavernHelperLifecycleRevision||0)!==Number(lifecycle))throw new Error('本局已变化，请重新读取')
    if(isBusy(latest)||Object.values(latest.timeline?.operations||{}).some(op=>op.status==='running'))throw new Error('本局正在生成，请稍后再试')
    if(snapshot){const previousScripts=copy(latest.tavernScriptTrees?.preset||presetHelperScripts(latest.runtimePresetSnapshot?.compatibilityPresetDocument));const prior={at:Date.now(),snapshot:latest.runtimePresetSnapshot||null,controls:latest.presetControls||{}};const archived=await archive(prior);latest.presetHistory=retainPresetVersions((latest.presetHistory||[]).concat([{at:prior.at,presetPath:prior.snapshot?.presetPath||'',presetName:prior.snapshot?.presetName||'内置设置',archive:archived}]),store.retention?.presetVersions)
     latest.resourceBindings={...latest.resourceBindings,version:1,preset:command.kind==='load'?{path:loadedPath,mode:'follow'}:{...latest.resourceBindings?.preset,path:loadedPath,mode:'pinned'},scripts:{...latest.resourceBindings?.scripts,preset:command.kind==='load'?'follow':'pinned'}};latest.playConfigRevision=Number(latest.playConfigRevision||0)+1;latest.resourceBindingWarnings=[]
     latest.runtimePresetSnapshot=snapshot;latest.runtimePresetPath=loadedPath;latest.presetControls={...latest.presetControls,entries:{},regexes:{},scope:command.kind==='load'?'shared':'local',version:Number(latest.presetControls?.version||0)+1};delete latest.resolvedRuntimePreset;delete latest.preparedForegroundFrame
     if(command.kind==='load'){const nextScripts=copy(snapshot.scriptLibrary?.preset||presetHelperScripts(document));latest.tavernScriptTrees={...latest.tavernScriptTrees,preset:nextScripts};if(!isDeepStrictEqual(previousScripts,nextScripts))latest.tavernHelperLifecycleRevision=Number(latest.tavernHelperLifecycleRevision||0)+1}
    }
    latest.helperPresetRevision=Number(latest.helperPresetRevision||0)+1;return latest
   },{source:'helper-preset.'+command.kind})
   return {updated:true,presets:await read(sessionId)}
  });tails.set(sessionId,task);try{return await task}finally{if(tails.get(sessionId)===task)tails.delete(sessionId)}
 }
 return {read,mutate}
}
import {retainPresetVersions} from './retention-policy.js'
