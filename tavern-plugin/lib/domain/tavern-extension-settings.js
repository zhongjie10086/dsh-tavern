import { isDeepStrictEqual } from 'node:util'
import {createHash} from 'node:crypto'
import {immutableJsonSnapshot} from './json-draft.js'
import {isFrozenJson} from './readonly-json.js'

const settingsPath = 'tavern-extension-settings.json'
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
export const extensionSettingHash=(present,value)=>createHash('sha256').update(canonical([present,present?value:null])).digest('hex')
export function validateExtensionSettingsPatch(patches){
 if(!Array.isArray(patches)||!patches.length||patches.length>1024||Buffer.byteLength(JSON.stringify(patches))>8*1024*1024)throw new Error('插件设置差量超过容量或格式无效')
 const seen=new Set()
 for(const item of patches){
  if(!item||!Array.isArray(item.path)||![1,2].includes(item.path.length)||item.path.some(k=>typeof k!=='string'||k.length>4096)||item.path.length===2&&item.path[0]!=='__userscripts'||item.path.length===1&&item.path[0]==='__userscripts'||typeof item.present!=='boolean'||item.present&&!own(item,'value')||!/^[a-f0-9]{64}$/.test(item.expectedHash))throw new Error('插件设置差量格式无效')
  const name=JSON.stringify(item.path);if(seen.has(name))throw new Error('插件设置差量包含重复命名空间');seen.add(name)
 }
 return patches
}

function settingsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插件设置必须是 JSON 对象')
  return JSON.parse(JSON.stringify(value))
}

function mergeUserscriptStorage(current,base,next,path='__userscripts',depth=2) {
 if(base===undefined)base={}
 if(!depth||![current,base,next].every(v=>v&&typeof v==='object'&&!Array.isArray(v)))throw Error('插件设置已被其他窗口修改，请重新加载后重试: '+path)
 const result=settingsObject(current)
 for(const key of new Set([...Object.keys(base),...Object.keys(next)])){
  if(own(base,key)===own(next,key)&&isDeepStrictEqual(base[key],next[key]))continue
  const fresh=own(current,key)===own(base,key)&&isDeepStrictEqual(current[key],base[key]),saved=own(current,key)===own(next,key)&&isDeepStrictEqual(current[key],next[key])
  const value=fresh||saved?next[key]:mergeUserscriptStorage(current[key],base[key],next[key],path+'.'+key,depth-1)
  if(own(next,key))Object.defineProperty(result,key,{value,enumerable:true,writable:true,configurable:true});else delete result[key]
 }
 return result
}

/** Profile-owned plugin namespaces, separate from DSH settings and chat history. */
export function createTavernExtensionSettings(profileData, { templateRuntime } = {}) {
  const savedChanges=new WeakSet()
  const projections=new WeakMap(),empty=immutableJsonSnapshot({})
  async function readReadonly() {
    const input=await (profileData.readReadonly||profileData.readJson)(settingsPath)??empty
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('插件设置必须是 JSON 对象')
    let ready=false
    if(templateRuntime)try{ready=Boolean(await templateRuntime())}catch{}
    const cached=isFrozenJson(input)?projections.get(input)?.get(ready):null
    if(cached)return cached
    const settings=immutableJsonSnapshot(templateRuntime?{...input,EjsTemplate:{...input.EjsTemplate,enabled:input.EjsTemplate?.enabled!==false,runtimeReady:ready}}:input)
    if(isFrozenJson(input)){const variants=projections.get(input)||new Map();variants.set(ready,settings);projections.set(input,variants)}
    return settings
  }
  async function project(value) {
    const settings = settingsObject(value)
    if (templateRuntime) {
      let enabled = false
      try { enabled = Boolean(await templateRuntime()) } catch { /* Unavailable runtimes must not report ready. */ }
      settings.EjsTemplate = { ...settings.EjsTemplate, enabled:settings.EjsTemplate?.enabled!==false, runtimeReady:enabled }
    }
    return settings
  }
  function writable(value) {
    const settings = settingsObject(value)
    // Runtime readiness is host-owned, not a persisted extension preference.
    if (templateRuntime && settings.EjsTemplate) {
      delete settings.EjsTemplate.enabled
      delete settings.EjsTemplate.runtimeReady
      if (!Object.keys(settings.EjsTemplate).length) delete settings.EjsTemplate
    }
    return settings
  }
  async function read() { return project(await (profileData.readReadonly||profileData.readJson)(settingsPath) ?? {}) }

  async function savePatch(input,{assertCurrent=async()=>{}}={}){
    const patches=structuredClone(validateExtensionSettingsPatch(input)),receipts=[];let updated=false
    await profileData.updateJson(settingsPath,async current=>{
      await assertCurrent()
      const merged=settingsObject(current??{}),comparable=writable(current??{})
      for(const item of patches){
        const [namespace,owner]=item.path,key=owner??namespace,target=owner===undefined?merged:(merged.__userscripts={...merged.__userscripts}),base=owner===undefined?comparable:(comparable.__userscripts||{})
        let value=item.value
        if(templateRuntime&&namespace==='EjsTemplate'&&value&&typeof value==='object'){value={...value};delete value.enabled;delete value.runtimeReady}
        const fresh=extensionSettingHash(own(base,key),base[key])===item.expectedHash,already=own(base,key)===item.present&&(!item.present||isDeepStrictEqual(base[key],value))
        if(!fresh&&!already)throw new Error('插件设置已被其他窗口修改，请重新加载后重试: '+item.path.join('.'))
        if(templateRuntime&&namespace==='EjsTemplate'&&own(target[key]||{},'enabled'))value={...(value||{}),enabled:target[key].enabled}
        const keep=item.present||templateRuntime&&namespace==='EjsTemplate'&&own(target[key]||{},'enabled')
        if(keep)Object.defineProperty(target,key,{value,enumerable:true,writable:true,configurable:true});else delete target[key]
        receipts.push({path:item.path,present:keep,...(keep?{value:structuredClone(target[key])}:{})})
      }
      if(isDeepStrictEqual(merged,current??{}))return undefined
      updated=true;return merged
    })
    for(const item of receipts)if(templateRuntime&&item.path[0]==='EjsTemplate'&&item.present)item.value=(await project({EjsTemplate:item.value})).EjsTemplate
    return {updated,settingsPatches:receipts}
  }

  async function save(settings, expectedSettings) {
    const next = writable(settings)
    const base = writable(expectedSettings)
    const changed = [...new Set([...Object.keys(base), ...Object.keys(next)])].filter(key =>
      own(base, key) !== own(next, key) || !isDeepStrictEqual(base[key], next[key]))
    if (!changed.length) return read()
    let didChange=false
    const saved = await profileData.updateJson(settingsPath, current => {
      const merged = settingsObject(current ?? {}),comparable=writable(current??{})
      for (const key of changed) {
        const unchanged = own(comparable, key) === own(base, key) && isDeepStrictEqual(comparable[key], base[key])
        const alreadySaved = own(comparable, key) === own(next, key) && isDeepStrictEqual(comparable[key], next[key])
        if(!unchanged&&!alreadySaved&&key==='__userscripts'){merged[key]=mergeUserscriptStorage(merged[key],base[key],next[key]);continue}
        if (!unchanged && !alreadySaved) throw new Error('插件设置已被其他窗口修改，请重新加载后重试: ' + key)
        if (templateRuntime && key==='EjsTemplate' && own(merged[key]||{},'enabled')) {
          merged[key]={...(next[key]||{}),enabled:merged[key].enabled}
        } else if (own(next, key)) Object.defineProperty(merged, key, { value: next[key], enumerable: true, configurable: true, writable: true })
        else delete merged[key]
      }
      if(isDeepStrictEqual(merged,current ?? {}))return undefined
      didChange=true;return merged
    })
    const result=await project(saved);if(didChange)savedChanges.add(result);return result
  }

  return Object.freeze({ read, readReadonly, save, savePatch, changed: value=>savedChanges.has(value) })
}
