import { normalizeResourcePath } from './file-resources.js'

export function createCardDeletion(options = {}) {
  const resources = options.resources
  const graph = options.graph
  if (!graph || typeof graph.remove !== 'function') {
    throw new Error('缺少人物卡资源存储')
  }

  async function remove(cardPath) {
    const normalized = resources?.canonicalPath ? await resources.canonicalPath(cardPath,'card') : normalizeResourcePath(cardPath, 'card')
    await graph.remove(normalized, 'card')
    return { deleted: true, cardPath: normalized }
  }

  return Object.freeze({ remove })
}
