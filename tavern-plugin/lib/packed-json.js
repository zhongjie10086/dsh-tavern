import {createHash} from 'node:crypto'
import {gzip,gunzip} from 'node:zlib'
import {promisify} from 'node:util'

const compress=promisify(gzip),decompress=promisify(gunzip)
const minimum=16*1024,maximum=32*1024*1024,cacheLimit=64*1024*1024
const cache=new Map()
let cacheBytes=0
export const CARD_MVU_PENDING_CONTRACT='card-mvu-pending-v1'
export const CARD_MVU_PACKED_TAG='3+card-mvu-pending-v1'
const unsupported=()=>Object.assign(new Error('存档格式版本或必需执行合同高于当前程序支持范围；请升级程序，或同时恢复代码及完整数据备份（含 resource-versions、chat-resources、SP、原生 Session）'),{code:'DSH_TAVERN_STORAGE_VERSION_UNSUPPORTED'})
const hash=text=>createHash('sha256').update(text).digest('hex')
const own=(value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key)
function remember(key,row){
  const bytes=Buffer.byteLength(row.text)*2+row.data.length*2,old=cache.get(key)
  if(old){cacheBytes-=old.bytes;cache.delete(key)}
  if(bytes>cacheLimit)return
  while(cache.size&&(cacheBytes+bytes>cacheLimit||cache.size>=256)){const first=cache.keys().next().value;cacheBytes-=cache.get(first).bytes;cache.delete(first)}
  cache.set(key,{...row,bytes});cacheBytes+=bytes
}
function fail(){return Object.assign(new Error('压缩存档内容校验失败；原文件已保留，请使用已验证备份恢复'),{code:'DSH_TAVERN_PACKED_JSON_INVALID'})}
async function readChunk(row,useCache=true){
  if(!row||!/^([a-f0-9]{64})$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>maximum||typeof row.data!=='string'||row.data.length>maximum*2||row.data.length%4||!(/^[A-Za-z0-9+/]*={0,2}$/).test(row.data))throw fail()
  const cached=useCache?cache.get(row.sha256):undefined
  let text
  if(cached?.data===row.data)text=cached.text
  else{
    try{text=(await decompress(Buffer.from(row.data,'base64'),{maxOutputLength:Math.max(1,row.bytes)})).toString('utf8')}catch{throw fail()}
    if(hash(text)!==row.sha256)throw fail()
  }
  if(Buffer.byteLength(text)!==row.bytes)throw fail()
  if(useCache)remember(row.sha256,{text,data:row.data})
  return text
}

/** Self-contained storage encoding: no shared-file references or changes to runtime data. */
export async function encodePackedJson(value,{pretty=true,storageVersion=1,requiredContract}={}){
  if(requiredContract!==undefined&&(requiredContract!==CARD_MVU_PENDING_CONTRACT||storageVersion!==3))throw unsupported()
  const chunks=[],references=[],indices=new Map(),ancestors=new Set()
  async function visit(input,path){
    if(input&&typeof input==='object'&&typeof input.toJSON==='function')input=input.toJSON(path.at(-1)||'')
    if(input instanceof Number||input instanceof String||input instanceof Boolean)input=input.valueOf()
    if(typeof input==='string'&&input.length>=minimum&&path.length<=256){
      const bytes=Buffer.byteLength(input)
      if(bytes>maximum)return input
      const sha256=hash(input)
      let index=indices.get(sha256)
      if(index===undefined){
        const cached=cache.get(sha256)
        const data=cached?.text===input?cached.data:(await compress(input)).toString('base64')
        if(data.length+128>=bytes)return input
        remember(sha256,{text:input,data})
        index=chunks.length;chunks.push({sha256,bytes,data});indices.set(sha256,index)
      }
      references.push({path,index});return null
    }
    if(input===null||typeof input!=='object')return input
    if(ancestors.has(input))throw new TypeError('JSON 数据包含循环引用')
    ancestors.add(input)
    const output=Array.isArray(input)?new Array(input.length):{}
    for(const key of Object.keys(input))Object.defineProperty(output,key,{value:await visit(input[key],path.concat(Array.isArray(input)?Number(key):key)),writable:true,enumerable:true,configurable:true})
    ancestors.delete(input);return output
  }
  const data=await visit(value,[])
  const bodyText=JSON.stringify(data),bytes=Buffer.byteLength(bodyText)
  let body
  if(bytes>=minimum&&bytes<=maximum){
    const bodySha=hash(bodyText),cachedBody=cache.get(bodySha)
    const compressed=cachedBody?.text===bodyText?cachedBody.data:(await compress(bodyText)).toString('base64')
    if(compressed.length+128<bytes){remember(bodySha,{text:bodyText,data:compressed});body={sha256:bodySha,bytes,data:compressed}}
  }
  const expandedBytes=references.reduce((n,r)=>n+chunks[r.index].bytes,0)
  if(![1,2,3].includes(storageVersion))throw new Error('不支持的写入存储格式')
  const packed=(chunks.length||body)&&expandedBytes<=256*1024*1024
  const version=requiredContract===CARD_MVU_PENDING_CONTRACT?CARD_MVU_PACKED_TAG:storageVersion
  const encoded=packed?{$dshPackedJson:version,...(body?{body}:{data}),chunks,references}:storageVersion>=2?{$dshPackedJson:version,data:value,chunks:[],references:[]}:value
  return JSON.stringify(encoded,null,pretty?2:undefined)+'\n'
}

/** Old ordinary JSON remains readable; compressed text is checked before use. */
export async function decodePackedJson(input){
  const value=typeof input==='string'||Buffer.isBuffer(input)?JSON.parse(input.toString()):structuredClone(input)
  if(!own(value,'$dshPackedJson'))return value
  if(![1,2,3,CARD_MVU_PACKED_TAG].includes(value.$dshPackedJson))throw unsupported()
  if(!Array.isArray(value.chunks)||!Array.isArray(value.references)||value.chunks.length>10000||value.references.length>100000||own(value,'data')===own(value,'body'))throw fail()
  const texts=[]
  for(const row of value.chunks){
    texts.push(await readChunk(row))
  }
  let result=value.data,expandedBytes=0
  if(own(value,'body')){try{result=JSON.parse(await readChunk(value.body,true))}catch{throw fail()}}
  for(const ref of value.references){
    if(!ref||!Array.isArray(ref.path)||ref.path.length>256||!Number.isInteger(ref.index)||ref.index<0||ref.index>=texts.length||ref.path.some(k=>typeof k!=='string'&&(!Number.isSafeInteger(k)||k<0)))throw fail()
    expandedBytes+=value.chunks[ref.index].bytes
    if(expandedBytes>256*1024*1024)throw fail()
    if(!ref.path.length){if(result!==null)throw fail();result=texts[ref.index];continue}
    let parent=result
    for(const key of ref.path.slice(0,-1)){if(!own(parent,key))throw fail();parent=parent[key]}
    const key=ref.path.at(-1)
    if(!own(parent,key)||parent[key]!==null)throw fail()
    Object.defineProperty(parent,key,{value:texts[ref.index],enumerable:true,writable:true,configurable:true})
  }
  return result
}
