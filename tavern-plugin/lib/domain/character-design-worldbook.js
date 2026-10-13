import { inspectWorldBookDocument, updateWorldBookDocument } from './worldbook-resource.js'
import { CHARACTER_DESIGN_PRESENTATION_FIELDS } from './character-design-document.js'

// Upstream 87c4b25a, adapted to the local private worldbook layer (user 2026-10-09): a saved
// character design becomes one keyword entry "人物设计 · 名字" in this game's private copy of the
// card's bound worldbook, recalled by the name or an alias and never constant. The generated
// entry is updated in place; a body the player edited is left alone (the design itself is still
// saved); keywords the player edited are kept. Publishing to the public worldbook stays manual.
const MARKER = 'characterDesign'
const str = value => typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))

export function characterDesignEntryContent(character) {
  const design = character.design || {}
  const aliases = (character.aliases || []).filter(Boolean)
  return ['人物：' + character.name + (aliases.length ? '（又名：' + aliases.join('、') + '）' : ''),
    ...CHARACTER_DESIGN_PRESENTATION_FIELDS.filter(([key]) => str(design[key]).trim()).map(([key, label]) => label + '：' + str(design[key]).trim())].join('\n\n')
}

/** Pure: the operation that brings one character's entry up to date, or why there is none. */
export function characterDesignEntryOperation(document, character) {
  const view = inspectWorldBookDocument(document)
  const matches = view.entries.filter(entry => entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.[MARKER]?.name === character.name)
  if (matches.length > 1) return { status: 'ambiguous', refs: matches.map(entry => entry.ref) }
  const existing = matches[0]
  const extra = existing?.rawEntry?.extensions?.dsh_tavern_helper_extra || {}
  const previous = extra[MARKER] || {}
  const content = characterDesignEntryContent(character)
  const keys = [...new Set([character.name, ...(character.aliases || []).filter(Boolean)])]
  if (existing && existing.content !== previous.content) return { status: 'kept-manual-edit', ref: existing.ref }
  // Only keywords the player has not touched follow the name and aliases.
  const followKeys = !existing || JSON.stringify(existing.primaryKeys) === JSON.stringify(previous.keys)
  if (existing && existing.content === content && (!followKeys || JSON.stringify(existing.primaryKeys) === JSON.stringify(keys))) return { status: 'unchanged', ref: existing.ref }
  const patch = { content, helperExtra: { ...extra, [MARKER]: { name: character.name, content, keys: followKeys ? keys : previous.keys } } }
  if (followKeys) patch.primaryKeys = keys
  if (existing) return { status: 'updated', ref: existing.ref, operation: { op: 'update', ref: existing.ref, patch } }
  return { status: 'added', operation: { op: 'add', entry: { ...patch, comment: '人物设计 · ' + character.name,
    enabled: true, constant: false, selective: true, vectorized: false, secondaryKeys: [],
    position: 1, order: 100, probability: 100, probabilityEnabled: false } } }
}

/** Runs inside the chat's own update, so the entry and the design are saved together. */
export async function writeCharacterDesignWorldbook({ worldBooks, chat, card, character }) {
  // A still-v1 opening snapshot would later rebuild the private books and drop this entry.
  await worldBooks.migrateChat(chat)
  const record = await worldBooks.boundCard(chat.cardPath, card, chat)
  if (!record) return { status: 'no-worldbook' }
  const planned = characterDesignEntryOperation(record.document, character)
  if (!planned.operation) return { status: planned.status, ...(planned.ref ? { ref: planned.ref } : {}) }
  await worldBooks.replaceForChat(chat, record, updateWorldBookDocument(record.document, { operations: [planned.operation] }).document)
  return { status: planned.status }
}

/** What the design tool tells the model about the worldbook side of a save. */
export function characterDesignWorldbookNote(result) {
  if (result.status === 'added' || result.status === 'updated') return '已写入本局世界书条目「人物设计 · 名字」，按姓名或别名召回'
  if (result.status === 'kept-manual-edit') return '本局世界书里该人物的条目正文已被玩家手动修改，已保留玩家的修改，未覆盖；不要重复保存或改名绕过'
  if (result.status === 'no-worldbook') return '本局人物卡没有绑定世界书，设计只存入人物档案'
  if (result.status === 'ambiguous') return '本局世界书里该人物有多个设计条目，未改动；请玩家整理后再保存'
  if (result.status === 'failed') return '写入本局世界书失败：' + str(result.error) + '；设计已存入人物档案'
  return ''
}
