#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import './offline-network.mjs'
import path from 'node:path'
import { SCRIPT_PATH } from './launcher-environment.mjs'
import { installProfile, parseInstallHost } from './profile-installation.mjs'
import { startService, stopService, statusService, openService, bootstrapFrontendOnce } from './service-lifecycle.mjs'
import { updateApplication, parseUpdateOptions } from './application-update.mjs'
import { doctorService } from './service-doctor.mjs'

// Keep the existing import surface while the executable only dispatches commands.
export { resolveServicePort, resolveDshInvocation } from './launcher-environment.mjs'
export { applySidebarDefaults, ensureSidebarDefaults } from './launcher-settings.mjs'
export { extractDshVersion, parseInstallHost, renderWindowsLauncher, recordInstalledRelease } from './profile-installation.mjs'
export { webUrlFromLogChunk, resolveServiceWebUrl, restartBrowserTarget, browserOpenCommand, needsFrontendBootstrap, isPortOpen, isServiceReady } from './service-lifecycle.mjs'
export { encodeWindowsPowerShellScript, decodeUpdateOutput, parseUpdateOptions, updateApplication, resolveUpdateProgram } from './application-update.mjs'

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function usage() {
  console.log('用法：dsh-tavern install [--host cli|desktop|android] | {update|start|open|stop|restart|status} | doctor [--repair]（stop/restart 可显式使用 --force）')
}

function stopOptions(args) {
  if (args.some(value => value !== '--force')) throw new Error('停止服务只接受 --force 参数')
  return { force: args.includes('--force') }
}

async function main() {
  const action = process.argv[2] || 'status'
  if (/^(?:1|true)$/i.test(process.env.DSH_TAVERN_OFFLINE || '') && ['install','update'].includes(action)) throw new Error('离线模式禁止下载安装或更新；已有安装仍可 start/open/stop')
  switch (action) {
    case 'doctor':
      if(process.argv.slice(3).some(value=>value!=='--repair'))throw new Error('doctor 只接受 --repair 参数')
      console.log(JSON.stringify(await doctorService({repair:process.argv.includes('--repair')}),null,2))
      break
    case 'install':
      await installProfile(parseInstallHost(process.argv.slice(3)))
      break
    case 'update':
      await updateApplication(parseUpdateOptions(process.argv.slice(3)))
      break
    case 'start':
      {
        const state = await startService()
        await bootstrapFrontendOnce(state)
      }
      break
    case 'stop':
      await stopService(stopOptions(process.argv.slice(3)))
      break
    case 'restart':
      await stopService(stopOptions(process.argv.slice(3)))
      {
        const state = await startService()
        if (!await bootstrapFrontendOnce(state)) console.log('如页面未恢复连接，请运行 dsh-tavern open，或使用上方完整地址重新进入。')
      }
      break
    case 'status':
      await statusService()
      break
    case 'open':
      await openService()
      break
    case '-h':
    case '--help':
    case 'help':
      usage()
      break
    default:
      usage()
      process.exitCode = 2
  }
}

const isEntrypoint = process.argv[1] && realpathSync(SCRIPT_PATH) === realpathSync(path.resolve(process.argv[1]))
if (isEntrypoint) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
}
