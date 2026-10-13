import { recordUpdateDiagnostic } from './update-diagnostics.mjs'
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INSTALL_HOSTS, SOURCE_ROOT, RUNTIME_HOST, runtimeEnvironment, commandExists, sleep } from './launcher-environment.mjs'
import { promoteUpdateStatus } from '../tavern-plugin/lib/update-status.js'
import { processBirth } from '../tavern-plugin/lib/process-identity.js'
import { readLocalBuild } from '../tavern-plugin/lib/local-build.js'

// Own update execution and durable terminal outcomes, including installed-but-needs-restart.
export function encodeWindowsPowerShellScript(source) {
  const utf8Output = "$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)\r\n"
  return `\uFEFF${utf8Output}${source.replace(/^\uFEFF/, '')}`
}

export function decodeUpdateOutput(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || '')
  let text
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) text = buffer.subarray(2).toString('utf16le')
  else text = buffer.toString('utf8')
  return text.replace(/^\uFEFF/, '').replaceAll('\u0000', '')
}

export function parseUpdateOptions(args) {
  let host = RUNTIME_HOST
  let statusFile = ''
  let delay = 0
  let targetCommit = ''
  let attemptId = ''
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === '--host') host = args[++index]
    else if (value.startsWith('--host=')) host = value.slice('--host='.length)
    else if (value === '--status-file') statusFile = args[++index]
    else if (value.startsWith('--status-file=')) statusFile = value.slice('--status-file='.length)
    else if (value === '--delay') delay = Number(args[++index])
    else if (value.startsWith('--delay=')) delay = Number(value.slice('--delay='.length))
    else if (value === '--target-commit') targetCommit = args[++index]
    else if (value.startsWith('--target-commit=')) targetCommit = value.slice('--target-commit='.length)
    else if (value === '--attempt-id') attemptId = args[++index]
    else throw new Error(`无法识别的更新参数：${value}`)
  }
  if (!INSTALL_HOSTS.has(host)) throw new Error(`不支持的安装宿主：${host}`)
  if (statusFile !== '' && !path.isAbsolute(statusFile)) throw new Error('更新状态文件必须使用绝对路径')
  if (!Number.isInteger(delay) || delay < 0 || delay > 5000) throw new Error('更新延迟必须是 0 到 5000 毫秒的整数')
  if (targetCommit !== '' && !/^[0-9a-f]{40}$/i.test(targetCommit)) throw new Error('目标提交号无效')
  if (attemptId !== '' && !/^[a-z0-9-]{36}$/i.test(attemptId)) throw new Error('更新任务编号无效')
  return { host, statusFile, delay, targetCommit, ...(attemptId ? { attemptId } : {}) }
}

export async function writeUpdateStatus(file, value, attemptId) {
  if (file === '') return
  await promoteUpdateStatus(file, { ...value, ...(attemptId ? { attemptId } : {}) }, { attemptId })
  recordUpdateDiagnostic(path.dirname(file), { event: 'installer.status', ...value })
}

export async function updateApplication(options = { host: RUNTIME_HOST, statusFile: '', delay: 0 }) {
  const sourceRoot = path.resolve(options.sourceRoot || SOURCE_ROOT)
  const log = typeof options.log === 'function' ? options.log : console.log
  const startedAt = Date.now()
  const targetCommit = String(options.targetCommit || '')
  // Z89: the upstream installer would replace a local repair build with
  // upstream main. Refuse before touching anything; nothing needs repair.
  const localBuild = await readLocalBuild(sourceRoot)
  if (localBuild) {
    await writeUpdateStatus(options.statusFile, {
      phase: 'failed', localBuild: true, host: options.host, failedAt: startedAt, error: localBuild.notice,
      ...(targetCommit ? { targetCommit } : {}),
    }, options.attemptId)
    throw new Error(localBuild.notice)
  }
  await writeUpdateStatus(options.statusFile, {
    phase: 'running', host: options.host, startedAt, pid: process.pid,
    processIdentity: processBirth(process.pid)?.id,
    ...(targetCommit ? { targetCommit } : {}),
  }, options.attemptId)
  let temporary = ''
  let outputFile = ''
  try {
    if (options.delay > 0) await sleep(options.delay)
    if(existsSync(path.join(sourceRoot,'.git'))){
      const status=spawnSync('git',['-c','safe.directory='+sourceRoot.replaceAll('\\','/'),'--no-optional-locks','-C',sourceRoot,'status','--porcelain=v1','--untracked-files=normal'],{encoding:'utf8',windowsHide:true})
      if(status.error||status.status!==0)throw Error('无法核对当前 Git 安装目录，未覆盖本地文件')
      if(status.stdout.trim())throw Error('当前安装目录有未提交的本地改动，请处理后再更新')
    }
    log('正在更新 DSH Tavern……')
    const program = resolveUpdateProgram(options.host, process.platform, sourceRoot)
    const installer = program.script
    if (!existsSync(installer)) throw new Error(`当前安装缺少更新程序：${installer}`)
    const extension = path.extname(installer).slice(1) || 'sh'
    temporary = path.join(os.tmpdir(), `dsh-tavern-update-${process.pid}.${extension}`)
    if (path.extname(installer).toLowerCase() === '.ps1') {
      writeFileSync(temporary, encodeWindowsPowerShellScript(readFileSync(installer, 'utf8')), 'utf8')
    } else {
      copyFileSync(installer, temporary)
    }
    const command = program.command
    const args = program.args.map((argument) => argument === installer ? temporary : argument)
    const capture = options.statusFile !== ''
    outputFile = capture ? `${temporary}.log` : ''
    let outputDescriptor = null
    let result
    try {
      if (capture) outputDescriptor = openSync(outputFile, 'w')
      result = spawnSync(command, args, {
        env: {
          ...runtimeEnvironment(),
          DSH_TAVERN_HOST: options.host,
          DSH_TAVERN_SOURCE_ROOT: sourceRoot,
          DSH_TAVERN_APP_DIR: sourceRoot,
          ...(options.targetCommit ? { DSH_TAVERN_TARGET_COMMIT: options.targetCommit } : {}),
          ...(capture ? { DSH_TAVERN_NO_OPEN: '1' } : {}),
        },
        stdio: capture ? ['ignore', outputDescriptor, outputDescriptor] : 'inherit',
        windowsHide: true,
      })
    } finally {
      if (outputDescriptor !== null) closeSync(outputDescriptor)
    }
    if (capture && existsSync(outputFile)) recordUpdateDiagnostic(path.dirname(options.statusFile), { event: 'installer.output', exitCode: result.status, signal: result.signal, output: decodeUpdateOutput(readFileSync(outputFile)).slice(-6000) })
    if (result.error) throw new Error(`无法运行更新程序：${result.error.message}`)
    if (result.status !== 0) {
      const details = capture && existsSync(outputFile) ? decodeUpdateOutput(readFileSync(outputFile)).trim().split('\n').slice(-12).join('\n') : ''
      throw new Error(`更新失败${details ? `：${details}` : '，请查看上方错误信息。'}`)
    }
    if (temporary !== '' && existsSync(temporary)) unlinkSync(temporary)
    temporary = ''
    if (outputFile !== '' && existsSync(outputFile)) unlinkSync(outputFile)
    outputFile = ''
    await writeUpdateStatus(options.statusFile, {
      phase: 'completed', host: options.host, completedAt: Date.now(), requiresRestart: options.host === 'desktop',
      ...(targetCommit ? { targetCommit } : {}),
    }, options.attemptId)
  } catch (error) {
    let failure = error
    if (temporary !== '' && existsSync(temporary)) {
      try { unlinkSync(temporary) } catch (cleanupError) {
        failure = new Error(`${String(error?.message || error)}；临时文件清理失败：${String(cleanupError?.message || cleanupError)}`)
      }
    }
    if (outputFile !== '' && existsSync(outputFile)) {
      try { unlinkSync(outputFile) } catch {}
    }
    await writeUpdateStatus(options.statusFile, {
      phase: 'failed', repairRequired: true, host: options.host, failedAt: Date.now(), error: String(failure?.message || failure),
      ...(targetCommit ? { targetCommit } : {}),
    }, options.attemptId)
    throw failure
  }
}

function resolveWindowsPowerShell(options = {}) {
  const environment = options.env || process.env
  const fileExists = options.fileExists || existsSync
  const commandAvailable = options.commandAvailable || commandExists
  const windowsRoots = [
    environment.SystemRoot,
    environment.SYSTEMROOT,
    environment.WINDIR,
    environment.windir,
  ].filter(Boolean)

  for (const windowsRoot of new Set(windowsRoots)) {
    const candidate = path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fileExists(candidate)) return candidate
  }
  if (commandAvailable('powershell.exe')) return 'powershell.exe'
  if (commandAvailable('pwsh.exe')) return 'pwsh.exe'
  return ''
}

export function resolveUpdateProgram(host, platform = process.platform, sourceRoot = SOURCE_ROOT, options = {}) {
  if (host === 'android') {
    const script = path.join(sourceRoot, 'android', 'update.sh')
    return { script, command: 'bash', args: [script] }
  }
  if (platform === 'win32') {
    const script = path.join(sourceRoot, 'install.ps1')
    const command = resolveWindowsPowerShell(options)
    if (command === '') {
      const hostPrefix = host === 'desktop' ? "$env:DSH_TAVERN_HOST='desktop'; " : ''
      throw new Error(
        `找不到 Windows PowerShell 或 PowerShell 7。请在当前 PowerShell 中运行：${hostPrefix}irm https://cdn.jsdelivr.net/gh/zhongjie10086/dsh-tavern@release-r15-clean/install.ps1 | iex`,
      )
    }
    return { script, command, args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] }
  }
  const script = path.join(sourceRoot, 'install.sh')
  return { script, command: 'sh', args: [script] }
}
