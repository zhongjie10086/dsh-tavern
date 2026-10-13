const fields=['temperature','top_p','top_k','frequency_penalty','presence_penalty'];
const neutral={top_p:1,top_k:0,frequency_penalty:0,presence_penalty:0};

/** Read only sampling preferences: importing a preset never changes its API route. */
export function presetSampling(snapshot){
 const document=snapshot?.compatibilityPresetDocument||{},result={};
 for(const field of [...fields,'max_tokens']){
  const value=field==='max_tokens'?document.openai_max_tokens??document.max_tokens:document[field];
  if(value===undefined||value===null||value==='')continue;
  if(typeof value!=='number'||!Number.isFinite(value)||field==='max_tokens'&&(!Number.isSafeInteger(value)||value<=0))throw Error('预设模型参数无效：'+field);
  result[field]=value;
 }
 return result;
}
export function nativePresetSampling(sampling,provider){
 return {...(typeof sampling.temperature==='number'&&provider!=='openai-codex'?{temperature:sampling.temperature}:{}),...(typeof sampling.max_tokens==='number'?{maxTokens:sampling.max_tokens}:{})};
}
export function unsupportedPresetSampling(sampling){
 return Object.keys(neutral).filter(key=>sampling[key]!==undefined&&sampling[key]!==neutral[key]);
}
export function mainGenerationSampling(snapshot,custom={}){
 if(custom.apiurl)return custom;
 return {...presetSampling(snapshot),...custom};
}
export async function configuredPresetWire(selection,sampling,{llm,settings,credentials}){
 const descriptor=llm.listConfigurableProviders().find(p=>p.provider===selection.provider);
 let profile=descriptor&&settings?.get(descriptor.settingsNs);
 for(const key of descriptor?.settingsPath||[])profile=profile?.[key];
 if(!profile||profile.api!=='openai-completions'||!profile.baseURL)return null;
 const key=profile.apiKeyEnv?(await credentials?.resolve(profile.apiKeyEnv))?.value:undefined;
 if(profile.apiKeyEnv&&!key)throw Error('当前模型连接的密钥不可用');
 return {key:key||'',config:{apiUrl:profile.baseURL,stream:true,postProcessing:'',includeHeaders:{...profile.headers},excludeBody:[],includeBody:Object.fromEntries(Object.entries(sampling).filter(([key])=>key!=='top_k'||sampling.top_k!==0))}};
}

/** Use an explicitly configured exact-model limit, never a context window or route default. */
export function configuredOutputLimit(selection,{llm,settings},apiUrl){
 const descriptor=llm.listConfigurableProviders().find(p=>p.provider===selection.provider)
 let profile=descriptor&&settings?.get(descriptor.settingsNs)
 for(const key of descriptor?.settingsPath||[])profile=profile?.[key]
 if(!profile)return null
 if(apiUrl&&String(profile.baseURL||'').replace(/\/+$/,'')!==String(apiUrl).replace(/\/+$/,''))return null
 const model=Array.isArray(profile.models)?profile.models.find(row=>row.id===selection.model):null
 return Number.isSafeInteger(model?.maxTokens)&&model.maxTokens>0?{maxTokens:model.maxTokens,source:'configured-model'}:null
}

/** Cap a background request by its resolved model; preserve smaller task budgets. */
export function configuredBackgroundOutput(request,deps){
 const limit=configuredOutputLimit(request,deps)
 if(!limit)return request
 const requested=request.maxTokens
 const maxTokens=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,limit.maxTokens):limit.maxTokens
 return maxTokens===requested?request:{...request,maxTokens}
}
