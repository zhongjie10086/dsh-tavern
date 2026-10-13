function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeBackgroundModel(value) {
  if (value === null || value === undefined) return null
  const input = object(value)
  const provider = text(input.provider)
  const model = text(input.model)
  if (provider === '' || model === '') return null
  return { provider, model, ...(text(input.reasoningEffort) ? { reasoningEffort: text(input.reasoningEffort) } : {}) }
}

export function snapshotBackgroundModel(configured) {
  // Null means resolve the current foreground selection when each task starts.
  // Retain a legacy snapshot; later global revisions supersede it.
  return normalizeBackgroundModel(configured)
}

export function backgroundModelRevision(settings) {
  const revision = object(settings).backgroundModelRevision
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0
}

export function configuredBackgroundModel(settings) {
  const config = object(settings)
  return normalizeBackgroundModel(Object.hasOwn(config, 'defaultBackgroundModel') ? config.defaultBackgroundModel : config.backgroundModel)
}

export function configuredChatBackgroundModel(chat, settings) {
  const game = object(chat), revision = backgroundModelRevision(settings)
  // A later local choice lasts until the next global model/effort edit.
  if (revision && game.backgroundModelRevision !== revision) return configuredBackgroundModel(settings)
  return normalizeBackgroundModel(game.backgroundModelSelection)
}

export function resolveChatBackgroundModel(chat, fallback, settings) {
  return configuredChatBackgroundModel(chat, settings) || normalizeBackgroundModel(fallback)
}
