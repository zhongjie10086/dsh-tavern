import { visibleTemplateDisplay } from './template-variable-display.js'
import { createHash } from 'node:crypto'
import { projectTavernHostHtml } from './tavern-host-script-projection.js'
import { applyTavernRegexText, regexAppliesTo } from './tavern-regex-display.js'
import { nativeRegexAdapter } from './st-preset-compatibility.js'
import { marked } from 'marked'
import {withRegexBudget} from './bounded-regex.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Display refreshes resolve identity only; never replay stateful/random macros. */
export function resolveDisplayIdentityMacros(value, options = {}) {
  return str(value).replace(/\{\{\s*(user|char)\s*\}\}/gi, (token, name) => {
    if (name.toLowerCase() === 'user') return str(options.macroState?.userName) || '你'
    return str(options.charName) || token
  })
}

/** Self-contained: the template executor serves this exact source to its page (Z92). */
export function isRenderableHtmlCodeBlock(value, info = '') {
  const content = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  const language = String(info ?? '').trim().split(/\s+/, 1)[0].toLowerCase()
  // Some imported card regexes label whole UI documents as text. Keep snippets
  // and narrative protocol tags literal; only promote a complete HTML document.
  if (language === 'text') return /^\s*(?:<!doctype\s+html\s*>\s*)?<html(?:\s[^<>]*?)?>[\s\S]*<\/html>\s*$/i.test(content)
  if (language !== '') return language === 'html' || language === 'htm'
  // A decoration script consumes this narrative protocol from a code block.
  // Keep established unlabeled HTML fragment support (div/section/card panels).
  if (/<\/?msg(?:\s[^<>]*?)?>/i.test(content) && !/<(?:html|head|body)(?:\s[^<>]*?)?>/i.test(content)) return false
  return /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(content)
}

function isHtmlSource(value, info = '') {
  return isRenderableHtmlCodeBlock(str(value), str(info))
}

function fencedSegments(value) {
  const lines = str(value).match(/.*(?:\r?\n|$)/g) || []
  const segments = []
  let plain = ''
  let fence = null
  let fenced = ''
  let content = ''
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '')
    if (fence === null) {
      const opening = bare.match(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/)
      if (opening !== null) {
        fence = { character: opening[1][0], length: opening[1].length, info: opening[2] }
        fenced = line
        content = ''
      } else {
        plain += line
      }
      continue
    }
    fenced += line
    const closing = bare.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)
    if (closing !== null && closing[1][0] === fence.character && closing[1].length >= fence.length) {
      if (isHtmlSource(content, fence.info)) {
        if (plain !== '') segments.push({ kind: 'text', text: plain })
        segments.push({ kind: 'html', content, raw: fenced })
        plain = ''
      } else {
        plain += fenced
      }
      fence = null
      fenced = ''
      content = ''
      continue
    }
    content += line
  }
  if (fence !== null) plain += fenced
  if (plain !== '') segments.push({ kind: 'text', text: plain })
  return segments
}

// Markdown HTML blocks may extend past a closing tag until the next blank line.
// Recover element boundaries without parsing/re-serializing author scripts or markup.
// Bare non-HTML tags are narrative protocol delimiters. HTML elements and
// custom elements/attribute-bearing UI stay opaque, including everything inside.
const HTML_ELEMENTS = new Set(('html head body title base link meta style script noscript template slot ' +
  'address article aside footer header h1 h2 h3 h4 h5 h6 hgroup main nav search section ' +
  'blockquote dd div dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr ' +
  'area audio img map track video embed iframe object picture source canvas svg math portal ' +
  'del ins caption col colgroup table tbody td tfoot th thead tr button datalist fieldset form input label legend meter optgroup option output progress select textarea ' +
  'details dialog summary acronym applet big center dir font frame frameset marquee noframes param strike tt xmp').split(' '))
function isNarrativeTag(tag, token) {
  return tag && !HTML_ELEMENTS.has(tag) && !/[-:]/.test(tag) && /^<\/?[a-z][\w]*\s*\/?\s*>$/i.test(token)
}

function splitHtmlBoundaries(source, editing = false) {
  const segments = []
  const stack = []
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
  const tokens = /<!--[\s\S]*?(?:-->|$)|<!doctype\b[^>]*>|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>|(`+)[\s\S]*?\2/gi
  let cursor = 0
  let start = -1
  function append(kind, value) {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && (previous.kind === kind || !value.trim())) {
      previous[previous.kind === 'html' ? 'content' : 'text'] += value
    } else segments.push(kind === 'html' ? { kind, content: value } : { kind, text: value })
  }
  let token
  while ((token = tokens.exec(source))) {
    if (token[2]) continue // Inline code is prose, never executable HTML.
    const tag = (token[1] || '').toLowerCase()
    const closing = /^<\//.test(token[0])
    if (!editing && start < 0 && /^<!--/.test(token[0])) {
      append('text', source.slice(cursor, token.index))
      append('marker', token[0])
      cursor = tokens.lastIndex
      continue
    }
    if (isNarrativeTag(tag, token[0])) {
      if (start < 0) {
        append('text', source.slice(cursor, token.index))
        append('marker', token[0])
        cursor = tokens.lastIndex
      }
      continue
    }
    if (start < 0) {
      append('text', source.slice(cursor, token.index))
      start = token.index
    }
    if (closing) {
      const index = stack.lastIndexOf(tag)
      if (index >= 0) stack.length = index
    } else if (tag && !voidTags.has(tag) && !/\/\s*>$/.test(token[0])) {
      stack.push(tag)
      // Script/style strings can contain arbitrary tags; only their end tag matters.
      if (['script', 'style', 'textarea', 'title'].includes(tag)) {
        const end = new RegExp('</' + tag + '\\s*>', 'gi')
        end.lastIndex = tokens.lastIndex
        const match = end.exec(source)
        if (!match) { tokens.lastIndex = source.length; break }
        tokens.lastIndex = end.lastIndex
        stack.pop()
      }
    }
    if (!stack.length) {
      append('html', source.slice(start, tokens.lastIndex))
      cursor = tokens.lastIndex
      start = -1
    }
  }
  if (start >= 0) append('html', source.slice(start)) // Unclosed UI remains isolated.
  else append('text', source.slice(cursor))
  return segments
}

// These are narrative protocol markers, not author-provided HTML UI containers.
function unwrapNarrativeContent(value) {
  const match = str(value).match(/^\s*<(content|gametxt)>\s*\r?\n?([\s\S]*?)\r?\n?\s*<\/\1>([\s\S]*)$/i)
  return match === null ? null : { body: match[2], rest: match[3] }
}

function splitPlainSegment(value, editing = false) {
  const source = str(value)
  const narrative = editing ? null : unwrapNarrativeContent(source)
  if (narrative !== null) {
    const parts = splitPlainSegment(narrative.body)
    if (narrative.rest.trim()) parts.push(...splitPlainSegment(narrative.rest))
    return parts.filter(part => (part.text ?? part.content).trim())
  }
  if (!/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(source)) return [{ kind: 'text', text: source }]
  try {
    // Protect Markdown code blocks before scanning; retain exact source offsets.
    const normalized = source.replace(/\r\n?/g, '\n')
    const tokens = marked.lexer(normalized, { gfm: true })
    // Reuse this token tree for classification and boundary masking. Nested
    // inline HTML still needs isolation; Markdown code examples remain prose.
    let found = false
    marked.walkTokens(tokens, token => { if (token.type === 'html') found = true })
    if (!found) return [{ kind: 'text', text: source }]
    const masked = tokens.map(token => token.type === 'code'
      ? str(token.raw).replace(/[^\r\n]/g, 'x') : str(token.raw)).join('')
    if (masked.length !== normalized.length) return [{ kind: 'html', content: source }]
    let offset = 0
    return splitHtmlBoundaries(masked, editing).map(part => {
      const key = part.kind === 'html' ? 'content' : 'text'
      const start = offset
      for (let index = 0; index < part[key].length; index += 1) {
        offset += source[offset] === '\r' && source[offset + 1] === '\n' ? 2 : 1
      }
      const original = source.slice(start, offset)
      return { kind: part.kind, [key]: original }
    })
  } catch (_error) {
    return [{ kind: 'html', content: source }]
  }
}

/** Lossless editing ranges: HTML (including its fences) remains opaque. */
export function editableReplyParts(value) {
  return fencedSegments(value).flatMap(segment => segment.kind === 'html'
    ? [{ kind: 'html', text: segment.raw }]
    : splitPlainSegment(segment.text, true).map(part => ({ kind: part.kind, text: part.kind === 'html' ? part.content : part.text })))
}

/** Native prose and isolated block HTML share one ordered projection; keep element interiors intact. */
export function projectDisplayParts(value) {
  const segments = fencedSegments(value)
  return {
    parts: segments.flatMap(function (segment) {
      if (segment.kind === 'html') return { kind: 'html', content: segment.content }
      return splitPlainSegment(segment.text).filter(part => part.kind !== 'marker').map(function (part) {
        return part.kind === 'html'
          ? { kind: 'html', content: part.content }
          : { kind: 'markdown', text: part.text }
      })
    }),
    warnings: []
  }
}

/** Match renderable HTML regardless of whether it came from regex or model output. */
export function hasHtmlCodeBlock(value) {
  return fencedSegments(value).some(function (segment) { return segment.kind === 'html' })
}

/** Classify whether the display projection needs isolated rich rendering. */
export function displayModeOf(value) {
  return projectDisplayParts(value).parts.some(part => part.kind === 'html') ? 'html' : 'markdown'
}

function targetOptions(options, isMarkdown) {
  return {
    placement: options.placement,
    isMarkdown,
    isEdit: options.isEdit,
    depth: options.depth
  }
}

/**
 * Project one authoritative model reply independently for Session and display.
 * Regex execution only transforms strings; it never extracts HTML or changes
 * where matched content belongs in the message.
 */
export function parsePresetChoices(value) {
  const body = str(value).replace(/<summary\b[^>]*>[\s\S]*?<\/summary>/gi, '').replace(/<\/?details\b[^>]*>/gi, '').replace(/^\s*<(?:options|branches)\b[^>]*>/i, '').replace(/<\/(?:options|branches)>\s*$/i, '').trim()
  const nodes = [...body.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]
  if (nodes.length) return nodes.map(m=>m[1].trim()).filter(Boolean)
  const numbered = body.split(/(?:^|\n|(?=>\s*选项))\s*>?\s*(?:选项\s*(?:[一二三四五六七八九十百零〇两]+|\d+|[A-Za-z])\s*[:：]|\d+\s*[.、)]\s+)/).map(t=>t.trim()).filter(Boolean)
  if (numbered.length > 1) return numbered
  return body.split(/\r?\n/).map(t=>t.replace(/^\s*[-*>]\s*/, '').trim()).filter(Boolean)
}

export function projectReplyLayers(value, options = {}) {
  const sourceText = str(value)
  const projectionText = Object.prototype.hasOwnProperty.call(options, 'projectionText')
    ? str(options.projectionText)
    : sourceText
  const scripts = Array.isArray(options.regexScripts) ? options.regexScripts : []
  const session = applyTavernRegexText(projectionText, scripts, targetOptions(options, false))
  const nativeParts = []
  const displayOptions = { ...targetOptions(options, true), replace(script, args) {
    const adapter = nativeRegexAdapter(script)
    if (adapter !== 'multicolor-input') return undefined
    const part = { kind: 'multicolor-input', text: str(args[1] || args[0]).replace(/^\s*(?:以下|以上)是用户的本轮输入[:：]?\s*|^\s*<用户本轮输入>\s*/m, '').replace(/<\/用户本轮输入>\s*$/, '').trim() }
    const token = '\uE002DSH_NATIVE_' + nativeParts.length + '\uE003'
    nativeParts.push(part)
    return token
  } }
  // Run each preset's own renderer and captures. Its HTML lives in a message
  // document; only host access is projected to the shared compatibility API.
  const displayScripts = scripts.map(script => nativeRegexAdapter(script) === 'choices'
    ? { ...script, replaceString: projectTavernHostHtml(script.replaceString, { isolatedDocument: true, preserveJQuery: true }) } : script)
  const sameRules=displayScripts.every((script,index)=>script===scripts[index]&&nativeRegexAdapter(script)!=='multicolor-input'&&regexAppliesTo(script,displayOptions)===regexAppliesTo(script,targetOptions(options,false)))
  // Session and display often run the identical ordered rule set. Reuse that
  // completed, bounded execution; retain independent result objects because
  // identity macros and presentation repair only affect the display result.
  let display = sameRules?{...session,warnings:session.warnings.slice(),applied:session.applied.slice()}:applyTavernRegexText(projectionText, displayScripts, displayOptions)
  // Some cards encode dialogue inside now_plot. Recover an omitted wrapper
  // only when that card's own active renderer recognizes the repaired text.
  // Never persist this display repair into model context or editable source.
  if (/^\s*@bubble:/m.test(projectionText) && !/<\/?now_plot\b/i.test(projectionText)) {
    const candidates = scripts.filter(script =>
      str(script.findRegex).includes('<now_plot>') &&
      str(script.replaceString).includes('@bubble')
    )
    const wrapped = '<now_plot>\n' + projectionText + '\n</now_plot>'
    const probe = applyTavernRegexText(wrapped, candidates, displayOptions)
    if (probe.applied.length > 0) {
      display = applyTavernRegexText(wrapped, scripts, displayOptions)
      display.warnings.push('气泡显示：已为卡片渲染规则补齐缺失的 now_plot 标签（仅显示）')
    }
  }
  display.text = resolveDisplayIdentityMacros(display.text, options)
  // Native database recall no longer rewrites the user's stored text with a wrapper.
  // The imported multicolor renderer still applies to the real input at its configured depths.
  if (Number(options.placement) === 1 && display.text.trim() && !nativeParts.length &&
      scripts.some(script => nativeRegexAdapter(script) === 'multicolor-input' && regexAppliesTo(script, displayOptions)) &&
      !projectDisplayParts(display.text).parts.some(part => part.kind === 'html')) {
    nativeParts.push({ kind: 'multicolor-input', text: display.text })
    display.text = '\uE002DSH_NATIVE_0\uE003'
  }
  const displayProjection = nativeParts.length ? {
    parts: display.text.split(/(\uE002DSH_NATIVE_\d+\uE003)/g).flatMap(text => {
      const match = /^\uE002DSH_NATIVE_(\d+)\uE003$/.exec(text)
      return match && nativeParts[Number(match[1])] ? [nativeParts[Number(match[1])]] : projectDisplayParts(text).parts
    }), warnings: []
  } : projectDisplayParts(display.text)
  const displayMode = displayProjection.parts.some(part => part.kind === 'html') ? 'html' : 'markdown'

  return {
    sourceText,
    projectionText,
    sessionText: session.text,
    displayText: display.text.replace(/\uE002DSH_NATIVE_(\d+)\uE003/g, (token, index) => {
      const part = nativeParts[Number(index)]
      return part?.kind === 'choices' ? part.choices.join('\n') : part?.text ?? token
    }),
    displayMode,
    displayParts: displayProjection.parts,
    applied: {
      session: session.applied,
      display: display.applied
    },
    warnings: session.warnings.map(function (warning) { return 'Session：' + warning })
      .concat(display.warnings.map(function (warning) { return '展示：' + warning }))
      .concat(displayProjection.warnings)
  }
}

function isNativeMarkdownProjection(parts, sessionText) {
  return Array.isArray(parts) && parts.length === 1 && parts[0]?.kind === 'markdown' && str(parts[0].text) === str(sessionText)
}

/** Bound retained projection data as well as entry count; oversized replies bypass caching. */
export function createReplyHistoryProjector({ maxCacheBytes = 16 * 1024 * 1024, maxCacheEntries = 2048 } = {}) {
  const cache = new Map()
  let bytes = 0, hits = 0, misses = 0
  function digest(value) { return createHash('sha256').update(value).digest('hex') }
  function projectCached(sourceText, projectionText, options, signature) {
    const key = createHash('sha256').update(signature).update(String(sourceText.length) + ':')
      .update(sourceText).update(String(projectionText.length) + ':').update(projectionText).digest('hex')
    let item = cache.get(key)
    if (item) {
      hits++
      cache.delete(key)
      cache.set(key, item)
    } else {
      misses++
      const projected = projectReplyLayers(sourceText, Object.assign({}, options, { projectionText }))
      const value = { displayText: projected.displayText, displayMode: projected.displayMode,
        displayParts: projected.displayParts, warnings: projected.warnings }
      // This is a conservative payload estimate, not a measurement of V8 heap usage.
      const size = value.displayText.length * 2 > maxCacheBytes ? Infinity : JSON.stringify(value).length * 2 + 256
      if (size > maxCacheBytes || maxCacheEntries <= 0) return value
      while (cache.size && (bytes + size > maxCacheBytes || cache.size >= maxCacheEntries)) {
        const oldest = cache.keys().next().value
        bytes -= cache.get(oldest).size
        cache.delete(oldest)
      }
      item = { value, size }
      cache.set(key, item)
      bytes += size
    }
    // Callers may annotate returned parts; never expose mutable cached objects.
    return structuredClone(item.value)
  }
  function projectHistory(messages, options = {}) {
    const projections = []
    let inferredTurn = 1
    let latestSourceBacked = false

    const history = Array.isArray(messages) ? messages : []
    const assistantRows=history.flatMap((message,index)=>message?.role==='assistant'?[{index,source:Object.hasOwn(message,'sourceText')?str(message.sourceText):str(message.text),projectionText:Object.hasOwn(message,'projectionText')?str(message.projectionText):Object.hasOwn(message,'sourceText')?str(message.sourceText):str(message.text),depth:history.length-1-index}]:[])
    const layers=projectHistory.createProjector(options).many(assistantRows),byIndex=new Map(assistantRows.map((row,index)=>[row.index,layers[index]]))
    for (const [index, message] of history.entries()) {
      if (message === null || typeof message !== 'object') continue
      if (message.role === 'user') {
        inferredTurn += 1
        continue
      }
      if (message.role !== 'assistant') continue

      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
      if (turn === 0) continue
      const hasSource = Object.prototype.hasOwnProperty.call(message, 'sourceText')
      const sourceText = hasSource ? str(message.sourceText) : str(message.text)
      const projectionText = Object.prototype.hasOwnProperty.call(message, 'projectionText')
        ? str(message.projectionText)
        : sourceText
      const projected = byIndex.get(index)
      const sessionText = str(message.text)
    if (message.tavernTemplateDisplay?.sourceText === projectionText && typeof message.tavernTemplateDisplay.html === 'string') {
      const visible=visibleTemplateDisplay(message.tavernTemplateDisplay)
      projections.push({version:2,turn,text:visible.html,mode:'html',parts:Array.isArray(visible.parts)?structuredClone(visible.parts):[{kind:'html',content:visible.html}],warnings:projected.warnings})
      latestSourceBacked = hasSource
      continue
    }


      if (message.bodyEdit || !isNativeMarkdownProjection(projected.displayParts, sessionText) || (Array.isArray(message.swipes) && message.swipes.length > 1)) {
        projections.push({
          version: 2,
          turn,
          text: projected.displayText,
          mode: projected.displayMode,
          parts: projected.displayParts,
          warnings: projected.warnings
        })
      }
      latestSourceBacked = hasSource
    }

    return { projections, presentation: null, latestSourceBacked }
  }
  projectHistory.createProjector=(options={})=>{
    const signature=digest(JSON.stringify({regexScripts:options.regexScripts||[],charName:options.charName,macroState:options.macroState,placement:options.placement,isEdit:options.isEdit}))
    const rules=options.regexScripts||[],depthSensitive=rules.some(rule=>rule&&rule.enabled!==false&&[rule.minDepth,rule.maxDepth].some(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))))
    const applicableAt=depth=>rules.map(rule=>[false,true].map(isMarkdown=>Number(regexAppliesTo(rule,{...options,depth,isMarkdown}))).join('')).join('')
    const fixedApplicable=depthSensitive?null:applicableAt(0)
    const project=(source,depth=Number(options.depth)||0,projectionText=source)=>{
      const actual={...options,depth},applicable=fixedApplicable??applicableAt(depth)
      return projectCached(str(source),str(projectionText),actual,signature+':'+applicable)
    }
    project.many=rows=>{
      const result=[]
      for(let start=0;start<rows.length;start+=16){
        const batch=rows.slice(start,start+16),run=()=>batch.map(row=>project(row.source,row.depth,row.projectionText??row.source))
        // Share V8's interruptible boundary across a small pure projection batch.
        // A timed-out batch is retried per text so the existing individual-rule
        // recovery identifies the bad rule and preserves all unaffected floors.
        try{result.push(...withRegexBudget(run,100))}
        catch(error){if(error.code!=='DSH_TAVERN_REGEX_TIMEOUT')throw error;result.push(...run())}
      }
      return result
    }
    return project
  }
  projectHistory.cacheStats = () => ({ entries: cache.size, estimatedBytes: bytes, hits, misses })
  return projectHistory
}

export const projectReplyHistory = createReplyHistoryProjector()

/**
 * Transitional old-shape adapter. New callers should use projectReplyLayers().
 * presentationHtml stays empty because HTML now remains inside displayText.
 */
export function projectReplyPresentation(value, options = {}) {
  const layers = projectReplyLayers(value, options)
  return Object.assign({}, layers, {
    bodyText: layers.sessionText,
    presentationHtml: '',
    regexApplied: layers.applied.display.length > 0,
    appliedRegexes: layers.applied.display
  })
}
