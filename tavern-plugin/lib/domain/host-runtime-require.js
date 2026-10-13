import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
function hostRequireFrom(anchor) {
  return createRequire(createRequire(anchor).resolve('@deepseek-ai/dsh-tools'))
}

// The plugin file lives in this repo. The running host packages live next to
// the dsh launcher. Pick the copy that actually constructed the live store.
export async function defaultHostRequire(persistence) {
  const anchors = [fileURLToPath(new URL('../../package.json', import.meta.url))]
  if (process.argv[1]) anchors.push(process.argv[1])
  const found = []
  const errors = []
  for (const anchor of anchors) {
    try { found.push(hostRequireFrom(anchor)) }
    catch (error) { errors.push(error) }
  }
  if (!found.length) throw errors.at(-1) || new Error('无法解析宿主包')
  if (!persistence) return found[0]
  for (const candidate of found) {
    const loaded = await import(pathToFileURL(candidate.resolve('@deepseek-ai/dsh-session-persistence')).href)
    if (Object.values(loaded).some(exported => typeof exported === 'function' && persistence instanceof exported)) return candidate
  }
  throw new Error('解析到的宿主包与正在运行的会话存储不是同一份')
}
