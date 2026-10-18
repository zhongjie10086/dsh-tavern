// Match the fixed original Chat Completion contract: text and image_url blocks,
// preserving their order. Native image admission remains the existing model boundary.
function validFrontendContent(content){return typeof content==='string'||Array.isArray(content)&&content.length>0&&content.every(part=>part?.type==='text'&&typeof part.text==='string'||part?.type==='image_url'&&typeof part.image_url?.url==='string')}
function nativeFrontendContent(content){return typeof content==='string'?content:content.map(part=>part.type==='text'?{type:'text',text:part.text}:{type:'image',url:part.image_url.url})}
function toolCalls(value){
 if(!Array.isArray(value)||!value.length||value.length>128||value.some(call=>call?.type!=='function'||typeof call.id!=='string'||!call.id||typeof call.function?.name!=='string'||!call.function.name||typeof call.function.arguments!=='string'))throw Error('扩展工具调用格式无效');
 return value.map(call=>({type:'tool-call',id:call.id,name:call.function.name,arguments:call.function.arguments}));
}
function nativeMessage(message,nativeTools){
 const content=message.content==null?[]:nativeFrontendContent(message.content);
 if(!nativeTools)return {role:message.role,content};
 const parts=typeof content==='string'?[{type:'text',text:content}]:content;
 if(message.tool_calls!==undefined)parts.push(...toolCalls(message.tool_calls));
 return {role:message.role,content:parts,...(message.role==='tool'?{toolCallId:message.tool_call_id}:{})};
}
export function frontendGenerationConfig(body,{multimodal=false,nativeTools=false}={}) {
  if (!body || body.chat_completion_source !== 'openai' || typeof body.reverse_proxy !== 'string' || !body.reverse_proxy.trim() || typeof body.model !== 'string' || !body.model.trim()) throw Error('请为扩展配置独立的 OpenAI 兼容 API 地址和模型')
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 10000 || body.messages.some(m=>!(nativeTools?['system','user','assistant','tool']:['system','user','assistant']).includes(m?.role)||!(nativeTools&&m.role==='assistant'&&m.content==null&&m.tool_calls!==undefined|| (multimodal?validFrontendContent(m.content):typeof m.content==='string'))||nativeTools&&m?.tool_calls!==undefined&&m.role!=='assistant'||m?.role==='tool'&&(typeof m.tool_call_id!=='string'||!m.tool_call_id))) throw Error('扩展模型消息格式无效')
  if (!nativeTools&&(body.tools?.length || body.tool_choice && body.tool_choice !== 'none')) throw Error('扩展的此生成接口只支持文本输出')
  if(nativeTools&&body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.length>128||body.tools.some(tool=>tool?.type!=='function'||typeof tool.function?.name!=='string'||!tool.function.name||!tool.function.parameters||typeof tool.function.parameters!=='object'||Array.isArray(tool.function.parameters))))throw Error('扩展工具定义无效');
  if(nativeTools&&body.tool_choice!==undefined&&!['auto','none','required'].includes(body.tool_choice)&&!(body.tool_choice?.type==='function'&&typeof body.tool_choice.function?.name==='string'&&body.tools?.some(tool=>tool.function.name===body.tool_choice.function.name)))throw Error('扩展工具选择无效');
  const api = {apiurl:body.reverse_proxy,key:String(body.proxy_password || ''),model:body.model,source:'custom',custom_include_body:{},custom_exclude_body:[]}
  for (const field of ['temperature','max_tokens','top_p','frequency_penalty','presence_penalty','top_k']) if (Object.hasOwn(body,field)) {
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field])) throw Error('无效模型参数：' + field)
    api[field] = body[field]
  }
  if(Object.hasOwn(body,'reasoning_effort')){if(!['none','minimal','low','medium','high','xhigh'].includes(body.reasoning_effort))throw Error('无效模型参数：reasoning_effort');api.custom_include_body.reasoning_effort=body.reasoning_effort}
  return {generation_id:body.generation_id,ordered_prompts:body.messages.map(m=>nativeMessage(m,nativeTools)),max_chat_history:0,custom_api:api,...(nativeTools&&body.tools!==undefined?{tools:structuredClone(body.tools)}:{}),...(nativeTools&&body.tool_choice!==undefined?{tool_choice:structuredClone(body.tool_choice)}:{}),should_stream:body.stream === true}
}

export function frontendMainGenerationConfig(body,options){
 const config=frontendGenerationConfig({...body,chat_completion_source:'openai',reverse_proxy:'https://validation.invalid',model:'current'},options);
 delete config.custom_api.apiurl;delete config.custom_api.model;delete config.custom_api.key;delete config.custom_api.source;
 for(const key of ['custom_include_body','custom_exclude_body'])if(!Object.keys(config.custom_api[key]||{}).length)delete config.custom_api[key];
 return config;
}
