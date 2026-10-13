import {callHelperCustomApi} from './helper-generation-service.js'
import {safeOutboundFetch} from './outbound-network-policy.js'
const mimeTypes=new Set(['image/png','image/jpeg','image/webp','image/gif'])
export async function admitHelperImages(messages,attachments,{fetcher,lookup,signal,trustedResource=false}={}) {
 const copies=structuredClone(messages),slots=[],inputs=[]
 for(const message of copies)for(const part of message.content||[])if(part.type==='image'&&!part.attachment){
  const url=String(part.url||'');let bytes,mediaType
  if(url.startsWith('data:')){
   const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url)
   if(!match)throw new Error('图片 data URL 无效')
   mediaType=match[1];bytes=Buffer.from(match[2],'base64')
   if(bytes.toString('base64')!==match[2])throw new Error('图片 base64 无效')
  }else{
   const address=new URL(url);if(!['http:','https:'].includes(address.protocol)||address.username||address.password)throw new Error('图片 URL 无效')
   const response=await safeOutboundFetch(address,{redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)])},{fetcher,lookup,trustedResource})
   if(!response.ok)throw new Error('图片读取失败：HTTP '+response.status)
   mediaType=(response.headers.get('content-type')||'').split(';')[0];if(!mimeTypes.has(mediaType))throw new Error('图片格式不支持')
   let size=0;const chunks=[]
   for await(const chunk of response.body){size+=chunk.length;if(size>8_000_000)throw new Error('图片超过 8MB');chunks.push(chunk)}bytes=Buffer.concat(chunks)
  }
  if(!bytes.length||bytes.length>8_000_000)throw new Error('图片为空或超过 8MB')
  slots.push(part);inputs.push({mediaType,data:bytes})
 }
 if(inputs.length){if(!attachments?.saveImages)throw new Error('当前内核没有图片附件服务');const refs=await attachments.saveImages(inputs);slots.forEach((part,i)=>{delete part.url;part.attachment=refs[i]})}
 return copies
}
export function nativeHelperTools(tools){
 if(tools===undefined)return undefined
 if(!Array.isArray(tools)||tools.length>128)throw new Error('工具列表无效')
 return tools.map(tool=>{const f=tool?.function;if(tool?.type!=='function'||!f||typeof f.name!=='string'||!f.name||!f.parameters||typeof f.parameters!=='object')throw new Error('工具定义无效');return {name:f.name,description:String(f.description||''),parameters:structuredClone(f.parameters)}})
}
export function needsHelperWireOptions(options){
 const api=options.customApi||{}
 return Boolean(options.jsonSchema||options.toolChoice&&!['auto','none'].includes(options.toolChoice)||['frequency_penalty','presence_penalty','top_p','top_k','custom_include_body','custom_exclude_body','custom_include_headers'].some(key=>api[key]!==undefined))
}
/** Advanced ST options use only an explicitly configured compatible route; secrets stay on the host. */
export async function callConfiguredHelperApi(options,selection,{llm,settings,credentials,fetcher,lookup}){
 const descriptor=llm.listConfigurableProviders().find(p=>p.provider===selection.provider)
 let profile=descriptor&&settings?.get(descriptor.settingsNs)
 for(const key of descriptor?.settingsPath||[])profile=profile?.[key]
 if(!profile||profile.api!=='openai-completions'||!profile.baseURL)throw new Error('当前模型适配器没有开放这些结构化或采样参数；请选择显式配置的 OpenAI 兼容连接，或填写脚本自己的 API')
 const key=profile.apiKeyEnv?(await credentials?.resolve(profile.apiKeyEnv))?.value:undefined
 if(profile.apiKeyEnv&&!key)throw new Error('当前模型连接的密钥不可用')
 const custom={...options.customApi,source:'custom',apiurl:profile.baseURL,key:key||'',model:selection.model,
  custom_include_headers:{...(profile.headers||{}),...(options.customApi?.custom_include_headers||{})}}
 if(typeof options.temperature==='number')custom.temperature=options.temperature
 if(typeof options.maxTokens==='number')custom.max_tokens=options.maxTokens
 const result=await callHelperCustomApi({...options,customApi:custom},fetcher,{lookup,allowedModelOrigins:[new URL(profile.baseURL).origin]})
 if(options.jsonSchema){if(typeof result!=='string')throw new Error('结构化生成返回了工具调用');try{JSON.parse(result)}catch{throw new Error('模型没有返回有效的 JSON')}}
 return result
}
export function createHelperToolAccumulator(){
 const calls=new Map()
 return {apply(chunk){
  if(chunk.type==='tool-call-delta'){
   const previous=calls.get(chunk.index)||{id:chunk.id,type:'function',function:{name:'',arguments:''}}
   if(chunk.id)previous.id=chunk.id;if(chunk.name)previous.function.name=chunk.name;previous.function.arguments+=chunk.argumentsDelta||'';calls.set(chunk.index,previous)
  }else if(chunk.type==='block-end'&&chunk.block?.type==='tool-call')calls.set(chunk.index,{id:chunk.block.id,type:'function',function:{name:chunk.block.name,arguments:chunk.block.arguments}})
 },result(text){return calls.size?{content:text,tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v)}:null}}
}

export function nativeHelperMessages(messages){return messages.map((message,index)=>({...structuredClone(message),id:message.id||'tavern-helper-message-'+index,source:message.source||{kind:'plugin',plugin:'dsh-tavern-helper'}}))}
