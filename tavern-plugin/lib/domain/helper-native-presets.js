import {createHash} from 'node:crypto'
import {assertPluginJson} from './tavern-chat-plugin-data.js'
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const nameOf = path => path.split('/').pop().replace(/\.json$/i,'')
// SillyTavern 1.18 openai.js sensitiveFields. Only the native connection
// envelope is projected; prompt text and unknown extension data stay intact.
const sensitiveFields=['reverse_proxy','proxy_password','custom_url','custom_include_body','custom_exclude_body','custom_include_headers','vertexai_region','vertexai_express_project_id','azure_base_url','azure_deployment_name','workers_ai_account_id']
function project(preset,omitSensitive) {
 if(!omitSensitive)return preset
 const document=structuredClone(preset.document)
 for(const field of sensitiveFields)delete document[field]
 return {...preset,document}
}
/** Native ST documents are retained losslessly. Named library edits never mutate a game's snapshot. */
export function createNativePresetLibrary({presets,chats,store,assertOwner,remove,isBusy=()=>false}) {
 let tail=Promise.resolve(),catalogFlight=null;const known=new Map()
 async function current(sessionId) {
  const chat=await chats.forSession(sessionId);if(!chat)throw Error('请先进入游玩')
  const snapshot=chat.runtimePresetSnapshot,path=snapshot?.presetPath||'presets/内置设置.json',name=nameOf(path),document=structuredClone(snapshot?.compatibilityPresetDocument||{prompts:[]})
  return {catalog:{loadedName:name,revision:Number(chat.helperPresetRevision)||0,entries:[{name,path}]},preset:{name,path,document,digest:digest(document)}}
 }
 async function catalog(sessionId,{currentOnly=false}={}) {
  if(currentOnly)return (await current(sessionId)).catalog
  const chat=await chats.forSession(sessionId);if(!chat)throw Error('请先进入游玩')
  const rows=(await (catalogFlight||(catalogFlight=(presets.nativeCatalog?presets.nativeCatalog():presets.catalog()).finally(()=>{catalogFlight=null})))).presets.filter(p=>p.valid&&p.recognized)
  known.clear();for(const p of rows)known.set(nameOf(p.path),{name:nameOf(p.path),path:p.path})
  return {loadedName:nameOf(chat.runtimePresetSnapshot?.presetPath||'内置设置'),revision:Number(chat.helperPresetRevision)||0,entries:rows.map(p=>({name:nameOf(p.path),path:p.path}))}
 }
 async function read(sessionId,name,{currentOnly=false,omitSensitive=false}={}) {
  if(currentOnly){const result=await current(sessionId);if(name!==result.preset.name&&name!=='in_use')throw Error('只能读取当前局预设，其他预设需要卡片授权');return project(result.preset,omitSensitive)}
  if(!known.has(name))await catalog(sessionId)
  const entry=known.get(name)
  if(!entry)throw Error('预设不存在：'+name)
  const document=await presets.readDocument(entry.path);if(!document)throw Error('预设不存在：'+name)
  return project({...entry,document,digest:digest(document)},omitSensitive)
 }
 async function mutate(sessionId,command,scriptId,lifecycle) {
  const task=tail.catch(()=>{}).then(async()=>{
   const chat=await chats.forSession(sessionId);await assertOwner(sessionId,scriptId,lifecycle)
   if(!chat||isBusy(chat)||Object.values(chat.timeline?.operations||{}).some(op=>op.status==='running'))throw Error('请等待生成和后台任务完成后再修改预设')
   const name=String(command.name||'').trim()
   if(!name||name.length>160||/[\\/:*?"<>|]/.test(name)||['.','..','in_use'].includes(name))throw Error('预设名称无效')
   if(!['native-save','native-delete'].includes(command.kind))throw Error('未知原生预设操作')
   const entry=(await catalog(sessionId)).entries.find(e=>e.name===name),previous=entry?await presets.readDocument(entry.path):null
   if(command.expectedDigest!==(previous?digest(previous):null))throw Error('预设已被其他操作修改，请重新读取后重试')
   if(command.kind==='native-delete'&&!entry)throw Error('预设不存在：'+name)
   if(command.kind==='native-save') {
    assertPluginJson(command.preset,'原生预设')
    if(!Array.isArray(command.preset.prompts)||command.preset.prompts.length>3000)throw Error('预设提示词数组无效')
    await presets.snapshotDocument(entry?.path||'presets/'+name+'.json',command.preset)
   }
   await assertOwner(sessionId,scriptId,lifecycle)
   if(previous)await store.updateJson('preset-history/'+digest(previous)+'.json',current=>current?undefined:{at:Date.now(),path:entry.path,document:previous})
   if(command.kind==='native-delete')await remove(entry.path)
   else if(entry)await presets.replaceDocument(entry.path,command.preset,previous)
   else await presets.import({name:name+'.json',text:JSON.stringify(command.preset)})
   return {catalog:await catalog(sessionId),...(command.kind==='native-save'?{preset:await read(sessionId,name)}:{deleted:name})}
  });tail=task;return task
 }
 async function readAll(sessionId,options){const value=await catalog(sessionId,options);return {catalog:value,presets:await Promise.all(value.entries.map(e=>read(sessionId,e.name,options)))}}
 return {catalog,read,readAll,mutate}
}
