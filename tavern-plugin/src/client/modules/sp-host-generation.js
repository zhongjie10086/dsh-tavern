// Native ST generation used by SP's logical turns. Keep the fetch call visible
// to the original package: its interceptor owns response capture and settlement.
function installTavernSpHostGeneration(win, st, { context, request, owner = () => ({}), track = promise => promise }) {
  let active = null, disposed = false, preparation = null;
  const identity = () => JSON.stringify([context().chatId, context().lifecycleRevision]);
  const assertCurrent = expected => {
    if (disposed || identity() !== expected) throw new win.DOMException('聊天已切换，生成已取消', 'AbortError');
  };
  // Called only by the fixed original forwarder, after its durable beforeDispatch
  // gate. The receipt stays in this closure, including for direct API routes.
  win.__dshSpQuietRequest=async function(messages,dispatch,signal){
    const captured=preparation;
    if(!captured)return dispatch(messages);
    if(captured.claimed)throw new Error('零层请求缺少当前准备，不能重发');
    assertCurrent(captured.scope);signal?.throwIfAborted();captured.claimed=true;
    await request('prepareTavernSpQuietPrompt',{operation:'dispatch',id:captured.id},captured.origin);
    let failed=true,attempted=false;
    try{assertCurrent(captured.scope);signal?.throwIfAborted();attempted=true;const result=await dispatch(messages);failed=false;return result}
    finally{await request('prepareTavernSpQuietPrompt',{operation:'complete',id:captured.id,failed,attempted},captured.origin)}
  };
  async function generate(kind = 'normal', options = {}, origin) {
    if (!['normal', 'quiet'].includes(kind)) throw new Error('此宿主入口仅支持普通发送与 quiet 生成');
    const scope = identity(); assertCurrent(scope);
    options.signal?.throwIfAborted();
    if (kind === 'normal') {
      await win.__dshTavernComposerReady;
      assertCurrent(scope);
      if (typeof win.__dshSubmitTavernComposer !== 'function') throw new Error('真实会话输入框尚未就绪');
      // The original package can reject this event before the authenticated
      // composer submits anything. Do not catch AbortError and send anyway.
      // Ordinary physical sends receive this event from the durable native
      // input journal. Only a live logical carrier needs the earlier gate;
      // otherwise listeners would receive the same admission twice.
      if(st.chat.some(row=>Object.hasOwn(row,'_acu_zero_layer_v1')&&row._acu_zero_layer_v1?.exitManifest?.phase!=='committed'))
        await st.eventSource.emit(st.eventTypes.GENERATION_AFTER_COMMANDS, kind, options, false);
      assertCurrent(scope);
      return win.__dshSubmitTavernComposer();
    }
    if (active) throw new Error('已有 quiet 生成正在进行');
    if (typeof options.quiet_prompt !== 'string') throw new TypeError('quiet_prompt 必须是字符串');
    const controller = new win.AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    active = controller;
    try {
      await st.eventSource.emit(st.eventTypes.GENERATION_AFTER_COMMANDS, kind, options, false);
      assertCurrent(scope); controller.signal.throwIfAborted();
      const prepared = await request('prepareTavernSpQuietPrompt', {quietPrompt:options.quiet_prompt},origin);
      assertCurrent(scope); controller.signal.throwIfAborted();
      if(typeof prepared?.id!=='string'||!Array.isArray(prepared?.messages))throw new Error('零层正文上下文尚未准备');
      preparation={id:prepared.id,scope,origin,claimed:false};
      const chat = prepared.messages;
      const prompt = { chat, dryRun: false };
      Object.defineProperty(prompt, 'prompt', { configurable: true, enumerable: true, get() { return this.chat; }, set(value) { this.chat = value; } });
      await st.eventSource.emit(st.eventTypes.CHAT_COMPLETION_PROMPT_READY, prompt, false);
      assertCurrent(scope); controller.signal.throwIfAborted();
      const body = { messages: prompt.chat, stream: false };
      await st.eventSource.emit(st.eventTypes.CHAT_COMPLETION_SETTINGS_READY, body);
      assertCurrent(scope); controller.signal.throwIfAborted();
      const response = await win.fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: st.getRequestHeaders(), body: JSON.stringify(body), signal: controller.signal });
      assertCurrent(scope); controller.signal.throwIfAborted();
      if (!response.ok) throw new Error('正文生成失败（HTTP ' + response.status + '）');
      const value = await response.json();
      assertCurrent(scope); controller.signal.throwIfAborted();
      const text = value?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error('正文模型未返回文本结果');
      return text;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (active === controller) { active = null; preparation = null; }
    }
  }
  st.generate = (kind,options) => {const origin=owner();return track(generate(kind,options,origin),origin);};
  st.stopGeneration = async function () {
    const stopped = active !== null;
    active?.abort(new win.DOMException('生成已停止', 'AbortError'));
    const helperStopped=win.stopAllGeneration?.()===true;
    if(stopped||helperStopped)await st.eventSource.emit(st.eventTypes.GENERATION_STOPPED);
    if(typeof win.__dshStopTavernComposer!=='function')throw new Error('当前会话停止入口不可用');
    await win.__dshStopTavernComposer();
    return true;
  };
  // History edits keep their existing authenticated mutation contract.
  st.deleteLastMessage = async function () {
    const last = st.chat.length - 1;
    if (last < 0) return;
    await win.deleteChatMessages([last]);
  };
  win.addEventListener('pagehide', () => { disposed = true; active?.abort(); }, { once: true });
  return { invalidate() { active?.abort(new win.DOMException('聊天已切换', 'AbortError')); } };
}
