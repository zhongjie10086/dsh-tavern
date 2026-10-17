import {createRemoteCacheBudget} from './remote-cache-budget.js'
import { isHostOwnedMvu } from './tavern-helper-scripts.js'
import { inspectCardMvuDeclaration } from './mvu-runtime-selection.js'
import {safeOutboundFetch,readBoundedResponse} from './outbound-network-policy.js'
import {isDeepStrictEqual} from 'node:util'
import {immutableJsonSnapshot,mutableJsonDraft} from './json-draft.js'
import {jsonBytes} from './readonly-json.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

// A URL in JS source ends at a backtick or template interpolation: swallowing
// `]); would splice the cache path over code and break the card script. (upstream 6e4aa79f)
const JSD_GH_URL = /https:\/\/(?:cdn|testingcf|gcore|fastly|originfastly|quantil)\.jsdelivr\.net\/gh\/([^/\s"'<>`$]+)\/([^/@\s"'<>`$]+)(?:@([^/\s"'<>`$]+))?(\/(?:[^\s"'<>`$]|\$(?!\{))*)?/g
const FIXED_COMMIT = /^[0-9a-f]{40}$/i
const CONTENT_HASH = /^[0-9a-f]{64}$/i
const MAX_ENTRY_BYTES = 5 * 1024 * 1024
export const REMOTE_IDENTITY_LIMITS = Object.freeze({entries:4096,bytes:4*1024*1024})

function validGitHubPart(value) {
  return /^[A-Za-z0-9_.-]+$/.test(value)
}

function validGitRef(value) {
  return value === 'HEAD' || (/^[A-Za-z0-9._/-]+$/.test(value) && !value.startsWith('-') && !value.includes('..') && !value.includes('@{'))
}

async function resolveWithGit(reference, options = {}) {
  if (!validGitHubPart(reference.owner) || !validGitHubPart(reference.repo) || !validGitRef(reference.ref)) throw new Error('远程 Git 引用格式不安全')
  const repoUrl = 'https://github.com/' + reference.owner + '/' + reference.repo + '.git/info/refs?service=git-upload-pack'
  const patterns = reference.ref === 'HEAD' ? ['HEAD'] : ['refs/heads/' + reference.ref, 'refs/tags/' + reference.ref, 'refs/tags/' + reference.ref + '^{}']
  const response = await safeOutboundFetch(repoUrl,{signal:options.signal,redirect:'error'},{fetcher:options.fetcher,lookup:options.lookup})
  if(!response.ok)throw new Error('Git 引用读取失败：HTTP '+response.status)
  const source = (await readBoundedResponse(response,1024*1024,'Git 引用')).toString('utf8')
  const commits = Array.from(source.matchAll(/([a-f0-9]{40}) ([^\0\r\n]+)/g)).filter(match=>patterns.includes(match[2])).map(match=>match[1])
  if (commits.length === 0) throw new Error('Git 未返回可锁定的提交号')
  return commits[commits.length - 1]
}

// Only concrete text entries belong in the script pin store. Media and URL
// directory prefixes are loaded by the browser/static-asset layer on demand.
function isTextEntry(reference) {
  return /\.(?:[cm]?js|html?|css|json)(?:[?#]|$)/i.test(reference.path)
}

export function inspectMutableJsDelivrUrls(text) {
  const urls = []
  for (const match of str(text).matchAll(JSD_GH_URL)) {
    if (FIXED_COMMIT.test(match[3])) continue
    urls.push({ url: match[0], owner: match[1], repo: match[2], ref: match[3] || 'HEAD', explicitRef: match[3] !== undefined, path: match[4] || '' })
  }
  return urls
}

function inspectFixedJsDelivrUrls(text) {
  const urls = []
  for (const match of str(text).matchAll(JSD_GH_URL)) {
    if (!FIXED_COMMIT.test(match[3])) continue
    urls.push({ url: match[0], owner: match[1], repo: match[2], commit: match[3], path: match[4] || '' })
  }
  return urls
}

function contentHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function cachedPath(asset) {
  const rawName = str(asset.path).split('/').filter(Boolean).at(-1) || 'asset.txt'
  const name = rawName.replace(/[^A-Za-z0-9._-]/g, '_') || 'asset.txt'
  return '/api/dsh-tavern/remote-assets/' + asset.hash + '/' + name + '?host=1'
}

/** Resolve mutable jsDelivr GitHub references once and persist the commit pin. */
export function createTavernRemoteAssetPinStore(options = {}) {
  const readJson = options.readJson
  const updateJson = options.updateJson
  const request = (url,init) => safeOutboundFetch(url,{...init,redirect:'error'},{fetcher:options.fetch,lookup:options.lookup})
  const gitResolver = options.resolveGitRef || ((reference,init) => resolveWithGit(reference,{...init,fetcher:options.fetch,lookup:options.lookup}))
  const storagePath = str(options.storagePath) || 'tavern-remote-asset-pins.json'
  const budget=options.budget||createRemoteCacheBudget()
  const metadataEntries=options.metadataEntries??REMOTE_IDENTITY_LIMITS.entries,metadataBytes=options.metadataBytes??REMOTE_IDENTITY_LIMITS.bytes
  let identityBytes=0
  if(!Number.isSafeInteger(metadataEntries)||metadataEntries<1||!Number.isSafeInteger(metadataBytes)||metadataBytes<1)throw new TypeError('远程资源身份记录上限无效')
  function assertMetadataBudget(value){
    const assets=Object.fromEntries(Object.entries({...value?.assets,...value?.versions}).map(([key,asset])=>{const metadata={...asset};delete metadata.content;return [key,metadata]}))
    const bytes=Buffer.byteLength(JSON.stringify({...value,assets,versions:undefined},null,2)+'\n')
    if(Object.keys(value?.pins||{}).length+Object.keys(assets).length>metadataEntries||bytes>metadataBytes)throw new Error('远程资源身份记录达到上限；已固定的版本与哈希继续保留，未添加新资源')
    return bytes
  }
  const memory = new Map()
  const assetsByUrl = new Map()
  const assetsByHash = new Map()
  const extensionResults = []
  let extensionResultBytes = 0
  const timeoutMs = options.timeoutMs || 8000
  const retryDelayMs = options.retryDelayMs ?? 30000
  const now = options.now || Date.now
  const pending = new Map(), failures = new Map(), waiters = []
  const report = row => options.onDiagnostic?.(row)
  const cancelled = () => { if (options.signal?.aborted) throw new Error('远程依赖解析已取消') }
  let active = 0
  async function limited(operation) {
    if (active >= 3) await new Promise(resolve => waiters.push(resolve))
    else active++
    try { cancelled(); return await operation() }
    finally { const next = waiters.shift(); if (next) next(); else active-- }
  }
  function shared(key, operation) {
    if (pending.has(key)) { report({ stage: 'resources', sharedCount: 1 }); return pending.get(key) }
    const failure = failures.get(key)
    if (failure && now() < failure.until) { report({ stage: 'resources', cooldownCount: 1 }); return Promise.reject(failure.error) }
    failures.delete(key)
    const task = Promise.resolve().then(operation).catch(error => {
      if (failures.size >= 256) failures.delete(failures.keys().next().value)
      failures.set(key, { error, until: now() + retryDelayMs })
      throw error
    }).finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
  async function timed(operation, duration = timeoutMs) {
    return limited(async () => {
      const controller = new AbortController()
      let timer, abort
      try {
        cancelled()
        const cancellation = new Promise((_, reject) => {
          abort = () => { controller.abort(); reject(new Error('远程依赖解析已取消')) }
          options.signal?.addEventListener('abort', abort, {once:true})
        })
        return await Promise.race([operation(controller.signal), cancellation, new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('远程资源请求超时')); }, duration)
        })])
      } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
    })
  }
  const fetchBody = (url, headers, kind) => timed(async signal => {
    report({stage:'resources',url})
    const response = await request(url, { headers, signal })
    if (!response || response.ok !== true) throw new Error('HTTP ' + str(response && response.status))
    const body=(await readBoundedResponse(response,MAX_ENTRY_BYTES,'远程入口')).toString('utf8')
    return { response, body: kind === 'json' ? JSON.parse(body) : body }
  })
  let loading
  let loaded = false
  let mutationTail = Promise.resolve()

  function load() {
    if (!loading) loading = loadSaved().catch(error => { loading = null; throw error })
    return loading
  }

  async function loadSaved() {
    if (loaded) return
    const saved = typeof readJson === 'function' ? await readJson(storagePath) : null
    identityBytes=assertMetadataBudget(saved)
    const pins = saved && saved.pins && typeof saved.pins === 'object' ? saved.pins : {}
    for (const [key, value] of Object.entries(pins)) {
      if (value && FIXED_COMMIT.test(str(value.commit))) memory.set(key, clone(value))
    }
    const assets = saved && saved.assets && typeof saved.assets === 'object' ? saved.assets : {}
    for (const [url, value] of Object.entries(assets)) {
      if (!value || !CONTENT_HASH.test(str(value.hash))) continue
      if (typeof value.content === 'string' && contentHash(value.content) !== str(value.hash).toLowerCase()) continue
      const asset = Object.assign({}, clone(value), { url })
      assetsByUrl.set(url, asset)
      assetsByHash.set(asset.hash, asset)
    }
    for(const [hash,row]of Object.entries(saved?.versions||{}))if(CONTENT_HASH.test(hash)&&row?.hash===hash&&typeof row.content==='string'&&contentHash(row.content)===hash)assetsByHash.set(hash,clone(row))
    loaded = true
  }

  async function persist(key, value) {
    mutationTail = mutationTail.catch(() => {}).then(async function () {
      cancelled()
      if(memory.has(key))return
      let nextBytes
      const update = function (current) {
        const next = current && typeof current === 'object' ? Object.assign({}, current) : {}
        next.version = 2
        next.pins = next.pins && typeof next.pins === 'object' ? Object.assign({}, next.pins) : {}
        next.pins[key] = clone(value)
        next.updatedAt = Date.now()
        nextBytes=assertMetadataBudget(next)
        return next
      }
      if(typeof updateJson==='function')await updateJson(storagePath,update)
      else update({pins:Object.fromEntries(memory),assets:Object.fromEntries(assetsByUrl)})
      identityBytes=nextBytes
      memory.set(key,value)
    })
    await mutationTail
    return memory.get(key)
  }

  async function persistAsset(asset) {
    mutationTail = mutationTail.catch(() => {}).then(async function () {
      cancelled()
      const current=assetsByUrl.get(asset.url)
      if(current && current.hash!==asset.hash)throw new Error('远程资源版本已变化，请重新解析依赖')
      let nextBytes
      const update = function (current) {
        const next = current && typeof current === 'object' ? Object.assign({}, current) : {}
        next.version = 2
        next.pins = next.pins && typeof next.pins === 'object' ? Object.assign({}, next.pins) : {}
        next.assets = next.assets && typeof next.assets === 'object' ? Object.assign({}, next.assets) : {}
        next.assets[asset.url] = {
          hash: asset.hash,
          path: asset.path,
          mediaType: asset.mediaType,
          content: asset.content,
          cachedAt: asset.cachedAt,
          lastUsed: asset.lastUsed
        }
        next.updatedAt = Date.now()
        nextBytes=assertMetadataBudget(next)
        return next
      }
      if(typeof updateJson==='function')await updateJson(storagePath,update)
      else update({pins:Object.fromEntries(memory),assets:Object.fromEntries(assetsByUrl)})
      identityBytes=nextBytes
      assetsByUrl.set(asset.url,asset)
      assetsByHash.set(asset.hash,asset)
    })
    await mutationTail
  }

  budget.register('pinned-identities',{async entries(){await load();return [{key:storagePath,bytes:identityBytes,lastUsed:0,retain:true}]}})
  budget.register('pinned-assets',{
    async entries(){await load();return [...assetsByHash.values()].filter(a=>typeof a.content==='string').map(a=>({key:a.hash,bytes:Buffer.byteLength(JSON.stringify(a.content))+64,lastUsed:a.lastUsed||a.cachedAt||0,asset:a}))},
    async remove(row){
      const asset=assetsByHash.get(row.key)
      if(asset!==row.asset)return false
      const metadata={...asset};delete metadata.content
      if(assetsByUrl.get(asset.url)?.hash===asset.hash)await persistAsset(metadata)
      else {await updateJson(storagePath,current=>{const versions={...current?.versions};delete versions[asset.hash];return {...current,versions}});assetsByHash.delete(asset.hash)}
      return true
    }
  })
  function cacheFixed(reference) { return shared("asset:" + reference.url, () => cacheFixedOnce(reference)) }

  async function cacheFixedOnce(reference) {
    await load()
    const previous=assetsByUrl.get(reference.url)
    if (typeof previous?.content==='string') { previous.lastUsed=now();report({ stage: 'resources', cacheHitCount: 1 }); return previous }
    if (typeof request !== 'function') throw new Error('当前运行环境不能缓存远程入口内容')
    let fetched
    try { fetched = await fetchBody(reference.url, { Accept: 'text/javascript, text/html, text/plain;q=0.9', 'User-Agent': 'dsh-tavern' }, 'text') } catch (error) { throw new Error('固定入口内容缓存不可用（' + str(error.message || error) + '）') }
    const { response, body: content } = fetched
    if (Buffer.byteLength(content, 'utf8') > MAX_ENTRY_BYTES) throw new Error('固定入口内容超过 5 MiB 上限')
    const mediaType = str(response.headers && response.headers.get && response.headers.get('content-type')).split(';')[0].trim() || (reference.path.endsWith('.html') ? 'text/html' : 'text/javascript')
    if (!/^(text\/|application\/(javascript|json)$)/i.test(mediaType)) throw new Error('固定入口返回了不支持的内容类型: ' + mediaType)
    if(previous && contentHash(content)!==previous.hash)throw new Error('重新下载的远程资源内容摘要不匹配')
    const asset = { url: reference.url, hash: contentHash(content), path: reference.path, mediaType, content, cachedAt: now(), lastUsed: now() }
    await persistAsset(asset)
    await budget.trim()
    return asset
  }

  function resolvePin(reference) { return shared("pin:" + reference.owner + "/" + reference.repo + "@" + reference.ref, () => resolvePinOnce(reference)) }

  async function resolvePinOnce(reference) {
    await load()
    const key = reference.owner + '/' + reference.repo + '@' + reference.ref
    if (memory.has(key)) { report({ stage: 'resources', cacheHitCount: 1 }); return memory.get(key) }
    if (typeof request !== 'function') throw new Error('当前运行环境不能解析远程脚本提交')
    let commit = ''
    let apiError = ''
    try {
      const endpoint = 'https://api.github.com/repos/' + encodeURIComponent(reference.owner) + '/' + encodeURIComponent(reference.repo) + '/commits/' + encodeURIComponent(reference.ref)
      const { body } = await fetchBody(endpoint, { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-tavern' }, 'json')
      commit = str(body && body.sha)
    } catch (error) {
      apiError = str(error && error.message || error)
    }
    if (!FIXED_COMMIT.test(commit)) {
      try {
        commit = await timed(signal => gitResolver(reference, { signal, timeoutMs: Math.min(timeoutMs, 5000) }), Math.min(timeoutMs, 5000))
      } catch (error) {
        throw new Error('GitHub API 解析失败（' + (apiError || '无效提交号') + '）；Git 后备解析失败（' + str(error && error.message || error) + '）')
      }
    }
    if (!FIXED_COMMIT.test(commit)) throw new Error('GitHub 返回了无效提交号')
    const value = { owner: reference.owner, repo: reference.repo, ref: reference.ref, commit, resolvedAt: Date.now() }
    const published = await persist(key, value)
    await budget.trim()
    return published
  }

  async function pinText(text) {
    const source = str(text)
    const originalReferences = inspectMutableJsDelivrUrls(source).filter(isTextEntry)
    if (originalReferences.length === 0 && inspectFixedJsDelivrUrls(source).filter(isTextEntry).length===0) return { text: source, pins: [], diagnostics: [] }
    await load()
    let result = source
    const blocked=new Set(),diagnostics=[]
    // A content-pinned fallback remains authoritative even if the tag later changes.
    for (const reference of originalReferences.sort((a,b)=>b.url.length-a.url.length)) {
      let asset = assetsByUrl.get(reference.url)
      if(asset&&typeof asset.content!=='string')try{asset=await cacheFixed(reference)}catch(error){blocked.add(reference.url);diagnostics.push({status:'unresolved-remote-asset',url:reference.url,message:String(error.message||error)})}
      if (typeof asset?.content==='string') { asset.lastUsed=now();report({ stage: 'resources', cacheHitCount: 1 }); result = result.split(reference.url).join(cachedPath(asset)) }
    }
    const references = inspectMutableJsDelivrUrls(result).filter(entry=>isTextEntry(entry)&&!blocked.has(entry.url))
    const pins = []
    const unique = new Map(references.map(function (item) { return [item.owner + '/' + item.repo + '@' + item.ref, item] }))
    for (const reference of unique.values()) {
      try {
        const pin = await resolvePin(reference)
        for (const entry of references.filter(item => item.owner === reference.owner && item.repo === reference.repo && item.ref === reference.ref).sort((a,b)=>b.url.length-a.url.length)) {
          const mutable = entry.owner + '/' + entry.repo + (entry.explicitRef ? '@' + entry.ref : '')
          const fixed = entry.owner + '/' + entry.repo + '@' + pin.commit
          result = result.split(entry.url).join(entry.url.replace(mutable, fixed))
        }
        pins.push(clone(pin))
      } catch (error) {
        // CDN tags can remain available after the Git tag disappears. Freeze
        // the actual bytes locally instead of disabling the entire display rule.
        for (const entry of references.filter(item => item.owner === reference.owner && item.repo === reference.repo && item.ref === reference.ref).sort((a,b)=>b.url.length-a.url.length)) {
          try {
            const asset = await cacheFixed(entry)
            result = result.split(entry.url).join(cachedPath(asset))
          } catch (cacheError) {
            diagnostics.push({ status: 'unresolved-remote-asset', url: entry.url,
              message: str(error && error.message || error) + '；内容快照失败（' + str(cacheError && cacheError.message || cacheError) + '）' })
          }
        }
      }
    }
    const fixedReferences = new Map(inspectFixedJsDelivrUrls(result).filter(isTextEntry).map(function (item) { return [item.url, item] }))
    const contents = await Promise.all(Array.from(fixedReferences.values(), async reference => {
      try { return { reference, asset: await cacheFixed(reference) } }
      catch (error) { return { reference, error } }
    }))
    for (const { reference, asset, error } of contents.sort((a,b)=>b.reference.url.length-a.reference.url.length)) {
      if (error) diagnostics.push({ status: 'uncached-remote-asset', url: reference.url, message: str(error.message || error) })
      else result = result.split(reference.url).join(cachedPath(asset))
    }
    return { text: result, pins, diagnostics }
  }

  async function pinExtensions(extensions) {
    const started = performance.now()
    const helperScripts = []
    const regexScripts = []
    const diagnostics = []
    const pins = []
    const jobs = [
      ...(extensions?.helperScripts || []).map(script => ({ script, kind: 'helper', field: 'content' })),
      ...(extensions?.regexScripts || []).map(script => ({ script, kind: 'regex', field: 'replaceString' }))
    ]
    const results = await Promise.all(jobs.map(async job => {
      const mvuDeclaration = job.kind === 'helper' ? inspectCardMvuDeclaration(job.script) : null
      if (job.script.enabled === false || (job.kind === 'helper' && isHostOwnedMvu(job.script) && !mvuDeclaration?.explicit)) return { ...job, resolved: null }
      return { ...job, mvuDeclaration, resolved: await pinText(job.script[job.field]) }
    }))
    for (const { script, kind, field, resolved, mvuDeclaration } of results) {
      const target = kind === 'helper' ? helperScripts : regexScripts
      if (!resolved) { target.push(clone(script)); continue }
      target.push({ ...script, [field]: mvuDeclaration?.explicit && resolved.diagnostics.length ? script[field] : resolved.text, ...(mvuDeclaration?.explicit ? { mvuRuntimeDeclaration: { ...mvuDeclaration, ...(resolved.diagnostics.length ? { loadError: resolved.diagnostics.map(row => row.message).join('; ') } : {}) } } : {}), enabled: resolved.diagnostics.length === 0 || mvuDeclaration?.explicit ? script.enabled : false })
      diagnostics.push(...resolved.diagnostics.map(item => ({ asset: kind, name: str(script.name), ...item })))
      pins.push(...resolved.pins)
    }
    const uniquePins = Array.from(new Map(pins.map(function (pin) { return [pin.owner + '/' + pin.repo + '@' + pin.ref, pin] })).values())
    report({ stage: 'resources', durationMs: performance.now() - started, helperCount: helperScripts.length, regexCount: regexScripts.length, skippedCount: jobs.filter(job => job.script.enabled === false).length, failedCount: diagnostics.length })
    const result = { helperScripts, regexScripts, diagnostics, pins: uniquePins }
    // Observe all resources above on every call. Only the completed projection
    // is shared, so eviction, deletion, failed loads and recovery remain visible.
    const match = extensionResults.findIndex(row => isDeepStrictEqual(row.value, result))
    if (match !== -1) {
      const [row] = extensionResults.splice(match, 1); extensionResults.unshift(row)
      return mutableJsonDraft(row.value)
    }
    const value = immutableJsonSnapshot(result), bytes = jsonBytes(value)
    if (bytes <= 64 * 1024 * 1024) {
      while (extensionResults.length && (extensionResults.length >= 4 || extensionResultBytes + bytes > 64 * 1024 * 1024)) extensionResultBytes -= extensionResults.pop().bytes
      extensionResults.unshift({value,bytes}); extensionResultBytes += bytes
    }
    return mutableJsonDraft(value)
  }


  // Build a candidate without changing live pins. A cancelled/failed refresh must
  // not evict the last working version, including content used by active frames.
  async function refreshExtensions(extensions, control = {}) {
    await load()
    const check = () => { if(control.signal?.aborted)throw new Error('远程依赖解析已取消') }
    check()
    const initialPins=Object.fromEntries(memory),initialAssets=Object.fromEntries(assetsByUrl)
    let candidate={version:2,pins:{},assets:Object.fromEntries([...assetsByUrl].filter(([url])=>inspectFixedJsDelivrUrls(url).length))}
    const progress=row=>control.onProgress?.(row)
    progress({stage:'resolving'})
    const staged=createTavernRemoteAssetPinStore({...options,signal:control.signal,budget:createRemoteCacheBudget(),
      readJson:async()=>candidate,updateJson:async(_path,fn)=>{check();candidate=fn(candidate)},
      onDiagnostic:row=>{report(row);progress({...row,stage:row.failedCount?'verifying':'downloading'})}})
    const result=await staged.pinExtensions(extensions)
    check()
    if(result.diagnostics.length)return {...result,status:'failed'}
    progress({stage:'verifying'})
    await control.beforeCommit?.()
    check()
    mutationTail=mutationTail.catch(()=>{}).then(async()=>{
      check()
      for(const key of Object.keys(candidate.pins))if(JSON.stringify(memory.get(key))!==JSON.stringify(initialPins[key]))throw new Error('远程依赖已被其他操作更新，请重试')
      const changedAssets=Object.fromEntries(Object.entries(candidate.assets).filter(([url,asset])=>initialAssets[url]?.hash!==asset.hash))
      for(const url of Object.keys(changedAssets))if(assetsByUrl.get(url)?.hash!==initialAssets[url]?.hash)throw new Error('远程入口已被其他操作更新，请重试')
      progress({stage:'publishing'})
      let nextBytes
      const update=current=>{check();const next={...current,version:2,pins:{...current?.pins,...candidate.pins},assets:{...current?.assets,...candidate.assets},updatedAt:now()};nextBytes=assertMetadataBudget(next);return next}
      if(typeof updateJson==='function')await updateJson(storagePath,update)
      else update({pins:Object.fromEntries(memory),assets:Object.fromEntries(assetsByUrl)})
      // Publishing is the commit point. Cancellation after the durable update
      // cannot leave memory on an older version than the saved record.
      identityBytes=nextBytes
      for(const [key,value] of Object.entries(candidate.pins))memory.set(key,clone(value))
      for(const [url,value] of Object.entries(candidate.assets)){const asset={...clone(value),url};assetsByUrl.set(url,asset);assetsByHash.set(asset.hash,asset)}
      failures.clear()
    })
    await mutationTail
    progress({stage:'completed'})
    return {...result,status:'completed'}
  }

  // Merge a verified personal archive into the live service, preserving current URL pins.
  async function importArchive(saved) {
    await load()
    for(const [url,row]of Object.entries(saved?.assets||{})) {
      if(!/^https?:$/.test(new URL(url).protocol)||!CONTENT_HASH.test(row?.hash||'')||typeof row.content==='string'&&(contentHash(row.content)!==row.hash||Buffer.byteLength(row.content)>MAX_ENTRY_BYTES))throw Error('整局包远程入口校验失败')
    }
    for(const [hash,row]of Object.entries(saved?.versions||{}))if(row?.hash!==hash||!CONTENT_HASH.test(hash)||typeof row.content!=='string'||contentHash(row.content)!==hash||Buffer.byteLength(row.content)>MAX_ENTRY_BYTES)throw Error('整局包远程历史入口校验失败')
    for(const row of Object.values(saved?.pins||{}))if(!FIXED_COMMIT.test(row?.commit||''))throw Error('整局包远程版本无效')
    mutationTail=mutationTail.catch(()=>{}).then(async()=>{
      let committed,nextBytes
      const update=current=>{
        const next={...current,version:2,pins:{...saved.pins,...current?.pins},assets:{...saved.assets,...current?.assets},versions:{...saved.versions,...current?.versions}}
        for(const [url,row]of Object.entries(saved.assets||{}))if(current?.assets?.[url]&&current.assets[url].hash!==row.hash)next.versions[row.hash]={...row,url}
        nextBytes=assertMetadataBudget(next);committed=next;return next
      }
      if(typeof updateJson==='function')await updateJson(storagePath,update);else update({pins:Object.fromEntries(memory),assets:Object.fromEntries(assetsByUrl)})
      identityBytes=nextBytes
      for(const [key,row]of Object.entries(committed.pins||{}))memory.set(key,clone(row))
      for(const [url,row]of Object.entries(committed.assets||{})){const asset={...clone(row),url};assetsByUrl.set(url,asset);assetsByHash.set(asset.hash,asset)}
      for(const [hash,row]of Object.entries(committed.versions||{}))assetsByHash.set(hash,clone(row))
      failures.clear()
    });await mutationTail
  }

  async function readCached(hash) {
    await load()
    const asset = assetsByHash.get(str(hash).toLowerCase())
    if(!asset)return null
    if(typeof asset.content!=='string')return clone(await cacheFixed(asset))
    asset.lastUsed=now()
    return clone(asset)
  }

  return Object.freeze({ pinText, pinExtensions, refreshExtensions, importArchive, readCached, trim: options=>budget.trim(options), inspect: function () { return Array.from(memory.values()).map(clone) } })
}
import { createHash } from 'node:crypto'
