const MARKER = 'dsh-tavern/source-v1:'
const decodedSources = new WeakMap()
const decodedEvents = new WeakMap()
const invalidSources = new WeakSet()
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child)
    Object.freeze(value)
  }
  return value
}
export function encodeTavernSource(source, version = 4) {
  if (source?.kind !== 'plugin' || !source.plugin?.startsWith('dsh-tavern')) return source
  const encoded = source.form === 'notice' && typeof source.summary === 'string' && source.summary.startsWith(MARKER)
    ? source : { kind: 'plugin', plugin: source.plugin, form: 'notice', summary: MARKER + JSON.stringify(source) }
  if (version < 4) return encoded
  const {plugin, ...owned} = encoded
  return {...owned, kind: 'plugin:' + plugin}
}
export function decodeTavernSource(source) {
  if (decodedSources.has(source)) return decodedSources.get(source)
  const producer = source?.kind?.startsWith('plugin:dsh-tavern') ? source.kind.slice(7) : undefined
  const logical = producer ? {...source,kind:'plugin',plugin:producer} : source
  if (logical?.kind !== 'plugin' || !logical.plugin?.startsWith('dsh-tavern')) return source
  if (logical.form !== 'notice' || !logical.summary?.startsWith(MARKER)) return logical
  let value
  try {
    value = JSON.parse(logical.summary.slice(MARKER.length))
    if (value?.kind !== 'plugin' || value.plugin !== logical.plugin) throw new Error('invalid source')
  } catch {
    invalidSources.add(source)
    if (Object.isFrozen(source)) decodedSources.set(source, source)
    return source
  }
  invalidSources.delete(source)
  if (Object.isFrozen(source)) decodedSources.set(source, freezeDeep(value))
  return value
}
export function tavernSourceDiagnostics(events) {
  const diagnostics = []
  for (const event of events || []) {
    if (event?.type !== 'user/message') continue
    const source = event.data?.source
    decodeTavernSource(source)
    if (source && invalidSources.has(source)) diagnostics.push({ scriptId: '', name: '存档来源', status: 'unavailable', code: 'INVALID_TAVERN_SOURCE', seq: event.seq, message: '第 ' + event.seq + ' 条事件的酒馆来源标记损坏，已保留原始事件。相关历史操作可能受限，请导出诊断包修复。' })
    if (diagnostics.length >= 100) break
  }
  return diagnostics
}
export function encodeTavernMessage(message, version = 4) {
  if (!message || typeof message !== 'object') return message
  const source = encodeTavernSource(message.source, version)
  return source === message.source ? message : { ...message, source }
}
export function decodeTavernMessage(message) {
  if (!message || typeof message !== 'object') return message
  const source = decodeTavernSource(message.source)
  return source === message.source ? message : { ...message, source }
}
export function decodeTavernEvent(event) {
  if (event?.data?.message) {
    const message = decodeTavernMessage(event.data.message)
    if (message !== event.data.message) return {...event,data:{...event.data,message}}
  }
  if (event && decodedEvents.has(event)) return decodedEvents.get(event)
  if (event?.type === 'user/message') {
    const data = decodeTavernMessage(event.data)
    const result = data === event.data ? event : { ...event, data }
    if (Object.isFrozen(event) && Object.isFrozen(event.data) && Object.isFrozen(event.data?.source)) decodedEvents.set(event, result === event ? event : freezeDeep(result))
    return result
  }
  return event
}
export function appendTavernEvent(session, type, data, intent) {
  if (type === 'user/message') data = encodeTavernMessage(data, session?.header?.version)
  else if (session?.header?.version >= 4 && data?.message) data = {...data,message:encodeTavernMessage(data.message,session.header.version)}
  const event = intent ? session.append(type, data, intent) : session.append(type, data)
  return decodeTavernEvent(event)
}
