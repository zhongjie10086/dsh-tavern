import {modelOutputLimitFromError} from './model-output-error.js'
import {createModelIdleWatchdog} from './model-idle-watchdog.js'
import {randomUUID} from 'node:crypto'
import {checkScriptStorageBudget,scriptStorageLimits} from './script-storage-budget.js'
import {parse as parseYaml} from 'yaml'
import {helperApiUrl} from './helper-generation-service.js'
import {postProcessPrompt} from '../vendor/st-prompt-post-processing.js'
import {safeOutboundFetch,readBoundedResponse,validateCustomModelFields} from './outbound-network-policy.js'
import {readJsonEventStream} from './json-event-stream.js'
const modes=['','merge','merge_tools','semi','semi_tools','strict','strict_tools','single']
const copy=structuredClone
function objectText(value,label,array=false){
 let v=value??(array?[]:{});
 if(typeof v==='string'){
  const text=v.trim();if(!text)return array?[]:{};
  try{v=parseYaml(text)}catch{v=text}
  if(array&&typeof v==='string')v=[...new Set(text.split(/[,，\r\n]+/).map(s=>s.trim()).filter(Boolean))];
  if(!array&&typeof v==='string'&&text.split(/\r?\n/).every(line=>!line.trim()||/^[^=]+=.*/.test(line))){
   v=Object.fromEntries(text.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const at=line.indexOf('='),key=line.slice(0,at).trim(),raw=line.slice(at+1).trim();if(!key)throw new Error(label+'字段名为空');let parsed;try{parsed=JSON.parse(raw)}catch{parsed=raw}return[key,parsed]}));
  }
 }
 if(array?!Array.isArray(v)||v.some(k=>typeof k!=='string'||!k.trim()):!v||typeof v!=='object'||Array.isArray(v))throw new Error(label+'格式无效');return v
}
export function normalizeIzumiConnection(input){
 const c={apiUrl:String(input.apiUrl||'').trim(),model:String(input.model||'').trim(),postProcessing:input.postProcessing||'',stream:input.stream!==false,includeBody:objectText(input.includeBody,'包含正文'),excludeBody:objectText(input.excludeBody,'排除正文',true),includeHeaders:objectText(input.includeHeaders,'请求头')};
 helperApiUrl(c.apiUrl);if(!c.model||!modes.includes(c.postProcessing))throw new Error('模型或后处理模式无效');
 for(const [k,min,max]of [['maxTokens',1,1000000],['temperature',0,2],['topP',0,1]]){if(input[k]!==''&&input[k]!=null){const n=Number(input[k]);if(!Number.isFinite(n)||n<min||n>max||(k==='maxTokens'&&!Number.isInteger(n)))throw new Error('参数范围无效：'+k);c[k]=n}}
 for(const [k,v]of Object.entries(c.includeHeaders))if(typeof v!=='string'||/[\r\n]/.test(k+v))throw new Error('请求头必须是单行字符串');
 // These fields must reflect the admitted request, even when body filters are configured.
 validateCustomModelFields(c.includeBody,c.excludeBody,c.includeHeaders);
 return c
}
export function createIzumiConnection({store,chats,llm,settings,credentials,selection,selectModel,assertOwner,fetcher,lookup,allowedModelOrigins,networkPolicy=async()=>({}),isBusy=()=>false,secretLimits=scriptStorageLimits.secrets}){
 const file='izumi-connections.json',secretFile='connection-secrets.json',tails=new Map();
 async function serialized(id,fn){const task=(tails.get(id)||Promise.resolve()).catch(()=>{}).then(fn);tails.set(id,task);try{return await task}finally{if(tails.get(id)===task)tails.delete(id)}}
 async function profile(sessionId){const selected=selection(sessionId);const descriptor=llm.listConfigurableProviders().find(p=>p.provider===selected?.provider);let p=descriptor&&settings.get(descriptor.settingsNs);for(const k of descriptor?.settingsPath||[])p=p?.[k];return {selected,profile:p}}
 async function effective(sessionId){const {selected,profile:p}=await profile(sessionId),saved=(await store.readJson(file))?.[sessionId];const base={mainApi:'openai',source:'custom',apiUrl:p?.api==='openai-completions'?p.baseURL||'':'',model:selected?.model||'',postProcessing:'',maxTokens:'',temperature:'',topP:'',stream:true,includeBody:'',excludeBody:'',includeHeaders:''};const config={...base,...copy(saved?.config||{}),provider:selected?.provider||'',hasApiKey:!!(saved?.key||p?.apiKeyEnv&&(!saved||saved.config.apiUrl===p.baseURL)),enabled:!!saved,apiKey:'',saveKey:false};for(const k of ['includeBody','excludeBody','includeHeaders'])if(typeof config[k]!=='string')config[k]=JSON.stringify(config[k],null,2);return config}
 async function wire(sessionId,configOverride){const {profile:p}=await profile(sessionId),saved=(await store.readJson(file))?.[sessionId],config=configOverride||saved?.config;if(!config)return null;if(!configOverride&&!(await chats.forSession(sessionId))?.izumiApiApplied)return null;let key=saved?.config.apiUrl===config.apiUrl?saved.key:'';if(!key&&p?.baseURL===config.apiUrl&&p.apiKeyEnv)key=(await credentials.resolve(p.apiKeyEnv))?.value||'';return {config,key,networkPolicy:saved?.owner?await networkPolicy(sessionId,saved.owner):{}}}
 async function saveSecret(sessionId,value,label,owner,lifecycle){
  await assertOwner(sessionId,owner,lifecycle);if(typeof value!=='string'||!value.trim()||value.length>20000||/[\r\n]/.test(value))throw new Error('密钥格式无效');let id;
  await store.updateJson(secretFile,async all=>{
   await assertOwner(sessionId,owner,lifecycle);const prior=Object.entries(all||{}).find(([,v])=>v.owner===owner&&v.value===value.trim());id=prior?.[0]||randomUUID();
   const next={...all,[id]:{value:value.trim(),label:String(label||'').slice(0,160),owner,at:prior?.[1].at||Date.now()}};
   checkScriptStorageBudget(all,next,owner,secretLimits,'连接密钥');return next
  });return {id}
 }
 async function listSecrets(sessionId,owner,lifecycle){await assertOwner(sessionId,owner,lifecycle);return {secrets:Object.entries(await store.readJson(secretFile)||{}).filter(([,v])=>v.owner===owner).map(([id,v])=>({id,label:v.label,at:v.at}))}}
 async function deleteSecret(sessionId,id,owner,lifecycle){await assertOwner(sessionId,owner,lifecycle);await store.updateJson(secretFile,async all=>{await assertOwner(sessionId,owner,lifecycle);if(!Object.hasOwn(all||{},id))return undefined;if(all[id].owner!==owner)throw new Error('密钥不属于当前脚本');const next={...all};delete next[id];return next});return {success:true}}
 async function mutate(sessionId,input,owner,lifecycle){return serialized(sessionId,async()=>{const chat=await assertOwner(sessionId,owner,lifecycle);if(isBusy(chat))throw new Error('请等待当前生成结束');const config=normalizeIzumiConnection(input),previous=(await store.readJson(file))?.[sessionId],selected=copy(selection(sessionId));let key=input.apiKey?String(input.apiKey):previous?.config.apiUrl===config.apiUrl?previous.key:'';
  if(input.secretId){const secret=(await store.readJson(secretFile))?.[input.secretId];if(!secret||secret.owner!==owner)throw new Error('找不到此脚本保存的密钥，请重新保存密钥');key=secret.value}
  if(/[\r\n]/.test(key))throw new Error('密钥格式无效');let selectedModel=false,wrote=false;
  try{await selectModel({sessionId,provider:selected.provider,model:config.model});selectedModel=true;await store.updateJson(file,all=>({...all,[sessionId]:{config,key,owner,previousSelection:previous?.previousSelection||selected,updatedAt:Date.now()}}));wrote=true;
   await chats.update(chat.id,current=>{if(Number(current.tavernHelperLifecycleRevision||0)!==Number(lifecycle)||isBusy(current))throw new Error('当前聊天已变化，请稍后重试');current.izumiApiApplied={postProcessing:config.postProcessing,at:Date.now()};return current},{source:'izumi.connection'});
  }catch(error){if(wrote)await store.updateJson(file,all=>{const next={...all};if(previous)next[sessionId]=previous;else delete next[sessionId];return next});if(selectedModel&&selection(sessionId)?.model===config.model)await selectModel({sessionId,...selected});throw error}return {config:await effective(sessionId)}
 })}
 async function reset(sessionId,owner,lifecycle){return serialized(sessionId,async()=>{const chat=await assertOwner(sessionId,owner,lifecycle);if(isBusy(chat))throw new Error('请等待当前生成结束');const previous=(await store.readJson(file))?.[sessionId];await chats.update(chat.id,current=>{if(Number(current.tavernHelperLifecycleRevision||0)!==Number(lifecycle))throw new Error('聊天已变化');delete current.izumiApiApplied;return current},{source:'izumi.connection-reset'});await store.updateJson(file,all=>{const next={...all};delete next[sessionId];return next});if(previous?.previousSelection&&selection(sessionId)?.model===previous.config.model)await selectModel({sessionId,...previous.previousSelection});return {config:await effective(sessionId)}})}
 async function models(sessionId,input,owner,lifecycle){await assertOwner(sessionId,owner,lifecycle);const config=normalizeIzumiConnection({...await effective(sessionId),...input}),w=await wire(sessionId,config);const key=input.apiKey||w.key;const response=await safeOutboundFetch(helperApiUrl(config.apiUrl,'models'),{headers:{...config.includeHeaders,...(key?{Authorization:'Bearer '+key}:{})},redirect:'error',signal:AbortSignal.timeout(30000)},{purpose:'model',fetcher,lookup,allowedModelOrigins,...await networkPolicy(sessionId,owner)});if(!response.ok)throw new Error('模型列表请求失败：HTTP '+response.status);const body=JSON.parse((await readBoundedResponse(response,2_000_000)).toString('utf8'));return {models:(body.data||[]).map(m=>m.id).filter(v=>typeof v==='string')}}
 return {read:effective,wire,mutate,models,saveSecret,listSecrets,deleteSecret,reset}
}
export async function izumiWireMessages(messages,attachments,signal){
 const result=[];
 async function parts(content){const values=[];for(const p of content||[]){if(p.type==='text')values.push({type:'text',text:p.text});else if(p.type==='image'){if(p.url)values.push({type:'image_url',image_url:{url:p.url}});else{const image=await attachments.readImage(p.attachment,signal);values.push({type:'image_url',image_url:{url:'data:'+image.ref.mediaType+';base64,'+Buffer.from(image.data).toString('base64')}})}}else if(p.type==='file')values.push({type:'text',text:'[文件 '+(p.attachment.name||p.attachment.id)+']'})}return values.length===1&&values[0].type==='text'?values[0].text:values}
 for(const m of messages){const calls=(m.content||[]).filter(p=>p.type==='tool-call').map(p=>({id:p.id,type:'function',function:{name:p.name,arguments:p.arguments}})),tools=(m.content||[]).filter(p=>p.type==='tool-result'),content=await parts(m.content),reasoning=(m.content||[]).filter(p=>p.type==='reasoning').map(p=>p.text).join('');
  if((Array.isArray(content)?content.length:content.length)||calls.length)result.push({role:m.role,content:content||null,...(calls.length?{tool_calls:calls}:{}),...(reasoning?{reasoning_content:reasoning}:{})});for(const p of tools)result.push({role:'tool',tool_call_id:p.toolCallId,content:await parts(p.content)})
 }return result
}
/** Translate an explicitly applied Izumi connection to the DSH streaming protocol. */
export async function* streamIzumiConnection(options,wire,{attachments,fetcher,lookup,allowedModelOrigins,idleTimeoutMs}={}){
 const c=wire.config;validateCustomModelFields(c.includeBody,c.excludeBody,c.includeHeaders);let messages=await izumiWireMessages(options.messages,attachments,options.signal);
 messages=postProcessPrompt(messages,c.postProcessing,{charName:'',userName:'',groupNames:[],startsWithGroupName:()=>false});
 const body={model:options.model,messages,stream:c.stream,...(options.tools?.length?{tools:options.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}))}:{}),...(c.maxTokens?{max_tokens:c.maxTokens}:options.maxTokens?{max_tokens:options.maxTokens}:{}),...(c.temperature!==undefined?{temperature:c.temperature}:{}),...(c.topP!==undefined?{top_p:c.topP}:{}),...c.includeBody};for(const k of c.excludeBody)delete body[k];
 const limit=wire.outputLimit?.maxTokens
 if(Number.isSafeInteger(limit)&&limit>0)for(const parameter of ['max_tokens','max_completion_tokens']){
  const requested=body[parameter]
  if(Number.isSafeInteger(requested)&&requested>limit){body[parameter]=limit;await wire.onLimit?.({parameter,requested,applied:limit,source:wire.outputLimit.source,model:options.model,provider:options.provider})}
 }
 const watchdog=createModelIdleWatchdog(options.signal,{idleTimeoutMs}),signal=watchdog.signal
 let response,partialText=''
 try{
 const send=async()=>watchdog.monitor(await safeOutboundFetch(helperApiUrl(c.apiUrl),{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json',...(wire.key?{Authorization:'Bearer '+wire.key}:{}),...c.includeHeaders},body:JSON.stringify(body)},{purpose:'model',fetcher,lookup,allowedModelOrigins,...wire.networkPolicy}))
 response=await send()
 if(!response.ok&&[400,422].includes(response.status)){
  let errorBody;try{errorBody=JSON.parse((await readBoundedResponse(response,64000)).toString('utf8'))}catch{signal.throwIfAborted()}
  const adjustment=modelOutputLimitFromError(errorBody,body)
  if(adjustment){
   body[adjustment.parameter]=adjustment.applied
   await wire.onLimit?.({...adjustment,provider:options.provider,model:options.model})
   response=await send()
  }
 }
 if(!response.ok)throw Object.assign(new Error('模型接口请求失败：HTTP '+response.status),{status:response.status})

 const blocks=new Map(),toolIndices=new Map();let next=0,finish='stop',usage=null,sawFinish=false;
 function* chunk(value){if(value.error)throw new Error('Izumi API 返回错误：'+String(value.error.code||value.error.type||'unknown'));if(value.usage)usage=value.usage;const choice=value.choices?.[0];if(!choice)return;const delta=choice.delta||choice.message||{};
  for(const [field,type]of [['reasoning_content','reasoning'],['content','text']])if(delta[field]){let b=blocks.get(type);if(!b){b={index:next++,type,text:''};blocks.set(type,b);yield{type:'block-start',index:b.index,blockType:type}}b.text+=delta[field];if(type==='text')partialText+=delta[field];yield{type:type==='text'?'text-delta':'reasoning-delta',index:b.index,text:delta[field]}}
  for(const [i,t]of (delta.tool_calls||[]).entries()){const id=t.index??i;let b=toolIndices.get(id);if(!b){b={index:next++,type:'tool-call',id:t.id||'',name:'',arguments:''};toolIndices.set(id,b);yield{type:'block-start',index:b.index,blockType:'tool-call'}}if(t.id)b.id=t.id;if(t.function?.name)b.name+=t.function.name;if(t.function?.arguments)b.arguments+=t.function.arguments;yield{type:'tool-call-delta',index:b.index,id:b.id,...(t.function?.name?{name:t.function.name}:{}),argumentsDelta:t.function?.arguments||''}}
  if(choice.finish_reason){sawFinish=true;finish=choice.finish_reason==='tool_calls'?'tool-calls':choice.finish_reason==='length'?'max-tokens':choice.finish_reason==='content_filter'?'filtered':'stop'}
 }
 if(!response.headers.get('content-type')?.includes('text/event-stream'))yield* chunk(JSON.parse((await readBoundedResponse(response,16000000)).toString('utf8')));else for await(const value of readJsonEventStream(response,{signal,maxBytes:16000000,label:'Izumi API'}))yield* chunk(value);
 if(!sawFinish)throw new Error('Izumi API 流中断，缺少完成标记');if(finish==='filtered')throw new Error('Izumi API 拒绝了本次内容');
 for(const b of [...blocks.values(),...toolIndices.values()].sort((a,b)=>a.index-b.index)){const {index,...block}=b;if(block.type==='tool-call'&&(!block.id||!block.name))throw new Error('Izumi API 工具调用不完整');yield{type:'block-end',index,block}}
 if(usage){const cached=usage.prompt_tokens_details?.cached_tokens??usage.prompt_cache_hit_tokens??0;yield{type:'usage',usage:{inputTokens:Math.max(0,(usage.prompt_tokens||0)-cached),outputTokens:usage.completion_tokens||0,cacheReadTokens:cached,...(usage.total_tokens?{totalTokens:usage.total_tokens}:{}),...(usage.completion_tokens_details?.reasoning_tokens?{reasoningTokens:usage.completion_tokens_details.reasoning_tokens}:{})}}}
 yield{type:'finish',reason:{kind:finish}}
 }catch(error){
  let failure=signal.aborted?signal.reason:error
  if(!failure||typeof failure!=='object'||!Object.isExtensible(failure))failure=new Error(String(failure?.message||failure),{cause:failure})
  if(partialText)failure.partialText=partialText
  throw failure
 }finally{watchdog.dispose();try{await response?.body?.cancel()}catch{}}
}
