import {createHash} from 'node:crypto'
import {finishJsonDraft} from './json-draft.js'
import {isFrozenJson} from './readonly-json.js'

const syntax = /<%|(?:^|\n)\s*@@(?:preprocessing|if|else|activate|generate|render|initial)/
const cardFields = ['description','personality','scenario','first_mes','mes_example','system_prompt','post_history_instructions']
const hash = value => createHash('sha256').update(value).digest('hex')

// Inspect prompt-bearing fields, not script source, runtime variables, credentials,
// or every historical message. Immutable resource subtrees share scan results.
export function createTemplateEnginePolicy({maxSessions=128}={}) {
  const scans=new WeakMap(), sessions=new Map()
  function scan(value,kind) {
    value=finishJsonDraft(value)
    if(value&&isFrozenJson(value)&&scans.get(value)?.has(kind))return scans.get(value).get(kind)
    const texts=[],matches=[]
    const add=(text,label)=>{if(typeof text==='string'){texts.push([label,text]);if(syntax.test(text))matches.push(label)}}
    if(kind==='card') {
      const labels=['描述','性格','场景','开场白','示例对话','系统提示词','历史后提示词']
      for(const [i,key]of cardFields.entries())add(value?.[key],labels[i])
      for(const [i,text]of (value?.alternate_greetings||[]).entries())add(text,'备选开场 '+(i+1))
      add(value?.extensions?.depth_prompt?.prompt,'深度提示词')
    } else if(kind==='preset') {
      for(const phase of ['front','middle','back']) {
        const rows=value?.[phase]?.entries
        if(rows?.length)for(const row of rows){if(row.enabled!==false)add(row.content??row.text,row.name||row.id||phase)}
        else add(value?.[phase]?.text,phase)
      }
      // Imported snapshots without phase projections still have active entries.
      if(!['front','middle','back'].some(key=>value?.[key]))for(const row of value?.compatibilityPreset?.entries||[]){if(row.enabled!==false&&row.ordered!==false&&row.marker!==true)add(row.content,row.name||row.entryKey||'预设条目')}
      for(const rule of value?.regexScripts||[])if(rule.enabled!==false)add(rule.replaceString,rule.scriptName||rule.id||'预设正则')
    } else for(const entry of value||[])add(entry.content,entry.title||entry.comment||entry.ref||String(entry.uid??'世界书条目')) // Disabled InitialVariables/preprocessing entries can be executable.
    const result={revision:hash(JSON.stringify(texts)),detected:matches.length>0,matches}
    if(value&&isFrozenJson(value)){const cached=scans.get(value)||new Map();cached.set(kind,result);scans.set(value,cached)}
    return result
  }
  function resolve({chat,settings={},card,preset,worldbook,texts=[],api=false}) {
    const resources=[scan(card,'card'),scan(preset,'preset'),scan(worldbook?.view?.entries,'worldbook')]
    const revision=hash(JSON.stringify([chat?.cardPath,...resources.map(row=>row.revision)])),key=chat?.sessionId||chat?.id
    let current=sessions.get(key)
    if(!current||current.revision!==revision)current={revision,trigger:null}
    if(api)current.trigger='本局调用了模板 API'
    else if(texts.some(text=>typeof text==='string'&&syntax.test(text)))current.trigger='本轮文本含模板语法'
    if(key){sessions.delete(key);sessions.set(key,current);while(sessions.size>maxSessions)sessions.delete(sessions.keys().next().value)}
    const local=chat?.promptTemplateEngine,configured=['auto','lightweight','full'].includes(local)?local:['auto','lightweight','full'].includes(settings.engine)?settings.engine:'auto'
    const scope=local?'本局设置':settings.engine?'全局设置':'自动选择'
    const reason=settings.enabled===false?'模板总开关已关闭':configured!=='auto'?scope+'：'+(configured==='full'?'完整':'轻量'):resources[0].detected?'角色卡含模板语法':resources[1].detected?'当前预设含模板语法':resources[2].detected?'本局绑定的世界书含模板语法':current.trigger||'未发现模板语法或模板 API 调用'
    const engine=settings.enabled===false?'disabled':configured==='auto'?(resources.some(row=>row.detected)||current.trigger?'full':'lightweight'):configured
    const names=[card?.name||chat?.cardPath||'角色卡',preset?.presetName||'当前预设',worldbook?.view?.displayName||'本局世界书']
    const triggers=resources.flatMap((row,index)=>row.matches.map(entry=>({resource:names[index],entry})))
    return {configured,scope,engine,reason,triggers,resourceRevision:revision}
  }
  return {resolve}
}
