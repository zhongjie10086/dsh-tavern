import {appendTavernEvent} from './session-message-source.js'
import {sessionEvents} from './session-events.js'

// Historical catalog, invocation and tool pairs are immutable model context.
// Current availability is enforced by the provider and the appended notice.
export function filterSkillMessages(messages) { return messages }

export function ensureWritingSkillStatus(session, skills) {
 const entries=skills.map(skill=>({name:skill.name,enabled:skill.enabled===true})).sort((a,b)=>a.name.localeCompare(b.name))
 const key=JSON.stringify(entries)
 const events=sessionEvents(session)
 const active=events.filter(event=>event.type==='user/message'&&event.data?.source?.writingSkillStatusVersion===1&&(!session.surface?.nodes||session.surface.nodes.includes(event.seq))).at(-1)
 if(active?.data.source.writingSkillStatusKey===key)return null
 const enabled=entries.filter(skill=>skill.enabled).map(skill=>skill.name)
 const disabled=entries.filter(skill=>!skill.enabled).map(skill=>skill.name)
 return appendTavernEvent(session,'user/message',{
  id:'tavern-writing-status:'+session.id+':'+events.length,
  role:'user',
  content:[{type:'text',text:'【当前写作技能状态】\n启用：'+(enabled.join('、')||'无')+'\n停用：'+(disabled.join('、')||'无')+'\n本次请求只使用当前启用的写作技能。历史目录、调用结果或说明中已停用或未列为启用的写作技能不再适用；当前状态优先于旧说明。'}],
  source:{kind:'plugin',plugin:'dsh-tavern',form:'snapshot',writingSkillStatusVersion:1,writingSkillStatusKey:key}
 },{surfaceOp:'append'})
}
