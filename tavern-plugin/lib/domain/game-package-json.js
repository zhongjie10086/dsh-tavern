import {createHash} from 'node:crypto'

// Keep the v1 JSON archive and its JSON.stringify digest. Neither the browser nor
// the server needs a second, whole-archive string or a base64 RPC envelope.
function* tokens(value, depth = 0) {
  if (depth > 512) throw Error('整局包 JSON 层数超限')
  if (value === null || typeof value !== 'object') { yield JSON.stringify(value) ?? 'null'; return }
  const array = Array.isArray(value)
  yield array ? '[' : '{'
  let comma = false
  for (const key of array ? Array.from({length: value.length}, (_, i) => i) : Object.keys(value)) {
    const child = value[key]
    if (!array && ['undefined', 'function', 'symbol'].includes(typeof child)) continue
    if (comma) yield ','
    comma = true
    if (!array) { yield JSON.stringify(key); yield ':' }
    yield* tokens(child, depth + 1)
  }
  yield array ? ']' : '}'
}

export function gamePackageJsonHash(value) {
  const hash = createHash('sha256')
  for (const token of tokens(value)) hash.update(token)
  return hash.digest('hex')
}

export function* gamePackageJsonChunks(value) {
  let parts = [], size = 0
  for (const token of tokens(value)) {
    // Encode before slicing, so a surrogate pair cannot be split by a hash/write.
    if (token.length >= 65536) {
      if (size) { yield Buffer.from(parts.join('')); parts = []; size = 0 }
      const bytes = Buffer.from(token)
      for (let i = 0; i < bytes.length; i += 65536) yield bytes.subarray(i, i + 65536)
    } else {
      parts.push(token); size += token.length
      if (size >= 32768) { yield Buffer.from(parts.join('')); parts = []; size = 0 }
    }
  }
  if (size) yield Buffer.from(parts.join(''))
}

/** Strict incremental JSON decoder. Retains decoded values and at most one scalar
 * token, rather than joining every byte of a 256+ MiB file before JSON.parse. */
export async function readGamePackageJson(chunks) {
  const root = {kind:'root', state:'value'}, stack = [root]
  const decoder = new TextDecoder('utf-8', {fatal:true})
  let mode = '', escaped = false, pieces = []
  const fail = () => { throw Error('整局包 JSON 不完整或格式无效') }
  function put(value) {
    const frame = stack.at(-1)
    if (!frame || !['value', 'valueOrEnd'].includes(frame.state)) fail()
    if (frame.kind === 'root') frame.value = value
    else if (frame.kind === 'array') frame.value.push(value)
    else Object.defineProperty(frame.value, frame.key, {value, enumerable:true, writable:true, configurable:true})
    frame.state = 'commaOrEnd'
  }
  function scalar() {
    const text = pieces.join(''); pieces = []
    const value = JSON.parse(text), frame = stack.at(-1)
    if (frame?.kind === 'object' && ['key', 'keyOrEnd'].includes(frame.state)) {
      if (typeof value !== 'string' || Object.hasOwn(frame.value, value)) fail()
      frame.key = value; frame.state = 'colon'
    } else put(value)
    mode = ''
  }
  function feed(text) {
    let start = 0
    for (let i = 0; i < text.length; i++) {
      const char = text[i]
      if (mode === 'string') {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') { pieces.push(text.slice(start, i + 1)); scalar() }
        continue
      }
      if (mode === 'atom') {
        if (!/[ \t\r\n{}\[\],:]/.test(char)) continue
        pieces.push(text.slice(start, i)); scalar()
      }
      if (/[ \t\r\n]/.test(char)) continue
      const frame = stack.at(-1)
      if (char === '"') { mode = 'string'; start = i; continue }
      if (char === '{' || char === '[') {
        const array = char === '[', value = array ? [] : {}
        put(value)
        if (stack.length >= 512) fail()
        stack.push({kind:array?'array':'object', value, state:array?'valueOrEnd':'keyOrEnd'})
      } else if (char === '}' || char === ']') {
        if (!frame || frame.kind !== (char === '}'?'object':'array') || !['commaOrEnd', char === '}'?'keyOrEnd':'valueOrEnd'].includes(frame.state)) fail()
        stack.pop()
      } else if (char === ':') {
        if (frame?.kind !== 'object' || frame.state !== 'colon') fail()
        frame.state = 'value'
      } else if (char === ',') {
        if (!frame || frame.kind === 'root' || frame.state !== 'commaOrEnd') fail()
        frame.state = frame.kind === 'array' ? 'value' : 'key'
      } else { mode = 'atom'; start = i }
    }
    if (mode) pieces.push(text.slice(start))
  }
  for await (const chunk of chunks) feed(decoder.decode(chunk, {stream:true}))
  feed(decoder.decode())
  if (mode === 'atom') scalar()
  if (mode || stack.length !== 1 || root.state !== 'commaOrEnd') fail()
  return root.value
}
