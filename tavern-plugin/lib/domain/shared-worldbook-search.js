import { WORLD_BOOK_SEARCH_TOOL } from './worldbook-search.js'

const TASKS = new Set(['candidate', 'settlement', 'character-design'])

/** Share the existing bound-worldbook service with eligible background tasks.
 * The owner always comes from the task, never its child Agent or model args. */
export function sharedWorldbookSearch(searchWorldbook) {
  return {
    tool: WORLD_BOOK_SEARCH_TOOL,
    allowed: input => TASKS.has(input?.task),
    async execute({ input, args }) {
      return JSON.stringify(await searchWorldbook(input.sessionId, args))
    }
  }
}
