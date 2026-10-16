import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
export const STORAGE_FORMAT=Object.freeze({formatVersion:3,minimumReader:'r4-f',rollback:'Restore matching code and complete Home data, including native Sessions, resource-versions, chat-resources and SP.'})
export function createStorageFormat(dataRoot,{maximumVersion=3}={}){
 const files=createDurableFilePromotion(),target=path.resolve(dataRoot,'storage-format.json');let marked
 function check(value){if(value!==null&&value!==undefined&&(typeof value!=='object'||Array.isArray(value)||!Number.isSafeInteger(value.formatVersion)||value.formatVersion<1||value.formatVersion>maximumVersion||value.formatVersion===5&&value.retentionPolicy!=='current-plus-three-ordinary-v1'||value.formatVersion>=4&&
  (value.pageFormat!=='tavern-chat-records-v1'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.migrationId||'')||value.routeManifest!=='maintenance/format4/'+value.migrationId+'/routes.json'||!/^[a-f0-9]{64}$/.test(value.routeManifestSha256||''))))throw Object.assign(new Error('存档格式损坏或由更新版本写入；请升级程序，或还原配套代码与完整数据备份'),{code:'DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'})}
 return {async upgradeRetention(){
  if(maximumVersion<5)throw Error('Reader does not support retention format')
  const {upgradePageRetention}=await import('./page-retention-upgrade.js');return upgradePageRetention(dataRoot)
 },async read(){const bytes=await files.read(target),value=bytes?JSON.parse(bytes):null;check(value);return value},mark(){
  if(!marked)marked=files.update(target,bytes=>{const value=bytes?JSON.parse(bytes):null;check(value);return value?.formatVersion>=3?undefined:Buffer.from(JSON.stringify(STORAGE_FORMAT,null,2)+'\n')},{waitMs:30000}).catch(error=>{marked=null;throw error})
  return marked
 }}
}
