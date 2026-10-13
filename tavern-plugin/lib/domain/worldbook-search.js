import { isMvuUpdateEntry } from './worldbook-recall.js'

// Upstream 54fd7e1b: the story agent can look up the bound worldbook entries that keyword recall
// did not inject, instead of inventing names, places or sects. Search uses static text only and
// never runs templates. Local difference: reading an entry does not run its templates either (the
// local template projection cannot render single entries); such an entry returns its static text
// marked as such, and plain entries go through the usual macro projection.
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
const literal = value => String(value || '').replace(/<%[\s\S]*?%>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const titleOf = entry => String(entry.title || entry.comment || '')

export const WORLD_BOOK_SEARCH_TOOL = Object.freeze({
  name: 'worldbook_search',
  description: '按需查阅本局绑定的世界书，补查未自动注入的资料。缺少人物、地点、门派等具体设定时先查，不凭常识编造。传 query 返回标题和命中片段；确认相关后传 refs 读取普通条目的完整正文。动态模板不执行，只返回标记为 static 的静态部分。query 与 refs 二选一。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      query: { type: 'string', description: '简短查询词，例如“少林 入门”；搜索全部可用条目，不限自动召回候选' },
      refs: { type: 'array', items: { type: 'string' }, description: '搜索结果中的条目编号，最多 5 条；普通条目读取全文，动态模板只读取 static 静态部分' },
      offset: { type: 'integer', description: '搜索结果偏移，从 0 开始，默认 0' },
      limit: { type: 'integer', description: '搜索返回条数，1~10，默认 5' }
    })
  })
})

/** load(sessionId) -> { chat, card, worldBook }; project(context, text) -> agent text with macros. */
export function createWorldbookSearch({ load, project = (_context, text) => text }) {
  return async (sessionId, args = {}) => {
    const query = String(args.query || '').trim()
    const reading = args.refs !== undefined
    if (reading ? query || !Array.isArray(args.refs) || !args.refs.length || args.refs.length > 5 || args.refs.some(ref => typeof ref !== 'string' || !ref.trim()) : !query || query.length > 500) {
      throw new Error('请提供 1~500 字查询词，或 1~5 个条目编号；query 与 refs 二选一')
    }
    const offset = args.offset ?? 0, limit = args.limit ?? 5
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('offset 必须为非负整数，limit 必须为 1~10')
    const context = await load(sessionId)
    const entries = (context.worldBook?.view?.entries || []).filter(entry => entry.enabled !== false && !isMvuUpdateEntry(entry) && String(entry.content || '').trim())
    if (reading) {
      const refs = [...new Set(args.refs)]
      const selected = refs.map(ref => entries.find(entry => entry.ref === ref))
      if (selected.some(entry => !entry)) throw new Error('条目不存在、已禁用或不属于当前可查询世界书，请重新搜索')
      return { mode: 'read', total: selected.length, hasMore: false, entries: selected.map(entry => /<%/.test(entry.content)
        ? { ref: entry.ref, title: titleOf(entry), text: literal(entry.content), status: 'static', note: '该条目含动态模板，未执行模板，只给出静态部分' }
        : { ref: entry.ref, title: titleOf(entry), text: project(context, String(entry.content)), status: 'ok' }) }
    }
    const needle = normalize(query)
    const phrases = needle.split(/\s+/).filter(Boolean)
    const segmented = [...segmenter.segment(needle)].filter(part => part.isWordLike).map(part => part.segment)
    // Preserve explicit search phrases (武当 must not become 武 + 当).
    const words = [...new Set(phrases.length > 1 ? phrases : [needle, ...segmented.filter(word => word.length > 1)])]
    const matches = entries.flatMap((entry, index) => {
      const title = titleOf(entry), body = literal(entry.content)
      const heading = normalize(title), keys = normalize((entry.primaryKeys || []).join(' ')), text = normalize(body)
      const hits = words.filter(word => heading.includes(word) || keys.includes(word) || text.includes(word))
      if (!hits.length) return []
      const score = hits.length / words.length * 20 + (heading.includes(needle) ? 50 : 0) + hits.reduce((sum, word) => sum + (heading.includes(word) ? 100 : keys.includes(word) ? 20 : 0), 0)
      const position = Math.max(0, text.indexOf(hits.find(word => text.includes(word)) || ''))
      const start = Math.max(0, position - 60)
      return [{ ref: entry.ref, title, snippet: (start ? '…' : '') + body.slice(start, start + 300) + (body.length > start + 300 ? '…' : ''), matchedTerms: hits, template: /<%/.test(entry.content), score, index }]
    }).sort((a, b) => b.score - a.score || a.index - b.index)
    return { mode: 'search', total: matches.length, offset, hasMore: offset + limit < matches.length,
      entries: matches.slice(offset, offset + limit).map(({ score, index, ...entry }) => entry),
      message: '片段来自静态文本，动态生成内容可能无法命中；确认标题与片段相关后，用 refs 读取普通条目全文，动态模板仅返回 static 静态部分。' }
  }
}
