import { normalizeTemplateRowIds_ACU } from '../vendor/sp-database/template-row-id-normalizer.js'
import { validateTableData, sheetKeys } from './sp-database.js'

/** Accept table exports and named template exports, preserving all non-runtime fields. */
export function importSpTemplate(source, { withData = true } = {}) {
  let document = typeof source === 'string' ? JSON.parse(source) : structuredClone(source)
  if (typeof document?.jsonData === 'string') document = JSON.parse(document.jsonData)
  else if (document?.jsonData && typeof document.jsonData === 'object') document = document.jsonData
  else if (typeof document?.template === 'string') document = JSON.parse(document.template)
  else if (document?.data && sheetKeys(document.data).length) document = document.data
  if (!document || typeof document !== 'object' || !sheetKeys(document).length) throw new Error('未识别出 SP 表格或模板 JSON')
  document.mate ||= {}
  for (const key of sheetKeys(document)) {
    if (!document[key].seedRows && Array.isArray(document[key]._seedRows)) document[key].seedRows = document[key]._seedRows
    delete document[key]._seedRows
  }
  const originalIds = new Map(sheetKeys(document).map(key => {
    const sheet = document[key], column = sheet.content?.[0]?.indexOf('row_id') ?? -1
    const rows = (sheet.content || []).slice(1).concat(sheet.seedRows || [])
    return [key, new Map(column < 0 ? [] : rows.filter(row => Array.isArray(row) && row[column] !== undefined && row[column] !== null && row[column] !== '').map(row => [String(row[column]), row[column]]))]
  }))
  const normalized = normalizeTemplateRowIds_ACU(document, { syncDdl: true, deduplicateIdenticalCrossSourceRows: true })
  if (normalized.blockers.length) throw new Error(normalized.blockers.map(item => item.message).join('\n'))
  document = normalized.templateData
  for (const key of sheetKeys(document)) {
    const sheet = document[key]
    sheet.content = withData ? sheet.content.concat(sheet.seedRows || []) : sheet.content.slice(0, 1)
    // Normalization compares identities as strings; keep the caller's valid scalar type on round-trip.
    for (const row of sheet.content.slice(1)) if (originalIds.get(key)?.has(String(row[0]))) row[0] = originalIds.get(key).get(String(row[0]))
    // Initial rows have now been materialized once, or explicitly excluded.
    delete sheet.seedRows
  }
  return { data: validateTableData(document), repairs: normalized.audits.filter(item => item.headerAction !== 'unchanged' || item.generatedRowIdCount || item.deduplicatedSeedRows.length || item.ddlUpdated) }
}

export function createSpTemplateLibrary(store,{readOnly=()=>false}={}) {
  const file = 'st-migration.json'
  async function list() { return ((await store.readJson(file))?.templates || []).map(({ original, ...template }) => template) }
  async function save({ id, expectedUpdatedAt, name, data, withData = false }) {
    if(readOnly())throw Error('模板已由原版 SP 管理，请打开原版模板目录')
    const label = String(name || '').trim()
    if (!label) throw new Error('模板名称不能为空')
    const imported = importSpTemplate(data, { withData })
    await store.updateJson(file, current => {
      const state = structuredClone(current || { version: 1, regexScripts: [], companions: [], templates: [] })
      const templates = state.templates || [], previous = templates.find(item => id ? item.id === id : item.name === label)
      if (id && !previous) throw new Error('模板已删除或变化，请重新读取模板库')
      if (previous && (!id || expectedUpdatedAt !== previous.updatedAt)) throw new Error('已有同名模板或模板版本已变化，请重新读取并确认覆盖')
      if (templates.some(item => item.name === label && item.id !== previous?.id)) throw new Error('已有同名模板，请使用其他名称')
      state.templates = templates.filter(item => item.id !== previous?.id).concat([{
        id: previous?.id || crypto.randomUUID(), name: label, selected: previous?.selected || false,
        data: imported.data, original: structuredClone(data), withData, updatedAt: Math.max(Date.now(), (Number(previous?.updatedAt) || 0) + 1)
      }])
      return state
    })
    return { templates: await list(), repairs: imported.repairs }
  }
  async function select(id) {
    if(readOnly())throw Error('模板已由原版 SP 管理，请打开原版模板目录')
    await store.updateJson(file, current => {
      if (id && !(current?.templates || []).some(item => item.id === id)) throw new Error('模板不存在')
      return { ...current, templates: (current?.templates || []).map(item => ({ ...item, selected: item.id === id })) }
    })
    return { templates: await list() }
  }
  async function remove(id) {
    if(readOnly())throw Error('模板已由原版 SP 管理，请打开原版模板目录')
    await store.updateJson(file, current => ({ ...current, templates: (current?.templates || []).filter(item => item.id !== id) }))
    return { templates: await list() }
  }
  return { list, save, select, remove }
}
