import { boundedCompaction } from './bounded-compaction.js'
import { projectHelperSystemHistory } from './helper-system-history.js'
import { decodeTavernSource } from './session-message-source.js'

// Internal metadata-only events are persisted on the Session surface but are
// not user utterances. Native compaction replays that surface independently of
// the normal request projection, so omit them at this request boundary too.
export function projectCompactionRequest(request) {
  if (request?.purpose !== 'compaction' || !Array.isArray(request.messages)) return request
  const messages = request.messages.filter(message => {
    const source = decodeTavernSource(message?.source)
    return !(message?.role === 'user' &&
    Array.isArray(message.content) && message.content.length === 0 &&
    source?.kind === 'plugin' &&
    ['dsh-tavern', 'dsh-tavern-failed-turn-cleanup'].includes(source.plugin))
  })
  // Normalize authored system floors here too: the downstream foreground hook
  // must not redispatch a final compaction call as a fresh story preparation.
  return projectHelperSystemHistory(messages.length === request.messages.length ? request : { ...request, messages })
}

export function installCompactionRequestProjection(ctx, ownsSession, prepare = async request => ({ request }), onStream = () => {}) {
  const internal = new WeakSet()
  const stream = request => {
    internal.add(request)
    return ctx.llm.stream(request)
  }
  ctx.on('llm/stream', (request, next) => {
    if (internal.has(request) || request?.purpose !== 'compaction' || !request.sessionId) return next()
    return (async function * () {
      if (!(await ownsSession(request.sessionId))) { yield* next(); return }
      const projected = projectCompactionRequest(request)
      // One ownership boundary prepares the story once. Every final model call,
      // including merge/retry/segments, bypasses this hook's preparation.
      const dispatch = input => { onStream(input, request); return stream(input) }
      const summarize = input => boundedCompaction(ctx, input, dispatch)
      const prepared = await prepare(projected, summarize)
      yield* withCompactionBlocks(summarize(prepared.request), { ...prepared, signal: request.signal })
    })()
  })
}

// Story compaction keeps its latest rounds verbatim: after a successful summary, add them
// as their own text block (the native engine keeps every text block). (upstream 87b94a5b)
export async function* withCompactionAppendix(events, appendix) {
  yield* withCompactionBlocks(events, { appendix })
}

// Carried volumes and retained rounds land only with a complete text summary.
// Buffer before emitting the prefix: a late provider failure/abort must not leave
// an apparently successful old-volume prefix in the native checkpoint assembler.
export async function* withCompactionBlocks(events, { prefix = [], appendix, signal } = {}) {
  if (!prefix.length && !appendix) { yield* events; return }
  const chunks = []
  for await (const event of events) { signal?.throwIfAborted(); chunks.push(event) }
  signal?.throwIfAborted()
  const finish = chunks.findLast(event => event?.type === 'finish')
  const hasText = chunks.some(event => event?.type === 'block-end' && event.block?.type === 'text' && event.block.text?.trim())
  const hasTool = chunks.some(event => event?.type === 'block-end' && event.block?.type === 'tool-call')
  if (finish?.reason?.kind !== 'stop' || finish.reason.failure || !hasText || hasTool) { yield* chunks; return }
  for (const [index, text] of prefix.entries()) {
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'block-end', index, block: { type: 'text', text } }
  }
  let next = prefix.length
  for (const event of chunks) if (Number.isInteger(event?.index)) next = Math.max(next, event.index + prefix.length + 1)
  for (const event of chunks) {
    if (event === finish && appendix) {
      yield { type: 'block-start', index: next, blockType: 'text' }
      yield { type: 'block-end', index: next, block: { type: 'text', text: appendix } }
    }
    yield Number.isInteger(event?.index) ? { ...event, index: event.index + prefix.length } : event
  }
}
