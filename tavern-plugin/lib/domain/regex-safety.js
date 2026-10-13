export function regexSource(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const match = /^\/([\s\S]*)\/([a-z]*)$/i.exec(text)
  return match ? { source: match[1], flags: match[2] } : { source: text, flags: '' }
}

// Conservative static check for nested variable repetition. This is not a
// complete ReDoS proof: ambiguous alternatives/backreferences need a timed worker.
export function assertSafeRegex(value) {
  const { source } = regexSource(value)
  const stack = [{ repeated: false, atom: null }]
  let inClass = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index], group = stack.at(-1)
    if (char === '\\') { index++; if (!inClass) group.atom = { repeated: false }; continue }
    if (inClass) { if (char === ']') { inClass = false; group.atom = { repeated: false } }; continue }
    if (char === '[') { inClass = true; continue }
    if (char === '(') {
      const assertion=source[index+1]==='?'&&(['=','!'].includes(source[index+2])||source[index+2]==='<'&&['=','!'].includes(source[index+3]))
      stack.push({ repeated: false, atom: null, assertion })
      // Group syntax does not itself contain quantified atoms.
      if (source[index + 1] === '?') {
        if (source[index + 2] === '<' && !['=', '!'].includes(source[index + 3])) {
          const end = source.indexOf('>', index + 3); if (end >= 0) index = end
        } else index += source[index + 2] === '<' ? 3 : 2
      }
      continue
    }
    if (char === ')') {
      // Assertions consume no characters: their internal repetitions are not
      // nested consuming atoms in the enclosing group. The execution deadline
      // still bounds expensive lookaround patterns.
      if (stack.length > 1) { const closed = stack.pop(),repeated=!closed.assertion&&closed.repeated;stack.at(-1).atom = { repeated }; stack.at(-1).repeated ||= repeated }
      continue
    }
    let minimum, maximum
    if (char === '*' || char === '+') { minimum = char === '+' ? 1 : 0; maximum = Infinity }
    else if (char === '?') { minimum = 0; maximum = 1 }
    else if (char === '{') {
      const quantifier = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index))
      if (quantifier) {
        minimum = Number(quantifier[1]); maximum = quantifier[2] === undefined ? minimum : quantifier[2] === '' ? Infinity : Number(quantifier[2])
        index += quantifier[0].length - 1
      }
    }
    if (maximum !== undefined && group.atom) {
      if (maximum > 1 && group.atom.repeated) throw new Error('正则含嵌套量词，可能阻塞服务；请展开或简化重复部分后重试')
      if (maximum > minimum) { group.repeated = true; group.atom.repeated = true }
      if (source[index + 1] === '?') index++ // Lazy modifier, not another atom.
      continue
    }
    group.atom = char === '|' || char === '^' || char === '$' ? null : { repeated: false }
  }
}

export function assertSafeRegexScripts(scripts) {
  for (const [index, script] of scripts.entries()) {
    if (script.enabled === false || script.disabled === true) continue
    try { assertSafeRegex(script.findRegex) } catch (error) { throw new Error((script.name || script.scriptName || '正则 ' + (index + 1)) + '：' + error.message) }
  }
}

// Import diagnostics are advisory. Runtime deadlines, rather than a syntax
// heuristic, decide whether an otherwise valid rule can actually execute.
export function regexImportWarnings(scripts) {
  const warnings = []
  for (const [index, script] of scripts.entries()) {
    if (script.enabled === false || script.disabled === true) continue
    const name = script.name || script.scriptName || '正则 ' + (index + 1)
    try {
      const {source, flags} = regexSource(script.findRegex)
      new RegExp(source, flags)
      assertSafeRegex(script.findRegex)
    } catch (error) {
      warnings.push({index, name, message:name + '：' + error.message + '；导入已保留，运行时按实际执行预算处理'})
    }
  }
  return warnings
}
