import { projectTavernHostScript } from './tavern-host-script-projection.js'
import {createRemoteCacheBudget} from './remote-cache-budget.js'
import {retentionFile,applyRetentionFiles} from './retention-policy.js'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { validateOutboundUrl, safeOutboundFetch, readBoundedResponse } from './outbound-network-policy.js'
import {parse} from 'acorn'

const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024
const CACHE_VERSION = 1

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cacheKey(url) {
  return createHash('sha256').update(url, 'utf8').digest('hex')
}

export function normalizeCacheableResourceUrl(value, policy = {}) {
  let parsed
  try { parsed = new URL(str(value)) } catch { throw new Error('静态资源 URL 无效') }
  if (parsed.username !== '' || parsed.password !== '') throw new Error('静态资源 URL 不能包含凭据')
  validateOutboundUrl(parsed.href,policy)
  parsed.hash = ''
  return parsed.href
}

function supportedMediaType(value) {
  const type = str(value).split(';')[0].trim().toLowerCase()
  return /^(text\/|image\/|audio\/|video\/|font\/)/.test(type)
    || /^(application\/(javascript|json|ld\+json|wasm|xml|octet-stream|font-woff|font-woff2|vnd\.ms-fontobject)|application\/.+\+xml)$/.test(type)
}

function fallbackMediaType(url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase()
  return ({
    '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm'
  })[extension] || 'application/octet-stream'
}

function localResourceUrl(url,scriptId='') {
  return '/api/dsh-tavern/static-assets?url=' + encodeURIComponent(url) + (scriptId ? '&scriptId=' + encodeURIComponent(scriptId) : '')
}

function absoluteCacheUrl(specifier, baseUrl) {
  return localResourceUrl(new URL(specifier, baseUrl).href)
}

export function rewriteCachedModuleImports(source, baseUrl, scriptId='') {
  const projected=projectTavernHostScript(str(source)),edits=[]
  let ast
  // Preserve unsupported syntax for the browser's own diagnostic. Rewriting
  // apparent imports inside ordinary strings/comments can corrupt valid code.
  try{ast=parse(projected,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true})}catch{}
  const urlLike=value=>typeof value==='string'&&/^(?:\.{1,2}\/|\/|https?:\/\/)/i.test(value)
  const literal=node=>node?.type==='Literal'?node.value:node?.type==='TemplateLiteral'&&!node.expressions.length?node.quasis[0].value.cooked:undefined
  function rewrite(node){const value=literal(node);if(urlLike(value))edits.push({start:node.start,end:node.end,text:JSON.stringify(localResourceUrl(new URL(value,baseUrl).href,scriptId))})}
  const nodes=ast?[ast]:[]
  while(nodes.length){const node=nodes.pop()
    if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source)rewrite(node.source)
    if(node.type==='ImportExpression'){
      if(literal(node.source)!==undefined)rewrite(node.source)
      else edits.push({start:node.source.start,end:node.source.start,text:'globalThis.__dshTavernResolveModuleSpecifier(('},{start:node.source.end,end:node.source.end,text:'),'+JSON.stringify(baseUrl)+')'})
    }
    if(node.type==='MemberExpression'&&!node.computed&&node.object.type==='MetaProperty'&&node.object.meta.name==='import'&&node.property.name==='url')edits.push({start:node.start,end:node.end,text:JSON.stringify(baseUrl)})
    for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value)if(child?.type)nodes.push(child)}else if(value?.type)nodes.push(value)}
  }
  let rewritten=projected
  for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))rewritten=rewritten.slice(0,edit.start)+edit.text+rewritten.slice(edit.end)
  return rewritten + (scriptId ? '\n//# sourceURL=dsh-tavern-script:' + encodeURIComponent(scriptId) + '\n' : '')
}

function rewriteStylesheetUrls(source, baseUrl) {
  const urls = str(source).replace(/(url\(\s*)(?:(["'])(.*?)\2|([^"')]+?))(\s*\))/gi, function (_match, prefix, quote, quoted, bare, suffix) {
    const specifier=(quoted??bare).trim();quote ||= ''
    if (/^(?:data:|blob:|#|var\()/i.test(specifier)) return _match
    return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote + suffix
  })
  return urls.replace(/(@import\s+)(["'])([^"']+)\2/gi, function (_match, prefix, quote, specifier) {
    if (/^(?:data:|blob:|#)/i.test(specifier)) return _match
    return prefix + quote + absoluteCacheUrl(specifier, baseUrl) + quote
  })
}

function rewriteHtmlResourceAttributes(source, baseUrl) {
  function project(specifier){
    if(!specifier||/^(?:[a-z][\w+.-]*:(?!\/\/)|#|\/api\/dsh-tavern\/)/i.test(specifier))return specifier
    const decoded=specifier.replace(/&(?:amp|#38|#x26);/gi,'&')
    return absoluteCacheUrl(decoded,baseUrl)
  }
  const rewritten = str(source)
    .replace(/(\s(?:src|poster)\s*=\s*)(["'])([^"']*)\2/gi, function (_match, prefix, quote, specifier) {
      return prefix + quote + project(specifier) + quote
    })
    .replace(/(<link\b[^>]*\shref\s*=\s*)(["'])([^"']*)\2/gi, function (_match, prefix, quote, specifier) {
      return prefix + quote + project(specifier) + quote
    })
    .replace(/(\s(?:src|poster)\s*=\s*)([^\s"'`<>]+)/gi, function (_match, prefix, specifier) {
      return prefix + '"' + project(specifier) + '"'
    })
    .replace(/(<link\b[^>]*\shref\s*=\s*)([^\s"'`<>]+)/gi, function (_match, prefix, specifier) {
      return prefix + '"' + project(specifier) + '"'
    })
  return rewritten.replace(/<(?:video|audio|source)\b[^>]*>/gi, function (tag) {
    return tag.replace(/(\ssrc\s*=\s*)(["'])(\/api\/dsh-tavern\/static-assets\?url=([^"']+))\2/gi, function (_match, prefix, quote, proxy, url) {
      return prefix + quote + decodeURIComponent(url) + quote
    })
  })
}

function rewriteHtmlStyles(source, baseUrl) {
  return str(source)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (_match, opening, css, closing) {
      return opening + rewriteStylesheetUrls(css, baseUrl) + closing
    })
    .replace(/(\bstyle\s*=\s*)(["'])([^"']*)\2/gi, function (_match, prefix, quote, css) {
      return prefix + quote + rewriteStylesheetUrls(css, baseUrl) + quote
    })
}

function rewriteHtmlDocumentResources(source, baseUrl) {
  // Some published card pages wrap the entire HTML document in a Markdown
  // fence. Normalize only that complete wrapper in the served projection;
  // cached source bytes and their integrity hash remain unchanged.
  const fenced = str(source).trim().match(/^```(?:html)?\s*\r?\n([\s\S]*?)\r?\n```$/i)
  if (fenced && /^\s*(?:<!doctype\s+html\b|<html\b)/i.test(fenced[1])) source = fenced[1]
  const scripts = []
  let marker = '__DSH_TAVERN_SCRIPT_'
  while (str(source).includes(marker)) marker = '_' + marker
  const markup = str(source).replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, function (_match, opening, javascript, closing) {
    const index = scripts.length
    scripts.push(rewriteHtmlResourceAttributes(opening, baseUrl) + rewriteCachedModuleImports(javascript, baseUrl) + closing)
    return marker + index + '__'
  })
  const rewritten = rewriteHtmlStyles(rewriteHtmlResourceAttributes(markup, baseUrl), baseUrl)
  return rewritten.replace(new RegExp(marker + '(\\d+)__', 'g'), function (_match, index) {
    return scripts[Number(index)] || ''
  })
}

export function cachedResourceMediaType(asset) {
  let mediaType = str(asset && asset.mediaType).toLowerCase()
  let extension = ''
  try { extension = path.extname(new URL(asset.finalUrl || asset.url).pathname).toLowerCase() } catch {}
  if (mediaType === 'text/plain' && (extension === '.js' || extension === '.mjs')) mediaType = 'application/javascript'
  if (mediaType === 'text/plain' && extension === '.css') mediaType = 'text/css'
  if (mediaType === 'text/plain' && (extension === '.html' || extension === '.htm')) mediaType = 'text/html'
  return mediaType
}

export function assertModuleResourceType(asset) {
  const type=cachedResourceMediaType(asset)
  if(!/^(?:(?:text|application)\/(?:javascript|ecmascript)|application\/json)$/.test(type))throw Object.assign(Error('脚本模块返回了不支持的内容类型：'+String(type).slice(0,120)),{status:415,code:'RESOURCE_MODULE_TYPE'})
}

export function projectCachedResourceBody(asset, {scriptId=''}={}) {
  const mediaType = cachedResourceMediaType(asset)
  const body = Buffer.isBuffer(asset && asset.body) ? asset.body : Buffer.from(asset && asset.body || '')
  if (mediaType === 'application/javascript' || mediaType === 'text/javascript') {
    return Buffer.from(rewriteCachedModuleImports(body.toString('utf8'), asset.finalUrl || asset.url,scriptId), 'utf8')
  }
  if (mediaType === 'text/css') {
    return Buffer.from(rewriteStylesheetUrls(body.toString('utf8'), asset.finalUrl || asset.url), 'utf8')
  }
  if (mediaType === 'text/html' || mediaType === 'image/svg+xml') {
    const baseUrl = asset.finalUrl || asset.url
    return Buffer.from(rewriteHtmlDocumentResources(body.toString('utf8'), baseUrl), 'utf8')
  }
  return body
}

export function createTavernStaticResourceCache(options = {}) {
  const rootDir = path.resolve(str(options.rootDir) || '.dsh-tavern-static-assets')
  const request = (url, init, policy) => safeOutboundFetch(url, init, { ...policy,fetcher: options.fetch, lookup: options.lookup,maxDecodedBytes:maxEntryBytes })
  const maxEntryBytes = Math.max(1, Number(options.maxEntryBytes) || DEFAULT_MAX_ENTRY_BYTES)
  const maxTotalBytes = Math.max(maxEntryBytes, Number(options.maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES)
  const verifyHostname = typeof options.verifyHostname === 'function' ? options.verifyHostname : async function () {}
  const inflight = new Map()
  const temporaryFiles = new Set()
  const budget=options.budget||createRemoteCacheBudget({maxBytes:maxTotalBytes})

  function paths(url,policy={}) {
    const key = cacheKey(url+(policy.trustedResource?'\ntrusted-resource':''))
    return { key, body: path.join(rootDir, key + '.body'), metadata: path.join(rootDir, key + '.json') }
  }

  async function read(url,policy={}) {
    normalizeCacheableResourceUrl(url,policy)
    const files = paths(url,policy)
    try {
      const metadata = JSON.parse(await readFile(files.metadata, 'utf8'))
      if (metadata.version !== CACHE_VERSION || metadata.url !== url) return null
      normalizeCacheableResourceUrl(metadata.finalUrl || url,policy)
      const body = await readFile(files.body)
      if (body.length !== metadata.bytes || createHash('sha256').update(body).digest('hex') !== metadata.contentHash) return null
      const now = new Date()
      await Promise.allSettled([utimes(files.body, now, now), utimes(files.metadata, now, now)])
      return { url, finalUrl: metadata.finalUrl || url, body, mediaType: metadata.mediaType, bytes: body.length, cachedAt: metadata.cachedAt, cache: 'hit' }
    } catch {
      return null
    }
  }

  budget.register('static-assets',{
    async entries(){
      let names;try{names=await readdir(rootDir)}catch(error){if(error.code==='ENOENT')return [];throw error}
      const rows=[]
      const hashes=new Set(names.filter(name=>/^[a-f0-9]{64}\.(?:body|json)$/.test(name)).map(name=>name.slice(0,64)))
      for(const hash of hashes){
        const body=await retentionFile(rootDir,hash+'.body','remote-cache-lru'),metadata=await retentionFile(rootDir,hash+'.json','remote-cache-lru'),files=[body,metadata].filter(Boolean)
        if(files.length)rows.push({key:hash+'.body',bytes:files.reduce((sum,file)=>sum+file.bytes,0),lastUsed:Math.max(...files.map(file=>Number(file.stamp.split(':')[1])/1e6)),files})
      }
      for(const name of names.filter(name=>/^[a-f0-9]{64}\.(?:body|json)\.\d+\.\d+$/.test(name)&&!temporaryFiles.has(name))){const file=await retentionFile(rootDir,name,'interrupted-cache-download');if(file)rows.push({key:name,bytes:file.bytes,lastUsed:0,files:[file]})}
      return rows
    },
    async remove(row){const result=await applyRetentionFiles(rootDir,row.files,{dryRun:false});return result.skipped.length===0}
  })
  const trim=options=>budget.trim(options)

  async function download(url,policy) {
    if (typeof request !== 'function') throw new Error('当前运行环境不能下载静态资源')
    let currentUrl = url
    let response
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      await verifyHostname(currentUrl)
      response = await request(currentUrl, {
        headers: { Accept: '*/*', 'User-Agent': 'dsh-tavern-static-cache' },
        redirect: 'manual',
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(30000) : undefined
      },policy)
      if (!response || ![301, 302, 303, 307, 308].includes(Number(response.status))) break
      await response.body?.cancel?.()
      const location = str(response.headers && response.headers.get && response.headers.get('location'))
      if (location === '') throw new Error('静态资源重定向缺少目标地址')
      currentUrl = normalizeCacheableResourceUrl(new URL(location, currentUrl).href,policy)
      if (redirectCount === 5) throw new Error('静态资源重定向次数过多')
    }
    if (!response || response.ok !== true) throw Object.assign(new Error('静态资源下载失败（HTTP ' + str(response && response.status) + '）'),{status:Number(response?.status)>=400&&Number(response?.status)<=599?Number(response.status):502})
    const finalUrl = normalizeCacheableResourceUrl(response.url || currentUrl,policy)
    const declaredBytes = Number(response.headers && response.headers.get && response.headers.get('content-length')) || 0
    if (declaredBytes > maxEntryBytes) throw new Error('静态资源超过单文件缓存上限')
    const body = await readBoundedResponse(response, maxEntryBytes, '静态资源')
    if (body.length > maxEntryBytes) throw new Error('静态资源超过单文件缓存上限')
    const mediaType = str(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].trim().toLowerCase() || fallbackMediaType(finalUrl)
    if (!supportedMediaType(mediaType)) throw new Error('不支持缓存的静态资源类型: ' + mediaType)
    if(policy.module)assertModuleResourceType({url,finalUrl,mediaType})
    await mkdir(rootDir, { recursive: true })
    const files = paths(url,policy)
    const suffix = '.' + process.pid + '.' + Date.now()
    const metadata = {
      version: CACHE_VERSION,
      url,
      finalUrl,
      mediaType,
      bytes: body.length,
      contentHash: createHash('sha256').update(body).digest('hex'),
      cachedAt: Date.now()
    }
    const temporaries=[files.body+suffix,files.metadata+suffix]
    for(const file of temporaries)temporaryFiles.add(path.basename(file))
    try{
      await writeFile(temporaries[0], body)
      await writeFile(temporaries[1], JSON.stringify(metadata), 'utf8')
      await rename(temporaries[0], files.body)
      await rename(temporaries[1], files.metadata)
    }finally{
      try{await Promise.all(temporaries.map(file=>unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error})))}
      finally{for(const file of temporaries)temporaryFiles.delete(path.basename(file))}
    }
    await trim()
    return { url, finalUrl, body, mediaType, bytes: body.length, cachedAt: metadata.cachedAt, cache: 'miss' }
  }

  async function get(value,policy={}) {
    const url = normalizeCacheableResourceUrl(value,policy)
    const cached = await read(url,policy)
    if (cached) {let valid=true;if(policy.module)try{assertModuleResourceType(cached)}catch{valid=false}if(valid)return cached}
    const key=paths(url,policy).key
    if (inflight.has(key)) return await inflight.get(key)
    const pending = download(url,policy).finally(function () { inflight.delete(key) })
    inflight.set(key, pending)
    return await pending
  }

  async function warm(urls,policy={}) {
    return await Promise.allSettled(Array.from(new Set(urls || [])).map(url=>get(url,policy)))
  }

  async function restoreArchive(record) {
    const policy={trustedResource:record.trustedResource===true},url=normalizeCacheableResourceUrl(record.url,policy),finalUrl=normalizeCacheableResourceUrl(record.finalUrl||url,policy),body=Buffer.from(record.body,'base64')
    if(body.length!==record.bytes||body.length>maxEntryBytes||createHash('sha256').update(body).digest('hex')!==record.contentHash||!supportedMediaType(record.mediaType))throw Error('搬家包静态缓存校验失败')
    if(await read(url,policy))return
    const files=paths(url,policy),suffix='.'+process.pid+'.'+Date.now(),metadata={version:CACHE_VERSION,url,finalUrl,bytes:body.length,contentHash:record.contentHash,mediaType:record.mediaType,cachedAt:record.cachedAt||Date.now()}
    await mkdir(rootDir,{recursive:true})
    const temporaries=[files.body+suffix,files.metadata+suffix];for(const file of temporaries)temporaryFiles.add(path.basename(file))
    try{await writeFile(temporaries[0],body);await writeFile(temporaries[1],JSON.stringify(metadata));await rename(temporaries[0],files.body);await rename(temporaries[1],files.metadata)}
    finally{for(const file of temporaries){await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error});temporaryFiles.delete(path.basename(file))}}
  }
  return Object.freeze({ get, read, warm, trim, rootDir, restoreArchive })
}
