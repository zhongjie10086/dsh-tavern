export const DEFAULT_HEADER_SHORTCUTS = ['settings','presets','worldbooks','variables']
export const ESSENTIAL_HEADER_SHORTCUTS = ['settings']
export const HEADER_SHORTCUTS = ['settings','presets','worldbooks','variables','memory','scripts','images']
export function normalizeHeaderShortcuts(value) {
  if (value === undefined || value === null) return [...DEFAULT_HEADER_SHORTCUTS]
  if (!Array.isArray(value) || value.some(item => !HEADER_SHORTCUTS.includes(item))) throw Error('顶栏快捷入口无效')
  return [...new Set([...ESSENTIAL_HEADER_SHORTCUTS, ...value])]
}
export function normalizeReadingPreferences(value) {
  const result = { fontSize: 16, lineHeight: 1.75, letterSpacing: 0 }
  if (value === undefined || value === null) return result
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('阅读设置无效')
  for (const [name, min, max] of [['fontSize',8,48],['lineHeight',1,3],['letterSpacing',-1,8]]) {
    if (value[name] === undefined) continue
    if (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || value[name] < min || value[name] > max) throw Error('阅读设置超出范围: ' + name)
    result[name] = value[name]
  }
  return result
}
