import path from 'node:path'
import {lstat,realpath,mkdir} from 'node:fs/promises'
const normalized=value=>process.platform==='win32'?value.toLowerCase():value
export async function safePagePath(root,target,{missing=false,directory=false}={}){
 root=path.resolve(root);target=path.resolve(target)
 const relative=path.relative(root,target)
 if((relative==='..'||relative.startsWith('..'+path.sep))||path.isAbsolute(relative))throw Error('Page path escapes storage root')
 if(normalized(await realpath(root))!==normalized(root))throw Error('Linked page storage root is not safe for GC')
 const parts=relative?relative.split(path.sep):[];let current=root,info=await lstat(root,{bigint:true})
 if(info.isSymbolicLink()||!info.isDirectory())throw Error('Unsafe page storage root')
 for(let index=0;index<parts.length;index++){
  current=path.join(current,parts[index])
  try{info=await lstat(current,{bigint:true})}catch(error){if(missing&&error.code==='ENOENT')return undefined;throw error}
  const expectDirectory=index<parts.length-1||directory
  if(info.isSymbolicLink()||(expectDirectory?!info.isDirectory():!info.isFile()))throw Error('Unsafe page path: '+current)
 }
 return info
}
export const pageIdentity=info=>[info.dev,info.ino,info.size,info.mtimeNs].map(String).join(':')

export async function ensurePageDirectory(root,target){
 await safePagePath(root,root,{directory:true});const relative=path.relative(root,target);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Unsafe page directory')
 let current=root;for(const part of relative.split(path.sep).filter(Boolean)){current=path.join(current,part);try{await safePagePath(root,current,{directory:true})}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(current);await safePagePath(root,current,{directory:true})}}
}
