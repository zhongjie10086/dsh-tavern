/** Coalesce writes, with a retry only while dirty/busy. Idle profiles do not poll. */
export function createRetentionScheduler({run,generation,subscribe,delay=300000,setTimer=setTimeout,clearTimer=clearTimeout,onError=()=>{}}){
 let timer,running=false,disposed=false,completed
 function schedule(){if(!disposed&&!running&&timer===undefined&&generation()!==completed){timer=setTimer(execute,delay);timer?.unref?.()}}
 async function execute(){
  timer=undefined;if(disposed||running||generation()===completed)return
  running=true;const before=generation()
  try{
   const result=await run({dryRun:false,automatic:true})
   if(!['busy','changed'].includes(result?.status)&&generation()===before)completed=before
  }catch(error){onError(error)}finally{running=false;schedule()}
 }
 const unsubscribe=subscribe(schedule);schedule()
 return{dispose(){disposed=true;unsubscribe();if(timer!==undefined)clearTimer(timer);timer=undefined}}
}
