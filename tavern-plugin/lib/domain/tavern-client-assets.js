import { readFile } from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)

export const TAVERN_CLIENT_ASSET_PREFIX = '/api/dsh-tavern/client-assets/'

const assets = Object.freeze({
  'izumi-launcher.png': {url:new URL('../client-assets/izumi-launcher.png',import.meta.url),mediaType:'image/png'},
  'izumi-original.css': {url:new URL('../client-assets/izumi-original.css',import.meta.url),mediaType:'text/css; charset=utf-8'},
  'sql-wasm.js': { packagePath:'sql.js/dist/sql-wasm.js', mediaType: 'application/javascript' },
  'sql-wasm.wasm': { packagePath:'sql.js/dist/sql-wasm.wasm', mediaType: 'application/wasm' },
  'tavern.css': Object.freeze({
    url: new URL('../client-assets/tavern.css', import.meta.url),
    mediaType: 'text/css; charset=utf-8'
  })
})

export async function readTavernClientAsset(pathname) {
  const value = String(pathname || '')
  if (!value.startsWith(TAVERN_CLIENT_ASSET_PREFIX)) return undefined
  const name = value.slice(TAVERN_CLIENT_ASSET_PREFIX.length)
  const asset = Object.hasOwn(assets, name) ? assets[name] : undefined
  if (asset === undefined) return undefined
  return Object.freeze({ body: await readFile(asset.packagePath?require.resolve(asset.packagePath):asset.url), mediaType: asset.mediaType })
}
