import {COMPATIBILITY_CAPABILITIES} from './card-permissions.js'

/** A bounded, process-local record of grantable failures. Never stores request data. */
export function createPermissionDenials({maxSessions=64,maxRows=128,now=Date.now,onChange=()=>{}}={}) {
 const sessions=new Map(),allowed=new Set(COMPATIBILITY_CAPABILITIES)
 function record({sessionId,scriptId,capability,method}) {
  if(!sessionId||!scriptId||!allowed.has(capability))return
  let session=sessions.get(sessionId)
  if(!session){session={rows:new Map(),notifiedAt:0};sessions.set(sessionId,session)}
  sessions.delete(sessionId);sessions.set(sessionId,session)
  while(sessions.size>maxSessions)sessions.delete(sessions.keys().next().value)
  const key=JSON.stringify([scriptId,capability]),prior=session.rows.get(key),at=now()
  session.rows.delete(key);session.rows.set(key,{scriptId,capability,method:String(method||'').slice(0,100),attempts:Math.min(1000000,(prior?.attempts||0)+1),firstAt:prior?.firstAt??at,lastAt:at})
  while(session.rows.size>maxRows)session.rows.delete(session.rows.keys().next().value)
  if(!prior||at-session.notifiedAt>=1000){session.notifiedAt=at;onChange(sessionId)}
 }
 return {record,read:sessionId=>structuredClone([...(sessions.get(sessionId)?.rows.values()||[])])}
}

export function projectPermissionDenials(rows,{scripts=[],cardPolicy={},scriptPolicies={}}={}) {
 const names=new Map(scripts.map(script=>[script.id,script.name]))
 const active=rows.flatMap(row=>{
  const special=['__dsh_message__','__dsh_official_mvu__'].includes(row.scriptId)
  if(!special&&!names.has(row.scriptId))return []
  const policy=special?cardPolicy:scriptPolicies[row.scriptId]
  if(policy?.capabilities?.includes(row.capability))return []
  return [{...row,name:special?(row.scriptId==='__dsh_message__'?'人物卡显示内容':'官方 MVU'):names.get(row.scriptId)}]
 })
 return {count:active.length,rows:active}
}
