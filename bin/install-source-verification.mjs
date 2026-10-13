import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const commitPattern = /^[0-9a-f]{40}$/i
function json(file) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : null }
function metadata(root) {
  const value = json(path.join(root, 'dsh-tavern-runtime.json'))
  if (!value || !commitPattern.test(value.revision) || !Number.isSafeInteger(value.releaseSequence) || !value.files?.length) return null
  for (const file of value.files) {
    const relative = path.relative(root, path.resolve(root, file.path))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
    try { if (createHash('sha256').update(readFileSync(path.join(root, file.path))).digest('hex') !== file.sha256) return null }
    catch { return null }
  }
  return value
}
function versionOrder(left, right) {
  const parse = value => String(value).split('-')[0].split('.').map(Number)
  const a = parse(left), b = parse(right)
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(n => !Number.isSafeInteger(n) || n < 0)) throw Error('无法验证安装版本号')
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i])
  return 0
}

export function verifyInstallSource({ appDir, sourceDir, targetCommit, requestedCommit = '', sourceCache = '' }) {
  if (!commitPattern.test(targetCommit)) throw Error('下载结果缺少可验证提交号，未覆盖现有安装')
  if (requestedCommit && targetCommit.toLowerCase() !== requestedCommit.toLowerCase()) throw Error('备用下载源提交与已确认目标不同，拒绝安装缓存的旧版本')
  const candidate = json(path.join(sourceDir, 'package.json'))
  if (!candidate) throw Error('下载内容不完整')
  const current = json(path.join(appDir, 'package.json'))
  if (!current) return
  const order = versionOrder(candidate.version, current.version)
  if (order < 0) throw Error('下载版本低于当前安装，拒绝降级')
  const oldMetadata = metadata(appDir), nextMetadata = metadata(sourceDir)
  if (oldMetadata && nextMetadata) {
    if (nextMetadata.releaseSequence < oldMetadata.releaseSequence || (nextMetadata.releaseSequence === oldMetadata.releaseSequence && nextMetadata.revision !== oldMetadata.revision)) throw Error('备用源发布序号较旧或冲突，拒绝覆盖')
    return
  }
  const release = json(path.join(appDir, '.dsh-tavern-release.json'))
  let currentCommit = oldMetadata?.revision || release?.commit || ''
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (!currentCommit && existsSync(path.join(appDir, '.git'))) {
    try { currentCommit = git('-C', appDir, 'rev-parse', 'HEAD') } catch {}
  }
  if (currentCommit === targetCommit) return
  // A requested commit was checked before launching the updater. Every fallback must match it.
  if (requestedCommit === targetCommit) return
  if (order > 0) return
  if (commitPattern.test(currentCommit)) {
    for (const args of [['-C', appDir], ...(sourceCache ? [['--git-dir=' + sourceCache]] : [])]) {
      try { git(...args, 'merge-base', '--is-ancestor', currentCommit, targetCommit); return } catch {}
    }
  }
  throw Error('无法确认下载内容比当前构建更新；请先在酒馆检查更新后重试，现有安装未覆盖')
}
