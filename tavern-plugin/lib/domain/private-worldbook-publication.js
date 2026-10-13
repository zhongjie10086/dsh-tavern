import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {exportCharacterBook,exportSillyTavernWorldBook} from './worldbook-resource.js'
import {projectPrivateWorldbook,worldbookSourceKey} from './private-worldbooks.js'
const copy=structuredClone
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const set=(object,key,value)=>Object.defineProperty(object,key,{value,enumerable:true,writable:true,configurable:true})
export function publicationDocument(value){const result=exportSillyTavernWorldBook(value||{entries:{}});delete result.originalData;return result}
/** Preserve untouched embedded fields instead of normalizing the entire card book. */
export function publicationCharacterBook(document,original){
 const before=publicationDocument(original),converted=exportCharacterBook(document,{replace:true}),result=copy(original||{entries:[]}),convertedEntries=new Map(converted.entries.map(row=>[String(row.id),row])),seen=new Set()
 result.entries=(original?.entries||[]).flatMap((row,index)=>{
  const uid=String(Number.isFinite(Number(row.id))?Number(row.id):index);seen.add(uid)
  if(!Object.hasOwn(document.entries,uid))return []
  return [isDeepStrictEqual(before.entries[uid],document.entries[uid])?copy(row):copy(convertedEntries.get(uid))]
 })
 for(const [uid,row]of Object.entries(document.entries))if(!seen.has(uid))result.entries.push(copy(convertedEntries.get(uid)))
 for(const key of new Set([...Object.keys(before),...Object.keys(document)]))if(!['entries','originalData'].includes(key)&&!isDeepStrictEqual(before[key],document[key])){if(!Object.hasOwn(document,key))delete result[key];else set(result,key,copy(document[key]))}
 return result
}
export function privateWorldbookChanges(local,shared){
 const rows=[]
 function add(kind,key,before,after,status){
  // Embedded cards encode defaults and mapped extensions differently from native API values.
  // Compare their actual saved meaning, without rewriting the private values.
  const comparable=value=>local.source?.kind==='card'&&kind!=='metadata'&&value!==undefined?exportCharacterBook({entries:{[key]:value}},{replace:true}).entries[0]:value
  rows.push({id:JSON.stringify([kind,key]),kind,key,status,uid:kind==='metadata'?null:Number(local.aliases?.[key]??key),title:kind==='metadata'?'书属性：'+key:after?.comment||before?.comment||'条目 '+key,before:copy(before),after:copy(after),different:!isDeepStrictEqual(comparable(before),comparable(after))})
 }
 if(local.deleted){for(const [uid,entry]of Object.entries(shared.entries))add('override',uid,entry,undefined,'deleted');return rows}
 for(const [uid,patch]of Object.entries(local.entries||{}))add('override',uid,shared.entries[uid],patch.deleted?undefined:patch.value,patch.deleted?'deleted':shared.entries[uid]?'modified':'added')
 for(const [uid,value]of Object.entries(local.additions||{}))add('addition',uid,undefined,value,'added')
 for(const [key,patch]of Object.entries(local.metadata||{}))if(!['originalData','entries'].includes(key))add('metadata',key,shared[key],patch.deleted?undefined:patch.value,'modified')
 return rows
}
/** Rebase only newly published IDs; a private addition must not reappear twice when the public base grows. */
export function planPrivateWorldbookPublication(local,shared,selections){
 const rows=privateWorldbookChanges(local,shared),byId=new Map(rows.map(row=>[row.id,row]))
 if(!Array.isArray(selections)||!selections.length||new Set(selections).size!==selections.length||selections.some(id=>!byId.has(id)))throw Error('请选择当前清单中的世界书修改')
 const document=copy(shared),next=copy(local),uidMap=[];delete document.originalData
 const projection=projectPrivateWorldbook({id:'publication-preview',worldbookState:{books:{[worldbookSourceKey(local.source)]:local}}},local.source,{document:shared});if(projection)next.aliases=copy(projection.aliases)
 const used=new Set([...Object.keys(document.entries),...Object.keys(local.entries||{}),...Object.keys(local.additions||{})]);let spare=Math.max(-1,...[...used].map(Number).filter(Number.isSafeInteger))+1
 for(const id of selections){const row=byId.get(id)
  if(row.kind==='metadata'){if(row.after===undefined)delete document[row.key];else set(document,row.key,copy(row.after));continue}
  if(row.kind==='addition'){
   let uid=row.key;if(Object.hasOwn(document.entries,uid)){while(used.has(String(spare)))spare++;uid=String(spare++);used.add(uid)}
   if(!Number.isSafeInteger(Number(uid)))throw Error('世界书编号已超出安全范围')
   const value={...copy(row.after),uid:Number(uid)};set(document.entries,uid,value)
   next.entries||={};set(next.entries,uid,{value:copy(value)});delete next.additions[row.key];next.aliases||={};set(next.aliases,uid,Number(row.key));uidMap.push({localUid:Number(row.key),publicUid:Number(uid)})
  }else if(row.after===undefined)delete document.entries[row.key];else set(document.entries,row.key,copy(row.after))
 }
 return {document,local:next,uidMap}
}
export function createPrivateWorldbookPublication({chats,worldBooks,store,backups,publishPublic,isBusy=()=>false}){
 let tail=Promise.resolve()
 const serialize=work=>{const task=tail.catch(()=>{}).then(work);tail=task;return task}
 async function context(sessionId){const chat=await chats.forSession(sessionId);if(!chat||!['story','script'].includes(chat.mode||'story'))throw Error('请先进入游玩对话');return chat}
 async function book(chat,key){
  const local=chat.worldbookState?.books?.[key];if(!local)throw Error('本局世界书已变化，请刷新')
  const source=await worldBooks.privateSource(local.source);let shared,warning=''
  if(source.kind!=='chat'&&!source.missing)try{shared=publicationDocument((await worldBooks.export(source)).document)}catch(error){warning=String(error.message||error)}
  const exists=!!shared;shared||=publicationDocument(local.base||{name:local.name,entries:{}})
  // A wholly private book starts against an empty public base.
  if(source.kind==='chat')shared={name:local.name||'私有世界书',entries:{}}
  const rows=privateWorldbookChanges(local,shared),revision=hash([source,local,shared,exists])
  return {key,source,local,shared,exists,warning,revision,name:local.name||shared.name||'世界书',rows}
 }
 function summary(value){return {key:value.key,name:value.name,source:value.source,revision:value.revision,publicExists:value.exists,warning:value.warning,count:value.rows.filter(row=>row.different).length,overrideCount:value.rows.length}}
 async function inspect(sessionId,key){const chat=await context(sessionId),books=[];let selected=null
  for(const name of Object.keys(chat.worldbookState?.books||{})){const value=await book(chat,name);if(!value.rows.length)continue;books.push(summary(value));if(name===key)selected={...summary(value),rows:value.rows}}
  if(key&&!selected)throw Error('该世界书已没有本局修改，请刷新')
  return {books,book:selected}
 }
 async function publish(sessionId,request){return serialize(async()=>{
  const chat=await context(sessionId);if(isBusy(chat))throw Error('请等待本轮结束后推送世界书')
  const current=await book(chat,request.key);if(current.revision!==request.revision)throw Error('公共版本或本局修改已变化，请重新查看差异')
  const plan=planPrivateWorldbookPublication(current.local,current.shared,request.selections)
  if(request.newName!==undefined){
   const name=String(request.newName).trim();if(!name||name.length>100)throw Error('新公共世界书名称需为1–100字')
   const rows=current.rows.filter(row=>request.selections.includes(row.id)),document={name,entries:{}}
   for(const row of rows){
    if(row.kind==='metadata'){if(row.key!=='name'&&row.after!==undefined)set(document,row.key,copy(row.after));continue}
    if(row.after===undefined)continue
    let uid=Number(row.key);while(Object.hasOwn(document.entries,uid))uid++
    if(!Number.isSafeInteger(uid))throw Error('世界书编号已超出安全范围')
    set(document.entries,uid,{...copy(row.after),uid})
   }
   if(!Object.keys(document.entries).length)throw Error('新公共副本至少需要一个未删除条目')
   const result=await worldBooks.import({name:name+'.json',text:JSON.stringify(document)})
   return {created:true,source:{kind:'standalone',path:result.path},uidMap:[],...await inspect(sessionId,request.key)}
  }
  if(!current.exists)throw Error('公共来源已不存在，请保存为新的公共副本')
  if(isDeepStrictEqual(current.shared,plan.document))return {unchanged:true,uidMap:[],...await inspect(sessionId,request.key)}
  const backup={version:1,source:current.source,document:current.shared},backupPath='recovery/worldbooks/'+hash(backup)+'.json'
  await store.updateJson(backupPath,value=>{if(value&&!isDeepStrictEqual(value,backup))throw Error('世界书恢复副本校验失败');return value?undefined:backup})
  if(!isDeepStrictEqual(await store.readJson(backupPath),backup))throw Error('世界书恢复副本回读失败')
  await backups.remember('worldbook:'+worldbookSourceKey(current.source),backupPath)
  await publishPublic(current.source,plan.document,current.shared,async()=>{
   await chats.update(chat.id,value=>{
    if(isBusy(value)||Number(value.tavernHelperLifecycleRevision||0)!==Number(chat.tavernHelperLifecycleRevision||0)||!isDeepStrictEqual(value.worldbookState?.books?.[request.key],current.local))throw Error('本局世界书已变化，未推送公共版本')
    if(isDeepStrictEqual(plan.local,current.local))return undefined
    const before=projectPrivateWorldbook(value,current.source,{document:current.shared}),next=copy(value.worldbookState);set(next.books,request.key,copy(plan.local));next.revision++
    const preview={...value,worldbookState:next},beforePublic=projectPrivateWorldbook(preview,current.source,{document:current.shared}),afterPublic=projectPrivateWorldbook(preview,current.source,{document:plan.document})
    for(const row of [beforePublic,afterPublic])if(!isDeepStrictEqual(before?.document,row?.document))throw Error('推送会改变本局条目，已停止并保留原内容')
    value.worldbookState=next;value.cardContextSnapshotVersion=0;delete value.preparedWorldBook;return value
   },{source:'worldbook.publish-rebase'})
  })
  return {published:true,backup:backupPath,uidMap:plan.uidMap,...await inspect(sessionId,request.key)}
 })}
 return {inspect,publish}
}
