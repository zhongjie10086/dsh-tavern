import {createHash} from 'node:crypto'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export const SP_VECTOR_INDEX_BYTES=64*1024*1024

export async function persistSpVectorIndex(index,store) {
 if(!index||index.spVectorIndex)return index
 if(!Array.isArray(index.documents))throw Error('向量索引内容无效')
 const encoded=JSON.stringify(index)
 if(Buffer.byteLength(encoded)>SP_VECTOR_INDEX_BYTES)throw Error('向量索引超过 64 MiB，请减少索引表范围或使用更低维度的模型')
 const digest=createHash('sha256').update(encoded).digest('hex'),name='sp-vector-indexes/'+digest+'.json'
 await store.updateJson(name,current=>{
  if(current!==undefined){if(hash(current)!==digest)throw Error('向量索引文件损坏');return undefined}
  return index
 })
 const saved=await (store.readReadonly||store.readJson)(name)
 if(!saved||hash(saved)!==digest)throw Error('向量索引写入校验失败')
 return {spVectorIndex:digest,signature:index.signature,builtAt:index.builtAt,count:index.documents.length,documentIds:index.documents.map(row=>row.id)}
}

export async function loadSpVectorIndex(index,store) {
 if(!index?.spVectorIndex)return index
 if(!validHash(index.spVectorIndex))throw Error('向量索引引用损坏')
 if(!store)throw Error('向量索引存储未连接')
 const value=await (store.readReadonly||store.readJson)('sp-vector-indexes/'+index.spVectorIndex+'.json')
 if(!value||hash(value)!==index.spVectorIndex||!Array.isArray(value.documents))throw Error('向量索引缺失或损坏，请恢复数据目录备份或重新建立索引')
 if(value.signature!==index.signature||value.builtAt!==index.builtAt||value.documents.length!==index.count||JSON.stringify(value.documents.map(row=>row.id))!==JSON.stringify(index.documentIds))throw Error('向量索引元数据不一致')
 return value
}
