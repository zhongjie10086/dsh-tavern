import {createHash} from 'node:crypto'
const metadata=new Set(['id','name','at','turn','purpose','stateDigest','coalescingKey'])
export function spRecoveryDigest(row){return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>!metadata.has(key))))).digest('hex')}
/** Only explicitly tagged automatic copies are limited. Legacy/manual/floor
 * records remain restorable; their purpose cannot be inferred from a user name. */
export function retainSpRecoverySnapshots(rows,maximum=3){
 const counts=new Map(),seen=new Set(),result=[]
 for(const row of rows.toReversed()){
  if(row.purpose!=='automatic'){result.push(row);continue}
  const scope=row.isolation||'main',digest=spRecoveryDigest(row),identity=scope+':'+digest,count=counts.get(scope)||0
  if(seen.has(identity)||count>=maximum)continue
  seen.add(identity);counts.set(scope,count+1);result.push({...row,stateDigest:digest})
 }
 return result.reverse()
}
