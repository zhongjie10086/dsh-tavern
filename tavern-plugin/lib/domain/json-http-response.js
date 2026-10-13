import {gzip} from 'node:zlib'
import {promisify} from 'node:util'
const compress=promisify(gzip)

/** Ordinary HTTP compression; the decoded JSON contract and all data remain intact. */
export async function jsonHttpResponse(value,acceptEncoding='') {
 const source=Buffer.from(JSON.stringify(value))
 const gzipAllowed=String(acceptEncoding).split(',').some(item=>{const [name,...params]=item.trim().split(';');const quality=params.find(p=>p.trim().startsWith('q='));return name==='gzip'&&(!quality||Number(quality.trim().slice(2))>0)})
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Accept-Encoding'}
 if(gzipAllowed&&source.length>=32768){
  const body=await compress(source,{level:1})
  if(body.length<source.length)return {headers:{...headers,'Content-Encoding':'gzip','Content-Length':body.length},body}
 }
 return {headers:{...headers,'Content-Length':source.length},body:source}
}
