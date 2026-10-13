const clone = value => value === undefined ? undefined : structuredClone(value)
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key)
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const record = value => value !== null && typeof value === 'object'

/** Reconcile receipts without discarding edits made while a save was in flight. */
export function reconcileTemplateReceipt(current, submitted, saved) {
  if(same(current,saved))return
  const unchangedArray = Array.isArray(current) && same(current,submitted)
  for(const key of new Set([...Object.keys(current),...Object.keys(submitted),...Object.keys(saved)])) {
    const unchanged=own(current,key)===own(submitted,key) && same(current[key],submitted[key])
    if(unchanged) {
      if(!own(saved,key)) delete current[key]
      else if(record(current[key]) && record(submitted[key]) && record(saved[key]) && Array.isArray(current[key])===Array.isArray(saved[key])) reconcileTemplateReceipt(current[key],submitted[key],saved[key])
      else Object.defineProperty(current,key,{value:clone(saved[key]),enumerable:true,writable:true,configurable:true})
    } else if(record(current[key]) && record(submitted[key]) && record(saved[key]) && Array.isArray(current[key])===Array.isArray(saved[key])) {
      reconcileTemplateReceipt(current[key],submitted[key],saved[key])
    }
  }
  if(unchangedArray) current.length=saved.length
}

export async function createNativeTemplateConnection({ sessionId, rpc, services = {}, settingsHtml }) {
  let initial=await rpc('getFullPromptTemplateState',{sessionId})
  let baseline=clone(initial.state), settingsBaseline=clone(initial.environment.extension_settings.EjsTemplate)
  let globalBaseline=clone(initial.environment.extension_settings.variables?.global)
  const snapshot={...initial.state,...initial.environment}
  let saves=Promise.resolve(), latest=saves, failures=[]
  function enqueue(operation) { const next=saves.then(operation); latest=next; saves=next.catch(error=>{ failures.push(error); if(services.onPersistenceError) services.onPersistenceError(error); else console.error('Template persistence failed',error) }); return next }
  async function saveGlobals(settings) {
    const submitted=clone(settings.variables?.global || {})
    if(same(submitted,globalBaseline)) return
    const result=await rpc('saveFullPromptTemplateGlobals',{sessionId,variables:submitted,expectedVariables:globalBaseline})
    if(result.updated!==true || !result.variables) throw new Error('Template global save was not acknowledged')
    reconcileTemplateReceipt(settings.variables.global,submitted,result.variables)
    globalBaseline=clone(result.variables)
  }
  const callbacks={...services,
    renderExtensionTemplateAsync:async(name,template)=>{
      if(name!=='third-party/ST-Prompt-Template' || template!=='settings') throw new Error('Unknown template UI resource')
      return settingsHtml
    },
    loadWorldInfo:async name=>{
      if(own(initial.environment.worldbooks,name))return clone(initial.environment.worldbooks[name]);
      if(!initial.environment.world_names?.includes(name))return null;
      const result=await rpc('loadFullPromptTemplateWorldInfo',{sessionId,name});
      if(!result?.worldInfo)throw new Error('世界书没有返回有效内容：'+name);
      initial.environment.worldbooks[name]=clone(result.worldInfo);return clone(result.worldInfo);
    },
    saveChatConditional: data=>enqueue(async()=>{
      await saveGlobals(data.extension_settings)
      const submitted={...clone(baseline),chat:data.chat.map(message=>{
        const row=clone(message)
        // Upstream flags use sparse arrays indexed by swipe; JSON saves encode holes as null.
        for(const key of ['variables_initialized','is_ejs_processed']) if(Array.isArray(row[key])) row[key]=Array.from(row[key],value=>value===undefined?null:value)
        return row
      }),chat_metadata:clone(data.chat_metadata)}
      if(same(submitted.chat,baseline.chat)&&same(submitted.chat_metadata,baseline.chat_metadata))return {updated:true,state:clone(baseline)}
      const result=await rpc('saveFullPromptTemplateState',{sessionId,state:submitted})
      if(result.updated!==true || !result.state) throw new Error('Template state save was not acknowledged')
      reconcileTemplateReceipt(data.chat,submitted.chat,result.state.chat)
      reconcileTemplateReceipt(data.chat_metadata,submitted.chat_metadata,result.state.chat_metadata)
      baseline=clone(result.state)
      return result
    }),
    saveSettingsDebounced:settings=>enqueue(async()=>{
      await saveGlobals(settings)
      const submitted=clone(settings.EjsTemplate)
      const result=await rpc('saveFullPromptTemplateSettings',{sessionId,settings:submitted,expectedSettings:settingsBaseline})
      if(result.updated!==true) throw new Error('Template settings save was not acknowledged')
      reconcileTemplateReceipt(settings.EjsTemplate,submitted,result.settings)
      settingsBaseline=clone(result.settings)
      return result
    })
  }
  async function flush() { await saves; const errors=failures;failures=[];if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'模板保存中有 '+errors.length+' 次失败');return latest }
  return {snapshot,callbacks,flush, async refresh() {
    await flush()
    initial = await rpc('getFullPromptTemplateState',{sessionId})
    const next = {...initial.state,...initial.environment}
    reconcileTemplateReceipt(snapshot,clone(snapshot),next)
    baseline=clone(initial.state); settingsBaseline=clone(initial.environment.extension_settings.EjsTemplate); globalBaseline=clone(initial.environment.extension_settings.variables?.global)
    return snapshot
  }}
}
