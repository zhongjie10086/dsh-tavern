import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { resolveDshCliEntry } from './plugin-dependencies.mjs'
import path from 'node:path'
import { newServiceControl, requestServiceStop } from './service-control.mjs'
import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'
import { ensureSidebarDefaults } from './launcher-settings.mjs'
import { startupTimeoutMs, waitForServiceStartup } from './service-startup.mjs'
import { PROFILE_DIR, PID_FILE, SERVICE_FILE, PROFILE, SOURCE_ROOT, CLI_PORT, CLI_HOST, LOG_DIR, LOG_FILE, DSH_ROOT, FRONTEND_BOOTSTRAP_FILE, FRONTEND_BOOTSTRAP_VERSION, commandExists, runtimeEnvironment, RUNTIME_HOST, findDshCommand, resolveDshInvocation, sleep } from './launcher-environment.mjs'

// Own process identity, readiness, shutdown, and validated browser access.
const lifecycleLocks = createDurableFilePromotion()
const serviceFiles = createDurableFilePromotion({ mode: 0o600 })
export function serviceEnvironment(environment = runtimeEnvironment()) {
  const previous = String(environment.NODE_OPTIONS || '').replace(/(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)\d+/g, '').trim()
  let heapMiB=8192
  const config=path.join(environment.DSH_HOME||DSH_ROOT,'profile-data','tavern','data','capacity-settings.json')
  if(existsSync(config))try{const value=JSON.parse(readFileSync(config,'utf8'))?.process?.nodeHeapMiB;if(Number.isSafeInteger(value)&&value>0)heapMiB=value}catch(error){console.warn('dsh-tavern: 容量配置无法读取，使用默认堆上限',String(error.message||error))}
  return {...environment, NODE_OPTIONS:[previous, '--max-old-space-size='+heapMiB].filter(Boolean).join(' ')}
}
export function webUrlFromLogChunk(source) {
  const matches = [...String(source || '').matchAll(/^dsh web: (https?:\/\/\S+)$/gm)]
  return matches.length > 0 ? matches[matches.length - 1][1] : ''
}

export async function resolveServiceWebUrl({ port, record = {}, log = Buffer.alloc(0), request = fetch }) {
  const origin = `http://127.0.0.1:${port}`
  const bytes = Buffer.isBuffer(log) ? log : Buffer.from(log)
  // New PID records delimit this process's output; old installations use the latest URL.
  const offset = Number.isSafeInteger(record.logOffset) && record.logOffset >= 0 ? record.logOffset : 0
  const candidate = webUrlFromLogChunk(bytes.subarray(offset).toString('utf8'))
  const candidates = []
  try {
    const url = new URL(candidate)
    if (url.origin === origin && !url.username && !url.password) candidates.push(url.href)
  } catch {}
  candidates.push(`${origin}/`)
  for (const url of new Set(candidates)) {
    try {
      const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(1000) })
      await response.body?.cancel()
      if (response.status >= 200 && response.status < 400) return url
    } catch {}
  }
  return ''
}

export function restartBrowserTarget(port, runtimeGeneration, webUrl = `http://127.0.0.1:${port}/`) {
  const target = new URL(webUrl)
  target.searchParams.set('tavern-boot', String(runtimeGeneration))
  return target.toString()
}

export function browserOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/d', '/s', '/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

async function openBrowserTarget(url) {
  const target = browserOpenCommand(url)
  await new Promise((resolve, reject) => {
    const child = spawn(target.command, target.args, { detached: true, stdio: 'ignore', windowsHide: true })
    const timer = setTimeout(() => {
      child.unref()
      fail('等待系统响应超时，未能确认打开结果')
    }, 5000)
    const fail = detail => {
      clearTimeout(timer)
      reject(new Error(`无法自动打开浏览器（${detail}）。请复制上方完整地址，在浏览器中手动打开。`))
    }
    child.once('error', error => fail(error.code || '启动失败'))
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else fail(signal || `退出码 ${code}`)
    })
  })
}

export function needsFrontendBootstrap(record, requiredVersion = FRONTEND_BOOTSTRAP_VERSION) {
  return !record || Number(record.version) < requiredVersion
}

export async function bootstrapFrontendOnce(state) {
  if (!state?.webUrl) return false
  if (process.env.DSH_TAVERN_NO_OPEN === '1') return false
  let record = null
  try { record = JSON.parse(readFileSync(FRONTEND_BOOTSTRAP_FILE, 'utf8')) } catch {}
  if (!needsFrontendBootstrap(record)) return false
  const target = restartBrowserTarget(state.port, state.runtimeGeneration, state.webUrl)
  try {
    await openBrowserTarget(target)
  } catch (error) {
    console.warn(error.message)
    return false
  }
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(FRONTEND_BOOTSTRAP_FILE, `${JSON.stringify({ version: FRONTEND_BOOTSTRAP_VERSION, completedAt: new Date().toISOString() }, null, 2)}\n`)
  console.log(`已一次性打开新版前端：${target}`)
  return true
}

function verifyProfile() {
  if (!existsSync(path.join(PROFILE_DIR, 'package.json')) || !existsSync(path.join(PROFILE_DIR, 'cordis.patch.yml'))) {
    throw new Error(`DSH Tavern 尚未安装，请先在仓库目录运行：pnpm run install:tavern`)
  }
}

async function readPidRecord() {
  try {
    const bytes = await serviceFiles.read(PID_FILE)
    if (bytes === undefined) return null
    const record = JSON.parse(bytes.toString('utf8'))
    return Number.isInteger(record.pid) && record.pid > 0 ? record : null
  } catch {
    return null
  }
}

async function writePidRecord(pid, port, logOffset, control) {
  await serviceFiles.write(PID_FILE, `${JSON.stringify({ pid, port, logOffset, profile: PROFILE, source: SOURCE_ROOT, startedAt: new Date().toISOString(), ...(control ? { control } : {}) }, null, 2)}\n`)
}

async function removePidRecord(expectedPid) {
  if ((await readPidRecord())?.pid === expectedPid) await serviceFiles.remove(PID_FILE)
}

function validPort(value) { return Number.isSafeInteger(value) && value >= 1 && value <= 65535 }

async function savedServicePort() {
  const bytes = await serviceFiles.read(SERVICE_FILE)
  if (bytes === undefined) return null
  let record
  try { record = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('服务端口记录损坏：' + SERVICE_FILE) }
  if (record.version !== 1) throw new Error('不支持的服务端口记录版本：' + record.version)
  if (!validPort(record.port)) throw new Error('服务端口记录无效：' + SERVICE_FILE)
  return record.port
}

async function rememberServicePort(port) {
  await serviceFiles.write(SERVICE_FILE, JSON.stringify({ version: 1, port }) + '\n')
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function isPortOpen(port, host = '127.0.0.1', timeout = 300) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function isServiceReady(port, request = fetch, host = process.env.DSH_TAVERN_RUNTIME_HOST || 'cli') {
  try {
    const response = await request(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })
    return response.ok || response.status === 401 || (host === 'android' && response.status === 403)
  } catch {
    return false
  }
}

async function serviceState() {
  const record = await readPidRecord()
  let saved = await savedServicePort()
  if (saved === null && validPort(record?.port)) { saved = record.port; await rememberServicePort(saved) }
  const pidAlive = Boolean(record && isProcessAlive(record.pid))
  const port = pidAlive && validPort(record.port) ? record.port : String(process.env.DSH_TAVERN_PORT || '').trim() ? CLI_PORT : saved ?? CLI_PORT
  const occupiedPorts = []
  for (const known of new Set([port, saved, record?.port].filter(validPort))) if (await isPortOpen(known)) occupiedPorts.push(known)
  const portOpen = occupiedPorts.includes(port)
  const ready = portOpen && await isServiceReady(port)
  if (record && !pidAlive) await removePidRecord(record.pid)
  const legacyRecord = !pidAlive && portOpen ? findLegacyService(port) : null
  return { port, record: pidAlive ? record : legacyRecord, portOpen, ready, occupiedPorts }
}

function findLegacyService(port) {
  if (process.platform === 'win32' || !commandExists('lsof')) return null
  const listeners = spawnSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (listeners.status !== 0) return null
  const pids = listeners.stdout.split(/\s+/).map(Number).filter(Number.isInteger)
  for (const pid of pids) {
    const processInfo = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
    if (processInfo.status === 0 && processInfo.stdout.includes(`dsh --profile ${PROFILE}`)) {
      return { pid, port, profile: PROFILE, source: SOURCE_ROOT, legacy: true }
    }
  }
  return null
}

export async function statusService() {
  verifyProfile()
  const state = await serviceState()
  if (state.record && state.ready) {
    console.log(`DSH Tavern 正在运行：PID ${state.record.pid}`)
    printServiceWebUrl(await currentServiceWebUrl(state))
    return
  }
  if (state.portOpen) {
    if (state.record) throw new Error(`DSH Tavern 进程存在，但 Web 页面尚未就绪：PID ${state.record.pid}。请稍后重试。`)
    throw new Error(`端口 ${state.port} 已被未识别的进程占用，DSH Tavern 不会操作该进程。`)
  }
  if (state.record) {
    console.log(`DSH Tavern 正在启动：PID ${state.record.pid}（端口 ${state.port} 尚未监听）。`)
    return
  }
  throw new Error(`DSH Tavern 未运行（端口 ${state.port}）。`)
}

async function currentServiceWebUrl(state) {
  let log = Buffer.alloc(0)
  try { log = readFileSync(LOG_FILE) } catch {}
  return resolveServiceWebUrl({ port: state.port, record: state.record || {}, log })
}

function printServiceWebUrl(url) {
  if (!url) {
    console.log('尚未取得有效的 Web 访问链接。请稍后运行 dsh-tavern status；仍无法获取时，请运行 dsh-tavern restart。')
    return
  }
  console.log(`打开网页（请复制完整地址）：${url}`)
  console.log('带 token 的地址包含访问凭证，请勿分享。关掉页面后可运行 dsh-tavern open 重新打开。')
}

export async function openService() {
  verifyProfile()
  const state = await serviceState()
  if (!state.record || !state.ready) throw new Error('DSH Tavern 尚未就绪，请先运行 dsh-tavern start。')
  const url = await currentServiceWebUrl(state)
  printServiceWebUrl(url)
  if (!url) { process.exitCode = 1; return }
  await openBrowserTarget(url)
}

export async function stopService({ force = false } = {}) {
  verifyProfile()
  return lifecycleLocks.withLock(path.join(LOG_DIR, 'tavern.start'), () => stopServiceLocked(force), { waitMs: 35_000 })
}

async function stopServiceLocked(force) {
  const state = await serviceState()
  if (!state.record) {
    if (state.occupiedPorts.length) {
      throw new Error(`端口 ${state.occupiedPorts.join(', ')} 已被未识别的进程占用，拒绝停止。`)
    }
    console.log('DSH Tavern 已停止。')
    return
  }

  if (process.platform === 'win32') {
    if (!force) await requestServiceStop(state.record)
    else {
      const result = spawnSync('taskkill', ['/PID', String(state.record.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      if (result.status !== 0 && isProcessAlive(state.record.pid)) {
        throw new Error(`无法停止 DSH Tavern 进程：PID ${state.record.pid}。`)
      }
    }
  } else {
    try {
      process.kill(state.record.pid, force ? 'SIGKILL' : 'SIGTERM')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await isPortOpen(state.port)) && !isProcessAlive(state.record.pid)) {
      await rememberServicePort(state.port)
      await removePidRecord(state.record.pid)
      console.log('DSH Tavern 已停止。')
      return
    }
    await sleep(100)
  }
  throw new Error(`服务未能在 10 秒内停止；${force ? '已请求强制结束' : '没有强制结束进程'}，请手动检查 PID ${state.record.pid}。`)
}

export async function startService() {
  verifyProfile()
  return lifecycleLocks.withLock(path.join(LOG_DIR, 'tavern.start'), startServiceLocked, { waitMs: 35_000 })
}

async function startServiceLocked() {
  const state = await serviceState()
  if (state.record && state.ready) {
    console.log(`DSH Tavern 已经在运行：PID ${state.record.pid}。`)
    const webUrl = await currentServiceWebUrl(state)
    printServiceWebUrl(webUrl)
    return { ...state, webUrl, runtimeGeneration: state.record.pid }
  }
  if (state.record) {
    throw new Error(`已有 DSH Tavern 进程正在启动：PID ${state.record.pid}。`)
  }
  if (state.occupiedPorts.length) {
    throw new Error(`端口 ${state.occupiedPorts.join(', ')} 已被其他进程占用，拒绝启动。`)
  }

  await ensureSidebarDefaults()

  const runtimeHost = RUNTIME_HOST
  const dsh = findDshCommand(runtimeHost)
  const invocation = resolveDshInvocation(
    dsh,
    ['--profile', PROFILE, '--host', CLI_HOST, '--port', String(state.port), '--no-open'],
    runtimeHost,
  )
  const control = process.platform === 'win32' ? newServiceControl() : undefined
  if (control) {
    invocation.args = ['--import', new URL('./service-control.mjs', import.meta.url).href, resolveDshCliEntry({ dsh }), ...invocation.args]
    invocation.command = process.execPath
  }
  mkdirSync(LOG_DIR, { recursive: true })
  const logOffset = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0
  const logDescriptor = openSync(LOG_FILE, 'a')
  let child
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd: SOURCE_ROOT,
      // Track the actual Node service, not a cmd shim that can exit separately.
      detached: true,
      env: { ...serviceEnvironment(), ...(control ? { DSH_TAVERN_SERVICE_CONTROL: JSON.stringify(control) } : {}) },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
  } finally {
    closeSync(logDescriptor)
  }
  child.unref()
  await writePidRecord(child.pid, state.port, logOffset, control)

  const exited = () => child.exitCode !== null || child.signalCode !== null || !isProcessAlive(child.pid)
  async function startupFailed() {
    await removePidRecord(child.pid)
    const log = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-30).join('\n') : ''
    return new Error(`DSH Tavern 启动失败。${log ? `\n最近日志：\n${log}` : ''}`)
  }
  // A Windows cold start can exceed 30 s; an exited process still fails at once. (upstream 10750ba1)
  const timeoutMs = startupTimeoutMs(RUNTIME_HOST)
  try {
    await waitForServiceStartup({
      timeoutMs,
      alive: () => !exited(),
      onSlow: () => console.log(`DSH Tavern 仍在初始化（首次启动较慢），最多等待 ${timeoutMs / 1000} 秒……`),
      ready: async () => Boolean(webUrlFromLogChunk(readFileSync(LOG_FILE).subarray(logOffset).toString('utf8')))
        && await isPortOpen(state.port) && await isServiceReady(state.port)
    })
  } catch (error) {
    if (exited()) throw await startupFailed()
    throw new Error(`${error.message}，日志：${LOG_FILE}`, { cause: error })
  }
  const webUrl = await currentServiceWebUrl({ port: state.port, record: { logOffset } })
  if (exited()) throw await startupFailed()
  await rememberServicePort(state.port)
  console.log(`DSH Tavern 已启动：PID ${child.pid}`)
  printServiceWebUrl(webUrl)
  console.log(`日志：${LOG_FILE}`)
  return { port: state.port, runtimeGeneration: `${child.pid}-${Date.now()}`, webUrl }
}
