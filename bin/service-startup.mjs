import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

// Seconds at the environment boundary; use a monotonic deadline internally.
// A cold first start (fresh install or update) can take well over 30 seconds on
// Windows. The deadline only catches a hung service; an exited one fails at once.
// (upstream 10750ba1; its stopStartupChild cleanup is not taken, the local
// launcher keeps a timed-out service running as before)
export function startupTimeoutMs(host, value = process.env.DSH_TAVERN_START_TIMEOUT) {
  if (value === undefined || value === '') return 120000
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new Error('DSH_TAVERN_START_TIMEOUT 必须为 0 到 86400 之间的正数（秒）')
  return seconds * 1000
}

export async function waitForServiceStartup(options) {
  const now = options.now || (() => performance.now())
  const pause = options.sleep || sleep
  const started = now()
  const deadline = started + options.timeoutMs
  let slow = false
  while (now() < deadline) {
    if (!options.alive()) throw new Error('DSH Tavern 启动进程已退出')
    if (await options.ready()) return
    if (!slow && now() - started >= 15000) { slow = true; options.onSlow?.() }
    await pause(Math.min(200, Math.max(0, deadline - now())))
  }
  throw new Error(`DSH Tavern 启动超时（${options.timeoutMs / 1000} 秒）`)
}
