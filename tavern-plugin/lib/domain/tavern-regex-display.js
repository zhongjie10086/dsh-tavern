import {BoundedRegExp, withRegexBudget} from './bounded-regex.js'
import { regexMayMatch } from './regex-match-prefilter.js'
import { regexSource } from './regex-safety.js'
import {knownPresetDisplay} from './known-preset-display.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function depth(value) {
  const number = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number
}

// Mirrors SillyTavern's slash-delimited regex parsing while still accepting a
// plain pattern such as "校园".
export function regexFromString(value) {
  const { source, flags } = regexSource(value)
  return new BoundedRegExp(source, flags)
}

// A rule list is reused for every floor in a view. Compile once per rule, but
// reset lastIndex for each independent projection (including sticky patterns).
const compiledRules=new WeakMap()
function compiledFor(script) {
  const trims=Array.isArray(script.trimStrings)?script.trimStrings:[],old=compiledRules.get(script)
  if(old&&old.find===script.findRegex&&old.replace===script.replaceString&&old.trims.length===trims.length&&old.trims.every((value,index)=>value===str(trims[index]))){old.regex.lastIndex=0;return old}
  const value={find:script.findRegex,replace:script.replaceString,trims:trims.map(str),regex:regexFromString(script.findRegex),replacement:replacementFor(script)}
  compiledRules.set(script,value);return value
}

function enabledFor(script, options) {
  if (!script || script.enabled === false) return false
  const placement = Number(options.placement === undefined ? 2 : options.placement)
  if (!Array.isArray(script.placement) || !script.placement.map(Number).includes(placement)) return false
  // SillyTavern treats these as ephemerality targets, not mutually exclusive
  // modes. Enabling both applies to display and outgoing prompt without
  // changing the stored chat text.
  if (options.isMarkdown === true && script.promptOnly === true && script.markdownOnly !== true) return false
  if (options.isMarkdown !== true && script.markdownOnly === true && script.promptOnly !== true) return false
  if (options.isEdit === true && script.runOnEdit !== true) return false
  const currentDepth = Number(options.depth) || 0
  const minimum = depth(script.minDepth)
  const maximum = depth(script.maxDepth)
  if (minimum !== null && currentDepth < minimum) return false
  if (maximum !== null && currentDepth > maximum) return false
  return true
}

export { enabledFor as regexAppliesTo }

// One deadline covers a batch of normal rules. If a rule actually times out,
// preserve its input and resume at the next rule under a fresh deadline.
function runRules(scripts, options, sourceText, warnings, action, rollback = () => {}) {
  const rules = Array.isArray(scripts) ? scripts : []
  const timeout = Math.max(50, Math.min(500, Math.ceil(sourceText.length / 10000) * 50))
  const deadline = Date.now() + Math.max(200, timeout * 4)
  let index = 0
  while (index < rules.length) {
    try {
      withRegexBudget(() => {
        for (; index < rules.length; index++) {
          if (Date.now() > deadline) {
            for (let pending=index;pending<rules.length;pending++)if(enabledFor(rules[pending],options))warnings.push((str(rules[pending]?.name||rules[pending]?.id)||'正则 '+(pending+1))+'：本轮正则预算耗尽，未执行；此前结果已保留')
            index = rules.length; break
          }
          if (enabledFor(rules[index], options)) action(rules[index], index)
        }
      }, timeout)
    } catch (error) {
      rollback()
      const script = rules[index]
      warnings.push((str(script?.name || script?.id) || '正则 ' + (index + 1)) + '：' + str(error?.message || error))
      index++
    }
  }
}

function replacementFor(script) {
  const trims = Array.isArray(script.trimStrings) ? script.trimStrings.map(str).filter(Boolean) : []
  const template=(knownPresetDisplay(script.replaceString)?.replacement??str(script.replaceString)).replace(/\{\{match\}\}/gi, '$0')
  return function () {
    const args = Array.from(arguments)
    const groups = args.length > 0 && args.at(-1) !== null && typeof args.at(-1) === 'object' ? args.at(-1) : null
    const filtered = function (value) {
      let result = str(value)
      for (const trim of trims) result = result.split(trim).join('')
      return result
    }
    return template
      .replace(/\$(\d+)|\$<([^>]+)>/g, function (_token, digits, groupName) {
        const captureCount = args.length - (groups ? 3 : 2)
        const match = digits !== undefined ? (Number(digits) < captureCount ? args[Number(digits)] : '') : groups && groups[groupName]
        return match ? filtered(match) : ''
      })
  }
}

function replaceAndCount(source, regex, replacement) {
  if (!regexMayMatch(regex, source)) return { text: source, count: 0 }
  let count = 0
  const text = source.replace(regex, function () {
    count++
    return replacement.apply(null, arguments)
  })
  return { text, count }
}

/** Apply enabled Tavern regex replacements to one ephemeral text projection. */
export function applyTavernRegexText(value, scripts, options = {}) {
  const sourceText = str(value)
  let text = sourceText
  const warnings = []
  const applied = []
  runRules(scripts, options, sourceText, warnings, (script, index) => {
    const label = str(script.name || script.id) || '正则 ' + (index + 1)
      const {regex,replacement} = compiledFor(script)
      const replaced = replaceAndCount(text, regex, function () {
        const adapted = typeof options.replace === 'function' ? options.replace(script, Array.from(arguments)) : undefined
        return adapted === undefined ? replacement.apply(null, arguments) : adapted
      })
      if (replaced.count === 0) return
      text = replaced.text
      applied.push({ index, id: str(script.id), name: label, matches: replaced.count })
  })
  return { sourceText, text, changed: applied.length > 0, applied, warnings }
}

/**
 * Apply character-card display regexes in their original array order.
 * `text` is the SillyTavern-compatible display projection. `bodyText` removes
 * every matched source segment so display markup never remains in story text.
 */
export function renderTavernRegexDisplay(value, scripts, options = {}) {
  const sourceText = str(value)
  let text = sourceText
  let bodyText = sourceText
  const warnings = []
  const applied = []
  const presentationParts = []

  function presentationToken(index) {
    return '\uE000DSH_TAVERN_REGEX_' + index + '\uE001'
  }

  function restorePresentationTokens(value) {
    return str(value).replace(/\uE000DSH_TAVERN_REGEX_(\d+)\uE001/g, function (token, index) {
      return presentationParts[Number(index)] || ''
    })
  }

  let ruleStart
  runRules(scripts, options, sourceText, warnings, (script, index) => {
    ruleStart = {text, bodyText, size:presentationParts.length}
    const label = str(script.name || script.id) || '正则 ' + (index + 1)
      const compiled = compiledFor(script)
      const displayRegex = compiled.regex
      const buildReplacement = compiled.replacement
      const displayed = replaceAndCount(text, displayRegex, function () {
        const replacement = buildReplacement.apply(null, arguments)
        const token = presentationToken(presentationParts.length)
        presentationParts.push(replacement)
        return token
      })
      if (displayed.count === 0) return
      text = displayed.text
      displayRegex.lastIndex=0
      bodyText = replaceAndCount(bodyText, displayRegex, function () { return '' }).text
      applied.push({ index, id: str(script.id), name: label, matches: displayed.count })
  }, () => {
    if (ruleStart) { text = ruleStart.text; bodyText = ruleStart.bodyText; presentationParts.length = ruleStart.size }
  })

  if (applied.length > 0 && sourceText.trim() !== '' && bodyText.trim() === '') {
    warnings.push('显示正则覆盖了整轮正文，已忽略本轮展示结果')
    return {
      sourceText,
      text: sourceText,
      bodyText: sourceText,
      presentationText: '',
      changed: false,
      applied: [],
      warnings
    }
  }

  const presentationTokens = text.match(/\uE000DSH_TAVERN_REGEX_\d+\uE001/g) || []

  return {
    sourceText,
    text: restorePresentationTokens(text),
    bodyText,
    presentationText: presentationTokens.map(restorePresentationTokens).filter(Boolean).join('\n'),
    changed: applied.length > 0,
    applied,
    warnings
  }
}
