import {createHash} from 'node:crypto';
import {createScriptRecordBudget,scriptStorageLimits,storedJsonBytes} from './script-storage-budget.js';
const prefix='/user/images/unified-statusbar/';
function keyOf(value){const path=String(value||'').replace(/^\/?/,'/');if(!path.startsWith(prefix)||/[\\?#\x00-\x1f]/.test(path))throw new Error('图片路径无效');const match=/^([^/]+)-([a-f0-9]{64})\.(png|jpg|jpeg|gif|webp)$/.exec(path.slice(prefix.length));if(!match)throw new Error('图片路径无效');return match[2]}
function validateImage(data,format){const buf=Buffer.from(data,'base64');const valid=format==='png'?buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['jpg','jpeg'].includes(format)?buf[0]===255&&buf[1]===216&&buf[2]===255:format==='gif'?/^GIF8[79]a$/.test(buf.toString('ascii',0,6)):format==='webp'?buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP':false;if(!valid)throw new Error('图片内容与格式不符');return buf}
export function createTavernScriptImages({store,assertOwner,limits=scriptStorageLimits.images}){
 const budget=createScriptRecordBudget({store,directory:'script-images',limits,label:'脚本图片'});
 async function read(path){const id=keyOf(path),value=await store.readJson('script-images/'+id+'.json');if(!value)return null;return {...value,body:Buffer.from(value.data,'base64')}}
 async function perform(sessionId,operation,owner,lifecycle){await assertOwner(sessionId,owner,lifecycle);if(operation.kind==='upload'){
  const format=String(operation.format||'png').toLowerCase(),data=String(operation.image||'').replace(/\s/g,'');if(!data||data.length>32_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))throw new Error('图片为空或超过 24MB');const bytes=validateImage(data,format),id=createHash('sha256').update(owner+'\n'+String(operation.filename)+'\n').update(bytes).digest('hex');const name=String(operation.filename||'image').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,150)||'image';const path=prefix+name+'-'+id+'.'+format,mediaType='image/'+(['jpg','jpeg'].includes(format)?'jpeg':format);
  const record={owner,path,mediaType,data:bytes.toString('base64'),at:Date.now()},guard=()=>assertOwner(sessionId,owner,lifecycle);
  return budget.run(id,owner,storedJsonBytes(record),async()=>{const saved=await store.updateJson('script-images/'+id+'.json',async previous=>{await guard();if(previous&&previous.owner!==owner)throw new Error('图片不属于当前脚本');return previous?undefined:record});return{path:saved.path}},guard);
 }
 if(operation.kind==='delete'){const id=keyOf(operation.path),guard=()=>assertOwner(sessionId,owner,lifecycle);await budget.remove(id,owner,async()=>{const saved=await read(operation.path);if(saved&&saved.owner!==owner)throw new Error('图片不属于当前脚本');await guard();await store.remove('script-images/'+id+'.json')},guard);return {success:true}}
 throw new Error('图片操作无效')
 }
 return{perform,read}
}
