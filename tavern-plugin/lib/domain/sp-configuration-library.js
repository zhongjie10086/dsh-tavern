import { randomUUID } from 'node:crypto'
import { defaultPlotPreset, normalizePlotPreset, normalizeDatabaseSettings } from './sp-plot-config.js'
export function createSpConfigurationLibrary(store) {
  const file = 'st-migration.json'
  async function list() { const state = await store.readJson(file) || {}; return { presets: state.plotPresets || [], defaults: state.databaseConfig || {}, defaultPreset: normalizePlotPreset(defaultPlotPreset()) } }
  async function save({ name, preset }) {
    const normalized = normalizePlotPreset(preset, name)
    if (!normalized.name) throw new Error('请填写推进预设名称')
    await store.updateJson(file, current => {
      const state = structuredClone(current || { version: 1 })
      const old = (state.plotPresets || []).find(p => p.name === normalized.name)
      state.plotPresets = (state.plotPresets || []).filter(p => p.name !== normalized.name).concat([{ id: old?.id || randomUUID(), name: normalized.name, preset: normalized, updatedAt: Date.now() }])
      return state
    })
    return await list()
  }
  async function remove(id) {
    await store.updateJson(file, current => ({ ...current, plotPresets: (current?.plotPresets || []).filter(p => p.id !== id) }))
    return await list()
  }
  async function defaults(settings) {
    const normalized = normalizeDatabaseSettings(settings)
    await store.updateJson(file, current => ({ ...current, databaseConfig: normalized }))
    return await list()
  }
  return { list, save, remove, defaults }
}
