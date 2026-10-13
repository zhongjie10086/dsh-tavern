import {AsyncLocalStorage} from 'node:async_hooks'

/** Readers are concurrent; maintenance waits for in-flight operations and excludes new ones. */
export function createMaintenanceGate(){
  const context=new AsyncLocalStorage(),maintenance=new AsyncLocalStorage(),queue=[],listeners=new Set()
  let readers=0,writer=false,revision=0,changes=0
  function changed(){
    revision++
    if(maintenance.getStore())return
    changes++
    for(const listener of listeners)try{listener(changes)}catch{}
  }
  function drain(){
    if(writer)return
    while(queue.length){
      const item=queue[0]
      if(item.mode==='write'&&readers)return
      queue.shift()
      if(item.mode==='write')writer=true;else readers++
      const lease={mode:item.mode,active:true}
      maintenance.run(item.maintenance,()=>context.run(lease,()=>Promise.resolve().then(item.operation)).finally(()=>{lease.active=false;if(item.mode==='write')changed();if(item.mode==='write')writer=false;else readers--;drain()}).then(item.resolve,item.reject))
      if(writer)return
    }
  }
  function run(mode,operation){
    const lease=context.getStore(),owner=lease?.active?lease.mode:null
    if(owner==='write'||owner==='read'&&mode==='read')return operation()
    if(owner==='read')throw Error('不能在写入操作中升级为独占清理')
    return new Promise((resolve,reject)=>{queue.push({mode,operation,resolve,reject,maintenance:maintenance.getStore()===true});drain()})
  }
  return {revision:()=>revision,changes:()=>changes,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
    runMaintenance:operation=>maintenance.run(true,operation),read:operation=>run('read',operation),write:operation=>run('write',operation),
    mutate:operation=>run('read',async()=>{changed();try{return await operation()}finally{changed()}})}
}
