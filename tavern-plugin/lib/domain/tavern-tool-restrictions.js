/** Keep the declared and executable controlled-tool sets in agreement. */
export function visibleTavernTools(schemas, visible, controlled) {
  const names = new Set(visible)
  return schemas.filter(schema => !controlled || !controlled.has(schema.name) || names.has(schema.name))
}

export function createTavernToolRestrictions(ctx, { resolveChat, visibleTools, controlledToolNames, toolPolicy }) {
  const states = new Map()
  let stopped = false

  function sync(agent, knownChat) {
    if (!agent?.session || stopped) return Promise.resolve()
    let state = states.get(agent)
    if (!state) { state = { tail: Promise.resolve(), dispose: null }; states.set(agent, state) }
    const task = state.tail.catch(() => {}).then(async () => {
      if (stopped || states.get(agent) !== state) return
      const chat = knownChat === undefined ? await resolveChat(agent.session.id) : knownChat
      const visible = chat ? await visibleTools(agent.session.id, chat) : null
      state.visible = visible
      state.policy = chat && toolPolicy ? await toolPolicy(agent, chat) : null
      // Kernel restrictions intersect. Lift our old mask before enumerating
      // registered tools, otherwise newly allowed names stay hidden forever.
      state.dispose?.()
      state.dispose = null
      if (!chat) return
      // rc.2 also masks tools inherited from a preset. A global-only allow-list
      // accidentally removes an allowed preset skill. Deny known globals here;
      // the schema filter and monotonic guard enforce the same policy on all scopes.
      const denied=ctx.tools.schemas().filter(schema=>schema.name!=='run_code'&&((!controlledToolNames||controlledToolNames.has(schema.name))&&!visible.includes(schema.name)||state.policy?.(schema.name)===false)).map(schema=>schema.name)
      if(denied.length)state.dispose=agent.ctx.tools.restrict({deny:denied})
    })
    state.tail = task
    return task
  }

  ctx.on('agent/created', ({ agent }) => sync(agent))
  ctx.on('agent/disposed', ({ agent }) => { const state = states.get(agent); states.delete(agent); state?.dispose?.() })
  ctx.on('agent/pre-step', async ({ agent }, next) => { await sync(agent); return next() }, { prepend: true })
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    await sync(agent)
    const assembly = await next(), visible = states.get(agent)?.visible
    if (visible) assembly.tools = controlledToolNames
      ? visibleTavernTools(assembly.tools, visible, controlledToolNames)
      : assembly.tools.filter(schema => visible.includes(schema.name))
    const policy=states.get(agent)?.policy
    if(policy)assembly.tools=assembly.tools.filter(schema=>policy(schema.name)!==false)
    return assembly
  }, { prepend: true })
  // Direct calls also pass this lane. The kernel resolves the definition after
  // pre-execute, so stale or newly created scopes cannot bypass the mask.
  ctx.on('tools/pre-execute', async ({ agent }, next) => { await sync(agent); return next() }, { prepend: true })
  // Presets and the Agent can own scoped tools. Enforce the same policy at
  // the final execution guard, including tools registered after the mask.
  ctx.tools.guard(({ agent, name }) => {
    if(states.get(agent)?.policy?.(name)===false)return '工具工作台已关闭：'+name
    const visible = states.get(agent)?.visible
    if (visible && (!controlledToolNames || controlledToolNames.has(name)) && !visible.includes(name) && ctx.tools.get(name, agent)) return '当前会话模式不允许调用工具：' + name
  })
  ctx.effect(() => () => {
    stopped = true
    for (const state of states.values()) state.dispose?.()
    states.clear()
  })
  return Object.freeze({ sync })
}
