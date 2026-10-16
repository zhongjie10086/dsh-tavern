import {createStorageFormat} from './domain/storage-format.js'
import {createHash} from 'node:crypto'
import {createContentResourceStore} from './domain/content-resource-store.js'
import path from 'node:path'
import { readdir, lstat } from 'node:fs/promises'
import { createDurableFilePromotion } from './durable-file-promotion.js'
import { freezeJson, jsonBytes } from './domain/readonly-json.js'
import {encodePackedJson,decodePackedJson} from './packed-json.js'

function resolveSafePath(dataRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) throw new Error('Profile 数据路径不合法')
  const target = path.resolve(dataRoot, relativePath)
  const relative = path.relative(dataRoot, target)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Profile 数据路径不合法')
  return target
}

async function decodeJson(value,relativePath) {
  return value === undefined ? undefined : /^(preset-history|chats|chat-resources|resource-versions)\//.test(relativePath) ? decodePackedJson(value) : JSON.parse(value.toString('utf8'))
}

async function encodeJson(value,relativePath) {
  return Buffer.from(/^(preset-history|chat-resources|resource-versions)\//.test(relativePath) ? await encodePackedJson(value,{storageVersion:relativePath.startsWith('resource-versions/')?3:1}) : `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Safe relative-path JSON adapter over durable absolute-file promotion. */
export function createProfileDataStore(options) {
  const dataRoot = path.resolve(options.dataRoot)
  const files = createDurableFilePromotion(options),storageFormat=createStorageFormat(dataRoot,{maximumVersion:5})
  const cache = new Map()
  let cacheBytes = 0
  let api
  const resources=createContentResourceStore({readReadonly:relative=>readReadonly(relative),version:relative=>files.version(resolveSafePath(dataRoot,relative)),updateJson:(...args)=>api.updateJson(...args)})
  async function decode(value,relative,onArchive){
    const parsed=await decodeJson(value,relative)
    if(relative.startsWith('preset-history/')&&parsed?.$dshPresetArchive===2){
      onArchive?.(parsed)
      const result=await resources.load(parsed.root)
      if(createHash('sha256').update(JSON.stringify(result)).digest('hex')!==parsed.logicalSha256)throw Error('预设归档回读校验失败：'+relative)
      return result
    }
    return parsed
  }
  async function encode(value,relative){
    if(relative.startsWith('resource-versions/'))await storageFormat.mark()
    if(relative.startsWith('preset-history/')){
      const root=await resources.save(value,{metadata:['at']})
      if(root!==value){await storageFormat.mark();return Buffer.from(await encodePackedJson({$dshPresetArchive:2,logicalSha256:createHash('sha256').update(JSON.stringify(value)).digest('hex'),root},{storageVersion:2}),'utf8')}
    }
    return encodeJson(value,relative)
  }
  async function readReadonly(relativePath) {
    const target = resolveSafePath(dataRoot, relativePath)
    // Each fresh CAS expansion verifies the actual bytes, including external
    // deletion/corruption. Do not stat twice and scan every sibling three times.
    if(/^(chat-resources|resource-versions)\/[a-f0-9]{64}\.json$/.test(relativePath))return freezeJson(await decode(await files.readImmutable(target),relativePath))
    const version = await files.version(target)
    const cached = cache.get(target)
    if (cached?.version === version) return cached.value
    const value = freezeJson(await decode(await files.read(target),relativePath)), bytes = jsonBytes(value)
    if (cached) { cacheBytes -= cached.bytes; cache.delete(target) }
    if (bytes <= 16 * 1024 * 1024 && await files.version(target) === version) {
      while (cache.size && (cacheBytes + bytes > 32 * 1024 * 1024 || cache.size >= 64)) {
        const key = cache.keys().next().value; cacheBytes -= cache.get(key).bytes; cache.delete(key)
      }
      cache.set(target, {version,value,bytes}); cacheBytes += bytes
    }
    return value
  }
  api = Object.freeze({
    readReadonly,
    async listJsonFiles(relativePath) {
      const target = resolveSafePath(dataRoot, relativePath)
      try {
        let current = dataRoot
        for (const part of path.relative(dataRoot, target).split(path.sep)) {
          current = path.join(current, part)
          if ((await lstat(current)).isSymbolicLink()) throw new Error('Profile 数据目录不能是链接')
        }
        const entries = await readdir(target, { withFileTypes: true })
        if (entries.some(entry => entry.isSymbolicLink())) throw new Error('Profile 数据目录不能包含链接')
        return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort()
      } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    },
    async migratePresetArchives() {
      const rows=[]
      for(const name of await api.listJsonFiles('preset-history')){
        const relative='preset-history/'+name,before=await api.version(relative),value=await api.readReadonly(relative)
        await api.updateJson(relative,current=>current)
        const reopened=await decode(await files.read(resolveSafePath(dataRoot,relative)),relative)
        if(JSON.stringify(reopened)!==JSON.stringify(value))throw Error('预设归档迁移回读不一致：'+relative)
        rows.push({path:relative,changed:before!==await api.version(relative)})
      }
      return {files:rows.length,changed:rows.filter(row=>row.changed).length,rows}
    },
    async version(relativePath) { return files.version(resolveSafePath(dataRoot, relativePath)) },
    async readJson(relativePath) { return structuredClone(await readReadonly(relativePath)) },
    async writeJson(relativePath, value) { return files.write(resolveSafePath(dataRoot, relativePath), await encode(value,relativePath)) },
    async updateJson(relativePath, updater) {
      const result = await files.update(resolveSafePath(dataRoot, relativePath), async function (current) {
        let previousDigest
        const next = await updater(await decode(current,relativePath,archive=>{previousDigest=archive.logicalSha256}))
        if(next===undefined)return undefined
        if(previousDigest&&createHash('sha256').update(JSON.stringify(next)).digest('hex')===previousDigest)return undefined
        const encoded=await encode(next,relativePath)
        return current?.equals(encoded)?undefined:encoded
      }, /^(chat-resources|resource-versions)\//.test(relativePath) ? {waitMs:30000} : {})
      return decode(result,relativePath)
    },
    async remove(relativePath) { await files.remove(resolveSafePath(dataRoot, relativePath)) }
  })
  return api
}
