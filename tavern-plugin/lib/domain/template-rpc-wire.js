// Playwright's object serializer walks every field into its own wire objects.
// Plain JSON state can cross as one string. Keep the original transport for
// values that JSON would alter (including own undefined properties and -0).
export function packTemplateRpcResult(value) {
  let exact = true
  try {
    const json = JSON.stringify(value, function (key, item) {
      const original = this[key]
      if (original === undefined || typeof original === 'bigint' || typeof original === 'function' || typeof original === 'symbol'
        || typeof original === 'number' && (!Number.isFinite(original) || Object.is(original, -0))
        || original && typeof original === 'object' && !Array.isArray(original) && ![Object.prototype, null].includes(Object.getPrototypeOf(original))) exact = false
      return item
    })
    if (exact && json !== undefined) return { json }
  } catch { /* Let the original transport handle unsupported or cyclic values. */ }
  return { raw: value }
}

export function unpackTemplateRpcResult(wire) {
  return Object.prototype.hasOwnProperty.call(wire, 'json') ? JSON.parse(wire.json) : wire.raw
}
