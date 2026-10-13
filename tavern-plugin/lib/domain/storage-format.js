import path from 'node:path'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
export const STORAGE_FORMAT=Object.freeze({formatVersion:3,minimumReader:'r4-f',rollback:'Restore matching code and complete Home data, including native Sessions, resource-versions, chat-resources and SP.'})
export function createStorageFormat(dataRoot){
 const files=createDurableFilePromotion(),target=path.resolve(dataRoot,'storage-format.json');let marked
 function check(value){if(value&&Number(value.formatVersion)>3)throw Object.assign(new Error('存档由更新版本写入；请升级程序，或还原配套代码与完整数据备份'),{code:'DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'})}
 return {async read(){const bytes=await files.read(target),value=bytes?JSON.parse(bytes):null;check(value);return value},mark(){
  if(!marked)marked=files.update(target,bytes=>{const value=bytes?JSON.parse(bytes):null;check(value);return value?.formatVersion===3?undefined:Buffer.from(JSON.stringify(STORAGE_FORMAT,null,2)+'\n')},{waitMs:30000}).catch(error=>{marked=null;throw error})
  return marked
 }}
}
