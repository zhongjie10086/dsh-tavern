export const DISPLAY_CAPTURE_LIMITS = Object.freeze({ frames:16, bytes:4*1024*1024 })

/** Diagnostic captures are replaceable observations; keep the newest within a per-message budget. */
export function boundDisplayCaptures(frames) {
  if(frames.length && Buffer.byteLength(JSON.stringify(frames.at(-1)))>DISPLAY_CAPTURE_LIMITS.bytes)throw new Error('单条显示诊断超过 4 MiB，请减少诊断内容')
  const newest = frames.map((frame,index)=>({frame,index})).sort((a,b)=>Number(b.frame.capturedAt||0)-Number(a.frame.capturedAt||0)||b.index-a.index).slice(0,DISPLAY_CAPTURE_LIMITS.frames).map(row=>row.frame)
  let used=0
  const kept=[]
  for(const frame of newest){
    const bytes=Buffer.byteLength(JSON.stringify(frame))
    if(used+bytes>DISPLAY_CAPTURE_LIMITS.bytes)continue
    used+=bytes;kept.push(frame)
  }
  if(newest.length && !kept.length)throw new Error('单条显示诊断超过 4 MiB，请减少诊断内容')
  return kept.sort((a,b)=>a.partIndex-b.partIndex)
}
