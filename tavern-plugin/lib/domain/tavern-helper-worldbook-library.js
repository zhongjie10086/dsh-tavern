import {privateWorldbookState,worldbookSourceKey,createPrivateWorldbook,deletePrivateWorldbook} from './private-worldbooks.js'
import { mergeWorldBooks } from './worldbook-merge.js'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { projectTavernHelperWorldbook, replaceTavernHelperWorldbookOperations } from './tavern-helper-worldbook.js'
import { inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'

const clone=value=>structuredClone(value)
const file='helper-worldbook-bindings.json'
const operationFile='helper-worldbook-operation.json'
const empty=()=>({version:1,revision:0,global:[]})
const sourceKey=worldbookSourceKey
export function createHelperWorldbookLibrary({worldBooks,store,chats,readCard,assertOwner,fault=async()=>{}}) {
  let tail=Promise.resolve()
  const serialize=work=>{const pending=tail.catch(()=>{}).then(work);tail=pending;return pending}
  async function recoverPending(){
    const operation=await store.readJson(operationFile);if(!operation)return null
    if(operation.kind!=='bind-character')throw new Error('世界书恢复操作无效')
    // R3 completes a legacy pending binding in its chat only.
    await fault('bindings-written')
    await chats.update(operation.chatId,current=>{
      if(current.cardPath!==operation.cardPath)throw new Error('待恢复世界书绑定的人物卡已经变化')
      current.openingWorldbookSnapshot=clone(operation.snapshot);current.cardContextSnapshotVersion=0;delete current.preparedWorldBook;return current
    },{source:'helper.character-worldbooks'})
    await fault('snapshot-written');await store.remove(operationFile);return {recovered:true}
  }
  async function projectReferences(operation){
    const oldPath=operation.path,newPath=operation.kind==='rename'?operation.result?.path:null
    if(!['cards/','worldbooks/'].some(prefix=>oldPath?.startsWith(prefix)))return
    const matches=source=>source?.kind==='card'?source.cardPath===oldPath:source?.path===oldPath
    const changed=source=>source.kind==='card'?{...source,cardPath:newPath}:{...source,path:newPath}
    await store.updateJson(file,value=>{const state=value||empty();if(!state.global.some(matches))return state;return {...state,revision:state.revision+1,global:state.global.flatMap(source=>!matches(source)?[source]:newPath?[changed(source)]:[])}})
    const ids=chats.list?await chats.list():[]
    const hasReferences=current=>Object.values(current?.worldbookState?.books||{}).some(row=>matches(row.source))||Object.values(current?.worldbookState?.bindings||{}).some(rows=>rows.some(matches))||matches(current?.tavernChatWorldbook?.source)||Boolean(newPath&&(matches(current?.openingWorldbookSnapshot?.source)||(current?.openingWorldbookSnapshot?.mergedSources||[]).some(row=>matches(row.source))))
    for(const id of ids){if(chats.read&&!hasReferences(await chats.read(id)))continue;await chats.update(id,current=>{
      if(!current)return current
      const bound=current.tavernChatWorldbook
      if(bound&&matches(bound.source)){if(newPath)current.tavernChatWorldbook={...bound,source:changed(bound.source),name:newPath.split('/').pop().replace(/\.[^.]+$/,'')};else delete current.tavernChatWorldbook;current.cardContextSnapshotVersion=0;delete current.preparedWorldBook}
      if(current.worldbookState){
        const state=current.worldbookState,books={}
        for(const [key,row]of Object.entries(state.books)){if(newPath&&matches(row.source)){const source=changed(row.source);books[sourceKey(source)]={...row,source}}else books[key]=row}
        state.books=books
        if(newPath)for(const scope of Object.keys(state.bindings))state.bindings[scope]=state.bindings[scope].map(source=>matches(source)?changed(source):source)
        state.revision++;current.cardContextSnapshotVersion=0;delete current.preparedWorldBook
      }
      const snapshot=current.openingWorldbookSnapshot
      if(newPath&&snapshot){if(matches(snapshot.source))snapshot.source=changed(snapshot.source);for(const row of snapshot.mergedSources||[])if(matches(row.source))row.source=changed(row.source)}
      return current
    },{source:'helper.worldbook-references'})}
  }
  async function bindings(){return await store.readJson(file)||empty()}
  async function additionalSources(chat){if(!chat)return [];return [...(chat.worldbookState?.bindings?.global??(await bindings()).global),...(chat?.tavernChatWorldbook?[chat.tavernChatWorldbook.source]:[])]}
  async function stamp(chat){return createHash('sha256').update(JSON.stringify([(await bindings()).revision,chat?.worldbookState?.revision||0,chat?.tavernChatWorldbook||null,await worldBooks.liveStamp?.(chat)])).digest('hex')}
  async function catalog(chat) {
    const saved=await worldBooks.catalog(),configuration=await bindings(),local=privateWorldbookState(chat)
    const records=[...saved.standalone.map(row=>({name:row.name,source:{kind:'standalone',path:row.path}})),...saved.embedded.map(row=>({name:row.name,source:{kind:'card',cardPath:row.cardPath}}))]
    for(const row of Object.values(local.books)){
      const index=records.findIndex(record=>sourceKey(record.source)===sourceKey(row.source)||record.source?.path&&record.source.path===row.source?.path||record.source?.cardPath&&record.source.cardPath===row.source?.cardPath)
      if(row.deleted){if(index>=0)records.splice(index,1);continue}
      if(row.created&&index<0)records.push({name:row.name,source:row.source,local:true})
      else if(index>=0){records[index].source=row.source;records[index].local=true}
    }
    const current=await (worldBooks.boundCard||worldBooks.bound)(chat.cardPath,await readCard(chat),chat)
    if(current&&!records.some(row=>row.name===current.view.displayName))records.unshift({name:current.view.displayName,source:current.source,local:true})
    const nameFor=source=>records.find(row=>sourceKey(row.source)===sourceKey(source))?.name||''
    const bound=await worldBooks.binding(chat.cardPath),sources=local.bindings.character??(bound.kind==='multiple'?bound.books.map(b=>b.source):bound.source?[bound.source]:[])
    return {revision:configuration.revision,localRevision:local.revision,records,names:[...new Set(records.map(row=>row.name))],global:(local.bindings.global??configuration.global).map(nameFor).filter(Boolean),character:{primary:current?.view.displayName||sources.map(nameFor)[0]||null,additional:sources.map(nameFor).filter(Boolean).slice(1)},chat:chat.tavernChatWorldbook?.name||null}
  }
  async function locate(chat,name,{required=true}={}) {
    if(typeof name!=='string'||!name.trim())throw new Error('世界书名称不能为空')
    const rows=(await catalog(chat)).records
    let matches=rows.filter(row=>row.name===name||row.source?.path===name||row.local&&'worldbooks/'+row.name+'.json'===name)
    const exact=matches.filter(row=>row.source?.path===name);if(exact.length)matches=exact
    if(matches.length>1)throw new Error('世界书重名，请使用资源路径：'+name)
    if(!matches.length&&required)throw new Error('世界书不存在：'+name)
    return matches[0]||null
  }
  async function mutate(sessionId,operation,scriptId,lifecycleRevision) {
    return serialize(async()=>{
      await recoverPending()
      let chat=await assertOwner(sessionId,scriptId,lifecycleRevision)
      const check=()=>assertOwner(sessionId,scriptId,lifecycleRevision)
      await worldBooks.migrateChat(chat)
      if(operation.kind==='catalog')return {catalog:await catalog(chat)}
      const kind=operation.kind,name=String(operation.name||'')
      async function localUpdate(work){
        chat=await chats.update(chat.id,async current=>{await check();await worldBooks.migrateChat(current);await work(current);current.cardContextSnapshotVersion=0;delete current.preparedWorldBook;return current},{source:'helper.private-worldbook.'+kind})
      }
      if(['create','upsert'].includes(kind)) {
        if(!name.trim()||name.length>160)throw Error('世界书名称无效')
        const old=await locate(chat,name,{required:false});if(old&&kind==='create')return {value:false,catalog:await catalog(chat)}
        const document={name,entries:{}},view=inspectWorldBookDocument(document)
        const next=updateWorldBookDocument(document,{operations:replaceTavernHelperWorldbookOperations(view,operation.entries||[])}).document
        await localUpdate(async current=>{if(old){const record=await worldBooks.getForChat(current,old.source);await worldBooks.replaceForChat(current,record,next)}else createPrivateWorldbook(current,name,next)})
        return {updated:true,value:!old,catalog:await catalog(chat)}
      }
      if(kind==='delete') {
        const old=await locate(chat,name,{required:false});if(!old)return {value:false,catalog:await catalog(chat)}
        await localUpdate(async current=>{const source=await worldBooks.privateSource(old.source);deletePrivateWorldbook(current,source)
          for(const scope of ['global','character'])if(current.worldbookState.bindings[scope])current.worldbookState.bindings[scope]=current.worldbookState.bindings[scope].filter(row=>sourceKey(row)!==sourceKey(source))
          if(sourceKey(current.tavernChatWorldbook?.source)===sourceKey(source))delete current.tavernChatWorldbook
        });return {updated:true,value:true,catalog:await catalog(chat)}
      }
      if(kind==='bind-global'||kind==='bind-character') {
        const names=kind==='bind-global'?operation.names:[operation.books?.primary,...(operation.books?.additional||[])].filter(Boolean)
        if(!Array.isArray(names)||names.length>200)throw Error('世界书绑定必须为不超过 200 项的数组')
        const records=await Promise.all([...new Set(names)].map(value=>locate(chat,value))),sources=await Promise.all(records.map(row=>worldBooks.privateSource(row.source)))
        if(kind==='bind-global'&&operation.expectedRevision!==undefined&&(await bindings()).revision!==operation.expectedRevision)throw Error('全局世界书绑定已变化，请刷新')
        await fault('prepared')
        await localUpdate(async current=>{for(const source of sources)await worldBooks.ensurePrivateBase(current,source);const scope=kind==='bind-global'?'global':'character';current.worldbookState.bindings[scope]=sources;current.worldbookState.revision++})
        await fault('bindings-written');await fault('snapshot-written')
      }else if(kind==='bind-chat'){
        const record=name?await locate(chat,name):null
        await localUpdate(async current=>{if(record){const source=await worldBooks.privateSource(record.source);await worldBooks.ensurePrivateBase(current,source);current.tavernChatWorldbook={name:record.name,source}}else delete current.tavernChatWorldbook;current.worldbookState.revision++})
      }else throw Error('未知世界书操作：'+kind)
      return {updated:true,catalog:await catalog(chat)}
    })
  }
  async function globalCatalog(){const saved=await worldBooks.catalog(),state=await bindings();return {revision:state.revision,enabled:clone(state.global),books:[...saved.standalone.map(b=>({...b,source:{kind:'standalone',path:b.path}})),...saved.embedded.map(b=>({...b,source:{kind:'card',cardPath:b.cardPath}}))]}}
  async function setGlobal(sources,expectedRevision){return serialize(async()=>{
    if(!Array.isArray(sources)||sources.length>200)throw new Error('全局世界书列表无效');
    const catalog=await globalCatalog(),allowed=new Map(catalog.books.map(b=>[sourceKey(b.source),b.source]));
    const selected=sources.map(source=>{const found=allowed.get(sourceKey(source));if(!found)throw new Error('世界书不存在，请刷新列表');return found});
    if(new Set(selected.map(sourceKey)).size!==selected.length)throw new Error('不能重复启用同一本世界书');
    await store.updateJson(file,value=>{const current=value||empty();if(current.revision!==expectedRevision)throw new Error('全局世界书已变化，请刷新');return {...current,revision:current.revision+1,global:clone(selected)}});return globalCatalog();
  })}
  return {globalCatalog,setGlobal,catalog,locate,mutate,additionalSources,stamp,projectReferences,recover:()=>serialize(recoverPending)}
}
