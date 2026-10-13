import { projectAgentContent } from './runtime-content-projection.js'
import { freezeJson } from './readonly-json.js'
const readonlyContexts=new WeakMap()
export function projectTavernHelperContextReadonly(chat) {
  if (Object.isFrozen(chat) && readonlyContexts.has(chat)) return readonlyContexts.get(chat)
  const value=freezeJson(projectTavernHelperContext(chat))
  if(Object.isFrozen(chat))readonlyContexts.set(chat,value)
  return value
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function selectedSwipe(message) {
  const count = Math.max(
    Array.isArray(message && message.swipes) ? message.swipes.length : 0,
    Array.isArray(message && message.variables) ? message.variables.length : 0,
    1
  )
  return Math.max(0, Math.min(count - 1, Number(message && message.swipeId) || 0))
}

function normalizeMessageId(messages, value) {
  const rawId = value === undefined || value === null || value === 'latest' ? -1 : Number(value)
  const messageId = rawId < 0 ? messages.length + rawId : rawId
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= messages.length) {
    throw new Error('消息楼层不存在: ' + str(value))
  }
  return messageId
}

/** Read the selected variable snapshot from the latest message that has one. */
export function lastTavernHelperVariables(messages) {
  const source = Array.isArray(messages) ? messages : []
  for (let messageId = source.length - 1; messageId >= 0; messageId--) {
    const message = source[messageId]
    if (message && message.role === 'tavern-helper') continue
    if (!message || !Array.isArray(message.variables) || message.variables.length === 0) continue
    const swipeId = selectedSwipe(message)
    const variables = message.variables[swipeId]
    if (variables !== undefined) return clone(variables)
  }
  return undefined
}

/** Project authoritative Chat state into the synchronous Tavern Helper read API. */
export function projectTavernHelperContext(chat) {
  const messages = []
  const turnMessageIds = {}
  for (const source of Array.isArray(chat && chat.messages) ? chat.messages : []) {
    if (!source || typeof source !== 'object') continue
    const messageId = messages.length
    const swipeId = selectedSwipe(source)
    const swipes = Array.isArray(source.swipes) && source.swipes.length > 0
      ? source.swipes.map(str)
      : [str(source.sourceText || source.text)]
    const variables = Array.isArray(source.variables) ? clone(source.variables) : []
    const tavernRole = source.tavernRoleOverride || (source.role === 'tavern-helper'
      ? (['system', 'assistant', 'user'].includes(source.tavernRole) ? source.tavernRole : 'assistant')
      : (source.role === 'user' ? 'user' : 'assistant'))
    const projected = {
      pluginData: clone(source.tavernPluginData || {}),
      ...(source.tavernLegacyId?{id:source.tavernLegacyId}:{}),
      ...(source.tavernSendDate?{send_date:clone(source.tavernSendDate)}:{}),
      name: str(source.name || (tavernRole === 'assistant' ? chat.cardName : tavernRole === 'user' ? chat.macroState?.userName : '')),
      is_hidden: source.tavernHidden === true,
      extra: clone(source.tavernExtra || {}),
      swipes_info: clone(source.tavernSwipesInfo || []),
      message_id: messageId,
      role: tavernRole,
      message: swipes[swipeId] ?? swipes[0] ?? '',
      swipe_id: swipeId,
      swipes,
      swipes_data: variables,
      variables: clone(variables[swipeId] || {})
    }
    if (source.role === 'tavern-helper') {
      projected.is_hidden = source.tavernHidden === true
      if (str(source.name) !== '') projected.name = str(source.name)
    }
    messages.push(projected)
    if (projected.role === 'assistant') {
      const turn = Math.max(0, Number(source.turn) || (source.greeting === true ? 1 : 0))
      if (turn > 0) turnMessageIds[String(turn)] = messageId
    }
  }
  return {
    version: 1,
    serverEvents:chat?.tavernHelperServerEvents===true,
    chatId: str(chat && chat.id),
    databaseInitialized: !!chat?.spDatabase,
    legacyChatFileName: str(chat?.legacyChatFileName),
    personaDescription: str(chat?.tavernPersona?.description),
    scriptPrompts: clone(chat && chat.tavernScriptPrompts || []),
    chatMetadata: clone(chat && chat.tavernPluginMetadata || {}),
    mvuEnabled: chat?.mvu?.enabled === true,
    // Z96: a message frame stops holding a card's opening for MVU once this game's settlement is off.
    mvuSettlementPaused: chat?.mvu?.enabled === true && Boolean(chat.mvu.settlementPaused),
    stateRevision: Math.max(0, Number(chat && chat._storageRevision) || 0),
    lifecycleRevision: Math.max(0, Number(chat && chat.tavernHelperLifecycleRevision) || 0),
    messages,
    turnMessageIds,
    chatVariables: clone(chat && chat.variables && typeof chat.variables === 'object' ? chat.variables : {}),
    scriptVariables: clone(chat && chat.tavernHelperScriptVariables && typeof chat.tavernHelperScriptVariables === 'object' ? chat.tavernHelperScriptVariables : {})
  }
}

/** Append Helper-owned floors without turning plugin records into story rounds. */
export function appendTavernHelperMessages(chat, values, option = {}) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const settings = option && typeof option === 'object' && !Array.isArray(option) ? option : {}
  const insertValue=settings.insert_before ?? settings.insert_at ?? 'end'
  const length=chat.messages?.length || 0
  const at=insertValue==='end'?length:Number(insertValue)<0?length+Number(insertValue):Number(insertValue)
  if(!Number.isSafeInteger(at)||at<0||at>length)throw new Error('插入位置不存在')
  if (settings.refresh !== undefined && !['none', 'affected', 'all'].includes(settings.refresh)) {
    throw new Error('createChatMessages refresh 参数无效')
  }
  if (!Array.isArray(chat.messages)) chat.messages = []
  const created = [], additions=[]
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') throw new TypeError('createChatMessages 消息必须是对象')
    const role = str(value.role)
    if (!['system', 'assistant', 'user'].includes(role)) throw new TypeError('createChatMessages role 无效: ' + role)
    const text = str(value.message)
    const message = {
      role: 'tavern-helper',
      tavernRole: role,
      tavernHidden: value.is_hidden === true,
      tavernHelperCreated: true,
      text,
      sourceText: text,
      projectionText: text,
      sessionText: text,
      displayText: text,
      displayMode: 'markdown',
      swipeId: 0,
      swipes: [text],
      tavernExtra: clone(value.extra || {}),
      variables: [clone(value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : {})]
    }
    if (str(value.name) !== '') message.name = str(value.name)
    additions.push(message)
    created.push({ messageId: at+additions.length-1 })
  }
  chat.messages.splice(at,0,...additions)
  return created
}

/** Read the exact Helper namespace targeted by a variable write. */
export function readTavernHelperVariables(chat, option = {}) {
  if (option.type === 'chat') return clone(chat.variables || {})
  if (option.type === 'script') return clone(chat.tavernHelperScriptVariables?.[option.script_id] || {})
  if (option.type !== 'message') throw Error('只支持 message、chat 或 script 变量')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const message = messages[normalizeMessageId(messages, option.message_id)]
  const swipeId = Object.hasOwn(option, 'swipe_id') ? Math.max(0, Number(option.swipe_id) || 0) : selectedSwipe(message)
  return clone(message.variables?.[swipeId] || {})
}

/** Apply one explicit Helper variable write without exposing Chat internals. */
export function replaceTavernHelperVariables(chat, request = {}) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const option = request.option && typeof request.option === 'object' ? request.option : {}
  const value = clone(request.variables && typeof request.variables === 'object' ? request.variables : {})
  if (option.type === 'chat') {
    chat.variables = value
    return { type: 'chat' }
  }
  if (option.type === 'script') {
    const scriptId = str(option.script_id).trim()
    if (scriptId === '') throw new Error('脚本变量缺少 script_id')
    if (!chat.tavernHelperScriptVariables || typeof chat.tavernHelperScriptVariables !== 'object') chat.tavernHelperScriptVariables = {}
    chat.tavernHelperScriptVariables[scriptId] = value
    return { type: 'script', scriptId }
  }
  if (option.type !== 'message') throw new Error('只支持 message、chat 或 script 变量')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const messageId = normalizeMessageId(messages, option.message_id)
  const message = messages[messageId]
  const swipeId = Object.prototype.hasOwnProperty.call(option, 'swipe_id')
    ? Math.max(0, Number(option.swipe_id) || 0)
    : selectedSwipe(message)
  if (!Array.isArray(message.variables)) message.variables = []
  message.variables[swipeId] = value
  return { type: 'message', messageId, swipeId }
}

function openingVariableSnapshot(chat, message, messageId, value, previous) {
  const next = clone(value && typeof value === 'object' ? value : {})
  // Fixed official MVU builds the worldbook schema first, then overrides each
  // swipe's stat_data with <initvar>. That override does not rebuild strictSet.
  // Honor its explicit per-opening declaration only on the first complete write;
  // never generate schema or reinterpret an already initialized/old snapshot.
  const strictSet = next.stat_data?.$meta?.strictSet
  if (messageId === 0 && message.greeting === true && chat.mvu?.enabled === true
      && (previous?.stat_data === undefined || previous?.schema === undefined)
      && typeof strictSet === 'boolean' && next.schema && typeof next.schema === 'object' && !Array.isArray(next.schema)) {
    next.schema.strictSet = strictSet
  }
  return next
}

/** Apply the subset of setChatMessages used by card UI and greeting-index scripts. */
export function replaceTavernHelperMessages(chat, patches) {
  if (!chat || typeof chat !== 'object') throw new Error('聊天不存在')
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const updated = []
  for (const patch of Array.isArray(patches) ? patches : []) {
    if (!patch || typeof patch !== 'object') continue
    const messageId = normalizeMessageId(messages, patch.message_id)
    const message = messages[messageId]
    const previousVariables = Array.isArray(message.variables) ? message.variables.slice() : []
    const previousSwipeId = selectedSwipe(message)
    const writesSwipes = Object.hasOwn(patch, 'swipes')
    if(writesSwipes) {
      if(!Array.isArray(patch.swipes)||!patch.swipes.length||patch.swipes.some(text=>typeof text!=='string'))throw new Error('消息至少需要一个有效 swipe')
      message.swipes=clone(patch.swipes)
      if(Array.isArray(message.variables))message.variables.length=Math.min(message.variables.length,message.swipes.length)
    }
    for(const [from,to]of [['name','name'],['extra','tavernExtra'],['swipes_info','tavernSwipesInfo']])if(Object.hasOwn(patch,from))message[to]=clone(patch[from])
    if(Object.hasOwn(patch,'is_hidden'))message.tavernHidden=patch.is_hidden===true
    if(Object.hasOwn(patch,'role')) { if(!['user','assistant','system'].includes(patch.role))throw new Error('消息角色无效');message.tavernRoleOverride=patch.role }
    const count = Math.max(
      Array.isArray(message.swipes) ? message.swipes.length : 0,
      Array.isArray(message.variables) ? message.variables.length : 0,
      1
    )
    const swipeId = Object.prototype.hasOwnProperty.call(patch, 'swipe_id')
      ? Math.max(0, Math.min(count - 1, Number(patch.swipe_id) || 0))
      : previousSwipeId
    const writesText = Object.prototype.hasOwnProperty.call(patch, 'message')
    if (writesText) {
      const text = str(patch.message)
      if (!Array.isArray(message.swipes)) message.swipes = [str(message.sourceText || message.text)]
      while (message.swipes.length < count) message.swipes.push('')
      message.swipes[swipeId] = text
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'data')) {
      if (!Array.isArray(message.variables)) message.variables = []
      message.variables[swipeId] = openingVariableSnapshot(chat, message, messageId, patch.data, previousVariables[swipeId])
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'swipes_data')) {
      const values = Array.isArray(patch.swipes_data) ? patch.swipes_data : []
      message.variables = values.map(function (value, index) {
        return openingVariableSnapshot(chat, message, messageId, value, previousVariables[index])
      })
    }
    message.swipeId = swipeId
    // MVU initialization writes swipes_data only. Never replace an already
    // rendered message with raw swipe text or replay stateful macros for it.
    if ((writesText || writesSwipes || swipeId !== previousSwipeId) && Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) {
      const sourceText = message.swipes[swipeId]
      const role=message.tavernRoleOverride || (message.role==='tavern-helper'?message.tavernRole:message.role)
      const projection = role==='user'||role==='system'?{renderedText:sourceText,sessionText:sourceText,displayText:sourceText,displayMode:'markdown',warnings:[],macroState:chat.macroState}:projectAgentContent(sourceText, { charName: chat.cardName, macroState: chat.macroState })
      message.sourceText = sourceText
      message.projectionText = projection.renderedText
      message.text = projection.sessionText
      message.sessionText = projection.sessionText
      message.displayText = projection.displayText
      message.displayMode = projection.displayMode
      message.projectionVersion = 2
      message.projectionWarnings = projection.warnings
      delete message.displayRuntime
      chat.macroState = projection.macroState
    }
    updated.push({ messageId, swipeId })
  }
  return updated
}

/** Delete the requested floors atomically; negative IDs are resolved before removal. */
export function deleteTavernHelperMessages(chat, values) {
  if(!Array.isArray(values))throw new Error('删除楼层必须是数组')
  const ids=[...new Set(values.map(id=>normalizeMessageId(chat.messages,id)))].sort((a,b)=>a-b)
  const deleted=new Set(ids)
  chat.messages=chat.messages.filter((_,id)=>!deleted.has(id))
  return ids.map(messageId=>({messageId}))
}
export function rotateTavernHelperMessages(chat, begin, middle, end) {
  const length=chat.messages.length, bound=value=>Number(value)<0?length+Number(value):Number(value)
  ;[begin,middle,end]=[begin,middle,end].map(bound)
  if(![begin,middle,end].every(Number.isSafeInteger)||begin<0||end>length||begin>middle||middle>end)throw new Error('旋转楼层范围无效')
  chat.messages.splice(begin,end-begin,...chat.messages.slice(middle,end),...chat.messages.slice(begin,middle))
  return Array.from({length:end-begin},(_,i)=>({messageId:begin+i}))
}
