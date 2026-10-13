import { worldbookContentDigest } from './worldbook-version.js'
import { createHash } from 'node:crypto'
import { constantWorldBookContext } from './worldbook-recall.js'
import { sanitizeAgentProjectionText } from './runtime-content-projection.js'
import { immutableJsonSnapshot, mutableJsonDraft } from './json-draft.js'
import { defaultUserPreferenceProfile } from './user-preference-profile.js'

export function cardContentDigest(card) { return createHash('sha256').update(JSON.stringify(card ?? null)).digest('hex') }

const VERSION = 7
function str(value) { return value === undefined || value === null ? '' : String(value) }
function usesFixedContext(chat) { return chat && (!chat.mode || ['story', 'script', 'card'].includes(chat.mode)) }
function cardAgent(chat) { return chat.mode === 'card' && chat.cardEditContext?.version !== 1 }

/** Owns snapshot preparation, migration, persistence and concurrent build sharing. */
export function createPlayCardSnapshots({ worldBooks, planner, readCard, writeChat, captureSceneWorldbook, userPreferenceProfile, readCardScripts = async()=>[], logger = console }) {
  const pending = new Map()

  async function constantContext(chat, card) {
    try { return constantWorldBookContext({ worldBook: await worldBooks.bound(chat.cardPath, card, chat) }).context }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    return ''
  }

  async function build(chat, card, preservePreferences = false, resolvedWorldBook) {
    if (cardAgent(chat)) {
      let reference = ''
      if (chat.cardReferenceContext?.version === 1 && card) {
        const context = await constantContext(chat, card)
        reference = (await planner.plan({ purpose: 'card-reference-snapshot', card, chat, worldBookContext: context, worldBookLabel: '常驻世界书' })).text
      }
      const preference = chat.userProfileEnabled === true && userPreferenceProfile
        ? await userPreferenceProfile.stableContext(chat.userProfileId || 'default') : null
      // Workbench references are text only. No play digests, binding stamp,
      // definition snapshot, script snapshot or scene-opening capture.
      return {
        cardContextSnapshot: sanitizeAgentProjectionText([preference?.text, reference].filter(Boolean).join('\n\n')),
        cardContextSnapshotVersion: VERSION,
        userProfileId: preference?.profileId || chat.userProfileId || 'default',
        userProfileEnabled: chat.userProfileEnabled === true,
        userProfileManagementId: chat.userProfileManagementId || chat.userProfileId || 'default',
        userProfileRevision: preference?.revision || 0,
        userProfileContextSnapshot: preference?.text || ''
      }
    }
    let worldBook = resolvedWorldBook ?? null
    try { if (resolvedWorldBook === undefined) worldBook = await worldBooks.bound(chat.cardPath, card, chat) }
    catch (error) { logger.warn('dsh-tavern: 常驻世界书读取失败，已跳过:', str(error && error.message || error)) }
    const worldBookContext = constantWorldBookContext({ worldBook }).context
    const planned = sanitizeAgentProjectionText((await planner.plan({ purpose: 'play-card-snapshot', card, chat, worldBookContext, worldBookLabel: '常驻世界书' })).text)
    let preference = null
    if (preservePreferences) {
      if (chat.userProfileContextSnapshot) preference = { text: chat.userProfileContextSnapshot, revision: chat.userProfileRevision, profileId: chat.userProfileId }
    } else if (chat.userProfileEnabled === true && userPreferenceProfile) {
      preference = await userPreferenceProfile.stableContext(chat.userProfileId || 'default')
    }
    const text = preference === null ? planned : sanitizeAgentProjectionText([preference.text, planned].filter(Boolean).join('\n\n'))
    const patch = {
      ...(worldBooks.bindingStamp?{helperWorldbookBindingsStamp:await worldBooks.bindingStamp(chat)}:{}),
      cardContextSnapshot: text,
      cardContentDigest: cardContentDigest(card),
      cardScriptsDigest: cardContentDigest(await readCardScripts(chat)),
      worldbookLibraryDigest: worldbookContentDigest(worldBook),
      cardContextSnapshotVersion: VERSION,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference === null ? 0 : preference.revision,
      userProfileContextSnapshot: preference === null ? '' : preference.text
    }
    // Only new, unpublished openings: migration cannot manufacture their past.
    if (!(chat.messages || []).length && typeof captureSceneWorldbook === 'function') {
      patch.sceneOpeningWorldbook = await captureSceneWorldbook(chat, card, worldBook)
    }
    return patch
  }

  // A new chat is not published yet; preparation must not create a partial save.
  async function prepare(chat, card) {
    if (!usesFixedContext(chat)) return ''
    const patch = await build(chat, cardAgent(chat) && chat.cardReferenceContext?.version !== 1 ? null : card === undefined ? await readCard(chat) : card)
    Object.assign(chat, patch)
    return patch.cardContextSnapshot
  }

  async function ensure(chat, card) {
    if (!usesFixedContext(chat)) return ''
    const key = chat.id || chat
    if (pending.has(key)) {
      const patch = await pending.get(key)
      // Other readers keep their own storage revision for optimistic merging.
      Object.assign(chat, patch)
      return patch.cardContextSnapshot
    }
    const operation = (async function () {
      const existing = str(chat.cardContextSnapshot)
      let patch, source
      if ((existing !== '' || cardAgent(chat)) && Number(chat.cardContextSnapshotVersion) >= VERSION && (cardAgent(chat) || !worldBooks.bindingStamp || chat.helperWorldbookBindingsStamp===await worldBooks.bindingStamp(chat))) {
        const sanitized = sanitizeAgentProjectionText(existing)
        patch = { cardContextSnapshot: sanitized, cardContextSnapshotVersion: chat.cardContextSnapshotVersion }
        if (sanitized === existing) return patch
        source = 'card-context.sanitize'
      } else {
        let preparation = chat
        if (cardAgent(chat)) {
          const profile = await defaultUserPreferenceProfile(userPreferenceProfile)
          preparation = { ...chat, userProfileEnabled: profile?.hasConfirmed === true && profile.defaultEnabled === true,
            userProfileId: profile?.profileId || 'default', userProfileManagementId: chat.userProfileManagementId || chat.userProfileId || 'default' }
        }
        patch = await build(preparation, cardAgent(chat) && chat.cardReferenceContext?.version !== 1 ? null : card === undefined ? await readCard(chat) : card)
        source = 'card-context.snapshot'
      }
      const draft = Object.assign({}, chat, patch)
      const saved = await writeChat(draft, { source })
      // Persistence may merge unrelated concurrent edits. The owner must adopt
      // that committed record before adopting its revision; waiters do not.
      const committed = saved && typeof saved === 'object' ? saved : draft
      for (const field of Object.keys(chat)) if (!Object.hasOwn(committed, field)) delete chat[field]
      Object.assign(chat, committed)
      return patch
    })()
    pending.set(key, operation)
    try { return (await operation).cardContextSnapshot }
    finally { if (pending.get(key) === operation) pending.delete(key) }
  }

  function bookSnapshot(record) {
    return { version: 2, libraryDigest: worldbookContentDigest(record), source: structuredClone(record?.source ?? null) }
  }

  async function liveBook(chat, card) {
    // Preserve the same isolated snapshot without materializing message, script
    // and preset branches that world-book resolution never touches.
    const liveChat = mutableJsonDraft(immutableJsonSnapshot(chat))
    if(worldBooks.migrateChat)await worldBooks.migrateChat(liveChat)
    delete liveChat.openingWorldbookSnapshot
    return worldBooks.bound(chat.cardPath, card, liveChat)
  }

  function updateDigest(card, snapshot, scriptsDigest) {
    return cardContentDigest({ card: cardContentDigest(card), worldbook: snapshot.libraryDigest, scripts:scriptsDigest })
  }

  async function updateStatus(chat, card) {
    const cardChanged = !chat.cardContentDigest || chat.cardContentDigest !== cardContentDigest(card)
    const base = { legacy: !chat.cardContentDigest, cardChanged }
    try {
      const snapshot = bookSnapshot(await liveBook(chat, card))
      const scriptsDigest=cardContentDigest(await readCardScripts(chat)),scriptsChanged=chat.cardScriptsDigest!==scriptsDigest
      const digest = updateDigest(card, snapshot, scriptsDigest)
      const previous = chat.worldbookLibraryDigest ?? chat.openingWorldbookSnapshot?.libraryDigest
      // Legacy snapshots may already contain local script writes. Without the
      // original resource version, only binding identity is reliable evidence.
      const worldbookChanged = previous ? previous !== snapshot.libraryDigest
        : worldbookContentDigest({ source: chat.openingWorldbookSnapshot?.source }) !== worldbookContentDigest({ source: snapshot.source })
      return { ...base, available: cardChanged || scriptsChanged || worldbookChanged || !previous, scriptsChanged, legacyWorldbook: !previous, worldbookChanged, digest }
    } catch (error) {
      // Missing/corrupt library resources must not prevent reading a saved game.
      return { ...base, available: true, worldbookChanged: true, digest: '', error: str(error?.message || error) }
    }
  }

  async function replacement(chat, card, expectedDigest) {
    // Explicit user consent replaces the live book snapshot as well as the card
    // prefix. Resolve without the old snapshot, and fail before publishing if
    // a binding is missing; never mark a partial refresh as successfully applied.
    const draft=structuredClone(chat);if(worldBooks.migrateChat)await worldBooks.migrateChat(draft)
    const worldBook = await liveBook(draft, card)
    const openingWorldbookSnapshot = bookSnapshot(worldBook)
    if (expectedDigest !== undefined && expectedDigest !== updateDigest(card, openingWorldbookSnapshot, cardContentDigest(await readCardScripts(chat)))) {
      throw new Error('人物卡或世界书已再次修改，请刷新后确认')
    }
    const patch = await build({ ...chat, openingWorldbookSnapshot }, card, true, worldBook)
    return { ...patch, ...(draft.worldbookState?{worldbookState:draft.worldbookState}:{}), openingWorldbookSnapshot, cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1 }
  }

  async function preferenceReplacement(chat, enabled, profileId) {
    if (!usesFixedContext(chat) || chat.mode === 'card') throw new Error('仅支持游玩会话')
    if (typeof enabled !== 'boolean') throw new Error('画像开关必须为布尔值')
    if ((chat.userProfileEnabled === true) === enabled && !profileId) return {}
    const preference = enabled ? await userPreferenceProfile?.stableContext(profileId || chat.userProfileId || 'default') : null
    if (enabled && !preference) throw new Error('请先建立并确认用户画像')
    let base = str(chat.cardContextSnapshot)
    if (!base) throw new Error('当前游戏缺少人物卡快照，请先恢复会话后重试')
    const previous = sanitizeAgentProjectionText(str(chat.userProfileContextSnapshot))
    if (previous) {
      if (base === previous) base = ''
      else if (base.startsWith(previous + '\n\n')) base = base.slice(previous.length + 2)
      else throw new Error('当前画像与提示词快照不一致，未修改游戏')
    }
    return {
      userProfileEnabled: enabled,
      userProfileId: preference?.profileId || chat.userProfileId || 'default',
      userProfileRevision: preference?.revision || 0,
      userProfileContextSnapshot: preference?.text || '',
      cardContextSnapshot: sanitizeAgentProjectionText([preference?.text, base].filter(Boolean).join('\n\n')),
      cardContextRevision: (Number(chat.cardContextRevision) || 0) + 1
    }
  }

  return Object.freeze({ prepare, ensure, constantContext, replacement, preferenceReplacement, updateStatus })
}
