// Installed only in the service-owned template page. Awaited timers work during
// an operation; detached timers cannot carry its captured variables into another.
export function installTemplateOperationTimers() {
  const native={setTimeout:window.setTimeout.bind(window),setInterval:window.setInterval.bind(window),clearTimeout:window.clearTimeout.bind(window),clearInterval:window.clearInterval.bind(window),requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window)}
  const timers=new Map()
  for(const [start,stop,repeats] of [['setTimeout','clearTimeout',false],['setInterval','clearInterval',true],['requestAnimationFrame','cancelAnimationFrame',false]]) {
    window[start]=(callback,...args)=>{
      const epoch=window.__dshTemplateEpoch
      let id
      id=native[start]((...values)=>{
        if(!repeats)timers.delete(stop+':'+id)
        if(epoch!==window.__dshTemplateEpoch||epoch===null)return
        if(typeof callback==='function')callback(...values)
        else window.eval(String(callback))
      },...args)
      timers.set(stop+':'+id,{id,stop});return id
    }
    window[stop]=id=>{timers.delete(stop+':'+id);native[stop](id)}
  }
  window.__dshEndTemplateOperation=()=>{
    window.__dshTemplateEpoch=null
    for(const {id,stop}of timers.values())native[stop](id)
    timers.clear()
    window.__dshEnvironment=null
  }
}
