import {lstat, readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {decodePackedJson, CARD_MVU_PACKED_TAG} from '../tavern-plugin/lib/packed-json.js'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'

const fields = new Set(['id', '_storageRevision', 'tavernCardMvuContract', 'tavernHelperEventJournal'])
const knownStatuses = new Set(['unconfirmed', 'pending', 'running', 'completed', 'failed', 'discarded'])
const snapshotPattern = /^chats\/([^/]+)\/snapshots\/\d{12}\.json$/
const journalPattern = /^chats\/([^/]+)\/journals\/\d{12}-(?:open|\d{12})\.jsonl$/
const legacyPattern = /^chats\/([^/]+)\.json$/
const rollback = '禁止不支持 card-mvu-pending-v1 的旧程序直接打开含新合同历史的新版 Home，即使待办已经完成。先停止实例并另存新版完整 Home；如需回退，恢复匹配旧代码及升级前完整 Home 备份（含原生 Session、resource-versions、chat-resources、SP），按成对回退流程验证。此检查不降级、不清理、不处理待办。'

function project(value) {
  const chat = value?.$dshVersionedChat === 1 ? value.value : value
  if (Object.hasOwn(value || {}, '$dshVersionedChat') && value.$dshVersionedChat !== 1) throw Error('未知 Chat 资源合同')
  return Object.fromEntries(Object.entries(chat || {}).filter(([key]) => fields.has(key)))
}

// Keep this tool genuinely read-only. No maintenance, promotion, cleanup,
// resource decoding, model calls or write locks are used. The journal reader's
// read path only reconstructs these inline execution-contract fields.
export async function checkCardMvuRollback({dataRoot}={}) {
  if (typeof dataRoot !== 'string' || !dataRoot.trim()) throw Error('必须显式提供 dataRoot（CLI: --data-root）')
  const root = path.resolve(dataRoot)
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('dataRoot 必须是现有普通目录，不跟随链接')
  const report = {version:1, readOnly:true, dataRoot:root, pending:0, unknown:0, failed:0, completed:0, discarded:0, contractHistoryFiles:0, directOlderReaderAllowed:false, countsReliable:true, chats:[], issues:[], rollback}
  const ids = new Set(), history = new Set()
  async function inventory() {
    const result = new Map()
    async function visit(relative) {
      const target = path.join(root, relative)
      let item
      try { item = await lstat(target, {bigint:true}) } catch (error) { if (error.code === 'ENOENT') return; throw error }
      if (item.isSymbolicLink()) throw Error('检查范围含链接，未读取：'+relative)
      if (item.isDirectory()) {
        result.set(relative+'/', [item.mtimeNs, item.ctimeNs].join(':'))
        for (const name of (await readdir(target)).sort()) await visit(path.join(relative, name))
      } else if (item.isFile()) result.set(relative.replaceAll('\\','/'), [item.size, item.mtimeNs, item.ctimeNs, item.ino].join(':'))
      else throw Error('检查范围含非普通文件，未读取：'+relative)
    }
    await visit('chats')
    await visit('storage-format.json')
    return result
  }
  function issue(file, code) {
    report.unknown++
    report.countsReliable = false
    report.issues.push({file, code})
  }
  let before
  try { before = await inventory() } catch (error) {
    issue('chats', error.code || 'UNSAFE_PATH')
    return report
  }
  for (const relative of before.keys()) {
    const match = snapshotPattern.exec(relative) || journalPattern.exec(relative) || legacyPattern.exec(relative)
    if (!match) continue
    // Legacy backup names are historical evidence, not additional live chats.
    if (!relative.includes('.legacy-')) ids.add(match[1])
    try {
      const text = await readFile(path.join(root, relative), 'utf8')
      for (const line of relative.endsWith('.jsonl') ? text.split('\n').filter(value => value.trim()) : [text]) {
        const envelope = JSON.parse(line)
        if (envelope?.$dshPackedJson === CARD_MVU_PACKED_TAG) history.add(relative)
        const value = await decodePackedJson(envelope)
        const logical = value?.$dshVersionedChat === 1 ? value.value : value
        if (logical?.tavernCardMvuContract !== undefined || logical?.tavernHelperEventJournal?.some(row => row?.cardMvu !== undefined)) history.add(relative)
        // A new marker/row can also survive only in an old incremental file.
        if (Array.isArray(value?.changes) && value.changes.some(change => fields.has(change.path?.[0]) && ['tavernCardMvuContract','tavernHelperEventJournal'].includes(change.path[0]) || change.path?.length === 0 && (change.value?.tavernCardMvuContract !== undefined || change.value?.tavernHelperEventJournal?.some(row => row?.cardMvu !== undefined)))) {
          if (value.changes.some(change => change.path?.[0] === 'tavernCardMvuContract' || change.path?.includes('cardMvu') || JSON.stringify(change.value ?? change.items ?? '').includes('"cardMvu"'))) history.add(relative)
        }
      }
    } catch (error) { issue(relative, error.code || 'INVALID_STORAGE') }
  }
  const store = createChatJournalStore({dataRoot:root, logger:{warn(){}}, resourceCodec:{
    decodeChat:async value => project(value),
    decodeChanges:async changes => changes.filter(change => change.path.length === 0 || fields.has(change.path[0])).map(change => change.path.length === 0 && change.op === 'set' ? {...change, value:project(change.value)} : change)
  }})
  for (const id of [...ids].sort()) {
    const row = {chatId:id, pending:0, unknown:0, failed:0, completed:0, discarded:0}
    try {
      const value = await store.read(id)
      const entries = value?.tavernHelperEventJournal
      if (entries !== undefined && !Array.isArray(entries)) throw Error('待办记录不是数组')
      for (const entry of entries || []) {
        if (entry?.cardMvu === undefined) continue
        const work = entry.cardMvu
        if (!work || work.version !== 1 || !knownStatuses.has(work.status) || typeof work.coreId !== 'string' || !work.coreId || typeof work.sourceDigest !== 'string' || !work.sourceDigest) row.unknown++
        else if (['running','unconfirmed'].includes(work.status)) row.unknown++
        else row[work.status]++
      }
    } catch (error) { row.unknown++; report.countsReliable=false; report.issues.push({chatId:id, code:error.code || 'INVALID_CHAT'}) }
    report.chats.push(row)
    for (const key of ['pending','unknown','failed','completed','discarded']) report[key] += row[key]
  }
  try {
    if (JSON.stringify([...before]) !== JSON.stringify([...await inventory()])) issue('chats', 'CHANGED_DURING_READ')
  } catch (error) { issue('chats', error.code || 'CHANGED_DURING_READ') }
  report.contractHistoryFiles = history.size
  report.directOlderReaderAllowed = !history.size && report.unknown === 0 && report.pending === 0 && report.failed === 0
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2 || args[0] !== '--data-root' || !args[1] || args[1].startsWith('--')) throw Error('用法：node bin/check-card-mvu-rollback.mjs --data-root <显式数据目录>；请先停止实例，本工具只读')
    const report = await checkCardMvuRollback({dataRoot:args[1]})
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.directOlderReaderAllowed ? 0 : 2
  } catch (error) {
    console.error(String(error.message || error))
    process.exitCode = 1
  }
}
