import { readFile,readdir } from 'node:fs/promises'
import path from 'node:path'
import {retentionFile} from '../tavern-plugin/lib/domain/retention-policy.js'
import { createHash } from 'node:crypto'
import { parseDocument } from 'yaml'
import { SETTINGS_FILE, TAVERN_SIDEBAR_DEFAULTS, SIDEBAR_DEFAULTS_VERSION } from './launcher-environment.mjs'
import { createDurableFilePromotion } from '../tavern-plugin/lib/durable-file-promotion.js'

const settingsFiles = createDurableFilePromotion()

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function applySidebarDefaults(settings = {}) {
  const document = record(settings)
  const current = record(document['dsh-better-sidebar'])
  const tavernSettings = record(document['dsh-tavern'])
  const currentDefaultsVersion = Number(tavernSettings.sidebarDefaultsVersion)
  const migrateResourcesTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 3
  const migrateCardLibraryTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 4
  const migrateNativeFiles = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 5
  const migratePresetsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 7
  const removeBoundaryPromptsTab = !Number.isFinite(currentDefaultsVersion) || currentDefaultsVersion < 8
  const tabsEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.tabsEnabled,
    ...record(current.tabsEnabled),
  }
  if (migrateResourcesTab) {
    tabsEnabled['dsh-tavern:resources'] = true
  }
  if (migrateCardLibraryTab) {
    tabsEnabled['dsh-tavern:cards'] = true
  }
  if (migratePresetsTab) {
    tabsEnabled['dsh-tavern:presets'] = true
  }
  if (removeBoundaryPromptsTab) delete tabsEnabled['dsh-tavern:boundary-prompts']
  const viewersEnabled = {
    ...TAVERN_SIDEBAR_DEFAULTS.viewersEnabled,
    ...record(current.viewersEnabled),
  }
  if (migrateNativeFiles) {
    tabsEnabled.editor = true
    viewersEnabled.markdown = true
    viewersEnabled.code = true
  }
  return {
    ...document,
    'dsh-tavern': {
      ...tavernSettings,
      sidebarDefaultsVersion: SIDEBAR_DEFAULTS_VERSION,
    },
    'dsh-better-sidebar': {
      ...TAVERN_SIDEBAR_DEFAULTS,
      ...current,
      tabsEnabled,
      viewersEnabled,
    },
  }
}

export async function ensureSidebarDefaults(settingsPath = SETTINGS_FILE, { files = settingsFiles } = {}) {
  let written,verifiedBackup
  await files.update(settingsPath, async original => {
    const source = original?.toString('utf8') || ''
    let yaml, current
    try {
      yaml = parseDocument(source)
      if (yaml.errors.length) throw yaml.errors[0]
      current = record(yaml.toJS())
    } catch (error) {
      console.warn(`无法读取 DSH 设置，已保留原文件并跳过侧栏默认值：${error.message}`)
      return undefined
    }
    const next = applySidebarDefaults(current)
    if (JSON.stringify(next) === JSON.stringify(current)) return undefined
    if (original !== undefined) {
      const backup = settingsPath + '.backup.' + createHash('sha256').update(original).digest('hex')
      if (await files.read(backup) === undefined) await files.write(backup, original)
      if (!(await readFile(backup)).equals(original)) throw new Error('设置备份验证失败，拒绝覆盖：' + settingsPath)
      verifiedBackup=backup
    }
    yaml.set('dsh-tavern', next['dsh-tavern'])
    yaml.set('dsh-better-sidebar', next['dsh-better-sidebar'])
    written = Buffer.from(yaml.toString())
    return written
  }, { waitMs: 5000 })
  if (written === undefined) return false
  let published
  try { published = await readFile(settingsPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!published?.equals(written)) {
    console.warn('DSH 侧栏设置发布暂缓，原文件未被覆盖；待恢复文件已保留：' + settingsPath)
    return false
  }
  if(verifiedBackup)await files.update(settingsPath,async current=>{
    if(!current?.equals(written))return undefined
    const root=path.dirname(settingsPath),prefix=path.basename(settingsPath)+'.backup.'
    for(const name of await readdir(root)){
      if(!name.startsWith(prefix)||! /^[a-f0-9]{64}$/.test(name.slice(prefix.length))||path.join(root,name)===verifiedBackup)continue
      const file=await retentionFile(root,name,'completed-settings-backup');if(!file)continue
      const value=await files.read(path.join(root,name));if(!value||createHash('sha256').update(value).digest('hex')!==name.slice(prefix.length))continue
      if(parseDocument(value.toString('utf8')).errors.length)continue
      if((await retentionFile(root,name,'completed-settings-backup'))?.stamp===file.stamp)await files.remove(path.join(root,name))
    }
    return undefined
  },{waitMs:5000})
  return true
}
