import {lstat,realpath,readFile,rm,readdir} from 'node:fs/promises'
import path from 'node:path'

export const RETENTION_DEFAULTS = Object.freeze({version:1,snapshots:3,presetVersions:1,recoveryVersions:3,modelRequests:1,modelRequestBytes:8*1024*1024,failedCases:1,remoteBytes:512*1024*1024,diagnosticBytes:32*1024*1024,effectCount:100,effectBytes:5*1024*1024,effectFailures:3})

export async function readRetentionPolicy(store,logger=console) {
  try { return createRetentionService({policy:await store.readJson('retention-policy.json')||{}}).limits }
  catch(error){logger.warn('dsh-tavern: retention-policy.json 无法读取或配置无效，使用默认清理策略',String(error.message||error));return RETENTION_DEFAULTS}
}

export function retainPresetVersions(entries,maximum=RETENTION_DEFAULTS.presetVersions){const counts=new Map();return entries.toReversed().filter(row=>{const key=row.presetPath??row.snapshot?.presetPath??'',count=counts.get(key)||0;counts.set(key,count+1);return count<maximum}).reverse()}

/** Plans contain exact files, never recursive directory deletion. Reject links and stale plans. */
export async function retentionFile(root, relative, reason) {
  const resolved=path.resolve(root),target=path.resolve(resolved,relative),within=path.relative(resolved,target)
  if(!within||within==='..'||within.startsWith('..'+path.sep)||path.isAbsolute(within))throw Error('清理路径越界')
  let info
  try{info=await lstat(target,{bigint:true})}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(!info.isFile()||info.isSymbolicLink())return null
  const realRoot=await realpath(resolved),realTarget=await realpath(target),realRelative=path.relative(realRoot,realTarget)
  if(realRelative==='..'||realRelative.startsWith('..'+path.sep)||path.isAbsolute(realRelative))throw Error('清理路径链接越界')
  return {relative:within.replaceAll('\\','/'),bytes:Number(info.size),stamp:[info.size,info.mtimeNs,info.ctimeNs,info.ino].join(':'),reason}
}
export async function applyRetentionFiles(root, rows, {dryRun=true}={}) {
  const deleted=[],skipped=[]
  for(const row of rows.filter(Boolean)){
    const current=await retentionFile(root,row.relative,row.reason)
    if(!current||current.stamp!==row.stamp){skipped.push(row.relative);continue}
    if(!dryRun)await rm(path.resolve(root,row.relative))
    deleted.push(row)
  }
  return {dryRun,files:deleted,skipped,bytes:deleted.reduce((n,row)=>n+row.bytes,0)}
}
export async function retentionFiles(root, relative='') {
  const rows=[],resolved=path.resolve(root)
  const relativeRoot=path.relative(resolved,path.resolve(resolved,relative))
  if(relativeRoot==='..'||relativeRoot.startsWith('..'+path.sep)||path.isAbsolute(relativeRoot))throw Error('清理路径越界')
  async function walk(folder){
    const target=path.resolve(resolved,folder)
    let info;try{info=await lstat(target)}catch(e){if(e.code==='ENOENT')return;throw e}
    if(info.isSymbolicLink()||!info.isDirectory())return
    const realRelative=path.relative(await realpath(resolved),await realpath(target))
    if(realRelative==='..'||realRelative.startsWith('..'+path.sep)||path.isAbsolute(realRelative))throw Error('清理路径链接越界')
    let entries;try{entries=await readdir(path.join(root,folder),{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return;throw e}
    for(const entry of entries){if(entry.isSymbolicLink())continue;const next=path.join(folder,entry.name);if(entry.isDirectory())await walk(next);else if(entry.isFile())rows.push(next.replaceAll('\\','/'))}
  }
  await walk(relative);return rows
}
export async function verifiedJson(root, relative) { return JSON.parse(await readFile(path.join(root,relative),'utf8')) }

/** Categories register their own reference/transaction rules; one dry-run uses exactly the apply plan. */
export function createRetentionService({policy={}}={}) {
  const limits=Object.freeze({...RETENTION_DEFAULTS,...policy,version:1}),categories=new Map()
  for(const key of Object.keys(RETENTION_DEFAULTS))if(key!=='version'&&(!Number.isSafeInteger(limits[key])||limits[key]<1))throw Error('清理上限无效：'+key)
  let tail=Promise.resolve()
  const register=(name,run)=>{categories.set(name,run);return()=>categories.delete(name)}
  function run({dryRun=true,only}={}){
    const job=tail.catch(()=>{}).then(async()=>{const results=[];for(const [category,apply]of categories)if(!only||only.includes(category)){const started=performance.now(),result=await apply({dryRun,limits});results.push({category,...result,durationMs:performance.now()-started})};return {version:1,dryRun,policy:limits,results}})
    tail=job;return job
  }
  return {limits,register,run}
}
