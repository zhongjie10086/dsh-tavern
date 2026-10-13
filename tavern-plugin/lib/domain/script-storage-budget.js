// Persistent script-owned data is user data: reject growth instead of silently evicting it.
export const scriptStorageLimits = Object.freeze({
  files: { ownerCount: 1024, ownerBytes: 512 * 1024 ** 2, totalCount: 4096, totalBytes: 2 * 1024 ** 3 },
  images: { ownerCount: 1024, ownerBytes: 512 * 1024 ** 2, totalCount: 4096, totalBytes: 2 * 1024 ** 3 },
  secrets: { ownerCount: 32, ownerBytes: 1024 ** 2, totalCount: 256, totalBytes: 8 * 1024 ** 2 },
  transfers: { ownerCount: 128, ownerBytes: 512 * 1024, totalCount: 512, totalBytes: 2 * 1024 ** 2 }
})
export const storedJsonBytes = value => Buffer.byteLength(JSON.stringify(value, null, 2) + '\n')
export function checkScriptStorageBudget(before, after, owner, limits, label, measure = storedJsonBytes) {
  const usage = records => Object.values(records || {}).reduce((sum, record) => {
    const bytes = measure(record); sum.totalCount++; sum.totalBytes += bytes
    if (record.owner === owner) { sum.ownerCount++; sum.ownerBytes += bytes }
    return sum
  }, { ownerCount: 0, ownerBytes: 0, totalCount: 0, totalBytes: 0 })
  const old = usage(before), next = usage(after)
  for (const key of Object.keys(next)) if (next[key] > limits[key] && next[key] > old[key]) {
    throw new Error(label + '存储达到' + (key.startsWith('owner') ? '当前脚本' : '全局') + (key.endsWith('Count') ? '数量' : '容量') + '上限，请删除不需要的内容后重试；已有内容已保留')
  }
}

/** Reserve before publishing; the second durable lock serializes publication and deletion.
 * A crash may leave a conservative reservation, never an unaccounted published object.
 */
export function createScriptRecordBudget({ store, directory, limits, label }) {
  const indexPath = directory + '/.quota.json'
  const validateKey = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('脚本资源编号无效') }
  async function inventory(current) {
    if (current) {
      if (current.version !== 1 || !current.records || Object.values(current.records).some(r => !r || typeof r.owner !== 'string' || !Number.isSafeInteger(r.bytes) || r.bytes < 0)) throw new Error(label + '容量记录损坏，已停止新增')
      return current
    }
    const records = {}
    for (const name of await store.listJsonFiles(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const value = await store.readJson(directory + '/' + name)
      if (value) records[name.slice(0, -5)] = { owner: typeof value.owner === 'string' ? value.owner : '', bytes: storedJsonBytes(value) }
    }
    return { version: 1, records }
  }
  return {
    async run(key, owner, bytes, operation, guard, { adoptUnowned = false } = {}) {
      validateKey(key)
      if (typeof owner !== 'string' || !owner || !Number.isSafeInteger(bytes) || bytes < 0) throw new Error('脚本资源容量无效')
      await store.updateJson(indexPath, async current => {
        await guard(); const index = await inventory(current), old = index.records[key]
        if (old && old.owner !== owner && !(adoptUnowned && old.owner === '')) throw new Error('资源不属于当前脚本')
        const next = { ...index.records, [key]: { owner, bytes: Math.max(bytes, old?.bytes || 0) } }
        checkScriptStorageBudget(index.records, next, owner, limits, label, r => r.bytes)
        return { version: 1, records: next }
      })
      let result
      await store.updateJson(indexPath, async current => {
        await guard(); const saved = (await inventory(current)).records[key]
        if (!saved || saved.owner !== owner || saved.bytes < bytes) throw new Error('资源容量预约已取消，请重试')
        result = await operation(); return undefined
      })
      return result
    },
    async remove(key, owner, operation, guard) {
      validateKey(key)
      await store.updateJson(indexPath, async current => {
        await guard(); const index = await inventory(current), record = index.records[key]
        if (record && record.owner !== owner) throw new Error('资源不属于当前脚本')
        await operation()
        const records = { ...index.records }; delete records[key]
        return { version: 1, records }
      })
    }
  }
}
