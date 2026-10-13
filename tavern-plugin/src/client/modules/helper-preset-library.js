function installTavernPresetBridge({window:win,call,context,currentScript,enabled=true,post}){
 if(!enabled)return {ready:Promise.resolve(),sync(){},flush:async()=>{}};
 const copy=structuredClone;let cache=null,tail=Promise.resolve(),stamp=context().helperPresetRevision,refreshing=null;
 const ready=call('tavernHelperPresets',{command:{kind:'read'}}).then(result=>{cache=result.presets;return true});
 function loaded(){if(!cache)throw new Error('预设接口尚未就绪');return cache}
 function get(name='in_use'){const state=loaded(),value=name==='in_use'?state.inUse:state.entries.find(p=>p.name===name)?.preset;if(!value)throw new Error('预设不存在：'+name);return copy(value)}
 function write(kind,name,preset){const owner=currentScript().id,lifecycle=Number(context().lifecycleRevision||0);const task=tail.catch(()=>{}).then(async()=>{
  const state=loaded(),expectedPreset=name==='in_use'?state.inUse:state.entries.find(p=>p.name===name)?.preset;
  const result=await call('tavernHelperPresets',{command:{kind,name,preset:copy(preset),expectedPreset:copy(expectedPreset),expectedRevision:state.revision}},{scriptId:owner,lifecycleRevision:lifecycle});cache=result.presets;return true
 });tail=task;task.catch(error=>win.console.error('预设保存失败',error));return task}
 win.getLoadedPresetName=()=>loaded().loadedName;win.getPresetNames=()=>loaded().entries.map(p=>p.name);win.getPreset=get;
 win.replacePreset=(name,preset)=>write('replace',name,preset);win.createOrReplacePreset=(name,preset)=>write('create',name,preset);
 win.updatePresetWith=async(name,updater)=>{const draft=get(name),next=await updater(draft);await write('replace',name,next===undefined?draft:next);return get(name)};
 win.loadPreset=name=>write('load',name);
 win.__dshIzumiSaveAdvice=async(enabled,config)=>{const result=await call('tavernHelperIzumiAdvice',{enabled,config});context().izumiAdvice=result.advice;return result};
 win.__dshDownloadText=(text,filename)=>{if(typeof text!=='string'||text.length>8_000_000)return false;post({type:'dsh-tavern-helper-download',text,filename:String(filename||'预设.json')});return true};
 win.__dshOpenPresetManager=()=>post({type:'dsh-tavern-helper-open-presets'});
 win.__dshIzumiInitialAdvice=()=>copy(loaded().advice);
 win.__dshIzumiReadConnection=()=>call('tavernHelperIzumiConnection',{command:{kind:'read'}}).then(r=>r.config);
 win.__dshIzumiApplyConnection=config=>call('tavernHelperIzumiConnection',{command:{kind:'save',config}}).then(r=>r.config);
 win.__dshIzumiResetConnection=()=>call('tavernHelperIzumiConnection',{command:{kind:'reset'}}).then(r=>r.config);
 win.__dshIzumiModels=config=>call('tavernHelperIzumiConnection',{command:{kind:'models',config}}).then(r=>r.models);
 return {ready,flush:()=>tail,sync(){const next=context().helperPresetRevision;if(next===stamp||refreshing)return;stamp=next;refreshing=tail.catch(()=>{}).then(()=>call('tavernHelperPresets',{command:{kind:'read'}})).then(r=>{cache=r.presets}).catch(error=>win.console.error('预设刷新失败',error)).finally(()=>{refreshing=null})}};
}
