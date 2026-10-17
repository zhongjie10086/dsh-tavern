import {fetchOriginalExtension,validateOriginalExtension,originalExtensionScript,SP_ORIGINAL_REPOSITORY} from './tavern-original-extension.js'
import {createHash} from 'node:crypto'
import {parse} from 'acorn'
import {safeOutboundFetch} from './outbound-network-policy.js'
import {projectOriginalSp129} from './tavern-original-extension-129.js'
import {immutableJsonSnapshot,mutableJsonDraft} from './json-draft.js'
const clone=structuredClone,hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const SP_EXTENSION_PACKAGE=Object.freeze({format:'dsh-tavern-extension',formatVersion:1,id:'sp-database',name:'SP·数据库',version:'9.2.4-dsh.5',hostApi:'sp-database/1',description:'数据库、填表工作台、召回推进、模板、隔离空间和数据管理。',serverCode:'export default function(host) { return host.createDatabase(); }',updateUrl:''})
export function validateTavernExtension(document){
 if(!document||document.format!=='dsh-tavern-extension'||document.formatVersion!==1)throw new Error('请选择 DSH 适配扩展包；原版 SillyTavern 扩展需移植后打包，不能直接运行。')
 if(document.id!=='sp-database'||document.hostApi!=='sp-database/1')throw new Error('此安装器当前支持 SP 数据库适配器接口 sp-database/1')
 if(typeof document.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(document.version))throw new Error('扩展版本号无效')
 if(typeof document.serverCode!=='string'||!document.serverCode.trim()||document.serverCode.length>2000000)throw new Error('扩展模块为空或超过 2 MB')
 const tree=parse(document.serverCode,{ecmaVersion:'latest',sourceType:'module'});if(!tree.body.some(n=>n.type==='ExportDefaultDeclaration'))throw new Error('扩展需要导出默认工厂函数')
 // The distribution is one bundled ES module; package resolution is not part of this host API.
 function inspect(n){if(!n||typeof n!=='object')return;if(n.type==='ImportDeclaration'||n.type==='ImportExpression'||n.type==='ExportAllDeclaration'||n.type==='ExportNamedDeclaration'&&n.source)throw new Error('扩展必须打包为单个模块，不能引用外部模块');for(const v of Object.values(n))if(Array.isArray(v))v.forEach(inspect);else if(v&&typeof v==='object')inspect(v)}inspect(tree)
 const updateUrl=String(document.updateUrl||'');if(updateUrl){const u=new URL(updateUrl);if(u.protocol!=='https:'||u.username||u.password)throw new Error('更新地址必须是不含凭证的 HTTPS 扩展包地址')}
 const original=document.original?validateOriginalExtension(document.original):null;if(original&&original.manifest.version!==document.version)throw Error('扩展版本与原仓库清单不一致');if(original&&document.serverCode!==SP_EXTENSION_PACKAGE.serverCode)throw Error('原仓库扩展仅在浏览器兼容层执行，不接受附加服务器代码');
 const value={...(original?{original}:{}),format:document.format,formatVersion:1,id:document.id,name:String(document.name||'SP·数据库').slice(0,100),version:document.version,hostApi:document.hostApi,description:String(document.description||'').slice(0,2000),serverCode:document.serverCode,updateUrl};return {...value,digest:hash(value)}
}
/** Installed package code is a server plugin, selected independently from the application release. */
export async function createTavernExtensionRuntime({store,createDatabase,externalBusy=()=>false,assertNativeWrite=null,assertOriginalWrite=()=>{throw Error('当前表格由原版 SP 管理，请使用原版窗口')}}){
 const file='tavern-extensions.json',methods=Object.keys(createDatabase()).filter(key=>!['isActive','prepareMutation'].includes(key)),mutating=new Set(['update','fill','maintenance','inspire','preparePlot','previewPlot','beforeTurn','afterCommit']);let active=0,tail=Promise.resolve(),current,registry,currentOriginal=null
 const builtin=validateTavernExtension(SP_EXTENSION_PACKAGE)
 async function persistPackage(pkg){await store.updateJson('extension-packages/'+pkg.digest+'.json',existing=>existing||pkg)}
 async function instantiate(pkg){const {default:factory}=await import('data:text/javascript;base64,'+Buffer.from(pkg.serverCode).toString('base64')+'#'+pkg.digest);if(typeof factory!=='function')throw new Error('扩展没有默认工厂函数');const instance=await factory(Object.freeze({apiVersion:1,createDatabase}));if(!instance||methods.some(k=>typeof instance[k]!=='function'))throw new Error('扩展未实现完整数据库接口');return instance}
 registry=await store.readJson(file);if(!registry){await persistPackage(builtin);registry={revision:0,installed:{id:builtin.id,name:builtin.name,version:builtin.version,digest:builtin.digest,enabled:true,installedAt:Date.now()},history:[]};await store.writeJson(file,registry)}
 if(registry.installed){const pkg=await store.readJson('extension-packages/'+registry.installed.digest+'.json');currentOriginal=pkg?.original||null;try{current=await instantiate(validateTavernExtension(pkg))}catch(error){registry={...registry,error:'扩展加载失败：'+error.message};current=null}}
 function installed(){return !!registry.installed?.enabled&&!!current}
 function usesOriginal(sessionId){return !!registry.installed?.enabled&&(!!currentOriginal||registry.installed.source==='sillytavern')&&(!registry.installed.scopeSessionId||registry.installed.scopeSessionId===sessionId)}
 function busy(){return active>0||externalBusy()===true}
 const database=new Proxy({}, {get(_target,method){if(method==='then')return undefined;if(method==='isActive')return id=>active>0||(installed()&&current.isActive?.(id)===true);if(method==='prepareMutation')return(...args)=>{if(!usesOriginal(args[0]))throw Error('原版数据库尚未连接');return current.prepareMutation(...args)};if(!methods.includes(method))return undefined;return function(...args){if(!installed()){if(['beforeTurn','afterCommit','preparePlot'].includes(method))return Promise.resolve(null);if(['taskStatus','plotStatus'].includes(method))return null;if(['cancel','cancelPlot','cancelInspiration'].includes(method))return Promise.resolve({cancelled:false});throw new Error('SP·数据库扩展未安装或已停用，请在扩展程序中安装或启用。')}
   if(['beforeTurn','afterCommit','preparePlot'].includes(method)&&usesOriginal(typeof args[0]==='string'?args[0]:args[0]?.sessionId||args[0]?.chat?.sessionId))return Promise.resolve(null);
   if(mutating.has(method)&&usesOriginal(typeof args[0]==='string'?args[0]:args[0]?.sessionId||args[0]?.chat?.sessionId)){return Promise.resolve(assertOriginalWrite(method,args)).then(()=>{const instance=current;active++;return Promise.resolve().then(()=>instance[method](...args)).finally(()=>active--)})}
   const instance=current,tracked=mutating.has(method);if(tracked&&assertNativeWrite){active++;return Promise.resolve().then(()=>assertNativeWrite(method,args)).then(()=>instance[method](...args)).finally(()=>active--)}if(tracked)active++;try{const result=instance[method](...args);if(tracked&&result&&typeof result.then==='function')return result.finally(()=>active--);if(tracked)active--;return result}catch(error){if(tracked)active--;throw error}
 }}})
 function status(){return {revision:registry.revision,installed:clone(registry.installed||null),error:registry.error||'',history:clone(registry.history||[]),builtin:{name:builtin.name,version:builtin.version,digest:builtin.digest},busy:busy()}}
 function preview(document){const pkg=validateTavernExtension(document);return {package:pkg,preview:{id:pkg.id,name:pkg.name,version:pkg.version,digest:pkg.digest,hostApi:pkg.hostApi,description:pkg.description,codeBytes:Buffer.byteLength(pkg.serverCode)+(pkg.original?Object.values(pkg.original.files).reduce((n,f)=>n+Buffer.byteLength(f.text),0):0),...(pkg.original?{source:'sillytavern',repository:pkg.original.repository,commit:pkg.original.commit,files:Object.entries(pkg.original.files).map(([path,f])=>({path,bytes:Buffer.byteLength(f.text),sha256:f.sha256}))}:{}),previousVersion:registry.installed?.version||'',unchanged:pkg.digest===registry.installed?.digest,updateUrl:pkg.updateUrl}}}
 async function change(command,expectedRevision){const work=tail.catch(()=>{}).then(async()=>{
  if(Number(expectedRevision)!==registry.revision)throw new Error('扩展列表已变化，请刷新');if(busy())throw new Error('数据库任务正在执行，请等待结束后更新扩展')
  const previous=registry.installed;let next=clone(registry),candidate=current,candidateOriginal=currentOriginal
  if(command.kind==='install'||command.kind==='restore'){const document=command.kind==='restore'?await store.readJson('extension-packages/'+command.digest+'.json'):command.package,pkg=validateTavernExtension(document);if(command.digest&&pkg.digest!==command.digest)throw new Error('扩展包与预览不一致');if(pkg.original?.manifest.version==='1.2.9')projectOriginalSp129(pkg.original);candidate=await instantiate(pkg);candidateOriginal=pkg.original||null;if(busy())throw new Error('数据库任务已开始，请稍后重试');await persistPackage(pkg);next.installed={id:pkg.id,name:pkg.name,version:pkg.version,digest:pkg.digest,enabled:true,installedAt:Date.now(),updateUrl:pkg.updateUrl,...(pkg.original?{source:'sillytavern',repository:pkg.original.repository,commit:pkg.original.commit,scopeSessionId:String(command.scopeSessionId??previous?.scopeSessionId??'')}: {})}}
  else if(command.kind==='scope'){if(!previous||!currentOriginal)throw new Error('只有已安装的原仓库扩展可以切换试用范围');if(typeof command.scopeSessionId!=='string'||command.scopeSessionId.length>200)throw new Error('扩展试用范围无效');next.installed.scopeSessionId=command.scopeSessionId}
  else if(command.kind==='uninstall'){next.installed=null;candidate=null;candidateOriginal=null}
  else if(command.kind==='toggle'){if(!previous)throw new Error('扩展未安装');if(command.enabled===true&&!current)candidate=await instantiate(validateTavernExtension(await store.readJson('extension-packages/'+previous.digest+'.json')));next.installed.enabled=command.enabled===true}
  else throw new Error('未知扩展管理操作')
  if(previous&&previous.digest!==next.installed?.digest)next.history=[...(registry.history||[]),{...previous,removedAt:Date.now()}].slice(-20)
  delete next.error;next.revision++;await store.updateJson(file,latest=>{if((latest?.revision??0)!==registry.revision)throw new Error('扩展版本已被其他操作修改');return next});registry=next;current=candidate;currentOriginal=candidateOriginal;return {extensions:status()}
 });tail=work;return work}
 async function check(){if(!registry.installed?.updateUrl)return {available:false,message:'此扩展未配置发布者更新地址。可导入新版 DSH 扩展包，或安装当前随附版本。'};const response=await safeOutboundFetch(registry.installed.updateUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('检查更新失败：HTTP '+response.status);let text='',size=0;const decoder=new TextDecoder();for await(const chunk of response.body){size+=chunk.length;if(size>2500000)throw new Error('更新包超过大小限制');text+=decoder.decode(chunk,{stream:true})}text+=decoder.decode();const result=preview(JSON.parse(text));return {available:!result.preview.unchanged,...result}}
 async function checkOriginal(ref='main'){const original=await fetchOriginalExtension(SP_ORIGINAL_REPOSITORY,ref);const result=preview({...SP_EXTENSION_PACKAGE,name:original.manifest.display_name,version:original.manifest.version,description:'从原仓库加载 SP·数据库，通过统一兼容层提供宿主接口。',original});return {available:!result.preview.unchanged,...result}}
 const scriptSnapshots=new WeakMap()
 function scripts(sessionId){
  if(!installed()||!currentOriginal||registry.installed.scopeSessionId&&registry.installed.scopeSessionId!==sessionId)return []
  const script=originalExtensionScript(currentOriginal)
  if(!scriptSnapshots.has(script))scriptSnapshots.set(script,immutableJsonSnapshot([script]))
  return mutableJsonDraft(scriptSnapshots.get(script))
 }
 return {database,readCache:sessionId=>createDatabase().read(sessionId),status,installed,usesOriginal,preview,change,check,checkOriginal,scripts,builtin:()=>clone(builtin),export:async()=>registry.installed?await store.readJson('extension-packages/'+registry.installed.digest+'.json'):clone(builtin)}
}
