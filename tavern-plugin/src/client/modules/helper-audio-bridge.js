function installTavernHelperAudioBridge({window:w,context,call,currentScript}) {
 const clone=value=>JSON.parse(JSON.stringify(value)),types=['bgm','ambient'],modes=['repeat_one','repeat_all','shuffle','play_one_and_stop'];
 let base=clone(context().helperAudio||{}),tail=Promise.resolve();const pending=[],failures=new Map();
 function typeOf(type){if(!types.includes(type))throw new TypeError('音频类型必须为 bgm 或 ambient');return type}
 function channel(state,type){return state[type]||={settings:{enabled:true,mode:type==='bgm'?'repeat_all':'play_one_and_stop',muted:false,volume:50},playlist:[],current:{src:'',title:'',playing:false,progress:0}}}
 function audio(value){if(!value||typeof value.url!=='string'||!value.url.trim())throw new TypeError('音频缺少链接');const url=value.url.trim(),p=new URL(url,'http://local.invalid');if(!['http:','https:'].includes(p.protocol)&&!/^data:audio[/]/i.test(url))throw new TypeError('音频链接格式不支持');if(p.username||p.password)throw new TypeError('音频链接不能含账户密码');return {title:String(value.title||(/^data:/i.test(url)?'音频':url.split('/').at(-1)?.split('.')[0])||url),url}}
 function apply(state,command){const row=channel(state,command.type);if(command.kind==='settings'){row.settings={...row.settings,...command.settings};if(command.settings.volume!==undefined){row.settings.volume=Math.max(0,Math.min(100,command.settings.volume));row.settings.muted=command.settings.muted??row.settings.volume===0}}
  if(command.kind==='replace')row.playlist=clone(command.playlist);
  if(['append','play'].includes(command.kind))for(const value of command.kind==='play'?[command.audio]:command.playlist){const i=row.playlist.findIndex(x=>x.url===value.url||x.title===value.title);if(i<0)row.playlist.push(clone(value));else if(command.kind==='play')row.playlist[i]=clone(value)}
 }
 function refresh(){const next=clone(base);for(const type of types)channel(next,type);for(const item of pending)apply(next,item.command);context().helperAudio=next;return next}
 function sync(value){if(value){base=clone(value);refresh()}}
 function write(command){typeOf(command.type);const owner=currentScript().id,lifecycle=Number(context().lifecycleRevision)||0,chatId=context().chatId;
  const item={owner,command:clone(command)};pending.push(item);refresh();
  const task=tail.catch(()=>{}).then(()=>call('tavernHelperAudio',{command:item.command},{scriptId:owner,lifecycleRevision:lifecycle}));item.task=task;tail=task;
  task.then(result=>{if(context().chatId===chatId&&Number(context().lifecycleRevision||0)===lifecycle&&result.helperAudio)base=clone(result.helperAudio)},error=>{if(!failures.has(owner))failures.set(owner,error);w.console.error('音频操作失败',error.message)}).finally(()=>{const i=pending.indexOf(item);if(i>=0)pending.splice(i,1);if(context().chatId===chatId)refresh()});
 }
 w.getAudioList=type=>clone(channel(context().helperAudio||={},typeOf(type)).playlist);w.getAudioSettings=type=>clone(channel(context().helperAudio||={},typeOf(type)).settings);w.getCurrentAudio=type=>clone(channel(context().helperAudio||={},typeOf(type)).current||{src:'',title:'',playing:false,progress:0});
 w.playAudio=(type,value)=>write({kind:'play',type,audio:audio(value)});w.pauseAudio=type=>write({kind:'pause',type});
 for(const [name,kind]of [['replaceAudioList','replace'],['appendAudioList','append']])w[name]=(type,values)=>{if(!Array.isArray(values)||values.length>2000)throw new TypeError('播放列表必须为数组且不超过 2000 首');write({kind,type,playlist:values.map(audio)})};
 w.setAudioSettings=(type,settings)=>{if(!settings||typeof settings!=='object'||Array.isArray(settings))throw new TypeError('音频设置必须为对象');if(settings.mode!==undefined&&!modes.includes(settings.mode))throw new TypeError('音频循环模式无效');for(const key of ['enabled','muted'])if(settings[key]!==undefined&&typeof settings[key]!=='boolean')throw new TypeError(key+' 必须为布尔值');if(settings.volume!==undefined&&(typeof settings.volume!=='number'||!Number.isFinite(settings.volume)))throw new TypeError('音量必须为数字');write({kind:'settings',type,settings:clone(settings)})};
 refresh();return {sync,async flush(owner){await Promise.allSettled(pending.filter(p=>p.owner===owner).map(p=>p.task));const error=failures.get(owner);failures.delete(owner);if(error)throw error}};
}
