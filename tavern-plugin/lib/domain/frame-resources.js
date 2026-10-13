import {randomBytes,createHash} from 'node:crypto'
import {assertModuleResourceType} from './tavern-static-resource-cache.js'
const root = '/api/dsh-tavern/frame-assets/'
const origin = 'http://frame.invalid'
const privateAsset = /\/api\/dsh-tavern\/(?:static-assets\?[^\s"'`<>\\)]+|remote-assets\/[^\s"'`<>\\)]+|(?:card-image|scene-image)\?[^\s"'`<>\\)]+|script-images\/[^\s"'`<>\\)]+)/g
const error = message => Object.assign(new Error(message),{status:403})
function canonical(value) {
  const url = new URL(value,origin)
  if (url.origin !== origin) throw error('资源路径无效')
  url.searchParams.delete('scriptId'); url.searchParams.delete('host'); url.hash=''
  url.searchParams.sort()
  return url.pathname+url.search
}
export function scopeFrameResourceText(text, access) {
  if (!access?.prefix) return String(text)
  return String(text).replace(privateAsset,url=>access.prefix+'?url='+encodeURIComponent(url))
}

/** An ephemeral GET capability delegates only this card's images and its admitted dependency graph. */
export function createFrameResources({readResource,validateScope}) {
  const entries=new Map(),bySession=new Map(),sources=new WeakMap()
  function prepareSource(text) {
    const value=Object.freeze({}),source=String(text)
    sources.set(value,{text:source,digest:createHash('sha256').update(source).digest('hex')})
    return value
  }
  function seed(entry,text) {
    const candidates=String(text).match(privateAsset)||[]
    for(const url of String(text).match(/https?:\/\/[^\s"'`<>\\)]+/g)||[]) candidates.push('/api/dsh-tavern/static-assets?url='+encodeURIComponent(url))
    for(const url of candidates) {
      if(entry.allowed.size>=4096) break
      try {entry.allowed.add(canonical(url))} catch {}
    }
  }
  function publish(scope,text) {
    const prepared=text&&typeof text==='object'?sources.get(text):null
    const sourceDigest=prepared?.digest||createHash('sha256').update(String(text)).digest('hex')
    if(prepared)text=prepared.text
    const key=createHash('sha256').update(JSON.stringify([scope,sourceDigest])).digest('hex')
    const scopeId=scope.sessionId+'\n'+(scope.ownerId || '')
    let token=bySession.get(scopeId),entry=entries.get(token)
    if(!entry||entry.key!==key) {
      if(token) entries.delete(token)
      token=randomBytes(32).toString('base64url');entry={key,sourceDigest,scopeId,scope:structuredClone(scope),allowed:new Set(),failures:[],token};entries.set(token,entry);bySession.set(scopeId,token)
      seed(entry,text)
    }
    while(entries.size>1024) {const oldest=entries.keys().next().value,old=entries.get(oldest);entries.delete(oldest);if(bySession.get(old.scopeId)===oldest)bySession.delete(old.scopeId)}
    return {prefix:root+token+'/',...(scope.networkTrusted?{networkAllowed:true}:{})}
  }
  function entryFor(req) {
    if(req.method!=='GET'||['navigate'].includes(req.headers?.['sec-fetch-mode'])||['document','iframe','frame','object','embed'].includes(req.headers?.['sec-fetch-dest']))return null
    const url=new URL(req.url,origin),match=/^\/api\/dsh-tavern\/frame-assets\/([A-Za-z0-9_-]{43})\/$/.exec(url.pathname)
    return match?entries.get(match[1]):null
  }
  function accepts(req) {return !!entryFor(req)}
  async function read(req) {
    const entry=entryFor(req)
    if(!entry||!await validateScope(entry.scope))throw error('资源授权已失效，请刷新卡片')
    if(new URL(req.url,origin).searchParams.get('diagnostics')==='1')return {mediaType:'application/json',body:Buffer.from(JSON.stringify({failures:entry.failures.filter(row=>Date.now()-row.at<120000)}))}
    const target=canonical(new URL(req.url,origin).searchParams.get('url')||''),url=new URL(target,origin)
    const ownCard=url.pathname==='/api/dsh-tavern/card-image'&&url.searchParams.get('path')===entry.scope.cardPath
    const ownScene=url.pathname==='/api/dsh-tavern/scene-image'&&url.searchParams.get('sessionId')===entry.scope.sessionId
    const scriptImage=url.pathname.startsWith('/api/dsh-tavern/script-images/')
    const staticAsset=url.pathname==='/api/dsh-tavern/static-assets'
    const dependency=(staticAsset||/^\/api\/dsh-tavern\/remote-assets\/[a-f0-9]{64}(?:\/[^/]*)?$/.test(url.pathname))
      && (entry.allowed.has(target) || staticAsset && entry.scope.networkTrusted === true)
    if(!ownCard&&!ownScene&&!scriptImage&&!dependency)throw error('资源不属于当前卡片或已声明的依赖')
    // readResource must additionally check script-image ownership and bound all downloaded bodies.
    let asset
    try{asset=await readResource(url,entry.scope,{module:req.headers?.['sec-fetch-dest']==='script'});if(!asset)throw Object.assign(Error('找不到资源'),{status:404});if(req.headers?.['sec-fetch-dest']==='script')assertModuleResourceType(asset)}catch(cause){
      let display='';try{const publicUrl=new URL(url.searchParams.get('url'));if(['https:','http:'].includes(publicUrl.protocol))display=publicUrl.origin+publicUrl.pathname}catch{}
      const code=['RESOURCE_FAKE_IP_DNS','RESOURCE_DNS_POLICY','TRUSTED_PROXY_CONNECTION_FAILED','RESOURCE_MODULE_TYPE'].includes(cause.code)?cause.code:'RESOURCE_LOAD_FAILED'
      const message=code==='TRUSTED_PROXY_CONNECTION_FAILED'?'信任本机代理连接失败，请检查代理/TUN和Fake-IP映射':code==='RESOURCE_FAKE_IP_DNS'?'代理 Fake-IP 的公共 DNS 解析失败':code==='RESOURCE_DNS_POLICY'?'资源 DNS 指向私网或保留地址，已阻止访问':'远程资源下载失败'
      entry.failures.push({at:Date.now(),url:display.slice(0,500),status:Number(cause.status)>=400&&Number(cause.status)<=599?Number(cause.status):502,code,message})
      if(entry.failures.length>8)entry.failures.shift()
      throw cause
    }
    const textual=/^(?:text\/|application\/(?:javascript|json)|image\/svg)/.test(asset.mediaType)
    if(!textual)return asset
    seed(entry,asset.body.toString('utf8'))
    return {...asset,body:Buffer.from(scopeFrameResourceText(asset.body.toString('utf8'),{prefix:root+entry.token+'/'}))}
  }
  function revoke(sessionId){for(const [scopeId,token] of bySession)if(scopeId.startsWith(sessionId+'\n')){entries.delete(token);bySession.delete(scopeId)}}
  return {prepareSource,publish,accepts,read,revoke,revokeAll(){entries.clear();bySession.clear()},currentAccess:(sessionId,ownerId='')=>bySession.get(sessionId+'\n'+ownerId)||null}
}
