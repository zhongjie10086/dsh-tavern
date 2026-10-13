import {isDeepStrictEqual} from 'node:util'
import {assertPluginJson} from './tavern-chat-plugin-data.js'
const file='helper-preset-variables.json'
export function createHelperPresetVariables({store,readPreset=async()=>null}) {
  const key=chat=>chat.runtimePresetPath||chat.runtimePresetSnapshot?.presetPath||'builtin'
  async function read(chat){const name=key(chat),saved=await store.readJson(file)||{};if(Object.hasOwn(saved,name))return structuredClone(saved[name]);return structuredClone((await readPreset(name))?.extensions?.tavern_helper?.variables||{})}
  async function save(chat,variables,expected){assertPluginJson(variables,'预设变量');if(!variables||typeof variables!=='object'||Array.isArray(variables))throw new Error('预设变量必须是对象');const seed=await read(chat);await store.updateJson(file,current=>{const next={...current},name=key(chat),latest=next[name]||seed,merged=structuredClone(latest);if(expected!==undefined){assertPluginJson(expected,'变量读取版本');for(const field of new Set([...Object.keys(expected),...Object.keys(variables)])){const own=(o,k)=>Object.hasOwn(o,k),same=(a,b)=>own(a,field)===own(b,field)&&isDeepStrictEqual(a[field],b[field]);if(same(expected,variables))continue;if(!same(latest,expected)&&!same(latest,variables))throw new Error('预设变量已被其他窗口修改：'+field);if(own(variables,field))Object.defineProperty(merged,field,{value:structuredClone(variables[field]),enumerable:true,writable:true,configurable:true});else delete merged[field];}}Object.defineProperty(next,name,{value:expected===undefined?structuredClone(variables):merged,enumerable:true,configurable:true,writable:true});return next});return read(chat)}
  return {read,save}
}
