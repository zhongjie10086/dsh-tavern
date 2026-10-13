import { RegExpParser } from '@chevrotain/regexp-to-ast'

const parser = new RegExpParser()
const cache = new Map()

// This is only a necessary-condition check. The unchanged native RegExp still
// performs every actual match and capture, including backreferences and anchors.
function requirements(node) {
  if (!node || node.quantifier?.atLeast === 0) return null
  if (node.type === 'Pattern' || node.type === 'Group' || node.type === 'Lookahead' || node.type === 'Lookbehind') return requirements(node.value)
  if (node.type === 'Disjunction') {
    const children = node.value.map(requirements)
    return children.some(child => child === null) ? null : { any: children }
  }
  if (node.type === 'Alternative') {
    const children = []
    let literal = ''
    const flush = () => { if (literal) children.push({ literal }); literal = '' }
    for (const term of node.value) {
      if (term.type === 'Character' && (!term.quantifier || (term.quantifier.atLeast === 1 && term.quantifier.atMost === 1))) {
        literal += String.fromCharCode(term.value)
      } else {
        flush()
        const child = requirements(term)
        if (child) children.push(child)
      }
    }
    flush()
    return children.length ? { all: children } : null
  }
  if (node.type === 'Character') return { literal: String.fromCharCode(node.value) }
  // Optional atoms, negative assertions, sets and backreferences cannot prove
  // that a particular literal must occur, so leave those paths possible.
  return null
}

function compile(requirement, ignoreCase) {
  if (!requirement) return () => true
  if (requirement.literal !== undefined) {
    const literal = requirement.literal
    if (!ignoreCase) return text => text.includes(literal)
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(escaped, 'i')
    return text => pattern.test(text)
  }
  const children = (requirement.all || requirement.any).map(child => compile(child, ignoreCase))
  return requirement.all ? text => children.every(child => child(text)) : text => children.some(child => child(text))
}

export function regexMayMatch(regex, text) {
  // The parser does not model all Unicode-set/case-folding grammar. Native V8
  // remains authoritative for unsupported syntax instead of guessing at it.
  if (regex.unicode || regex.unicodeSets) return true
  const key = regex.source + '\u0000' + String(regex.ignoreCase)
  let check = cache.get(key)
  if (!check) {
    try { check = compile(requirements(parser.pattern('/' + regex.source + '/')), regex.ignoreCase) }
    catch { check = () => true }
    if (cache.size >= 256) cache.delete(cache.keys().next().value)
    cache.set(key, check)
  }
  return check(text)
}
