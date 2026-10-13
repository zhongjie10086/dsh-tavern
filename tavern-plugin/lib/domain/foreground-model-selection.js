import { normalizeBackgroundModel } from './background-model-selection.js'

export function foregroundModelRevision(settings) {
  const revision = settings?.foregroundModelRevision
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0
}

export function createSettingsOperationQueue() {
  let tail = Promise.resolve()
  return { run(operation) { const result = tail.then(operation); tail = result.then(() => {}, () => {}); return result } }
}

/** Read native intent without resuming an Agent or changing its selection. */
export async function readForegroundModelSelection({ sessionId, session, persistence, sessions, projections, fallback = () => null }) {
  let handle
  try {
    if (!session && sessionId && persistence) {
      handle = await persistence.open(sessionId, 'read')
      const snapshot = await handle.read(0)
      session = sessions.prepare(sessionId, { seed: snapshot.events, meta: structuredClone(handle.header), eventState: snapshot.eventState })
    }
    if (session) {
      const state = projections.stateOf(session, 'modelSelection')
      return normalizeBackgroundModel(state?.pending) || normalizeBackgroundModel(session.requestHeader?.()?.config) || normalizeBackgroundModel(state?.lastUsed) || normalizeBackgroundModel(fallback())
    }
    return normalizeBackgroundModel(fallback())
  } catch (error) {
    if (error.name === 'SessionPersistenceNotFoundError') return normalizeBackgroundModel(fallback())
    throw error
  } finally { await handle?.close() }
}

/** Install global story choices before the host captures its assembly model. */
export function createForegroundModelSelection({ chats, settings, resolve, select, flush, serialize = (_agent, operation) => operation(), report = () => {} }) {
  const ownSelections = new WeakSet(), pending = new Map(), failures = new Map(), latestSelections = new Map()
  const playable = chat => chat && ['story','script'].includes(chat.mode || 'story')

  function observe(session, event) {
    if (event?.type !== 'model/selection' || ownSelections.has(session)) return
    // Capture immediately: a later global edit cannot relabel an earlier pick.
    const revision = foregroundModelRevision(settings())
    const selected = normalizeBackgroundModel(event.data)
    if (!selected) return
    const id = session.id
    const record = { revision, selected }
    latestSelections.set(id, record)
    const operation = (pending.get(id) || Promise.resolve()).then(async () => {
      const chat = await chats.forSession(id)
      if (!playable(chat)) { if (latestSelections.get(id) === record) latestSelections.delete(id); return }
      await chats.update(chat.id, current => {
        if (!playable(current) || current.sessionId !== id) return current
        return { ...current, foregroundModelRevision: revision }
      })
    })
    const tail = operation.then(() => failures.delete(id), error => {
      failures.set(id, error)
      report({ sessionId: id, stage: '记录本局正文模型', error })
    })
    pending.set(id, tail)
    void tail.then(() => { if (pending.get(id) === tail) pending.delete(id) })
  }

  async function settleLocalSelection(id) {
    let tail
    while ((tail = pending.get(id))) {
      await tail
      if (pending.get(id) === tail) break
    }
    if (failures.has(id)) throw new Error('本局正文模型选择未保存，请重新选择后重试', { cause: failures.get(id) })
  }

  async function effectiveSelection(chat, readNative) {
    const id = chat.sessionId
    await settleLocalSelection(id)
    const current = await chats.forSession(id) || chat
    await settleLocalSelection(id)
    const config = settings(), revision = foregroundModelRevision(config)
    const local = latestSelections.get(id)
    const currentRevision = local?.revision ?? current.foregroundModelRevision
    // Following the story model must not require starting or selecting a body task.
    if (playable(current) && revision && currentRevision !== revision) {
      const global = normalizeBackgroundModel(config?.defaultForegroundModel)
      if (global) return global
    }
    return normalizeBackgroundModel(await readNative()) || (local?.revision === revision ? local.selected : null)
  }

  async function synchronize(agent) {
    if (agent?.phase?.kind !== 'running' || agent.phase.step !== 0) return
    return serialize(agent, async () => {
      const session = agent.session, id = session.id
      await settleLocalSelection(id)
      const chat = await chats.forSession(id)
      // Capture after taking the host queue, so an earlier queued local pick or
      // settings save cannot be overwritten by a stale pre-queue revision.
      const config = settings(), revision = foregroundModelRevision(config)
      if (!playable(chat) || !revision || chat.foregroundModelRevision === revision) return
      const model = normalizeBackgroundModel(config?.defaultForegroundModel)
      if (model) {
        const resolved = normalizeBackgroundModel(await resolve(model))
        if (!resolved) throw new Error('正文模型配置无效')
        ownSelections.add(session)
        try { select(agent, resolved) } finally { ownSelections.delete(session) }
        // Do not mark the game current before the native selection is durable.
        await flush(session)
      }
      await chats.update(chat.id, current => {
        if (!playable(current) || current.sessionId !== id) return current
        return { ...current, foregroundModelRevision: revision }
      })
    })
  }
  return { observe, synchronize, effectiveSelection, forget: id => latestSelections.delete(id) }
}
