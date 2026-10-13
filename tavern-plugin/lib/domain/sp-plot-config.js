import { normalizeSpFeatures, SP_FEATURE_DEFAULTS } from './sp-feature-config.js'
import { normalizeContextRules } from './sp-context-rules.js'
const text = value => String(value ?? '')
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const integer = (value, fallback, min, max) => { const n = Number(value ?? fallback); if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('配置数值需要在 ' + min + ' 到 ' + max + ' 之间'); return n }
export function normalizeSpModel(value) {
  if (value === null || value === undefined || value === '') return null
  if (!record(value) || !text(value.provider).trim() || !text(value.model).trim()) throw new Error('请选择有效的模型')
  return { provider: text(value.provider).trim(), model: text(value.model).trim() }
}
export function defaultPlotPreset() {
  return { name: '基础召回与推进', contextTurnCount: 3, contextExtractRules: [], contextExcludeRules: [],
    finalSystemDirective: '以下是本轮的数据库记忆和剧情建议。记忆是已记录的事实，建议尚未发生；结合玩家输入决定如何续写。',
    plotTasks: [
      { id: 'recall', name: '召回', kind: 'recall', enabled: true, stage: 1, order: 0, model: null, maxRetries: 1, minLength: 0,
        extractTags: 'recall', extractInjectTags: 'recall', finalDirectiveTemplate: '', promptGroup: [
          { role: 'system', content: '从数据库选择与本轮输入相关的记忆，只使用已有事实。输出 <recall>{"rows":[{"sheet":"sheet_x","rowId":1}]}</recall>，只选择已存在的 sheet 键和 row_id，无相关记忆则 rows 为空数组。' },
          { role: 'user', content: '数据库：\n{{tables}}\n最近剧情：\n$7\n本轮玩家输入：\n$8' }] },
      { id: 'plot', name: '推进', kind: 'plot', enabled: true, stage: 2, order: 1, model: null, maxRetries: 1, minLength: 0,
        extractTags: 'plot', extractInjectTags: 'plot', finalDirectiveTemplate: '', promptGroup: [
          { role: 'system', content: '为文字游戏拟定简短的本轮推进建议，不代替玩家作出决定，不把建议记为既成事实。输出 <plot>建议</plot>。' },
          { role: 'user', content: '已有记忆：\n{{memories}}\n召回：\n{{recall}}\n最近剧情：\n$7\n玩家输入：\n$8' }] }
    ] }
}
export function normalizePlotPreset(input, name) {
  let source = typeof input === 'string' ? JSON.parse(input) : input
  source = source?.preset || source?.plotSettings || source
  if (!record(source)) throw new Error('请选择有效的推进预设 JSON')
  const legacyPrompts = Array.isArray(source.prompts) ? source.prompts : Object.entries(source.prompts || {}).map(([id, content]) => ({ id, content, role: id === 'systemPrompt' ? 'user' : 'system' }))
  const promptsOf = value => {
    const group = value.promptGroup || value.prompts || legacyPrompts.filter(item => item.id !== 'finalSystemDirective')
    if (!Array.isArray(group) || !group.length || group.length > 100) throw new Error('每个推进任务需要 1 到 100 条提示词')
    return group.filter(p => p.id !== 'finalSystemDirective').map(p => {
      const rawRole = text(p.role || 'system').toLowerCase()
      const role = rawRole === 'ai' ? 'assistant' : rawRole
      if (!['system', 'user', 'assistant'].includes(role)) throw new Error('提示词角色无效')
      return { role, content: text(p.content), enabled: p.enabled !== false }
    })
  }
  const rawTasks = Array.isArray(source.plotTasks) && source.plotTasks.length ? source.plotTasks : [{ ...source, id: 'defaultPlotTask', name: '推进' }]
  if (rawTasks.length > 32) throw new Error('最多支持 32 个推进任务')
  const ids = new Set()
  const tasks = rawTasks.map((task, i) => {
    const id = text(task.id || 'task-' + (i + 1))
    if (ids.has(id)) throw new Error('推进任务 ID 重复')
    ids.add(id)
    return { id, name: text(task.name || '任务 ' + (i + 1)), enabled: task.enabled !== false,
      kind: task.kind === 'recall' || (!task.kind && /召回|recall/i.test(task.name || '')) ? 'recall' : 'plot',
      stage: integer(task.stage, 1, 1, 100), order: integer(task.order, i, 0, 1000),
      maxRetries: integer(Math.min(3, Number(task.maxRetries ?? source.loopSettings?.maxRetries ?? 1)), 1, 0, 3),
      minLength: integer(task.minLength, 0, 0, 100000), model: normalizeSpModel(task.model),
      extractTags: text(task.extractTags ?? source.extractTags), extractInjectTags: text(task.extractInjectTags ?? source.extractInjectTags),
      finalDirectiveTemplate: text(task.finalDirectiveTemplate), promptGroup: promptsOf(task) }
  }).sort((a, b) => a.stage - b.stage || a.order - b.order)
  const warnings = new Set(Array.isArray(source.warnings) ? source.warnings.filter(w => typeof w === 'string') : [])
  if (source.agentWorldbookControl?.enabled || rawTasks.some(t => t.agentControl?.enabled)) warnings.add('原 SP 的 Agent 配置不会自动导入；请在数据库仪表盘的 Agent 世界书页设置。推进任务按本页启用状态和阶段执行。')
  if (source.plotWorldbookConfig || source.selectedWorldbooks?.length) warnings.add('推进使用 DSH 准备的世界书上下文；可在数据库仪表盘的 Agent 世界书页选择范围并接管。原 SP 的世界书名称不会自动对应本地文件。')
  const templateText = tasks.flatMap(t => t.promptGroup.map(p => p.content)).join('\n')
  if (/<%|\{\{(?:getvar|setvar|random|roll|sql|eval)[:(]/i.test(templateText)) warnings.add('预设包含尚未执行的 EJS、SQL 或脚本宏；请在提示词编辑器中调整。')
  return { version: 1, name: text(name || source.name || '导入的推进预设').trim(),
    contextTurnCount: integer(source.contextTurnCount, 3, 1, 100),
    contextExtractRules: normalizeContextRules(source.contextExtractRules, source.contextExtractTags),
    contextExcludeRules: normalizeContextRules(source.contextExcludeRules, source.contextExcludeTags),
    finalSystemDirective: text(source.finalSystemDirective ?? legacyPrompts.find(p => p.id === 'finalSystemDirective')?.content),
    rateMain: Number(source.rateMain ?? 1), ratePersonal: Number(source.ratePersonal ?? 1), rateErotic: Number(source.rateErotic ?? 0), rateCuckold: Number(source.rateCuckold ?? 0),
    recallCount: integer(source.recallCount, 20, 1, 1000), plotTasks: tasks, warnings: [...warnings] }
}
export const SP_DEFAULT_SETTINGS = Object.freeze({ ...SP_FEATURE_DEFAULTS, enabled: true, autoFill: false, contextTurns: 3, updateFrequency: 1,
  recallEnabled: true, recallMaxChars: 12000, recallMaxRows: 30, selectedTables: [], prompt: '',
  generationFormat: 'operations', validationRetries: 1, fillModel: null,
  tableContextExtractRules: [], tableContextExcludeRules: [], plotEnabled: false, plotModel: null, recallModel: null, plotPreset: null })
export function normalizeDatabaseSettings(value = {}) {
  const result = { ...structuredClone(SP_DEFAULT_SETTINGS), ...normalizeSpFeatures(value) }
  for (const key of Object.keys(result).filter(key => !Object.hasOwn(SP_FEATURE_DEFAULTS, key))) if (Object.hasOwn(value, key)) result[key] = structuredClone(value[key])
  for (const key of ['fillModel', 'plotModel', 'recallModel']) result[key] = normalizeSpModel(result[key])
  for (const key of ['enabled', 'autoFill', 'recallEnabled', 'plotEnabled']) if (typeof result[key] !== 'boolean') throw new Error('开关值无效：' + key)
  for (const key of ['contextTurns', 'updateFrequency', 'recallMaxChars', 'recallMaxRows']) result[key] = integer(result[key], SP_DEFAULT_SETTINGS[key], 1, key === 'recallMaxChars' ? 100000 : 1000)
  result.validationRetries = integer(result.validationRetries, 1, 0, 3)
  if (!['operations', 'sql'].includes(result.generationFormat)) throw new Error('填表格式无效')
  if (!Array.isArray(result.selectedTables) || result.selectedTables.some(k => typeof k !== 'string')) throw new Error('表格范围无效')
  for (const key of ['tableContextExtractRules', 'tableContextExcludeRules']) result[key] = normalizeContextRules(result[key])
  result.prompt = text(result.prompt)
  if (result.plotPreset) result.plotPreset = normalizePlotPreset(result.plotPreset)
  return result
}
