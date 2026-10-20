import {retainSpRecoverySnapshots} from './sp-recovery-snapshots.js'
import {createSpArchiveIndex} from './sp-archive-index.js'
import {mutableJsonDraft} from './json-draft.js'
import { stampSpFloor, switchSpIsolation, cleanupSpFloors, captureSpDormant, wakeSpDormant } from './sp-layer-storage.js'
import { planManualFill, fillFloors, fillMessages, fillPromptMessages, fillReferenceText, parseFillOutput } from './sp-fill-workbench.js'
import { exportSpCheckpoint, parseSpCheckpoint, spDataManagement } from './sp-checkpoint.js'
import { randomUUID, createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { mergeConcurrentFields } from './chat-persistence.js'
import { runSpSql, spSqlSchema } from './sp-sql.js'
import { SP_DEFAULT_SETTINGS, normalizeDatabaseSettings } from './sp-plot-config.js'
import { contextForFill } from './sp-context-rules.js'
import { executeSpPlot } from './sp-plot-runtime.js'
import { allocateStableRowId_ACU, createStableRowIdReservation_ACU } from '../vendor/sp-database/stable-row-id-allocator.js'

const clone = value => structuredClone(value)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = value => value === undefined || value === null ? '' : String(value)
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const DEFAULT_SETTINGS = SP_DEFAULT_SETTINGS

export function sheetKeys(data) {
  return Object.keys(data || {}).filter(key => key.startsWith('sheet_')).sort((a, b) => (Number(data[a]?.orderNo) || 0) - (Number(data[b]?.orderNo) || 0))
}

// Keep this narrow projection aligned with the original extension bridge.
export function publicSpTables(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, sheet]) => {
    if (!key.startsWith('sheet_') || !object(sheet)) return [key, sheet]
    const {_dshLastRowId: counter, ...publicSheet} = sheet
    return [key, publicSheet]
  }))
}

export function validateTableData(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : clone(value)
  if (!object(data) || !object(data.mate) || !sheetKeys(data).length) throw new Error('表格 JSON 需要 mate 和至少一个 sheet_* 表格。')
  for (const key of sheetKeys(data)) {
    const sheet = data[key]
    if (!object(sheet) || !text(sheet.name).trim() || !Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) throw new Error(key + ' 缺少名称或表头。')
    const width = sheet.content[0].length
    if (!width || width > 128) throw new Error(sheet.name + ' 列数无效。')
    for (const row of sheet.content) {
      if (!Array.isArray(row) || row.length !== width || row.some(cell => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))) throw new Error(sheet.name + ' 含不完整行或非标量单元格。')
    }
    if (sheet.content[0][0] === 'row_id') {
      const ids = new Set()
      for (const row of sheet.content.slice(1)) {
        if (row[0] === null || row[0] === '' || ids.has(String(row[0]))) throw new Error(sheet.name + ' 的 row_id 为空或重复。')
        ids.add(String(row[0]))
      }
    }
  }
  return data
}

export function defaultTableData() {
  const names = [
    ['state', '全局状态', ['row_id', '地点', '时间', '当前状态']],
    ['characters', '人物', ['row_id', '姓名', '身份', '位置', '状态', '关系']],
    ['events', '事件记忆', ['row_id', '事件', '相关人物', '时间', '后续影响']],
    ['tasks', '剧情任务', ['row_id', '任务', '进展', '线索']]
  ]
  return { mate: { format: 'dsh-sp', version: 1 }, ...Object.fromEntries(names.map(([id, name, headers], orderNo) => [
    'sheet_' + id, { uid: 'sheet_' + id, name, orderNo, content: [headers], sourceData: { note: '只记录剧情已经确认的事实；保留未解决的线索。' }, exportConfig: { enabled: true, entryType: id === 'events' ? 'selective' : 'constant' } }
  ])) }
}

export function databaseRevision(chat) { return chat?.spDatabase ? chat.spDatabase.revision : 0 }
export function databaseState(chat, {readonly=false}={}) {
  if (chat?.spDatabase) {
    const state = readonly ? {...chat.spDatabase} : mutableJsonDraft(chat.spDatabase)
    state.settings = normalizeDatabaseSettings(state.settings)
    return state
  }
  const migration = chat?.runtimePresetSnapshot?.migration
  const template = migration?.templates?.find(item => item.selected)
  const data = template ? validateTableData(template.data) : defaultTableData()
  const settings = normalizeDatabaseSettings(migration?.databaseConfig || {})
  settings.selectedTables = settings.selectedTables.filter(key => sheetKeys(data).includes(key))
  return { version: 1, revision: 0, data, locks: {}, template: template ? { id:template.id, name:template.name, updatedAt:template.updatedAt } : null, settings, ...(migration?.companionConfig ? { companion: { config: clone(migration.companionConfig) } } : {}), snapshots: [], activity: null, lastFilledBody: '' }
}

/** Plan a schema change without losing row identities; removed fields remain in the automatic snapshot. */
export function planSpTemplateChange(previous,template,locks={},mode='preserve') {
  if(!['preserve','replace'].includes(mode))throw new Error('模板切换模式无效');
  const before=validateTableData(previous),data=validateTableData(template),mapping={},summary=[];
  const used=new Set(),nextLocks={},rowIds={};
  for(const key of sheetKeys(data)) {
    const target=data[key],available=sheetKeys(before).filter(k=>!used.has(k));
    const exact=available.filter(k=>k===key),byUid=target.uid?available.filter(k=>before[k].uid===target.uid):[];
    const matches=exact.length?exact:byUid.length?byUid:available.filter(k=>before[k].name===target.name);
    if(matches.length>1)throw new Error('存在多个同名或同身份的表格：'+target.name);
    const oldKey=matches[0],old=before[oldKey],headers=target.content[0];
    if(new Set(headers).size!==headers.length)throw new Error(target.name+' 有重复列名，无法切换模板');
    if(oldKey){used.add(oldKey);mapping[oldKey]=key;}
    if(old&&mode==='preserve'&&old.content.length>1) {
      const indices=headers.map(h=>old.content[0].indexOf(h)),addIds=headers[0]==='row_id'&&!old.content[0].includes('row_id');
      rowIds[oldKey]=Object.create(null);
      target.content=[headers,...old.content.slice(1).map((row,index)=>{
        const values=indices.map(i=>i<0?'':row[i]);if(addIds)values[0]=String(index+1);
        (rowIds[oldKey][String(row[0])]||=[]).push(String(values[0]));return values;
      })];
      if(old._dshLastRowId!==undefined&&!addIds)target._dshLastRowId=old._dshLastRowId;
    }
    summary.push({key,name:target.name,previousKey:oldKey||null,rows:target.content.length-1,retained:old&&mode==='preserve'?old.content.length-1:0,removedColumns:old?old.content[0].filter(h=>!headers.includes(h)):[]});
    if(oldKey&&locks[oldKey]) {
      const lock=locks[oldKey],columns=(lock.columns||[]).map(c=>headers.indexOf(old.content[0][c]));
      const cells=(lock.cells||[]).map(value=>{const split=String(value).lastIndexOf(':'),col=Number(String(value).slice(split+1));return String(value).slice(0,split)+':'+headers.indexOf(old.content[0][col])});
      if(columns.includes(-1)||cells.some(c=>c.endsWith(':-1')))throw new Error(old.name+' 有已锁定的列，不能移除');
      const oldShape={...clone(target),content:[old.content[0],...target.content.slice(1).map(row=>old.content[0].map(h=>row[headers.indexOf(h)]??null))]};
      if(lock.table&&!isDeepStrictEqual(old,target))throw new Error(old.name+' 已锁定，不能切换结构');
      assertTableLocks({mate:{},[oldKey]:old},{mate:{},[oldKey]:oldShape},{[oldKey]:{...lock,table:false}});
      const remapId=id=>rowIds[oldKey]?.[String(id)]||[String(id)];
      nextLocks[key]={...clone(lock),rows:(lock.rows||[]).flatMap(remapId),columns,cells:cells.flatMap(value=>{const split=value.lastIndexOf(':');return remapId(value.slice(0,split)).map(id=>id+value.slice(split))})};
    }
  }
  const removed=sheetKeys(before).filter(k=>!used.has(k));
  for(const key of removed)if(locks[key]?.table||(locks[key]?.rows||[]).length||(locks[key]?.columns||[]).length||(locks[key]?.cells||[]).length)throw new Error(before[key].name+' 有锁定数据，不能从本局移除');
  return {data:validateTableData(data),locks:nextLocks,mapping,rowIds,summary,archived:removed.map(k=>({key:k,name:before[k].name,rows:before[k].content.length-1}))};
}
function findSheet(data, key) {
  const resolved = own(data, key) && key.startsWith('sheet_') ? key : sheetKeys(data).find(candidate => data[candidate].name === key)
  if (!resolved) throw new Error('找不到表格：' + text(key))
  return resolved
}

function rowIndex(sheet, operation) {
  const index = operation.rowId !== undefined
    ? sheet.content.findIndex((row, index) => index > 0 && String(row[0]) === String(operation.rowId))
    : Number(operation.row)
  if (!Number.isSafeInteger(index) || index < 1 || index >= sheet.content.length) throw new Error('数据行不存在')
  return index
}

function cellIndex(sheet, value) {
  const index = typeof value === 'number' ? value : sheet.content[0].findIndex(label => String(label) === String(value))
  if (!Number.isSafeInteger(index) || index < 0 || index >= sheet.content[0].length) throw new Error('列不存在：' + text(value))
  return index
}

export function assertTableLocks(before, after, locks = {}) {
  for (const key of sheetKeys(before)) {
    const lock=locks[key];if(!lock||(!lock.table&&!(lock.rows?.length)&&!(lock.columns?.length)&&!(lock.cells?.length)))continue
    const previous=before[key],next=after[key]
    if(lock.table&&!isDeepStrictEqual(previous,next))throw new Error(previous.name+' 已锁定。')
    if(lock.table)continue
    for(const column of lock.columns||[])if(!isDeepStrictEqual(previous.content.map(row=>row[column]),next?.content.map(row=>row[column])))throw new Error(previous.name+' 有已锁定的列。')
    const rows=new Set((lock.rows||[]).map(String)),cells=new Set(lock.cells||[]),columns=new Set(lock.columns||[]),nextRows=new Map((next?.content.slice(1)||[]).map(row=>[String(row[0]),row]))
    for(const row of previous.content.slice(1)){
      const id=String(row[0]),nextRow=nextRows.get(id)
      for(let column=0;column<previous.content[0].length;column++)if((rows.has(id)||columns.has(column)||cells.has(id+':'+column))&&!isDeepStrictEqual(row[column],nextRow?.[column]))throw new Error(previous.name+' 有已锁定的行、列或单元格。')
    }
  }
}

export function applyTableOperations(input, operations, locks = {}) {
  const data = validateTableData(input)
  if (!Array.isArray(operations) || operations.length > 1000) throw new Error('表格操作列表无效')
  for (const op of operations) {
    if (!object(op)) throw new Error('表格操作无效')
    if (op.kind === 'create') {
      const key = text(op.key) || 'sheet_' + randomUUID().replaceAll('-', '')
      if (!/^sheet_[\w-]+$/.test(key) || own(data, key)) throw new Error('表格键重复或无效')
      data[key] = { ...clone(op.sheet), uid: key }
      continue
    }
    const key = findSheet(data, op.sheet)
    const sheet = data[key]
    if (op.kind === 'cell') {
      sheet.content[rowIndex(sheet, op)][cellIndex(sheet, op.column)] = op.value
    } else if (op.kind === 'update') {
      if (!Array.isArray(op.values) && !object(op.values)) throw new Error('更新行缺少 values 数组或按列名填写的对象')
      const index = rowIndex(sheet, op)
      if (Array.isArray(op.values)) {
        if (op.values.length !== sheet.content[0].length) throw new Error('更新行的列数不符')
        sheet.content[index] = clone(op.values)
      } else {
        for (const [column, value] of Object.entries(op.values || {})) sheet.content[index][cellIndex(sheet, /^\d+$/.test(column) ? Number(column) : column)] = value
      }
    } else if (op.kind === 'insert') {
      const values = op.values ?? (object(op.row) ? op.row : undefined)
      if (!Array.isArray(values) && !object(values)) throw new Error('新增行缺少 values 数组或按列名填写的对象')
      if (object(values) && Object.keys(values).some(column => !sheet.content[0].includes(column))) throw new Error('新增行包含未知列名；允许的列：' + sheet.content[0].join('、'))
      const row = Array.isArray(values) ? clone(values) : sheet.content[0].map(header => values[header] ?? null)
      if (row.length !== sheet.content[0].length) throw new Error('新增行的列数不符')
      if (sheet.content[0][0] === 'row_id' && (row[0] === null || row[0] === '')) {
        const reserved = createStableRowIdReservation_ACU(sheet.content.slice(1))
        if (sheet._dshLastRowId) reserved.add(String(sheet._dshLastRowId))
        row[0] = Number(allocateStableRowId_ACU(reserved))
        sheet._dshLastRowId = row[0]
      }
      sheet.content.push(row)
    } else if (op.kind === 'delete') {
      sheet.content.splice(rowIndex(sheet, op), 1)
    } else if (op.kind === 'remove') {
      if (sheetKeys(data).length === 1) throw new Error('至少保留一张表')
      delete data[key]
    } else if (op.kind === 'configure') {
      for (const field of ['name', 'sourceData', 'exportConfig', 'updateConfig', 'orderNo']) if (own(op.patch || {}, field)) sheet[field] = clone(op.patch[field])
    } else if (op.kind === 'replace-sheet') {
      data[key] = clone(op.value)
    } else throw new Error('不支持的表格操作：' + text(op.kind))
  }
  validateTableData(data)
  assertTableLocks(input, data, locks)
  return data
}

export function databaseRecall(chat, query = '') {
  const state = databaseState(chat,{readonly:true}), archived=createSpArchiveIndex(state.summaryArchives)
  if (!state.settings.enabled || !state.settings.recallEnabled) return { text: '', rows: [] }
  const words = [...new Set((text(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).flatMap(word => word.length > 3 ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]))]
  const candidates = []
  for (const key of sheetKeys(state.data)) {
    const sheet = state.data[key]
    if (sheet.exportConfig?.enabled === false || (state.settings.zeroTkOccupyMode && /总体大纲|纪要索引|OutlineTable|纪要(?:概览|总览|总表)|概览纪要/.test(sheet.name))) continue
    const constant = sheet.exportConfig?.entryType !== 'selective' && sheet.exportConfig?.entryType !== 'keyword'
    const keywords = text(sheet.exportConfig?.keywords).split(/[,，\n]/).map(word => word.trim().toLowerCase()).filter(Boolean)
    const forced = keywords.some(word => text(query).toLowerCase().includes(word))
    sheet.content.slice(1).forEach((row, index) => {
      if (state.settings.flightMode && archived.has(key,row)) return
      const source = row.map(text).join(' | ').toLowerCase()
      const score = words.reduce((sum, word) => sum + (source.includes(word) ? word.length : 0), 0)
      if (constant || forced || score > 0) candidates.push({ key, name: sheet.name, headers: sheet.content[0], row, rowId: row[0], score, constant, index })
    })
  }
  candidates.sort((a, b) => Number(b.constant) - Number(a.constant) || b.score - a.score || b.index - a.index)
  const selected = [], parts = []
  let size = 0
  if (!state.settings.zeroTkOccupyMode) for (const key of sheetKeys(state.data)) {
    const sheet = state.data[key], columns = sheet.content[0]
    if (sheet.exportConfig?.enabled === false || !/纪要|总结/.test(sheet.name) || !columns.includes('概览')) continue
    const indices = ['编码索引', '时间跨度', '概览'].map(name => columns.indexOf(name)).filter(i => i >= 0)
    for (const row of sheet.content.slice(1)) {
      if (state.settings.flightMode && archived.has(key,row)) continue
      const line = '纪要索引：' + indices.map(i => text(row[i])).join(' | ')
      if (size + line.length > Math.min(4000, state.settings.recallMaxChars / 3)) break
      parts.push(line); size += line.length + 1
    }
  }
  for (const candidate of candidates.slice(0, Math.max(1, Number(state.settings.recallMaxRows) || 30))) {
    const line = candidate.name + '：' + candidate.headers.map((header, index) => text(header) + '=' + text(candidate.row[index])).join('；')
    if (size + line.length > Math.max(200, Number(state.settings.recallMaxChars) || 12000)) continue
    parts.push(line); selected.push({ sheet: candidate.key, rowId: candidate.rowId, score: candidate.score }); size += line.length + 1
  }
  const companion = state.companion
  if (companion) {
    const activeSkills = Object.entries(companion.skills || {}).filter(([, skill]) => skill.active).map(([id]) => { const split = id.lastIndexOf(':'); const sheet = state.data[id.slice(0, split)], row = sheet?.content.find((r, i) => i > 0 && String(r[0]) === id.slice(split + 1)); return row ? String(row[1]) : '' }).filter(Boolean)
    const notes = [companion.walletConfirmed ? '当前游戏余额=' + companion.wallet : '', companion.skillPointsConfirmed ? '可用技能点=' + companion.skillPoints : '', activeSkills.length ? '已激活技能=' + activeSkills.join('、') : ''].filter(Boolean).join('；')
    if (notes && size + notes.length <= Math.max(200, Number(state.settings.recallMaxChars) || 12000)) parts.push('状态栏确认的状态：' + notes)
  }
  return { text: parts.length ? '数据库记忆（已记录的剧情事实）：\n' + parts.join('\n') : '', rows: selected }
}

function bodyKey(chat) {
  const messages = (chat.messages || []).filter(message => message.role === 'assistant')
  const message = messages.at(-1)
  return message ? createHash('sha256').update(JSON.stringify([chat.timeline?.branchId, message.turn, message.sourceText || message.text])).digest('hex') : ''
}

function saveSnapshot(state, name, chat, coalescingKey, purpose = coalescingKey ? 'floor' : 'automatic') {
  if (coalescingKey && (state.snapshots || []).some(row => row.coalescingKey === coalescingKey)) return
  state.snapshots = retainSpRecoverySnapshots((state.snapshots || []).concat([{ id: randomUUID(), name, at: Date.now(), purpose, ...(coalescingKey ? {coalescingKey} : {}), isolation:state.isolationCode||"main", turn: chat.messages?.at(-1)?.turn || 0,
    data: clone(state.data), locks: clone(state.locks), template:clone(state.template||null), fillProgress:clone(state.fillProgress||{}), selectedTables:clone(state.settings.selectedTables), templateData:clone(state.templateData||null),guideData:clone(state.guideData||null),companion:clone(state.companion||null),settings:clone(state.settings),dormant:clone(state.dormant||null),layerRecords:clone(state.layerRecords||null) }]))
  const floorTurns=(chat.messages||[]).filter(m=>m.role==='assistant'&&!m.greeting).map(m=>m.turn),cutoff=floorTurns.at(-(state.retentionFloors||100));if(cutoff!==undefined)state.snapshots=state.snapshots.filter(item=>item.purpose!=='floor'||item.turn>=cutoff)
}
// R8 Z81: a one-off `no such table` from the original package carried only the
// SQLite reason. Keep that reason first, then the statement (bounded) and, for a
// missing table, the table names this host built from the stored DDL.
function originalSqlFailure(error,sql,data){
  const text=String(sql||'').replace(/\s+/g,' ').trim(),shown=text.length>240?text.slice(0,240)+'…':text
  let tables=''
  if(/no such table/i.test(String(error?.message||'')))try{tables='；可用表：'+spSqlSchema(data).map(table=>table.name).join('、')}catch{}
  // dshSqlRejected: the statement itself failed while only a new value was being
  // computed, so nothing changed on either side (R8 Z85).
  return Object.assign(new Error(String(error?.message||error)+'（SQL：'+shown+tables+'）',{cause:error}),error?.code?{code:error.code}:{},{dshSqlRejected:true})
}

export function createSpDatabase({ chats, generate, books, loadLayer, sqlLimits={},syncWorldbook=async()=>{}, publish = () => {}, now = Date.now, jobTimeoutMs = 600000 }) {
  function deadline(controller) { return setTimeout(() => controller.abort(new Error('数据库模型任务超时，请重试')), jobTimeoutMs) }
  async function generateBounded(request) {
    request.signal.throwIfAborted()
    let abort
    try {
      return await Promise.race([Promise.resolve().then(() => generate(request)), new Promise((_, reject) => {
        abort = () => reject(request.signal.reason); request.signal.addEventListener('abort', abort, {once:true}); if(request.signal.aborted)abort()
      })])
    } finally { request.signal.removeEventListener('abort', abort) }
  }
  const jobs = new Map()
  const inspirationJobs = new Map()
  const plotJobs = new Map(), plotActivities = new Map()
  async function resolve(sessionId) {
    const chat = await chats.forSession(sessionId)
    if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先进入一局游玩对话。')
    return chat
  }
  const progressTimes=new Map(),progressTimers=new Map();let signalRevision=0
  function notify(chat,progress=false){
    const elapsed=now()-(progressTimes.get(chat.id)??-Infinity)
    if(progress && elapsed<250){
      if(!progressTimers.has(chat.id)){
        const timer=setTimeout(()=>{progressTimers.delete(chat.id);notify(chat)},250-elapsed);timer.unref?.();progressTimers.set(chat.id,timer)
      }
      return
    }
    clearTimeout(progressTimers.get(chat.id));progressTimers.delete(chat.id)
    progressTimes.set(chat.id,now());if(progressTimes.size>128)progressTimes.delete(progressTimes.keys().next().value)
    publish(chat.sessionId,{kind:'tavern-state',version:'sp:'+now()+':'+(++signalRevision)})
  }
  async function read(sessionId) {
    const chat = await resolve(sessionId)
    const state = databaseState(chat)
    if (state.activity?.status === 'running' && !jobs.has(chat.id)) state.activity = { ...state.activity, status: 'interrupted', error: '填表任务已中断，可以重试。' }
    if (state.inspiration?.status === 'running' && !inspirationJobs.has(chat.id)) state.inspiration = { ...state.inspiration, status: 'interrupted', error: '灵感任务已中断，可以重试。' }
    if (jobs.get(chat.id)?.streamText && state.activity?.status === 'running') state.activity = { ...state.activity, streamText: jobs.get(chat.id).streamText.slice(-24000) }
    state.plotActivity = plotActivities.get(chat.id) || null
    if (state.maintenance?.status === 'running' && !jobs.has(chat.id)) state.maintenance = { ...state.maintenance, status: 'interrupted' }
    if (jobs.get(chat.id)?.maintenance) state.maintenance = jobs.get(chat.id).activity
    if (state.vectorIndex) state.vectorIndex = { builtAt: state.vectorIndex.builtAt, count: state.vectorIndex.count ?? state.vectorIndex.documents?.length ?? 0 }
    state.summaryArchives = (state.summaryArchives || []).map(({ sheet, at }) => ({ sheet, at }))
    state.basis = { database: state.revision, branch: chat.timeline?.branchId || '', story: Number(chat.timeline?.revision) || 0 }
    state.management=spDataManagement(chat,state)
    delete state.layerRecords;delete state.isolationSpaces;delete state.dormant
    state.snapshots = (state.snapshots || []).filter(s=>(s.isolation||"main")===(state.isolationCode||"main")).map(({ data, locks, fillProgress, templateData,guideData,settings,dormant,layerRecords, ...metadata }) => metadata)
    return state
  }
  // A proof for one unapplied, old request. It is read-only and must be checked
  // again through the authenticated prepare RPC, never used to replay the write.
  function originalMutationBasis(chat,state) {
    const authority=chat.spAuthority,lifecycle=Number(chat.tavernHelperLifecycleRevision)||0
    if(authority?.owner!=='original'||authority.phase!=='ready'||authority.lifecycle!==lifecycle||!Number.isSafeInteger(lifecycle)||lifecycle<0||!Number.isSafeInteger(authority.revision)||authority.revision<0||!Number.isSafeInteger(state.revision)||state.revision<0)throw Error('表格已变化，请刷新后重试')
    return {chatId:chat.id,database:state.revision,branch:chat.timeline?.branchId||'',story:Number(chat.timeline?.revision)||0,authority:authority.revision,lifecycle,cacheStamp:authority.cacheStamp,isolationCode:state.isolationCode??null}
  }
  async function prepareMutation(sessionId,command,expectedRevision,original,{originalAuthority=false}={}) {
    const chat=await resolve(sessionId),state=databaseState(chat)
    const revision=object(expectedRevision)?expectedRevision.database:expectedRevision
    const sameStory=!object(expectedRevision)||((chat.timeline?.branchId||'')===expectedRevision.branch&&(Number(chat.timeline?.revision)||0)===expectedRevision.story)
    const sameTables=isDeepStrictEqual(publicSpTables(state.data),publicSpTables(original))
    const validation=originalAuthority&&command?.kind==='validate-unapplied'
    const oldRequest=originalAuthority&&!validation&&['sql','operations','replace'].includes(command?.kind)&&Number.isSafeInteger(revision)&&revision>=0&&Number.isSafeInteger(state.revision)&&revision<state.revision&&sameStory&&sameTables
    if(!sameStory||!sameTables||(state.revision!==revision&&!oldRequest))throw Error('表格已变化，请刷新后重试')
    if(jobs.has(chat.id)||plotJobs.has(chat.id))throw Error('数据库任务正在执行，请等待完成')
    if(Object.values(chat.timeline?.operations||{}).some(op=>op.kind==='body'&&op.status==='running'))throw Error('正在生成正文，请等正文完成后再修改数据库。')
    if(validation){
      const basis=originalMutationBasis(chat,state)
      if(!isDeepStrictEqual(basis,command.basis))throw Error('表格已变化，请刷新后重试')
      return {validated:true,basis}
    }
    if(oldRequest)return {rejected:{code:'stale-database-unapplied',message:'表格已变化，请刷新后重试'},basis:originalMutationBasis(chat,state)}
    let data,changes
    if(command.kind==='operations')data=applyTableOperations(state.data,command.operations)
    else if(command.kind==='replace')data=validateTableData(command.data)
    else if(command.kind==='sql'){
      let result
      try{result=await runSpSql(state.data,command.sql,{...sqlLimits,mutate:true,parameters:command.parameters||[]})}
      catch(error){throw originalSqlFailure(error,command.sql,state.data)}
      data=validateTableData(result.data);changes=result.changes
    }
    else throw Error('原版数据库不支持此写入命令')
    // This only computes the new value. The original extension commits it and
    // notifies the existing mirror path; the host never creates a second writer.
    return {data,changes}
  }
  // R8 Z85: a script's failing statement is that script's error. Report it as a
  // result so the original bridge stays writable. Z99 also returns a narrowly
  // classified old request; its bridge must validate the fresh basis first.
  async function prepareOriginalMutation(sessionId,command,expectedRevision,original) {
    try{return await prepareMutation(sessionId,command,expectedRevision,original,{originalAuthority:true})}
    catch(error){if(error?.dshSqlRejected===true)return {rejected:{message:String(error.message)}};throw error}
  }
  async function update(sessionId, command, expectedRevision) {
    let changes,changed=false
    const chat = await resolve(sessionId)
    const saved = await chats.update(chat.id, async current => {
      const state = databaseState(current)
      if (object(expectedRevision)) {
        if (state.revision !== expectedRevision.database || (current.timeline?.branchId || '') !== expectedRevision.branch || (Number(current.timeline?.revision) || 0) !== expectedRevision.story) throw new Error('剧情或表格已变化，请刷新后重试。')
      } else if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new Error('表格已被其他操作更新，请刷新后重试。')
      if (jobs.has(chat.id)) throw new Error('正在填表，请先停止填表再修改。')
      if (plotJobs.has(chat.id)) throw new Error('正在召回与推进，请先停止再修改。')
      if (command.expectedHelperLifecycleRevision !== undefined && Number(current.tavernHelperLifecycleRevision || 0) !== Number(command.expectedHelperLifecycleRevision)) throw new Error('脚本生命周期已变化，写入已取消')
      if (Object.values(current.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) throw new Error('正在生成正文，请等正文完成后再修改数据库。')
      if (command.kind === 'operations') {
        const data=applyTableOperations(state.data, command.operations, state.locks)
        if(isDeepStrictEqual(state.data,data))return undefined
        saveSnapshot(state, '编辑前备份', current)
        state.data = data
      }
      else if (command.kind === 'sql') {
        const result = await runSpSql(state.data, command.sql, { ...sqlLimits,mutate: true, parameters: command.parameters || [] })
        validateTableData(result.data); assertTableLocks(state.data, result.data, state.locks)
        changes=result.changes
        if(isDeepStrictEqual(state.data,result.data))return undefined
        saveSnapshot(state, 'SQL 修改前备份', current)
        state.data = result.data
        changes = result.changes
      } else if (command.kind === 'replace') {
        const data = validateTableData(command.data)
        if(isDeepStrictEqual(state.data,data))return undefined
        const pending = current.tavernPluginMetadata?.dsh_original_extensions?.['sp-database']?.synchronization?.pending
        const mirror = command.source === 'sp-mirror' && ['to-host','resolve-original'].includes(pending?.direction) && isDeepStrictEqual(pending.host, state.data) && isDeepStrictEqual(pending.original, data)
        // SP does not round-trip the host allocator. Preserve it only after the
        // exact incoming mirror receipt has been verified, never from a stale
        // client projection or arbitrary nested _dsh fields.
        if(mirror)for(const key of sheetKeys(data))if(data[key]._dshLastRowId===undefined&&state.data[key]?._dshLastRowId!==undefined)data[key]._dshLastRowId=state.data[key]._dshLastRowId
        if(isDeepStrictEqual(state.data,data))return undefined
        if(!mirror)assertTableLocks(state.data,data,state.locks)
        const key = mirror ? createHash('sha256').update(JSON.stringify([bodyKey(current), state.isolationCode || 'main', current.tavernHelperLifecycleRevision || 0])).digest('hex') : undefined
        saveSnapshot(state, mirror ? '脚本镜像前备份' : '脚本编辑前备份', current, key)
        state.data = data
      } else if (command.kind === 'template') {
        const next=planSpTemplateChange(state.data,command.data,state.locks,command.mode);
        saveSnapshot(state,'切换模板前 · '+(state.template?.name||'本局表格'),current);captureSpDormant(state,next);
        state.data=next.data;state.templateData=clone(command.data);delete state.guideData;state.locks=next.locks;state.template={id:command.id||'',name:command.name||'导入模板',updatedAt:command.updatedAt||now(),appliedAt:now()};
        state.fillProgress=command.mode==='replace'?{}:Object.fromEntries(Object.entries(state.fillProgress||{}).filter(([key])=>next.mapping[key]).map(([key,value])=>[next.mapping[key],value]));
        if(state.companion?.config?.bindings)state.companion.config.bindings=Object.fromEntries(Object.entries(state.companion.config.bindings).map(([page,keys])=>[page,[...new Set(keys.map(key=>next.mapping[key]).filter(Boolean))]]));
        if(state.companion?.skills){
          const mapSkill=id=>{const split=id.lastIndexOf(':'),key=id.slice(0,split),row=id.slice(split+1),ids=next.rowIds[key]?.[row];return next.mapping[key]&&(!ids||ids.length===1)?next.mapping[key]+':'+(ids?.[0]||row):null};
          state.companion={...state.companion,skills:command.mode==='replace'?{}:Object.fromEntries(Object.entries(state.companion.skills).flatMap(([id,skill])=>{const key=mapSkill(id);if(!key)return [];const missing=(skill.prerequisites||[]).some(id=>!mapSkill(id));return [[key,{...skill,active:missing?false:skill.active,prerequisites:(skill.prerequisites||[]).map(id=>mapSkill(id)||id)}]]}))};
        }
        state.lastFilledBody='';delete state.vectorIndex;delete state.vectorPreview;delete state.plot;delete state.agentResult;
        state.settings.selectedTables=state.settings.selectedTables.map(k=>next.mapping[k]).filter(Boolean);
      } else if (command.kind === 'import') {
        const data = validateTableData(command.data)
        saveSnapshot(state, '导入前备份', current)
        state.data = data; state.locks = {}
      } else if (command.kind === 'locks') {
        const key = findSheet(state.data, command.sheet)
        const lock = command.value || {}
        state.locks[key] = { table: lock.table === true, rows: Array.isArray(lock.rows) ? lock.rows.map(String) : [],
          columns: Array.isArray(lock.columns) ? lock.columns.map(Number) : [], cells: Array.isArray(lock.cells) ? lock.cells.map(String) : [] }
      } else if (command.kind === 'settings') {
        const patch = command.patch || {}
        state.settings = normalizeDatabaseSettings({ ...state.settings, ...patch })
        if (state.settings.fillModel !== null && (!object(state.settings.fillModel) || !text(state.settings.fillModel.provider).trim() || !text(state.settings.fillModel.model).trim())) throw new Error('请选择有效的填表模型')
        if (state.settings.fillModel) state.settings.fillModel = { provider: text(state.settings.fillModel.provider).trim(), model: text(state.settings.fillModel.model).trim() }
        if (!['operations', 'sql'].includes(state.settings.generationFormat)) throw new Error('填表格式无效')
        if (!Number.isSafeInteger(state.settings.validationRetries) || state.settings.validationRetries < 0 || state.settings.validationRetries > 3) throw new Error('格式重试次数必须是 0 到 3 的整数')
        if (!Array.isArray(state.settings.selectedTables) || state.settings.selectedTables.some(key => !sheetKeys(state.data).includes(key))) throw new Error('选择的填表表格不存在')
        for (const key of ['contextTurns', 'updateFrequency', 'recallMaxChars', 'recallMaxRows']) {
          const value = Number(state.settings[key])
          if (!Number.isSafeInteger(value) || value < 1 || value > (key === 'recallMaxChars' ? 100000 : 1000)) throw new Error('配置数值无效：' + key)
        }
      } else if(command.kind==='checkpoint') {
        const checkpoint=parseSpCheckpoint(command.document);saveSnapshot(state,'导入 Checkpoint 前备份',current)
        state.data=clone(checkpoint.templateSnapshot.data);for(const key of sheetKeys(state.data)){const source=checkpoint.tableSnapshot[key];state.data[key]=source?clone(source):{...state.data[key],content:[state.data[key].content[0]]};const guide=checkpoint.guideSnapshot.data[key];for(const field of ['sourceData','updateConfig','exportConfig'])if(guide?.[field])state.data[key][field]=clone(guide[field])}
        state.templateData=clone(checkpoint.templateSnapshot.data);state.guideData=clone(checkpoint.guideSnapshot.data);state.template={id:'',name:checkpoint.templateSnapshot.presetName||'导入 Checkpoint',appliedAt:now()};state.locks={};state.fillProgress={};state.lastFilledBody='';state.settings.selectedTables=state.settings.selectedTables.filter(k=>sheetKeys(state.data).includes(k));delete state.vectorIndex;delete state.plot;delete state.agentResult
      } else if(command.kind==='retention'){
        if(!Number.isInteger(command.floors)||command.floors<1||command.floors>10000)throw new Error('保留楼层需为 1–10000 的整数');state.retentionFloors=command.floors
      } else if(command.kind==='isolation'){
        switchSpIsolation(state,current,command.code)
      } else if(command.kind==='wake-dormant'){
        saveSnapshot(state,'唤醒休眠数据前',current);wakeSpDormant(state,command.type,command.id)
      } else if(command.kind==='cleanup'){
        saveSnapshot(state,'清理前恢复点',current)
        const from=Number(command.from),to=Number(command.to)||(current.messages||[]).filter(m=>m.role==='assistant'&&!m.greeting).length
        const remaining=(state.layerRecords?.frames||[]).filter(f=>f.floor<from||f.floor>to).at(-1)
        if(remaining){const payload=state.layerRecords.checkpoints?.[remaining.hash];if(!payload||payload.spLayerArchive){if(!loadLayer)throw Error('楼层恢复读取器未连接');state.layerRecords.checkpoints||={};state.layerRecords.checkpoints[remaining.hash]=clone(await loadLayer(remaining.hash))}}
        cleanupSpFloors(state,current,from,to)
      } else if(command.kind==='reset-settings'){
        saveSnapshot(state,'恢复默认配置前备份',current);state.settings=normalizeDatabaseSettings({});state.settings.plotEnabled=false
      } else if (command.kind === 'snapshot') saveSnapshot(state, text(command.name).trim() || '手动快照', current, undefined, 'manual')
      else if (command.kind === 'restore') {
        const snapshot = state.snapshots.find(item => item.id === command.id && (item.isolation||"main")===(state.isolationCode||"main"))
        if (!snapshot) throw new Error('快照不存在')
        saveSnapshot(state, '恢复前备份', current)
        state.data = clone(snapshot.data);if(Object.hasOwn(snapshot,'companion'))state.companion=clone(snapshot.companion);state.dormant=clone(snapshot.dormant||{tables:{},columns:{}});state.layerRecords=clone(snapshot.layerRecords||null);state.templateData=clone(snapshot.templateData||null);state.guideData=clone(snapshot.guideData||null);if(snapshot.settings){const plotEnabled=state.settings.plotEnabled;state.settings=normalizeDatabaseSettings(snapshot.settings);state.settings.plotEnabled=plotEnabled;} state.locks = clone(snapshot.locks);state.template=clone(snapshot.template||null);state.fillProgress=clone(snapshot.fillProgress||{});state.lastFilledBody="";delete state.vectorIndex;delete state.vectorPreview;delete state.plot;delete state.agentResult;state.settings.selectedTables=(snapshot.selectedTables||state.settings.selectedTables).filter(k=>sheetKeys(state.data).includes(k))
      } else throw new Error('未知数据库操作')
      if(!['cleanup','isolation','settings','retention','reset-settings','snapshot'].includes(command.kind))stampSpFloor(state,current,command.kind)
      state.revision++
      state.logs = (state.logs || []).concat([{ at: now(), level: 'info', task: command.kind, message: '数据库配置或数据已保存' }]).slice(-200)
      current.spDatabase = state
      changed=true
      return current
    }, { source: 'sp-database.' + command.kind })
    if(changed)notify(saved || chat)
    const result = await read(sessionId)
    return changes === undefined ? result : { ...result, changes }
  }

  async function fill(sessionId, { automatic = false, expectedHelperLifecycleRevision } = {}) {
    function currentOwner(chat) {
      if (expectedHelperLifecycleRevision !== undefined && Number(chat.tavernHelperLifecycleRevision || 0) !== Number(expectedHelperLifecycleRevision)) throw new Error('脚本生命周期已变化，已丢弃过期填表结果。')
    }
    const chat = await resolve(sessionId)
    currentOwner(chat)
    if (jobs.has(chat.id)) {
      if (jobs.get(chat.id).maintenance) throw new Error('数据库维护任务正在运行，请等待完成后再填表')
      return await jobs.get(chat.id).promise
    }
    if (plotJobs.has(chat.id)) throw new Error('请等召回与推进完成后再填表')
    const state = databaseState(chat), key = bodyKey(chat)
    if (!key) throw new Error('当前没有可供填表的剧情')
    if (!state.settings.enabled) throw new Error('数据库已关闭')
    if (automatic && (!state.settings.autoFill || key === state.lastFilledBody)) return state
    const allFloors=fillFloors(chat);let turns=Math.max(0,allFloors.length-(automatic?state.settings.fill.skipLatest:0))
    if(automatic && (!turns || text(allFloors[turns-1]?.sourceText||allFloors[turns-1]?.text).length<state.settings.fill.minChars))return state
    let selected = (state.settings.fill.selectedNone?[]:state.settings.selectedTables?.length ? state.settings.selectedTables : sheetKeys(state.data)).filter(key => {
      if (!state.data[key]) return false
      const config = state.data[key].updateConfig || {}
      const configured = Number(config.updateFrequency ?? config.frequency ?? -1)
      const frequency = configured < 0 || !Number.isFinite(configured) ? state.settings.updateFrequency : configured
      const last = state.fillProgress?.[key]?.floor
      return !automatic || (config.enabled !== false && frequency > 0 && (last === undefined ? turns >= frequency : turns - last >= frequency))
    })
    const automaticPart=automatic&&selected.length?planManualFill(chat,state,'catch-up',{tables:selected,groupSize:state.settings.fill.batchSize})[0]:null
    if(automaticPart){selected=automaticPart.tables;turns=automaticPart.to}
    const tables = Object.fromEntries(sheetKeys(state.data).filter(key => selected.includes(key)).map(key => [key, state.data[key]]))
    if (!Object.keys(tables).length) { if (automatic) return await read(sessionId); throw new Error('没有选择可填的表格') }
    const controller = new AbortController()
    const job = { controller, promise: null }
    const timer = deadline(controller)
    jobs.set(chat.id, job)
    const basis = { branch: chat.timeline?.branchId, revision: chat.timeline?.revision, db: state.revision, key }
    job.promise = (async () => {
      let attempts = 0, lastResponse = ''
      try {
        await chats.update(chat.id, current => {
          currentOwner(current)
          const next = databaseState(current)
          if (next.revision !== basis.db || current.timeline?.branchId !== basis.branch || current.timeline?.revision !== basis.revision) throw new Error('剧情或表格已变化，请重试')
          next.activity = { status: 'running', startedAt: now() }; current.spDatabase = next; return current
        }, { source: 'sp-database.fill-start' })
        notify(chat)
        const firstFloor=automaticPart?.from??Math.max(1,turns-state.settings.contextTurns+1)
        const story = contextForFill(fillMessages(chat,firstFloor,turns), {...state.settings,contextTurns:Math.max(state.settings.contextTurns*2,1)})
        const worldbook=await fillReferenceText(chat,state.settings,books,{story})
        const sqlMode = state.settings.generationFormat === 'sql'
        const request = { sessionId, signal: controller.signal, temperature: 0.2, modelSelection: state.settings.fillModel || undefined,
          onDelta: state.settings.streamingEnabled ? delta => { const current = jobs.get(chat.id); if (current === job) { job.streamText = (job.streamText || '') + delta; notify(chat,true) } } : undefined,
          system: (sqlMode ? '你负责维护文字游戏数据库。根据已发生的剧情更新数据，不编造未知事实。只输出 SQLite INSERT、UPDATE、DELETE 语句，没有更新时只输出 -- 无更新。不得修改表定义或未选择的表。新增行省略 row_id 由数据库分配。\n表结构：\n' + spSqlSchema({ mate: {}, ...tables }).map(table => table.ddl).join(';\n') : '你负责维护文字游戏数据库。根据已发生的剧情和表格填写说明更新数据，不续写剧情、不编造未知事实。只输出 JSON：{"operations":[{"kind":"insert","sheet":"sheet_x","values":[null,"值"]},{"kind":"update","sheet":"sheet_x","rowId":1,"values":{"列名":"值"}}]}。可用操作为 insert、update、delete；不要更改表头、表定义或锁定数据。没有更新时输出空 operations。首列 row_id 的新行用 null 自动分配。JSON 字符串中的双引号和换行必须转义。\n') + text(state.settings.prompt),
          messages: fillPromptMessages(state.settings,{tables,locks:state.locks,story,worldbook})
        }
        let result, candidate, correction = []
        const retries = Math.min(3, Math.max(0, Number(state.settings.validationRetries) || 0))
        for (;;) {
          controller.signal.throwIfAborted()
          attempts++
          lastResponse = text(await generateBounded({ ...request, messages: request.messages.concat(correction) }))
          controller.signal.throwIfAborted()
          const raw = parseFillOutput(lastResponse,state.settings)
          try {
            result = sqlMode ? null : JSON.parse(raw)
            if (!sqlMode && (!object(result) || !Array.isArray(result.operations) || result.operations.some(op => !op || !['insert', 'update', 'delete'].includes(op.kind) || !selected.includes(op.sheet)))) throw new Error('填表结果含不允许的操作或未选择的表格')
            candidate = sqlMode ? (/^--[^\n]*$/.test(raw) ? state.data : (await runSpSql(state.data, raw, { ...sqlLimits,mutate: true, allowedSheets:selected, discardUnauthorizedTables:state.settings.fill.discardUnauthorizedSql })).data) : applyTableOperations(state.data, result.operations, state.locks)
            validateTableData(candidate); assertTableLocks(state.data, candidate, state.locks)
            if (sheetKeys(state.data).some(key => !selected.includes(key) && !isDeepStrictEqual(state.data[key], candidate[key]))) throw new Error('填表结果修改了未选择的表格')
            break
          } catch (error) {
            if (attempts > retries) throw new Error('填表结果未通过验证：' + error.message)
            // Retry only validation failures, with the unchanged data and story.
            // No attempted operation is committed before the whole result passes.
            await chats.update(chat.id, current => {
              currentOwner(current)
              const next = databaseState(current)
              if (current.timeline?.branchId !== basis.branch || current.timeline?.revision !== basis.revision || next.revision !== basis.db || bodyKey(current) !== basis.key) throw new Error('剧情或表格已变化，已停止填表重试。')
              controller.signal.throwIfAborted()
              next.activity = { status: 'running', attempt: attempts + 1, retrying: true, lastError: error.message, startedAt: now() }
              current.spDatabase = next; return current
            }, { source: 'sp-database.fill-retry' })
            notify(chat)
            correction = [
              { role: 'assistant', source: { kind: 'plugin', plugin: 'dsh-tavern' }, content: [{ type: 'text', text: lastResponse }] },
              { role: 'user', content: [{ type: 'text', text: '刚才的填表结果未通过验证：' + error.message + '。请完整输出修正后的' + (sqlMode ? ' SQL' : ' JSON') + '，保持原剧情事实、表格范围和锁定规则，不输出解释。' }] }
            ]
          }
        }
        await chats.update(chat.id, current => {
          currentOwner(current)
          controller.signal.throwIfAborted()
          const next = databaseState(current)
          if (current.timeline?.branchId !== basis.branch || current.timeline?.revision !== basis.revision || next.revision !== basis.db || bodyKey(current) !== basis.key) throw new Error('剧情或表格已变化，已丢弃过期填表结果。')
          saveSnapshot(next, '填表前备份', current)
          next.data = candidate
          next.revision++; next.lastFilledBody = key
          next.fillProgress ||= {}; for (const tableKey of selected) next.fillProgress[tableKey] = { floor: turns, at: now(), source: automatic ? 'auto' : 'manual' }
          stampSpFloor(next,current,'fill',turns)
          next.logs = (next.logs || []).concat([{ at: now(), level: 'info', task: 'fill', message: '填表完成，更新 ' + selected.length + ' 张表' }]).slice(-200)
          next.activity = { status: 'completed', finishedAt: now(), attempts, model: clone(state.settings.fillModel), changes: result ? result.operations.length : selected.filter(key => !isDeepStrictEqual(state.data[key], candidate[key])).length }
          current.spDatabase = next; return current
        }, { source: 'sp-database.fill-commit' })
        try{await syncWorldbook(sessionId)}catch{} // Fill remains committed; sync failure is visible and independently retryable.
      } catch (error) {
        await chats.update(chat.id, current => {
          if (current.timeline?.branchId !== basis.branch || current.timeline?.revision !== basis.revision) return current
          const next = databaseState(current)
          next.logs = (next.logs || []).concat([{ at: now(), level: controller.signal.aborted ? 'warning' : 'error', task: 'fill', message: error.message || text(error) }]).slice(-200)
          next.activity = { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message || text(error), finishedAt: now(), attempts, model: clone(state.settings.fillModel),
            ...(!controller.signal.aborted && lastResponse ? { rejectedOutput: lastResponse } : {}) }
          current.spDatabase = next; return current
        }, { source: 'sp-database.fill-failed' })
        if (!automatic && !controller.signal.aborted) throw error
      } finally {
        clearTimeout(timer)
        if (jobs.get(chat.id) === job) jobs.delete(chat.id)
        notify(chat)
      }
      return await read(sessionId)
    })()
    return await job.promise
  }


  async function inspire(sessionId, prompt) {
    const chat = await resolve(sessionId)
    if (!text(prompt).trim()) throw new Error('请填写灵感要求')
    if (inspirationJobs.has(chat.id)) throw new Error('正在生成灵感，请先停止或等待完成')
    const basis = { branch: chat.timeline?.branchId, revision: chat.timeline?.revision }
    const controller = new AbortController()
    const job = { controller }
    const timer = deadline(controller)
    inspirationJobs.set(chat.id, job)
    const belongs = current => current.timeline?.branchId === basis.branch && current.timeline?.revision === basis.revision
    try {
      await chats.update(chat.id, current => {
        if (!belongs(current)) throw new Error('剧情已变化，请重试')
        const state = databaseState(current)
        state.inspiration = { status: 'running', prompt: text(prompt), text: state.inspiration?.text || '', startedAt: now() }
        current.spDatabase = state; return current
      }, { source: 'sp-inspiration.start' })
      notify(chat)
      const result = await generateBounded({ sessionId, signal: controller.signal,
        system: '你为文字游戏提供剧情建议。根据已发生的剧情和数据库，给出可以选择的下一步。明确这些只是建议，不是已经发生的事实。',
        messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify({
          instruction: text(prompt), tables: databaseState(chat).data,
          story: (chat.messages || []).slice(-8).map(message => ({ role: message.role, text: message.projectionText || message.sourceText || message.text }))
        }) }] }] })
      controller.signal.throwIfAborted()
      await chats.update(chat.id, current => {
        if (!belongs(current)) throw new Error('剧情已变化，已丢弃过期灵感')
        const state = databaseState(current)
        state.inspiration = { status: 'completed', prompt: text(prompt), text: result, finishedAt: now() }
        current.spDatabase = state; return current
      }, { source: 'sp-inspiration.complete' })
    } catch (error) {
      await chats.update(chat.id, current => {
        if (!belongs(current)) return current
        const state = databaseState(current)
        state.inspiration = { ...state.inspiration, status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: now() }
        current.spDatabase = state; return current
      }, { source: 'sp-inspiration.failed' })
      if (!controller.signal.aborted) throw error
    } finally {
      clearTimeout(timer)
      if (inspirationJobs.get(chat.id) === job) inspirationJobs.delete(chat.id)
      notify(chat)
    }
    return await read(sessionId)
  }
  async function cancelInspiration(sessionId) {
    const chat = await resolve(sessionId), job = inspirationJobs.get(chat.id)
    job?.controller.abort(new Error('用户停止灵感生成'))
    return { cancelled: Boolean(job) }
  }

  async function cancel(sessionId) {
    const chat = await resolve(sessionId)
    const job = jobs.get(chat.id)
    if (job) job.controller.abort(new Error('用户停止填表'))
    return { cancelled: Boolean(job) }
  }
  async function beforeTurn(sessionId) {
    const chat = await resolve(sessionId)
    if (jobs.has(chat.id)) await jobs.get(chat.id).promise.catch(() => {})
  }
  function afterCommit(chat) {
    const state = databaseState(chat)
    const turns = (chat.messages || []).filter(message => message.role === 'assistant' && !message.greeting).length
    if (!state.settings.autoFill || !state.settings.enabled || !turns) return
    return fill(chat.sessionId, { automatic: true }).catch(() => {})
  }

  async function preparePlot({ chat, card, userText, worldBookContext = '', signal, operationId, force = false }) {
    const state = databaseState(chat)
    if (!state.settings.enabled || (!force && (!state.settings.plotEnabled || state.settings.flightMode))) return null
    if (operationId && state.plot?.operationId === operationId) return state.plot
    const original = await resolve(chat.sessionId)
    if (plotJobs.has(chat.id)) throw new Error('正在运行召回与推进，请先停止或等待完成')
    const basis = { branch: original.timeline?.branchId, story: original.timeline?.revision, db: databaseRevision(original), body: bodyKey(original) }
    const controller = new AbortController()
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), AbortSignal.timeout(600000)])
    const job = { controller, activity: { status: 'running', startedAt: now() } }
    plotJobs.set(chat.id, job); plotActivities.set(chat.id, job.activity); notify(chat)
    try {
      const result = await executeSpPlot({ chat, state, card, userText, worldBookContext, memory: databaseRecall(chat, userText).text,
        generate, signal: combined, progress(activity) { job.activity = { ...activity, status: 'running', startedAt: job.activity.startedAt }; plotActivities.set(chat.id, job.activity); notify(chat,true) } })
      combined.throwIfAborted()
      const latest = await resolve(chat.sessionId)
      if (latest.timeline?.branchId !== basis.branch || latest.timeline?.revision !== basis.story || databaseState(latest).revision !== basis.db || bodyKey(latest) !== basis.body) throw new Error('剧情或数据库已变化，已丢弃过期推进结果')
      const completed = { ...result, operationId: operationId || null, userText: text(userText) }
      plotActivities.set(chat.id, { status: 'completed', finishedAt: now() })
      if (!force) { chat.spDatabase ||= state; chat.spDatabase.plot = completed }
      return completed
    } catch (error) {
      plotActivities.set(chat.id, { status: combined.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: now() })
      throw error
    } finally { if (plotJobs.get(chat.id) === job) plotJobs.delete(chat.id); notify(chat) }
  }
  async function previewPlot(sessionId, userText, card) {
    const chat = await resolve(sessionId)
    if (jobs.has(chat.id) || Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) throw new Error('请等填表或正文生成完成')
    const basis = { branch: chat.timeline?.branchId, story: chat.timeline?.revision, db: databaseRevision(chat) }
    const result = await preparePlot({ chat, card, userText, worldBookContext: chat.preparedWorldBookContext || '', force: true })
    await chats.update(chat.id, current => {
      const state = databaseState(current)
      if (current.timeline?.branchId !== basis.branch || current.timeline?.revision !== basis.story || state.revision !== basis.db) throw new Error('剧情或数据库已变化，已丢弃过期推进结果')
      state.plotPreview = result; current.spDatabase = state; return current
    }, { source: 'sp-plot.preview' })
    notify(chat)
    return await read(sessionId)
  }
  async function cancelPlot(sessionId) { const chat = await resolve(sessionId), job = plotJobs.get(chat.id); job?.controller.abort(new Error('用户停止召回与推进')); return { cancelled: Boolean(job) } }

  async function query(sessionId, sql, parameters) {
    const state = databaseState(await resolve(sessionId))
    return await runSpSql(state.data, sql, { ...sqlLimits,parameters: parameters || [] })
  }
  async function maintenance(sessionId, kind, execute, options = {}) {
    const chat = await resolve(sessionId), state = databaseState(chat)
    const baseline = clone(state)
    if (jobs.has(chat.id) || plotJobs.has(chat.id)) throw new Error('数据库任务正在运行，请先停止或等待完成')
    if (Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running')) throw new Error('请等正文生成完成')
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(1800000)])
    signal.throwIfAborted()
    const basis = [chat.timeline?.branchId, chat.timeline?.revision, state.revision]
    const belongs = current => JSON.stringify([current.timeline?.branchId, current.timeline?.revision, databaseRevision(current)]) === JSON.stringify(basis)
    const job = { maintenance: true, controller, activity: { status: 'running', kind, startedAt: now() } }
    jobs.set(chat.id, job)
    job.promise = (async () => {
      try {
        await chats.update(chat.id, current => {
          if (!belongs(current)) throw new Error('剧情或数据库已变化，请重试维护任务')
          const next=databaseState(current);next.maintenance={...job.activity};current.spDatabase=next;return current
        }, {source:'sp-advanced.start'})
        notify(chat)
        signal.throwIfAborted()
        const output = await execute({ chat, state, signal, progress(value) {
          signal.throwIfAborted()
          job.activity = typeof value === 'string' ? { ...job.activity, text: ((job.activity.text || '') + value).slice(-24000) } : { ...job.activity, ...value }; notify(chat,true)
        } })
        signal.throwIfAborted()
        await chats.update(chat.id, current => {
          if (!belongs(current)) throw new Error('剧情或数据库已变化，已丢弃过期任务结果')
          signal.throwIfAborted()
          const previous=databaseState(current)
          const next = mergeConcurrentFields(baseline, previous, output.state || state, chat.id)
          validateTableData(next.data); assertTableLocks(previous.data, next.data, next.locks)
          const changed=['data','locks','template','templateData','guideData','fillProgress','settings','dormant','companion','summaryArchives','isolationCode'].some(key=>!isDeepStrictEqual(previous[key],next[key]));
          if(changed){saveSnapshot(previous,kind+' 前备份',current);next.snapshots=previous.snapshots;if(!['manual-fill','catch-up'].includes(kind))stampSpFloor(next,current,kind);next.revision++}
          else next.revision=previous.revision
          next.maintenance = { status: 'completed', kind, result: output.result, finishedAt: now() }
          next.logs = (next.logs || []).concat([{ at: now(), level: 'info', task: kind, message: '任务完成' }]).slice(-200)
          current.spDatabase = next
          if (output.chatPatch?.presetControls) current.presetControls = output.chatPatch.presetControls
          return current
        }, { source: 'sp-advanced.' + kind })
      } catch (error) {
        await chats.update(chat.id, current => {
          if (!belongs(current)) return current
          const next = databaseState(current)
          next.maintenance = { status: signal.aborted ? 'cancelled' : 'failed', kind, error: error.message, finishedAt: now(), ...(!signal.aborted && error.rejectedOutput ? { rejectedOutput: error.rejectedOutput } : {}) }
          next.logs = (next.logs || []).concat([{ at: now(), level: signal.aborted ? 'warning' : 'error', task: kind, message: error.message }]).slice(-200)
          current.spDatabase = next; return current
        }, { source: 'sp-advanced.failed' })
        if (!signal.aborted) throw error
      } finally { if (jobs.get(chat.id) === job) jobs.delete(chat.id); notify(chat) }
      try{await syncWorldbook(sessionId)}catch{}
      return await read(sessionId)
    })()
    return await job.promise
  }
  return { isActive: id => jobs.has(id) || inspirationJobs.has(id) || plotJobs.has(id), taskStatus: id => jobs.get(id)?.activity || null, maintenance, read, prepareMutation, prepareOriginalMutation, update, fill, cancel, beforeTurn, afterCommit, query, inspire, cancelInspiration, preparePlot, previewPlot, cancelPlot, plotStatus: id => plotActivities.get(id) || null }
}
