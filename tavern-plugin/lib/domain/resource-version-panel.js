import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
const clone=value=>structuredClone(value)
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const pointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1')
/** Actual scriptLibrary.get / privateWorldbookPublication.inspect projection.
 * Preset/card readers supply snapshots from their existing version services. */
export function createResourceVersionPanelReader({chats,scriptLibrary,worldbookPublication,readPreset,readCharacter,readScriptBase}){
 return async sessionId=>{
  const chat=await chats.forSession(sessionId);if(!chat)throw Error('请先进入一局游玩');
  const [scripts,worldbooks,preset,character]=await Promise.all([scriptLibrary.get(sessionId),worldbookPublication.inspect(sessionId),readPreset?.(chat),readCharacter?.(chat)]);
  const rows=await Promise.all(['global','preset','character','chat'].map(async scope=>{
   const current=scripts.current[scope]||[],shared=scope==='chat'?undefined:scripts.library[scope]||[];
   const base=scope==='chat'?[]:await readScriptBase?.(chat,scope,scripts);
   function count(items){return items.reduce((sum,item)=>sum+(item.type==='folder'?count(item.scripts||[]):1),0)}
   return {key:'script:'+scope,kind:'script',scope,mode:scope==='chat'?'local':scripts.versionStatus?.scopes?.[scope]||'follow',version:digest(current).slice(0,12),sharedVersion:shared===undefined?undefined:digest(shared).slice(0,12),current,shared,base,localChanges:scope==='chat'?count(current):base===undefined?null:resourceVersionDiff(base,current).total,history:(chat.tavernScriptHistory||[]).filter(row=>row.scope===scope).map(({id,at})=>({id,label:new Date(at).toISOString()}))};
  }));
  if(preset)rows.push({...preset,key:'preset',kind:'preset',mode:chat.resourceBindings?.preset?.mode||'follow'});
  if(character)rows.push({...character,key:'character',kind:'character',mode:'pinned',canFollow:false});
  for(const book of worldbooks.books||[])rows.push({key:'worldbook:'+book.key,kind:'worldbook',name:book.name,mode:'local',version:book.revision?.slice(0,12),localChanges:book.count,current:null,base:null,history:[],action:'worldbook',warning:book.warning});
  if(!worldbooks.books?.length)rows.push({key:'worldbook:all',kind:'worldbook',name:'世界书 · 公共未改条目跟随，本局覆盖保留',mode:'local',version:chat.worldbookState?.revision??'当前',localChanges:0,current:null,base:null,action:'worldbook'});
  return {revision:digest([chat.playConfigRevision||0,scripts.lifecycleRevision,scripts.revision,worldbooks.books,preset,character]),rows};
 }
}
/** Values are omitted by default: listing a panel never ships script source or credentials. */
export function resourceVersionDiff(before,after,{limit=200}={}){
 const changes=[];let total=0;
 function visit(a,b,path){
  if(isDeepStrictEqual(a,b))return;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   for(const key of new Set([...Object.keys(a),...Object.keys(b)]))visit(a[key],b[key],path+'/'+pointer(key));
  }else {total++;if(changes.length<limit)changes.push({path:path||'/',kind:a===undefined?'added':b===undefined?'removed':'modified'})}
 }
 visit(before,after,'');return {changes,total,truncated:total>changes.length}
}
/** adapter.commit must atomically recheck expectedRevision/expectedFingerprint,
 * archive `before`, then replace only the selected local resource. Never write shared.
 * adapter.restore must validate archive ownership and restore as a local fixed copy. */
export function createResourceVersionPanel({adapter,now=Date.now,maxPreviews=128,previewTtl=300000}){
 const previews=new Map(),tails=new Map();
 const fingerprint=(state,row)=>digest([state.revision,row]);
 function prune(){for(const [key,p]of previews)if(now()-p.at>previewTtl)previews.delete(key);while(previews.size>=maxPreviews)previews.delete(previews.keys().next().value)}
 function serial(id,work){const previous=tails.get(id)||Promise.resolve(),job=previous.catch(()=>{}).then(work);tails.set(id,job);return job.finally(()=>{if(tails.get(id)===job)tails.delete(id)})}
 function find(state,key){const row=state.rows.find(row=>row.key===key);if(!row)throw Error('本局资源已变化，请刷新');return row}
 async function get(sessionId){const state=await adapter.read(sessionId);return {revision:state.revision,rows:state.rows.map(row=>({key:row.key,kind:row.kind,scope:row.scope,name:row.name,mode:row.mode,version:row.version,sharedVersion:row.sharedVersion,localChanges:Object.hasOwn(row,'localChanges')?row.localChanges:row.base===undefined?null:resourceVersionDiff(row.base,row.current).total,updateChanges:row.shared===undefined?0:resourceVersionDiff(row.current,row.shared).total,canApply:row.shared!==undefined&&row.mode!=='local',canFollow:row.canFollow!==false&&row.shared!==undefined&&row.mode!=='local',history:row.history||[],action:row.action,warning:row.warning||''}))}}
 async function preview(sessionId,key){prune();const state=await adapter.read(sessionId),row=find(state,key);if(row.shared===undefined||row.mode==='local')throw Error('此资源没有可应用的共享版本');const token=randomUUID(),diff=resourceVersionDiff(row.current,row.shared);previews.set(token,{sessionId,key,at:now(),fingerprint:fingerprint(state,row),revision:state.revision});return {token,key,revision:state.revision,...diff,localChanges:Object.hasOwn(row,'localChanges')?row.localChanges:row.base===undefined?null:resourceVersionDiff(row.base,row.current).total,version:row.version,sharedVersion:row.sharedVersion}}
 async function apply(sessionId,{key,token,mode='pinned'}){return serial(sessionId,async()=>{
  const p=previews.get(token);if(!p||p.sessionId!==sessionId||p.key!==key||now()-p.at>previewTtl)throw Error('预览已失效，请重新查看差异');
  if(!['follow','pinned'].includes(mode))throw Error('资源模式无效');
  const state=await adapter.read(sessionId),row=find(state,key);if(p.fingerprint!==fingerprint(state,row))throw Error('本局或共享资源已变化，请重新预览');
  if(mode==='follow'&&row.canFollow===false)throw Error('此资源不能跟随共享版本');
  const result=await adapter.commit(sessionId,{key,expectedRevision:p.revision,expectedFingerprint:p.fingerprint,before:clone(row.current),value:clone(row.shared),mode});previews.delete(token);return result;
 })}
 function discard(sessionId,token){if(previews.get(token)?.sessionId===sessionId)previews.delete(token);return {discarded:true}}
 async function restore(sessionId,{key,archiveId,expectedRevision}){return serial(sessionId,async()=>{const state=await adapter.read(sessionId);find(state,key);if(state.revision!==expectedRevision)throw Error('本局资源已变化，请刷新');return adapter.restore(sessionId,{key,archiveId,expectedRevision,mode:'pinned'})})}
 return {get,preview,apply,discard,restore}
}
