/** Time without received bytes, not total generation time. The caller owns disposal. */
export function createModelIdleWatchdog(parent,{idleTimeoutMs=300000}={}){
 if(!Number.isFinite(idleTimeoutMs)||idleTimeoutMs<=0)throw Error('模型空闲超时无效')
 const controller=new AbortController();let timer,disposed=false
 const signal=controller.signal
 function touch(){
  clearTimeout(timer)
  if(disposed||signal.aborted)return
  timer=setTimeout(()=>controller.abort(Object.assign(new Error('模型接口长时间没有返回新数据，已停止等待；已收到的正文仍保留。'),{code:'MODEL_IDLE_TIMEOUT'})),idleTimeoutMs);timer.unref?.()
 }
 const abort=()=>controller.abort(parent.reason)
 if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true})
 touch()
 function monitor(response){
  if(!response.body)return response
  const reader=response.body.getReader();let ended=false,listener
  const detach=()=>signal.removeEventListener('abort',listener)
  const body=new ReadableStream({
   start(target){
    listener=()=>{if(ended)return;ended=true;detach();target.error(signal.reason);void reader.cancel(signal.reason).catch(()=>{})}
    if(signal.aborted)listener();else signal.addEventListener('abort',listener,{once:true})
   },
   async pull(target){
    try{const chunk=await reader.read();if(ended)return;if(chunk.done){ended=true;detach();target.close();return}if(chunk.value.byteLength)touch();target.enqueue(chunk.value)}
    catch(error){if(!ended){ended=true;detach();target.error(error)}}
   },
   cancel(reason){ended=true;detach();return reader.cancel(reason)}
  })
  touch();return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers})
 }
 return {signal,touch,monitor,dispose(){disposed=true;clearTimeout(timer);parent?.removeEventListener('abort',abort)}}
}
