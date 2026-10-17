import { createHash } from 'node:crypto'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'

const text = value => typeof value === 'string' ? value : ''
const hash = value => createHash('sha256').update(value).digest('hex')
// Cache only byte-derived facts. Names, IDs and authored declarations can change
// independently of content, and every public result remains caller-owned.
const sourceMemo = new Map(), sourceMemoLimit = 16 * 1024 * 1024
let sourceMemoBytes = 0
function inspectSource(source) {
  const previous = sourceMemo.get(source)
  if (previous) { sourceMemo.delete(source); sourceMemo.set(source, previous); return previous }
  const facts = { repository: /MagicalAstrogy\/MagVarUpdate/i.test(source), bundled: /(?:window|globalThis)\s*\.\s*Mvu\s*=/.test(source) }
  const bytes = Buffer.byteLength(source, 'utf8') + 256
  if (bytes <= sourceMemoLimit) {
    while (sourceMemo.size && (sourceMemo.size >= 128 || sourceMemoBytes + bytes > sourceMemoLimit)) {
      const oldest = sourceMemo.keys().next().value
      sourceMemoBytes -= sourceMemo.get(oldest).bytes; sourceMemo.delete(oldest)
    }
    facts.bytes = bytes; sourceMemo.set(source, facts); sourceMemoBytes += bytes
  }
  return facts
}

/** Inspect executable resource declarations only, never mutable script variables. */
export function inspectCardMvuDeclaration(script) {
  if (!script || script.type !== 'script') return null
  if (script.mvuRuntimeDeclaration && typeof script.mvuRuntimeDeclaration === 'object') return { ...script.mvuRuntimeDeclaration }
  const source = text(script.content)
  const facts = inspectSource(source)
  const named = /^mvu(?:$|\b|脚本|核心)/i.test(text(script.name).trim())
  const declared = text(script.mvuVersion) || text(script.mvu?.version)
  if (!facts.repository && !named && !declared && !facts.bundled) return null
  if (!facts.details) facts.details = {
    reference: source.match(/MagicalAstrogy\/MagVarUpdate@([^/\s'"`?#]+)/i)?.[1],
    remoteLoader: /\bimport\s*(?:\(|['"{*])|\brequire\s*\(/.test(source) && /https?:\/\//.test(source),
    nonempty: Boolean(source.trim())
  }
  const {reference, remoteLoader, nonempty} = facts.details
  // An unversioned remote loader requests the host default. A supplied bundle
  // is itself a version, identified by its bytes even without a release label.
  const explicit = Boolean(reference || declared || !remoteLoader && nonempty)
  const sourceSha256 = facts.sha256 ?? (facts.sha256 = hash(source))
  return { scriptId: text(script.id), explicit, requestedVersion: reference || declared || (explicit ? 'embedded-sha256:' + sourceSha256 : 'host-default'), sourceSha256 }
}

/** Pure read projection: opening a game never resolves latest or writes pins. */
export function selectMvuRuntime(helperScripts, { enabled = true } = {}) {
  if (!enabled) return null
  const candidates = (Array.isArray(helperScripts) ? helperScripts : []).filter(script => script?.enabled !== false).map(script => ({ script, declaration: inspectCardMvuDeclaration(script) })).filter(row => row.declaration?.explicit)
  if (candidates.length > 1) return { owner: 'card', status: 'incompatible', requestedVersion: candidates.map(row => row.declaration.requestedVersion).join(', '), actualVersion: null, scriptIds: candidates.map(row => row.declaration.scriptId), message: '人物卡声明多个 MVU 核心；保留原资源和剧情数据，请选择一个版本后重试。' }
  if (!candidates.length) return { owner: 'official', status: 'selected', requestedVersion: 'host-default', actualVersion: OFFICIAL_MVU_VERSION.commit, commit: OFFICIAL_MVU_VERSION.commit, assetUrl: OFFICIAL_MVU_VERSION.assetUrl }
  const { script, declaration } = candidates[0]
  if (declaration.loadError) return { owner: 'card', status: 'incompatible', scriptId: declaration.scriptId, requestedVersion: declaration.requestedVersion, actualVersion: null, message: '人物卡指定 MVU 依赖加载失败；保留原资源和剧情数据：' + declaration.loadError }
  const cachedHashes = [...text(script.content).matchAll(/\/api\/dsh-tavern\/remote-assets\/([a-f0-9]{64})\//g)].map(match => match[1])
  const cached = cachedHashes.length === 1 ? 'sha256:' + cachedHashes[0] : null
  const embedded = declaration.requestedVersion.startsWith('embedded-sha256:')
  return { owner: 'card', status: 'selected', scriptId: declaration.scriptId, requestedVersion: declaration.requestedVersion, actualVersion: cached || (embedded ? 'sha256:' + declaration.sourceSha256 : null), sourceSha256: declaration.sourceSha256, message: '使用人物卡指定的 MVU；加载或宿主 API 不兼容时保留原资源和剧情数据，不替换为宿主版本。' }
}
