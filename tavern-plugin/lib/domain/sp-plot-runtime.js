import { defaultPlotPreset, normalizePlotPreset } from './sp-plot-config.js'
import { filterContext, normalizeContextRules, lastBoundary } from './sp-context-rules.js'
const text = value => String(value ?? '')
const tagsOf = value => text(value).split(/[,，\s]+/).map(t => t.trim().replace(/^<\/?|>$/g, '')).filter(Boolean)
function tagged(source, tags) {
  const parts = tagsOf(tags).map(tag => lastBoundary(source, { start: '<' + tag, end: '</' + tag + '>' })).filter(v => v !== null)
  return parts.length ? parts.join('\n\n') : ''
}
function tableText(data, settings) {
  const entries = Object.entries(data).filter(([key, sheet]) => key.startsWith('sheet_') && sheet.exportConfig?.enabled !== false)
  const parts = []
  let length = 0
  for (const [key, sheet] of entries) {
    for (const row of sheet.content.slice(1)) {
      const line = key + ' / ' + sheet.name + ': ' + sheet.content[0].map((column, i) => column + '=' + text(row[i])).join('; ')
      if (length + line.length > settings.recallMaxChars) continue
      parts.push(line); length += line.length + 1
    }
  }
  return parts.join('\n')
}

export function resolvePlotRecall(output, state) {
  const wanted = []
  try {
    const plain = (tagged(output, 'recall') || output).replace(/^<recall[^>]*>|<\/recall>$/gi, '').trim().replace(/^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$/gi, '')
    const result = JSON.parse(plain)
    if (Array.isArray(result.rows)) wanted.push(...result.rows)
  } catch {}
  const codes = new Set(text(output).match(/\bAM\d+\b/gi)?.map(code => code.toUpperCase()) || [])
  const rows = [], lines = []
  let length = 0
  for (const [key, sheet] of Object.entries(state.data)) {
    if (!key.startsWith('sheet_') || sheet.exportConfig?.enabled === false) continue
    for (const row of sheet.content.slice(1)) {
      const selected = wanted.some(ref => ref && ref.sheet === key && text(ref.rowId) === text(row[0]))
        || row.some(cell => (text(cell).match(/\bAM\d+\b/gi) || []).some(code => codes.has(code.toUpperCase())))
      if (!selected || rows.length >= state.settings.recallMaxRows) continue
      const line = sheet.name + '：' + sheet.content[0].map((header, i) => header + '=' + text(row[i])).join('；')
      if (length + line.length > state.settings.recallMaxChars) continue
      rows.push({ sheet: key, rowId: row[0] }); lines.push(line); length += line.length + 1
    }
  }
  return { rows, text: lines.length ? '召回的数据库事实：\n' + lines.join('\n') : '' }
}

export function renderPlotTemplate(template, variables, previous = {}) {
  // One pass: braces in story, database cells or model output are never expanded again.
  return text(template).replace(/\{\{([^{}]+)\}\}|\$([156789UC])|\b(sulv[1-4]|zhaohui)\b/g, (match, named, legacy, rate) => {
    const key = named?.trim() || legacy || rate
    return Object.hasOwn(previous, key) ? text(previous[key]) : Object.hasOwn(variables, key) ? text(variables[key]) : match
  })
}
export async function executeSpPlot({ chat, state, card, userText, worldBookContext = '', memory = '', generate, signal, progress = () => {} }) {
  const preset = normalizePlotPreset(state.settings.plotPreset || defaultPlotPreset())
  const context = (chat.messages || []).filter(m => m.role === 'assistant' && !m._qrf_from_planning).slice(-preset.contextTurnCount)
    .map(m => filterContext(m.projectionText || m.sourceText || m.text, { extractRules: preset.contextExtractRules, excludeRules: preset.contextExcludeRules })).join('\n\n')
  const tables = tableText(state.data, state.settings)
  const variables = { context, userInput: userText, tables, memories: memory, previousPlot: state.plot?.text || '', character: card?.description || '', worldbook: worldBookContext,
    '1': worldBookContext, '5': tables, '6': state.plot?.text || '', '7': context, '8': userText, '9': worldBookContext, C: card?.description || '', U: chat.userDescription || chat.personaDescription || chat.userProfileContextSnapshot || '',
    sulv1: preset.rateMain, sulv2: preset.ratePersonal, sulv3: preset.rateErotic, sulv4: preset.rateCuckold, zhaohui: preset.recallCount }
  for (const [key, sheet] of Object.entries(state.data)) if (key.startsWith('sheet_') && sheet.exportConfig?.enabled !== false) variables[sheet.name] = JSON.stringify(sheet.content)
  const previousOutput = [state.plot?.text || '', ...(state.plot?.tasks || []).map(task => task.text)].join('\n')
  const templates = [preset.finalSystemDirective, ...preset.plotTasks.flatMap(t => [t.finalDirectiveTemplate, ...t.promptGroup.map(p => p.content)])]
  for (const template of templates) for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) {
    const tag = match[1]
    if (!Object.hasOwn(variables, tag)) variables[tag] = tagged(previousOutput, tag) || '<' + tag + '></' + tag + '>'
  }
  const results = [], completedTags = Object.create(null), injection = [], warnings = new Set(preset.warnings || [])
  const tasks = preset.plotTasks.filter(t => t.enabled)
  for (const stage of [...new Set(tasks.map(t => t.stage))]) {
    // Same-stage tasks see only previous stages, as in SP; deterministic execution order.
    const stageResults = []
    for (const task of tasks.filter(t => t.stage === stage)) {
      signal?.throwIfAborted()
      const selected = task.model || (task.kind === 'recall' ? state.settings.recallModel : state.settings.plotModel) || undefined
      const prompts = task.promptGroup.filter(p => p.enabled !== false && p.content.trim()).map(p => ({ ...p, content: renderPlotTemplate(p.content, variables, completedTags) }))
      if (!prompts.length) throw new Error(task.name + ' 没有启用的提示词')
      if (prompts.some(p => /\{\{[^{}]+\}\}|<%/.test(p.content))) warnings.add(task.name + ' 有未展开的宏，请检查提示词。')
      // DSH supports a separate system field; later system segments retain their position as explicit instructions.
      const leading = []
      while (prompts[0]?.role === 'system') leading.push(prompts.shift().content)
      const messages = prompts.map(p => ({ role: p.role === 'system' ? 'user' : p.role,
        source: { kind: 'plugin', plugin: 'dsh-tavern' }, content: [{ type: 'text', text: p.role === 'system' ? '[系统指令]\n' + p.content : p.content }] }))
      if (!messages.length) messages.push({ role: 'user', content: [{ type: 'text', text: '请执行上述任务。' }] })
      let output, extracted, injected, correction = [], attempts = 0
      for (;;) {
        signal?.throwIfAborted()
        await progress({ task: task.name, taskId: task.id, stage, attempt: ++attempts, model: selected || null })
        output = text(await generate({ sessionId: chat.sessionId, modelSelection: selected, signal, temperature: 0.4,
          system: leading.join('\n\n'), messages: messages.concat(correction) }))
        signal?.throwIfAborted()
        extracted = task.extractTags ? tagged(output, task.extractTags) : output
        injected = task.extractInjectTags ? tagged(output, task.extractInjectTags) : extracted
        const problem = task.extractTags && !extracted ? '缺少结果标签 ' + task.extractTags
          : task.extractInjectTags && !injected ? '缺少注入标签 ' + task.extractInjectTags
          : extracted.trim().length < task.minLength ? '结果长度不足 ' + task.minLength : ''
        if (!problem) break
        if (attempts > task.maxRetries) throw new Error(task.name + '：' + problem)
        correction = [{ role: 'assistant', source: { kind: 'plugin', plugin: 'dsh-tavern' }, content: [{ type: 'text', text: output }] },
          { role: 'user', content: [{ type: 'text', text: problem + '。请按要求重新完整输出。' }] }]
      }
      const recalled = task.kind === 'recall' ? resolvePlotRecall(extracted, state) : { rows: [], text: '' }
      const result = { id: task.id, name: task.name, kind: task.kind, stage, model: selected || null, attempts, text: extracted, injection: injected, rows: recalled.rows }
      if (recalled.text) { injection.push(recalled.text); stageResults.push({ memory: recalled.text }) }
      stageResults.push({ result, output, task })
      results.push(result)
      if (task.finalDirectiveTemplate) injection.push(renderPlotTemplate(task.finalDirectiveTemplate, variables, { ...completedTags, [task.id]: extracted }))
      if (injected) injection.push(injected)
    }
    for (const { result, output, task, memory } of stageResults) {
      if (memory) { variables.memories = [variables.memories, memory].filter(Boolean).join('\n\n'); continue }
      completedTags[task.id] = result.text
      for (const tag of tagsOf(task.extractTags + ',' + task.extractInjectTags)) {
        const value = tagged(output, tag)
        if (value) completedTags[tag] = value
      }
    }
  }
  const final = renderPlotTemplate(preset.finalSystemDirective, variables, completedTags)
  return { status: 'completed', presetName: preset.name, text: [final, ...injection].filter(Boolean).join('\n\n'), tasks: results, warnings: [...warnings], finishedAt: Date.now() }
}
