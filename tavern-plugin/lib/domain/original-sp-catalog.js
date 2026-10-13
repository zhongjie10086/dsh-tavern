import {createHash} from 'node:crypto'

export const SP_TEMPLATE_NAMESPACE='shujuku_v120__userscript_settings_v1'
export const SP_TEMPLATE_STORAGE_KEY='shujuku_v120_templatePresets_v1'
const settingsFile='tavern-extension-settings.json',manifestFile='sp-template-migration.json'
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
function catalog(settings) {
 const raw=settings?.__userscripts?.[SP_TEMPLATE_NAMESPACE]?.[SP_TEMPLATE_STORAGE_KEY]
 const value=raw?JSON.parse(raw):{version:1,presets:{}}
 if(value?.version!==1||!value.presets||typeof value.presets!=='object'||Array.isArray(value.presets))throw Error('原版 SP 模板目录格式不受支持，原件已保留')
 for(const row of Object.values(value.presets))if(typeof row?.templateStr!=='string'||!JSON.parse(row.templateStr))throw Error('原版 SP 模板内容损坏，原件已保留')
 return value
}
/** Storage adapter verified against SP 9.2.4/9.2.5's preset service. It only
 * appends named templates at migration; all subsequent management stays in SP. */
export function createOriginalSpCatalog({store,legacy,status,fault=async()=>{}}) {
 let migrationError=''
 const owns=()=>status()?.installed?.source==='sillytavern'
 async function list(){if(migrationError)throw Error(migrationError);const current=catalog(await store.readJson(settingsFile));return Object.entries(current.presets).map(([name,row])=>({id:name,name,data:JSON.parse(row.templateStr),updatedAt:row.updatedAt,owner:'original',selected:false}))}
 async function migrate() {
  if(!owns())return null
  const version=status().installed.version
  if(!['9.2.4','9.2.5'].includes(version))throw Error('原版 SP '+version+' 模板存储尚未验证，已保留旧库并停止迁移')
  let manifest=await store.readJson(manifestFile)
  if(manifest?.status==='completed')return manifest
  if(!manifest){
   const templates=await legacy.list(),current=catalog(await store.readJson(settingsFile)),reserved=new Map(Object.entries(current.presets).map(([name,row])=>[name,digest(JSON.parse(row.templateStr))])),entries=[]
   for(const row of templates){
    const hash=digest(row.data);let name=row.name,index=1
    while(reserved.has(name)&&reserved.get(name)!==hash)name=row.name+'（DSH'+(index++===1?'':' '+(index-1))+'）'
    entries.push({sourceId:row.id,name,sourceName:row.name,digest:hash,data:row.data,selected:row.selected===true,alreadyPresent:reserved.has(name)})
    reserved.set(name,hash)
   }
   const backup='recovery/migrations/sp-template-catalog.json',value={version:1,legacy:templates,original:current}
   await store.updateJson(backup,previous=>{if(previous&&digest(previous)!==digest(value))throw Error('模板迁移备份已存在且内容不同');return previous||value})
   if(digest(await store.readJson(backup))!==digest(value))throw Error('模板迁移备份回读不一致')
   const prepared={version:1,status:'prepared',sourceDigest:digest(templates),originalDigest:digest(current),backup,entries,defaultName:entries.find(row=>row.selected)?.name||'',defaultStatus:Object.keys(current.presets).length?'kept-original':'pending',createdAt:Date.now()}
   manifest=await store.updateJson(manifestFile,previous=>previous||prepared)
  }
  await fault('prepared')
  await store.updateJson(settingsFile,raw=>{
   const settings=structuredClone(raw||{}),current=catalog(settings)
   for(const row of manifest.entries){
    const old=current.presets[row.name]
    if(old&&digest(JSON.parse(old.templateStr))!==row.digest)throw Error('迁移目标模板已被修改：'+row.name)
    if(!old)Object.defineProperty(current.presets,row.name,{value:{templateStr:JSON.stringify(row.data),updatedAt:manifest.createdAt},enumerable:true,writable:true,configurable:true})
   }
   settings.__userscripts??={};settings.__userscripts[SP_TEMPLATE_NAMESPACE]??={};settings.__userscripts[SP_TEMPLATE_NAMESPACE][SP_TEMPLATE_STORAGE_KEY]=JSON.stringify(current)
   return settings
  })
  await fault('written')
  const verified=catalog(await store.readJson(settingsFile))
  for(const row of manifest.entries)if(!verified.presets[row.name]||digest(JSON.parse(verified.presets[row.name].templateStr))!==row.digest)throw Error('迁移目标模板回读不一致：'+row.name)
  return store.updateJson(manifestFile,current=>{
   if(current?.sourceDigest!==manifest.sourceDigest)throw Error('模板迁移清单已变化')
   return {...current,status:'completed',completedAt:Date.now(),targetDigest:digest(verified)}
  })
 }
 async function initialize(){try{migrationError='';return await migrate()}catch(error){migrationError=String(error.message||error);return {status:'blocked',error:migrationError}}}
 async function migrationStatus(){if(migrationError)return {status:'blocked',error:migrationError};const value=await store.readJson(manifestFile);return value?{status:value.status,defaultStatus:value.defaultStatus,defaultName:value.defaultName}:null}
 async function acknowledgeDefault(name){await store.updateJson(manifestFile,current=>{if(current?.status!=='completed'||current.defaultName!==name)throw Error('模板迁移默认选择已变化');return {...current,defaultStatus:'applied'}})}
 function assertAvailable(sessionId){const installed=status()?.installed;if(!installed?.enabled)throw Error('原版 SP 已停用，不能切换到旧模板库');if(installed.scopeSessionId&&installed.scopeSessionId!==sessionId)throw Error('原版 SP 不适用于此会话，请调整扩展启用范围');if(migrationError)throw Error(migrationError)}
 function assertBackend(sessionId,chat){if(owns())assertAvailable(sessionId);else if(chat?.tavernPluginMetadata?.dsh_original_extensions?.['sp-database']?.synchronization?.owner==='original')throw Error('此会话表格归原版 SP 管理，请恢复该扩展后操作，不能自动切换数据库后端')}
 return {owns,list,migrate,initialize,migrationStatus,acknowledgeDefault,assertAvailable,assertBackend}
}
