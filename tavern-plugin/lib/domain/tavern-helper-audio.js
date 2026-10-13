const clone=value=>structuredClone(value)
const defaults=type=>({enabled:true,mode:type==='bgm'?'repeat_all':'play_one_and_stop',muted:false,volume:50})
const modes=['repeat_one','repeat_all','shuffle','play_one_and_stop']
function typeOf(type){if(!['bgm','ambient'].includes(type))throw new TypeError('音频类型必须为 bgm 或 ambient');return type}
export function normalizeHelperAudio(value,limits={itemBytes:4*1024*1024}){
 if(!value||typeof value.url!=='string'||!value.url.trim())throw new TypeError('音频缺少有效链接')
 const url=value.url.trim();let parsed;try{parsed=new URL(url,'http://local.invalid')}catch{throw new TypeError('音频链接无效')}
 if(Buffer.byteLength(url)>(/^data:/i.test(url)?limits.itemBytes:8192))throw new TypeError('音频链接过大：内嵌音频最多 '+(limits.itemBytes/1024**2)+' MiB，普通链接最多 8 KiB')
 if(!['http:','https:'].includes(parsed.protocol)&&!/^data:audio\//i.test(url))throw new TypeError('音频需要 HTTP、HTTPS 或 data:audio 链接')
 if(parsed.username||parsed.password)throw new TypeError('音频链接不能内嵌账户密码')
 return {title:String(value.title||(/^data:/i.test(url)?'音频':url.split('/').at(-1)?.split('.')[0])||url).slice(0,500),url}
}
export function normalizeHelperAudioSettings(type,previous,patch){
 typeOf(type);if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new TypeError('音频设置必须为对象')
 const next={...defaults(type),...previous}
 for(const key of ['enabled','muted'])if(patch[key]!==undefined){if(typeof patch[key]!=='boolean')throw new TypeError(key+' 必须为布尔值');next[key]=patch[key]}
 if(patch.mode!==undefined){if(!modes.includes(patch.mode))throw new TypeError('音频循环模式无效');next.mode=patch.mode}
 if(patch.volume!==undefined){if(typeof patch.volume!=='number'||!Number.isFinite(patch.volume))throw new TypeError('音量必须为数字');next.volume=Math.max(0,Math.min(100,patch.volume));if(patch.muted===undefined)next.muted=next.volume===0}
 return next
}
/** Settings belong to the profile; playlists belong to the game. Playback itself belongs to the visible browser. */
export function createTavernHelperAudio({store,chats,assertOwner,limits={itemBytes:4*1024**2,totalBytes:32*1024**2}}){
 const file='helper-audio-settings.json'
 async function snapshot(chat={}){const settings=await store.readJson(file)||{};return {settingsRevision:settings.revision||0,playlistRevision:chat.tavernAudio?.revision||0,...Object.fromEntries(['bgm','ambient'].map(type=>[type,{settings:{...defaults(type),...settings[type]},playlist:clone(chat.tavernAudio?.[type]||[]),current:{src:chat.tavernAudio?.selected?.[type]||'',title:'',playing:false,progress:0}}]))}}
 async function mutate(sessionId,command,scriptId,lifecycleRevision){
  async function owner(){const chat=scriptId?await assertOwner(sessionId,scriptId,lifecycleRevision):await chats.forSession(sessionId);if(!chat||chat.mode==='card')throw new Error('请先进入游玩会话');if(Number(chat.tavernHelperLifecycleRevision||0)!==Number(lifecycleRevision||0))throw new Error('会话已变化，请刷新后重试');return chat}
  let chat=await owner();const type=typeOf(command?.type),kind=command.kind
  if(kind==='settings')await store.updateJson(file,async current=>{await owner();return {...current,[type]:normalizeHelperAudioSettings(type,current?.[type],command.settings),revision:(current?.revision||0)+1}})
  else if(['replace','append','play'].includes(kind)){
   const values=kind==='play'?[command.audio]:command.playlist;if(!Array.isArray(values)||values.length>2000)throw new TypeError('音频列表必须为数组，最多 2000 首')
   const incoming=values.map(value=>normalizeHelperAudio(value,limits))
   chat=await chats.update(chat.id,current=>{
    if(Number(current.tavernHelperLifecycleRevision||0)!==Number(lifecycleRevision||0))throw new Error('脚本已切换，音频设置未保存')
    const state=clone(current.tavernAudio||{}),list=kind==='replace'?clone(incoming):clone(state[type]||[])
    for(const audio of kind==='replace'?[]:incoming){const index=list.findIndex(row=>row.url===audio.url||row.title===audio.title);if(index<0)list.push(audio);else if(kind==='play')list[index]=audio}
    if(list.length>2000)throw new Error('音频列表超过 2000 首');const next={...state,[type]:list,selected:{...state.selected,...(kind==='play'?{[type]:incoming[0].url}:kind==='replace'&&!list.some(a=>a.url===state.selected?.[type])?{[type]:''}:{})},revision:(state.revision||0)+1};if(Buffer.byteLength(JSON.stringify(next))>limits.totalBytes)throw new Error('本局音频列表及当前曲目合计超过 '+(limits.totalBytes/1024**2)+' MiB，请使用外部音频链接');current.tavernAudio=next;return current
   },{source:'helper.audio'})
  }else if(kind!=='pause')throw new TypeError('未知音频操作')
  return {updated:true,helperAudio:await snapshot(chat)}
 }
 return {snapshot,mutate}
}
