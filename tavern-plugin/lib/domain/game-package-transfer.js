import {randomBytes} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {mkdir, readdir, unlink, rename, stat} from 'node:fs/promises'
import path from 'node:path'
import {Readable, Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {gamePackageJsonChunks, readGamePackageJson} from './game-package-json.js'

export const GAME_PACKAGE_MAX_BYTES = 512 * 1024 ** 2
const prefix = '/api/dsh-tavern/game-package-files'
const tokenPattern = /^[a-f0-9]{48}$/
const error = (status, message) => Object.assign(Error(message), {status})

/** Authenticated host transport. Handles never grant access by themselves: the
 * production request gate runs first, including for downloads and deletion. */
export function createGamePackageTransfer({root, packages, maxBytes = GAME_PACKAGE_MAX_BYTES, now = Date.now, ttl = 3600000}) {
  const rows = new Map(), active = new Set()
  let disposed = false
  const ready = (async () => {
    await mkdir(root, {recursive:true})
    // A prior process's unpublished uploads/downloads are disposable. Import
    // journals and all game data live elsewhere and are never cleaned here.
    for (const entry of await readdir(root, {withFileTypes:true})) {
      if (entry.isFile() && /^[a-f0-9]{48}\.(?:part|json)$/.test(entry.name)) await unlink(path.join(root, entry.name))
    }
  })()
  ready.catch(() => {})
  const file = (id, suffix = 'json') => path.join(root, id + '.' + suffix)
  async function remove(id) {
    if (!tokenPattern.test(id || '')) throw error(404, '整局临时文件不存在')
    if (active.has(id)) throw error(409, '整局包正在处理，请稍后重试')
    rows.delete(id)
    for (const suffix of ['part', 'json']) await unlink(file(id, suffix)).catch(cause => {if (cause.code !== 'ENOENT') throw cause})
  }
  async function prune() {
    await ready
    for (const [id, row] of rows) if (!active.has(id) && now() - row.used > ttl) await remove(id)
  }
  function bounded() {
    let bytes = 0
    return new Transform({transform(chunk, encoding, done) {
      bytes += chunk.length
      done(bytes > maxBytes ? error(413, '整局包超过 ' + maxBytes / 1024 ** 2 + ' MiB 文件上限') : null, chunk)
    }})
  }
  async function save(chunks, kind, title = '') {
    await prune()
    if (disposed) throw error(503, '整局文件服务已关闭')
    const id = randomBytes(24).toString('hex')
    active.add(id)
    try {
      await pipeline(Readable.from(chunks), bounded(), createWriteStream(file(id, 'part'), {flags:'wx', mode:0o600}))
      await rename(file(id, 'part'), file(id))
      const bytes = (await stat(file(id))).size
      rows.set(id, {kind, title, bytes, used:now()})
      return {transferId:id, bytes, url:prefix + '/' + id}
    } catch (cause) {
      active.delete(id); await remove(id); throw cause
    } finally { active.delete(id) }
  }
  async function using(id, work, kind) {
    await ready
    if (!tokenPattern.test(id || '')) throw error(404, '整局临时文件不存在')
    const row = rows.get(id)
    if (!row || kind && row.kind !== kind || now() - row.used > ttl) throw error(410, '整局临时文件已清理，请重新选择原文件')
    if (active.has(id)) throw error(409, '整局包正在处理，请稍后重试')
    active.add(id); row.used = now()
    try { return await work(row) } finally { row.used = now(); active.delete(id) }
  }
  async function upload(req) {
    // Early 413 leaves the request socket writable for an actionable error.
    const chunks = typeof req.iterator === 'function' ? req.iterator({destroyOnReturn:false}) : req
    const saved = await save(chunks, 'upload')
    try {
      const preview = await using(saved.transferId, async () => packages.preview(await readGamePackageJson(createReadStream(file(saved.transferId)))))
      return {...saved, preview}
    } catch (cause) { await remove(saved.transferId); throw cause }
  }
  async function prepareExport(sessionId) {
    const document = await packages.export(sessionId)
    return save(gamePackageJsonChunks(document), 'download', document.manifest.title)
  }
  async function importFile({transferId, ...options}) {
    return using(transferId, async () => packages.import({...options, document:await readGamePackageJson(createReadStream(file(transferId)))}), 'upload')
  }
  async function handle(req, res, pathname) {
    if (pathname !== prefix && !pathname.startsWith(prefix + '/')) return false
    if (pathname === prefix && req.method === 'POST') {
      const saved = await upload(req)
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'})
      res.end(JSON.stringify({ok:true, ...saved})); return true
    }
    const id = pathname.slice(prefix.length + 1)
    if (req.method === 'DELETE') {
      await remove(id); res.writeHead(204, {'Cache-Control':'no-store'}); res.end(); return true
    }
    if (req.method !== 'GET') throw error(405, '整局文件请求方法不支持')
    await using(id, async row => {
      if (row.kind !== 'download') throw error(404, '整局下载不存在')
      const filename = '个人整局-' + String(row.title || '游戏').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0,100) + '.dsh-game.json'
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Content-Length':row.bytes,
        'Content-Disposition':"attachment; filename=game.dsh-game.json; filename*=UTF-8''" + encodeURIComponent(filename),
        'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"sandbox; default-src 'none'"})
      await pipeline(createReadStream(file(id)), res)
    })
    // Keep a failed download available for retry; completed downloads need no mirror.
    await remove(id)
    return true
  }
  const timer = setInterval(() => { void prune().catch(() => {}) }, Math.min(ttl, 60000)); timer.unref?.()
  async function dispose() {
    disposed = true; clearInterval(timer); await ready
    for (const id of rows.keys()) if (!active.has(id)) await remove(id)
  }
  return {upload, prepareExport, importFile, remove, prune, dispose, handle}
}
