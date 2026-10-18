function installTavernGenerationBridge(win, call, events, identity = () => ({}), beforeGenerate = async () => {}, track = promise => promise) {
  const active = new Map();
  const names = win.iframe_events || {};
  win.__dshTavernGenerationBusy = () => active.size > 0;
  async function generate(config = {}, raw, owner = identity()) {
    const request = Object.assign({}, config);
    const invoke = (method,args) => call(method,args,owner);
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
          await invoke('pollTavernHelperGeneration', { id, offset, received: true });
          return result;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally { active.delete(id); }
  }
  win.generateRaw = config => { const owner=identity();return track(generate(config, true, owner),owner); };
  win.generate = config => { const owner=identity();return track(generate(config, false, owner),owner); };
  win.stopGenerationById = id => {
    const job = active.get(String(id));
    if (!job || job.stopped) return false;
    job.stopped = true;
    job.cancel?.();
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
    let complete,fail;
    const completion=new Promise((resolve,reject)=>{complete=resolve;fail=reject});
    track(completion,owner);void completion.catch(()=>{});
    let started=false,aborted=false,finished=false;
    const abort=()=>{aborted=true;if(started&&!finished)void invoke('stopTavernHelperGeneration',{id}).catch(()=>{});cleanup(new win.DOMException('生成已取消','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    const check=()=>{if(aborted||job.stopped)throw new win.DOMException('生成已取消','AbortError');};
    const cleanup=error=>{if(finished)return;finished=true;active.delete(id);signal?.removeEventListener('abort',abort);if(error)fail(error);else complete();};
    job.cancel=()=>cleanup(new win.DOMException('生成已取消','AbortError'));
    // Observe only this generation's native Response/streams. Receiving the
    // model is not consuming its body, and consuming it is not a saved script
    // event. Keep those receipts separate and bound to the captured owner.
    const observedStreams=new WeakSet();
    function consumed(work,done=()=>true){
      let result;try{result=work()}catch(error){cleanup(error);throw error}
      return track(Promise.resolve(result).then(value=>{if(done(value))cleanup();return value},error=>{cleanup(error);throw error}),owner);
    }
    function observeStream(stream){
      if(!stream||observedStreams.has(stream))return stream;
      observedStreams.add(stream);
      const getReader=stream.getReader,values=stream.values,pipeTo=stream.pipeTo,pipeThrough=stream.pipeThrough,tee=stream.tee,cancel=stream.cancel;
      Object.defineProperty(stream,'getReader',{configurable:true,value(...args){const reader=getReader.apply(stream,args),read=reader.read,cancel=reader.cancel;
        Object.defineProperty(reader,'read',{configurable:true,value(...args){return consumed(()=>read.apply(reader,args),value=>value.done===true)}});
        Object.defineProperty(reader,'cancel',{configurable:true,value(...args){return consumed(()=>cancel.apply(reader,args),()=>{cleanup(new win.DOMException('生成已取消','AbortError'));return false})}});
        // releaseLock only relinquishes a reader; it does not consume a body.
        return reader;
      }});
      if(values){const iterator=(...args)=>{const value=values.apply(stream,args);for(const name of ['next','return','throw'])if(typeof value[name]==='function'){const original=value[name];Object.defineProperty(value,name,{configurable:true,value(...args){return consumed(()=>original.apply(value,args),row=>{if(name==='return'){cleanup(new win.DOMException('生成已取消','AbortError'));return false}return row.done===true})}})}return value};Object.defineProperty(stream,'values',{configurable:true,value:iterator});Object.defineProperty(stream,Symbol.asyncIterator,{configurable:true,value:iterator})}
      Object.defineProperty(stream,'cancel',{configurable:true,value(...args){return consumed(()=>cancel.apply(stream,args),()=>{cleanup(new win.DOMException('生成已取消','AbortError'));return false})}});
      Object.defineProperty(stream,'pipeTo',{configurable:true,value(...args){return consumed(()=>pipeTo.apply(stream,args))}});
      Object.defineProperty(stream,'pipeThrough',{configurable:true,value(...args){return observeStream(pipeThrough.apply(stream,args))}});
      Object.defineProperty(stream,'tee',{configurable:true,value(...args){return tee.apply(stream,args).map(observeStream)}});
      return stream;
    }
    function observeResponse(response){
      for(const name of ['json','text','arrayBuffer','blob','formData','bytes'])if(typeof response[name]==='function'){const original=response[name];Object.defineProperty(response,name,{configurable:true,value(...args){return consumed(()=>original.apply(response,args))}})}
      const clone=response.clone;Object.defineProperty(response,'clone',{configurable:true,value(...args){return observeResponse(clone.apply(response,args))}});
      observeStream(response.body);return response;
    }
    try {
      await invoke(options.main?'startTavernFrontendMainGeneration':'startTavernFrontendGeneration',{body:{...body,generation_id:id}});started=true;job.started=true;
      if(aborted||job.stopped){await invoke('stopTavernHelperGeneration',{id});check();}
      async function consume(onDelta) {
        let offset=0;
        while(true){check();const state=await invoke('pollTavernHelperGeneration',{id,offset});check();offset=state.offset;
          if(state.delta)onDelta(state.delta);
          if(state.status!=='running'){if(state.status!=='completed')throw Error(state.error||'生成未完成');const result=state.result;
            if(typeof result!=='string'&&!(owner.scriptId==='extension-sp-database'&&result&&typeof result.content==='string'&&Array.isArray(result.tool_calls)&&result.tool_calls.length&&result.tool_calls.every(call=>call?.type==='function'&&typeof call.id==='string'&&typeof call.function?.name==='string'&&typeof call.function.arguments==='string')))throw Error('扩展生成返回格式无效');
            await invoke('pollTavernHelperGeneration',{id,offset,received:true});return result;}
          await new Promise(resolve=>win.setTimeout(resolve,100));
        }
      }
      if(!body.stream){try{const result=await consume(()=>{}),message=typeof result==='string'?{role:'assistant',content:result}:{role:'assistant',content:result.content,tool_calls:result.tool_calls};return observeResponse(new win.Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}}))}catch(error){cleanup(error);throw error;}}
      const encoder=new win.TextEncoder();
      const stream=new win.ReadableStream({start(controller){void consume(delta=>controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:delta}}]})+'\n\n'))).then(result=>{if(typeof result!=='string')controller.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{tool_calls:result.tool_calls.map((call,index)=>({index,...call}))},finish_reason:'tool_calls'}]})+'\n\n'));controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();},error=>{controller.error(error);cleanup(error);});},cancel(){abort();}});
      return observeResponse(new win.Response(stream,{headers:{'content-type':'text/event-stream'}}));
    } catch(error){cleanup(error);throw error;}
  };
  return { stop: win.stopAllGeneration };
}
