import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseDDLTableName, parseDDLColumnNames } from '../vendor/sp-database/ddl-utils.js'
import {spSqlAliasBindings,bindSpSqlMutationTarget} from './sp-sql-aliases.js'

const quote = value => '"' + String(value).replaceAll('"', '""') + '"'
export const SP_SQL_LIMITS = Object.freeze({ timeoutMs:30000, maxInputBytes:32*1024*1024, maxOutputBytes:32*1024*1024, maxCellBytes:512*1024, maxRows:100000, maxSqlBytes:128*1024, sqliteHeapBytes:256*1024*1024, maxPages:65536, jsHeapMiB:256 })
const budgetError = message => Object.assign(new Error('SQL 资源预算上限：'+message),{code:'SP_SQL_BUDGET'})
function budgets(options={}) { return Object.fromEntries(Object.entries(SP_SQL_LIMITS).map(([key,value])=>[key,Number.isSafeInteger(options[key])&&options[key]>0?options[key]:value])) }
function sqlTokens(source) {
  const tokens=[];let quoteChar='',lineComment=false,blockComment=false
  for(let i=0;i<source.length;i++){
    const c=source[i],n=source[i+1]
    if(lineComment){if(c==='\n')lineComment=false;continue}
    if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++}continue}
    if(quoteChar){if(c===quoteChar){if(n===quoteChar&&quoteChar!==']')i++;else quoteChar=''}continue}
    if(c==='-'&&n==='-'){lineComment=true;i++;continue}
    if(c==='/'&&n==='*'){blockComment=true;i++;continue}
    if(['"',"'",'`','['].includes(c)){quoteChar=c==='['?']':c;continue}
    tokens.push({char:c,index:i})
  }
  if(quoteChar||blockComment)throw new Error('SQL 的引号或注释没有闭合')
  return tokens
}
export function splitSqlStatements(source) {
  const statements=[];let start=0
  for(const token of sqlTokens(source))if(token.char===';'){if(source.slice(start,token.index).trim())statements.push(source.slice(start,token.index).trim());start=token.index+1}
  if(source.slice(start).trim())statements.push(source.slice(start).trim())
  return statements.filter(sql=>verb(sql))
}
function verb(sql) { return sql.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,' ').trim().match(/^\w+/)?.[0]?.toUpperCase()||'' }
function positionalCount(sql) {
  let count=0
  for(const token of sqlTokens(sql))if(token.char==='?'){const match=/^\d+/.exec(sql.slice(token.index+1));count=match?Math.max(count,Number(match[0])):count+1}
  return count
}
export function spSqlSchema(data,{tableAliases={}}={}) {
  return Object.keys(data).filter(key=>key.startsWith('sheet_')).map(key=>{
    const sheet=data[key],source=String(sheet.sourceData?.ddl||'').trim(),name=source?parseDDLTableName(source):key
    if(!name)throw new Error(sheet.name+' 的 DDL 表名无法解析')
    const columns=source?parseDDLColumnNames(source):sheet.content[0].map(String)
    if(columns.length!==sheet.content[0].length)throw new Error(sheet.name+' 的 DDL 列数和表格不一致')
    const ddl=source||'CREATE TABLE '+quote(name)+' ('+columns.map((column,index)=>quote(column)+(index===0&&column==='row_id'?' INTEGER PRIMARY KEY':' TEXT')).join(', ')+')'
    const statements=splitSqlStatements(ddl)
    if(statements.length!==1||verb(statements[0])!=='CREATE'||!/^CREATE\s+TABLE\s/i.test(statements[0].replace(/^\s*--[^\n]*\n/g,'')))throw new Error('模板 DDL 必须是单条 CREATE TABLE')
    if(sheet.sourceData?.tableAliases!==undefined&&!Array.isArray(sheet.sourceData.tableAliases))throw Error(sheet.name+' 的 tableAliases 无效')
    if(tableAliases[key]!==undefined&&!Array.isArray(tableAliases[key]))throw Error(sheet.name+' 的模板别名绑定无效')
    const declared=[...(sheet.sourceData?.tableAliases||[]),...(tableAliases[key]||[])]
    if(declared!==undefined&&(!Array.isArray(declared)||declared.length>128||declared.some(alias=>typeof alias!=='string'||!alias.trim()||alias.length>256||alias.includes('\0'))))throw Error(sheet.name+' 的 tableAliases 无效')
    const aliases=[...new Set([key,sheet.uid,...(declared||[])].filter(alias=>typeof alias==='string'&&alias.trim()).map(alias=>alias.trim()))]
    return {key,name,columns,ddl:statements[0],aliases}
  })
}
function checkCell(value,limit){if(typeof value==='string'&&Buffer.byteLength(value)>limit)throw budgetError('单元格大小超限');if(ArrayBuffer.isView(value)&&value.byteLength>limit)throw budgetError('单元格大小超限')}
function checkInput(data,source,limits){
  if(Buffer.byteLength(String(source))>limits.maxSqlBytes)throw budgetError('SQL 文本大小超限')
  let rows=0;for(const key of Object.keys(data).filter(k=>k.startsWith('sheet_'))){const content=data[key]?.content;if(!Array.isArray(content))throw Error('SQL 表格缺少 content');rows+=Math.max(0,content.length-1);if(rows>limits.maxRows)throw budgetError('输入总行数超限');for(const row of content)for(const cell of row)checkCell(cell,limits.maxCellBytes)}
  if(Buffer.byteLength(JSON.stringify(data))>limits.maxInputBytes)throw budgetError('输入大小超限')
}
let active=0;const waiters=[]
async function acquire(timeout){
  if(active<2){active++;return}
  if(waiters.length>=16)throw budgetError('排队任务过多')
  await new Promise((resolve,reject)=>{const item={resolve:()=>{clearTimeout(item.timer);resolve()}};item.timer=setTimeout(()=>{const at=waiters.indexOf(item);if(at>=0)waiters.splice(at,1);reject(budgetError('排队超时'))},timeout);waiters.push(item)})
}
function release(){const next=waiters.shift();if(next)next.resolve();else active--}
/** One disposable process per query bounds native SQLite memory as well as JS work. */
export async function runSpSql(data,source,options={}) {
  const limits=budgets(options);checkInput(data,source,limits);options.signal?.throwIfAborted()
  const parameters=options.parameters??[];if(Buffer.byteLength(JSON.stringify(parameters))>1024*1024)throw budgetError('参数大小超限')
  await acquire(limits.timeoutMs)
  try{return await new Promise((resolve,reject)=>{
    const child=fork(new URL('./sp-sql-worker.js',import.meta.url),[],{windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],env:{NODE_NO_WARNINGS:'1',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})},execArgv:['--max-old-space-size='+limits.jsHeapMiB,'--permission','--allow-fs-read='+fileURLToPath(new URL('../../',import.meta.url))]})
    let settled=false;const timer=setTimeout(()=>finish(budgetError('执行超时，任务已终止且未提交')),limits.timeoutMs)
    const abort=()=>finish(options.signal.reason||new Error('SQL 已取消'))
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);child.kill();error?reject(error):resolve(result)}
    child.stderr.on('data',()=>{})
    child.on('error',finish);child.on('exit',(code,signal)=>finish(budgetError('执行进程退出 ('+(signal||code)+')，未提交')))
    child.on('message',message=>message.error?finish(Object.assign(new Error(message.error.message),{code:message.error.code})):finish(null,message.result))
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)return abort()
    child.send({data,source:String(source),options:{mutate:options.mutate===true,parameters,allowedSheets:options.allowedSheets,tableAliases:options.tableAliases,discardUnauthorizedTables:options.discardUnauthorizedTables===true,...limits}},error=>{if(error)finish(error)})
  })}finally{release()}
}

/** Internal worker entry; never called on the server event loop. */
export async function executeSpSqlWorker(data,source,options={}) {
  const {mutate=false,parameters=[],allowedSheets,discardUnauthorizedTables=false}=options,limits=budgets(options)
  checkInput(data,source,limits)
  const {DatabaseSync,constants:c}=await import('node:sqlite'),db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false,allowExtension:false})
  if(typeof db.setAuthorizer!=='function'){db.close();throw Error('SQL 功能需要 Node.js 24.10 或更高版本；表格编辑仍可使用。')}
  const schema=spSqlSchema(data,{tableAliases:options.tableAliases}),names=new Set(schema.map(t=>t.name.toLowerCase())),warnings=[]
  const bindings=spSqlAliasBindings(schema)
  if(names.size!==schema.length){db.close();throw Error('模板包含重复的 SQL 表名')}
  let phase='hydrate',statementReads=new Set(),statementWrites=new Set()
  const allowedNames=allowedSheets?new Set(schema.filter(t=>allowedSheets.includes(t.key)).map(t=>t.name.toLowerCase())):null
  try{
    db.exec('PRAGMA temp_store=MEMORY; PRAGMA hard_heap_limit='+limits.sqliteHeapBytes+'; PRAGMA max_page_count='+limits.maxPages)
    db.setAuthorizer((action,arg1,arg2)=>{
      if([c.SQLITE_ATTACH,c.SQLITE_DETACH,c.SQLITE_CREATE_VTABLE,c.SQLITE_DROP_VTABLE].includes(action))return c.SQLITE_DENY
      if(action===c.SQLITE_FUNCTION&&['load_extension','readfile','writefile'].includes(String(arg2||arg1).toLowerCase()))return c.SQLITE_DENY
      if(phase!=='execute')return c.SQLITE_OK
      if(action===c.SQLITE_READ)statementReads.add((bindings.aliases.get(String(arg1).toLowerCase())||String(arg1)).toLowerCase())
      if([c.SQLITE_INSERT,c.SQLITE_UPDATE,c.SQLITE_DELETE].includes(action))statementWrites.add(String(arg1).toLowerCase())
      if(action===c.SQLITE_SELECT||action===c.SQLITE_FUNCTION)return c.SQLITE_OK
      if(action===c.SQLITE_READ&&(names.has(String(arg1).toLowerCase())||bindings.aliases.has(String(arg1).toLowerCase())))return c.SQLITE_OK
      if(mutate&&[c.SQLITE_INSERT,c.SQLITE_UPDATE,c.SQLITE_DELETE].includes(action)&&names.has(String(arg1).toLowerCase()))return c.SQLITE_OK
      return c.SQLITE_DENY
    })
    for(const table of schema){
      table.auto=table.columns[0]==='row_id'&&/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(table.ddl)
      const ddl=table.auto?table.ddl.replace(/\bINTEGER\s+PRIMARY\s+KEY\b(?!\s+AUTOINCREMENT)/i,'INTEGER PRIMARY KEY AUTOINCREMENT'):table.ddl
      const hydrate=()=>{const insert=db.prepare('INSERT INTO '+quote(table.name)+' ('+table.columns.map(quote).join(',')+') VALUES ('+table.columns.map(()=>'?').join(',')+')');for(const row of data[table.key].content.slice(1))insert.run(...row.map(cell=>typeof cell==='boolean'?Number(cell):cell))}
      db.exec(ddl)
      try{hydrate()}catch(error){
        if(!/constraint failed|NOT NULL|UNIQUE|CHECK/i.test(error.message))throw error
        db.exec('DROP TABLE '+quote(table.name))
        db.exec('CREATE TABLE '+quote(table.name)+' ('+table.columns.map((column,index)=>quote(column)+(index===0&&column==='row_id'?' INTEGER PRIMARY KEY AUTOINCREMENT':' TEXT')).join(',')+')');table.auto=table.columns[0]==='row_id';hydrate();warnings.push(table.name+'：已有数据不符合模板约束，本次使用去约束的查询副本；模板和原数据保留。')
      }
      let last=Number(data[table.key]._dshLastRowId)||0;for(const row of data[table.key].content.slice(1))if(Number.isSafeInteger(Number(row[0])))last=Math.max(last,Number(row[0]));table.last=last
      if(table.auto){db.prepare('UPDATE sqlite_sequence SET seq=? WHERE name=?').run(last,table.name);if(!db.prepare('SELECT 1 FROM sqlite_sequence WHERE name=?').get(table.name))db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run(table.name,last)}
    }
    // Read aliases use native SQLite name resolution, including JOIN/CTE/quoted
    // identifiers. Writes are rebound to the real table, never INSTEAD OF triggers.
    for(const [alias,physical]of bindings.aliases)db.exec('CREATE VIEW '+quote(alias)+' AS SELECT * FROM main.'+quote(physical))
    const statements=splitSqlStatements(source)
    if(!statements.length||statements.length>200||(!mutate&&statements.length!==1))throw Error('SQL 语句数量无效')
    if(statements.some(sql=>!(mutate?['INSERT','UPDATE','DELETE']:['SELECT']).includes(verb(sql))))throw Error(mutate?'只允许 INSERT、UPDATE 和 DELETE':'查询只允许一条 SELECT')
    const nested=Array.isArray(parameters)&&parameters.length>0&&parameters.every(Array.isArray);let offset=0
    const binding=(sql,index)=>{if(!Array.isArray(parameters))return parameters;if(nested){if(parameters.length!==statements.length)throw Error('SQL 逐语句参数数量不匹配');return parameters[index]}const count=positionalCount(sql),slice=parameters.slice(offset,offset+count);offset+=count;if(slice.length!==count)throw Error('SQL 参数数量不足');return slice}
    const invoke=(statement,method,values)=>Array.isArray(values)?statement[method](...values):statement[method](values)
    const verifyRemaining=()=>{if(Array.isArray(parameters)&&!nested&&offset!==parameters.length)throw Error('SQL 参数数量多于占位符')}
    phase='execute'
    let result
    if(!mutate){
      const limit=Math.min(2000,limits.maxRows),statement=db.prepare('SELECT * FROM ('+statements[0]+'\n) LIMIT '+(limit+1)),values=binding(statements[0],0),rows=[];let bytes=0,limited=false
      const iterator=invoke(statement,'iterate',values);for(const row of iterator){if(rows.length>=limit){limited=true;break}for(const cell of Object.values(row))checkCell(cell,limits.maxCellBytes);bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>limits.maxOutputBytes)throw budgetError('查询结果大小超限');rows.push({...row})}verifyRemaining();result={rows,limited}
    }else{
      let changes=0
      for(const [index,sourceSql]of statements.entries()){
        const sql=bindSpSqlMutationTarget(sourceSql,bindings)
        statementReads=new Set();statementWrites=new Set();const statement=db.prepare(sql),values=binding(sourceSql,index)
        if(allowedNames&&[...statementWrites].some(n=>!allowedNames.has(n))){if(discardUnauthorizedTables&&statementWrites.size&&[...statementWrites,...statementReads].every(n=>!allowedNames.has(n)))continue;throw Error('SQL 涉及未选择的表格或跨表操作')}
        changes+=Number(invoke(statement,'run',values).changes)
      }
      verifyRemaining();phase='readback';const next=structuredClone(data);let totalRows=0
      for(const table of schema){
        const rows=[];for(const row of db.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.name)).iterate()){if(++totalRows>limits.maxRows)throw budgetError('结果总行数超限');for(const cell of Object.values(row))checkCell(cell,limits.maxCellBytes);rows.push(row)}
        const previous=new Map(data[table.key].content.slice(1).map((row,index)=>[String(row[0]),{row,index}]))
        if(table.columns[0]==='row_id')rows.sort((a,b)=>(previous.get(String(a.row_id))?.index??Infinity)-(previous.get(String(b.row_id))?.index??Infinity))
        next[table.key].content=[structuredClone(data[table.key].content[0]),...rows.map(row=>table.columns.map((column,index)=>{const value=row[column],original=previous.get(String(row[table.columns[0]]))?.row[index];return original!==undefined&&String(original)===String(value)?original:value}))]
        if(table.auto){
          const last=Math.max(table.last,Number(db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(table.name)?.seq)||0)
          const maximum=rows.reduce((value,row)=>Math.max(value,Number(row.row_id)||0),0)
          if(Object.hasOwn(data[table.key],'_dshLastRowId')||last>maximum)next[table.key]._dshLastRowId=last
        }
      }
      result={data:next,changes}
    }
    if(warnings.length)result.warnings=warnings
    if(Buffer.byteLength(JSON.stringify(result))>limits.maxOutputBytes)throw budgetError('结果大小超限')
    return result
  }finally{db.close()}
}
