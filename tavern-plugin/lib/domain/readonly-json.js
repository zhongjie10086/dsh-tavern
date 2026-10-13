// Shared JSON values are owned by the storage layer. Never freeze caller-owned drafts.
const frozen = new WeakSet(), sizes = new WeakMap()
export const isFrozenJson = value => !!value && typeof value === 'object' && frozen.has(value)
export function freezeJson(value) {
  if (!value || typeof value !== 'object' || frozen.has(value)) return value
  for (const child of Object.values(value)) freezeJson(child)
  Object.freeze(value); frozen.add(value)
  return value
}
export function jsonBytes(value) {
  if (!value || typeof value !== 'object') return Buffer.byteLength(JSON.stringify(value) ?? 'null')
  if (sizes.has(value)) return sizes.get(value)
  const entries = Array.isArray(value) ? value : Object.entries(value).filter(([,v])=>v !== undefined)
  let bytes = 2 + Math.max(0, entries.length - 1)
  if (Array.isArray(value)) for (const child of value) bytes += jsonBytes(child)
  else for (const [key,child] of entries) bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + jsonBytes(child)
  if (Object.isFrozen(value)) sizes.set(value, bytes)
  return bytes
}
