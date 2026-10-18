import { assertScriptPromptBudget } from './tavern-script-prompts.js'
const defaults = ['world_info_before', 'persona_description', 'char_description', 'char_personality', 'scenario', 'world_info_after', 'dialogue_examples', 'chat_history', 'user_input']
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
export function compileHelperGeneration(config, { history = [], prompts = {}, preset = null, raw = true, scriptPrompts = [],contentParts=false,nativeTools=false,promptLimits } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('生成参数必须是对象')
  assertScriptPromptBudget(scriptPrompts,promptLimits)
  assertScriptPromptBudget(config.injects || [],promptLimits)
  assertScriptPromptBudget([...scriptPrompts, ...(config.injects || [])],promptLimits)
  const allowed = new Set(['ordered_prompts', 'user_input', 'max_chat_history', 'should_stream', 'should_silence', 'overrides', 'custom_api', 'generation_id', 'injects', 'image', 'tools', 'tool_choice', 'json_schema'])
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error('未知生成参数：' + key)
  if (config.tools && config.json_schema) throw new Error('tools 与 json_schema 不能同时使用')
  const limit = config.max_chat_history ?? 'all'
  if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('max_chat_history 必须是非负整数或 all')
  const messages = [], overrides = config.overrides || {}, selected = overrides.chat_history?.prompts || (limit === 'all' ? history : limit === 0 ? [] : history.slice(-limit))
  function append(role, text, images,toolCallId) {
    if (!(nativeTools?['system','user','assistant','tool']:['system', 'user', 'assistant']).includes(role) || typeof text !== 'string' && !(contentParts&&Array.isArray(text))) throw new Error('生成消息 role 或 content 无效')
    const content = Array.isArray(text) ? text.map(part=>{if(part?.type==='text'&&typeof part.text==='string'||part?.type==='image'&&typeof part.url==='string'||nativeTools&&part?.type==='tool-call'&&typeof part.id==='string'&&typeof part.name==='string'&&typeof part.arguments==='string')return structuredClone(part);throw new Error('生成消息内容无效')}) : [{ type: 'text', text }]
    for (const image of images ? Array.isArray(images) ? images : [images] : []) {
      if (typeof image !== 'string') throw new Error('图片需先转换为 data URL 或 URL')
      content.push({ type: 'image', url: image })
    }
    if (Array.isArray(text) || text.trim() || content.length > 1) messages.push({ role, content,...(role==='tool'?{toolCallId}: {}) })
  }
  function entries(phase) { for (const entry of preset?.[phase]?.entries || []) append(entry.role || 'system', String(entry.content || '')) }
  if (!raw) entries('front')
  const order = config.ordered_prompts || defaults
  if (!Array.isArray(order)) throw new Error('ordered_prompts 必须为数组')
  for (const item of order) {
    if (item === 'chat_history') {
      for (const message of selected) append(message.role, message.content ?? message.text ?? message.message ?? '', message.image)
      if (overrides.chat_history?.author_note) append('system', overrides.chat_history.author_note)
      if (!order.includes('user_input')) append('user', config.user_input || '', config.image)
    } else if (item === 'user_input') append('user', config.user_input || '', config.image)
    else if (typeof item === 'string' && defaults.includes(item)) append('system', own(overrides, item) ? overrides[item] : prompts[item] || '')
    else if (item && typeof item === 'object') append(item.role, item.content, item.image,item.toolCallId)
    else throw new Error('未知内置提示词：' + String(item))
  }
  if (!order.includes('user_input') && !order.includes('chat_history')) append('user', config.user_input || '', config.image)
  if (!raw) { entries('middle'); entries('back') }
  for (const injection of [...scriptPrompts, ...(config.injects || [])]) {
    if(injection.position==='none')continue;
    const content = { role: injection.role || 'system', content: [{ type: 'text', text: String(injection.content || '') }] }
    if (!['system', 'user', 'assistant'].includes(content.role)) throw new Error('注入角色无效')
    const index = ['before_prompt','before_system'].includes(injection.position) ? 0 : injection.position === 'after_prompt' ? messages.length : injection.position==='after_system' ? (messages.findIndex(m=>m.role!=='system')<0?messages.length:messages.findIndex(m=>m.role!=='system')) : Math.max(0, messages.length - Number(injection.depth || 0))
    messages.splice(index, 0, content)
  }
  if (!messages.length) throw new Error('生成提示词不能为空')
  return { messages, system: '', customApi: config.custom_api, tools: config.tools, toolChoice: config.tool_choice, jsonSchema: config.json_schema }
}
export async function generateHelperRaw(config, context) {
  const compiled = compileHelperGeneration(config, context)
  return await context.callModel(Object.fromEntries(Object.entries({ ...compiled, sessionId: context.sessionId || '', signal: context.signal, onDelta: context.onDelta }).filter(([, value]) => value !== undefined)))
}

/** Translate existing native helper blocks back to the independent OpenAI wire. */
export function helperWireMessages(messages){
 return messages.map(message=>{
  const calls=message.content.filter(part=>part.type==='tool-call'),parts=message.content.filter(part=>part.type!=='tool-call').map(part=>part.type==='image'?{type:'image_url',image_url:{url:part.url}}:{type:'text',text:part.text});
  return {role:message.role,content:message.role==='tool'?parts.map(part=>part.text||'').join(''):parts,...(message.role==='tool'?{tool_call_id:message.toolCallId}:{}),...(calls.length?{tool_calls:calls.map(part=>({id:part.id,type:'function',function:{name:part.name,arguments:part.arguments}}))}:{})};
 });
}
