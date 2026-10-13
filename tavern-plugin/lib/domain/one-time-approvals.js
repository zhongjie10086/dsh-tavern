import {createHash, randomBytes} from 'node:crypto'

export const APPROVALS_PATH = 'one-time-approvals.json'
const ttl = 10 * 60 * 1000
const hash = value => createHash('sha256').update(value).digest('hex')
function binding(value) {
  const result = Object.fromEntries(['sessionId','action','target','revision'].map(key => [key,String(value?.[key] ?? '')]))
  if (Object.values(result).some(value => !value || value.length > 1024) || !['profile-confirm','card-restore'].includes(result.action)) throw new Error('确认凭据的操作范围无效')
  return result
}
function document(value) {
  if (value && value.version !== 1) throw new Error('确认记录版本不受支持')
  return value || {version:1, approvals:[]}
}

/** Only the authenticated host UI may issue. Persist a digest, never the bearer token. */
export function createOneTimeApprovals({store, now = Date.now}) {
  async function issue(input) {
    const scope = binding(input), token = randomBytes(32).toString('base64url'), timestamp = now()
    await store.updateJson(APPROVALS_PATH, raw => {
      const value = document(raw)
      // Keep an unfinished operation even if it expires. A new approval never replays it.
      value.approvals = value.approvals.filter(item => item.status === 'consuming' ||
        item.expiresAt > timestamp && JSON.stringify(item.binding) !== JSON.stringify(scope))
      if (value.approvals.length >= 256) throw new Error('待处理确认过多，请等待当前操作完成')
      value.approvals.push({digest:hash(token),binding:scope,issuedAt:timestamp,expiresAt:timestamp+ttl,status:'pending'})
      return value
    })
    return {approvalToken:token,expiresAt:timestamp+ttl}
  }
  async function consume(token, input, operation) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('需要用户明确确认的一次性凭据')
    const scope = binding(input), digest = hash(token)
    await store.updateJson(APPROVALS_PATH, raw => {
      const value = document(raw), item = value.approvals.find(item => item.digest === digest)
      if (!item || item.status !== 'pending' || item.expiresAt <= now() || JSON.stringify(item.binding) !== JSON.stringify(scope)) throw new Error('确认凭据已失效、已使用或不属于本次操作，请重新确认')
      item.status = 'consuming'; item.consumedAt = now()
      return value
    })
    async function receipt(status) {
      await store.updateJson(APPROVALS_PATH, raw => {
        const value = document(raw), item = value.approvals.find(item => item.digest === digest)
        if (item) { item.status = status; item.completedAt = now(); item.result = {status} }
        return value
      })
    }
    let result
    try { result = await operation() } catch (error) { await receipt('failed'); throw error }
    await receipt('completed')
    return result
  }
  return {issue,consume}
}
