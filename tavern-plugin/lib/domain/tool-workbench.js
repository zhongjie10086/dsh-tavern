import {isDeepStrictEqual} from 'node:util'
import {createHash} from 'node:crypto'

// Interaction model learned from dsh-preset-enhance 9727634: groups, tri-state
// overrides, retained unresolved references, one resolver for schema and execution.
const modes=['card','story','script'],file='tavern-tool-workbench.json'
const own=(value,key)=>Object.hasOwn(value||{},key)?value[key]:undefined
const empty=()=>({version:1,revision:0,groups:[],modes:{}})
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function name(value){if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('工具或分组名称无效');return value}
function switches(value={}) {
  if(!record(value)||Object.keys(value).length>5000)throw Error('工具开关格式无效')
  return Object.fromEntries(Object.entries(value).map(([key,enabled])=>{name(key);if(typeof enabled!=='boolean')throw Error('工具开关必须为开启/关闭；继承时删除覆盖');return [key,enabled]}))
}
export function normalizeToolOverrides(value={}) {
  if(!record(value))throw Error('工具覆盖格式无效')
  return {tools:switches(value.tools),groups:switches(value.groups)}
}
export function normalizeToolWorkbench(value) {
  if(!record(value)||!Array.isArray(value.groups)||value.groups.length>100||!record(value.modes))throw Error('工具工作台格式无效')
  const seen=new Set(),members=new Set()
  const groups=value.groups.map(group=>{
    const id=name(group?.id),title=name(group?.name)
    if(seen.has(id)||!Array.isArray(group.tools)||group.tools.length>2000)throw Error('工具分组重复或成员无效')
    seen.add(id)
    const tools=group.tools.map(tool=>{name(tool);if(members.has(tool))throw Error('一个工具只能属于一个分组：'+tool);members.add(tool);return tool})
    return {id,name:title,tools}
  })
  const policies=Object.fromEntries(Object.entries(value.modes).map(([mode,policy])=>{
    if(!modes.includes(mode))throw Error('未知工具模式：'+mode)
    return [mode,normalizeToolOverrides(policy)]
  }))
  return {version:1,groups,modes:policies}
}
/** Does not grant authority. The host intersects this answer with its existing scope. */
export function toolWorkbenchDecision(shared,local,mode,tool) {
  if(tool==='run_code')return {enabled:true,source:'host'}
  const group=shared.groups?.find(group=>group.tools.includes(tool)),inherited=own(shared.modes,mode)
  for(const [policy,label]of [[local,'local'],[inherited,'mode']]) {
    const direct=own(policy?.tools,tool)
    if(direct!==undefined)return {enabled:direct,source:label+'-tool'}
    const grouped=group&&own(policy?.groups,group.id)
    if(grouped!==undefined&&grouped!==false&&grouped!==true)continue
    if(typeof grouped==='boolean')return {enabled:grouped,source:label+'-group'}
  }
  return {enabled:true,source:'host'}
}
export function toolWorkbenchPackage(shared) {
  const configuration=normalizeToolWorkbench(shared)
  return {format:'dsh-tavern-tool-workbench',version:1,configuration,sha256:hash(configuration)}
}
export function readToolWorkbenchPackage(document) {
  if(document?.format!=='dsh-tavern-tool-workbench'||document.version!==1||document.sha256!==hash(document.configuration))throw Error('工具分享包格式或摘要校验失败')
  return normalizeToolWorkbench(document.configuration)
}
export function createToolWorkbench({store,chatForSession,updateChat,catalog,isBusy}) {
  const read=async()=>await store.readJson(file)||empty()
  async function context(sessionId){const chat=sessionId?await chatForSession(sessionId):null;if(sessionId&&!chat)throw Error('会话不存在');return chat}
  async function view(sessionId,mode) {
    const chat=await context(sessionId),shared=await read(),currentMode=chat?.mode||mode||'story'
    if(!modes.includes(currentMode))throw Error('当前模式没有前台工具工作台')
    const local=chat?.toolWorkbench||{revision:0,tools:{},groups:{}},tools=(await catalog(sessionId)).filter(row=>row.name!=='run_code')
    const known=new Set(tools.map(row=>row.name)),references=new Set([...shared.groups.flatMap(group=>group.tools),...Object.values(shared.modes).flatMap(policy=>Object.keys(policy.tools||{})),...Object.keys(local.tools||{})])
    return {shared,local,mode:currentMode,sessionId:sessionId||null,tools:tools.map(({name,description})=>({name,description,decision:toolWorkbenchDecision(shared,local,currentMode,name)})),unmatched:[...references].filter(name=>!known.has(name)).sort()}
  }
  async function save({sessionId,scope,expectedRevision,configuration,mode}) {
    const chat=await context(sessionId)
    if(scope==='shared') {
      const normalized=normalizeToolWorkbench(configuration)
      if(await isBusy())throw Error('请等待所有游戏生成与结算结束后修改共享工具设置')
      await store.updateJson(file,current=>{
        const before=current||empty()
        if(before.revision!==expectedRevision)throw Error('共享工具设置已变化，请刷新后重试')
        if(isDeepStrictEqual(normalizeToolWorkbench(before),normalized))return undefined
        return {...normalized,revision:before.revision+1}
      })
    }else if(scope==='local'&&chat) {
      const normalized=normalizeToolOverrides(configuration)
      if(await isBusy(chat))throw Error('请等待本局生成与结算结束后修改工具设置')
      await updateChat(chat.id,current=>{
        const before=current.toolWorkbench||{revision:0,tools:{},groups:{}}
        if(before.revision!==expectedRevision)throw Error('本局工具设置已变化，请刷新后重试')
        if(isDeepStrictEqual(normalizeToolOverrides(before),normalized))return current
        current.toolWorkbench={...normalized,revision:before.revision+1};return current
      },{source:'tool-workbench.local'})
    }else throw Error('请选择共享或本局工具设置')
    return view(sessionId,mode)
  }
  async function policy(chat){const shared=await read(),local=structuredClone(chat.toolWorkbench);return name=>toolWorkbenchDecision(shared,local,chat.mode,name).enabled}
  async function preview(document,sessionId,mode) {
    const incoming=readToolWorkbenchPackage(document),current=await view(sessionId,mode),known=new Set(current.tools.map(row=>row.name))
    return {document:toolWorkbenchPackage(incoming),revision:current.shared.revision,groups:incoming.groups.map(group=>{
      const existing=current.shared.groups.find(item=>item.id===group.id)
      return {id:group.id,name:group.name,status:!existing?'new':isDeepStrictEqual(existing,group)?'reused':'mismatch'}
    }),unmatched:[...new Set([...incoming.groups.flatMap(group=>group.tools),...Object.values(incoming.modes).flatMap(policy=>Object.keys(policy.tools))])].filter(name=>!known.has(name)),notice:'导入替换共享工具设置；本局覆盖不变。分享包不包含会话或界面状态。'}
  }
  return {view,save,policy,preview,export:async()=>toolWorkbenchPackage(await read()),import:async args=>save({...args,scope:'shared',configuration:readToolWorkbenchPackage(args.document)})}
}
