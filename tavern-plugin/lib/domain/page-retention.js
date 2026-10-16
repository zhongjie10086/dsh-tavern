import {safePagePath,pageIdentity,ensurePageDirectory} from './page-path-safety.js'
import path from 'node:path'
import {rename,rm,readFile} from 'node:fs/promises'
import {createDurableFilePromotion} from '../durable-file-promotion.js'
import {writePageAuthority} from './page-chat-records.js'

const hash=/^[a-f0-9]{64}$/
const expired=()=>Object.assign(Error('Chat revision expired by retention policy'),{code:'DSH_TAVERN_REVISION_EXPIRED'})
export {expired as expiredPageRevision}
/** Enumerate only understood graph edges. An unknown schema cancels collection. */
const graphCaches=new Map()
function graphCache(root){if(!graphCaches.has(root)){if(graphCaches.size>=4)graphCaches.delete(graphCaches.keys().next().value);graphCaches.set(root,new Map())}return graphCaches.get(root)}
export async function pageClosure(pages,id,roots,{boundaries,old,cache=graphCache(pages.root)}={}){
 const seen=new Set()
 async function visit(ref,withinOld=false){
  if(!ref)return
  if(!hash.test(ref))throw Error('Invalid retained block reference')
  if(seen.has(ref))return;seen.add(ref)
  if(old?.has(ref)&&!withinOld)boundaries?.add(ref)
  const shared=withinOld||old?.has(ref)
  if(cache.has(ref)){for(const child of cache.get(ref))await visit(child,shared);return}
  const file=path.join(pages.root,id,'blocks',ref.slice(0,2),ref+'.json');await safePagePath(pages.root,file)
  const node=await pages.store.readBlock(id,ref),children=[]
  async function edge(child){if(child)children.push(child);await visit(child,shared)}
  switch(node.kind){
   case 'head': for(const key of ['root','stateId','metadataId','recordRoot'])await edge(node[key]);break
   case 'index': for(const ref of node.children)await edge(ref);break
   case 'page':for(const message of node.messages){if(!hash.test(message.ref))throw Error('Unknown page message schema');await edge(message.ref)}break
   case 'state':await edge(node.value.headerRef);break
   case 'metadata':if(node.value.kind!=='tavern-chat-records-v1')throw Error('Unknown metadata schema');break
   case 'entry':await edge(node.valueRef);break
   case 'entries':for(const ref of Object.values(node.children))await edge(ref);break
   case 'record':{
    const value=node.value
    if(value.type==='object'||value.type==='array')await edge(value.entries)
    else if(value.type==='branches')for(const ref of Object.values(value.children))await edge(ref)
    else if(value.type==='bucket')for(const [,link] of value.items)await edge(link.ref)
    else if(value.type!=='scalar')throw Error('Unknown record schema; retain graph')
    break
   }
   default:throw Error('Unknown page block schema; retain graph')
  }
  if(cache.size>=65536)cache.delete(cache.keys().next().value)
  cache.set(ref,children)
 }
 for(const root of roots)await visit(root)
 return seen
}
const protectionKey=values=>JSON.stringify([...new Set(values)].map(Number).sort((a,b)=>a-b))
/** Called under the existing per-chat mutation lease and profile maintenance lease. */
export async function retainPageRevisions(options){
 const read=options.read||((operation)=>operation()),planned=await read(()=>options.pages.store.withRead(()=>retain({...options,dryRun:true})))
 if(options.dryRun!==false)return planned
 if(!planned.prepared)return planned
 const publish=()=>options.pages.store.tryMaintenance(()=>retain({...options,dryRun:false,prepared:planned.prepared}))
 return (options.commit||((operation)=>operation()))(publish)
}
async function retain({pages,id,protectedRevisions=[],latestProtections=async()=>protectedRevisions,dryRun=true,prepared}){
 const routeFile=pages.routePath(id);await safePagePath(pages.root,routeFile)
 if(prepared)protectedRevisions=prepared.protectedRevisions
 const route=prepared?.route||await pages.route(id,{required:true}),protectedSet=new Set(protectedRevisions.map(Number)),ordinary=[]
 for(const revision of Object.keys(route.revisionRoots).map(Number).sort((a,b)=>b-a)){
  if(revision===route.storageRevision||protectedSet.has(revision)||route.revisionKinds?.[revision]!=='ordinary')continue
  ordinary.push(revision)
 }
 const summary={ordinary:Math.min(3,ordinary.length),ordinaryBefore:ordinary.length,protected:Object.keys(route.revisionRoots).length-ordinary.length,expired:0,quarantine:0,confirmedFreedFiles:0,confirmedFreedBytes:0}
 const revisions=ordinary.slice(3),removed=new Set(revisions)
 summary.newlyExpired=revisions.length;summary.expired=new Set([...(route.expiredRevisions||[]),...revisions]).size
 const dir=path.dirname(pages.routePath(id)),quarantine=path.join(dir,'retention-quarantine'),receiptPath=path.join(dir,'retention-gc.json'),files=createDurableFilePromotion()
 const block=ref=>path.join(dir,'blocks',ref.slice(0,2),ref+'.json'),isolated=ref=>path.join(quarantine,ref+'.json')
 async function receipt(value){await safePagePath(pages.root,dir,{directory:true});await writePageAuthority(files,receiptPath,value)}
 async function currentMatches(expectedGeneration,expectedRoots,expectedProtection){await safePagePath(pages.root,routeFile);const latest=await pages.route(id,{required:true});return latest.generation===expectedGeneration&&JSON.stringify(latest.revisionRoots)===JSON.stringify(expectedRoots)&&protectionKey(await latestProtections())===expectedProtection}
 async function inspect(ref,isolatedPath=false){const target=isolatedPath?isolated(ref):block(ref),info=await safePagePath(pages.root,target);return {ref,bytes:Number(info.size),nlink:Number(info.nlink),identity:pageIdentity(info),allocatedBytes:info.blocks===undefined?0:Number(info.blocks)*512}}
 async function verifyRefs(refs){for(const ref of refs){await safePagePath(pages.root,block(ref));await pages.store.readBlock(id,ref)}}
 async function purge(record){
  for(const ref of record.refs){const target=isolated(ref);let row;try{row=await inspect(ref,true)}catch(error){if(error.code==='ENOENT')continue;throw error}
   const expected=record.identities?.[ref];if(!expected||row.identity!==expected)throw Error('Quarantined block identity changed; purge cancelled')
   if(!await currentMatches(record.generation,record.routeRoots,record.protectionKey))throw Error('Live roots/protections changed before purge')
   await rm(target);summary.confirmedFreedFiles++;if(row.nlink===1)summary.confirmedFreedBytes+=row.allocatedBytes
  }
 }
 if(prepared&&!await currentMatches(route.generation,route.revisionRoots,protectionKey(protectedRevisions)))return {dryRun:false,status:'changed',files:[],bytes:0,summary}
 // Interrupted isolation is restored before re-planning; interrupted purge is
 // safe to finish only after verifying every surviving root against disk.
 let recoveredRefs=[],prior;try{await safePagePath(pages.root,receiptPath);prior=JSON.parse(await readFile(receiptPath,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 if(route.pendingGC&&(!prior||route.pendingGC.generation>prior.generation))prior=route.pendingGC
 if(prior?.status==='restored-pending')for(const ref of prior.refs)if(await safePagePath(pages.root,block(ref),{missing:true}))recoveredRefs.push(ref)
 if(prior&&prior.status!=='purged'&&prior.status!=='restored'&&prior.status!=='restored-pending'){
  if(prior.kind!=='page-retention-gc-v1'||!Array.isArray(prior.refs)||!prior.refs.every(ref=>hash.test(ref)))throw Error('Unknown GC receipt; retained')
  if(dryRun)return Object.defineProperty({dryRun,files:[],bytes:0,status:'recovery-pending',summary:{...summary,quarantine:prior.refs.length}},'prepared',{value:{route,protectedRevisions,recovery:true}})
  if(prior.status==='verified'){
   summary.quarantine=prior.refs.length
   if(!await currentMatches(prior.generation,prior.routeRoots,prior.protectionKey)){await receipt({...prior,status:'needs-replan'});return {dryRun:false,status:'changed',reason:'recovery-root-or-protection-drift',files:[],bytes:0,summary}}
   await verifyRefs(prior.verificationRefs||[])
   await purge(prior)
   await receipt({...prior,status:'purged'});summary.quarantine=0
  }else {
   if(protectedRevisions.some(revision=>route.expiredRevisions?.includes(Number(revision))))return {dryRun:false,status:'protected',reason:'expired-revision-protection-requires-recovery',files:[],bytes:0,summary:{...summary,quarantine:prior.refs.length}}
   for(const ref of prior.refs){try{await safePagePath(pages.root,isolated(ref));const original=await safePagePath(pages.root,block(ref),{missing:true});if(original)throw Error('Restoring GC block would overwrite an existing path');await rename(isolated(ref),block(ref))}catch(error){if(error.code!=='ENOENT')throw error}}
   for(const ref of prior.refs)if(await safePagePath(pages.root,block(ref),{missing:true}))recoveredRefs.push(ref);await receipt({...prior,status:'restored-pending'});return {dryRun:false,status:'changed',reason:'isolation-restored-replan',files:[],bytes:0,summary}
  }
 }
 if(!revisions.length&&!recoveredRefs.length)return {dryRun,revisions:[],files:[],bytes:0,logicalBytes:0,summary}
 let frontier,verificationRefs,candidates,rows
 if(prepared){({frontier,verificationRefs,candidates,rows}=prepared);summary.protectedWithoutProvenance=prepared.summary?.protectedWithoutProvenance||0}else{
 const provenance=new Set(),eligible=[]
 for(const revision of revisions){const refs=route.revisionBlocks?.[revision];if(!Array.isArray(refs)||!refs.every(ref=>hash.test(ref)))continue;eligible.push(revision);for(const ref of refs)provenance.add(ref)}
 // A path first created by a later commit cannot occur in an older immutable
 // root. Only roots at/after this creation frontier can share candidate paths.
 // Missing provenance grants no deletion authority over historical payloads.
 frontier=eligible.length?Math.min(...eligible):Infinity;const affectedRoots=Object.entries(route.revisionRoots).filter(([revision])=>!removed.has(Number(revision))&&Number(revision)>=(recoveredRefs.length?(prior?.frontier??0):frontier)).map(([,ref])=>ref)
 const old=new Set([...provenance,...recoveredRefs]),boundaries=new Set(),retained=await pageClosure(pages,id,affectedRoots,{old,boundaries});candidates=[...old].filter(ref=>!retained.has(ref));verificationRefs=[...new Set([...affectedRoots,...boundaries])]
 summary.protectedWithoutProvenance=revisions.length-eligible.length
 rows=[];for(const ref of candidates){rows.push(await inspect(ref))}
 }
 if(dryRun){const result={dryRun,revisions,files:rows,bytes:rows.reduce((sum,row)=>sum+(row.nlink===1?row.allocatedBytes:0),0),logicalBytes:rows.reduce((sum,row)=>sum+row.bytes,0),summary};return Object.defineProperty(result,'prepared',{value:{route,protectedRevisions,frontier,verificationRefs,candidates,rows,summary}})}
 if(protectionKey(await latestProtections())!==protectionKey(protectedRevisions)||(await pages.route(id,{required:true})).generation!==route.generation)return {dryRun:false,status:'changed',files:[],bytes:0}
 const next={...route,generation:route.generation+1,revisionRoots:{...route.revisionRoots},expiredRevisions:[...new Set([...(route.expiredRevisions||[]),...revisions])],expiredSnapshots:[...new Set([...(route.expiredSnapshots||[]),...revisions.map(revision=>route.revisionRoots[revision])])]}
 for(const revision of revisions)delete next.revisionRoots[revision]
 const record={kind:'page-retention-gc-v1',generation:next.generation,refs:candidates,status:'isolating',routeRoots:next.revisionRoots,protectionKey:protectionKey(protectedRevisions),identities:Object.fromEntries(rows.map(row=>[row.ref,row.identity])),verificationRefs,frontier}
 next.pendingGC=record
 // Visibility expires durably before touching any immutable pathname.
 await pages.publish(id,next)
 // Construction pointers are not live roots. Reset a failed/unpublished head
 // before removing payload that a future prepare must not read through it.
 await pages.store.resetConstructionHead(id,next.snapshotId)
 await ensurePageDirectory(pages.root,quarantine);await safePagePath(pages.root,quarantine,{directory:true});await receipt(record)
 try{
  for(const ref of candidates){const actual=await inspect(ref);if(actual.identity!==record.identities[ref])throw Error('Candidate identity changed before isolation');await pages.store.readBlock(id,ref);if(!await currentMatches(next.generation,next.revisionRoots,record.protectionKey))throw Error('Roots/protections changed before isolation');if((await inspect(ref)).identity!==record.identities[ref])throw Error('Candidate identity changed at isolation boundary');await rename(block(ref),isolated(ref));summary.quarantine++}
  await verifyRefs(verificationRefs)
  if(protectionKey(await latestProtections())!==protectionKey(protectedRevisions))throw Error('Page protections changed during isolation')
  await receipt({...record,status:'verified'})
 }catch(error){
  for(const ref of candidates){try{await safePagePath(pages.root,isolated(ref));if(await safePagePath(pages.root,block(ref),{missing:true}))throw Error('GC restore would overwrite changed path');await rename(isolated(ref),block(ref))}catch(restore){if(restore.code!=='ENOENT')throw new AggregateError([error,restore],'GC restore failed')}}
  await pages.publish(id,{...route,generation:next.generation+1})
  await receipt({...record,status:'restored'});throw error
 }
 await purge(record);summary.quarantine=0
 await receipt({...record,status:'purged'})
 return {dryRun:false,revisions,files:rows,bytes:dryRun?rows.reduce((sum,row)=>sum+(row.nlink===1?row.allocatedBytes:0),0):summary.confirmedFreedBytes,logicalBytes:rows.reduce((sum,row)=>sum+row.bytes,0),summary}
}
