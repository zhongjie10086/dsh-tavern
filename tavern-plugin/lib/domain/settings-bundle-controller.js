import { randomUUID } from 'node:crypto'
import { createSettingsBundle, inspectSettingsBundle, importSettingsBundle } from './settings-bundle.js'
import { inspectPreset } from './preset-reading.js'
import { validatePromptOverrides } from './system-prompt-sets.js'

export function createSettingsBundleController({ readSettings, updateSettings, presentSystemPrompts, presets, resources, profiles, importProfile }) {
  async function exportBundle(args = {}) {
    if (!Array.isArray(args.selected) || args.selected.some(kind => !['preset','systemPrompts','preferences'].includes(kind))) throw Error('组合导出选择无效')
    const parts = {}
    if (args.selected.includes('preset')) {
      const result = await presets.export(args.presetPath)
      parts.preset = {name:result.name,document:JSON.parse(result.text)}
    }
    if (args.selected.includes('systemPrompts')) {
      const settings = await readSettings(), current = presentSystemPrompts(settings)
      const name=settings.systemPromptSets?.sets.find(item=>item.id===settings.systemPromptSets.selected)?.name||'系统提示词'
      parts.systemPrompts = {name,document:{spec:current.spec,version:current.version,systemAppendEnabled:current.systemAppendEnabled,prompts:Object.fromEntries(current.prompts.map(item=>[item.name,item.text]))}}
    }
    if (args.selected.includes('preferences')) {
      const current = await profiles.read(args.profileId)
      parts.preferences = {name:current.name||'长期偏好',document:{spec:current.spec,version:current.version,revision:current.revision,defaultEnabled:false,draft:current.draft,confirmed:current.confirmed,updatedAt:current.updatedAt}}
    }
    return {name:'dsh-tavern-settings-bundle.json',text:JSON.stringify(createSettingsBundle(parts),null,2)+'\n'}
  }
  async function importBundle(args = {}) {
    return await importSettingsBundle(args.payload,{selected:args.selected,conflicts:args.conflicts,importers:{
      preset:async(item,choice)=>{
        const text=JSON.stringify(item.document,null,2), inspected=inspectPreset(text,item.name)
        if(!inspected.valid)throw Error(inspected.error)
        if(choice.action==='new')return await presets.import({name:item.name.replace(/\.json$/i,'')+'-'+randomUUID()+'.json',text})
        const target=await resources.canonicalPath(choice.target,'preset'),expectedText=await resources.readText(target)
        if(expectedText===undefined)throw Error('覆盖预设不存在')
        await resources.writeWorking(target,text,{expectedText})
        return {path:target}
      },
      systemPrompts:async(item,choice)=>{
        const prompts=item.document.prompts
        const promptOverrides=validatePromptOverrides(Array.isArray(prompts)?Object.fromEntries(prompts.map(value=>[value.name,value.text])):prompts)
        if(choice.action==='replace') {
          // Explicit replacement is a single atomic settings operation, including inactive schemes.
          return await updateSettings({systemPromptSet:{action:'replace',id:choice.target,promptOverrides,systemAppendEnabled:item.document.systemAppendEnabled===true}})
        }
        return await updateSettings({systemPromptSet:{action:'create',newId:randomUUID(),name:item.name.slice(0,80),promptOverrides,systemAppendEnabled:item.document.systemAppendEnabled===true}})
      },
      preferences:async(item,choice)=>{
        if(typeof importProfile!=='function')throw Error('长期偏好导入未连接')
        return await importProfile(item,choice)
      }
    }})
  }
  async function inspect(payload) {
    const bundle=inspectSettingsBundle(payload), targets={}
    if(bundle.resources.some(item=>item.kind==='systemPrompts'))targets.systemPrompts=(await readSettings()).systemPromptSets.sets.map(item=>({id:item.id,name:item.name}))
    if(bundle.resources.some(item=>item.kind==='preferences'))targets.preferences=(await profiles.read()).profiles.map(item=>({id:item.id,name:item.name}))
    if(bundle.resources.some(item=>item.kind==='preset'))targets.preset=(await presets.catalog()).presets.map(item=>({id:item.path,name:item.title||item.path}))
    return {...bundle,targets}
  }
  return {export:exportBundle,inspect,import:importBundle}
}
