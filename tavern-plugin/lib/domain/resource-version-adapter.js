import {createHash,randomUUID} from 'node:crypto'
import {createResourceVersionPanelReader} from './resource-version-panel.js'
const copy=structuredClone,hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cardFields=['cardContextSnapshot','cardContentDigest','cardContextSnapshotVersion','cardContextRevision','userProfileContextSnapshot']
const cardValue=chat=>Object.fromEntries(cardFields.filter(key=>Object.hasOwn(chat,key)).map(key=>[key,copy(chat[key])]))
const stamp=chat=>hash([chat.playConfigRevision||0,chat.tavernHelperLifecycleRevision||0,chat.tavernScriptTreeRevision||0,chat.cardContextRevision||0,chat.runtimePresetSnapshot,chat.resourceBindings,chat.presetControls,chat.resourceVersionHistory])
/** IM5 references reuse the existing preset-history object directory. F can migrate
 * resourceVersionHistory ({key,id,archive,at}) without copying story/variables. */
export function createResourceVersionAdapter({chats,store,presets,scriptLibrary,worldbookPublication,playCardSnapshots,readCard,isBusy=()=>false,readScriptBase,withSourceLock=async(path,work)=>work()}){
 const reader=createResourceVersionPanelReader({chats,scriptLibrary,worldbookPublication,readScriptBase,
  readPreset:async chat=>{
   const current=chat.runtimePresetSnapshot||null,path=chat.runtimePresetPath||current?.presetPath||'';
   let shared,sharedResourceRevision;try{if(path){const resource=await presets.read(path);if(resource?.valid&&resource.recognized){shared=await presets.runtime.fullSnapshot(path);sharedResourceRevision=resource.revision}}}catch{}
   function plain(value){if(!value)return value;const next=copy(value);delete next.scriptLibrary;delete next.createdAt;return next}
   return {name:'预设 · '+(current?.presetName||'内置设置'),version:current?.digest||hash(current).slice(0,12),sharedVersion:shared?.digest,sharedResourceRevision,current:plain(current),shared:shared===undefined?undefined:plain(shared),localChanges:null};
  },readCharacter:async chat=>{
   const current=cardValue(chat);let shared,warning='';
   try{const card=await readCard(chat),status=await playCardSnapshots.updateStatus(chat,card);if(!status.digest)throw Error(status.error||'人物卡来源不可用');const patch=await playCardSnapshots.replacement(chat,card,status.digest);shared=cardValue(patch);delete shared.cardContextRevision}catch(e){warning=e.message}
   const selected=copy(current);delete selected.cardContextRevision;
   return {name:'人物卡背景',current:selected,shared,version:chat.cardContentDigest?.slice(0,12),sharedVersion:shared?.cardContentDigest?.slice(0,12),localChanges:null,warning};
  }});
 async function read(sessionId){const chat=await chats.forSession(sessionId),state=await reader(sessionId);state.chatStamp=stamp(chat);state.lifecycleRevision=Number(chat.tavernHelperLifecycleRevision)||0;state.treeRevision=Number(chat.tavernScriptTreeRevision)||0;state.configRevision=Number(chat.playConfigRevision)||0;
  for(const row of state.rows)if(row.kind!=='script')row.history=(chat.resourceVersionHistory||[]).filter(item=>item.key===row.key).map(({id,at})=>({id,label:new Date(at).toISOString()}));
  return state;
 }
 async function archive(value){const path='preset-history/'+hash(value)+'.json';await store.updateJson(path,current=>{if(current&&hash(current)!==hash(value))throw Error('资源恢复归档校验失败');return current?undefined:value});return path}
 async function commit(sessionId,request){
  const initial=await read(sessionId);if(initial.revision!==request.expectedRevision)throw Error('本局或共享资源已变化，请重新预览');
  const row=initial.rows.find(row=>row.key===request.key);if(!row||hash([initial.revision,row])!==request.expectedFingerprint)throw Error('本局或共享资源已变化，请重新预览');
  if(row.kind==='script')return scriptLibrary.apply(sessionId,initial.lifecycleRevision,{scopes:[row.scope],mode:request.mode,expectedLibraryRevision:(await scriptLibrary.get(sessionId)).revision,expectedTreeRevision:initial.treeRevision,expectedConfigRevision:initial.configRevision});
  if(!['preset','character'].includes(row.kind))throw Error('此资源请在本局世界书差异页管理');
  const chat=await chats.forSession(sessionId);
  await withSourceLock(row.kind==='preset'?chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath:chat.cardPath,()=>chats.update(chat.id,async current=>{
   if(stamp(current)!==initial.chatStamp||isBusy(current))throw Error('本局状态已变化或正在生成，请刷新');
   const latest=await read(sessionId),latestRow=latest.rows.find(item=>item.key===row.key);if(hash([latest.revision,latestRow])!==request.expectedFingerprint)throw Error('共享资源已变化，请重新预览');
   const before=row.kind==='preset'?{snapshot:copy(current.runtimePresetSnapshot||null),binding:copy(current.resourceBindings?.preset||{}),controls:copy(current.presetControls||{}),bypassPlanId:current.bypassPlanId||''}:cardValue(current);
   const recovery={key:row.key,id:randomUUID(),at:Date.now(),archive:await archive({kind:row.kind,value:before})};
   const rows=(current.resourceVersionHistory||[]).concat(recovery),counts=new Map();current.resourceVersionHistory=rows.slice().reverse().filter(item=>{const n=counts.get(item.key)||0;counts.set(item.key,n+1);return n<3}).reverse();
   if(row.kind==='preset'){current.runtimePresetSnapshot=copy(request.value);current.runtimePresetPath=request.value?.presetPath||'';current.resourceBindings={...current.resourceBindings,preset:{...current.resourceBindings?.preset,path:current.runtimePresetPath,revision:row.sharedResourceRevision,mode:request.mode}}}
   else {Object.assign(current,copy(request.value));current.cardContextRevision=Number(current.cardContextRevision||0)+1}
   current.playConfigRevision=Number(current.playConfigRevision||0)+1;current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1;delete current.resolvedRuntimePreset;delete current.preparedForegroundFrame;return current;
  },{source:'resource-versions.apply'}));return {applied:true};
 }
 async function restore(sessionId,request){const initial=await read(sessionId);if(initial.revision!==request.expectedRevision)throw Error('本局资源已变化，请刷新');const row=initial.rows.find(item=>item.key===request.key);if(!row)throw Error('本局资源已变化');if(row.kind==='script')return scriptLibrary.restoreLocal(sessionId,{scope:row.scope,archiveId:request.archiveId,expectedLifecycleRevision:initial.lifecycleRevision,expectedTreeRevision:initial.treeRevision,expectedConfigRevision:initial.configRevision});
  const chat=await chats.forSession(sessionId);
  await chats.update(chat.id,async current=>{
   if(stamp(current)!==initial.chatStamp||isBusy(current))throw Error('本局资源已变化或正在生成，请刷新');const item=(current.resourceVersionHistory||[]).find(item=>item.key===request.key&&item.id===request.archiveId);if(!item)throw Error('找不到本局资源归档');const saved=await store.readJson(item.archive);if(!saved||saved.kind!==row.kind||item.archive!=='preset-history/'+hash(saved)+'.json'||!saved.value||!Object.hasOwn(saved.value,row.kind==='preset'?'snapshot':'cardContextSnapshot'))throw Error('本局资源归档缺失或不完整');
   const before=row.kind==='preset'?{snapshot:copy(current.runtimePresetSnapshot||null),binding:copy(current.resourceBindings?.preset||{}),controls:copy(current.presetControls||{}),bypassPlanId:current.bypassPlanId||''}:cardValue(current);
   const recovery={key:row.key,id:randomUUID(),at:Date.now(),archive:await archive({kind:row.kind,value:before})};const rows=(current.resourceVersionHistory||[]).concat(recovery),counts=new Map();current.resourceVersionHistory=rows.slice().reverse().filter(item=>{const n=counts.get(item.key)||0;counts.set(item.key,n+1);return n<3}).reverse();
   if(row.kind==='preset'){current.runtimePresetSnapshot=copy(saved.value.snapshot);current.runtimePresetPath=saved.value.snapshot?.presetPath||'';current.resourceBindings={...current.resourceBindings,preset:{...copy(saved.value.binding),mode:'pinned'}};current.presetControls={...copy(saved.value.controls),version:Number(current.presetControls?.version||0)+1};current.bypassPlanId=saved.value.bypassPlanId}
   else {
    const previous=String(saved.value.userProfileContextSnapshot||''),active=String(current.userProfileContextSnapshot||'');let text=String(saved.value.cardContextSnapshot||'');
    if(previous){if(text===previous)text='';else if(text.startsWith(previous+'\n\n'))text=text.slice(previous.length+2);else throw Error('归档画像前缀无法分离，未恢复人物卡背景')}
    for(const key of cardFields)if(!['cardContextRevision','userProfileContextSnapshot','cardContextSnapshot'].includes(key)){if(Object.hasOwn(saved.value,key))current[key]=copy(saved.value[key]);else delete current[key]}
    current.cardContextSnapshot=[active,text].filter(Boolean).join('\n\n');current.cardContextRevision=Number(current.cardContextRevision||0)+1;
   }
   current.playConfigRevision=Number(current.playConfigRevision||0)+1;current.tavernHelperLifecycleRevision=Number(current.tavernHelperLifecycleRevision||0)+1;delete current.resolvedRuntimePreset;delete current.preparedForegroundFrame;return current;
  },{source:'resource-versions.restore'});return {restored:true};
 }
 return {read,commit,restore};
}
