import {parentPort} from 'node:worker_threads'
import {profileReferencePlan} from '../domain/profile-retention.js'
import {createChatJournalStore} from '../domain/chat-journal-store.js'
const journals=new Map()
parentPort.on('message',async({id,kind,dataRoot,options})=>{
 try{
  let value
  if(kind==='references')value=await profileReferencePlan(dataRoot,{...options,exclude:new Set(options.exclude)})
  else if(kind==='snapshots'){
   const key=dataRoot+':'+options.snapshotLimit
   if(!journals.has(key)){if(journals.size>=2)journals.delete(journals.keys().next().value);journals.set(key,createChatJournalStore({dataRoot,snapshotLimit:options.snapshotLimit,retention:false}))}
   const journal=journals.get(key);value=[]
   for(const row of options.chats)value.push(await journal.prune(row.id,{dryRun:true,protectedRevisions:row.protectedRevisions}))
  }else throw Error('未知维护扫描类型')
  parentPort.postMessage({id,value})
 }catch(error){parentPort.postMessage({id,error:{message:error.message,code:error.code,resourcePath:error.resourcePath}})}
})
