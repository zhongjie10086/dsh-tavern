import {GAME_PACKAGE_MAX_BYTES} from './game-package-transfer.js'
const MiB = 1024 * 1024
const PREFIX = '/api/dsh-tavern/'
const SCENE = /^(?:scene-image|getSceneImageSettings|saveSceneImageSettings|testSceneImageConnection|listSceneImageModels|sceneImageStatus|recordSceneImageInteraction|generateSceneImage|retrySceneImageSave|cancelSceneImage|removeSceneImage|setSceneImageReference)$/
const RULES = [
  { matches: method => method === 'game-package-files', limit: GAME_PACKAGE_MAX_BYTES, message: '整局包超过 512 MiB 文件上限' },
  { matches: method => method.startsWith('gameplay.'), limit: 2 * MiB, message: '游戏 API 请求超过 2 MB' },
  { matches: method => method === 'saveSceneImageSettings', limit: 2 * MiB, message: '无法保存生图配置：工作流与配置数据超过当前 2 MB 请求大小限制。请精简工作流后重试；这不是图片尺寸或显存不足。' },
  { matches: method => SCENE.test(method), limit: 16384, message: '生图请求数据超过当前 16 KB 大小限制，请减少输入数据后重试；这不是图片尺寸或显存不足。' },
  { matches: method => /^(?:importCard|importWorldbook|importPreset|importConversation|parseTavernScriptImport|changeTavernScriptLibrary|applyTavernScriptLibrary|previewTavernExtension|importTavernExtension|changeTavernExtension)$/.test(method), limit: 32 * MiB, message: '导入或脚本库请求超过 32 MB' },
  { matches: () => true, limit: 8 * MiB, message: '请求数据超过 8 MB' }
]

function reject(status, message) { throw Object.assign(new Error(message), { status }) }
function ipName(value) { return String(value || '').replace(/^\[|\]$/g, '').replace(/^::ffff:/, '').toLowerCase() }

export function tavernResourceHeaders(mediaType) {
  return {
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    ...(/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(String(mediaType)) ? { 'Content-Disposition': 'attachment' } : {})
  }
}

/** One gate for the production HTTP route; never derive host trust from the Host header. */
export function createTavernRequestGate(options = {}) {
  function check(req) {
    const binding = options.address?.() || {}
    const port = Number(binding.port || req.socket?.localPort)
    const hosts = new Set(['localhost', '127.0.0.1', '::1'])
    for (const address of [binding.address, req.socket?.localAddress]) {
      const host = ipName(address)
      if (host && host !== '0.0.0.0' && host !== '::') hosts.add(host)
    }
    const protocol = req.socket?.encrypted ? 'https:' : 'http:'
    let authority
    try { authority = new URL(protocol + '//' + req.headers.host) } catch { reject(403, 'forbidden host') }
    if (typeof req.headers.host !== 'string' || authority.username || authority.password || authority.pathname !== '/' || authority.search || authority.hash || !hosts.has(ipName(authority.hostname)) || Number(authority.port || (protocol === 'https:' ? 443 : 80)) !== port) reject(403, 'forbidden host')
    let pathname
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname) } catch { reject(400, 'bad URL') }
    const method = pathname.slice(PREFIX.length)
    const remoteAsset = method === 'static-assets' || method.startsWith('remote-assets/')
    // Shipped immutable dependencies remain usable by card frames, including opaque origins.
    const publicAsset = req.method === 'GET' && /^(?:client-assets\/|vendor\/runtime-assets\/|vendor\/st-prompt-template\/|vendor\/magvarupdate\/bundle\.js$)/.test(method)
    const frameAsset = method.startsWith('frame-assets/') && options.frameResources?.accepts(req) === true
    const frameUnload=options.frameUnloads?.accepts(req)===true
    if(frameUnload){if(!/^text\/plain(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))reject(415,'Unsupported unload content type');if(Number(req.headers['content-length'])>0)reject(413,'Unload request must be empty');return {pathname,frameUnload:true,limit:0,message:'Unload request must be empty'};}
    const origin = req.headers.origin
    if (!publicAsset && !frameAsset && origin !== undefined && origin !== '' && origin !== authority.origin) reject(403, 'forbidden origin')
    if (remoteAsset && (req.headers['sec-fetch-mode'] === 'navigate' || ['document', 'iframe', 'frame', 'object', 'embed'].includes(req.headers['sec-fetch-dest']))) reject(403, 'resource navigation forbidden')
    if (!publicAsset && !frameAsset) {
      if (typeof options.requestRejection !== 'function') reject(503, 'host authentication unavailable')
      const status = options.requestRejection(req)
      if (status !== undefined) reject(status === 401 || status === 403 ? status : 503, status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'host authentication unavailable')
    }
    const original = RULES.find(rule => rule.matches(method))
    const configured=options.rpcBytes||32*MiB
    const rule=original.limit===32*MiB||/^(?:tavernScriptFiles|tavernHelperAudio|updateTavernHelperPrompts|generateTavernHelperRaw)$/.test(method)?{...original,limit:configured,message:'脚本或导入请求超过 '+(configured/MiB)+' MiB'}:original
    if (req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) reject(415, 'Content-Type must be application/json')
      if (Number(req.headers['content-length']) > rule.limit) reject(413, rule.message)
    }
    return { pathname, ...rule }
  }

  async function readBody(req, rule) {
    const chunks = []
    let size = 0
    // Leave the socket writable long enough to send the 413 response on streamed uploads.
    for await (const chunk of typeof req.iterator === 'function' ? req.iterator({ destroyOnReturn: false }) : req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > rule.limit) reject(413, rule.message)
      chunks.push(bytes)
    }
    return Buffer.concat(chunks, size).toString('utf8')
  }

  return Object.freeze({ check, readBody, assetHeaders:tavernResourceHeaders })
}
