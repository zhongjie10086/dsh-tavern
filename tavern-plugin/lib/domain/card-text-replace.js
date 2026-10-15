import { withRegexBudget } from './regex-budget.js'
import { searchCardRaw } from './card-reading.js'
import { normalizeResourcePath } from './file-resources.js'

const unescapeToken = token => token.replace(/~1/g, '/').replace(/~0/g, '~')
function tokens(pointer) {
  if (typeof pointer !== 'string' || pointer && !pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) throw Error('替换范围必须是有效 JSON Pointer')
  return pointer ? pointer.slice(1).split('/').map(unescapeToken) : []
}
function at(root, parts) {
  let value = root
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw Error('替换范围不存在')
    value = value[part]
  }
  return value
}

/** A complete, lossless plan; never mutate its input or truncate matched locations. */
export function planCardTextReplace(raw, request = {}) {
  return withRegexBudget(() => planWithinBudget(raw, request))
}
function planWithinBudget(raw, request = {}) {
  if (typeof request.find !== 'string' || typeof request.replace !== 'string') throw Error('查找与替换内容必须是字符串')
  if (request.expectedCount !== undefined && (!Number.isSafeInteger(request.expectedCount) || request.expectedCount < 0)) throw Error('expectedCount 必须是非负整数')
  if (request.pointers !== undefined && !Array.isArray(request.pointers)) throw Error('pointers 必须是 JSON Pointer 数组')
  const pointers = request.pointers || []
  for (const pointer of pointers) at(raw, tokens(pointer))
  const search = searchCardRaw(raw, { query: request.find, regex: request.regex }, { all: true })
  const locations = search.hits.filter(hit => !pointers.length || pointers.some(pointer => !pointer || hit.pointer === pointer || hit.pointer.startsWith(pointer + '/')))
  const occurrences = locations.reduce((sum, hit) => sum + hit.count, 0)
  if (request.expectedCount !== undefined && occurrences !== request.expectedCount) throw Error('预期 ' + request.expectedCount + ' 处，实际 ' + occurrences + ' 处，未修改。分布：' + locations.map(hit => hit.pointer + '×' + hit.count).join('、'))
  if (!occurrences) throw Error('选定位置没有找到匹配文字，未修改')
  const pattern = new RegExp(request.regex === true ? request.find : request.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const document = structuredClone(raw)
  for (const hit of locations) {
    const parts = tokens(hit.pointer), key = parts.pop(), parent = at(document, parts), text = parent[key]
    Object.defineProperty(parent, key, { value: request.regex === true ? text.replace(pattern, request.replace) : text.replace(pattern, () => request.replace), enumerable: true, configurable: true, writable: true })
  }
  return { document, locations: locations.map(({pointer,label,count}) => ({pointer,label,count})), occurrences, remaining: searchCardRaw(document, {query:request.find,regex:request.regex}, {all:true}).occurrences }
}

/** One CAS write owns standard fields, embedded entries, scripts and unknown extensions together. */
export function createCardTextReplacement({ resources, cards, validate, afterSave = async () => {} }) {
  return async function replace(chat, request = {}, { beforeCommit = async () => {} } = {}) {
    if (!chat || chat.mode !== 'card') throw Error('人物卡替换只能在卡片工作台中使用')
    if (!chat.cardPath) throw Error('空白工作台还没有正式人物卡')
    const path = normalizeResourcePath(request.path || chat.cardPath, 'card')
    if (path !== normalizeResourcePath(chat.cardPath, 'card')) throw Error('只能替换当前工作台绑定的人物卡，请先切换工作台')
    return resources.withEditLock(path, async () => {
      const expectedText = await resources.readText(path)
      if (expectedText === undefined) throw Error('人物卡资源不存在: ' + path)
      const saved = JSON.parse(expectedText), workspace = cards.isWorkspace(saved) ? structuredClone(saved) : cards.migrate({ working:saved, payload:null })
      const plan = planCardTextReplace(workspace.raw, request)
      workspace.raw = plan.document
      const validation = validate(JSON.stringify(workspace))
      if (!validation.valid) throw Error('替换后人物卡格式无效，未保存：' + validation.errors.map(row => row.path + ' ' + row.message).join('；'))
      workspace.meta.updatedAt = Date.now()
      await beforeCommit()
      await resources.writeWorking(path, JSON.stringify(workspace, null, 2), { expectedText })
      const warnings = []
      try { await afterSave(path, cards.project(workspace)) } catch (error) { warnings.push('人物卡已保存；界面名称或投影刷新失败，请刷新工作台：' + String(error?.message || error)) }
      return { saved:true, warnings, path, replaced:plan.occurrences, remaining:plan.remaining, locations:plan.locations, validation }
    })
  }
}
