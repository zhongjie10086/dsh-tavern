import {createHash} from 'node:crypto'
import {gamePackageDependency} from './game-package.js'
const digest=value=>createHash('sha256').update(value).digest('hex')
const clone=structuredClone
/** Public attachment/cache services preserve their validation; export performs no downloads. */
export function createGamePackageAssets({store,cache,attachments,pins}) {
 async function collect(chat,values,owners) {
  const dependencies=[],missing=[],refs=new Map(),urls=new Set(),queue=[]
  function scan(value,base){
   if(typeof value==='string'){
    for(const match of value.matchAll(/https?:\/\/[^\s"'<>()\x60\\]+/g)){try{urls.add(new URL(match[0]).href)}catch{}}
    for(const match of value.matchAll(/(?:from\s*|import\s*\(?|url\(\s*)['"]([^'"]+)['"]/g))if(base){try{urls.add(new URL(match[1],base).href)}catch{}}
    for(const match of value.matchAll(/[?&]url=([^\s"'<>&]+)/g))try{urls.add(decodeURIComponent(match[1]))}catch{}
    return
   }
   if(!value||typeof value!=='object')return
   if(typeof value.attachmentId==='string'&&Number.isSafeInteger(value.bytes))refs.set(digest(JSON.stringify(value)),value)
   for(const child of Object.values(value))scan(child,base)
  }
  for(const value of values)scan(value)
  const scene='scene-images/'+digest(String(chat.id))+'/'
  for(const name of await store.listJsonFiles(scene))if(/^(?:[a-f0-9]{64}|references|plans)\.json$/.test(name)){
   const value=await store.readJson(scene+name);dependencies.push(gamePackageDependency('media',scene+name,value));scan(value)
  }
  for(const name of await store.listJsonFiles('script-images'))if(/^[a-f0-9]{64}\.json$/.test(name)){
   const value=await store.readJson('script-images/'+name);if(owners.has(value?.owner))dependencies.push(gamePackageDependency('media','script-images/'+name,value))
  }
  for(const [id,reference]of refs){
   try{
    let data
    if(reference.mediaType)data=Buffer.from((await attachments().readImage(reference)).data)
    else{const chunks=[];for await(const chunk of attachments().readFileStream(reference))chunks.push(Buffer.from(chunk));data=Buffer.concat(chunks)}
    dependencies.push(gamePackageDependency('attachment',id,{reference,data:data.toString('base64')}))
   }catch{missing.push({kind:'attachment',source:reference.attachmentId,action:'附件当前不可读取，保留原引用'})}
  }
  const seen=new Set();for(const url of urls)queue.push(url)
  for(let index=0;index<queue.length;index++){
   const url=queue[index];if(seen.has(url))continue;seen.add(url);let found=false
   for(const trustedResource of [false,true]){
    let record;try{record=await cache.read(url,{trustedResource})}catch{continue}if(!record)continue;found=true
    const body=record.body;dependencies.push(gamePackageDependency('cache',digest(url+(trustedResource?'\ntrusted-resource':'')),{url:record.url,finalUrl:record.finalUrl,mediaType:record.mediaType,bytes:body.length,contentHash:digest(body),cachedAt:record.cachedAt,body:body.toString('base64'),trustedResource}))
    if(/(?:javascript|json|text\/|xml)/.test(record.mediaType)){const count=urls.size;scan(body.toString('utf8'),record.finalUrl||url);if(urls.size!==count)for(const child of urls)if(!seen.has(child))queue.push(child)}
   }
   if(!found&&/\.(?:m?js|css|html?|png|jpe?g|gif|webp|mp3|mp4)(?:[?#]|$)|\/\+esm(?:[?#]|$)/i.test(url))missing.push({kind:'remote-resource',source:url,action:'未在静态缓存中；保留地址，首次使用可能需要联网'})
  }
  return {dependencies,missing}
 }
 async function install(payload,mapping){
  for(const row of payload.dependencies){
   if(row.kind==='attachment'){
    const {reference}=row.value,data=Buffer.from(row.value.data,'base64')
    if(data.length!==reference.bytes)throw Error('搬家包附件大小不符')
    const saved=reference.mediaType?await attachments().saveImage({data,mediaType:reference.mediaType,name:reference.name}):await attachments().saveFile({data,name:reference.name})
    if(saved.attachmentId!==reference.attachmentId)throw Error('目标端附件规范与原包不一致，未发布游戏')
   }else if(row.kind==='cache'){if(row.path!==digest(row.value.url+(row.value.trustedResource?'\ntrusted-resource':'')))throw Error('搬家包缓存标识与地址不一致');await cache.restoreArchive(row.value)}
   else if(row.kind==='media'){
    const file=row.path.startsWith('scene-images/')?'scene-images/'+digest(String(mapping.targetChatId))+'/'+row.path.split('/').at(-1):row.path
    const value=clone(row.value);if(value?.chatId===payload.chat.id)value.chatId=mapping.targetChatId
    await store.updateJson(file,current=>{if(current!==undefined&&JSON.stringify(current)!==JSON.stringify(value))throw Error('目标媒体已变化，未覆盖：'+file);return current===undefined?value:undefined})
   }
  }
 }
 return {collect,install,importPins:saved=>pins?.importArchive(saved)}
}
