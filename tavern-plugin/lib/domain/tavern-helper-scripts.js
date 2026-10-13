import { projectTavernOriginalDocument, projectTavernHostScript, projectTavernRemoteImports } from './tavern-host-script-projection.js'
import { inspectCardMvuDeclaration, selectMvuRuntime } from './mvu-runtime-selection.js'

// Only immutable executable text is shared. Each game still receives fresh
// variables/buttons, and the owner ID is part of the remote-import identity.
const sourceCache=new Map(),sourceCacheById=new Map()
const sourceCacheLimit=64*1024*1024
let sourceCacheBytes=0,sourceCacheSequence=0
function projectedSource(source,id){
 const cached=sourceCacheById.get(id)?.get(source)
 if(cached){sourceCache.delete(cached.key);sourceCache.set(cached.key,cached);return {content:cached.content,diagnostics:cached.diagnostics}}
 const diagnostics=[]
 const content=projectTavernRemoteImports(projectTavernOriginalDocument(projectTavernHostScript(source),diagnostics),id)
 const bytes=Buffer.byteLength(source)+Buffer.byteLength(content)+Buffer.byteLength(JSON.stringify(diagnostics))
 if(bytes<=sourceCacheLimit){
  while(sourceCache.size&&(sourceCacheBytes+bytes>sourceCacheLimit||sourceCache.size>=128)){
   const oldest=sourceCache.values().next().value;sourceCacheBytes-=oldest.bytes;sourceCache.delete(oldest.key);const map=sourceCacheById.get(oldest.id);map.delete(oldest.source);if(!map.size)sourceCacheById.delete(oldest.id)
  }
  const entry={key:++sourceCacheSequence,id,source,content,diagnostics,bytes},map=sourceCacheById.get(id)||new Map();map.set(source,entry);sourceCacheById.set(id,map);sourceCache.set(entry.key,entry);sourceCacheBytes+=bytes
 }
 return {content,diagnostics}
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const mvuSourceChecks=new Map();let mvuSourceBytes=0
export function isHostOwnedMvu(script) {
  if(/^mvu$/i.test(str(script && script.name).trim()))return true
  const content=str(script&&script.content)
  if(mvuSourceChecks.has(content))return mvuSourceChecks.get(content).value
  const value=/MagicalAstrogy\/MagVarUpdate/i.test(content),bytes=Buffer.byteLength(content)
  if(bytes<=16*1024*1024){
    while(mvuSourceChecks.size&&(mvuSourceChecks.size>=128||mvuSourceBytes+bytes>16*1024*1024)){const key=mvuSourceChecks.keys().next().value;mvuSourceBytes-=mvuSourceChecks.get(key).bytes;mvuSourceChecks.delete(key)}
    mvuSourceChecks.set(content,{value,bytes});mvuSourceBytes+=bytes
  }
  return value
}

/** Select card-owned scripts that can run beside the Host-owned MVU core. */
export function projectTavernHelperScripts(helperScripts, savedVariables) {
  const variables = object(savedVariables) ? savedVariables : {}
  const scripts = []
  const diagnostics = []
  for (const source of Array.isArray(helperScripts) ? helperScripts : []) {
    const id = str(source && source.id).trim()
    const name = str(source && source.name).trim() || id
    if (!source || source.enabled === false || str(source.type) !== 'script' || id === '' || str(source.content).trim() === '') continue
    const mvuDeclaration = inspectCardMvuDeclaration(source)
    if (isHostOwnedMvu(source) && !mvuDeclaration?.explicit) {
      diagnostics.push({ scriptId: id, name, status: 'host-owned', message: 'MVU 核心由 dsh-tavern 宿主运行，未重复执行人物卡远程 MVU bundle' })
      continue
    }
    if (mvuDeclaration?.explicit && selectMvuRuntime(helperScripts).status === 'incompatible') {
      diagnostics.push({ scriptId: id, name, status: 'mvu-incompatible', message: selectMvuRuntime(helperScripts).message })
      continue
    }
    const initial = Object.prototype.hasOwnProperty.call(variables, id) && object(variables[id])
      ? variables[id]
      : (object(source.data) ? source.data : {})
    // Unwrap before parsing so fenced scripts receive the same host projection.
    let content = str(source.content).replace(/^\s*```(?:javascript|js)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/i, '$1')
    try {
      if (source.extension !== true) {const projected=projectedSource(content,id);content=projected.content;diagnostics.push(...projected.diagnostics.map(row=>({...row,scriptId:id,name})))}
    } catch (error) {
      diagnostics.push({ scriptId: id, name, status: 'projection-failed', message: String(error.message || error) })
      continue
    }
    scripts.push({
      id,
      name,
      ...(mvuDeclaration?.explicit ? { system: 'card-mvu', mvuRuntimeDeclaration: mvuDeclaration } : {}),
      // Some exported cards wrap executable source in a Markdown code fence.
      // Only unwrap a single complete JavaScript block, preserving its body.
      content,
      data: clone(initial),
      buttons: clone(source.button?.enabled === false ? [] : Array.isArray(source.button?.buttons) ? source.button.buttons : Array.isArray(source.buttons) ? source.buttons : []),
      ...(source.scope ? { scope: str(source.scope) } : {}),
      info: str(source.info)
    })
  }
  return { scripts, diagnostics }
}

/** Ordinary card scripts do not require the MVU variable framework. */
export function hasTavernScriptRuntime(chat, helperScripts) {
  if (!chat || !chat.cardPath || !['story', 'script'].includes(chat.mode || 'story')) return false
  return chat.mvu?.enabled === true || projectTavernHelperScripts(helperScripts).scripts.length > 0
}
