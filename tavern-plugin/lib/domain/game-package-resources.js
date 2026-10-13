import {createHash, randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import path from 'node:path'
import {gamePackageDependency} from './game-package.js'
import {gamePackageJsonHash} from './game-package-json.js'
import {worldbookSourceKey} from './private-worldbooks.js'
const clone=structuredClone
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const configuration=['tavern-tool-workbench.json','tavern-extension-settings.json','script-local-storage.json','script-files.json','script-variable-policies.json','tavern-remote-asset-pins.json','tavern-extensions.json','st-migration.json']
const content=/^(preset-history|sp-floor-archives|sp-static-data|sp-vector-indexes|scene-images\/worldbooks|extension-packages)\/[a-f0-9]{64}\.json$/
const messageOwner=card=>'card:'+createHash('sha256').update(card).digest('hex')+':message'
const fileId=(owner,name)=>createHash('sha256').update(owner+':'+name).digest('hex')
function savedScriptOwners(chat,result=new Set()){
 function tree(rows){for(const row of rows||[]){if(row._dshResourceId)result.add(row._dshResourceId);if(row.type==='folder')tree(row.scripts)}}
 for(const rows of Object.values(chat?.tavernScriptTrees||{}))tree(rows)
 const library=chat?.runtimePresetSnapshot?.scriptLibrary
 if(library){tree(library.global);tree(library.preset);for(const rows of Object.values(library.characters||{}))tree(rows)}
 for(const archive of chat?.tavernScriptHistory||[])tree(archive.trees)
 for(const checkpoint of chat?.timeline?.checkpoints||[])for(const key of ['snapshot','before'])if(checkpoint[key])savedScriptOwners(checkpoint[key],result)
 return result
}
const archivePreset=value=>value?.kind==='preset'?value.value?.snapshot:value?.snapshot
/** Current Home resources are never overwritten by a colliding imported file. */
export function createGamePackageResources({store,files,identities,worldBooks,readCard,readScripts,installExtension,trust,assets}) {
 function decision(row,current){
  const status=current===undefined?'new':gamePackageJsonHash(current)===(row.sha256||gamePackageJsonHash(row.value))?'reused':'mismatch'
  const action=status!=='mismatch'?(status==='new'?'新增缺少的资源':'复用相同资源'):row.kind==='resource'?'导入为另一份资源':['script-local-storage.json','script-files.json'].includes(row.path)?'两份分别保留；搬入局使用原包值':row.path==='tavern-script-library.json'?'保留目标端已有脚本作用域；仅补充缺少的作用域，原包值归档':'保留目标端当前共享配置；原包值归档'
  return {kind:row.kind,path:row.path,status,action}
 }
 async function collect(chat,revisions,sessions=[]){
  const dependencies=[],missing=[],seen=new Set(),queue=[]
  async function add(kind,name,value,encoding='json'){
   const key=kind+':'+name;if(seen.has(key))return;seen.add(key)
   if(value===undefined){missing.push({kind,source:name,action:'来源文件缺失，保留存档内最后可用内容'});return}
   dependencies.push(gamePackageDependency(kind,name,value,encoding));if(encoding==='json'){
    if(kind==='profile'&&name.startsWith('preset-history/'))savedScriptOwners({runtimePresetSnapshot:archivePreset(value)},variableOwners)
    scan(value)
   }
  }
  function scan(value){
   if(typeof value==='string'){if(content.test(value))queue.push(['profile',value]);return}
   if(!value||typeof value!=='object')return
   for(const [key,directory]of [['spLayerArchive','sp-floor-archives'],['spStaticArchive','sp-static-data'],['spVectorIndex','sp-vector-indexes']])if(/^[a-f0-9]{64}$/.test(value[key]||''))queue.push(['profile',directory+'/'+value[key]+'.json'])
   if(value.cardPath)queue.push(['resource',value.cardPath]);if(value.runtimePresetPath)queue.push(['resource',value.runtimePresetPath]);if(value.presetPath)queue.push(['resource',value.presetPath])
   if(value.kind==='standalone'&&value.path)queue.push(['resource',value.path]);if(value.kind==='card'&&value.cardPath)queue.push(['resource',value.cardPath])
   for(const child of Object.values(value))scan(child)
  }
  await worldBooks.migrateChat(chat)
  const book=await worldBooks.bound(chat.cardPath,await readCard(chat),chat),sources=(book?.mergedRecords|| (book?[book]:[])).map(row=>row.source)
  for(const source of sources)await worldBooks.ensurePrivateBase(chat,source)
  if(sources.length)chat.worldbookState.bindings.character=clone(sources)
  const scripts=await readScripts(chat),owners=new Set(scripts.map(row=>row.id));owners.add(messageOwner(chat.cardPath))
  const variableOwners=new Set(scripts.map(row=>row._dshResourceId).filter(Boolean));for(const value of [chat,...Object.values(revisions)])savedScriptOwners(value,variableOwners)
  const originalOwner=Object.fromEntries([...owners].map(owner=>[chat.scriptStorageOwners?.[owner]||owner,owner])),originalFile=Object.fromEntries(Object.entries(chat.scriptFileAliases||{}).map(([old,id])=>[id,old]))
  queue.push(['resource',chat.cardPath]);const preset=chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath;if(preset)queue.push(['resource',preset])
  for(const value of [chat,...Object.values(revisions)])scan(value)
  // A retained recovery version can be the only remaining owner of a script's
  // API settings. Resolve these archives before filtering the shared policies.
  async function drain(){for(let i=0;i<queue.length;i++){const [kind,name]=queue[i];if(seen.has(kind+':'+name))continue;await add(kind,name,kind==='resource'?await files.readText(name):await store.readJson(name),kind==='resource'?'text':'json')}}
  await drain()
  for(const name of configuration){
   let value=await store.readJson(name);if(value===undefined)continue
   if(name==='script-local-storage.json')value=Object.fromEntries(Object.entries(value).filter(([owner])=>originalOwner[owner]).map(([owner,data])=>[originalOwner[owner],data]))
   if(name==='script-files.json')value=Object.fromEntries(Object.entries(value).filter(([,row])=>originalOwner[row.owner]).map(([id,row])=>[originalFile[id]||id,{...row,owner:originalOwner[row.owner]}]))
   if(name==='script-variable-policies.json'){value={...value,rules:Object.fromEntries(Object.entries(value.rules||{}).filter(([,row])=>variableOwners.has(row.owner))),apiValues:Object.fromEntries(Object.entries(value.apiValues||{}).filter(([owner])=>variableOwners.has(owner)))}}
   if(name==='tavern-extensions.json'&&value.installed?.digest)queue.push(['profile','extension-packages/'+value.installed.digest+'.json'])
   await add('profile',name,value)
  }
  // The game already holds only its selected script scopes. Other cards' libraries stay behind.
  await add('profile','tavern-script-library.json',{version:1,revision:0,scopes:{global:chat.tavernScriptTrees?.global||[],['preset:'+preset]:chat.tavernScriptTrees?.preset||[],['character:'+chat.cardPath]:chat.tavernScriptTrees?.character||[]},history:[]})
  await drain()
  for(const row of [...dependencies].filter(row=>row.kind==='resource'&&row.path.startsWith('cards/'))){const picture=await files.readCardImage?.(row.path);if(picture)await add('portrait',row.path,picture.toString('base64'),'base64')}
  if(assets){const collected=await assets.collect(chat,[chat,...Object.values(revisions),...dependencies,sessions],owners);dependencies.push(...collected.dependencies);missing.push(...collected.missing)}
  return {dependencies,missing}
 }
 async function preview(payload){
  const conflicts=[],resourcePlan=[]
  for(const row of payload.dependencies.filter(row=>['resource','profile'].includes(row.kind))){
   const current=row.kind==='resource'?await files.readText(row.path):await store.readJson(row.path)
   const plan=decision(row,current);resourcePlan.push(plan)
   if(plan.status==='mismatch')conflicts.push({kind:plan.kind,path:plan.path,action:plan.action})
  }
  return {conflicts,resourcePlan}
 }
 async function prepare(payload){
  const paths={},hostIds={},packageId=randomUUID()
  for(const row of payload.dependencies.filter(row=>row.kind==='resource')){
   const current=await files.readText(row.path);let next=row.path
   if(current!==undefined&&current!==row.value){const parsed=path.posix.parse(row.path);next=path.posix.join(parsed.dir,parsed.name+'-import-'+packageId.slice(0,8)+parsed.ext)}
   paths[row.path]=next
  }
  function gather(value){if(!value||typeof value!=='object')return;if(typeof value._dshResourceId==='string')hostIds[value._dshResourceId]??=randomUUID();for(const child of Object.values(value))gather(child)}
  for(const value of [payload.chat,...Object.values(payload.revisions)])gather(value)
  for(const row of payload.dependencies)if(row.kind==='profile'&&row.path.startsWith('preset-history/'))gather(archivePreset(row.value)?.scriptLibrary)
  const policyIds={};for(const [id,row]of Object.entries(payload.dependencies.find(row=>row.path==='script-variable-policies.json')?.value?.rules||{}))if(hostIds[row.owner])policyIds[id]=hash([hostIds[row.owner],row.path])
  const storageOwners={},fileAliases={},stored=await store.readJson('script-local-storage.json')||{},storedFiles=await store.readJson('script-files.json')||{}
  const local=payload.dependencies.find(row=>row.path==='script-local-storage.json')?.value||{},fileRows=payload.dependencies.find(row=>row.path==='script-files.json')?.value||{}
  for(const owner of new Set([...Object.keys(local),...Object.values(fileRows).map(row=>row.owner)])){
   const mapped=owner===messageOwner(payload.chat.cardPath)?messageOwner(paths[payload.chat.cardPath]||payload.chat.cardPath):owner
   const differs=stored[mapped]!==undefined&&!isDeepStrictEqual(stored[mapped],local[owner]||{})||Object.entries(fileRows).some(([id,row])=>row.owner===owner&&storedFiles[id]&&!isDeepStrictEqual(storedFiles[id],row))
   storageOwners[owner]=differs?'import:'+packageId+':'+owner:mapped
  }
  for(const [id,row]of Object.entries(fileRows))fileAliases[id]=fileId(storageOwners[row.owner]||row.owner,row.name)
  return {packageId,paths,hostIds,policyIds,storageOwners,fileAliases,resourceIds:{},archivePaths:{}}
 }
 function scripts(input,mapping){return (input||[]).map(row=>{const next={...row};if(next._dshResourceId)next._dshResourceId=mapping.hostIds[next._dshResourceId]||randomUUID();if(row.type==='folder')next.scripts=scripts(row.scripts,mapping);return next})}
 function presetSnapshot(value,mapping){
  if(!value)return value
  const next=clone(value),library=next.scriptLibrary
  if(next.presetPath)next.presetPath=mapping.paths[next.presetPath]||next.presetPath
  if(library)next.scriptLibrary={...library,global:scripts(library.global,mapping),preset:scripts(library.preset,mapping),characters:Object.fromEntries(Object.entries(library.characters||{}).map(([path,rows])=>[mapping.paths[path]||path,scripts(rows,mapping)]))}
  return next
 }
 function source(value,mapping){if(!value)return value;const next={...value};if(next.path)next.path=mapping.paths[next.path]||next.path;if(next.cardPath)next.cardPath=mapping.paths[next.cardPath]||next.cardPath;if(next.resourceId)next.resourceId=mapping.resourceIds[next.resourceId]||next.resourceId;return next}
 function remap(chat,mapping,{mode}){
  const oldCard=chat.cardPath;chat.cardPath=mapping.paths[oldCard]||oldCard
  chat.scriptStorageOwners=Object.fromEntries(Object.entries(mapping.storageOwners||{}).map(([owner,value])=>[owner===messageOwner(oldCard)?messageOwner(chat.cardPath):owner,value]))
  chat.scriptFileAliases={...mapping.fileAliases}
  const preset=chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath||'';chat.runtimePresetPath=mapping.paths[preset]||preset;if(chat.runtimePresetSnapshot)chat.runtimePresetSnapshot.presetPath=chat.runtimePresetPath
  if(chat.runtimePresetSnapshot)chat.runtimePresetSnapshot=presetSnapshot(chat.runtimePresetSnapshot,mapping)
  for(const key of ['resourceVersionHistory','presetHistory'])if(chat[key])chat[key]=chat[key].map(row=>({...row,...(row.archive?{archive:mapping.archivePaths?.[row.archive]||row.archive}:{}),...(row.presetPath?{presetPath:mapping.paths[row.presetPath]||row.presetPath}:{})}))
  chat.resourceBindings={version:1,preset:{path:chat.runtimePresetPath,mode},scripts:{global:mode,preset:mode,character:mode}}
  chat.resourceBindingWarnings=[];chat.playConfigRevision=Number(chat.playConfigRevision||0)+1;chat.tavernHelperLifecycleRevision=Number(chat.tavernHelperLifecycleRevision||0)+1
  if(chat.tavernScriptTrees)chat.tavernScriptTrees=Object.fromEntries(Object.entries(chat.tavernScriptTrees).map(([scope,rows])=>[scope,scripts(rows,mapping)]))
  if(chat.tavernScriptHistory)chat.tavernScriptHistory=chat.tavernScriptHistory.map(row=>{const trees=scripts(row.trees,mapping);return {...row,trees,digest:hash(trees)}})
  if(chat.worldbookState){
   const keys={};chat.worldbookState.books=Object.fromEntries(Object.entries(chat.worldbookState.books||{}).map(([key,row])=>{const next=source(row.source,mapping),newKey=worldbookSourceKey(next);keys[key]=newKey;return [newKey,{...row,source:next}]}))
   for(const [scope,rows]of Object.entries(chat.worldbookState.bindings||{}))if(Array.isArray(rows))chat.worldbookState.bindings[scope]=rows.map(row=>source(row,mapping))
   if(chat.worldbookState.mergeUids)chat.worldbookState.mergeUids=Object.fromEntries(Object.entries(chat.worldbookState.mergeUids).map(([key,value])=>{const split=key.lastIndexOf(':'),owner=key.slice(0,split);return [(keys[owner]||owner)+key.slice(split),value]}))
   if(chat.worldbookState.spMirrors)chat.worldbookState.spMirrors=Object.fromEntries(Object.entries(chat.worldbookState.spMirrors).map(([key,row])=>[keys[key]||key,{...row,source:source(row.source,mapping)}]))
  }
  if(chat.openingWorldbookSnapshot?.source)chat.openingWorldbookSnapshot.source=source(chat.openingWorldbookSnapshot.source,mapping)
  if(chat.scriptVariableMigration)chat.scriptVariableMigration=Object.fromEntries(Object.entries(chat.scriptVariableMigration).map(([id,value])=>[mapping.policyIds?.[id]||id,value]))
  for(const checkpoint of chat.timeline?.checkpoints||[])for(const key of ['snapshot','before'])if(checkpoint[key]){const saved=checkpoint[key],changed=remap({...saved,cardPath:oldCard,runtimePresetPath:preset},mapping,{mode});for(const field of Object.keys(saved))if(Object.hasOwn(changed,field))saved[field]=changed[field]}
  chat.cardContextSnapshotVersion=0;delete chat.helperWorldbookBindingsStamp;delete chat.resolvedRuntimePreset;delete chat.preparedForegroundFrame
  return chat
 }
 async function install(payload,mapping,{trustResources}){
  const archive='recovery/game-package-config/'+mapping.packageId+'.json'
  await store.updateJson(archive,current=>current||{version:1,dependencies:payload.dependencies.filter(row=>row.kind==='profile'&&!content.test(row.path))})
  for(const row of payload.dependencies.filter(row=>row.kind==='resource')){
   const target=mapping.paths[row.path],current=await files.readText(target)
   if(current!==undefined&&current!==row.value)throw Error('整局导入目标资源已变化：'+target)
   if(current===undefined)await files.writeWorking(target,row.value)
   const portrait=payload.dependencies.find(value=>value.kind==='portrait'&&value.path===row.path);await files.restoreOriginal?.(target,portrait?Buffer.from(portrait.value,'base64'):row.value,Boolean(portrait))
  }
  function resourceSources(value){if(!value||typeof value!=='object')return [];return (value.resourceId&&(value.path||value.cardPath)?[value]:[]).concat(Object.values(value).flatMap(resourceSources))}
  for(const value of [payload.chat,...Object.values(payload.revisions)])for(const old of resourceSources(value)){const target=mapping.paths[old.path||old.cardPath];if(target)mapping.resourceIds[old.resourceId]=(await identities.claim(target)).id}
  for(const row of payload.dependencies.filter(row=>row.kind==='profile'&&content.test(row.path))){
   let value=row.value,target=row.path
   if(row.path.startsWith('preset-history/')&&archivePreset(value)){
    value=clone(value)
    if(value.kind==='preset'){
     value.value.snapshot=presetSnapshot(value.value.snapshot,mapping)
     const binding=value.value.binding
     if(binding?.path){binding.path=mapping.paths[binding.path]||binding.path;binding.id=(await identities.claim(binding.path)).id}
    }else value.snapshot=presetSnapshot(value.snapshot,mapping)
    if(value.path)value.path=mapping.paths[value.path]||value.path
    target='preset-history/'+hash(value)+'.json'
    mapping.archivePaths||={};mapping.archivePaths[row.path]=target
   }
   await store.updateJson(target,current=>{if(current!==undefined&&gamePackageJsonHash(current)!==gamePackageJsonHash(value))throw Error('已有内容归档校验冲突：'+target);return current===undefined?value:undefined})
  }
  for(const row of payload.dependencies.filter(row=>row.kind==='profile'&&!content.test(row.path)&&!['tavern-extensions.json','tavern-script-library.json','script-variable-policies.json','script-local-storage.json','script-files.json','tavern-remote-asset-pins.json'].includes(row.path))){
   await store.updateJson(row.path,current=>decision(row,current).status==='new'?row.value:undefined)
  }
  for(const name of ['script-local-storage.json','script-files.json']){
   const values=payload.dependencies.find(row=>row.path===name)?.value;if(!values)continue
   await store.updateJson(name,current=>{const next=clone(current||{});let changed=false;for(const [key,row]of Object.entries(values)){const target=name==='script-local-storage.json'?(mapping.storageOwners[key]||key):(mapping.fileAliases[key]||key),value=name==='script-local-storage.json'?row:{...row,owner:mapping.storageOwners[row.owner]||row.owner};if(next[target]!==undefined&&!isDeepStrictEqual(next[target],value))throw Error('搬入配置已被修改，未覆盖：'+name);if(next[target]===undefined){next[target]=value;changed=true}}return changed?next:undefined})
  }
  const remote=payload.dependencies.find(row=>row.path==='tavern-remote-asset-pins.json')?.value;if(remote)await assets?.importPins?.(remote)
  const library=payload.dependencies.find(row=>row.path==='tavern-script-library.json')?.value
  if(library)await store.updateJson('tavern-script-library.json',current=>{const next=clone(current||{version:1,revision:0,scopes:{},history:[]});let changed=false;for(const [key,rows]of Object.entries(library.scopes)){const split=key.indexOf(':'),mapped=split<0?key:key.slice(0,split+1)+(mapping.paths[key.slice(split+1)]||key.slice(split+1));if(!Object.hasOwn(next.scopes,mapped)){next.scopes[mapped]=scripts(rows,mapping);changed=true}}if(!changed)return;next.revision++;return next})
  const policies=payload.dependencies.find(row=>row.path==='script-variable-policies.json')?.value
  if(policies)await store.updateJson('script-variable-policies.json',current=>{
   const next=clone(current||{version:1,revision:0,rules:{}});let changed=false
   for(const row of Object.values(policies.rules||{})){const owner=mapping.hostIds[row.owner];if(!owner||row.status!=='active')continue;const id=hash([owner,row.path]);if(!next.rules[id]){next.rules[id]={...row,owner};changed=true}}
   for(const [old,row]of Object.entries(policies.apiValues||{})){
    const owner=mapping.hostIds[old];if(!owner)continue;next.apiValues||={}
    if(Object.hasOwn(next.apiValues,owner)&&!isDeepStrictEqual(next.apiValues[owner],row))throw Error('搬入脚本变量已被修改，未覆盖')
    if(!Object.hasOwn(next.apiValues,owner)){Object.defineProperty(next.apiValues,owner,{value:clone(row),enumerable:true,writable:true,configurable:true});changed=true}
   }
   if(!changed)return;next.revision++;return next
  })
  const extension=payload.dependencies.find(row=>row.path==='tavern-extensions.json')?.value
  if(extension?.installed&&decision({kind:'profile',path:'tavern-extensions.json',value:extension},await store.readJson('tavern-extensions.json')).status==='new'){const pkg=payload.dependencies.find(row=>row.path==='extension-packages/'+extension.installed.digest+'.json')?.value;if(pkg)await installExtension?.(pkg,{ifMissing:true})}
  if(assets)await assets.install(payload,mapping)
  if(trustResources)await trust?.(remap(clone(payload.chat),mapping,{mode:'follow'}))
 }
 return {collect,preview,prepare,install,remap}
}
