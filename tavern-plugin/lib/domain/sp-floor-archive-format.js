import {createHash} from 'node:crypto'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fields=['templateData','guideData']
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)

/** Keep the original logical floor hash. Static blocks are durable before its wrapper. */
export async function encodeSpFloorArchive(payload,store,{threshold=4096}={}) {
 const next={...payload};let changed=false
 for(const key of fields){
  const value=payload?.[key]
  if(!value||typeof value!=='object'||Buffer.byteLength(JSON.stringify(value))<threshold)continue
  const digest=hash(value),name='sp-static-data/'+digest+'.json'
  await store.updateJson(name,current=>{
   if(current!==undefined){if(hash(current)!==digest)throw Error('SP 静态归档内容损坏');return undefined}
   return value
  })
  const saved=await (store.readReadonly||store.readJson)(name)
  if(hash(saved)!==digest)throw Error('SP 静态归档写入校验失败')
  next[key]={spStaticArchive:digest};changed=true
 }
 return changed?{spFloorArchiveVersion:2,payloadHash:hash(payload),payload:next}:payload
}

/** Legacy inline files remain readable; corrupt or missing dependencies fail closed. */
export async function decodeSpFloorArchive(archive,digest,read) {
 if(!validHash(digest))throw Error('楼层记录标识损坏')
 let value=archive
 if(archive?.spFloorArchiveVersion===2){
  if(archive.payloadHash!==digest||!archive.payload||typeof archive.payload!=='object')throw Error('楼层归档封装损坏')
  value={...archive.payload}
  for(const key of fields){
   const ref=value[key]?.spStaticArchive
   if(ref===undefined)continue
   if(!validHash(ref)||Object.keys(value[key]).length!==1)throw Error('SP 静态归档引用损坏')
   const block=await read('sp-static-data/'+ref+'.json')
   if(!block||hash(block)!==ref)throw Error('SP 静态归档缺失或损坏，请恢复数据目录备份')
   value[key]=block
  }
 }
 if(!value||hash(value)!==digest)throw Error('楼层归档缺失或损坏，请恢复数据目录备份')
 return value
}
