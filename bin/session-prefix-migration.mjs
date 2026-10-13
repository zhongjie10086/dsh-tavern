import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { createDurableFilePromotion, renameWithRetry } from '../tavern-plugin/lib/durable-file-promotion.js'

// Validate the same concatenated standard-frame container used by DSH JSONL.
// Node's sync decoder can return partial output without reporting a torn frame.
function completeFrameEnd(bytes, start) {
  let offset = start
  const advance = count => {
    if (offset + count > bytes.length) throw new Error('Zstandard 历史压缩帧末尾不完整')
    const previous = offset; offset += count; return previous
  }
  if (bytes.readUInt32LE(advance(4)) !== 0xfd2fb528) throw new Error('Zstandard 历史压缩帧标记无效')
  const descriptor = bytes[advance(1)]
  if (descriptor & 0x18) throw new Error('Zstandard 历史帧保留位无效')
  const sizeFlag = descriptor >>> 6, single = Boolean(descriptor & 0x20), dictionary = descriptor & 3
  advance((single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (sizeFlag === 0 ? Number(single) : 1 << sizeFlag))
  for (;;) {
    const block = bytes.readUIntLE(advance(3), 3), type = (block >>> 1) & 3
    if (type === 3) throw new Error('Zstandard 历史压缩块类型无效')
    advance(type === 1 ? 1 : block >>> 3)
    if (block & 1) break
  }
  if (descriptor & 4) advance(4)
  return offset
}

// Node's decoder stops at the first frame. DSH stores the header in its own
// frame, followed by multiple append frames: every frame must survive repair.
export function decodeZstdFrames(bytes) {
  const decoded = []
  let offset = 0
  while (offset < bytes.length) {
    let result, end
    try {
      end = completeFrameEnd(bytes, offset)
      result = zstdDecompressSync(bytes.subarray(offset, end), { info: true })
      if (result.engine.bytesWritten !== end - offset) throw new Error('Zstandard 历史压缩帧未被完整读取')
    } catch (error) {
      error.decodedPrefix = Buffer.concat(decoded)
      throw error
    }
    const consumed = result.engine.bytesWritten
    if (!Number.isSafeInteger(consumed) || consumed <= 0) throw new Error('无法读取完整 Zstandard 历史')
    decoded.push(result.buffer)
    offset = end
  }
  return Buffer.concat(decoded)
}

function marked(text) { return text.includes('dsh-tavern/stable-prefix') || text.includes('tavern-session-prefix:') }

function repairPrefixText(text, file) {
      if (!text.endsWith('\n')) throw new Error('历史末尾不完整：' + file)
      const lines = text.slice(0, -1).split('\n')
      const header = JSON.parse(lines[0])
      if (header.type !== 'session' || typeof header.id !== 'string') throw new Error('历史头无效，未改写：' + file)
      const prefixId = 'tavern-session-prefix:' + header.id
      let count = 0
      let visiblePrefixSeen = false
      for (let index = 1; index < lines.length; index++) {
        const event = JSON.parse(lines[index])
        if (event.type === 'dsh-tavern/stable-prefix' && event.ignorable !== true) {
          if (event.data?.version !== 1 || event.data.id !== prefixId || typeof event.data.text !== 'string' || !event.data.text.trim() || event.surfaceOp !== undefined) throw new Error('固定背景事件格式无效，未改写：' + file)
          // Unknown to DSH, but retained verbatim for Tavern to recover its prefix.
          lines[index] = JSON.stringify({ ...event, ignorable: true })
          count++
          continue
        }
        if (event.type !== 'user/message' || event.data?.id !== prefixId) continue
        if (event.surfaceOp !== 'append' || event.data.role !== 'user' || event.data.source?.kind !== 'plugin' || event.data.source.plugin !== 'dsh-tavern' || event.data.source.form !== 'snapshot' || !Array.isArray(event.data.content)) throw new Error('固定背景消息格式无效，未改写：' + file)
        if (!visiblePrefixSeen) {
          visiblePrefixSeen = true
          continue
        }
        // Older runtimes appended this deterministic message ID twice. DSH's
        // event sequence remains intact, while its chat surface sees one ID.
        lines[index] = JSON.stringify({
          type: 'dsh-tavern/duplicate-stable-prefix',
          seq: event.seq,
          time: event.time,
          ignorable: true,
          data: { version: 1, id: prefixId, originalType: event.type },
        })
        count++
      }
      return { head: lines[0] + '\n', body: lines.slice(1).join('\n') + '\n', count }
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fingerprint = info => ({ size: Number(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) })
const sameFile = (row, info) => row && ['size', 'mtimeNs', 'ctimeNs'].every(key => row[key] === info[key])

function safeTarget(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0') || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('迁移记录包含非法相对路径')
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) throw new Error('迁移记录路径越界')
  return target
}

async function rejectLinks(root, target) {
  const parts = path.relative(root, target).split(path.sep)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('迁移路径包含链接，拒绝移动：' + current) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
  }
}

async function optionalRead(file) { try { return await readFile(file) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } }

/** Offline-only upgrade: call after checking the Tavern service is stopped. */
export async function migrateSessionPrefixEvents({ sessionsRoot, backupRoot, quarantineRoot = path.join(backupRoot, 'quarantine'), logger = console, force = false, dryRun = false, onError }) {
  sessionsRoot = path.resolve(sessionsRoot); backupRoot = path.resolve(backupRoot); quarantineRoot = path.resolve(quarantineRoot)
  if (quarantineRoot === sessionsRoot || quarantineRoot.startsWith(sessionsRoot + path.sep)) throw new Error('隔离目录必须位于会话目录之外')
  const changed = [], files = createDurableFilePromotion()
  const manifestPath = path.join(backupRoot, 'manifest.json')
  const scan = async () => {
    let manifest = { version: 1, entries: {} }, dirty = false
    const saved = await (dryRun ? optionalRead(manifestPath) : files.read(manifestPath))
    if (saved !== undefined) {
      manifest = JSON.parse(saved.toString('utf8'))
      if (manifest.version !== 1) throw new Error('不支持的会话迁移记录版本：' + manifest.version)
      if (!manifest.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) throw new Error('会话迁移记录损坏')
    }
    const warn = (file, error) => { onError?.({file,error:String(error?.message || error)}); try { logger?.warn?.('会话迁移/隔离未完成，保留恢复记录：' + file, String(error?.message || error)) } catch {} }
    const record = (key, value) => { manifest.entries[key] = { ...value, at: new Date().toISOString() }; dirty = true }
    const save = async () => {
      if (!dirty || dryRun) return
      await files.write(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      dirty = false
    }
    async function backupOriginal(file, key, original) {
      const relative = key + '.' + digest(original) + '.bak'
      const backup = safeTarget(backupRoot, relative)
      await rejectLinks(backupRoot, backup)
      const previous = await files.read(backup)
      if (previous === undefined) await files.write(backup, original)
      if (!(await readFile(backup)).equals(original) || !(await readFile(file)).equals(original)) throw new Error('历史或备份在修复期间发生变化，拒绝覆盖：' + file)
      return relative
    }
    async function finishQuarantine(key, row) {
      if (!['file', 'directory'].includes(row.kind)) throw new Error('未知的隔离记录类型')
      const sourceFile = safeTarget(sessionsRoot, key)
      const source = row.kind === 'file' ? sourceFile : path.dirname(sourceFile)
      if (source === sessionsRoot) throw new Error('拒绝隔离整个会话根目录')
      const target = safeTarget(quarantineRoot, row.quarantine)
      const targetFile = row.kind === 'file' ? target : path.join(target, path.basename(sourceFile))
      const backup = safeTarget(backupRoot, row.backup)
      await rejectLinks(sessionsRoot, sourceFile); await rejectLinks(quarantineRoot, targetFile); await rejectLinks(backupRoot, backup)
      const backupBytes = await readFile(backup)
      if (digest(backupBytes) !== row.sha256) throw new Error('隔离备份校验失败，未移动原件')
      const original = await optionalRead(sourceFile), isolated = await optionalRead(targetFile)
      if (original !== undefined) {
        if (digest(original) !== row.sha256) throw new Error('待隔离会话已改变，未移动原件')
        try { await stat(target); throw new Error('隔离目标已存在，拒绝覆盖') } catch (error) { if (error.code !== 'ENOENT') throw error }
        await mkdir(path.dirname(target), { recursive: true })
        await renameWithRetry(source, target)
      } else if (isolated === undefined || digest(isolated) !== row.sha256) {
        throw new Error('无法验证隔离结果，保留备份供修复')
      }
      if (digest(await readFile(targetFile)) !== row.sha256) throw new Error('隔离后校验失败')
      record(key, { ...row, status: 'quarantined' }); await save()
      try { logger?.warn?.('已隔离损坏会话，其他会话继续处理：' + sourceFile, '恢复位置：' + target) } catch {}
    }
    for (const [key, row] of Object.entries(manifest.entries)) if (row.status === 'prepared-quarantine') {
      if (dryRun) { changed.push({file:safeTarget(sessionsRoot,key),action:'quarantine',status:'prepared'}); continue }
      try { await finishQuarantine(key, row) } catch (error) { warn(key, error) }
    }
    async function processFile(file) {
      const key = path.relative(sessionsRoot, file).split(path.sep).join('/')
      const info = fingerprint(await stat(file, { bigint: true })), previous = manifest.entries[key]
      if (previous?.status === 'prepared-quarantine') return
      if (!force && ['unchanged', 'repaired'].includes(previous?.status) && sameFile(previous, info)) return
      const original = await readFile(file)
      const compressed = file.endsWith('.zstd')
      let text, repaired, corruption
      try {
        text = (compressed ? decodeZstdFrames(original) : original).toString('utf8')
        if (marked(text)) repaired = repairPrefixText(text, file)
      } catch (error) {
        if (!marked(text ?? error.decodedPrefix?.toString('utf8') ?? '')) { warn(file, error); return }
        corruption = error
      }
      if (corruption) {
        if (dryRun) { changed.push({file,action:'quarantine',reason:String(corruption.message)}); return }
        const backup = await backupOriginal(file, key, original)
        const kind = path.dirname(file) === sessionsRoot ? 'file' : 'directory'
        const relativeSource = kind === 'file' ? key : path.posix.dirname(key)
        const quarantine = relativeSource + '.' + digest(original)
        const row = { ...info, sha256: digest(original), status: 'prepared-quarantine', kind, backup, quarantine, reason: String(corruption.message) }
        record(key, row); await save()
        await finishQuarantine(key, row)
        return
      }
      if (!repaired?.count) {
        record(key, { ...(previous?.sha256 === digest(original) ? previous : {}), ...info, sha256: digest(original), status: previous?.status === 'repaired' && previous.sha256 === digest(original) ? 'repaired' : 'unchanged' })
        return
      }
      const { head, body, count } = repaired
      if (dryRun) { changed.push({file,action:'prefix-migration',events:count}); return }
      const output = compressed ? Buffer.concat([zstdCompressSync(head), zstdCompressSync(body)]) : Buffer.from(head + body)
      if (compressed && decodeZstdFrames(output).toString('utf8') !== head + body) throw new Error('历史压缩校验失败：' + file)
      const backup = await backupOriginal(file, key, original)
      await files.write(file, output)
      if (!(await readFile(file)).equals(output)) throw new Error('历史发布暂缓，保留备份和待恢复文件：' + file)
      record(key, { ...fingerprint(await stat(file, { bigint: true })), sha256: digest(output), status: 'repaired', backup })
      changed.push({ file, backup: safeTarget(backupRoot, backup), events: count })
    }
    async function visit(directory) {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) { try { await visit(file) } catch (error) { warn(file, error) }; continue }
        if (!entry.isFile() || !['session.jsonl', 'session.jsonl.zstd'].includes(entry.name)) continue
        try { await processFile(file) } catch (error) { if (error.code !== 'ENOENT') warn(file, error) }
      }
    }
    await visit(sessionsRoot); await save()
    return changed
  }
  return dryRun ? scan() : files.withLock(manifestPath + '.migration', scan, { waitMs: 5000 })
}
