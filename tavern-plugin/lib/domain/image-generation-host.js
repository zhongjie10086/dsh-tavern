import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse } from 'yaml'

/** Read-only migration adapter. Never rewrite DSH's shared settings document. */
export function legacyImageConfigurationReader(settingsPath = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'settings.yaml')) {
  let cached
  return async () => {
    let info;try{info=await stat(settingsPath,{bigint:true})}catch(error){if(error.code==='ENOENT'){cached=undefined;return {}}throw error}
    const fingerprint=[info.size,info.mtimeNs,info.ctimeNs,info.ino].join(':')
    if(cached?.fingerprint===fingerprint && Date.now()-Number(info.mtimeNs/1000000n)>32)return structuredClone(cached.value)
    let content
    try { content = await readFile(settingsPath, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
    try {
      const legacy = parse(content)?.['image-generation']
      if (legacy != null && (typeof legacy !== 'object' || Array.isArray(legacy))) throw new Error('Invalid legacy configuration')
      const value=legacy == null ? {} : { provider: 'google', ...legacy };cached={fingerprint,value};return structuredClone(value)
    }
    catch { throw new Error('旧生图设置无法解析，未覆盖原配置') }
  }
}
