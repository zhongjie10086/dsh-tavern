// New conversion definitions and unsaved initial values share this canonical form.
// Persisted definitions must never pass through it during read/verify/reuse: their
// original JSON participates in the immutable definition digest.
export function normalizeMvuInitialState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) throw Error('initialState 必须是非空变量对象')
  const state=structuredClone(value)
  if (Object.hasOwn(state,'$meta')) {
    const meta=state.$meta
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) throw Error('$meta 必须是对象；不能丢弃原 metadata')
    if (Object.hasOwn(meta,'strictSet') && typeof meta.strictSet !== 'boolean') throw Error('$meta.strictSet 必须是布尔值')
  } else state.$meta={}
  if (!Object.hasOwn(state.$meta,'strictSet')) state.$meta.strictSet=true
  return state
}

// Compare user input against a saved canonical definition. Legacy definitions
// without strictSet retain their old exact-value contract.
export function definitionStateInput(value, saved) {
  return saved?.$meta && Object.hasOwn(saved.$meta,'strictSet') ? normalizeMvuInitialState(value) : value
}
