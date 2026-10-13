/** Repair format/validation failures only; never retry a transport failure. */
export async function generateSpJson({ generate, request, validate = value => value, retries = 1, format = 'JSON', parse = source => JSON.parse(source.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')) }) {
  let correction = []
  for (let attempt = 0; ; attempt++) {
    request.signal?.throwIfAborted()
    const output = String(await generate({ ...request, messages: request.messages.concat(correction) }))
    request.signal?.throwIfAborted()
    try {
      if (output.length > 2_000_000) throw new Error('结果过大')
      const value = await parse(output)
      return await validate(value)
    } catch (error) {
      if (attempt >= Math.min(3, Math.max(0, retries))) throw Object.assign(new Error('结果未通过 '+format+' 验证：' + error.message), { rejectedOutput: output.slice(0, 100000) })
      correction = [
        { role: 'assistant', source: { kind: 'plugin', plugin: 'dsh-tavern' }, content: [{ type: 'text', text: output }] },
        { role: 'user', content: [{ type: 'text', text: '结果未通过验证：' + error.message + '。请按原任务完整重新输出合法 '+format+'，不附加解释，不改变事实、允许的条目和操作范围。' }] }
      ]
    }
  }
}
