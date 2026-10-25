import {isDeepStrictEqual} from 'node:util'
import {parseDDLTableName,rebindCreateTableName_ACU} from '../vendor/sp-database/ddl-utils.js'

const record=value=>value&&typeof value==='object'&&!Array.isArray(value)
function json(value){try{return typeof value==='string'?JSON.parse(value):value}catch{return null}}
// Compare complete SQL tokens, retaining quoted values exactly. Whitespace inside
// a DEFAULT/CHECK literal is meaningful and must not establish a false match.
function ddlContract(ddl){
 const source=rebindCreateTableName_ACU(ddl,'__bound_table__'),tokens=[]
 for(let i=0;i<source.length;){
  if(/\s/.test(source[i])){i++;continue}
  if(source.slice(i,i+2)==='--'){const end=source.indexOf('\n',i+2);i=end<0?source.length:end+1;continue}
  if(source.slice(i,i+2)==='/*'){const end=source.indexOf('*/',i+2);if(end<0)throw Error('DDL 注释未闭合');i=end+2;continue}
  const start=i,char=source[i]
  if(['\'', '"','`','['].includes(char)){
   const end=char==='['?']':char;i++;let closed=false
   while(i<source.length){if(source[i]!==end){i++;continue}if(source[i+1]===end){i+=2;continue}i++;closed=true;break}
   if(!closed)throw Error('DDL 引号未闭合')
  }else if(/[\w$\u0080-\uFFFF]/.test(char)){while(i<source.length&&/[\w$\u0080-\uFFFF]/.test(source[i]))i++}
  else i++
  tokens.push(source.slice(start,i))
 }
 return tokens
}
function declaration(sheet){
 if(!record(sheet)||!Array.isArray(sheet.content)||!record(sheet.sourceData)||!parseDDLTableName(sheet.sourceData.ddl||''))return null
 const {content,sourceData,_dshLastRowId,...rest}=sheet,{ddl,tableAliases,...fields}=sourceData
 return {...rest,content:[content[0]],sourceData:{...fields,ddl:ddlContract(ddl)}}
}
/** Resolve only this chat's recorded template history. No names inferred from SQL,
 * script text, display-name similarity, or a different isolation's declarations.
 * The result is read-only SQL metadata; original sheets/DDL/rows remain unchanged.
 */
export function archivedSpTableAliases(chat,data,isolationCode){
 const metadata=json(chat.tavernPluginMetadata?.TavernDB_ACU_ScopedConfig),header=json(chat.messages?.[0]?.tavernPluginData?.TavernDB_ACU_ScopedConfig)
 if(metadata&&header&&!isDeepStrictEqual(metadata,header))return {}
 const config=metadata||header;if(!record(config)||!record(config.template))return {}
 const scopes=Object.keys(config.template),scope=typeof isolationCode==='string'?isolationCode:scopes.length===1?scopes[0]:null
 if(scope===null)return {}
 const current=config.template[scope],archives=config.templateArchives?.[scope];if(!Array.isArray(archives))return {}
 // Identity memoization lives only for this validation. Every later invocation
 // re-reads current declarations; no storage/revision assumptions are cached.
 const templates=new WeakMap(),contracts=new WeakMap()
 function contract(sheet){
  if(!record(sheet))return null
  if(!contracts.has(sheet)){try{contracts.set(sheet,{value:declaration(sheet)})}catch(error){contracts.set(sheet,{error})}}
  const cached=contracts.get(sheet);if(cached.error)throw cached.error
  return cached.value
 }
 function declaredSheet(entry,key){
  if(!record(entry)||entry.mode!=='chat_override'||entry.isolationKey!==scope||!record(entry.guideData))return null
  if(!templates.has(entry))templates.set(entry,json(entry.templateStr))
  const template=templates.get(entry),guide=entry.guideData[key]
  if(!record(template)||!guide||!isDeepStrictEqual(contract(guide),contract(template[key])))return null
  return guide
 }
 const aliases={}
 for(const [key,live]of Object.entries(data||{})){
  if(!key.startsWith('sheet_')||typeof live?.uid!=='string'||!live.uid)continue
  try{
   const present=declaredSheet(current,key)
   if(!present||present.uid!==live.uid||!isDeepStrictEqual(contract(present),contract(live)))continue
   for(const entry of archives){
    const historical=declaredSheet(entry,key)
    if(!historical||historical.uid!==live.uid||!isDeepStrictEqual(contract(historical),contract(present)))continue
    const name=parseDDLTableName(historical.sourceData.ddl)
    if(name)aliases[key]=[...new Set([...(aliases[key]||[]),name])]
   }
  }catch{/* Invalid or changed declarations establish no new routing authority. */}
 }
 return aliases
}
