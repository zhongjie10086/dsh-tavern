/** Run pinned Monaco workers on the host origin; keep the editable iframe opaque. */
function createTavernTemplateWorker(window,token,label,parentOrigin=window.location.origin) {
  if (!/^https?:\/\//.test(parentOrigin) || new window.URL(parentOrigin).origin !== parentOrigin) throw new Error('模板编辑器宿主来源无效');
  const channel=new window.MessageChannel();let disposed=false;
  class EditorWorker extends window.EventTarget {
    postMessage(value,transfer=[]){if(disposed)return;channel.port1.postMessage({kind:'post',value,transfer},transfer);}
    terminate(){if(disposed)return;disposed=true;channel.port1.postMessage({kind:'close'});channel.port1.close();}
  }
  const proxy=new EditorWorker();
  channel.port1.onmessage=event=>{
    if(disposed)return;
    const data=event.data;
    if(data.kind==='message'){const message=new window.MessageEvent('message',{data:data.value});proxy.dispatchEvent(message);proxy.onmessage?.(message);}
    else if(data.kind==='error'){const error=new window.ErrorEvent('error',{message:data.message||'模板编辑器后台任务失败',error:new Error(data.message||'模板编辑器后台任务失败')});proxy.dispatchEvent(error);proxy.onerror?.(error);}
  };
  window.parent.postMessage({type:'dsh-template-worker-create',token,label},parentOrigin,[channel.port2]);
  window.addEventListener('pagehide',()=>proxy.terminate(),{once:true});return proxy;
}
function createTavernTemplateWorkerService(window,frame,token) {
  const active=new Set();let disposed=false;
  function receive(event){const data=event.data;if(disposed||event.source!==frame.contentWindow||data?.token!==token||data.type!=='dsh-template-worker-create')return;
    const port=event.ports?.[0];if(!port)return;
    if(!['typescript','javascript','editorWorkerService'].includes(data.label)){port.postMessage({kind:'error',message:'模板编辑器请求了未知后台任务'});port.close();return;}
    if(active.size>=8){port.postMessage({kind:'error',message:'模板编辑器后台任务超过 8 个'});port.close();return;}
    let worker,closed=false;
    const close=()=>{if(closed)return;closed=true;worker?.terminate();port.close();active.delete(close);};
    try {worker=new window.Worker(window.location.origin+'/api/dsh-tavern/vendor/st-prompt-template/'+(data.label==='editorWorkerService'?'editor.worker.js':'ts.worker.js'),{type:'module',name:'dsh-template-'+data.label});}
    catch(error){port.postMessage({kind:'error',message:error.message});close();return;}
    active.add(close);
    worker.addEventListener('message',event=>{if(!closed)port.postMessage({kind:'message',value:event.data});});
    worker.addEventListener('error',event=>{if(!closed)port.postMessage({kind:'error',message:event.message||'模板编辑器 Worker 无法启动'});});
    port.onmessage=event=>{const data=event.data;if(data?.kind==='close')close();else if(data?.kind==='post'&&!closed)worker.postMessage(data.value,data.transfer||[]);};
  }
  window.addEventListener('message',receive);
  return {dispose(){disposed=true;window.removeEventListener('message',receive);for(const close of [...active])close();},get size(){return active.size;}};
}
