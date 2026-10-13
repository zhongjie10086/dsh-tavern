import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const cache = new Map()
let ticksPerSecond
/** Birth identity supplements PID liveness. Lookup failure never proves death. */
export function processBirth(pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  const cached = cache.get(pid)
  if (cached && (pid === process.pid || Date.now() - cached.at < 1000)) return cached.value
  let value = null
  try {
    if (process.platform === 'win32') {
      const ticks = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
      if (/^\d+$/.test(ticks)) value = { id: 'win32:' + ticks, startedAt: Number(BigInt(ticks) / 10000n - 62135596800000n) }
    } else if (process.platform === 'linux') {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8'), start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]
      const boot = readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)?.[1]
      ticksPerSecond ||= Number(execFileSync('getconf', ['CLK_TCK'], { timeout: 1000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
      if (/^\d+$/.test(start) && boot && ticksPerSecond > 0) value = { id: 'linux:' + boot + ':' + start, startedAt: Number(boot) * 1000 + Number(start) / ticksPerSecond * 1000 }
    }
  } catch { /* An inaccessible process remains unknown, never dead by timeout. */ }
  cache.set(pid, { value, at: Date.now() })
  if (cache.size > 256) cache.delete(cache.keys().next().value)
  return value
}

export function processOwnerIsLive({ pid, birth, createdAt }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0) } catch (error) { return error.code !== 'ESRCH' }
  const current = processBirth(pid)
  if (current && birth?.id) return current.id === birth.id
  // Legacy records can also be disproved when their PID was born afterwards.
  if (current && Number(createdAt) > 0 && current.startedAt > Number(createdAt) + 2000) return false
  return true
}
