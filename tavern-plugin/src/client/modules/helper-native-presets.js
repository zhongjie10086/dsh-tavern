function installTavernNativePresetBridge({window:win,call,context,currentScript,enabled=false,loadPreset}) {
 let catalog=null,tail=Promise.resolve(),refreshing=null,stamp=null;const snapshots=new Map(),doc=win.document;
 if(!doc?.createElement)return {ready:Promise.resolve(),flush:async()=>{},sync(){}};
 const select=doc.createElement('select');select.id='settings_preset_openai';select.hidden=true;select.style.display='none';
 function install(value){catalog=value;select.replaceChildren(...value.entries.map((entry,index)=>{const option=doc.createElement('option');option.value=String(index);option.textContent=entry.name;option.selected=entry.name===value.loadedName;return option}));if(!value.entries.some(e=>e.name===value.loadedName))select.selectedIndex=-1;return value}
 async function refresh(){const requested=String(context().helperPresetRevision??'');const result=install((await call('tavernHelperPresets',{command:{kind:'native-catalog'}})).catalog);stamp=requested;return result}
 const ready=enabled?refresh():Promise.resolve();
 const nameOf=value=>{const name=String(value);return catalog?.entries.find(e=>e.name===name)?.name||catalog?.entries[Number(value)]?.name||name};
 async function read(value){await ready;if(!catalog)await refresh();const result=(await call('tavernHelperPresets',{command:{kind:'native-read',name:nameOf(value)}})).preset;snapshots.set(result.name,result);return structuredClone(result.document)}
 function write(kind,name,preset){name=String(name);const owner={scriptId:currentScript().id,lifecycleRevision:Number(context().lifecycleRevision)||0};
  const task=tail.catch(()=>{}).then(async()=>{await ready;if(!catalog)await refresh();
   if(kind==='native-delete'&&!snapshots.has(name))await read(name);
   const expected=snapshots.get(name);if(!expected&&catalog.entries.some(e=>e.name===name))throw Error('保存前请先读取预设：'+name);
   const result=await call('tavernHelperPresets',{command:{kind,name,...(preset?{preset:structuredClone(preset)}:{}),expectedDigest:expected?.digest??null}},owner);
   install(result.catalog);if(result.preset)snapshots.set(name,result.preset);else snapshots.delete(name);return kind==='native-save'?name:true;
  });tail=task;return task;
 }
 const manager={apiId:'openai',select:[select],getPresetList:()=>{const rows=catalog?.entries||[];return {preset_names:rows.map(e=>e.name),presets:rows.map(e=>{const saved=snapshots.get(e.name);return saved?structuredClone(saved.document):undefined})}},
  getAllPresets:()=>catalog?.entries.every(entry=>snapshots.has(entry.name))?manager.getPresetList():undefined,
  getCompletionPresetByName:name=>{const value=snapshots.get(nameOf(name));return value?structuredClone(value.document):undefined},getPresetByName:name=>manager.getCompletionPresetByName(name),findPreset:name=>(catalog?.entries||[]).findIndex(e=>e.name===name),
  getSelectedPresetName:()=>catalog?.loadedName||'',getSelectedPreset:()=>select.value,
  savePreset:(name,preset)=>write('native-save',name,preset),deletePreset:name=>write('native-delete',name),
  selectPreset:async value=>{const name=nameOf(value);await loadPreset(name);await refresh();return true}
 };
 select.addEventListener('change',()=>{void manager.selectPreset(select.value).catch(error=>win.toastr.error(error.message))});
 function mount(){if(!select.isConnected)doc.body.appendChild(select)}if(doc.body)mount();else doc.addEventListener('DOMContentLoaded',mount,{once:true});
 win.__dshGetNativePresetManager=apiId=>{if(apiId&& !['openai','chat-completion','chat_completion'].includes(apiId))throw Error('当前只提供聊天补全预设管理器');return manager};
 win.__dshNativePresetRequest=async(path,body)=>{if(body.apiId&&!['openai','chat-completion','chat_completion'].includes(body.apiId))throw Error('预设 API 类型不支持');
  if(path==='/api/settings/get'){const result=await call('tavernHelperPresets',{command:{kind:'native-read-all'}});install(result.catalog);for(const row of result.presets)snapshots.set(row.name,row);const data=manager.getPresetList();return {openai_settings:data.presets.map(p=>JSON.stringify(p)),openai_setting_names:data.preset_names}}
  if(path==='/api/presets/save')return {name:await manager.savePreset(body.name,body.preset)};
  if(path==='/api/presets/delete'){await manager.deletePreset(body.name);return {ok:true}}throw Error('未知预设接口');
 };
 return {ready,flush:()=>tail,sync(){if(!enabled||!catalog||refreshing||stamp===String(context().helperPresetRevision??''))return;refreshing=tail.catch(()=>{}).then(refresh).catch(error=>win.console.error('预设列表刷新失败',error)).finally(()=>{refreshing=null})}};
}
