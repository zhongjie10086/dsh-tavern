import { SYSTEM_PROMPT_NAMES } from '../prompt-catalog.js'

const clone = value => structuredClone(value)
function validName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw Error('方案名称须为 1–80 字符')
  return value.trim()
}
export function validatePromptOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('系统提示词方案无效')
  const result = {}
  for (const [name, text] of Object.entries(value)) {
    if (!SYSTEM_PROMPT_NAMES.includes(name) || typeof text !== 'string' || text.length > 100000 || (!text.trim() && !['system-append','card-system'].includes(name))) throw Error('系统提示词无效: ' + name)
    result[name] = text.trim()
  }
  return result
}
export function systemPromptSets(document = {}) {
  const source = document.systemPromptSets
  if (!source) return { selected: 'legacy', sets: [{ id: 'legacy', name: '当前方案', promptOverrides: clone(document.promptOverrides || {}), systemAppendEnabled: document.systemAppendEnabled === true }] }
  return clone(source)
}
// Legacy promptOverrides remains the active projection used by every existing request path.
export function applySystemPromptSetOperation(document, operation) {
  const state = systemPromptSets(document), op = operation || {}
  const current = state.sets.find(item => item.id === state.selected)
  if (!current) throw Error('当前系统提示词方案不存在')
  current.promptOverrides = clone(document.promptOverrides || {})
  current.systemAppendEnabled = document.systemAppendEnabled === true
  const target = state.sets.find(item => item.id === op.id)
  if (['select','rename','delete','copy','replace'].includes(op.action) && !target) throw Error('系统提示词方案不存在')
  if (op.action === 'create' || op.action === 'copy') {
    const id = String(op.newId || '')
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || state.sets.some(item => item.id === id)) throw Error('方案标识无效或已存在')
    if (state.sets.length >= 100) throw Error('最多保存 100 套方案')
    state.sets.push({ id, name: validName(op.name), promptOverrides: op.action === 'copy' ? clone(target.promptOverrides) : validatePromptOverrides(op.promptOverrides || {}), systemAppendEnabled: op.action === 'copy' ? target.systemAppendEnabled : op.systemAppendEnabled === true })
    if (op.select === true) state.selected = id
  } else if (op.action === 'replace') {
    target.promptOverrides = validatePromptOverrides(op.promptOverrides)
    target.systemAppendEnabled = op.systemAppendEnabled === true
  } else if (op.action === 'rename') target.name = validName(op.name)
  else if (op.action === 'select') state.selected = target.id
  else if (op.action === 'delete') {
    if (state.sets.length === 1) throw Error('至少保留一套系统提示词方案')
    state.sets = state.sets.filter(item => item.id !== target.id)
    if (state.selected === target.id) state.selected = state.sets[0].id
  } else throw Error('未知方案操作')
  const selected = state.sets.find(item => item.id === state.selected)
  return { ...document, systemPromptSets: state, promptOverrides: clone(selected.promptOverrides), systemAppendEnabled: selected.systemAppendEnabled === true }
}

export function syncSelectedSystemPromptSet(document) {
  if (!document.systemPromptSets) return document
  const state = systemPromptSets(document), selected = state.sets.find(item => item.id === state.selected)
  if (!selected) throw Error('当前系统提示词方案不存在')
  selected.promptOverrides = clone(document.promptOverrides || {})
  selected.systemAppendEnabled = document.systemAppendEnabled === true
  return { ...document, systemPromptSets: state }
}
