function createTavernHelperAudioPlayer({window:w,sessionId,publish,saveSettings}) {
 const clone=value=>structuredClone(value),types=['bgm','ambient'],background=w.__dshTavernBackground===true;
 let state={settingsRevision:-1,playlistRevision:-1},panel,panelWindow,closed=false;const players=new Map(),labels=new Map(),errors=new Map(),volumeTimers=new Map();
 function channel(type){return state[type]||={settings:{enabled:true,mode:type==='bgm'?'repeat_all':'play_one_and_stop',muted:false,volume:50},playlist:[],src:''};}
 function snapshot(){return {...clone(state),...Object.fromEntries(types.map(type=>{const row=channel(type),player=players.get(type),src=row.src||'';return [type,{settings:clone(row.settings),playlist:clone(row.playlist),current:{src,title:row.playlist.find(a=>a.url===src)?.title||'',playing:Boolean(player&&!player.paused&&!player.ended),progress:player&&Number.isFinite(player.duration)&&player.duration>0?Math.min(100,Math.max(0,player.currentTime/player.duration*100)):0}}]}))};}
 function changed(){if(closed)return;for(const type of types){const select=labels.get(type);if(select){const row=channel(type),key=JSON.stringify(row.playlist);if(select.dataset.playlist!==key){select.replaceChildren(...row.playlist.map(audio=>{const item=w.document.createElement('option');item.value=audio.url;item.textContent=audio.title;return item}));select.dataset.playlist=key;}if(row.src)select.value=row.src;}}publish?.(snapshot());}
 function notice(type,message){errors.set(type,message);const target=panel?.querySelector('[data-audio-error="'+type+'"]');if(target)target.textContent=message;}
 async function play(type,src,reset=true){
  const row=channel(type);row.src=src;notice(type,'');if(background){changed();return;}
  const player=media(type);player.volume=row.settings.volume/100;player.muted=row.settings.muted;player.loop=row.settings.mode==='repeat_one';if(player.getAttribute('src')!==src)player.src=src;else if(reset)player.currentTime=0;
  if(!row.settings.enabled){player.pause();changed();return;}
  try{await player.play();}catch(error){notice(type,error.name==='NotAllowedError'?'浏览器需要一次点击才能播放，请在音乐浮窗点击播放。':'音频未能播放，请检查链接。');open();}changed();
 }
 function media(type){
  if(players.has(type))return players.get(type);if(background)return null;
  const player=w.document.createElement('audio');const settings=channel(type).settings;player.volume=settings.volume/100;player.muted=settings.muted;player.loop=settings.mode==='repeat_one';player.controls=true;player.preload='metadata';player.style.cssText='display:block;width:100%;margin:8px 0';player.setAttribute('aria-label',type==='bgm'?'背景音乐播放器':'环境音播放器');players.set(type,player);
  for(const event of ['play','pause','timeupdate','loadedmetadata','seeked'])player.addEventListener(event,changed);
  player.addEventListener('error',()=>{notice(type,'音频未能加载，请检查链接。');changed();});
  player.addEventListener('volumechange',()=>{
   const settings=channel(type).settings,volume=Math.round(player.volume*100);if(volume===settings.volume&&player.muted===settings.muted)return;
   clearTimeout(volumeTimers.get(type));volumeTimers.set(type,setTimeout(()=>{volumeTimers.delete(type);void Promise.resolve(saveSettings?.(type,{volume:Math.round(player.volume*100),muted:player.muted})).then(sync).catch(error=>notice(type,error.message));},120));changed();
  });
  player.addEventListener('ended',()=>{const row=channel(type),list=row.playlist;if(!row.settings.enabled||!list.length||row.settings.mode==='play_one_and_stop'){changed();return;}const index=list.findIndex(a=>a.url===row.src),next=row.settings.mode==='repeat_one'?Math.max(0,index):row.settings.mode==='shuffle'?Math.floor(Math.random()*list.length):(index+1)%list.length;void play(type,list[next].url);});
  return player;
 }
 function sync(value){
  if(!value)return snapshot();
  const settingsFresh=Number(value.settingsRevision??-1)>=state.settingsRevision,listFresh=Number(value.playlistRevision??-1)>=state.playlistRevision;
  for(const type of types){const row=channel(type);if(settingsFresh&&value[type]?.settings)row.settings=clone(value[type].settings);if(listFresh&&value[type]?.playlist)row.playlist=clone(value[type].playlist);if(listFresh&&row.src&&!row.playlist.some(a=>a.url===row.src)){players.get(type)?.pause();row.src=''}if(!row.src&&value[type]?.current?.src&&row.playlist.some(a=>a.url===value[type].current.src))row.src=value[type].current.src;
   const player=players.get(type);if(player){if(player.volume!==row.settings.volume/100)player.volume=row.settings.volume/100;if(player.muted!==row.settings.muted)player.muted=row.settings.muted;player.loop=row.settings.mode==='repeat_one';if(!row.settings.enabled)player.pause();}
  }
  if(settingsFresh)state.settingsRevision=Number(value.settingsRevision)||0;if(listFresh)state.playlistRevision=Number(value.playlistRevision)||0;changed();return snapshot();
 }
 async function apply(value,command){sync(value);if(command.kind==='play'){const row=channel(command.type),audio=row.playlist.find(a=>a.url===command.audio.url||a.title===command.audio.title);if(audio)await play(command.type,audio.url);}if(command.kind==='pause'){players.get(command.type)?.pause();changed();}return snapshot();}
 function open(){
  if(background||closed)return;if(!panel){panel=w.document.createElement('div');panel.id='dsh-tavern-audio-panel';const bar=w.document.createElement('div');bar.className='dsh-floating-titlebar';bar.textContent='音乐与音效';panel.append(bar);
   const content=w.document.createElement('div');content.style.cssText='padding:14px;overflow:auto';panel.append(content);
   for(const type of types){const title=w.document.createElement('h3');title.textContent=type==='bgm'?'背景音乐':'环境音';const select=w.document.createElement('select');select.setAttribute('aria-label',title.textContent+'列表');labels.set(type,select);select.style.cssText='width:100%;padding:6px';select.onchange=()=>{void play(type,select.value)};
    const button=w.document.createElement('button');button.textContent='播放'+title.textContent;button.onclick=()=>{const src=select.value||channel(type).src;if(src)void play(type,src)};
    const error=w.document.createElement('p');error.dataset.audioError=type;error.setAttribute('role','status');error.textContent=errors.get(type)||'';content.append(title,select,button,media(type),error);
   }
   w.document.body.append(panel);panelWindow=createTavernScriptWindow(w,panel,()=>panelWindow.hide(),()=>{},{key:'audio',title:'音乐与音效'});
  }panelWindow.open();sync(state);
 }
 return {snapshot,sync,apply,open,dispose(){closed=true;for(const [type,timer]of volumeTimers){clearTimeout(timer);const p=players.get(type);if(p)void Promise.resolve(saveSettings?.(type,{volume:Math.round(p.volume*100),muted:p.muted})).catch(()=>{})}for(const player of players.values()){player.pause();player.removeAttribute('src');player.load();player.remove();}players.clear();panelWindow?.dispose();panel?.remove();}};
}

function tavernAudioController(sessionId,host=window,invoke=rpc){
 const prior=host.__dshTavernAudioController;if(prior?.sessionId===sessionId)return prior.player;prior?.player.dispose();
 const player=createTavernHelperAudioPlayer({window:host,sessionId,publish:helperAudio=>host.dispatchEvent?.(new host.CustomEvent('dsh-tavern-audio-state',{detail:{sessionId,helperAudio}})),saveSettings:async(type,settings)=>{const result=await invoke('changeTavernAudio',{command:{kind:'settings',type,settings}},sessionId);return result.helperAudio}});
 host.__dshTavernAudioController={sessionId,player};return player;
}
function TavernAudioSettings(props){
 const h=React.createElement,[state,setState]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[urls,setUrls]=React.useState({bgm:'',ambient:''}),[titles,setTitles]=React.useState({bgm:'',ambient:''});
 const player=tavernAudioController(props.sessionId);
 React.useEffect(()=>{let active=true;props.api('getTavernAudio',{}).then(result=>{if(active){player.sync(result.helperAudio);setState(player.snapshot())}},e=>setError(e.message));const listener=e=>{if(e.detail.sessionId===props.sessionId)setState(e.detail.helperAudio)};window.addEventListener('dsh-tavern-audio-state',listener);return()=>{active=false;window.removeEventListener('dsh-tavern-audio-state',listener)}},[props.sessionId]);
 async function command(command){setBusy(true);setError('');try{const result=await props.api('changeTavernAudio',{command});await player.apply(result.helperAudio,command);setState(player.snapshot())}catch(e){setError(e.message)}finally{setBusy(false)}}
 return h('section',{className:'dsh-audio-settings','aria-label':'音频播放与设置'},h('h3',null,'音频播放与设置'),error?h('p',{role:'alert'},error):null,!state?h('p',null,'读取音频设置…'):['bgm','ambient'].map(type=>{const row=state[type],label=type==='bgm'?'背景音乐':'环境音';return h('fieldset',{key:type,disabled:busy,className:'dsh-sp-card'},h('legend',null,label),
 ...[['enabled','启用'],['muted','静音']].map(([key,text])=>h('label',{key},h('input',{type:'checkbox',checked:row.settings[key],onChange:e=>command({kind:'settings',type,settings:{[key]:e.target.checked}})}),text)),
 h('label',{className:'dsh-sp-field'},'播放模式',h('select',{'aria-label':label+'播放模式',value:row.settings.mode,onChange:e=>command({kind:'settings',type,settings:{mode:e.target.value}})},...Object.entries({repeat_one:'单曲循环',repeat_all:'全部循环',shuffle:'随机播放',play_one_and_stop:'播放一首后停止'}).map(([v,t])=>h('option',{key:v,value:v},t)))),
 h('label',{className:'dsh-sp-field'},'音量',h('input',{type:'range',min:0,max:100,'aria-label':label+'音量',defaultValue:row.settings.volume,key:row.settings.volume,onPointerUp:e=>command({kind:'settings',type,settings:{volume:Number(e.target.value)}}),onKeyUp:e=>command({kind:'settings',type,settings:{volume:Number(e.target.value)}})})),
 h('input',{'aria-label':label+'标题',placeholder:'曲目名称（可选）',value:titles[type],onChange:e=>setTitles({...titles,[type]:e.target.value})}),h('input',{'aria-label':label+'链接',placeholder:'音频链接',value:urls[type],onChange:e=>setUrls({...urls,[type]:e.target.value})}),h('button',{className:'dsh-tavern-btn',disabled:!urls[type].trim(),onClick:()=>command({kind:'append',type,playlist:[{url:urls[type],title:titles[type]}]})},'添加'+label),
 h('ul',null,row.playlist.map(audio=>h('li',{key:audio.url},h('span',null,audio.title),h('button',{className:'dsh-tavern-btn',onClick:()=>command({kind:'play',type,audio})},'播放'),h('button',{className:'dsh-tavern-btn',onClick:()=>command({kind:'replace',type,playlist:row.playlist.filter(a=>a.url!==audio.url)})},'移除')))),
 h('button',{className:'dsh-tavern-btn',onClick:()=>command({kind:'pause',type})},'暂停'+label),h('button',{className:'dsh-tavern-btn',onClick:()=>player.open()},'打开播放器'),h('p',{role:'status'},row.current?.playing?'正在播放：'+row.current.title:'已暂停'))}));
}
