// Preload before the kernel when DSH_TAVERN_OFFLINE=1. IPC and loopback remain
// available for the local UI; DNS and outbound sockets cannot leave the machine.
import net from 'node:net'
import dns from 'node:dns'
import {syncBuiltinESMExports} from 'node:module'

export function installOfflineNetworkGuard(env = process.env) {
  if (!/^(?:1|true)$/i.test(env.DSH_TAVERN_OFFLINE || '') || globalThis[Symbol.for('dsh.tavern.offline')]) return false
  globalThis[Symbol.for('dsh.tavern.offline')]=true
  process.env.DSH_TELEMETRY_DISABLED='1'
  function local(host) {
    const name=String(host || 'localhost').toLowerCase().replace(/^\[|\]$/g,'')
    if(name==='localhost'||name==='::1'||/^127(?:\.\d{1,3}){3}$/.test(name)||/^::ffff:127(?:\.\d{1,3}){3}$/.test(name))return
    throw Object.assign(Error('离线模式禁止外连：'+name),{code:'DSH_TAVERN_OFFLINE'})
  }
  const connect=net.Socket.prototype.connect
  net.Socket.prototype.connect=function(...args) {
    const normalized=Array.isArray(args[0])?args[0]:args,first=normalized[0]
    if(first&&typeof first==='object'){if(!first.path)local(first.host || first.hostname)}
    else if(typeof first==='number'||/^\d+$/.test(String(first)))local(typeof normalized[1]==='string'?normalized[1]:'localhost')
    return connect.apply(this,args)
  }
  for(const name of ['lookup','resolve','resolve4','resolve6','resolveAny','resolveCaa','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse']) {
    const original=dns[name]
    if(typeof original==='function') dns[name]=function(host,...args){try{local(host)}catch(error){const callback=args.at(-1);if(typeof callback==='function'){queueMicrotask(()=>callback(error));return}throw error}return original.call(this,host,...args)}
    const promised=dns.promises[name]
    if(typeof promised==='function')dns.promises[name]=async function(host,...args){local(host);return promised.call(this,host,...args)}
  }
  syncBuiltinESMExports()
  return true
}
installOfflineNetworkGuard()
