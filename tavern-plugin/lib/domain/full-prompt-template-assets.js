import { readFile, stat as statFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const FULL_PROMPT_TEMPLATE_ASSET_PREFIX = '/api/dsh-tavern/vendor/st-prompt-template/'
const root = new URL('../vendor/st-prompt-template/host-build/artifact/', import.meta.url)
const commit = 'd6f520d149aba146305b0b781ddd691d449c28d2'

export function createFullPromptTemplateAssetReader({ directory = root, read = readFile,
  stat = read === readFile ? statFile : undefined, maxBytes = 32 * 1024 * 1024, maxEntries = 32 } = {}) {
  const entries = new Map()
  let bytes = 0, manifestEntry
  const version = async url => {
    const value = await stat(url, { bigint: true })
    return [value.dev, value.ino, value.ctimeNs ?? value.ctimeMs, value.mtimeNs ?? value.mtimeMs, value.size].join(':')
  }
  function forget(name) {
    const old = entries.get(name)
    if (old) { bytes -= old.body.length; entries.delete(name) }
  }
  function retain(name, entry) {
    forget(name)
    if (entry.body.length > maxBytes || maxEntries <= 0) return
    while (entries.size && (bytes + entry.body.length > maxBytes || entries.size >= maxEntries)) forget(entries.keys().next().value)
    entries.set(name, entry); bytes += entry.body.length
  }
  return async function readAsset(pathname) {
    if (!String(pathname).startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX)) return undefined
    const name = pathname.slice(FULL_PROMPT_TEMPLATE_ASSET_PREFIX.length)
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(name) || name.includes('..')) return undefined
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const manifestUrl = new URL('manifest.json', directory)
        const manifestVersion = stat ? await version(manifestUrl) : undefined
        // Read through on every request: metadata can lag a write to an old file.
        const manifestText = String(await read(manifestUrl, 'utf8'))
        const manifest = manifestEntry?.text === manifestText ? manifestEntry.value : JSON.parse(manifestText)
        if (manifest.upstreamCommit !== commit) throw new Error('模板运行时版本与宿主不一致')
        if (!Object.prototype.hasOwnProperty.call(manifest.files, name)) return undefined
        const mediaType = name.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.txt') ? 'text/plain; charset=utf-8' : undefined
        if (!mediaType) return undefined
        const url = new URL(name, directory), fileVersion = stat ? await version(url) : undefined
        const body = await read(url)
        if (stat && (await version(manifestUrl) !== manifestVersion || await version(url) !== fileVersion)) { forget(name); continue }
        // Only reuse work after observing exactly the already verified bytes.
        const old = entries.get(name), expected = manifest.files[name]
        if (old && old.body.equals(body) && old.sha === expected.sha256 && body.length === expected.bytes) {
          entries.delete(name); entries.set(name, old)
          if (Buffer.byteLength(manifestText) <= 1024 * 1024) manifestEntry = { text: manifestText, value: manifest }
          else manifestEntry = undefined
          return { body, mediaType, etag: old.etag }
        }
        forget(name)
        const sha = createHash('sha256').update(body).digest('hex')
        if (sha !== manifest.files[name].sha256 || body.length !== manifest.files[name].bytes) throw new Error('模板运行时资源校验失败')
        const etag = '"sha256-' + sha + '"'
        // Bound the retained raw manifest and asset bytes independently.
        manifestEntry = Buffer.byteLength(manifestText) <= 1024 * 1024 ? { text: manifestText, value: manifest } : undefined
        retain(name, { body: Buffer.from(body), sha, etag })
        return { body, mediaType, etag }
      }
      throw new Error('模板运行时资源正在连续修改，请稍后重试')
    } catch (error) {
      entries.clear(); bytes = 0; manifestEntry = undefined
      throw error
    }
  }
}
export const readFullPromptTemplateAsset = createFullPromptTemplateAssetReader()
