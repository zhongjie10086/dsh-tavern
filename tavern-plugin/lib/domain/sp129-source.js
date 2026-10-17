import {parse} from 'acorn'

// Edit only verified nodes of the published bundle. Unchanged source keeps its
// original bytes; this is not a formatter or a second build of the extension.
export function walkSp129(node, visit, parent = null) {
 if (!node || typeof node !== 'object' || typeof node.type !== 'string') return
 if (visit(node, parent) === false) return
 for (const [key, value] of Object.entries(node)) {
  if (key === 'start' || key === 'end') continue
  if (Array.isArray(value)) for (const item of value) walkSp129(item, visit, node)
  else if (value && typeof value === 'object') walkSp129(value, visit, node)
 }
}

export function createSp129Context(source) {
 const ast = parse(source, {ecmaVersion:'latest', sourceType:'module'})
 const roots = []
 walkSp129(ast, node => {
  if (node.type === 'BlockStatement' && node.body.some(item => item.type === 'FunctionDeclaration' && item.id?.name === 'reconcileMatchedSheet_ACU')) roots.push(node)
 })
 if (roots.length !== 1) throw Error('SP 1.2.9 主作用域缺失或不唯一')
 const root = roots[0], edits = [], apiHooks = []
 const functions = new Map()
 for (const item of root.body) if (item.type === 'FunctionDeclaration') {
  const name = item.id?.name
  if (functions.has(name)) throw Error('SP 1.2.9 主作用域函数重复：'+name)
  functions.set(name, item)
 }
 const assignments = []
 walkSp129(root, node => {
  if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression' && !node.left.computed && node.left.property.name === 'AutoCardUpdaterAPI' && node.left.object.type === 'Identifier' && node.right.type === 'Identifier') assignments.push(node)
 })
 if (assignments.length !== 1) throw Error('SP 1.2.9 API 发布节点缺失或不唯一')
 const apiAssignment = assignments[0]
 const context = {
  source, ast, root, functions, edits, apiAssignment,
  apiName:apiAssignment.right.name, hostName:apiAssignment.left.object.name,
  function(name) { const node=functions.get(name); if(!node) throw Error('SP 1.2.9 函数缺失：'+name); return node },
  text(node) { return source.slice(node.start,node.end) },
  replace(nodeOrStart, endOrText, text) {
   const start=typeof nodeOrStart==='number'?nodeOrStart:nodeOrStart.start
   const end=typeof nodeOrStart==='number'?endOrText:nodeOrStart.end
   const value=typeof nodeOrStart==='number'?text:endOrText
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>source.length||typeof value!=='string')throw Error('SP 1.2.9 非法适配范围')
   edits.push({start,end,text:value})
  },
  insert(offset,text) { context.replace(offset,offset,text) },
  atApi(text) { apiHooks.push(text) },
  symbolFromSetter(name) {
   const fn=context.function(name), matches=[]
   walkSp129(fn.body,node=>{if(node.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='Identifier'&&node.right.type==='Identifier'&&node.right.name===fn.params[0]?.name)matches.push(node.left.name)})
   if(matches.length!==1)throw Error('SP 1.2.9 setter 绑定无法确认：'+name)
   return matches[0]
  },
  apply() {
   if(apiHooks.length) context.replace(apiAssignment,'('+context.text(apiAssignment)+',(()=>{'+apiHooks.join('\n')+'})(),'+context.apiName+')')
   const ordered=edits.map((edit,index)=>({...edit,index})).sort((a,b)=>a.start-b.start||a.end-b.end||a.index-b.index)
   const chunks=[];let offset=0
   for(const edit of ordered){if(edit.start<offset)throw Error('SP 1.2.9 适配范围重叠');chunks.push(source.slice(offset,edit.start),edit.text);offset=edit.end}
   chunks.push(source.slice(offset));return chunks.join('')
  }
 }
 return context
}
