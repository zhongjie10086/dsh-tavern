import { createHash } from 'node:crypto'
import { createVersionedJsonCache } from './versioned-json-cache.js'
import { mutableJsonDraft } from './json-draft.js'
import { scriptChunkLayout } from './script-chunks.js'

/** Read actual text each time; persistent metadata alone cannot prove byte identity. */
export function createScriptLayoutCache({ version, readText, layout = scriptChunkLayout, maxBytes = 32 * 1024 * 1024, maxEntries = 16 }) {
  const cache = createVersionedJsonCache({ maxBytes, maxEntries })
  const stamp = info => info && typeof info === 'object' ? info.stamp : info
  return {
    async read(path) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = stamp(await version(path))
          const source = await readText(path)
          const after = stamp(await version(path))
          if (before !== after) { cache.invalidate(path); continue }
          if (source === undefined) { cache.invalidate(path); return undefined }
          // Content identity permits layout reuse even when ctime/mtime are coarse
          // or a dirty-window descriptor cannot authorize metadata-only reuse.
          const content = createHash('sha256').update(source, 'utf16le').digest('hex')
          const value = await cache.read(path, async () => content, async () => ({
            path, title: path.split('/').pop(), sourceChars: source.length, ...layout(source)
          }))
          return mutableJsonDraft(value)
        }
        throw Error('资源正在连续修改，请稍后重试')
      } catch (error) {
        cache.invalidate(path)
        throw error
      }
    },
    stats: cache.stats
  }
}
