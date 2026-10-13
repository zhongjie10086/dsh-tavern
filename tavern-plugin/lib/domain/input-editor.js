import {realUserText} from './st-game-features.js'
import {createHash} from 'node:crypto'
import {projectTavernHelperContext,replaceTavernHelperMessages} from './tavern-helper-context.js'
export function createInputEditor({chats,history,present}){
 function target(chat,turn){const context=projectTavernHelperContext(chat),index=chat.messages.filter(m=>m&&typeof m==='object').findIndex(m=>(m.tavernRoleOverride||m.tavernRole||m.role)==='user'&&Number(m.turn)===Number(turn)),row=context.messages[index];if(!row)throw Error('这条玩家输入已不存在');return {...row,message:realUserText(chat.messages[index])}}
 function token(chat,row){return createHash('sha256').update(JSON.stringify([chat.id,chat.tavernHelperLifecycleRevision,row.message_id,row.message,row.role])).digest('hex')}
 async function read(sessionId,turn){const chat=await chats.forSession(sessionId);if(!chat)throw Error('会话不存在');const row=target(chat,turn);return {turn:Number(turn),text:row.message,token:token(chat,row)}}
 async function save(sessionId,input){if(typeof input.text!=='string'||!input.text.trim()||input.text.length>200000)throw Error('输入不能为空或超过 20 万字');const chat=await chats.forSession(sessionId);if(!chat)throw Error('会话不存在');const result=await history.mutate(chat,draft=>{const row=target(draft,input.turn);if(token(draft,row)!==input.token)throw Error('输入或会话已变化，请重新打开编辑');const extra=structuredClone(row.extra||{});if(extra.izumi_advice)extra.izumi_advice.text=input.text;return replaceTavernHelperMessages(draft,[{message_id:row.message_id,message:input.text,extra}])});return present(result.chat)}
 return {read,save}
}
