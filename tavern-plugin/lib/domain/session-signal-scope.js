/** Validate before opening watchers; ownership is the current profile's conversation graph. */
export function scopedSessionSignals({transport,watch,listOwned}){
  return {async *follow(sessionIds,signal){
    if(!Array.isArray(sessionIds)||sessionIds.length>64||sessionIds.some(id=>typeof id!=='string'||!id||id.length>200))throw Error('信号订阅最多 64 个有效会话')
    const ids=[...new Set(sessionIds)],owned=new Set(await listOwned(ids))
    if(ids.some(id=>!owned.has(id)))throw Error('信号订阅包含不属于当前 Profile 的会话')
    const stops=[]
    try{for(const id of ids)stops.push(watch(id));yield*transport.follow(signal,ids)}finally{for(const stop of stops)stop()}
  }}
}
