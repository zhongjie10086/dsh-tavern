function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

const TERMINAL = new Set(['succeeded', 'failed', 'interrupted', 'stale', 'cancelled'])
const VALID = new Set(['queued', 'running', ...TERMINAL])

function mailboxOf(chat) {
  const source = chat && chat.taskMailbox
  if (source && typeof source === 'object' && source.tasks && typeof source.tasks === 'object') {
    if (Array.isArray(source.tasks)) {
      // Validate before replacing the legacy array. A corrupt entry must remain
      // available for repair rather than disappearing during normalization.
      const tasks = Object.create(null)
      for (const [index, task] of source.tasks.entries()) {
        const id = task?.taskId
        if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
          throw new Error('旧任务邮箱迁移失败：第 ' + index + ' 项 taskId 非法；原数组已保留，请修复后重试')
        }
        if (Object.hasOwn(tasks, id)) {
          throw new Error('旧任务邮箱迁移失败：第 ' + index + ' 项 taskId 重复 (' + id + ')；原数组已保留，请修复后重试')
        }
        tasks[id] = task
      }
      source.tasks = tasks
      source.latestByKind = Object.create(null)
      for (const task of Object.values(tasks).sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) source.latestByKind[task.kind] = task.taskId
    }
    if (!source.latestByKind || typeof source.latestByKind !== 'object') source.latestByKind = {}
    source.tasks = Object.assign(Object.create(null), source.tasks)
    source.latestByKind = Object.assign(Object.create(null), source.latestByKind)
    if (!Number.isSafeInteger(source.version) || source.version < 0) source.version = 0
    return source
  }
  const mailbox = { version: 0, tasks: Object.create(null), latestByKind: Object.create(null) }
  chat.taskMailbox = mailbox
  return mailbox
}

function publicTask(task) {
  if (!task || typeof task !== 'object') return null
  return {
    taskId: str(task.taskId),
    requestId: str(task.requestId),
    kind: str(task.kind),
    status: str(task.status),
    stage: str(task.stage),
    busy: !TERMINAL.has(str(task.status)),
    terminal: TERMINAL.has(str(task.status)),
    input: task.input && typeof task.input === 'object' ? task.input : {},
    operationId: str(task.operationId),
    result: task.result === undefined ? null : task.result,
    error: str(task.error),
    version: Number(task.version) || 0,
    createdAt: Number(task.createdAt) || 0,
    updatedAt: Number(task.updatedAt) || 0
  }
}

function sameValue(left, right) {
  if (left === right) return true
  if ((left === null || typeof left !== 'object') || (right === null || typeof right !== 'object')) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Persistent command/result mailbox. HTTP and browser state are projections of this file-backed record. */
export function createDurableTaskMailbox(options = {}) {
  const store = options.store
  const now = typeof options.now === 'function' ? options.now : Date.now
  const reconcile = typeof options.reconcile === 'function' ? options.reconcile : function () { return null }
  const mutationTails = new Map()
  let sequence = 0
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function') {
    throw new Error('Durable Task Mailbox 缺少存储 adapter')
  }

  async function loadMailbox(chat) {
    const legacy = Array.isArray(chat.taskMailbox?.tasks)
    const mailbox = mailboxOf(chat)
    if (legacy) await store.writeChat(chat, { source: 'mailbox.migrate' })
    return mailbox
  }

  function serialize(chatId, work) {
    const id = str(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(id, current)
    return current.finally(function () {
      if (mutationTails.get(id) === current) mutationTails.delete(id)
    })
  }

  function findTask(mailbox, selector = {}) {
    const taskId = str(selector.taskId)
    if (taskId !== '') return mailbox.tasks[taskId] || null
    const requestId = str(selector.requestId)
    if (requestId !== '') {
      return Object.values(mailbox.tasks).find(function (task) { return str(task && task.requestId) === requestId }) || null
    }
    const kind = str(selector.kind)
    const latestId = str(mailbox.latestByKind[kind])
    return latestId === '' ? null : (mailbox.tasks[latestId] || null)
  }

  function applyPatch(mailbox, task, patch) {
    const status = patch.status === undefined ? str(task.status) : str(patch.status)
    if (!VALID.has(status)) throw new Error('未知任务状态: ' + status)
    if (TERMINAL.has(str(task.status)) && status !== str(task.status)) return false
    const changed = status !== str(task.status) ||
      (patch.stage !== undefined && str(patch.stage) !== str(task.stage)) ||
      (patch.operationId !== undefined && str(patch.operationId) !== str(task.operationId)) ||
      (patch.result !== undefined && !sameValue(patch.result, task.result)) ||
      (patch.error !== undefined && str(patch.error) !== str(task.error))
    if (!changed) return false
    task.status = status
    if (patch.stage !== undefined) task.stage = str(patch.stage)
    if (patch.operationId !== undefined) task.operationId = str(patch.operationId)
    if (patch.result !== undefined) task.result = patch.result
    if (patch.error !== undefined) task.error = str(patch.error)
    task.updatedAt = now()
    mailbox.version += 1
    task.version = mailbox.version
    return true
  }

  function prune(mailbox, protectedId) {
    const finished = Object.values(mailbox.tasks).filter(task => task && TERMINAL.has(task.status) && task.taskId !== protectedId)
      .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt) || Number(b.version) - Number(a.version))
    const protectedFinished = TERMINAL.has(mailbox.tasks[protectedId]?.status) ? 1 : 0
    for (const task of finished.slice(30 - protectedFinished)) delete mailbox.tasks[task.taskId]
    const latest = Object.create(null)
    for (const task of Object.values(mailbox.tasks).filter(Boolean).sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) latest[task.kind] = task.taskId
    mailbox.latestByKind = latest
  }

  async function submit(chatId, input = {}) {
    return await serialize(chatId, async function () {
      const chat = await store.readChat(chatId)
      if (!chat) throw new Error('聊天不存在: ' + chatId)
      const mailbox = await loadMailbox(chat)
      const requestId = str(input.requestId).trim().slice(0, 160)
      const kind = str(input.kind).trim()
      if (requestId === '') throw new Error('持久任务缺少 requestId')
      if (kind === '') throw new Error('持久任务缺少 kind')
      const existing = findTask(mailbox, { requestId })
      if (existing) {
        if (str(existing.kind) !== kind) throw new Error('同一 requestId 对应了不同任务类型')
        return publicTask(existing)
      }
      if (Object.values(mailbox.tasks).filter(task => task && !TERMINAL.has(task.status)).length >= 30) throw new Error('待处理任务已达 30 项，请等待完成或取消后再提交')
      sequence += 1
      const timestamp = now()
      const taskId = 'task-' + timestamp.toString(36) + '-' + sequence.toString(36)
      mailbox.version += 1
      const task = {
        taskId,
        requestId,
        kind,
        status: 'queued',
        stage: str(input.stage) || 'queued',
        input: input.input && typeof input.input === 'object' ? input.input : {},
        operationId: '',
        result: null,
        error: '',
        version: mailbox.version,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      mailbox.tasks[taskId] = task
      mailbox.latestByKind[kind] = taskId
      prune(mailbox, taskId)
      await store.writeChat(chat, { source: kind + '.mailbox.queued', requestId })
      return publicTask(task)
    })
  }

  async function transition(chatId, taskId, patch = {}) {
    return await serialize(chatId, async function () {
      const chat = await store.readChat(chatId)
      if (!chat) throw new Error('聊天不存在: ' + chatId)
      const mailbox = await loadMailbox(chat)
      const task = findTask(mailbox, { taskId })
      if (!task) throw new Error('持久任务不存在: ' + taskId)
      if (applyPatch(mailbox, task, patch)) {
        prune(mailbox, taskId)
        await store.writeChat(chat, { source: str(task.kind) + '.mailbox.' + (str(patch.stage) || str(patch.status) || 'transition'), requestId: str(task.requestId), operationId: str(patch.operationId || task.operationId) })
      }
      return publicTask(task)
    })
  }

  async function sync(chatId, selector = {}) {
    return await serialize(chatId, async function () {
      if (typeof store.readChatReadonly === 'function') {
        const readonlyChat = await store.readChatReadonly(chatId)
        if (!readonlyChat) return { mailboxVersion: 0, task: null, chat: undefined }
        const rawMailbox = readonlyChat.taskMailbox
        if (!Array.isArray(rawMailbox?.tasks)) {
          if (!rawMailbox || typeof rawMailbox !== 'object' || !rawMailbox.tasks || typeof rawMailbox.tasks !== 'object') {
            return { mailboxVersion: 0, task: null, chat: readonlyChat }
          }
          const version = Number.isSafeInteger(rawMailbox.version) && rawMailbox.version >= 0 ? rawMailbox.version : 0
          const latestByKind = rawMailbox.latestByKind && typeof rawMailbox.latestByKind === 'object' ? rawMailbox.latestByKind : {}
          const readonlyTask = findTask({ version, tasks: rawMailbox.tasks, latestByKind }, selector)
          if (!readonlyTask) return { mailboxVersion: version, task: null, chat: readonlyChat }
          const repair = await reconcile(readonlyChat, publicTask(readonlyTask))
          if (!repair || typeof repair !== 'object') return { mailboxVersion: version, task: publicTask(readonlyTask), chat: readonlyChat }
        }
      }
      const chat = await store.readChat(chatId)
      if (!chat) return { mailboxVersion: 0, task: null, chat: undefined }
      const mailbox = await loadMailbox(chat)
      const task = findTask(mailbox, selector)
      if (!task) return { mailboxVersion: mailbox.version, task: null, chat }
      const repair = await reconcile(chat, publicTask(task))
      if (repair && typeof repair === 'object' && applyPatch(mailbox, task, repair)) {prune(mailbox,task.taskId);await store.writeChat(chat, { source: str(task.kind) + '.mailbox.reconcile', requestId: str(task.requestId), operationId: str(task.operationId) })}
      return { mailboxVersion: mailbox.version, task: publicTask(task), chat }
    })
  }

  async function recover(chatId) {
    return await serialize(chatId, async function () {
      const chat = await store.readChat(chatId)
      if (!chat) return { mailboxVersion: 0, tasks: [] }
      const mailbox = await loadMailbox(chat)
      let changed = false
      for (const task of Object.values(mailbox.tasks)) {
        if (!task || str(task.status) !== 'running') continue
        const repair = await reconcile(chat, publicTask(task))
        changed = applyPatch(mailbox, task, repair && typeof repair === 'object' ? repair : {
          status: 'interrupted', stage: 'interrupted', error: '服务重启中断了本次后台任务'
        }) || changed
      }
      if (changed) {prune(mailbox);await store.writeChat(chat, { source: 'mailbox.recover' })}
      return { mailboxVersion: mailbox.version, tasks: Object.values(mailbox.tasks).map(publicTask) }
    })
  }

  return Object.freeze({ submit, transition, sync, recover })
}
