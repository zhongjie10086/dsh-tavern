import { generateSpJson } from './sp-model-json.js'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { applyTableOperations, databaseState, sheetKeys } from './sp-database.js'
import { changeGamePreset } from './st-game-features.js'
import { channelSettings, SCENE_IMAGE_CHANNELS } from '../../packages/dsh-image-gen/src/tavern/scene-image-channels.js'
import { generateSceneImage } from './scene-image-provider.js'
const clone = value => structuredClone(value), text = value => String(value ?? '')
const page = (id, name, match, columns, view = 'cards') => ({ id, name, match, columns: ['row_id', ...columns], view })
export const COMPANION_PAGES = [
  page('protagonist', '主角', '主角信息|全局状态', ['姓名', '身份', '近况']),
  page('characters', '人物详情', '恋爱对象|重要角色|^人物$', ['姓名', '身份', '状态', '关系']),
  page('present', '在场角色', '在场角色', ['姓名', '当前状态', '当前穿搭', '情绪']),
  page('relations', '关系网', '人物关系', ['人物A', '人物B', '关系类型', '关系状态'], 'graph'),
  page('inventory', '背包', '物品表|背包', ['物品名称', '类型', '数量', '描述']),
  page('shop', '剧情商店', '^剧情商店$', ['物品名称', '价格', '数量', '描述']),
  page('tasks', '任务', '任务', ['任务名称', '任务描述', '任务目标', '完成情况']),
  page('memo', '备忘录', '备忘', ['备忘标题', '类型', '详细内容', '当前状态', '约定时间']),
  page('review', '剧情回顾', '纪要|事件记忆|大总结', ['时间跨度', '概览', '纪要']),
  page('calendar', '日历', '^日历事件$', ['事件名称', '日期', '时间', '地点', '参与者', '回顾'], 'calendar'),
  page('diary', '私人日记', '日记', ['写作角色', '关联角色', '日记内容', '发生时间']),
  page('interview', '调查与采访', '^调查档案$', ['调查对象', '调查主题', '记录', '时间']),
  page('map', '世界地图', '世界地图|世界地图点', ['地点名称', '上级地区', '地点类型', '环境描述'], 'map'),
  page('exploration', '探索记录', '^探索记录$', ['地点', '时间', '发现', '后续线索']),
  page('wardrobe', '衣柜', '^衣柜$', ['套装名称', '所属角色', '上装', '下装', '鞋子', '饰品', '描述']),
  page('skills', '技能与天赋树', '主角技能|技能树', ['技能名称', '技能类别', '技能经验值', '技能描述'], 'tree'),
  page('achievements', '成就与勋章', '^成就勋章$', ['名称', '条件', '进度', '状态']),
  page('world', '世界窗口', '^世界窗口$', ['名称', '视角', '地点', '描述', '状态']),
  page('rumors', '传闻与世界演化', '^世界传闻$', ['传闻', '来源', '地点', '可信度', '后续发展']),
  page('events', '随机事件与邂逅', '^随机事件$', ['事件名称', '地点', '参与者', '内容', '概率权重']),
  page('checks', '检定建议', '检定建议', ['展示文本', '检定难度', '成功发展', '失败发展']),
  page('milestones', '人物里程碑', '里程碑', ['姓名', '里程碑事件']),
  page('status', '状态详情', '状态|生理反应|NSFW|性格偏移|全局数据', ['姓名', '当前状态']),
  page('gallery', '立绘与图库', '^图库元数据$', ['名称', '角色', '类型', '标签'], 'gallery')
]
function configDefault() {
  return { general: { theme: 'system', scale: 100, dense: false, followBottom: false, floatPanel: false },
    features: Object.fromEntries(COMPANION_PAGES.map(p => [p.id, { enabled: true, auto: false }])), bindings: {},
    models: {}, prompts: {}, presets: [], selectedPresets: {}, imageTasks: {},
    image: { ...channelSettings({}, 'openai'), prefix: '', suffix: '', promptModel: null, promptInstruction: '根据所选角色或场景，整理一段清楚的生图提示词。只返回提示词。' } }
}
export function companionState(state) {
  const saved = state.companion || {}, base = configDefault(), config = saved.config || {}
  return { version: 1, wallet: 0, skillPoints: 0, skills: {}, gallery: [], portraits: {}, sceneImage: null, mapImage: null, drafts: {}, ...clone(saved),
    config: { ...base, ...clone(config), general: { ...base.general, ...config.general }, features: { ...base.features, ...config.features }, image: { ...base.image, ...config.image } } }
}
export function normalizeCompanionConfig(input) {
  const result = companionState({ companion: { config: input } }).config
  if (!['system', 'dark', 'light', 'rose', 'forest'].includes(result.general.theme)) throw new Error('主题无效')
  if (!Number.isInteger(result.general.scale) || result.general.scale < 70 || result.general.scale > 150) throw new Error('字号比例需要在 70–150 之间')
  for (const k of ['dense', 'followBottom', 'floatPanel']) if (typeof result.general[k] !== 'boolean') throw new Error('显示开关无效')
  for (const p of COMPANION_PAGES) {
    const feature = result.features[p.id]
    if (!feature || typeof feature.enabled !== 'boolean' || typeof feature.auto !== 'boolean') throw new Error('功能开关无效：' + p.name)
    if (result.bindings[p.id] !== undefined && (!Array.isArray(result.bindings[p.id]) || result.bindings[p.id].some(k => typeof k !== 'string'))) throw new Error('表格映射无效')
  }
  const model = m => { if (m && (!text(m.provider).trim() || !text(m.model).trim())) throw new Error('模型选择无效'); return m ? { provider: text(m.provider), model: text(m.model) } : null }
  result.models = Object.fromEntries(Object.entries(result.models).map(([k, m]) => [k, model(m)]))
  result.prompts = Object.fromEntries(Object.entries(result.prompts).map(([k, v]) => [k, text(v)]))
  if (!Array.isArray(result.presets) || result.presets.length > 200) throw new Error('预设列表无效')
  result.presets = result.presets.map(p => ({ id: text(p.id) || randomUUID(), name: text(p.name), prompt: text(p.prompt), model: model(p.model), regexPlan: text(p.regexPlan) }))
  if (new Set(result.presets.map(p => p.id)).size !== result.presets.length) throw new Error('预设 ID 重复')
  result.image = { ...channelSettings(result.image), prefix: text(result.image.prefix), suffix: text(result.image.suffix), promptModel: model(result.image.promptModel), promptInstruction: text(result.image.promptInstruction) }
  result.imageTasks = Object.fromEntries(['立绘', '场景图', '正文插图', '地图', '服饰'].map(kind => { const task = result.imageTasks[kind] || {}; return [kind, { size: text(task.size), aspectRatio: text(task.aspectRatio), prompt: text(task.prompt), model: model(task.model) }] }))
  return result
}
function resolvePage(state, id) {
  const definition = COMPANION_PAGES.find(p => p.id === id)
  if (!definition) throw new Error('找不到状态栏页面')
  const config = companionState(state).config
  const keys = config.bindings[id]?.length ? config.bindings[id].filter(k => state.data[k]) : sheetKeys(state.data).filter(k => new RegExp(definition.match).test(state.data[k].name))
  return { definition, keys }
}
function fieldColumn(table, pattern) { return table.content[0].findIndex(h => new RegExp(pattern).test(text(h))) }
function itemRow(state, sheet, rowId) {
  const table = state.data[sheet], index = table?.content.findIndex((r, i) => i > 0 && text(r[0]) === text(rowId))
  if (!table || !(index > 0)) throw new Error('记录不存在，请刷新')
  return { table, row: table.content[index], index }
}
export function createSpCompanion({ database, chats, generate, store, dataRoot, imageGenerate = generateSceneImage }) {
  async function get(sessionId) {
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('请先进入一局游玩')
    const state = databaseState(chat), companion = companionState(state)
    return { companion, pages: COMPANION_PAGES.map(p => ({ ...p, tables: resolvePage(state, p.id).keys })), imageChannels: SCENE_IMAGE_CHANNELS.map(c => ({ ...c, defaults: channelSettings({}, c.id) })),
      imageKeySaved: Boolean((await store.readJson('sp-service-secrets.json'))?.imageKey) }
  }
  async function saveAsset(bytes, mediaType) {
    if (!Buffer.isBuffer(bytes) || bytes.length > 24_000_000 || !bytes.length) throw new Error('图片为空或超过 24MB')
    const valid = mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : mediaType === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' : false
    if (!valid) throw new Error('仅支持内容有效的 PNG、JPEG、WebP 图片')
    const id = createHash('sha256').update(bytes).digest('hex'), directory = path.join(dataRoot, 'sp-assets')
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, id), bytes)
    return { asset: id, mediaType, size: bytes.length }
  }
  async function asset(sessionId, id) {
    const view = await get(sessionId), item = view.companion.gallery.find(i => i.id === id)
    if (!item || !/^[a-f0-9]{64}$/.test(item.asset)) throw new Error('图片不存在')
    const bytes = await readFile(path.join(dataRoot, 'sp-assets', item.asset))
    return { dataUrl: 'data:' + item.mediaType + ';base64,' + bytes.toString('base64') }
  }
  async function action(sessionId, args = {}, options = {}) {
    return database.maintenance(sessionId, '状态栏：' + args.kind, async ({ chat, state, signal, progress }) => {
      const companion = companionState(state), config = companion.config
      let result = {}, operations = []
      if (args.kind === 'configure') {
        companion.config = normalizeCompanionConfig(args.config)

      } else if (args.kind === 'apply-preset') {
        const preset = config.presets.find(p => p.id === args.id)
        if (!preset) throw new Error('预设不存在')
        resolvePage(state, args.page)
        config.selectedPresets[args.page] = preset.id; config.models[args.page] = preset.model; config.prompts[args.page] = preset.prompt
        if (preset.regexPlan) { changeGamePreset(chat, { kind: 'apply-plan', id: preset.regexPlan }); result.presetControls = chat.presetControls }
      } else if (args.kind === 'initialize') {
        const { definition, keys } = resolvePage(state, args.page)
        if (keys.length) throw new Error('页面已有表格，无需初始化')
        const key = 'sheet_v3732_' + definition.id
        operations.push({ kind: 'create', key, sheet: { name: definition.name === '日历' ? '日历事件' : { shop: '剧情商店', interview: '调查档案', achievements: '成就勋章', rumors: '世界传闻', events: '随机事件', gallery: '图库元数据' }[definition.id] || definition.name,
          content: [definition.columns], sourceData: { note: '记录已确认的' + definition.name + '信息。' }, exportConfig: { enabled: true, entryType: 'selective' } } })
        config.bindings[args.page] = [key]
      } else if (args.kind === 'edit') {
        const { keys } = resolvePage(state, args.page)
        if (!keys.includes(args.sheet)) throw new Error('不能修改当前页面范围以外的表格')
        if (!['insert', 'update', 'delete'].includes(args.operation?.kind)) throw new Error('记录操作无效')
        operations.push({ ...args.operation, sheet: args.sheet })
      } else if (args.kind === 'wallet') {
        for (const field of ['wallet', 'skillPoints']) if (args[field] !== undefined) {
          if (!Number.isFinite(args[field]) || args[field] < 0 || args[field] > 1e12) throw new Error('余额或技能点数值无效')
          companion[field] = args[field]; companion[field + 'Confirmed'] = true
        }
      } else if (args.kind === 'buy') {
        const { table, row } = itemRow(state, args.sheet, args.rowId)
        if (!resolvePage(state, 'shop').keys.includes(args.sheet)) throw new Error('这不是商店物品')
        const price = Number(row[fieldColumn(table, '^价格$')]), quantity = Number(args.quantity), stockCol = fieldColumn(table, '^数量$'), stock = Number(row[stockCol])
        if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(stock) || stock < quantity || companion.wallet < quantity * price) throw new Error('数量、库存或余额不足')
        const target = resolvePage(state, 'inventory').keys[0]
        if (!target) throw new Error('请先建立或映射背包表格')
        const inventory = state.data[target], name = row[fieldColumn(table, '物品名称|^名称$')], nameCol = fieldColumn(inventory, '物品名称|^名称$'), amountCol = fieldColumn(inventory, '^数量$'), descriptionCol = fieldColumn(inventory, '描述')
        if (nameCol < 0 || amountCol < 0) throw new Error('背包缺少物品名称或数量字段')
        const existing = inventory.content.slice(1).find(r => r[nameCol] === name)
        if (existing) { const amount = Number(existing[amountCol]); if (!Number.isFinite(amount) || amount < 0) throw new Error('背包中的数量不是有效数字'); operations.push({ kind: 'cell', sheet: target, rowId: existing[0], column: amountCol, value: amount + quantity }) }
        else { const values = inventory.content[0].map(() => ''); values[0] = null; values[nameCol] = name; values[amountCol] = quantity; if (descriptionCol >= 0) values[descriptionCol] = row[fieldColumn(table, '描述')] ?? ''; operations.push({ kind: 'insert', sheet: target, values }) }
        operations.push({ kind: 'cell', sheet: args.sheet, rowId: args.rowId, column: stockCol, value: stock - quantity }); companion.wallet -= price * quantity
      } else if (args.kind === 'wear') {
        if (!resolvePage(state, 'wardrobe').keys.includes(args.sheet)) throw new Error('这不是衣柜记录')
        const outfit = itemRow(state, args.sheet, args.rowId), targetKey = resolvePage(state, 'present').keys[0]
        if (!targetKey) throw new Error('请先映射在场角色表')
        const target = state.data[targetKey], nameCol = fieldColumn(target, '^姓名$'), who = text(args.character), row = target.content.slice(1).find(r => text(r[nameCol]) === who)
        if (!row) throw new Error('在场角色中找不到所选人物')
        for (const [col, header] of target.content[0].entries()) {
          const source = outfit.table.content[0].indexOf(header)
          if (/^(上装|下装|鞋子|饰品)$/.test(header) && source >= 0) operations.push({ kind: 'cell', sheet: targetKey, rowId: row[0], column: col, value: outfit.row[source] })
          if (header === '当前穿搭') operations.push({ kind: 'cell', sheet: targetKey, rowId: row[0], column: col, value: text(outfit.row[fieldColumn(outfit.table, '套装名称|描述')]) })
        }
        if (!operations.length) throw new Error('在场角色表没有可写入的穿搭字段')
      } else if (args.kind === 'skill-configure' || args.kind === 'skill-activate') {
        const key = args.sheet + ':' + args.rowId
        if (!resolvePage(state, 'skills').keys.includes(args.sheet)) throw new Error('这不是技能记录')
        itemRow(state, args.sheet, args.rowId)
        const lock = state.locks[args.sheet] || {}
        if (lock.table || (lock.rows || []).map(String).includes(String(args.rowId))) throw new Error('该技能已锁定')
        const previous = companion.skills[key] || { cost: 1, prerequisites: [], active: false }
        if (args.kind === 'skill-configure') {
          if (!Number.isInteger(args.cost) || args.cost < 0 || !Array.isArray(args.prerequisites) || args.prerequisites.some(id => typeof id !== 'string' || id === key)) throw new Error('技能成本或前置条件无效')
          const known = new Set(resolvePage(state, 'skills').keys.flatMap(sheet => state.data[sheet].content.slice(1).map(row => sheet + ':' + row[0])))
          if (args.prerequisites.some(id => !known.has(id))) throw new Error('前置技能不存在')
          const proposed = { ...companion.skills, [key]: { ...previous, cost: args.cost, prerequisites: args.prerequisites } }
          const visiting = new Set(), done = new Set()
          function visit(id) { if (visiting.has(id)) throw new Error('技能前置关系不能形成循环'); if (done.has(id)) return; visiting.add(id); for (const next of proposed[id]?.prerequisites || []) visit(next); visiting.delete(id); done.add(id) }
          visit(key); companion.skills = proposed
        } else {
          if (previous.active || companion.skillPoints < previous.cost || previous.prerequisites.some(id => !companion.skills[id]?.active)) throw new Error('技能已激活、技能点不足或前置条件未满足')
          companion.skillPoints -= previous.cost; companion.skills[key] = { ...previous, active: true }
        }
      } else if (args.kind === 'complete' || args.kind === 'claim') {
        const { table, row } = itemRow(state, args.sheet, args.rowId), allowed = resolvePage(state, args.kind === 'complete' ? 'tasks' : 'achievements').keys
        if (!allowed.includes(args.sheet)) throw new Error('记录类型不匹配')
        const col = fieldColumn(table, '完成情况|^状态$|当前状态')
        if (col < 0) throw new Error('表格缺少状态字段')
        operations.push({ kind: 'cell', sheet: args.sheet, rowId: row[0], column: col, value: args.kind === 'complete' ? '已完成' : '已领取' })
      } else if (args.kind === 'generate') {
        const { definition, keys } = resolvePage(state, args.page)
        if (!config.features[args.page].enabled) throw new Error('该功能已关闭')
        const custom = config.prompts[args.page] || '', model = config.models[args.page]
        const parsed = await generateSpJson({ generate, retries: state.settings.validationRetries, validate(value) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('根节点需要是包含 title、text、operations 的 JSON 对象')
          if (typeof value.text !== 'string') throw new Error('JSON 对象需要 text 字符串，用于显示可读内容；收到字段：' + Object.keys(value).join(','))
          if (!Array.isArray(value.operations)) throw new Error('operations 必须是数组，无修改时用 []')
          for (const op of value.operations) { if (!op || !keys.includes(op.sheet)) throw new Error('操作的 sheet 必须使用目标表格键：' + keys.join(',') + '；收到：' + text(op?.sheet)); if (!['insert', 'update', 'delete'].includes(op.kind)) throw new Error('操作 kind 仅允许 insert/update/delete') }
          applyTableOperations(state.data, value.operations, state.locks); return value
        }, request: { sessionId, signal, modelSelection: model || undefined,
          system: '你协助文字游戏整理' + definition.name + '。遵守用户要求和所提供资料；对尚未发生的内容明确写成候选建议。只返回 JSON {"title":"标题","text":"可阅读内容","operations":[]}。需要保存记录时可在 operations 中使用 insert/update/delete，sheet 仅使用提供的目标表格，新增 row_id 为 null，update/delete 使用 rowId。不要更改表头。\n' + custom,
          onDelta: state.settings.streamingEnabled ? delta => progress(delta) : undefined,
          messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({ instruction: text(args.prompt), targetTables: Object.fromEntries(keys.map(k => [k, state.data[k]])),
            contextTables: state.data, story: (chat.messages || []).slice(-8).map(m => ({ role: m.role, text: m.projectionText || m.sourceText || m.text })) }) }] }] } })
        companion.drafts[args.page] = { id: randomUUID(), title: text(parsed.title), text: parsed.text, operations: parsed.operations, at: Date.now(), dataHash: createHash('sha256').update(JSON.stringify(state.data)).digest('hex') }
        result = { draft: args.page }
      } else if (args.kind === 'apply-draft') {
        const draft = companion.drafts[args.page]
        if (!draft || !draft.operations.length) throw new Error('没有可应用的生成记录')
        if (draft.dataHash !== createHash('sha256').update(JSON.stringify(state.data)).digest('hex')) throw new Error('生成后表格已改变，请重新生成或手动编辑，避免覆盖新数据')
        operations = draft.operations; draft.appliedAt = Date.now(); draft.operations = []
      } else if (args.kind === 'random-event') {
        const { keys } = resolvePage(state, 'events'), items = keys.flatMap(key => state.data[key].content.slice(1).map(row => ({ sheet: key, row })))
        if (!items.length) throw new Error('请先添加随机事件')
        const weighted = items.map(item => { const cell = item.row[fieldColumn(state.data[item.sheet], '概率权重')], weight = cell === undefined || cell === '' ? 1 : Number(cell); if (!Number.isFinite(weight) || weight < 0) throw new Error('事件权重需要为非负数'); return { ...item, weight } }), total = weighted.reduce((n, item) => n + item.weight, 0)
        if (total <= 0) throw new Error('至少有一个事件的权重需要大于零')
        let n = Math.random() * total
        const picked = weighted.find(item => (n -= item.weight) < 0) || weighted.at(-1)
        companion.lastEvent = { sheet: picked.sheet, row: picked.row, at: Date.now() }; result = companion.lastEvent
      } else if (args.kind === 'gallery-import' || args.kind === 'image-generate') {
        let saved, prompt = text(args.prompt)
        if (args.kind === 'gallery-import') {
          const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(text(args.dataUrl))
          if (!match) throw new Error('图片文件格式无效')
          saved = await saveAsset(Buffer.from(match[2], 'base64'), match[1])
        } else {
          const task = config.imageTasks[text(args.imageKind || '立绘')] || {}
          const cfg = { ...config.image, ...(task.size ? { size: task.size } : {}), ...(task.aspectRatio ? { aspectRatio: task.aspectRatio } : {}), ...(task.model ? { promptModel: task.model } : {}), ...(task.prompt ? { promptInstruction: task.prompt } : {}) }, privateConfig = (await store.readJson('sp-service-secrets.json')) || {}
          if (privateConfig.imageKey && privateConfig.imageEndpoint !== cfg.baseURL) throw new Error('生图地址已修改，请在 API 设置重新保存图片密钥')
          if (args.refine) prompt = await generate({ sessionId, signal, modelSelection: cfg.promptModel || undefined, system: cfg.promptInstruction, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })
          if (!prompt.trim()) throw new Error('请填写图片描述')
          prompt = [cfg.prefix, prompt, cfg.suffix].filter(Boolean).join('\n')
          const image = await imageGenerate({ ...channelSettings(cfg), apiKey: privateConfig.imageKey || '', prompt, signal })
          saved = await saveAsset(image.data, image.mediaType)
        }
        const record = { id: randomUUID(), ...saved, name: text(args.name || '图片'), character: text(args.character), kind: text(args.imageKind || '立绘'), tags: text(args.tags), prompt, createdAt: Date.now() }
        companion.gallery.push(record); result = { image: record.id }
      } else if (args.kind === 'gallery-use') {
        const item = companion.gallery.find(i => i.id === args.id)
        if (!item) throw new Error('图片不存在')
        if (args.role === 'portrait') { const name = text(args.character || item.character).trim(); if (!name) throw new Error('请填写图片所属角色姓名'); companion.portraits[name] = item.id }
        else if (args.role === 'scene') companion.sceneImage = item.id
        else if (args.role === 'map') companion.mapImage = item.id
        else throw new Error('图片用途无效')
      } else if (args.kind === 'gallery-edit' || args.kind === 'gallery-remove') {
        const item = companion.gallery.find(i => i.id === args.id)
        if (!item) throw new Error('图片不存在')
        if (args.kind === 'gallery-remove') { companion.gallery = companion.gallery.filter(i => i.id !== args.id); companion.portraits = Object.fromEntries(Object.entries(companion.portraits).filter(([, id]) => id !== args.id)); if (companion.sceneImage === args.id) companion.sceneImage = null; if (companion.mapImage === args.id) companion.mapImage = null }
        else { for (const key of ['name', 'character', 'tags']) if (args[key] !== undefined) item[key] = text(args[key]); if (args.imageKind !== undefined) item.kind = text(args.imageKind) }
      } else if (args.kind === 'repair') {
        for (const key of sheetKeys(state.data)) {
          const table = state.data[key]
          if (!table.sourceData) operations.push({ kind: 'configure', sheet: key, patch: { sourceData: { note: '记录已确认的信息。' } } })
        }
        for (const definition of COMPANION_PAGES) config.bindings[definition.id] = resolvePage(state, definition.id).keys
        result = { repaired: operations.length, mapped: Object.values(config.bindings).filter(a => a.length).length }
      } else if (args.kind === 'clear-drafts') companion.drafts = {}
      else if (args.kind === 'import-config') companion.config = normalizeCompanionConfig(args.config)
      else throw new Error('未知状态栏操作')
      if (operations.length) state.data = applyTableOperations(state.data, operations, state.locks)
      state.companion = companion
      return { state, result, ...(result.presetControls ? { chatPatch: { presetControls: result.presetControls } } : {}) }
    }, {signal:options.signal})
  }
  async function imageCredentials(sessionId, key) {
    const { companion } = await get(sessionId)
    if (typeof key !== 'string' || /[\r\n]/.test(key)) throw new Error('图片密钥格式无效')
    await store.updateJson('sp-service-secrets.json', value => ({ ...value, imageKey: key.trim(), imageEndpoint: companion.config.image.baseURL }))
    return { saved: true }
  }
  async function afterCommit(chat, {signal} = {}) {
    if (!databaseState(chat).settings.enabled) return
    const config = companionState(databaseState(chat)).config
    for (const page of COMPANION_PAGES) {
      signal?.throwIfAborted()
      const feature = config.features[page.id]
      if (!feature.enabled || !feature.auto) continue
      const current = await chats.forSession(chat.sessionId)
      if (current.timeline?.branchId !== chat.timeline?.branchId || current.timeline?.revision !== chat.timeline?.revision) return
      const prompt = page.id === 'gallery' ? '为这段正文生成一幅场景插图：\n' + text(chat.messages?.at(-1)?.projectionText || chat.messages?.at(-1)?.text) : '根据刚完成的正文更新' + page.name + '候选记录，严格区分事实和设想。'
      signal?.throwIfAborted()
      const completed = await action(chat.sessionId, page.id === 'gallery' ? { kind: 'image-generate', name: '第 ' + chat.messages?.at(-1)?.turn + ' 轮插图', imageKind: '正文插图', prompt, refine: true } : { kind: 'generate', page: page.id, prompt }, {signal})
      if (completed.maintenance?.status !== 'completed') return
    }
  }
  async function defaults(sessionId) { const { companion } = await get(sessionId); await store.updateJson('st-migration.json', value => ({ ...value, companionConfig: companion.config })); return { saved: true } }
  return { get, action, asset, imageCredentials, afterCommit, defaults }
}
