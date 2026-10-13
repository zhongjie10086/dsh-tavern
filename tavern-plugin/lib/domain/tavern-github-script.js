import {createHash} from 'node:crypto'
import {inspectFrontendModule,collectFrontendGraph} from './frontend-module-graph.js'
import {safeOutboundFetch, readBoundedResponse} from './outbound-network-policy.js'
import {createGithubLookup} from './github-public-dns.js'

// Browser extensions only. Server plugins and unknown ST APIs remain separate.
export const ST_FRONTEND_MODULES = Object.freeze({
  'script.js': ['characters','chat_metadata','this_chid','saveSettingsDebounced','saveCharacterDebounced','substituteParams','chat','saveChatDebounced','sendTextareaMessage','eventSource','event_types'],
  'scripts/world-info.js': ['world_names','selected_world_info','METADATA_KEY','loadWorldInfo','worldInfoCache','getWorldInfoPrompt'],
  'scripts/extensions/regex/engine.js': ['regex_placement','getRegexedString'],
  'scripts/utils.js': ['uuidv4'],
  'scripts/power-user.js': ['power_user'],
  'scripts/extensions.js': ['saveMetadataDebounced','extension_settings'],
  'scripts/events.js': ['eventSource','event_types'],
  'scripts/i18n.js': ['t'],
  'scripts/preset-manager.js': ['getPresetManager']
})
const hash = text => createHash('sha256').update(text).digest('hex')
export function githubScriptSource(value, ref = '') {
  const match = /^https:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(value).trim())
  if (!match || ['.','..'].includes(match[2])) throw Error('请填写完整的 GitHub 仓库地址：https://github.com/作者/仓库')
  if (typeof ref !== 'string' || ref.length > 200 || ref && (!/^[-\w./]+$/.test(ref) || ref.includes('..'))) throw Error('仓库分支或提交号无效')
  return {repository:`https://github.com/${match[1]}/${match[2]}`, owner:match[1], repo:match[2], ref}
}
function entryPath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\u0000-\u001f\\:]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('扩展文件路径无效')
  return value.split('/').map(encodeURIComponent).join('/')
}
export function inspectFrontendImports(source,from='index.js') {return inspectFrontendModule(source,from,ST_FRONTEND_MODULES).imports}
export async function fetchGithubScript(repository, ref = '', {request,lookup} = {}) {
  lookup ||= createGithubLookup()
  const source = githubScriptSource(repository,ref), fetcher = request
  const hashes={},get = async (url,limit,binary=false) => {
    const response = await safeOutboundFetch(url,{headers:{'User-Agent':'dsh-tavern-frontend-import','Accept':'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(60000)},{fetcher,lookup})
    if (!response.ok) throw Error('读取 GitHub 仓库失败：HTTP ' + response.status)
    const body=await readBoundedResponse(response,limit);return binary?body:body.toString('utf8')
  }
  const api = `https://api.github.com/repos/${source.owner}/${source.repo}`
  const selected = ref || JSON.parse(await get(api,200000)).default_branch
  if (typeof selected !== 'string' || !selected) throw Error('仓库未提供默认分支')
  const commit = JSON.parse(await get(api+'/commits/'+encodeURIComponent(selected),2000000)).sha
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw Error('仓库未返回有效提交号')
  const base = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${commit}/`
  const manifestText = await get(base+'manifest.json',200000), manifest = JSON.parse(manifestText)
  if (!manifest || typeof manifest.display_name !== 'string' || typeof manifest.version !== 'string') throw Error('需要 SillyTavern 浏览器扩展 manifest.json')
  if (manifest.requires?.length) throw Error('此扩展依赖其他扩展，暂不支持自动安装依赖：' + manifest.requires.join(', '))
  const js = entryPath(manifest.js), css = manifest.css ? entryPath(manifest.css) : null
  const graph=await collectFrontendGraph({entry:js,css,known:ST_FRONTEND_MODULES,read:async(name,limit)=>{const body=await get(base+name.split(/[?#]/)[0],limit,true);hashes[name]=hash(body);return body}})
  const code=graph.files[js].source,style=css?graph.styles[css].source:'',imports=graph.files[js].imports||[]
  // Stable repository identity allows normal library updates to preserve settings.
  const id = 'github-' + hash(source.repository.toLowerCase()).slice(0,24)
  const provenance = {...source,ref:selected,commit,version:manifest.version,files:{'manifest.json':hash(manifestText),...hashes},warnings:graph.warnings}
  const payload = {id,name:manifest.display_name,version:manifest.version,commit,source:code,style,imports,modules:ST_FRONTEND_MODULES,graph,base}
  const content = '/* tavernOriginalUi: extension-github */\nawait globalThis.__dshInstallGithubExtension('+JSON.stringify(payload)+');'
  return {script:{type:'script',id,name:manifest.display_name,enabled:true,extension:true,content,data:{},github:provenance,info:`${source.repository}\n${manifest.version} · ${commit}`},provenance,modules:[...new Set(Object.values(graph.files).flatMap(row=>(row.imports||[]).map(i=>i.path)))],warnings:graph.warnings}
}
