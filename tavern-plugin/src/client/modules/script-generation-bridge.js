function installTavernGenerationBridge(win, call, events, identity = () => ({}), beforeGenerate = async () => {}) {
  const active = new Map();
  const names = win.iframe_events || {};
  async function generate(config = {}, raw) {
    const request = Object.assign({}, config);
    const owner = identity(), invoke = (method,args) => call(method,args,owner);
    async function image(value) {
      if (Array.isArray(value)) return await Promise.all(value.map(image));
      if (!(value instanceof win.Blob)) return value;
      return await new Promise((resolve, reject) => { const reader = new win.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(value); });
    }
    request.image = await image(request.image);
    if (request.ordered_prompts) request.ordered_prompts = await Promise.all(request.ordered_prompts.map(async p => typeof p === 'object' && p.image ? { ...p, image: await image(p.image) } : p));
    const id = String(request.generation_id || win.crypto?.randomUUID?.() || ('helper-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
    if (active.has(id)) throw new Error('生成 ID 已存在');
    request.generation_id = id;
    const job = { stopped: false, started: false, invoke };
    active.set(id, job); let offset = 0, text = '';
    try {
      await beforeGenerate(owner);
      await invoke('startTavernHelperGeneration', { config: request, raw });
      job.started = true;
      if (job.stopped) { await invoke('stopTavernHelperGeneration', { id }); throw new Error('生成已停止'); }
      await events.emit(names.GENERATION_STARTED || 'js_generation_started', id);
      while (true) {
        const state = await invoke('pollTavernHelperGeneration', { id, offset });
        offset = state.offset;
        if (state.delta) {
          text += state.delta;
          if (config.should_stream) {
            await events.emit(names.STREAM_TOKEN_RECEIVED_INCREMENTALLY || 'js_stream_token_received_incrementally', state.delta, id);
            await events.emit(names.STREAM_TOKEN_RECEIVED_FULLY || 'js_stream_token_received_fully', text, id);
          }
        }
        if (state.status !== 'running') {
          if (state.status !== 'completed') throw new Error(state.error || '生成已停止');
          if (job.stopped) throw new Error('生成已停止');
          let result = state.result;
          if (typeof result === 'string') {
            const payload = { message: result };
            await events.emit('js_generation_before_end', payload, id);
            if (typeof payload.message !== 'string') throw new Error('生成结束处理必须保留文本结果');
            result = payload.message;
          }
          await events.emit(names.GENERATION_ENDED || 'js_generation_ended', result, id);
          return result;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally { active.delete(id); }
  }
  win.generateRaw = config => generate(config, true);
  win.generate = config => generate(config, false);
  win.stopGenerationById = id => {
    const job = active.get(String(id));
    if (!job || job.stopped) return false;
    job.stopped = true;
    if (job.started) void job.invoke('stopTavernHelperGeneration', { id: String(id) }).catch(error => win.console.error(error));
    return true;
  };
  win.stopAllGeneration = () => { let stopped = false; for (const id of active.keys()) stopped = win.stopGenerationById(id) || stopped; return stopped; };
  win.getModelList = async api => (await call('listTavernHelperModels', { api })).models;
  // ST's fetch endpoint preserves the caller's exact message list and does not
  // emit Helper prompt-rewrite events. Ownership/cancellation use the same service.
  win.__dshStGenerateRequest = async function(body, signal, options={}) {
    signal?.throwIfAborted();
    const owner=identity(), invoke=(method,args)=>call(method,args,owner), id=win.crypto.randomUUID();
    const job={stopped:false,started:false,invoke};active.set(id,job);
    let started=false,aborted=false,finished=false;
    const abort=()=>{aborted=true;if(started&&!finished)void invoke('stopTavernHelperGeneration',{id}).catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    const check=()=>{if(aborted||job.stopped)throw new win.DOMException('生成已取消','AbortError');};
    const cleanup=()=>{finished=true;active.delete(id);signal?.removeEventListener('abort',abort);};
    try {
      await invoke(options.main?'startTavernFrontendMainGeneration':'startTavernFrontendGeneration',{body:{...body,generation_id:id}});started=true;job.started=true;
      if(aborted||job.stopped){await invoke('stopTavernHelperGeneration',{id});check();}
      async function consume(onDelta) {
        let offset=0;
        while(true){check();const state=await invoke('pollTavernHelperGeneration',{id,offset});check();offset=state.offset;
          if(state.delta)onDelta(state.delta);
          if(state.status!=='running'){if(state.status!=='completed')throw Error(state.error||'生成未完成');if(typeof state.result!=='string')throw Error('扩展生成需要文本结果');return state.result;}
          await new Promise(resolve=>win.setTimeout(resolve,100));
        }
      }
      if(!body.stream){try{return new win.Response(JSON.stringify({choices:[{message:{role:'assistant',content:await consume(()=>{})}}]}),{headers:{'content-type':'application/json'}});}finally{cleanup();}}
      const encoder=new win.TextEncoder();
      const stream=new win.ReadableStream({start(controller){void consume(delta=>controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:delta}}]})+'\n\n'))).then(()=>{controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();},error=>controller.error(error)).finally(cleanup);},cancel(){abort();}});
      return new win.Response(stream,{headers:{'content-type':'text/event-stream'}});
    } catch(error){cleanup();throw error;}
  };
  return { stop: win.stopAllGeneration };
}
