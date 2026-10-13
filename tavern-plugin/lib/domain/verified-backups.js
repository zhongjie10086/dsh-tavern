import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {retentionFile,applyRetentionFiles} from './retention-policy.js'

/** Unregistered migrations and quarantines are deliberately outside ordinary backup retention. */
export function createVerifiedBackups({dataRoot,store,maximum=3}){
  const index='recovery/verified-backups.json'
  async function verify(row){
    const file=await retentionFile(dataRoot,row.path,'superseded-verified-backup')
    if(!file)return null
    const bytes=await readFile(path.join(dataRoot,row.path))
    return createHash('sha256').update(bytes).digest('hex')===row.sha256?file:null
  }
  async function remember(object,relative){
    const file=await retentionFile(dataRoot,relative,'verified-backup')
    if(!file)throw Error('恢复备份不是受控文件')
    const bytes=await readFile(path.join(dataRoot,relative))
    const parsed=JSON.parse(bytes.toString('utf8')),state=parsed.chat??parsed.document??parsed
    const row={object,path:file.relative,contentSha256:createHash('sha256').update(JSON.stringify(state)).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),at:Date.now()}
    if(!await verify(row))throw Error('恢复备份验证失败')
    await store.updateJson(index,current=>({version:1,records:[...(current?.records||[]).filter(item=>item.path!==row.path),row]}))
    return row
  }
  async function prune({dryRun=true,prepared}={}){
    if(prepared&&!dryRun){
      const result=await applyRetentionFiles(dataRoot,prepared.files,{dryRun:false})
      if(result.files.length){const deleted=new Set(result.files.map(row=>row.relative));await store.updateJson(index,current=>({...current,records:(current?.records||[]).filter(row=>!deleted.has(row.path))}))}
      return {...result,protected:prepared.protected}
    }
    const indexValue=await store.readJson(index),groups=new Map(),rows=[],protectedFiles=[]
    for(const row of indexValue?.records||[]){if(!groups.has(row.object))groups.set(row.object,[]);groups.get(row.object).push(row)}
    for(const group of groups.values()){
      const latest=group.at(-1)
      if(!await verify(latest)){protectedFiles.push({path:latest.path,reason:'replacement-not-verifiable'});continue}
      const states=new Set()
      for(const old of group.toReversed()){
        const file=await verify(old),content=old.contentSha256||old.sha256
        if(!file){protectedFiles.push({path:old.path,reason:'backup-changed-or-missing'});continue}
        if(states.has(content)||states.size>=maximum)rows.push(file)
        else states.add(content)
      }
    }
    const result=await applyRetentionFiles(dataRoot,rows,{dryRun})
    if(!dryRun&&result.files.length){const deleted=new Set(result.files.map(row=>row.relative));await store.updateJson(index,current=>({...current,records:(current?.records||[]).filter(row=>!deleted.has(row.path))}))}
    return {...result,protected:protectedFiles}
  }
  return {remember,prune}
}
