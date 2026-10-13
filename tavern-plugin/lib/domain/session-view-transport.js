import {regexScriptsOf} from './card-extension-reading.js'
import {isDeepStrictEqual} from 'node:util'
import {diffJson} from './json-mutation.js'
import {immutableJsonSnapshot} from './json-draft.js'
import {jsonBytes,isFrozenJson} from './readonly-json.js'
import {projectionVersion} from './dependency-projection-cache.js'

function compact(view,sharedStrings=false,sharedObjects=false) {
 if(!view)return{view,aliases:{helperSwipes:[],replyText:[]}}
 const aliases={helperSwipes:[],replyText:[]},next={...view}
 if(Array.isArray(view.tavernHelper?.messages))next.tavernHelper={...view.tavernHelper,messages:view.tavernHelper.messages.map((row,index)=>{
  if(typeof row.message!=='string'||row.swipes?.length!==1||row.swipes[0]!==row.message)return row
  aliases.helperSwipes.push(index);return{...row,swipes:[]}
 })}
 if(Array.isArray(view.replyProjections))next.replyProjections=view.replyProjections.map((row,index)=>{
  if(typeof row.text!=='string'||row.parts?.length!==1||row.parts[0].content!==row.text)return row
  aliases.replyText.push(index);const{ text,...rest}=row;return rest
 })
 if(sharedObjects){
  aliases.objects=[]
  function share(target,source,left,right){
   if(left===undefined||!isDeepStrictEqual(left,right))return
   let cursor=next
   for(const key of target.slice(0,-1)){cursor[key]={...cursor[key]};cursor=cursor[key]}
   delete cursor[target.at(-1)];aliases.objects.push([target,source])
  }
  share(['tavernHelperWorldbook'],['tavernHelper','worldbook'],view.tavernHelperWorldbook,view.tavernHelper?.worldbook)
  share(['tavernStatusView'],['tavernStatusViews',0],view.tavernStatusView,view.tavernStatusViews?.[0])
  const raw=view.tavernHelper?.extensionSettings?.regex,global=view.tavernHelper?.regexScripts?.global
  if(Array.isArray(raw)&&isDeepStrictEqual(regexScriptsOf({regex_scripts:raw}),global)){
   next.tavernHelper={...next.tavernHelper,regexScripts:{...next.tavernHelper.regexScripts}};delete next.tavernHelper.regexScripts.global;aliases.globalRegex=true
  }else share(['tavernHelper','extensionSettings','regex'],['tavernHelper','regexScripts','global'],view.tavernHelper?.extensionSettings?.regex,view.tavernHelper?.regexScripts?.global)
 }
 if(sharedStrings){
  const seen=new Map();aliases.strings=[]
  function visit(value,path){
   if(typeof value==='string'&&value.length>=256){
    const first=seen.get(value)
    if(first){aliases.strings.push([path,first]);return null}
    seen.set(value,path);return value
   }
   if(!value||typeof value!=='object')return value
   const out=Array.isArray(value)?[]:{}
   for(const key of Object.keys(value))Object.defineProperty(out,key,{value:visit(value[key],path.concat(Array.isArray(value)?Number(key):key)),enumerable:true,writable:true,configurable:true})
   return out
  }
  return immutableJsonSnapshot({view:visit(next,[]),aliases})
 }
 return immutableJsonSnapshot({view:next,aliases})
}

/** Process-local, session-scoped wire baselines. Eviction always falls back to a full snapshot. */
export function createSessionViewTransport({maxEntries=8,maxBytes=64*1024*1024}={}) {
 const entries=new Map(),encoded=new WeakMap(),encoded3=new WeakMap(),encoded4=new WeakMap();let bytes=0
 function respond(sessionId,view,args={}) {
  const version=projectionVersion(view)
  if(args.ifVersion===version)return{unchanged:true,version}
  const protocol=args.viewProtocol
  if(protocol!==2&&protocol!==3&&protocol!==4)return{view,version}
  const cache=protocol===4?encoded4:protocol===3?encoded3:encoded
  let bundle=isFrozenJson(view)?cache.get(view):null
  if(!bundle){bundle=compact(view,protocol>=3,protocol===4);if(isFrozenJson(view))cache.set(view,bundle)}
  const key=JSON.stringify([sessionId,protocol,version]),base=entries.get(JSON.stringify([sessionId,protocol,args.ifVersion])),size=jsonBytes(bundle)
  let result={...bundle,version,viewEncoding:protocol}
  if(base){const patch={baseVersion:args.ifVersion,changes:diffJson(base.bundle,bundle)};if(jsonBytes(patch)<size)result={patch,version,viewEncoding:protocol}}
  if(size<=maxBytes&&maxEntries>0){const old=entries.get(key);if(old){bytes-=old.size;entries.delete(key)}while(entries.size&&(entries.size>=maxEntries||bytes+size>maxBytes)){const first=entries.keys().next().value;bytes-=entries.get(first).size;entries.delete(first)}entries.set(key,{bundle,size});bytes+=size}
  return result
 }
 return{respond,stats:()=>({entries:entries.size,bytes})}
}
