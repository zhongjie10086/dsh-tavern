/** Character offsets match the existing card/preset readers: one based, inclusive. */
export function readToolPage(text, { offset = 1, limit = 6000 } = {}) {
  const start = Math.min(text.length, Number.isSafeInteger(offset) && offset > 0 ? offset - 1 : 0)
  const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 12000)) : 6000
  const chunk = text.slice(start, start + count)
  return { text: chunk, totalChars: text.length, from: chunk.length ? start + 1 : 0, to: chunk.length ? start + chunk.length : 0, done: start + chunk.length >= text.length }
}

export const TOOL_READ_PAGE_SCHEMA = Object.freeze({
  text: { type: 'string', required: true }, totalChars: { type: 'integer', required: true },
  from: { type: 'integer', required: true }, to: { type: 'integer', required: true }, done: { type: 'boolean', required: true }
})
