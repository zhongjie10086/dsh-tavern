// Narrow AST projections for SP 1.2.9; retained-column proof matches the established SP contract.
const sqlWhitespaceHelper="function __dshNormalizeSqlDefinitionWhitespace_ACU(value) {\n        const input = String(value);\n        let result = '', quote = '', pendingSpace = false, lineComment = false, blockComment = false;\n        for (let index = 0; index < input.length; index += 1) {\n            const char = input[index], next = input[index + 1];\n            if (lineComment) {\n                result += char;\n                if (char === '\\n') lineComment = false;\n                continue;\n            }\n            if (blockComment) {\n                result += char;\n                if (char === '*' && next === '/') { result += next; index += 1; blockComment = false; }\n                continue;\n            }\n            if (quote) {\n                result += char;\n                if (char === quote) {\n                    if (quote !== ']' && next === quote) { result += next; index += 1; }\n                    else quote = '';\n                }\n                continue;\n            }\n            if (/\\s/.test(char)) { pendingSpace = true; continue; }\n            if (pendingSpace && result) result += ' ';\n            pendingSpace = false;\n            result += char;\n            if (char === '-' && next === '-') { result += next; index += 1; lineComment = true; }\n            else if (char === '/' && next === '*') { result += next; index += 1; blockComment = true; }\n            else if (char === \"'\" || char === '\"' || char === '`' || char === '[') quote = char === '[' ? ']' : char;\n        }\n        // Never turn an unterminated token into a different candidate statement.\n        return quote || blockComment ? input : result;\n    }\n    ";
const retainedColumnsHelper="function __dshPreserveNativeRetainedColumns_ACU(sheet, ddl, headers, columns) {\n        const mappings = resolveInsertColumnMappings({ ...sheet, content: [headers] }, headers, ddl);\n        const mapped = new Set(mappings.map(mapping => mapping.sourceIndex));\n        const missing = headers.map((_, index) => index).filter(index => !mapped.has(index));\n        const hidden = sheet.sourceData?.hiddenPhysicalColumns;\n        const hiddenNames = new Set(Array.isArray(hidden) ? hidden.map(name => String(name ?? '').trim().toLowerCase()) : []);\n        if (!missing.some(index => hiddenNames.has(headers[index].toLowerCase()))) return ddl;\n        // A pre-existing invalid list is not a mode-conversion license to repair it.\n        getSheetColumnProjection_ACU(sheet);\n        if (mappings.length !== columns.length || !mappings.every((mapping, index) => mapping.sourceIndex === index)\n            || missing.some((index, position) => index !== columns.length + position || !hiddenNames.has(headers[index].toLowerCase())\n                || headers[index] !== headers[index].trim() || /[\\r\\n]/.test(headers[index])\n                || columns.some(column => column.sqlName.toLowerCase() === headers[index].toLowerCase()))) {\n            throw new Error('原生休眠列与 DDL 无法无歧义对齐，已拒绝丢弃列。');\n        }\n        const bounds = findCreateTableDefinitionBounds_ACU(ddl);\n        if (!bounds) throw new Error('原生休眠列缺少可验证的 DDL 边界。');\n        const used = new Set(columns.map(column => column.sqlName.toLowerCase()));\n        const additions = missing.map(index => ({\n            name: reserveSqlName_ACU(toSqlIdentifierBase_ACU(headers[index], index), used),\n            header: headers[index]\n        }));\n        // Preserve all existing SQL bytes, including default literals, comments,\n        // constraints, and suffixes. Insert before table constraints, never after.\n        const parts = splitColumnDefinitions(ddl.slice(bounds.openingIndex + 1, bounds.closingIndex));\n        let position = bounds.openingIndex + 1, insertion = bounds.closingIndex, beforeConstraint = false;\n        for (const part of parts) {\n            const trivia = skipSqlTrivia_ACU(part, 0);\n            if (/^(?:PRIMARY\\s+KEY|FOREIGN\\s+KEY|UNIQUE|CHECK|CONSTRAINT)\\b/i.test(part.slice(trivia))) {\n                insertion = position + trivia; beforeConstraint = true; break;\n            }\n            position += part.length + 1;\n        }\n        const added = additions.map((column, index) => column.name + ' TEXT'\n            + (beforeConstraint || index < additions.length - 1 ? ',' : '') + ' -- ' + column.header).join('\\n');\n        const expanded = ddl.slice(0, insertion) + (beforeConstraint ? '\\n' : ',\\n') + added + '\\n' + ddl.slice(insertion);\n        // The export path reads display names from SQL comments. Prove exact\n        // round-trip names before creating anything; never silently trim them.\n        const physicalNames = parseDDLColumnNames(expanded), comments = parseDDLColumnComments(expanded);\n        if (physicalNames.length !== headers.length || physicalNames.some((name, index) =>\n            (name === 'row_id' ? 'row_id' : comments.get(name) || name) !== headers[index])) {\n            throw new Error('原生休眠列的显示名无法经 DDL 原样回读，已拒绝改名。');\n        }\n        return expanded;\n    }\n    ";
function walk(node, visit, ancestors = []) {
 if (!node || typeof node.type !== 'string') return;
 visit(node, ancestors);
 for (const value of Object.values(node)) {
  if (Array.isArray(value)) for (const item of value) walk(item, visit, [...ancestors, node]);
  else if (value && typeof value.type === 'string') walk(value, visit, [...ancestors, node]);
 }
}
function find(root, predicate) { const out=[]; walk(root,(node,parents)=>{if(predicate(node,parents))out.push(node)});return out; }
function one(nodes, label) { if(nodes.length!==1)throw Error('SP 1.2.9 '+label+' AST 不唯一: '+nodes.length);return nodes[0]; }
const call = (node, name) => node?.type === 'CallExpression' && node.callee?.name === name;
const prop = (node, name) => node?.type === 'MemberExpression' && (node.computed ? node.property.value : node.property.name) === name;
const key = node => node.key?.name ?? node.key?.value;
function rewrite(ctx, fn, action) {
 const edits=[];
 const edit=(node,text)=>edits.push({start:node.start,end:node.end,text});
 const insert=(offset,text)=>edits.push({start:offset,end:offset,text});
 action(edit,insert);
 let result=ctx.text(fn),last=fn.end;
 for(const e of edits.sort((a,b)=>b.start-a.start||b.end-a.end)) {
  if(e.end>last)throw Error('SP 1.2.9 数据适配范围重叠');
  result=result.slice(0,e.start-fn.start)+e.text+result.slice(e.end-fn.start);last=e.start;
 }
 ctx.replace(fn,result);
}
export function adaptSp129Data(ctx) {
 // DSH has already loaded the durable host namespace before starting the
 // original. Its absent keys are authoritative, even when opaque-frame IDB
 // cannot open. Present values still pass through the original corruption
 // checks; an absent host namespace keeps the original IDB failure behavior.
 const storage=ctx.function('getConfigStorage_ACU');
 rewrite(ctx,storage,(_edit,insert)=>{
  const getter=one(find(storage,n=>n.type==='Property'&&key(n)==='getItem'&&n.value.type==='ArrowFunctionExpression'),'配置读取器');
  const direct=one(getter.value.body.body.filter(n=>n.type==='IfStatement'&&n.test.type==='LogicalExpression'&&n.test.operator==='&&'&&n.test.right.type==='CallExpression'&&prop(n.test.right.callee,'call')&&prop(n.test.right.callee.object,'hasOwnProperty')&&n.consequent.type==='ReturnStatement'),'宿主配置读取');
  insert(direct.end,'if('+ctx.text(direct.test.left)+' && typeof __dshUiStorage !== "undefined" && __dshUiStorage) return null;');
 });
 // Preserve SQL literal bytes while retaining the official parser and serializer.
 for(const name of ['parseDDLColumnInfos_ACU','parseDDLTableConstraints_ACU']) {
  const fn=ctx.function(name);
  rewrite(ctx,fn,edit=>{
   const normalize=one(find(fn,n=>n.type==='CallExpression'&&prop(n.callee,'trim')&&n.callee.object?.type==='CallExpression'&&prop(n.callee.object.callee,'replace')&&n.callee.object.arguments[0]?.regex?.pattern==='\\s+'),'SQL 空白');
   edit(normalize,'__dshNormalizeSqlDefinitionWhitespace_ACU('+ctx.text(normalize.callee.object.callee.object)+')');
  });
 }
 ctx.insert(ctx.root.start+1,sqlWhitespaceHelper+retainedColumnsHelper);
 const guide=ctx.function('applyGuideMetadataToSheet_ACU');
 rewrite(ctx,guide,(edit)=>{
  const iterate=one(find(guide,n=>n.type==='CallExpression'&&prop(n.callee,'forEach')&&n.arguments[0]?.type==='ArrowFunctionExpression'&&n.arguments[0].params[0]?.type==='ArrayPattern'),'指导表元数据');
  const callback=iterate.arguments[0], [field,value]=callback.params[0].elements.map(n=>ctx.text(n));
  const originalSource=one(find(guide,n=>n.type==='VariableDeclarator'&&n.init?.type==='ConditionalExpression'&&find(n.init,x=>prop(x,'sourceData')).length>0),'指导表原元数据');
  const target=ctx.text(guide.params[0]),options=ctx.text(guide.params[2]);
  edit(callback.body,'{if('+field+' === "hiddenPhysicalColumns" && !'+options+'.inheritDdl){try{getSheetColumnProjection_ACU({...'+target+',sourceData:{...'+ctx.text(originalSource.id)+',hiddenPhysicalColumns:'+value+'}})}catch(_){return;}}'+ctx.text(callback.body).slice(1));
 });
 const resolve=ctx.function('resolveEffectiveDDL');
 rewrite(ctx,resolve,(edit,insert)=>{
  const normalized=one(find(resolve,n=>n.type==='VariableDeclarator'&&call(n.init,'normalizeSqlStructure')),'有效 DDL');
  const sheet=ctx.text(resolve.params[0]), ddl=ctx.text(normalized.id);
  const headers=one(find(resolve,n=>n.type==='VariableDeclarator'&&n.init?.type==='ConditionalExpression'&&find(n.init,x=>call(x,'Array.isArray')).length===0&&find(n.init,x=>x.type==='ArrayExpression'&&x.elements[0]?.value==='row_id').length>0),'有效表头');
  edit(normalized.init,'__dshPreserveNativeRetainedColumns_ACU('+sheet+','+ctx.text(normalized.init)+','+ctx.text(headers.id)+',parseDDLColumnInfos_ACU('+ctx.text(normalized.init)+'))');
  const result=one(find(resolve,n=>n.type==='ObjectExpression'&&n.properties.some(p=>key(p)==='source'&&p.value.value==='explicit')),'显式 DDL 结果');
  insert(result.start+1,'dshRetainedColumns:'+ddl+' !== '+ctx.text(normalized.init)+',');
 });
 const matched=ctx.function('reconcileMatchedSheet_ACU');
 rewrite(ctx,matched,(edit)=>{
  const p=matched.params.map(n=>ctx.text(n));
  const before=one(find(matched,n=>n.type==='VariableDeclarator'&&n.init?.type==='ConditionalExpression'&&call(n.init.consequent,'parseDDLColumnInfos_ACU')&&ctx.text(n.init.consequent).includes(p[0]+'.sourceData')),'旧列描述');
  const headers=one(find(matched,n=>n.type==='VariableDeclarator'&&call(n.init,'headers_ACU')&&ctx.text(n.init.arguments[0])===p[0]),'旧表头');
  const parsed=before.init.consequent, original=ctx.text(parsed.arguments[0]);
  edit(parsed,'parseDDLColumnInfos_ACU(__dshPreserveNativeRetainedColumns_ACU('+p[0]+','+original+','+ctx.text(headers.id)+',parseDDLColumnInfos_ACU('+original+')))');
 });
 const reconcile=ctx.function('reconcileChatTemplate_ACU');
 rewrite(ctx,reconcile,(edit,insert)=>{
  const input=ctx.text(reconcile.params[0]);
  const baseline=one(find(reconcile,n=>n.type==='VariableDeclarator'&&n.init?.type==='CallExpression'&&n.init.arguments.some(a=>prop(a,'baselineData'))),'模板基线');
  // The official detector precedes table-name rebinding. Include the final
  // persistent projection when deciding whether that sheet needs a rebase.
  const rebase=one(find(reconcile,n=>n.type==='LogicalExpression'&&n.operator==='&&'&&n.left.type==='CallExpression'&&prop(n.left.callee,'has')&&find(n.right,x=>x.type==='ObjectExpression'&&x.properties.some(p=>key(p)==='kind'&&p.value.value==='rebase')).length>0),'模板 rebase 条件');
  const result=one(find(rebase.right,n=>n.type==='ObjectExpression'&&n.properties.some(p=>key(p)==='kind'&&p.value.value==='rebase')&&n.properties.some(p=>key(p)==='sheetData')),'模板 rebase 数据');
  const sheetKey=ctx.text(result.properties.find(p=>key(p)==='sheetKey').value),sheet=ctx.text(result.properties.find(p=>key(p)==='sheetData').value);
  edit(rebase.left,'('+ctx.text(rebase.left)+' || !templatePersistentProjectionMatches_ACU({['+sheetKey+']:'+ctx.text(baseline.id)+'['+sheetKey+']},{['+sheetKey+']:'+sheet+'}))');
  insert(reconcile.body.start+1,'let __dshStrictRetainedSchema=false;');
  const match=one(find(reconcile,n=>call(n,'reconcileMatchedSheet_ACU')),'匹配表协调');
  const previous=ctx.text(match.arguments[0]);
  // Evaluate before reconciliation; failures still follow the official blocker path.
  edit(match,'(__dshStrictRetainedSchema ||= '+input+'.storageMode !== "native" && parseDDLColumnInfos_ACU(String('+previous+'.sourceData?.ddl || "")).length !== headers_ACU('+previous+').length, '+ctx.text(match)+')');
  const hydrate=one(find(reconcile,n=>call(n,'hydrateTableDataStrict_ACU')),'严格水合');
  const fallback=one(hydrate.arguments[1].properties.filter(p=>key(p)==='allowRuntimeDdlFallback'),'水合 fallback');
  edit(fallback.value,'!__dshStrictRetainedSchema');
 });
 // A proven retained schema must fail visibly rather than discard constraints
 // through the upstream all-TEXT retry.
 const load=one(find(ctx.root,n=>n.type==='MethodDefinition'&&key(n)==='_loadSheet'),'SQLite 加载');
 rewrite(ctx,load,(edit)=>{
  const resolved=one(find(load,n=>n.type==='VariableDeclarator'&&call(n.init,'resolveEffectiveDDL')),'SQLite 有效 DDL');
  const gate=one(find(load,n=>n.type==='IfStatement'&&find(n.test,x=>prop(x,'source')).length>0&&find(n.test,x=>x.type==='Literal'&&x.value==='explicit').length>0),'SQLite fallback 门');
  edit(gate.test,ctx.text(resolved.id)+'.dshRetainedColumns === true || ('+ctx.text(gate.test)+')');
 });
}
