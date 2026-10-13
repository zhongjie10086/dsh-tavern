export function frontendGenerationConfig(body) {
  if (!body || body.chat_completion_source !== 'openai' || typeof body.reverse_proxy !== 'string' || !body.reverse_proxy.trim() || typeof body.model !== 'string' || !body.model.trim()) throw Error('请为扩展配置独立的 OpenAI 兼容 API 地址和模型')
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 10000 || body.messages.some(m=>!['system','user','assistant'].includes(m?.role)||typeof m.content!=='string')) throw Error('扩展模型消息格式无效')
  if (body.tools?.length || body.tool_choice && body.tool_choice !== 'none') throw Error('扩展的此生成接口只支持文本输出')
  const api = {apiurl:body.reverse_proxy,key:String(body.proxy_password || ''),model:body.model,source:'custom',custom_include_body:{},custom_exclude_body:[]}
  for (const field of ['temperature','max_tokens','top_p','frequency_penalty','presence_penalty','top_k']) if (Object.hasOwn(body,field)) {
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field])) throw Error('无效模型参数：' + field)
    api[field] = body[field]
  }
  if(Object.hasOwn(body,'reasoning_effort')){if(!['none','minimal','low','medium','high','xhigh'].includes(body.reasoning_effort))throw Error('无效模型参数：reasoning_effort');api.custom_include_body.reasoning_effort=body.reasoning_effort}
  return {generation_id:body.generation_id,ordered_prompts:body.messages.map(m=>({role:m.role,content:m.content})),max_chat_history:0,custom_api:api,should_stream:body.stream === true}
}

export function frontendMainGenerationConfig(body){
 const config=frontendGenerationConfig({...body,chat_completion_source:'openai',reverse_proxy:'https://validation.invalid',model:'current'});
 delete config.custom_api.apiurl;delete config.custom_api.model;delete config.custom_api.key;delete config.custom_api.source;
 for(const key of ['custom_include_body','custom_exclude_body'])if(!Object.keys(config.custom_api[key]||{}).length)delete config.custom_api[key];
 return config;
}
