import { isDeepStrictEqual } from 'node:util'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const LOGIC = ['and_any', 'not_all', 'not_any', 'and_all']
const ROLE = ['system', 'user', 'assistant']

function strategyType(entry) {
  if (entry.constant === true) return 'constant'
  if (entry.vectorized === true) return 'vectorized'
  return 'selective'
}

function positionType(value) {
  if (value === 'before_char' || Number(value) === 0) return 'before_character_definition'
  if (value === 'after_char' || Number(value) === 1) return 'after_character_definition'
  if (value === 'before_example' || Number(value) === 5) return 'before_example_messages'
  if (value === 'after_example' || Number(value) === 6) return 'after_example_messages'
  if (value === 'before_an' || Number(value) === 2) return 'before_author_note'
  if (value === 'after_an' || Number(value) === 3) return 'after_author_note'
  if (value === 'at_depth' || Number(value) === 4) return 'at_depth'
  if (value === 'outlet' || Number(value) === 7) return 'outlet'
  return 'after_character_definition'
}

function projectEntry(entry) {
  return {
    uid: Number.isFinite(Number(entry.sourceUid)) ? Number(entry.sourceUid) : str(entry.sourceUid),
    name: str(entry.comment ?? entry.title),
    enabled: entry.enabled !== false,
    strategy: {
      type: strategyType(entry),
      keys: clone(entry.primaryKeys || []),
      keys_secondary: { logic: LOGIC[Number(entry.selectiveLogic) || 0] || 'and_any', keys: clone(entry.secondaryKeys || []) },
      scan_depth: entry.scanDepth === null || entry.scanDepth === undefined ? 'same_as_global' : entry.scanDepth
    },
    position: {
      type: positionType(entry.position),
      role: ROLE[Number(entry.role) || 0] || 'system',
      depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : 4,
      order: Number(entry.order) || 0
    },
    content: str(entry.content),
    probability: entry.probabilityEnabled === false ? 100 : (Number.isFinite(Number(entry.probability)) ? Number(entry.probability) : 100),
    recursion: {
      prevent_incoming: entry.excludeRecursion === true,
      prevent_outgoing: entry.preventRecursion === true,
      delay_until: Number(entry.delayUntilRecursion) > 0 ? Number(entry.delayUntilRecursion) : null
    },
    effect: {
      sticky: entry.sticky ?? null,
      cooldown: entry.cooldown ?? null,
      delay: entry.delay ?? null
    },
    extra: Object.assign({}, clone(entry.rawEntry && entry.rawEntry.extensions && entry.rawEntry.extensions.dsh_tavern_helper_extra || {}), { displayIndex: entry.displayIndex ?? 0, caseSensitive: entry.caseSensitive ?? null, matchWholeWords: entry.matchWholeWords ?? null, group: str(entry.group), dsh_tavern_ref: str(entry.ref) })
  }
}

export function projectTavernHelperWorldbook(view) {
  return {
    name: str(view && view.displayName),
    entries: (Array.isArray(view && view.entries) ? view.entries : []).map(projectEntry)
  }
}

const POSITIONS = ['before_character_definition', 'after_character_definition', 'before_author_note', 'after_author_note', 'at_depth', 'before_example_messages', 'after_example_messages', 'outlet']

function enumValue(value, values, label) {
  if ((typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value)>=0 && Number(value)<values.length) return Number(value)
  const index = values.indexOf(value)
  if (index < 0) throw new Error('未知世界书' + label + ': ' + str(value))
  return index
}

function finite(value, label, nullable = false, minimum = 0) {
  if (nullable && value === null) return null
  if(typeof value==='string'&&value.trim()!=='')value=Number(value)
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error('无效世界书' + label)
  return value
}

function keys(value) {
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) throw new Error('世界书关键词必须是字符串数组')
  return clone(value)
}

function mergedEntry(base, value) {
  if(value.position!==undefined && (typeof value.position==='number'||typeof value.position==='string'))value={...value,position:{type:value.position}}
  const result = Object.assign({}, base, value)
  for (const name of ['strategy', 'position', 'recursion', 'effect']) {
    result[name] = Object.assign({}, base[name], value[name])
  }
  result.strategy.keys_secondary = Object.assign({}, base.strategy.keys_secondary, value.strategy && value.strategy.keys_secondary)
  return result
}

function enabledValue(value) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('世界书启用状态必须是布尔值')
}

function entryPatch(entry) {
  const strategy = entry.strategy, position = entry.position
  enumValue(strategy.type, ['constant', 'selective', 'vectorized'], '激活策略')
  const probability = Math.max(0,Math.min(100,finite(entry.probability, '概率',false,-Infinity)))
  const extra = clone(entry.extra || {})
  delete extra.dsh_tavern_ref
  const legacy = { displayIndex: extra.displayIndex ?? 0, caseSensitive: extra.caseSensitive ?? null, matchWholeWords: extra.matchWholeWords ?? null, group: str(extra.group) }
  for (const key of Object.keys(legacy)) delete extra[key]
  return {
    ...legacy,
    comment: str(entry.name), content: str(entry.content), enabled: enabledValue(entry.enabled),
    constant: strategy.type === 'constant', selective: strategy.type === 'selective', vectorized: strategy.type === 'vectorized',
    primaryKeys: keys(strategy.keys), secondaryKeys: keys(strategy.keys_secondary.keys),
    selectiveLogic: enumValue(strategy.keys_secondary.logic, LOGIC, '关键词逻辑'),
    scanDepth: strategy.scan_depth === 'same_as_global' ? null : finite(strategy.scan_depth, '扫描深度'),
    position: enumValue(position.type, POSITIONS, '插入位置'), role: enumValue(position.role, ROLE, '消息角色'),
    depth: finite(position.depth, '插入深度'), order: finite(position.order, '插入顺序', false, -Infinity),
    probability, probabilityEnabled: true,
    excludeRecursion: entry.recursion.prevent_incoming === true,
    preventRecursion: entry.recursion.prevent_outgoing === true,
    delayUntilRecursion: finite(entry.recursion.delay_until, '递归延迟', true) || null,
    sticky: finite(entry.effect.sticky, '黏性', true), cooldown: finite(entry.effect.cooldown, '冷却', true), delay: finite(entry.effect.delay, '延迟', true),
    helperExtra: extra
  }
}

/** Replace by stable uid, preserving untouched raw fields and resolving embedded refs before deletion. */
export function replaceTavernHelperWorldbookOperations(view, requested) {
  if (!Array.isArray(requested)) throw new Error('世界书条目必须是数组')
  const source = projectTavernHelperWorldbook(view).entries
  const byUid = new Map(source.map(entry => [String(entry.uid), entry]))
  if (byUid.size !== source.length) throw new Error('世界书条目编号重复')
  const seen = new Set()
  const used = new Set(source.map(entry => Number(entry.uid)))
  for (const entry of requested) if (entry && entry.uid !== undefined) used.add(Number(entry.uid))
  let nextUid = Math.max(-1, ...Array.from(used).filter(Number.isSafeInteger)) + 1
  const operations = []
  for (const value of requested) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界书条目必须是对象')
    const uid = value.uid === undefined ? nextUid++ : typeof value.uid==='string'&&/^\d+$/.test(value.uid)?Number(value.uid):value.uid
    if (!Number.isSafeInteger(uid) || uid < 0 || seen.has(String(uid))) throw new Error('世界书条目编号无效或重复')
    seen.add(String(uid))
    const before = byUid.get(String(uid))
    const defaults = projectEntry({ comment: '', order: 100, position: 0, depth: 4 })
    const after = mergedEntry(before || defaults, value)
    const full = entryPatch(after)
    if (!before) {
      operations.push({ op: 'add', uid, entry: full })
      continue
    }
    const previous = entryPatch(before), patch = {}
    for (const key of Object.keys(full)) if (JSON.stringify(full[key]) !== JSON.stringify(previous[key])) patch[key] = full[key]
    // A changed numeric probability must also enable probability checks in the source document.
    if (before.strategy.type !== after.strategy.type) Object.assign(patch, { constant: full.constant, selective: full.selective, vectorized: full.vectorized })
    if (Object.hasOwn(patch, 'probability')) patch.probabilityEnabled = true
    if (Object.keys(patch).length) operations.push({ op: 'update', ref: before.extra.dsh_tavern_ref, patch })
  }
  for (const entry of source) if (!seen.has(String(entry.uid))) operations.push({ op: 'delete', ref: entry.extra.dsh_tavern_ref })
  return operations
}

/** Rebase independent script edits by UID; never overwrite a changed entry. */
export function mergeTavernHelperWorldbookEntries(current, requested, expected) {
  if (!Array.isArray(requested) || !Array.isArray(expected)) throw new Error('世界书条目必须是数组')
  const normalize = entries=>entries.map(entry=>entry&&typeof entry.uid==='string'&&/^\d+$/.test(entry.uid)?{...entry,uid:Number(entry.uid)}:entry)
  current=normalize(current);requested=normalize(requested);expected=normalize(expected)
  const index = (entries, allowNew = false) => {
    const result = new Map()
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('世界书条目必须是对象')
      if (allowNew && entry.uid === undefined) continue
      if (!Number.isSafeInteger(entry.uid) || entry.uid < 0 || result.has(entry.uid)) throw new Error('世界书条目编号无效或重复')
      result.set(entry.uid, entry)
    }
    return result
  }
  const base = index(expected), latest = index(current), desired = index(requested, true)
  const defaults = projectEntry({comment: '', order: 100, position: 0, depth: 4})
  const same = (a, b) => a === undefined || b === undefined ? a === b
    : isDeepStrictEqual(entryPatch(mergedEntry(defaults, a)), entryPatch(mergedEntry(defaults, b)))
  const edits = new Map(), additions = []
  const conflict = uid => {throw new Error('世界书已被其他操作修改：条目 ' + uid + ' 存在并发冲突，请重新读取后重试')}
  for (const [uid, before] of base) {
    const patch = desired.get(uid), after = patch && mergedEntry(before, patch), now = latest.get(uid)
    if (same(before, after)) continue
    if (!same(now, before) && !same(now, after)) conflict(uid)
    edits.set(uid, after)
  }
  for (const entry of requested) {
    if (entry.uid !== undefined && base.has(entry.uid)) continue
    // Validate new entries before any changes can be persisted.
    entryPatch(mergedEntry(defaults, entry))
    if (entry.uid !== undefined && latest.has(entry.uid)) {
      if (!same(latest.get(entry.uid), entry)) conflict(entry.uid)
    } else additions.push(clone(entry))
  }
  return current.filter(entry => !edits.has(entry.uid) || edits.get(entry.uid) !== undefined)
    .map(entry => clone(edits.has(entry.uid) ? edits.get(entry.uid) : entry)).concat(additions)
}
