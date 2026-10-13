import {parse} from 'acorn'
import path from 'node:path'
const literal=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value:node?.type==='TemplateLiteral'&&!node.expressions.length?node.quasis[0].value.cooked:node?.type==='BinaryExpression'&&node.operator==='+'&&literal(node.left)!==undefined&&literal(node.right)!==undefined?literal(node.left)+literal(node.right):undefined
const relative=value=>/^\.{1,2}\//.test(value)
export function resolveFrontendDependency(specifier,from,known={}) {
 if(typeof specifier!=='string'||/[\0\\]/.test(specifier))throw Error('扩展模块路径无效：'+String(specifier))
 const imported=specifier.replace(/^(?:\.\.\/)+/,'')
 // ST paths escape the third-party extension root. A same-named file inside
 // the repository remains the repository's file, not a host module.
 const pathname=specifier.split(/[?#]/)[0],suffix=specifier.slice(pathname.length)
 const parts=from.split(/[?#]/)[0].split('/').slice(0,-1);let escaped=false
 if(relative(specifier)){for(const encoded of pathname.split('/')){let part;try{part=decodeURIComponent(encoded)}catch{throw Error('扩展模块路径编码无效：'+specifier)}if(/[\0\\/]/.test(part))throw Error('扩展模块路径无效：'+specifier);if(part==='..'){if(parts.length)parts.pop();else escaped=true}else if(part!=='.'&&part)parts.push(encodeURIComponent(part))}
  if(!escaped)return {kind:'module',path:parts.join('/')+suffix}
  if(known[imported])return {kind:'builtin',path:imported}
 }
 if(known[specifier])return {kind:'builtin',path:specifier}
 throw Error('尚不支持的原版模块或仓库外模块：'+specifier+'（来源 '+from+'）')
}
export function inspectFrontendModule(source,from,known={}) {
 let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'})}catch(error){throw Error('扩展模块语法错误：'+from+'：'+error.message)}
 const imports=[],assets=[],edits=[],warnings=[],pending=[ast]
 function module(node,specifier,specifiers=[]){
  const target=resolveFrontendDependency(specifier,from,known)
  if(target.kind==='builtin')for(const item of specifiers){if(item.type==='ImportNamespaceSpecifier')continue;const name=item.type==='ImportDefaultSpecifier'?'default':item.imported?.name||item.imported?.value||item.local?.name;if(name&&!known[target.path].includes(name))throw Error('尚不支持的原版接口：'+target.path+'/'+name)}
  const row={start:node.start,end:node.end,...target};imports.push(row);edits.push(row)
 }
 while(pending.length){const node=pending.pop()
  if(node.type==='ImportDeclaration'||node.type==='ExportAllDeclaration'||node.type==='ExportNamedDeclaration'&&node.source)module(node.source,node.source.value,node.specifiers)
  if(node.type==='ImportExpression'){
   const value=literal(node.source)
   if(value!==undefined)module(node.source,value)
   else {edits.push({start:node.start,end:node.end,kind:'dynamic',expression:source.slice(node.source.start,node.source.end)});warnings.push({phase:'module-discovery',module:from,line:source.slice(0,node.start).split('\n').length,reason:'runtime-specifier',message:'此动态模块路径需运行时求值；未预加载的路径会显示实际来源和重试说明'})}
  }
  const meta=node.type==='MemberExpression'&&!node.computed&&node.object.type==='MetaProperty'&&node.object.meta.name==='import'&&node.property.name==='url'
  if(meta)edits.push({start:node.start,end:node.end,kind:'base'})
  const file=node.type==='NewExpression'&&node.callee.name==='URL'&&node.arguments[1]?.type==='MemberExpression'&&node.arguments[1].object.type==='MetaProperty'||node.type==='CallExpression'&&node.callee.name==='fetch'
  if(file){const argument=node.arguments[0],value=literal(argument);if(value&&relative(value)){const target=resolveFrontendDependency(value,from,{}),row={start:argument.start,end:argument.end,kind:'asset',path:target.path};assets.push(row);edits.push(row)}}
  for(const [key,value]of Object.entries(node)){if(key==='source'&&node.type==='ImportExpression'&&literal(node.source)===undefined)continue;if(Array.isArray(value)){for(const child of value)if(child?.type)pending.push(child)}else if(value?.type)pending.push(value)}
 }
 return {imports:imports.sort((a,b)=>a.start-b.start),assets,edits:edits.sort((a,b)=>a.start-b.start),warnings}
}
export function inspectFrontendCss(source,from){
 const refs=[]
 for(const match of source.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)'"\s][^)]*?))\s*\)|@import\s+(["'])(.*?)\4/g)){
  const value=(match[2]??match[3]??match[5]??'').trim();if(!value||/^(?:[\w+.-]+:|\/|#)/.test(value))continue
  const target=resolveFrontendDependency(relative(value)?value:'./'+value,from,{}),kind=match[5]!==undefined||/^\s*@import\s*$/.test(source.slice(Math.max(0,match.index-12),match.index))?'css':'asset'
  refs.push({start:match.index,end:match.index+match[0].length,path:target.path,kind,form:match[5]!==undefined?'import':'url'})
 }
 return refs
}
const types={'.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.json':'application/json','.html':'text/html','.txt':'text/plain','.wasm':'application/wasm'}
export async function collectFrontendGraph({entry,css,read,known}){
 const files={},styles={},assets={},warnings=[],queue=[{kind:'module',path:entry}],seen=new Set()
 if(css)queue.push({kind:'css',path:css})
 for(let i=0;i<queue.length;i++){
  const row=queue[i],key=row.kind+':'+row.path;if(seen.has(key))continue;seen.add(key)
  let body;try{body=await read(row.path,row.kind==='css'?1000000:4000000)}catch(error){throw Error('读取扩展依赖失败：'+row.path+'：'+error.message)}
  if(row.kind==='asset'){assets[row.path]={type:types[path.posix.extname(row.path.split(/[?#]/)[0]).toLowerCase()]||'application/octet-stream',base64:body.toString('base64')};continue}
  const source=body.toString('utf8')
  if(row.kind==='css'){const refs=inspectFrontendCss(source,row.path);styles[row.path]={source,refs};queue.push(...refs.map(ref=>({kind:ref.kind,path:ref.path})));continue}
  if(row.path.split(/[?#]/)[0].endsWith('.json')){JSON.parse(source);files[row.path]={source,type:'json',edits:[]};continue}
  const inspected=inspectFrontendModule(source,row.path,known);files[row.path]={source,type:'javascript',edits:inspected.edits,imports:inspected.imports};warnings.push(...inspected.warnings)
  queue.push(...inspected.imports.filter(ref=>ref.kind==='module').map(ref=>({kind:'module',path:ref.path})),...inspected.assets.map(ref=>({kind:'asset',path:ref.path})))
 }
 return {version:1,entry,css:css||null,files,styles,assets,warnings}
}
