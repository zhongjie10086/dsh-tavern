function installTavernFileBridge(win, call) {
  const originalFetch = win.fetch.bind(win);
  const response = value => new win.Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  const pending = new Set();
  const request = operation => { const task = call('tavernScriptFiles', { operation }); pending.add(task); task.finally(() => pending.delete(task)).catch(() => {}); return task; };
  win.__dshTavernFilesReady = async () => { do { await Promise.allSettled([...pending]); await new Promise(resolve => win.setTimeout(resolve, 100)); } while (pending.size); };
  win.__dshApplyMainConnection=async(settings,secretId)=>{const prior=(await call('tavernHelperIzumiConnection',{command:{kind:'read'}})).config;return call('tavernHelperIzumiConnection',{command:{kind:'save',config:{...prior,apiUrl:settings.custom_url,model:settings.custom_model,postProcessing:settings.custom_prompt_post_processing||'',includeBody:settings.custom_include_body||'',excludeBody:settings.custom_exclude_body||'',includeHeaders:settings.custom_include_headers||'',secretId}}})};
  win.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), win.document.baseURI);
    const local = url.origin === new URL(win.document.baseURI).origin;
    if(local&&url.pathname==='/api/backends/chat-completions/generate') {
      try {
        if(String(init.method||'GET').toUpperCase()!=='POST'||typeof init.body!=='string')throw Error('模型请求必须使用 JSON POST');
        const body=JSON.parse(init.body),source=body?.chat_completion_source;
        // A native host connection has no separately configured endpoint or
        // credentials. Explicit and incomplete custom connections must still
        // reach the independent-API validator rather than use the main model.
        const independent=['reverse_proxy','proxy_password','custom_url','custom_include_headers','api_key','apiKey','api_url','base_url','baseURL','headers','authorization','azure_base_url'];
        const main=body&&typeof body==='object'&&!Array.isArray(body)&&(source===undefined||source==='')&&!independent.some(key=>Object.prototype.hasOwnProperty.call(body,key));
        return await win.__dshStGenerateRequest(body,init.signal,{main:!!main});
      }
      catch(error){if(error.name==='AbortError')throw error;return new win.Response(JSON.stringify({error:error.message}),{status:400,headers:{'content-type':'application/json'}});}
    }
    // Upstream galleries fetch the stored ST path when exporting, not the displayed img URL.
    if (local && /^\/user\/images\/unified-statusbar\/[^/]+$/.test(url.pathname)) {
      url.pathname = url.pathname.replace('/user/images/unified-statusbar/', '/api/dsh-tavern/script-images/');
      const redirected = win.Request && input instanceof win.Request ? new win.Request(url.href, input) : url.href;
      return originalFetch(redirected, init);
    }
    if(local&&['/api/settings/get','/api/presets/save','/api/presets/delete'].includes(url.pathname)){try{const body=JSON.parse(typeof init.body==='string'?init.body:'{}');return response(await win.__dshNativePresetRequest(url.pathname,body))}catch(error){return new win.Response(JSON.stringify({error:error.message}),{status:409,headers:{'content-type':'application/json'}})}}
    const body = local && (/^\/api\/(files|secrets|chats|characters|groups|images)\//.test(url.pathname)) && typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    if(local&&/^\/api\/(chats|characters|groups)\//.test(url.pathname)){try{return response((await call('tavernHelperChatFiles',{operation:{path:url.pathname,body}})).value)}catch(error){return new win.Response(JSON.stringify({error:String(error.message)}),{status:400,headers:{'content-type':'application/json'}})}}
    if(local&&['/api/images/upload','/api/images/delete'].includes(url.pathname)){try{return response(await call('tavernScriptImages',{operation:{...body,kind:url.pathname.endsWith('/upload')?'upload':'delete'}}))}catch(error){return new win.Response(JSON.stringify({error:error.message}),{status:400})}}
    if(local&&url.pathname==='/api/secrets/write'){const r=await call('tavernHelperIzumiConnection',{command:{kind:'secret',value:body.value,label:body.label}});return response(r);}
    if(local&&url.pathname==='/api/secrets/delete')return response(await call('tavernHelperIzumiConnection',{command:{kind:'delete-secret',id:body.id}}));
    if(local&&url.pathname==='/api/secrets/read')return response(await call('tavernHelperIzumiConnection',{command:{kind:'secrets'}}));
    if (local && url.pathname === '/api/files/upload') return response(await request({ kind: 'write', name: body.name, data: body.data }));
    if (local && url.pathname === '/api/files/verify') return response(await request({ kind: 'verify', paths: body.urls }));
    if (local && url.pathname === '/api/files/delete') return response(await request({ kind: 'delete', path: body.path }));
    if (local && /^\/user\/files\/[^/]+$/.test(url.pathname)) {
      try {
        const result = await request({ kind: 'read', path: url.pathname });
        if (result.missing) return new win.Response('文件不存在', { status: 404 });
        const bytes = Uint8Array.from(win.atob(result.data), char => char.charCodeAt(0));
        return new win.Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) { return new win.Response(String(error.message), { status: 404 }); }
    }
    return originalFetch(input, init);
  };
  return () => { win.fetch = originalFetch; };
}
