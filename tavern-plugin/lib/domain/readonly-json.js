// Shared JSON values are owned by the storage layer. Never freeze caller-owned drafts.
const frozen = new WeakSet(), sizes = new WeakMap()
// Large executable strings recur inside fresh projection wrappers. Their JSON
// byte length is immutable even when the containing object is mutable.
const stringSizes = new Map(), stringSizeLimit = 32 * 1024 * 1024
let stringSizeBytes = 0
function primitiveBytes(value) {
  if (typeof value !== 'string' || value.length < 4096) return Buffer.byteLength(JSON.stringify(value) ?? 'null')
  const old = stringSizes.get(value)
  if (old) { stringSizes.delete(value); stringSizes.set(value, old); return old.encoded }
  const encoded = Buffer.byteLength(JSON.stringify(value)), retained = Buffer.byteLength(value)
  if (retained <= stringSizeLimit) {
    while (stringSizes.size && (stringSizes.size >= 128 || stringSizeBytes + retained > stringSizeLimit)) {
      const key = stringSizes.keys().next().value
      stringSizeBytes -= stringSizes.get(key).retained; stringSizes.delete(key)
    }
    stringSizes.set(value, {encoded, retained}); stringSizeBytes += retained
  }
  return encoded
}
export const isFrozenJson = value => !!value && typeof value === 'object' && frozen.has(value)
export function freezeJson(value) {
  if (!value || typeof value !== 'object' || frozen.has(value)) return value
  for (const child of Object.values(value)) freezeJson(child)
  Object.freeze(value); frozen.add(value)
  return value
}
export function jsonBytes(value) {
  if (!value || typeof value !== 'object') return primitiveBytes(value)
  if (sizes.has(value)) return sizes.get(value)
  const entries = Array.isArray(value) ? value : Object.entries(value).filter(([,v])=>v !== undefined)
  let bytes = 2 + Math.max(0, entries.length - 1)
  if (Array.isArray(value)) for (const child of value) bytes += jsonBytes(child)
  else for (const [key,child] of entries) bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + jsonBytes(child)
  if (Object.isFrozen(value)) sizes.set(value, bytes)
  return bytes
}
