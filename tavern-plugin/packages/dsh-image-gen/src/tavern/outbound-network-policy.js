import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { Readable, Transform, pipeline } from 'node:stream'
import { createGunzip, createBrotliDecompress, createInflate } from 'node:zlib'

const stripBrackets = value => value.replace(/^\[|\]$/g, '').toLowerCase()
const ipv4 = value => value.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n)
const in4 = (value, base, bits) => value >> BigInt(32 - bits) === ipv4(base) >> BigInt(32 - bits)
function ipv6(value) {
  if (value.includes('.')) value = value.replace(/(?:\d+\.){3}\d+$/, part => { const n = ipv4(part); return (n >> 16n).toString(16) + ':' + (n & 65535n).toString(16) })
  const [left, right] = value.split('::'), a = left ? left.split(':') : [], b = right ? right.split(':') : []
  const parts = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
  return parts.reduce((n, part) => (n << 16n) | BigInt('0x' + part), 0n)
}
const in6 = (value, base, bits) => value >> BigInt(128 - bits) === ipv6(base) >> BigInt(128 - bits)
const isProxyFakeIp = row => isIP(row.address) === 4 && Number(row.family) === 4 && in4(ipv4(row.address), '198.18.0.0', 15)
// Ordinary resource destinations must be public. DNS-provided Fake-IP mappings
// are admitted separately below; they are not made globally routable here.
// Explicit host model origins may also use ordinary LAN/loopback addresses;
// metadata, link-local, multicast, reserved and transition ranges stay denied.
export function outboundAddressKind(address) {
  const host = stripBrackets(String(address)), family = isIP(host)
  if (family === 4) {
    const n = ipv4(host)
    if (host === '100.100.100.200' || host === '168.63.129.16') return 'blocked'
    if ([['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16]].some(([base, bits]) => in4(n, base, bits))) return 'local'
    if ([['0.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]].some(([base, bits]) => in4(n, base, bits))) return 'blocked'
    return 'public'
  }
  if (family === 6) {
    const n = ipv6(host)
    if (n === 1n || in6(n, 'fc00::', 7)) return 'local'
    // IPv4-mapped and translation/transition forms are deliberately not local exceptions.
    if (!in6(n, '2000::', 3) || [['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]].some(([base, bits]) => in6(n, base, bits))) return 'blocked'
    return 'public'
  }
  return 'blocked'
}

function allowedOrigin(url, purpose, allowedModelOrigins) {
  if (purpose !== 'model') return false
  return (allowedModelOrigins || []).some(value => { try { return new URL(value).origin === url.origin } catch { return false } })
}

export function validateOutboundUrl(value, { purpose = 'resource', allowedModelOrigins = [], trustedResource = false } = {}) {
  let url
  try { url = new URL(value) } catch { throw new Error('外连目标 URL 无效') }
  if (!(purpose === 'model' || trustedResource ? ['https:', 'http:'] : ['https:']).includes(url.protocol)) throw new Error('外连目标协议禁止')
  if (url.username || url.password) throw new Error('外连目标不能包含凭据')
  const host = stripBrackets(url.hostname), local = trustedResource || allowedOrigin(url, purpose, allowedModelOrigins)
  const kind = isIP(host) ? outboundAddressKind(host) : null
  if (kind === 'blocked' || kind === 'local' && !local || !local && /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host.replace(/\.$/, ''))) throw new Error('禁止访问私网或保留地址')
  url.hash = ''
  return url
}

// Trust the local proxy DNS mappings. Keep its answers and their order; never
// substitute public DNS. The proxy owns the final destination behind Fake-IP.
// Host, SNI and certificate verification still use the requested domain.

export async function resolveOutboundTarget(value, { lookup = dnsLookup, purpose = 'resource', allowedModelOrigins = [], trustedResource = false } = {}) {
  const policy = { purpose, allowedModelOrigins, trustedResource }, url = validateOutboundUrl(value, policy), host = stripBrackets(url.hostname)
  let addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true, verbatim: true })
  if (!Array.isArray(addresses) || !addresses.length) throw new Error('外连目标没有可用地址')
  const hasFakeIp = !isIP(host) && addresses.some(isProxyFakeIp)
  const local = trustedResource || allowedOrigin(url, purpose, allowedModelOrigins)
  const trustedFakeIp = hasFakeIp && addresses.every(row => isProxyFakeIp(row) || Number(row.family) === isIP(row.address) && (outboundAddressKind(row.address) === 'public' || local && outboundAddressKind(row.address) === 'local'))
  for (const row of addresses) {
    const kind = outboundAddressKind(row.address)
    if (!isIP(row.address) || Number(row.family) !== isIP(row.address) || kind !== 'public' && !(trustedFakeIp && isProxyFakeIp(row)) && !(local && kind === 'local')) throw Object.assign(new Error('DNS 解析包含禁止的私网或保留地址'),{code:'RESOURCE_DNS_POLICY',status:403})
  }
  return { url, addresses: addresses.map(row => ({ address: row.address, family: Number(row.family) })) }
}

export function validateCustomModelFields(include = {}, exclude = [], headers = {}) {
  if (!include || typeof include !== 'object' || Array.isArray(include) || !Array.isArray(exclude) || exclude.some(key => typeof key !== 'string')) throw new Error('附加参数格式无效')
  if (['model', 'messages', 'stream'].some(key => Object.hasOwn(include, key) || exclude.includes(key))) throw new Error('附加参数不能替换或删除模型、聊天正文和 stream 核心字段')
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('请求头格式无效')
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string' || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\r\n\0]/.test(value) || /^(?:host|connection|content-length|transfer-encoding|upgrade|te|trailer|accept-encoding|forwarded|proxy-.+|x-forwarded-.+)$/i.test(name)) throw new Error('禁止的自定义请求头：' + name)
  }
}

/** Fetch subset used by this plugin. DNS is pinned in the actual TCP/TLS connection,
 * while the original hostname is retained for Host, SNI and certificate validation.
 * Reuse sockets only while the validated system DNS answer remains identical.
 * No proxy environment variables, alternate DNS, or ambient cookies are used. */
class PinnedHttpAgent extends http.Agent { getName(options) { return super.getName(options)+':'+options.dshAddressKey } }
class PinnedHttpsAgent extends https.Agent { getName(options) { return super.getName(options)+':'+options.dshAddressKey } }
const httpAgent=new PinnedHttpAgent({keepAlive:true,maxSockets:16,maxFreeSockets:4,timeout:30000})
const httpsAgent=new PinnedHttpsAgent({keepAlive:true,maxSockets:16,maxFreeSockets:4,timeout:30000})
function pinnedRequest(target, init, { httpRequest = http.request, httpsRequest = https.request, maxDecodedBytes = 64*1024*1024 } = {}) {
  return new Promise((resolve, reject) => {
    const { url, addresses } = target, host = stripBrackets(url.hostname)
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: init.method || 'GET', headers: { ...init.headers, 'Accept-Encoding': 'gzip, br, deflate' }, signal: init.signal,
      agent: url.protocol==='https:'?httpsAgent:httpAgent, dshAddressKey:addresses.map(row=>row.address+'/'+row.family).join(','),
      autoSelectFamily: true, autoSelectFamilyAttemptTimeout:250,
      lookup: (_name, options, callback) => { const row = addresses[0]; if (options?.all) callback(null, addresses); else callback(null, row.address, row.family) },
      ...(url.protocol === 'https:' && !isIP(host) ? { servername: host } : {})
    }, incoming => {
      try {
        const headers = new Headers()
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1])
        const noBody = init.method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode)
        const encoding=(headers.get('content-encoding') || 'identity').toLowerCase()
        const decompressor=encoding==='gzip'?createGunzip():encoding==='br'?createBrotliDecompress():encoding==='deflate'?createInflate():null
        if(!noBody && !decompressor && encoding!=='identity')throw Error('不支持的响应压缩编码：'+encoding)
        let bytes=0
        const bounded=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>maxDecodedBytes?Error('外连响应解压后超过上限'):null,chunk)}})
        if(decompressor){headers.delete('content-encoding');headers.delete('content-length')}
        if(!noBody)pipeline(incoming,...(decompressor?[decompressor]:[]),bounded,()=>{})
        const response = new Response(noBody ? null : Readable.toWeb(bounded), { status: incoming.statusCode, headers })
        Object.defineProperty(response, 'url', { value: url.href })
        if (noBody) incoming.resume()
        resolve(response)
      } catch (error) { incoming.destroy(); reject(error) }
    })
    request.on('error', reject)
    if (init.body !== undefined) request.write(init.body)
    request.end()
  })
}

export async function safeOutboundFetch(value, init = {}, options = {}) {
  assertOutboundEnabled()
  const origins = typeof options.allowedModelOrigins === 'function' ? await options.allowedModelOrigins() : options.allowedModelOrigins
  const target = await resolveOutboundTarget(value, { ...options, allowedModelOrigins: origins })
  init.signal?.throwIfAborted()
  let response
  try { response = options.fetcher ? await options.fetcher(target.url.href, { ...init, redirect: init.redirect === 'error' ? 'error' : 'manual' }, target) : await pinnedRequest(target, init, options) }
  catch(error) {
    if (!init.signal?.aborted && isProxyFakeIp(target.addresses[0])) throw Object.assign(new Error('信任本机代理连接失败，请确认代理/TUN 已启用且 Fake-IP 映射有效', { cause: error }), { code:'TRUSTED_PROXY_CONNECTION_FAILED', status:502 })
    throw error
  }
  // The production transport cannot follow redirects. Injected transports must not either.
  if (response?.url && new URL(response.url).href !== target.url.href) { await response.body?.cancel?.(); throw new Error('外连传输发生未校验的重定向') }
  if ([301, 302, 303, 307, 308].includes(response?.status) && init.redirect === 'error') { await response.body?.cancel?.(); throw new Error('模型接口禁止重定向') }
  return response
}

export function outboundDisabled() { return /^(?:1|true)$/i.test(process.env.DSH_TAVERN_OFFLINE || '') }
export function assertOutboundEnabled() { if (outboundDisabled()) throw new Error('离线模式已关闭主动外连（DSH_TAVERN_OFFLINE）') }

export async function readBoundedResponse(response, maxBytes, label = '外连响应') {
  if (Number(response.headers?.get?.('content-length')) > maxBytes) { await response.body?.cancel?.(); throw new Error(label + '超过上限') }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new Error(label + '超过上限')
    return bytes
  }
  const chunks = []; let size = 0
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); size += bytes.length
    if (size > maxBytes) throw new Error(label + '超过上限')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}
