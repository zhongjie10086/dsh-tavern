import { isDeepStrictEqual } from 'node:util'
import { createDurableFilePromotion } from './durable-file-promotion.js'

const files = createDurableFilePromotion()

export async function promoteUpdateStatus(file, value, options = {}) {
  const result = await files.update(file, bytes => {
    const current = bytes === undefined ? undefined : JSON.parse(bytes.toString('utf8'))
    if (options.attemptId && current?.attemptId !== options.attemptId) {
      const error = new Error('更新任务已被替换，旧进程不能覆盖当前更新状态')
      error.code = 'DSH_TAVERN_UPDATE_SUPERSEDED'
      throw error
    }
    if (Object.hasOwn(options, 'expected') && !isDeepStrictEqual(current, options.expected === undefined ? undefined : JSON.parse(JSON.stringify(options.expected)))) return undefined
    return JSON.stringify(value, null, 2) + '\n'
  }, { waitMs: 5000 })
  return result === undefined ? undefined : JSON.parse(result.toString('utf8'))
}
