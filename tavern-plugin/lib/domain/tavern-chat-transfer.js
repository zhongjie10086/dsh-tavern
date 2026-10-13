import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { parseSpCheckpoint } from './sp-checkpoint.js'
import { databaseState } from './sp-database.js'
import { stampSpFloor } from './sp-layer-storage.js'
import { legacyChatDocument } from './tavern-chat-files.js'
import {createScriptRecordBudget,scriptStorageLimits} from './script-storage-budget.js'
const copy=v=>structuredClone(v)
const reserved=new Set(['name','mes','is_user','is_system','swipes','swipe_id','swipe_info','variables','extra','id','send_date','chat_metadata'])
const identityFields=['scriptStorageOwners','scriptFileAliases','worldbookState','openingWorldbookSnapshot','chatWorldbookBindings','resourceBindings','scriptVariableMigration','cardPath','cardName','cardContextSnapshot','cardSnapshot','runtimePresetSnapshot','runtimePreset','presetControls','macroState','mvu','tavernHelperScriptVariables','tavernScriptMetadata','tavernScriptTrees','tavernScriptTreeRevision','scriptState','requestMode','playConfigRevision','helperPresetRevision','variables']
export function prepareTransferredChat({chat,input,phase,parsed}) {
 const transfer=input.helperTransfer;if(!transfer)return
 if(phase==='before'){
  for(const key of identityFields)if(transfer.source[key]!==undefined)chat[key]=copy(transfer.source[key])
  chat.tavernHelperLifecycleRevision=0;chat.tavernPluginMetadata=copy(transfer.metadata);chat.legacyChatFileName=input.fileName.replace(/\.jsonl$/,'');chat.helperTransferredFrom={chatId:transfer.source.id,scriptId:transfer.scriptId,identity:transfer.identity}
  return
 }
 const sourceState=databaseState(transfer.source),records=transfer.records
 for(const message of chat.messages){
  const raw=records[message.importSource.line-2];if(!raw)throw new Error('搬家消息索引不一致')
  if((message.importSource.lines||[]).length>1)throw new Error('相邻同身份消息暂不能合并搬家，请先调整历史消息')
  message.tavernPluginData=Object.fromEntries(Object.entries(raw).filter(([k])=>!reserved.has(k)).map(([k,v])=>[k,copy(v)]))
  message.tavernExtra=copy(raw.extra||{});message.tavernSwipesInfo=copy(raw.swipe_info||[])
  if(raw.id)message.tavernLegacyId=String(raw.id)
  if(raw.send_date)message.tavernSendDate=copy(raw.send_date)
  if(Array.isArray(raw.swipes)&&raw.swipes.length){message.swipes=copy(raw.swipes);message.swipeId=Math.max(0,Math.min(raw.swipes.length-1,Number(raw.swipe_id)||0))}
  if(Array.isArray(raw.variables))message.variables=copy(raw.variables)
 }
 const checkpoints=records.flatMap((row,index)=>Object.entries(row.TavernDB_ACU_IsolatedData||{}).map(([code,value])=>({index,code,checkpoint:value?.storageFrame?.checkpoint}))).filter(v=>v.checkpoint)
 if(checkpoints.length){const {code,checkpoint}=checkpoints[0],saved=parseSpCheckpoint(checkpoint);chat.spDatabase={...sourceState,data:saved.tableSnapshot,templateData:saved.templateSnapshot.data,guideData:saved.guideSnapshot.data,template:{name:saved.templateSnapshot.presetName},isolationCode:code,snapshots:[],isolationSpaces:{},layerRecords:{version:1,frames:[],checkpoints:{}},activity:null,fillProgress:{},lastFilledBody:'',settings:{...sourceState.settings,plotEnabled:false}};for(const key of ['plot','agentResult','advancedPrepared','vectorRecall','vectorPreview','vectorIndex','summaryArchives'])delete chat.spDatabase[key];stampSpFloor(chat.spDatabase,chat,'搬家起点')}
 else {chat.spDatabase={...sourceState,snapshots:[],layerRecords:{version:1,frames:[],checkpoints:{}},settings:{...sourceState.settings,plotEnabled:false}};stampSpFloor(chat.spDatabase,chat,'搬家当前快照')}
 for(const checkpoint of chat.timeline.checkpoints){checkpoint.importBefore.tavernPluginMetadata=copy(chat.tavernPluginMetadata);checkpoint.importBefore.spDatabase=copy(chat.spDatabase)}
}
export function createTavernChatTransfer({store,chats,importer,createSession,assertOwner,isBusy,limits=scriptStorageLimits.transfers}) {
 const pending=new Map()
 const budget=createScriptRecordBudget({store,directory:'helper-chat-transfers',limits,label:'聊天搬家记录'})
 async function find(cardPath,name) {
  if(chats.findByName)return chats.findByName(cardPath,name)
  // Older adapters may only expose IDs. Bound peak memory and stop at the match.
  for(const id of await chats.list()){const chat=await chats.read(id);if(chat?.cardPath===cardPath&&(chat.id===name||chat.legacyChatFileName===name))return chat}
 }
 async function perform({source,body,scriptId,lifecycle}) {
  if(isBusy(source))throw new Error('请等待当前生成和状态结算完成后搬家')
  const name=String(body.file_name||'').replace(/\.jsonl$/,'');if(!name||name.length>200||/[\\/\x00-\x1f]/.test(name))throw new Error('聊天文件名无效')
  if(body.avatar_url!==source.cardPath)throw new Error('搬家目标必须使用当前人物卡')
  if(!Array.isArray(body.chat)||!body.chat.length||Buffer.byteLength(JSON.stringify(body.chat))>20_000_000)throw new Error('搬家聊天内容无效或超过 20MB')
  const first=body.chat[0],header=first?.mes===undefined,records=copy(header?body.chat.slice(1):body.chat),metadata=copy(first.chat_metadata||{})
  const existing=await find(body.avatar_url,name)
  if(existing){
    if(existing.helperTransferredFrom?.scriptId===scriptId&&existing.helperTransferredFrom?.chatId===source.id){if(existing.helperTransferredFrom.identity!==createHash('sha256').update(JSON.stringify(body)).digest('hex'))throw new Error('同名搬家任务的内容已变化，请使用新的聊天名称');return {ok:true,sessionId:existing.sessionId,chatId:existing.id}}
    const previous=legacyChatDocument(existing).slice(1),withoutMeta=v=>v.map(({chat_metadata,...r})=>r)
    if(!isDeepStrictEqual(withoutMeta(records),previous))throw new Error('已有聊天的正文发生变化，不能用文件保存接口覆盖')
    if(isBusy(existing))throw new Error('目标聊天正在运行')
    await chats.update(existing.id,async current=>{await assertOwner(source.sessionId,scriptId,lifecycle);if(current._storageRevision!==existing._storageRevision)throw new Error('聊天已变化，请重试');current.tavernPluginMetadata=metadata})
    return {ok:true,updated:true}
  }
  const digest=createHash('sha256').update(JSON.stringify([source.id,scriptId,name])).digest('hex'),path='helper-chat-transfers/'+digest+'.json'
  const identity=createHash('sha256').update(JSON.stringify(body)).digest('hex');const guard=()=>assertOwner(source.sessionId,scriptId,lifecycle)
  return budget.run(digest,scriptId,4096,async()=>{
  let journal=await store.readJson(path)
  if(journal&&journal.identity!==identity)throw new Error('同名搬家任务的内容已变化，请使用新的聊天名称')
  if(!journal){journal={identity,owner:scriptId,sourceChatId:source.id,sessionId:'session-'+randomUUID(),operationId:'helper-transfer-'+digest.slice(0,40),phase:'prepared',sourceRevision:source._storageRevision};await store.writeJson(path,journal)}
  if(journal.phase==='prepared'){await createSession(journal.sessionId,source.sessionId);journal.phase='created';await store.writeJson(path,journal)}
  await assertOwner(source.sessionId,scriptId,lifecycle)
  const text=[{user_name:source.macroState?.userName||'你',character_name:source.cardName,chat_metadata:metadata},...records].map(v=>JSON.stringify(v)).join('\n')
  const result=await importer.import({operationId:journal.operationId,sessionId:journal.sessionId,cardPath:source.cardPath,fileName:name+'.jsonl',text,helperTransfer:{source:copy(source),records,metadata,scriptId,identity}})
  await store.writeJson(path,{...journal,phase:'ready',chatId:(await chats.forSession(result.sessionId)).id})
  return {ok:true,...result}
  },guard,{adoptUnowned:true})
 }
 async function removeChatReceipts(chat,{dryRun=false}={}){
  for(const name of await store.listJsonFiles('helper-chat-transfers')){
   if(!/^[a-f0-9]{64}\.json$/.test(name))continue
   const path='helper-chat-transfers/'+name,record=await store.readJson(path)
   if(record?.phase!=='ready'||record.sessionId!==chat.sessionId||record.chatId!==chat.id)continue
   const guard=async()=>{if(await chats.forSession(chat.sessionId))throw new Error('搬家目标仍存在，未清理记录')}
   if(!dryRun){const quota=await store.readJson('helper-chat-transfers/.quota.json');await budget.remove(name.slice(0,-5),quota?.records?.[name.slice(0,-5)]?.owner??record.owner??'',()=>store.remove(path),guard)}
  }
 }
 return {removeChatReceipts,save(params){const key=params.source.id+'\n'+params.body.file_name;const signature=JSON.stringify(params.body);if(pending.has(key)){const prior=pending.get(key);return prior.signature===signature?prior.task:Promise.reject(new Error('同名搬家任务正在处理其他内容'))}const task=perform(params).finally(()=>pending.delete(key));pending.set(key,{signature,task});return task},async open({source,body,scriptId,lifecycle}){await assertOwner(source.sessionId,scriptId,lifecycle);const target=await find(source.cardPath,body.name);if(!target)throw new Error('找不到要打开的聊天');return {sessionId:target.sessionId,mode:target.mode||'story'}}}
}
