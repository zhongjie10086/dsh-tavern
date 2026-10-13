import { projectTavernHelperContext } from './tavern-helper-context.js'
import { exportSpCheckpoint } from './sp-checkpoint.js'
const copy = value => structuredClone(value)
export function legacyChatDocument(chat) {
  const context = projectTavernHelperContext(chat)
  return [{ user_name:chat.macroState?.userName||'你', character_name:chat.cardName||'', chat_metadata:context.chatMetadata },
    ...context.messages.map(m=>({...copy(m.pluginData), name:m.name, mes:m.message, is_user:m.role==='user', is_system:m.role==='system',
      swipe_id:m.swipe_id, swipes:m.swipes, variables:m.swipes_data, extra:m.extra, swipe_info:m.swipes_info,
      ...(m.id?{id:m.id}:{}),...(m.send_date?{send_date:copy(m.send_date)}:{})}))]
}
export function checkpointAtMessage(chat,state,index) {
  if(!Number.isInteger(index)||index<0||index>=chat.messages.length||chat.messages[index].role!=='assistant')throw new Error('请选择有效的 AI 消息楼层')
  const floor=chat.messages.slice(0,index+1).filter(m=>m.role==='assistant'&&!m.greeting).length
  const latest=chat.messages.filter(m=>m.role==='assistant'&&!m.greeting).length
  let selected=state
  if(floor<latest){
    const frame=[...(state.layerRecords?.frames||[])].reverse().find(f=>f.floor<=floor)
    const prior=frame&&state.layerRecords.checkpoints[frame.hash]
    if(!prior)throw new Error('这一历史楼层没有数据库恢复点，请保留较新的楼层后再搬家')
    selected={...state,...prior}
  }
  return {checkpoint:exportSpCheckpoint(selected),isolationKey:state.isolationCode||'main'}
}
export function createTavernChatFiles({chats,assertOwner,readDatabase,save,open,canReadOtherCards = async () => false}) {
  async function current(sessionId,scriptId,lifecycle){return assertOwner(sessionId,scriptId,lifecycle)}
  async function all(source,scriptId){const crossCard=await canReadOtherCards(source,scriptId);return (await Promise.all((await chats.list()).map(id=>chats.read(id)))).filter(c=>c&&c.mode!=='card'&&(crossCard||c.cardPath===source.cardPath))}
  async function perform(sessionId,operation,scriptId,lifecycle){
    const source=await current(sessionId,scriptId,lifecycle),body=operation.body||{}
    if(operation.path==='/api/groups/all')return []
    if(operation.path==='/api/characters/all'){const values=await all(source,scriptId);return [...new Map(values.map(c=>[c.cardPath,{name:c.cardName,avatar:c.cardPath,chat:c.legacyChatFileName||c.id}])).values()]}
    if(operation.path==='/api/characters/chats')return (await all(source,scriptId)).filter(c=>c.cardPath===body.avatar_url).map(c=>({file_id:c.legacyChatFileName||c.id,file_name:(c.legacyChatFileName||c.id)+'.jsonl',mes:c.messages.length,last_mes:c.updatedAt||0}))
    if(operation.path==='/api/chats/get'){
      const target=(await all(source,scriptId)).find(c=>c.cardPath===body.avatar_url&&(c.id===body.file_name||c.legacyChatFileName===body.file_name))
      if(!target)throw new Error('聊天文件不存在')
      return legacyChatDocument(target)
    }
    if(operation.path==='checkpoint')return checkpointAtMessage(source,await readDatabase(sessionId),Number(body.messageIndex))
    if(operation.path==='/api/chats/save'){
      if(!save)throw new Error('当前宿主尚未提供聊天搬家保存')
      return save({source,body,scriptId,lifecycle})
    }
    if(operation.path==='open'){
      if(!open)throw new Error('聊天切换接口尚未就绪')
      return open({source,body,scriptId,lifecycle})
    }
    throw new Error('不支持这项聊天文件操作：'+String(operation.path))
  }
  return {perform}
}
