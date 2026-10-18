import {safeOutboundFetch,readBoundedResponse,validateOutboundUrl} from './outbound-network-policy.js'

// The fixed SP research clients expect host-forwarded HTML, not search JSON.
export function createSpWebResearch({assertOwner,networkPolicy,fetcher,lookup,timeoutMs=20000,maxBytes=2*1024*1024}) {
 const pending=new Map()
 return async function request(sessionId,operation,owner,lifecycle) {
  await assertOwner(sessionId,owner,lifecycle)
  if(!operation||typeof operation!=='object'||typeof operation.requestId!=='string'||! /^[a-zA-Z0-9_-]{1,120}$/.test(operation.requestId))throw Error('网页请求身份无效')
  const key=JSON.stringify([sessionId,owner,lifecycle,operation.requestId])
  if(operation.kind==='cancel'){pending.get(key)?.abort();return {cancelled:true}}
  if(!['/api/search/searxng','/api/search/visit'].includes(operation.path))throw Error('不支持的 SP 网页路由')
  if(pending.has(key)||pending.size>=32)throw Error('网页请求重复或并发数量超过上限')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);pending.set(key,controller)
  try {
  const policy=await networkPolicy(sessionId,owner)
  if(policy.trustedResource!==true)throw Error('网页检索需要网络权限')
  const body=operation.body
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('网页请求必须是 JSON 对象')
  let target,wantsHtml=true
  if(operation.path.endsWith('/searxng')){
   if(typeof body.baseUrl!=='string'||body.baseUrl.length>4096||typeof body.query!=='string'||!body.query.trim()||body.query.length>2000)throw Error('搜索实例地址或检索词无效')
   const base=validateOutboundUrl(body.baseUrl,policy)
   base.hash='';base.search='';base.pathname=base.pathname.replace(/\/$/,'')+'/search';base.searchParams.set('q',body.query);target=base.href
  }else{
   if(typeof body.url!=='string'||body.url.length>8192||typeof body.html!=='boolean')throw Error('网页读取参数无效')
   target=validateOutboundUrl(body.url,policy).href;wantsHtml=body.html
  }
   for(let redirects=0;;redirects++){
    controller.signal.throwIfAborted()
    await assertOwner(sessionId,owner,lifecycle)
    const response=await safeOutboundFetch(target,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:wantsHtml?'text/html,application/xhtml+xml':'application/json,text/plain,text/html'}},{...policy,fetcher,lookup,maxDecodedBytes:maxBytes})
    if([301,302,303,307,308].includes(response.status)){
     const location=response.headers.get('location');await response.body?.cancel?.()
     if(!location||redirects>=4)throw Error('网页重定向无效或过多')
     target=validateOutboundUrl(new URL(location,target).href,policy).href;continue
    }
    const contentType=response.headers.get('content-type')||'text/plain; charset=utf-8'
    if(response.ok&&wantsHtml&&!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)){await response.body?.cancel?.();throw Error('目标网页未返回 HTML')}
    const text=(await readBoundedResponse(response,maxBytes,'网页响应')).toString('utf8')
    controller.signal.throwIfAborted();await assertOwner(sessionId,owner,lifecycle)
    return {status:response.status,body:text,contentType}
   }
  }finally{clearTimeout(timer);pending.delete(key)}
 }
}
