import {createHash} from 'node:crypto'
// Scheduling analysis only. No inferred role ever grants permission to skip failed validation.
import { parse } from 'acorn'

function analyzeSource(source) {
  let tree
  try { tree = parse(String(source), {ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true}) }
  catch { return {version:1,requiresCore:true,coreStart:'attempt',validation:false,dependsOnMvu:false,analyzed:false,unknown:['parse-failed']} }
  const scopes = new WeakMap(), parents = new WeakMap(), rows = [], assignments = []
  const scope = (parent, functional=false) => ({parent,functional,bindings:new Map()})
  const root = scope(null,true)
  const find = (current,name) => {for(let at=current;at;at=at.parent)if(at.bindings.has(name))return at.bindings.get(name)}
  function declare(pattern,current) {
    if(!pattern)return
    if(pattern.type==='Identifier'){if(!current.bindings.has(pattern.name))current.bindings.set(pattern.name,{types:new Set()});return}
    if(pattern.type==='RestElement')declare(pattern.argument,current)
    else if(pattern.type==='AssignmentPattern')declare(pattern.left,current)
    else if(pattern.type==='ArrayPattern')pattern.elements.forEach(value=>declare(value,current))
    else if(pattern.type==='ObjectPattern')pattern.properties.forEach(value=>declare(value.type==='RestElement'?value.argument:value.value,current))
  }
  function visit(node,current,parent) {
    if(!node||typeof node!=='object'||!node.type)return
    if(node.type==='FunctionDeclaration'||node.type==='ClassDeclaration')declare(node.id,current)
    if(/Function(?:Expression|Declaration)$/.test(node.type)){
      current=scope(current,true);declare(node.id,current);node.params.forEach(param=>declare(param,current))
    }else if(['BlockStatement','CatchClause','ForStatement','ForOfStatement','ForInStatement','SwitchStatement','ClassExpression','ClassDeclaration'].includes(node.type)){
      current=scope(current);if(node.type==='CatchClause')declare(node.param,current)
      if(node.type.startsWith('Class'))declare(node.id,current)
    }
    scopes.set(node,current);parents.set(node,parent);rows.push(node)
    if(node.type==='VariableDeclaration'){
      let target=current;if(node.kind==='var')while(target.parent&&!target.functional)target=target.parent
      for(const declaration of node.declarations){declare(declaration.id,target);assignments.push({pattern:declaration.id,value:declaration.init,current:target})}
    }
    if(node.type==='ImportDeclaration')node.specifiers.forEach(item=>declare(item.local,current))
    if(node.type==='AssignmentExpression')assignments.push({pattern:node.left,value:node.right,current})
    for(const value of Object.values(node)){
      if(Array.isArray(value))value.forEach(child=>visit(child,current,node))
      else if(value?.type)visit(value,current,node)
    }
  }
  visit(tree,root)
  const staticProperty = node => node?.computed ? node.property?.type==='Literal'?String(node.property.value):null : node?.property?.name
  let requiresCore=false,validation=false,dependsOnMvu=false; const unknown=new Set()
  function property(types,name) {
    if(types.has('global')&&name==='Mvu'){dependsOnMvu=true;return new Set(['mvu'])}
    if(types.has('mvu')&&name==='events'){requiresCore=true;validation=true;return new Set(['events'])}
    if(types.has('events'))return new Set(['event'])
    if(types.has('global')&&['eval','Function'].includes(name))return new Set(['code']);
    if(types.has('global')&&name==='Reflect')return new Set(['reflect']);
    if(types.has('global')&&name==='Object')return new Set(['object']);
    if(types.has('reflect')&&['get','getOwnPropertyDescriptor'].includes(name)||types.has('object')&&['getOwnPropertyDescriptor','getOwnPropertyDescriptors'].includes(name))return new Set(['reflect-read']);
    if(types.has('code')&&['bind','call','apply'].includes(name))return new Set(['code']);
    if(types.has('global')&&name==='waitGlobalInitialized')return new Set(['wait'])
    if(types.has('global')&&['eventOn','eventOnce','eventMakeFirst','eventMakeLast'].includes(name))return new Set(['register'])
    return new Set()
  }
  function types(node) {
    if(!node)return new Set()
    if(node.type==='Identifier'){
      const parent=parents.get(node);
      if(parent?.type==='MemberExpression' && parent.property===node && !parent.computed)return new Set();
      if(['Property','MethodDefinition','PropertyDefinition'].includes(parent?.type) && parent.key===node && !parent.computed && !parent.shorthand)return new Set();
      if(['LabeledStatement','BreakStatement','ContinueStatement'].includes(parent?.type) && parent.label===node)return new Set();
      const bound=find(scopes.get(node),node.name)
      if(bound)return bound.types
      if(node.name==='Mvu'){dependsOnMvu=true;return new Set(['mvu'])}
      if(['window','globalThis','self'].includes(node.name))return new Set(['global'])
      if(['eval','Function'].includes(node.name))return new Set(['code']);
      if(node.name==='Reflect')return new Set(['reflect']);
      if(node.name==='Object')return new Set(['object']);
      if(node.name==='waitGlobalInitialized')return new Set(['wait'])
      if(['eventOn','eventOnce','eventMakeFirst','eventMakeLast'].includes(node.name))return new Set(['register'])
    }
    if(node.type==='MemberExpression')return property(types(node.object),staticProperty(node))
    if(node.type==='ChainExpression')return types(node.expression)
    if(node.type==='AwaitExpression')return types(node.argument)
    if(node.type==='AssignmentExpression')return types(node.right)
    if(node.type==='SequenceExpression')return types(node.expressions.at(-1))
    if(node.type==='ConditionalExpression')return new Set([...types(node.consequent),...types(node.alternate)])
    if(node.type==='LogicalExpression')return new Set([...types(node.left),...types(node.right)])
    if(node.type==='CallExpression'){
      const callee=types(node.callee),argument=node.arguments[0]
      if(callee.has('reflect-read')){
        const target=types(argument),key=node.arguments[1];
        if(target.has('global')||target.has('mvu')||target.has('events')){
          unknown.add('reflective-global-read');
          return property(target,key?.type==='Literal'?String(key.value):null);
        }
      }
      if(callee.has('code'))return new Set(['code']);
      if(callee.has('wait')&&argument?.type==='Literal'&&argument.value==='Mvu'){dependsOnMvu=true;return new Set(['mvu'])}
      if(callee.has('register')){
        if(types(argument).has('event'))validation=true
        if(argument?.type==='Literal'&&/^mag_(?:variable_|command_parsed|before_message_update)/.test(String(argument.value)))validation=true
      }
    }
    return new Set()
  }
  function assign(pattern,value,current) {
    if(!pattern)return false
    if(pattern.type==='Identifier'){
      const bound=find(current,pattern.name);if(!bound)return false
      let changed=false;for(const type of value)if(!bound.types.has(type)){bound.types.add(type);changed=true}return changed
    }
    if(pattern.type==='AssignmentPattern')return assign(pattern.left,value,current)
    if(pattern.type==='ObjectPattern'){
      let changed=false
      for(const item of pattern.properties){
        if(item.type==='RestElement')continue
        const key=item.computed?item.key.type==='Literal'?String(item.key.value):null:item.key.name??String(item.key.value)
        changed=assign(item.value,property(value,key),current)||changed
      }
      return changed
    }
    return false
  }
  // Finite monotone aliases: each binding can gain only the fixed abstract types.
  // No executable source is evaluated by the analysis.
  for(let pass=0;pass<=assignments.length;pass++){
    let changed=false
    for(const row of assignments)changed=assign(row.pattern,types(row.value),row.current)||changed
    if(!changed)break
  }
  rows.forEach(types)
  for(const node of rows) {
    // Acquiring a code evaluator is already an unknown boundary: it can escape,
    // be rebound, or be invoked by code not represented in this source graph.
    if(types(node).has('code'))unknown.add('runtime-code');
    if(types(node).has('reflect-read'))unknown.add('reflective-read');
    if(['ImportDeclaration','ExportAllDeclaration'].includes(node.type)||node.type==='ExportNamedDeclaration'&&node.source||node.type==='ImportExpression')unknown.add('module-graph');
    if(['CallExpression','NewExpression'].includes(node.type)&&types(node.callee).has('code'))unknown.add('runtime-code');
    if(['CallExpression','NewExpression'].includes(node.type)&&node.callee?.type==='Identifier'&&['eval','Function'].includes(node.callee.name)&&!find(scopes.get(node.callee),node.callee.name))unknown.add('runtime-code');
    if(node.type==='MemberExpression'&&node.computed&&node.property?.type!=='Literal'&&types(node.object).has('global'))unknown.add('runtime-global-property');
    if(node.type==='CallExpression'&&node.callee?.type==='MemberExpression'&&staticProperty(node.callee)==='createElement'&&node.arguments[0]?.value==='script')unknown.add('runtime-script-element');
    if(['CallExpression','NewExpression'].includes(node.type)&&node.callee?.type==='MemberExpression'&&['eval','Function'].includes(staticProperty(node.callee))&&types(node.callee.object).has('global'))unknown.add('runtime-code');
  }
  // R8 Z86: a confirmed validator waits for a ready core. A script whose role is
  // unknown only waits for this core attempt to end (ready or failed), as in the
  // original helper where it loads beside MVU; a failed core still pauses settlement.
  return {version:1,requiresCore:requiresCore||unknown.size>0,...(!requiresCore&&!validation&&unknown.size>0?{coreStart:'attempt'}:{}),validation,dependsOnMvu,analyzed:true,unknown:[...unknown]}
}

// The entire graph is gated before its entry script element is inserted. Static
// imports execute before the entry body; injecting an await into that body is
// insufficient. Missing/dynamic graphs stay unknown and never imply optionality.
const cache=new Map();let cacheBytes=0;
export function analyzeMvuInitialization(source) {
  source=String(source||'');
  if(cache.has(source))return structuredClone(cache.get(source).plan);
  const digest=createHash('sha256').update(source).digest('hex');
  let analysis;
  try{analysis=analyzeSource(source)}catch{analysis={version:1,requiresCore:true,coreStart:'attempt',validation:false,dependsOnMvu:false,analyzed:false,unknown:['analysis-failed']}}
  const plan={...analysis,sourceDigest:digest};
  const bytes=Buffer.byteLength(source);
  if(bytes<=16*1024*1024){
    while(cache.size&&(cache.size>=128||cacheBytes+bytes>16*1024*1024)){const [key,row]=cache.entries().next().value;cache.delete(key);cacheBytes-=row.bytes;}
    cache.set(source,{plan,bytes});cacheBytes+=bytes;
  }
  return structuredClone(plan);
}
export function prepareMvuScriptStartup(script) {
  if(['official-mvu','card-mvu'].includes(script?.system))return {...script,mvuSourceDigest:script.sourceDigest||createHash('sha256').update(String(script.content||'')).digest('hex')};
  if(typeof script?.content==='string'&&script.content.length)return {...script,mvuInitialization:analyzeMvuInitialization(script.content)};
  const plan=script?.mvuInitialization;
  if(script?.sourceDigest&&plan?.version===1&&plan.sourceDigest===script.sourceDigest)return script;
  return {...script,mvuInitialization:{version:1,requiresCore:true,coreStart:'attempt',validation:false,dependsOnMvu:false,analyzed:false,unknown:['source-unavailable']}};
}
export function prepareMvuStartupView(view) {
  if(!view||!Array.isArray(view.tavernHelperScripts))return view;
  return {...view,tavernHelperScripts:view.tavernHelperScripts.map(prepareMvuScriptStartup)};
}
