import {projectPrivateWorldbook,storePrivateWorldbook,storeMergedPrivateWorldbook,privateWorldbookState,worldbookSourceKey,mergePrivateWorldbooks,createPrivateWorldbook} from './private-worldbooks.js'
import { filterSpWorldbookOwner,removeSpWorldbookMirror } from './sp-fill-worldbook.js'
import { mergeWorldBooks } from './worldbook-merge.js'
import { exportCharacterBook, exportSillyTavernWorldBook, inspectWorldBookDocument, prepareWorldBookImport, updateWorldBookDocument } from './worldbook-resource.js'
import {createDependencyProjectionCache} from './dependency-projection-cache.js'
import { createVersionedJsonCache } from './versioned-json-cache.js'
import { finishJsonDraft, mutableJsonDraft } from './json-draft.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function embeddedDocument(card) {
  return card && card.character_book && typeof card.character_book === 'object'
    ? card.character_book
    : { name: str(card && card.name) + '世界书', entries: [], extensions: {} }
}

/**
 * Owns world-book identity, storage adapters and card binding semantics.
 * Callers never branch on embedded versus standalone persistence.
 */
export function createWorldBookLibrary(options = {}) {
  const resources = options.resources
  const cards = options.cards
  const normalizePath = options.normalizePath
  const removeStandalone = options.removeStandalone
  if (!resources || !cards || typeof normalizePath !== 'function' || typeof removeStandalone !== 'function') {
    throw new Error('World Book Library 缺少资源、人物卡或路径 adapter')
  }

  async function sourceOf(locator) {
    const source = locator && typeof locator === 'object' ? locator : {}
    if (source.kind === 'card') {
      return { kind: 'card', cardPath: await normalizePath(source.cardPath, 'card') }
    }
    return { kind: 'standalone', path: await normalizePath(source.path, 'worldbook') }
  }

  const recordCache = createVersionedJsonCache()
  const privateCache=createDependencyProjectionCache({maxEntries:32,maxBytes:64*1024*1024})
  const mergeCache=createDependencyProjectionCache({maxEntries:8,maxBytes:64*1024*1024})
  async function mergeForChat(records,chat){return mutableJsonDraft(await mergeCache.read(chat.id,{records:records.map(finishJsonDraft),id:chat.id,mergeUids:privateWorldbookState(chat).mergeUids},()=>mergePrivateWorldbooks(records,chat)))}
  async function readRecord(locator) {
    const source = await sourceOf(locator)
    // Only resource content is cached. Identity, binding and per-chat overlays
    // are resolved anew; adapters without reliable versions stay uncached.
    if (typeof options.resourceVersion !== 'function') return loadRecord(source)
    const key = source.cardPath || source.path
    return mutableJsonDraft(await recordCache.read(key, () => options.resourceVersion(key), () => loadRecord(source)))
  }

  async function loadRecord(source) {
    if (source.kind === 'card') {
      const card = await cards.read(source.cardPath)
      if (card === undefined) throw new Error('人物卡不存在: ' + source.cardPath)
      const document = embeddedDocument(card)
      return {
        source: { kind: 'card', cardPath: source.cardPath, cardName: card.name },
        document,
        view: inspectWorldBookDocument(document, { filename: card.name })
      }
    }
    const text = await resources.readText(source.path)
    if (text === undefined) throw new Error('世界书不存在: ' + source.path)
    let document
    try { document = JSON.parse(text) } catch (error) { throw new Error('世界书工作版 JSON 损坏: ' + error.message) }
    return {
      source,
      document,
      view: inspectWorldBookDocument(document, { filename: source.path.split('/').pop() })
    }
  }


  async function liveStamp(chat){
    if(!chat)return ''
    const local=chat.worldbookState?.bindings?.character,current=local?null:await binding(chat.cardPath),sources=local??(current.kind==='multiple'?current.books.map(row=>row.source):current.source?[current.source]:[])
    const all=[...sources,...await (options.additionalSources?.(chat)||[])]
    return JSON.stringify(await Promise.all(all.map(async source=>source.kind==='chat'?[source.id]:[source,await Promise.resolve(options.resourceVersion?.(source.cardPath||source.path)).catch(error=>{if(error?.code==='ENOENT')return 'missing';throw error})])))
  }
  async function privateSource(locator) {
    if(locator?.kind==='chat')return clone(locator)
    if(locator?.resourceId&&options.identities){const identity=await options.identities.resolve(locator.resourceId);if(!identity||identity.deleted)return {...locator,missing:true};return {...locator,...(locator.kind==='card'?{cardPath:identity.path}:{path:identity.path})}}
    const source=await sourceOf(locator)
    if(options.identities){const identity=await options.identities.claim(source.cardPath||source.path);source.resourceId=identity.id}
    return source
  }
  async function getForChat(chat,locator) {
    const source=await privateSource(locator);let live
    if(source.kind!=='chat'&&!source.missing){try{live=await readRecord(source)}catch(error){if(!privateWorldbookState(chat).books[worldbookSourceKey(source)]?.base)throw error}}
    // Resolve identity, actual bytes/errors/deletion and local changes first.
    // Cache only the pure projection; mirrors remain a live downstream input.
    const input={source,id:chat.id,local:finishJsonDraft(privateWorldbookState(chat).books[worldbookSourceKey(source)]),live:finishJsonDraft(live)}
    const record=mutableJsonDraft(await privateCache.read(JSON.stringify([chat.id,worldbookSourceKey(source)]),input,()=>projectPrivateWorldbook(chat,source,input.live)))
    return options.projectMirror?options.projectMirror(record,chat):record
  }
  function validateNative(document){
    if(!document||typeof document!=='object'||Array.isArray(document)||!document.entries||typeof document.entries!=='object'||Array.isArray(document.entries))throw Error('原生世界书需要 entries 对象')
    for(const [key,row]of Object.entries(document.entries))if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isSafeInteger(row.uid)||row.uid<0||String(row.uid)!==key)throw Error('世界书条目编号无效或重复')
  }
  async function ensurePrivateBase(chat,source){const record=await getForChat(chat,source);if(record&&!privateWorldbookState(chat).books[worldbookSourceKey(record.source)])storePrivateWorldbook(chat,record,record.document);return record}
  async function replaceForChat(chat,record,document){
    validateNative(document);
    if(chat.worldbookState?.spMirrors){document=removeSpWorldbookMirror(document,chat.id);record={...record,document:removeSpWorldbookMirror(record.document,chat.id),baseDocument:record.baseDocument?removeSpWorldbookMirror(record.baseDocument,chat.id):record.baseDocument,mergedRecords:record.mergedRecords?.map(row=>({...row,document:removeSpWorldbookMirror(row.document,chat.id),baseDocument:row.baseDocument?removeSpWorldbookMirror(row.baseDocument,chat.id):row.baseDocument}))}}
    storeMergedPrivateWorldbook(chat,record,document)
    const records=record.mergedRecords?await Promise.all(record.mergedRecords.map(row=>getForChat(chat,row.source))):[await getForChat(chat,record.source)]
    return mergePrivateWorldbooks(records.filter(Boolean),chat)
  }
  async function migrateChat(chat){
    if(chat.worldbookState?.version===1&&chat.openingWorldbookSnapshot?.version!==1)return false
    const legacy=chat.openingWorldbookSnapshot,state=clone(privateWorldbookState(chat));chat.worldbookState=state
    if(legacy?.version===1&&legacy.document){
      const full=exportSillyTavernWorldBook(legacy.document),rows=legacy.mergedSources?.length?legacy.mergedSources:[{source:legacy.source,entries:Object.keys(full.entries).map(uid=>({uid:Number(uid),originalUid:Number(uid)}))}],sources=[],claimed=new Set(),mergeUids={}
      for(const row of rows){if(!row.source)continue;const source=await privateSource(row.source);let record
        try{record=await getForChat(chat,source)}catch{}
        const fallback={...full,entries:{}};record ||= projectPrivateWorldbook(chat,source,{document:fallback})
        const requested={...clone(record.document),entries:{}}
        for(const {uid,originalUid}of row.entries||[]){const value=full.entries[uid];if(!value)continue;claimed.add(String(uid));requested.entries[originalUid]={...clone(value),uid:originalUid};mergeUids[worldbookSourceKey(source)+':'+originalUid]=uid}
        // Unmapped old entries are private additions in the first source, never dropped.
        if(sources.length===0){for(const [uid,value]of Object.entries(full.entries))if(!rows.some(other=>(other.entries||[]).some(e=>String(e.uid)===uid)))requested.entries[uid]=clone(value);Object.assign(requested,Object.fromEntries(Object.entries(full).filter(([key])=>key!=='entries')))}
        storePrivateWorldbook(chat,record,requested);sources.push(source)
      }
      if(!sources.length){const source=createPrivateWorldbook(chat,full.name||'旧局世界书',full);sources.push(source)}
      chat.worldbookState.bindings={...chat.worldbookState.bindings,character:sources};chat.worldbookState.mergeUids=mergeUids
      chat.worldbookState.migration={version:1,policy:'preserve-legacy-differences'}
    }else if(legacy?.version===1)chat.worldbookState.bindings={...chat.worldbookState.bindings,character:[]}
    if(legacy?.version===1)chat.openingWorldbookSnapshot={version:2,source:legacy.source||null,libraryDigest:legacy.libraryDigest||null}
    chat.cardContextSnapshotVersion=0
    return true
  }
  async function get(locator) {
    const record = await readRecord(locator)
    return { source: record.source, view: record.view }
  }

  async function catalog() {
    const standaloneResults = await Promise.all((await resources.list('worldbook')).map(async function (path) {
      try {
        const [record, metadata] = await Promise.all([
          readRecord({ kind: 'standalone', path }),
          typeof resources.metadata === 'function' ? resources.metadata(path) : null
        ])
        return { row: {
          kind: 'standalone', path: record.source.path, name: record.view.displayName,
          entryCount: record.view.entryCount, enabledCount: record.view.enabledCount,
          diagnostics: record.view.diagnostics.length,
          importedAt: Math.max(0, Number(metadata && metadata.importedAt) || 0),
          updatedAt: Math.max(0, Number(metadata && metadata.updatedAt) || 0)
        } }
      } catch (error) {
        return { diagnostic: { kind: 'standalone', path, message: str(error && error.message || error) } }
      }
    }))
    const embeddedResults = await Promise.all((await cards.listPaths()).map(async function (cardPath) {
      try {
        const [card, metadata] = await Promise.all([
          cards.read(cardPath),
          typeof cards.metadata === 'function' ? cards.metadata(cardPath) : null
        ])
        if (!card || !card.character_book || typeof card.character_book !== 'object') return {}
        const view = inspectWorldBookDocument(card.character_book, { filename: card.name })
        return { row: {
          kind: 'card', cardPath, cardName: card.name, name: view.displayName,
          entryCount: view.entryCount, enabledCount: view.enabledCount,
          diagnostics: view.diagnostics.length,
          importedAt: Math.max(0, Number(metadata && metadata.importedAt) || 0),
          updatedAt: Math.max(0, Number(metadata && metadata.updatedAt) || 0)
        } }
      } catch (error) {
        return { diagnostic: { kind: 'card', path: cardPath, message: str(error && error.message || error) } }
      }
    }))
    const standalone = standaloneResults.map(function (result) { return result.row }).filter(Boolean)
    const embedded = embeddedResults.map(function (result) { return result.row }).filter(Boolean)
    const diagnostics = standaloneResults.concat(embeddedResults).map(function (result) { return result.diagnostic }).filter(Boolean)
    return { standalone, embedded, diagnostics }
  }

  async function binding(cardPath) {
    const normalized = await normalizePath(cardPath, 'card')
    const card = await cards.read(normalized)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalized)
    const stored = await resources.bindingForCard(normalized)
    if (stored.kind === 'multiple') {
      const books = await Promise.all(stored.sources.map(async item => {
        const source = await sourceOf(item.kind === 'embedded' ? { kind: 'card', cardPath: item.cardPath } : item)
        const kind = source.kind === 'card' ? 'embedded' : 'standalone'
        if (!item.available) return { kind, source, name: '', available: false }
        const record = await readRecord(source)
        return { kind, source: record.source, name: record.view.displayName, available: true }
      }))
      if (books.length === 0) return { kind: 'none', source: null, name: '', available: true }
      if (books.length === 1) return books[0]
      return { kind: 'multiple', books, source: books[0].source, name: books.map(book => book.name || '世界书不可用').join('、'), available: books.every(book => book.available) }
    }
    if (stored.kind === 'none') return { kind: 'none', source: null, name: '', available: true }
    if (stored.kind === 'standalone') {
      const source = { kind: 'standalone', path: stored.path }
      if (stored.available !== true) return { kind: 'standalone', source, name: '', available: false }
      try {
        const record = await readRecord(source)
        return { kind: 'standalone', source, name: record.view.displayName, available: true }
      } catch (error) {
        if (/世界书不存在/.test(str(error && error.message))) return { kind: 'standalone', source, name: '', available: false }
        throw error
      }
    }
    if (stored.kind === 'embedded') {
      const source = { kind: 'card', cardPath: stored.cardPath }
      if (stored.available !== true) return { kind: 'embedded', source, name: '', available: false }
      try {
        const record = await readRecord(source)
        return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
      } catch (error) {
        if (/人物卡不存在/.test(str(error && error.message))) return { kind: 'embedded', source, name: '', available: false }
        throw error
      }
    }
    if (card.character_book && typeof card.character_book === 'object') {
      const record = await readRecord({ kind: 'card', cardPath: normalized })
      return { kind: 'embedded', source: record.source, name: record.view.displayName, available: true }
    }
    return { kind: 'none', source: null, name: '', available: true }
  }

  function bindingMatchesSource(current, source) {
    if (current?.kind === 'multiple') return current.books.some(book => bindingMatchesSource(book, source))
    if (!current || !current.source) return false
    if (source.kind === 'card') {
      return current.kind === 'embedded' && current.source.cardPath === source.cardPath
    }
    return current.kind === 'standalone' && current.source.path === source.path
  }

  async function associations(locator) {
    const source = await sourceOf(locator)
    const cardPaths = await cards.listPaths()
    const cardRows = []
    for (const cardPath of cardPaths) {
      const card = await cards.read(cardPath)
      if (card === undefined) continue
      const current = await binding(cardPath)
      cardRows.push({
        path: cardPath,
        name: str(card.name),
        bound: bindingMatchesSource(current, source),
        binding: current
      })
    }
    const boundCards = cardRows.filter(function (card) { return card.bound }).map(function (card) {
      return { path: card.path, name: card.name }
    })
    return { source, cards: cardRows, boundCards, conflict: false }
  }

  async function boundCard(cardPath, card, chat) { return filterSpWorldbookOwner(await rawBoundCard(cardPath,card,chat),chat) }
  async function rawBoundCard(cardPath, card, chat) {
    if(chat?.openingWorldbookSnapshot?.version===1){chat=clone(chat);await migrateChat(chat)}
    const localSources=chat?.worldbookState?.bindings?.character,current=localSources?null:await binding(cardPath)
    if(current?.available===false)throw new Error('绑定的世界书不存在，请重新绑定或解绑')
    const sources=localSources??(current.kind==='multiple'?current.books.map(row=>row.source):current.source?[current.source]:[])
    const records=(await Promise.all(sources.map(source=>chat?getForChat(chat,source):readRecord(source)))).filter(Boolean)
    if(!records.length)return null
    if(chat)return mergeForChat(records,chat)
    if(records.length===1)return records[0]
    const merged=mergeWorldBooks(records);return {source:records[0].source,document:merged.document,mergedSources:merged.sources,view:inspectWorldBookDocument(merged.document)}
  }

  async function bound(cardPath,card,chat) {
    if(chat?.openingWorldbookSnapshot?.version===1){chat=clone(chat);await migrateChat(chat)}
    const primary=await boundCard(cardPath,card,chat)
    if(!options.additionalSources)return primary
    const records=primary?.mergedRecords|| (primary?[primary]:[]),seen=new Set(records.map(row=>worldbookSourceKey(row.source)))
    for(const locator of await options.additionalSources(chat)){
      const record=chat?await getForChat(chat,locator):await readRecord(locator);if(!record)continue
      const key=worldbookSourceKey(record.source);if(seen.has(key))continue;seen.add(key);records.push(filterSpWorldbookOwner(record,chat))
    }
    if(!records.length)return null
    if(records.length===1)return records[0]
    if(chat)return mergeForChat(records,chat)
    const merged=mergeWorldBooks(records);return {source:records[0].source,document:merged.document,mergedSources:merged.sources,view:inspectWorldBookDocument(merged.document)}
  }
  async function bind(cardPath, locator) {
    const normalized = await normalizePath(cardPath, 'card')
    const card = await cards.read(normalized)
    if (card === undefined) throw new Error('人物卡不存在: ' + normalized)
    const source = await sourceOf(locator)
    if (source.kind === 'card') {
      const owner = await cards.read(source.cardPath)
      if (owner === undefined) throw new Error('人物卡不存在: ' + source.cardPath)
      if (!owner.character_book || typeof owner.character_book !== 'object') throw new Error('该人物卡没有自带世界书')
    }
    const current = await binding(normalized)
    if (bindingMatchesSource(current, source)) return current
    const books = current.kind === 'multiple' ? current.books : current.source ? [current] : []
    return await setBindings(normalized, books.map(book => book.source).concat([source]))
  }

  async function setBindings(cardPath, locators) {
    const normalized = await normalizePath(cardPath, 'card')
    if (!Array.isArray(locators)) throw new Error('世界书绑定需要有序列表')
    const sources = await Promise.all(locators.map(sourceOf))
    const identities = sources.map(source => JSON.stringify(source))
    if (new Set(identities).size !== identities.length) throw new Error('不能重复绑定同一本世界书')
    for (const source of sources) {
      await readRecord(source)
      if (source.kind === 'card') {
        const owner = await cards.read(source.cardPath)
        if (!owner?.character_book) throw new Error('该人物卡没有自带世界书')
      }
    }
    await resources.bindMany(normalized, sources.map(source => source.kind === 'card' ? { kind: 'embedded', cardPath: source.cardPath } : source))
    return await binding(normalized)
  }

  async function unbind(cardPath, locator) {
    if (!locator) { await resources.unbind(cardPath); return await binding(cardPath) }
    const current = await binding(cardPath)
    const books = current.kind === 'multiple' ? current.books : current.source ? [current] : []
    const source = await sourceOf(locator)
    return await setBindings(cardPath, books.filter(book => !bindingMatchesSource(book, source)).map(book => book.source))
  }

  async function importBook(payload) {
    const prepared = prepareWorldBookImport(payload)
    const path = await resources.import(prepared, prepared.working)
    const record = await readRecord({ kind: 'standalone', path })
    return { kind: 'standalone', path, name: record.view.displayName, entryCount: record.view.entryCount }
  }

  async function update(locator, request) {
    const record = await readRecord(locator)
    const changed = updateWorldBookDocument(record.document, request)
    if (record.source.kind === 'card') {
      await cards.update(record.source.cardPath, { character_book: changed.document })
    } else {
      await resources.write(record.source.path, JSON.stringify(changed.document, null, 2))
    }
    return await get(record.source)
  }

  /** Replace through the native ST API, preserving unknown plugin fields. */
  async function replaceNative(locator, document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)
      || !document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) {
      throw new Error('原生世界书需要 entries 对象')
    }
    const ids = new Set()
    for (const [key, entry] of Object.entries(document.entries)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Number.isSafeInteger(entry.uid)
        || entry.uid < 0 || String(entry.uid) !== key || ids.has(entry.uid)) throw new Error('世界书条目编号无效或重复')
      ids.add(entry.uid)
    }
    const record = await readRecord(locator)
    const native = clone(document)
    // originalData is conversion provenance, never a second writable authority.
    delete native.originalData
    if (record.source.kind === 'card') {
      await cards.update(record.source.cardPath, { character_book: exportCharacterBook(native, { replace: true }) })
    } else {
      await resources.write(record.source.path, JSON.stringify(native, null, 2))
    }
    return await get(record.source)
  }

  async function exportBook(locator) {
    const record = await readRecord(locator)
    return { name: record.view.displayName, document: exportSillyTavernWorldBook(record.document) }
  }

  async function characterBookForCard(cardPath) {
    const current = await binding(cardPath)
    if (current.kind === 'none') return null
    if (current.available !== true) throw new Error('绑定的世界书不存在，请重新绑定或解绑')
    const record = await bound(cardPath)
    return exportCharacterBook(record.document || record.view.raw)
  }

  async function remove(locator) {
    const source = await sourceOf(typeof locator === 'string' ? { kind: 'standalone', path: locator } : locator)
    if (source.kind === 'standalone') return await removeStandalone(source.path)
    await readRecord(source)
    const relations = await associations(source)
    for (const card of relations.boundCards) await unbind(card.path, source)
    await cards.update(source.cardPath, { character_book: null })
    return { removed: source.cardPath, kind: 'embedded' }
  }

  return Object.freeze({ catalog, get, liveStamp, getForChat, ensurePrivateBase, migrateChat, replaceForChat, privateSource, binding, associations, bound, boundCard, bindingStamp: options.bindingStamp, bind, setBindings, unbind, import: importBook, update, replaceNative, export: exportBook, characterBookForCard, remove })
}
