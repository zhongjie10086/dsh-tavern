import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export function characterDesignStamp(chat) {
  return createHash('sha256').update(JSON.stringify(chat?.characterDesignDocument ?? null)).digest('hex')
}

function characters(document) {
  return (Array.isArray(document?.characters) ? document.characters : []).flatMap((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return []
    const name = typeof record.name === 'string' ? record.name.trim() : (typeof record.name === 'number' ? String(record.name) : '')
    return [{ key: name ? 'name:' + name : 'unnamed:' + index, name: name || '未命名档案（第 ' + (index + 1) + ' 项）', record }]
  })
}

/** Compare full persisted designs, including manual edits, without exposing their contents. */
export function projectCharacterDesignRollback(chat, state) {
  const current = characters(chat?.characterDesignDocument)
  if (!Object.hasOwn(state || {}, 'characterDesignDocument') && current.length) {
    throw new Error('此旧回退点未记录人物档案历史，不能安全回退人物档案；当前存档未改变')
  }
  const previous = characters(state?.characterDesignDocument)
  const keys = [...new Set([...current, ...previous].map(character => character.key))]
  return {
    characterDesignStamp: characterDesignStamp(chat),
    characters: keys.flatMap(key => {
      const before = previous.find(character => character.key === key)
      const after = current.find(character => character.key === key)
      return isDeepStrictEqual(before?.record, after?.record) ? [] : [{ name: (before || after).name, action: before ? 'restore' : 'remove' }]
    })
  }
}
