import net from 'node:net'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export function newServiceControl() {
  return { version: 1, endpoint: '\\\\.\\pipe\\dsh-tavern-' + randomUUID(), token: randomBytes(32).toString('hex') }
}

function validControl(control) {
  return control?.version === 1 && /^\\\\\.\\pipe\\dsh-tavern-[a-f0-9-]+$/.test(control.endpoint) && /^[a-f0-9]{64}$/.test(control.token)
}

export async function listenServiceControl(control, host = process) {
  if (!validControl(control)) throw new Error('本机停机通道配置无效')
  let stopping = false
  const server = net.createServer(socket => {
    let input = '', handled = false
    socket.setEncoding('utf8')
    socket.setTimeout(1500, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', chunk => {
      if (handled) return
      input += chunk
      if (Buffer.byteLength(input) > 1024) { handled = true; socket.destroy(); return }
      if (!input.includes('\n')) return
      handled = true
      let request
      try { request = JSON.parse(input.slice(0, input.indexOf('\n'))) } catch { socket.end('{"ok":false}\n'); return }
      if (!request || typeof request !== 'object' || Array.isArray(request)) { socket.end('{"ok":false}\n'); return }
      const supplied = typeof request.token === 'string' ? Buffer.from(request.token) : Buffer.alloc(0)
      const expected = Buffer.from(control.token)
      if (request.action !== 'stop' || request.pid !== host.pid || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        socket.end('{"ok":false}\n'); return
      }
      if (!host.listenerCount('SIGTERM')) { socket.end('{"ok":false,"reason":"not-ready"}\n'); return }
      socket.end(JSON.stringify({ ok: true, pid: host.pid }) + '\n')
      if (stopping) return
      stopping = true
      server.close()
      // Use the CLI's existing handler so its bounded shutdown disposes fibers.
      setImmediate(() => host.emit('SIGTERM'))
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(control.endpoint, resolve) })
  server.unref()
  return server
}

export async function requestServiceStop(record, timeoutMs = 2000) {
  if (!validControl(record?.control)) throw new Error('此服务没有正常停机通道；确认需要强制停止后可运行 dsh-tavern stop --force。')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(record.control.endpoint)
    let input = '', finished = false
    const finish = error => {
      if (finished) return
      finished = true; clearTimeout(timer); socket.destroy()
      if (error) reject(error); else resolve()
    }
    const timer = setTimeout(() => finish(new Error('正常停机通道响应超时，尚未强制结束服务。')), timeoutMs)
    socket.setEncoding('utf8')
    socket.once('error', error => finish(new Error('无法连接正常停机通道：' + error.code)))
    socket.once('connect', () => socket.write(JSON.stringify({ action: 'stop', pid: record.pid, token: record.control.token }) + '\n'))
    socket.on('data', chunk => {
      input += chunk
      if (input.length > 1024) { finish(new Error('正常停机通道响应无效')); return }
      if (!input.includes('\n')) return
      try {
        const reply = JSON.parse(input.slice(0, input.indexOf('\n')))
        finish(reply.ok === true && reply.pid === record.pid ? undefined : new Error('正常停机请求被拒绝，请检查凭据或等待服务就绪。'))
      } catch { finish(new Error('正常停机通道响应无效')) }
    })
    socket.once('close', () => { if (!finished) finish(new Error('正常停机通道提前关闭')) })
  })
}

// Only the launcher-owned Node process receives this preload environment.
if (process.env.DSH_TAVERN_SERVICE_CONTROL) {
  const control = JSON.parse(process.env.DSH_TAVERN_SERVICE_CONTROL)
  delete process.env.DSH_TAVERN_SERVICE_CONTROL
  await listenServiceControl(control)
}
