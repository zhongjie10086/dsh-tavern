import { createHash } from 'node:crypto'

/** Resource version, independent of later game-local worldbook edits. */
export function worldbookContentDigest(record) {
  if(record?.mergedRecords)return createHash('sha256').update(JSON.stringify(record.mergedRecords.map(worldbookContentDigest))).digest('hex')
  const source = record?.source ?? null
  const document = record?.baseDocument ?? record?.document ?? record?.view?.raw ?? null
  return createHash('sha256').update(JSON.stringify({ source, document })).digest('hex')
}
