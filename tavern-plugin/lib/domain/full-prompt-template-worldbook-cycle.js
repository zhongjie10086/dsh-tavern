import { createHash } from 'node:crypto'

/** Reuse the one world-info preprocessing pass within a native generation turn. */
export function createFullTemplateWorldbookCycles({limit=32}={}) {
  const cycles=new Map()
  return {
    run(sessionId,basis,work) {
      const key=createHash('sha256').update(JSON.stringify(basis)).digest('hex')
      const current=cycles.get(sessionId)
      if(current?.key===key)return current.task
      if(cycles.size>=limit && !cycles.has(sessionId))cycles.delete(cycles.keys().next().value)
      const record={key,task:null}
      const task=Promise.resolve().then(work).catch(error=>{if(cycles.get(sessionId)===record)cycles.delete(sessionId);throw error})
      record.task=task;cycles.set(sessionId,record)
      return task
    },
    clear(sessionId){cycles.delete(sessionId)}
  }
}
