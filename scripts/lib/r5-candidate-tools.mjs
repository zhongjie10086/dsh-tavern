// Preparation only: no service control, downloads, production links or Home writes.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {chmod,copyFile,lstat,mkdir,readFile,readdir,realpath,symlink,writeFile} from 'node:fs/promises'
import path from 'node:path'

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function fileHash(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex')}
export const inside=(root,target)=>{const rel=path.relative(root,target);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))}
export function safeRelative(value){
 assert(typeof value==='string'&&value&&!value.includes('\\')&&!value.includes(':')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe relative path: '+value)
 return value
}
async function linkedComponent(absolute){
 const parsed=path.parse(absolute);let current=parsed.root
 for(const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  current=path.join(current,part)
  if((await lstat(current)).isSymbolicLink())return current
 }
 return null
}
// Returns the canonical spelling. A real link/junction anywhere on the path is
// rejected and named. On Windows the file system is case-insensitive and may
// expose 8.3 aliases, so a different spelling of the same plain directory is
// accepted and replaced by the canonical path; POSIX keeps exact equality.
export async function plainRoot(input){
 const root=path.resolve(input),real=await realpath(root)
 if(real!==root){
  const link=await linkedComponent(root)
  assert(!link,'Root and its ancestors must not be symbolic links or junctions: '+link)
  assert(process.platform==='win32','Root path is not canonical: '+root+' resolves to '+real)
 }
 assert((await lstat(real)).isDirectory(),'Expected a directory')
 return real
}
export async function newOutput(input,protectedRoots=[]){
 const resolved=path.resolve(input),name=path.basename(resolved)
 assert(name&&name!=='.'&&name!=='..'&&path.dirname(resolved)!==resolved,'Output must be a new named directory')
 const output=path.join(await plainRoot(path.dirname(resolved)),name)
 for(const root of protectedRoots)assert(!inside(root,output)&&!inside(output,root),'Output must be separate from every input')
 await mkdir(output,{mode:0o700}) // Exclusive: existing evidence is never reused or overwritten.
 return output
}
export async function jsonFile(file,value){await writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})}
export async function inventory(root,{allowLinks=false,exclude=[]}={}){
 root=await plainRoot(root);const rows=[]
 async function visit(relative){
  for(const name of (await readdir(path.join(root,relative))).sort()){
   const rel=safeRelative(relative?relative+'/'+name:name);if(exclude.includes(rel))continue
   const file=path.join(root,rel),info=await lstat(file)
   if(info.isSymbolicLink()){
    assert(allowLinks,'Symbolic link/junction not permitted: '+rel)
    const target=await realpath(file);assert(inside(root,target),'External symbolic link: '+rel)
    rows.push({path:rel,type:'link',target:path.relative(root,target).split(path.sep).join('/')})
   }else if(info.isDirectory()){rows.push({path:rel,type:'directory'});await visit(rel)}
   else if(info.isFile())rows.push({path:rel,type:'file',bytes:info.size,sha256:await fileHash(file),executable:!!(info.mode&0o111)})
   else assert.fail('Unsupported special file: '+rel)
  }
 }
 await visit('');return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)
}
// Full-Home inventory: links/junctions are recorded and never followed. A link is
// accepted only when its final target is inside the Home itself, or inside one of
// the explicitly declared external roots (fixed dependency/code trees). Anything
// else, including a dangling link, fails closed and names the link.
export async function homeInventory(input,{externalLinkRoots=[]}={}){
 const root=await plainRoot(input),external=[],files=[],links=[]
 for(const value of externalLinkRoots){const declared=await plainRoot(value);assert(!inside(root,declared)&&!inside(declared,root),'Declared external link root must be outside the Home: '+declared);external.push(declared)}
 async function visit(relative){
  for(const name of (await readdir(path.join(root,relative))).sort()){
   const rel=safeRelative(relative?relative+'/'+name:name),file=path.join(root,rel),info=await lstat(file)
   if(info.isSymbolicLink()){
    let target;try{target=await realpath(file)}catch(error){assert.fail('Dangling symbolic link/junction: '+rel+' ('+(error.code||error.message)+')')}
    const targetType=(await lstat(target)).isDirectory()?'directory':'file'
    if(inside(root,target)){
     assert(target!==root,'Symbolic link/junction to the Home root is not supported: '+rel)
     links.push({path:rel,type:'link',scope:'internal',target:path.relative(root,target).split(path.sep).join('/'),targetType})
    }else{
     assert(external.some(owner=>inside(owner,target)),'Symbolic link/junction escapes the Home: '+rel+' -> '+target+' (declare its fixed dependency root as an external link root, or use an offline copy without this link)')
     links.push({path:rel,type:'link',scope:'external',target,targetType})
    }
   }else if(info.isDirectory()){files.push({path:rel,type:'directory'});await visit(rel)}
   else if(info.isFile())files.push({path:rel,type:'file',bytes:info.size,sha256:await fileHash(file),executable:!!(info.mode&0o111)})
   else assert.fail('Unsupported special file: '+rel)
  }
 }
 await visit('');const order=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0
 return {root,externalLinkRoots:external,files:files.sort(order),links:links.sort(order)}
}
export async function copyInventory(source,target,rows){
 for(const row of rows){
  safeRelative(row.path);const file=path.join(target,row.path)
  if(row.type==='directory')await mkdir(file,{recursive:true,mode:0o700})
  else if(row.type==='file'){
   await mkdir(path.dirname(file),{recursive:true,mode:0o700});await copyFile(path.join(source,row.path),file,1)
   if(process.platform!=='win32')await chmod(file,row.executable?0o700:0o600)
   assert.equal(await fileHash(file),row.sha256,'Input changed while copying: '+row.path)
  }else assert.fail('Copy requires regular files and directories')
 }
}
function git(root,...args){return execFileSync('git',['-c','core.quotepath=false',...args],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024})}
async function trackedSource(root){
 // Never let Git walk upwards from an exported candidate/source directory.
 assert(await lstat(path.join(root,'.git')).catch(()=>false),'Execution/source root must own its Git metadata')
 assert.equal(await realpath(git(root,'rev-parse','--show-toplevel').trim()),root,'Git root must equal the explicit source root')
 assert.equal(git(root,'status','--porcelain','--untracked-files=all').trim(),'','Commit the complete candidate first; source must be clean')
 const commit=git(root,'rev-parse','HEAD').trim(),rows=git(root,'ls-tree','-r','-z',commit).split('\0').filter(Boolean).map(line=>{
  const at=line.indexOf('\t'),[mode,type,object]=line.slice(0,at).split(' '),name=safeRelative(line.slice(at+1))
  assert(type==='blob'&&['100644','100755'].includes(mode),'Source symlinks/submodules are not supported: '+name)
  assert(!name.split('/').includes('node_modules'),'Dependencies must be inventoried separately')
  return {path:name,mode,object}
 })
 return {commit,rows}
}
async function dependencyState(root){
 const rows=[]
 async function visit(relative){for(const name of (await readdir(path.join(root,relative))).sort()){
  const rel=safeRelative(relative?relative+'/'+name:name),file=path.join(root,rel),info=await lstat(file)
  if(info.isSymbolicLink())rows.push({path:rel,type:'link',target:await realpath(file)})
  else if(info.isDirectory()){rows.push({path:rel,type:'directory'});await visit(rel)}
  else if(info.isFile())rows.push({path:rel,type:'file',sha256:await fileHash(file),bytes:info.size,executable:!!(info.mode&0o111)})
  else assert.fail('Unsupported dependency file: '+rel)
 }}
 await visit('');return rows
}
const mounts={workspace:'source/node_modules',plugin:'source/tavern-plugin/node_modules',kernel:'runtime/node_modules'}
const requirements={kernelRequired:'0.1.5-rc.2',playwrightRequired:'1.62.1'}
async function dependencyVersions(root,roots,files){
 const versions=[],packages={'@deepseek-ai/dsh':requirements.kernelRequired,'playwright-core':requirements.playwrightRequired}
 for(const {label,mount} of roots){
  assert(Object.hasOwn(mounts,label)&&mount===mounts[label],'Invalid dependency root declaration')
  for(const [name,required] of Object.entries(packages)){
   const direct=mount+'/'+name+'/package.json',candidates=new Set(files.filter(row=>row.type==='file'&&row.path.startsWith(mount+'/')&&row.path.endsWith('/'+name+'/package.json')).map(row=>row.path))
   const info=await lstat(path.join(root,direct)).catch(error=>{if(error.code!=='ENOENT')throw error})
   if(info)candidates.add(direct)
   if(label==='kernel'&&name==='@deepseek-ai/dsh'||label==='workspace'&&name==='playwright-core')assert(info,'Dependency '+label+' requires '+name+'/package.json')
   for(const relative of [...candidates].sort()){
    const actual=await realpath(path.join(root,relative));assert(inside(root,actual),'Dependency package escapes candidate')
    assert((await lstat(actual)).isFile(),'Dependency package metadata must be a regular file')
    const value=JSON.parse(await readFile(actual,'utf8'))
    assert.equal(value.name,name,'Dependency package name mismatch: '+relative)
    assert.equal(value.version,required,'Dependency version mismatch: '+relative+' requires '+required)
    versions.push({label,name,version:value.version,path:relative,packageSha256:await fileHash(actual)})
   }
  }
 }
 return versions
}
export async function buildCandidate({sourceRoot,output,sourceKind,sourceLabel,sourceArchiveSha256,dependencies={},storageFormat=3}){
 assert([3,4,5].includes(storageFormat),'Unsupported storage format')
 assert(['uploaded-source-snapshot','original-repository'].includes(sourceKind),'Explicit sourceKind required')
 assert(typeof sourceLabel==='string'&&sourceLabel.trim(),'Explicit sourceLabel required')
 if(sourceArchiveSha256!==undefined)assert(/^[a-f0-9]{64}$/.test(sourceArchiveSha256),'Invalid source archive hash')
 const source=await plainRoot(sourceRoot),tracked=await trackedSource(source),roots=[]
 for(const [label,input] of Object.entries(dependencies)){
  assert(Object.hasOwn(mounts,label),'Unknown dependency root: '+label)
  roots.push({label,root:await plainRoot(input),mount:mounts[label]})
 }
 for(const row of roots)row.before=await dependencyState(row.root)
 const destination=await newOutput(output,[source,...roots.map(row=>row.root)])
 const stage=path.join(destination,'source');await mkdir(stage)
 const sourceRows=[]
 for(const row of tracked.rows){
  let component=source
  for(const part of row.path.split('/')){component=path.join(component,part);assert(!(await lstat(component)).isSymbolicLink(),'Source link or junction not supported: '+row.path)}
  const file=path.join(source,row.path),info=await lstat(file)
  assert(info.isFile()&&!info.isSymbolicLink(),'Source changed type: '+row.path)
  // Clean status may use a stale stat cache or assume-unchanged. Verify the actual
  // bytes against the committed blob, including any configured clean filters.
  assert.equal(git(source,'hash-object','--path='+row.path,'--',row.path).trim(),row.object,'Source differs from committed blob: '+row.path)
  sourceRows.push({path:row.path,type:'file',bytes:info.size,sha256:await fileHash(file),executable:row.mode==='100755'})
 }
 await copyInventory(source,stage,sourceRows)
 const dependencyLinks=[]
 // Dependencies are copied, never hardlinked/junctioned back to a mutable tree.
 for(const row of roots){
  const target=path.join(destination,row.mount);await mkdir(target,{recursive:true})
  async function copy(relative){
   for(const name of (await readdir(path.join(row.root,relative))).sort()){
    const rel=safeRelative(relative?relative+'/'+name:name),input=path.join(row.root,rel),dest=path.join(target,rel),info=await lstat(input)
    if(info.isSymbolicLink()){
     const resolved=await realpath(input),mapping=[...roots.map(r=>({root:r.root,mount:r.mount})),{root:source,mount:'source'}].sort((a,b)=>b.root.length-a.root.length).find(r=>inside(r.root,resolved))
     assert(mapping,'Dependency link escapes fixed inputs: '+row.label+'/'+rel)
     const mapped=path.join(destination,mapping.mount,path.relative(mapping.root,resolved))
     dependencyLinks.push({path:dest,target:mapped,directory:(await lstat(resolved)).isDirectory()})
    }else if(info.isDirectory()){await mkdir(dest);await copy(rel)}
    else if(info.isFile()){
     const before=await fileHash(input);await copyFile(input,dest,1)
     assert.equal(await fileHash(dest),before,'Dependency changed while copying: '+rel)
     assert.equal(await fileHash(input),before,'Dependency changed while copying: '+rel)
     if(process.platform!=='win32')await chmod(dest,info.mode&0o111?0o700:0o600)
    }else assert.fail('Unsupported dependency file: '+rel)
   }
  }
  await copy('')
 }
 for(const link of dependencyLinks){
  assert(inside(destination,link.target),'Dependency link escapes candidate')
  await lstat(link.target) // Missing/ignored source targets cannot silently escape the manifest.
  await symlink(path.relative(path.dirname(link.path),link.target),link.path,link.directory?'junction':'file')
 }
 assert.equal(git(source,'rev-parse','HEAD').trim(),tracked.commit,'HEAD changed during build')
 assert.equal(git(source,'status','--porcelain','--untracked-files=all').trim(),'','Source changed during build')
 for(const row of sourceRows)assert.equal(await fileHash(path.join(source,row.path)),row.sha256,'Source changed during build: '+row.path)
 for(const row of roots)assert.deepEqual(await dependencyState(row.root),row.before,'Dependency tree changed during build: '+row.label)
 const files=await inventory(destination,{allowLinks:true})
 const dependencyRoots=roots.map(({label,mount})=>({label,mount})),observedVersions=await dependencyVersions(destination,dependencyRoots,files)
 const manifest={version:1,kind:'dsh-r5-fixed-candidate',provenance:{sourceKind,sourceLabel,...sourceArchiveSha256?{sourceArchiveSha256}:{},candidateCommit:tracked.commit,historicalRepositoryVerified:false},
  storageFormat,...requirements,dependencyRoots,dependencyVersions:observedVersions,files,
  scope:'Fixed source and explicitly supplied dependency copies; no downloads, Home backup, native acceptance or production deployment',productionModified:false,
  acceptance:{nativeRuntime:'not-run',browserRuntime:'not-run',realHomeRestore:'not-run',oldCodeRollback:'not-run',firstOpen:'not-run'}}
 await jsonFile(path.join(destination,'manifest.json'),manifest)
 return {output:destination,manifestSha256:await fileHash(path.join(destination,'manifest.json')),files:files.filter(r=>r.type==='file').length,provenance:manifest.provenance,acceptance:manifest.acceptance}
}
// A deployment candidate must carry every dependency root (workspace, plugin,
// kernel). A source-only review package verifies only with the explicit
// allowIncompleteDependencies opt-in, and the result says what is missing.
export async function verifyCandidate({candidate,manifestSha256,allowIncompleteDependencies=false}){
 const root=await plainRoot(candidate),manifestPath=path.join(root,'manifest.json')
 assert(/^[a-f0-9]{64}$/.test(manifestSha256||''),'Supply the independently retained manifest SHA-256')
 assert((await lstat(manifestPath)).isFile()&&!(await lstat(manifestPath)).isSymbolicLink(),'Manifest must be a regular file')
 assert.equal(await fileHash(manifestPath),manifestSha256,'Candidate manifest hash mismatch')
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
 assert(manifest.version===1&&manifest.kind==='dsh-r5-fixed-candidate'&&Array.isArray(manifest.files),'Unsupported candidate manifest')
 assert([3,4,5].includes(manifest.storageFormat),'Unsupported storage format')
 if(manifest.storageFormat>=4)for(const file of ['tavern-plugin/lib/domain/chat-records-store.js','tavern-plugin/lib/domain/page-chat-records.js','tavern-plugin/lib/domain/page-chat-migration.js','scripts/lib/r16-page-home-rehearsal.mjs','scripts/lib/r16-page-home-verification.mjs','bin/migrate-page-storage.mjs'])assert(manifest.files.some(row=>row.path==='source/'+file&&row.type==='file'),'Format4 candidate lacks adapter/migration/recovery reader: '+file)
 if(manifest.storageFormat===5)for(const file of ['tavern-plugin/lib/domain/page-retention.js','tavern-plugin/lib/domain/page-retention-upgrade.js','tavern-plugin/lib/domain/page-process-activity.js','tavern-plugin/lib/domain/page-path-safety.js','tavern-plugin/lib/domain/maintenance-gate.js'])assert(manifest.files.some(row=>row.path==='source/'+file&&row.type==='file'),'Format5 candidate lacks retention/lease reader: '+file)
 for(const [key,value]of Object.entries(requirements))assert.equal(manifest[key],value,'Candidate requirement mismatch: '+key)
 assert(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(manifest.provenance?.candidateCommit||''),'Candidate source commit is missing or malformed')
 assert(Array.isArray(manifest.dependencyRoots),'Missing dependency root declarations')
 assert.equal(new Set(manifest.dependencyRoots.map(row=>row.label)).size,manifest.dependencyRoots.length,'Duplicate dependency roots')
 for(const row of manifest.files)safeRelative(row.path)
 assert.equal(new Set(manifest.files.map(row=>row.path)).size,manifest.files.length,'Duplicate manifest paths')
 const actual=await inventory(root,{allowLinks:true,exclude:['manifest.json']})
 assert.deepEqual(actual,manifest.files,'Candidate integrity mismatch (missing, added, changed or external-linked files)')
 for(const [label,mount]of Object.entries(mounts))assert.equal(actual.some(row=>row.path===mount),manifest.dependencyRoots.some(row=>row.label===label&&row.mount===mount),'Dependency mount declaration mismatch: '+label)
 const versions=await dependencyVersions(root,manifest.dependencyRoots,actual)
 if(manifest.dependencyVersions!==undefined)assert.deepEqual(versions,manifest.dependencyVersions,'Dependency version proof mismatch')
 const missingDependencyRoots=Object.keys(mounts).filter(label=>!manifest.dependencyRoots.some(row=>row.label===label))
 assert(allowIncompleteDependencies===true||!missingDependencyRoots.length,'Candidate is missing dependency roots: '+missingDependencyRoots.join(', ')+' (a deployment candidate needs workspace, plugin and kernel; only a source-only review package may opt in to incomplete dependencies)')
 return {verified:true,manifestSha256,sourceCommit:manifest.provenance.candidateCommit,dependencyVersions:versions,dependencyRootsComplete:!missingDependencyRoots.length,missingDependencyRoots,files:actual.filter(row=>row.type==='file').length,acceptance:manifest.acceptance}
}
// executionRoot comes from the running module's import.meta.url, never a CLI
// claim. A manifest outside the process cannot bless unrelated loaded code.
export async function verifyExecutionIdentity({candidate,manifestSha256,executionRoot,executionMode='candidate',entrypoint,requireCompleteDependencies=false}){
 assert(typeof candidate==='string'&&candidate,'Explicit verified candidate identity required')
 assert(['candidate','git-workspace'].includes(executionMode),'Unsupported execution identity mode')
 const verified=await verifyCandidate({candidate,manifestSha256,allowIncompleteDependencies:requireCompleteDependencies!==true}),root=await plainRoot(candidate),source=await plainRoot(executionRoot),cwd=await plainRoot(process.cwd())
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'))
 let repositoryHead=null
 if(executionMode==='candidate'){
  assert.equal(source,path.join(root,'source'),'Execute the recovery code from the verified candidate/source directory')
  assert(inside(root,cwd),'Run the rehearsal inside the verified candidate directory')
 }else{
  assert(inside(source,cwd),'Run the rehearsal inside the verified Git workspace')
  const tracked=await trackedSource(source);repositoryHead=tracked.commit
  assert.equal(repositoryHead,verified.sourceCommit,'Running Git HEAD differs from candidate source commit')
  const expected=manifest.files.filter(row=>row.type==='file'&&row.path.startsWith('source/')&&!row.path.split('/').includes('node_modules')).map(row=>({...row,path:row.path.slice(7)}))
  const actual=[]
  for(const row of tracked.rows){
   let component=source
   for(const part of row.path.split('/')){component=path.join(component,part);assert(!(await lstat(component)).isSymbolicLink(),'Execution source link not permitted: '+row.path)}
   const file=path.join(source,row.path),info=await lstat(file)
   assert(info.isFile(),'Execution source must be regular files')
   assert.equal(git(source,'hash-object','--path='+row.path,'--',row.path).trim(),row.object,'Execution source differs from committed blob: '+row.path)
   actual.push({path:row.path,type:'file',bytes:info.size,sha256:await fileHash(file),executable:!!(info.mode&0o111)})
  }
  assert.deepEqual(actual.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),expected,'Execution source bytes differ from verified candidate')
 }
 const toolPaths=['scripts/lib/r5-recovery-tools.mjs','scripts/lib/r5-candidate-tools.mjs','bin/migrate-resource-storage.mjs']
 if(entrypoint){
  const file=await realpath(path.resolve(entrypoint));assert(inside(source,file),'Execution entrypoint is outside verified source')
  toolPaths.push(path.relative(source,file).split(path.sep).join('/'))
 }
 const executedFiles=[]
 for(const relative of [...new Set(toolPaths)]){
  const file=path.join(source,relative),expected=manifest.files.find(row=>row.type==='file'&&row.path==='source/'+relative)
  assert(expected,'Execution module is absent from candidate manifest: '+relative)
  assert.equal(await realpath(file),file,'Execution module must not be redirected')
  const digest=await fileHash(file);assert.equal(digest,expected.sha256,'Execution module content mismatch: '+relative)
  executedFiles.push({path:file,sha256:digest})
 }
 return {mode:executionMode,sourceCommit:verified.sourceCommit,repositoryHead,candidateManifestSha256:manifestSha256,candidateRoot:root,executionSourceRoot:source,executedFiles,candidateDependencyVersions:verified.dependencyVersions,candidateDependencyRootsComplete:verified.dependencyRootsComplete,candidateMissingDependencyRoots:verified.missingDependencyRoots,nodeVersion:process.version,platform:process.platform,verified:true}
}
export function cliOptions(args,allowed){
 const result={}
 for(let i=0;i<args.length;i++){
  const key=args[i];assert(allowed.includes(key),'Unknown argument: '+key)
  assert(!Object.hasOwn(result,key),'Duplicate argument: '+key)
  assert(i+1<args.length&&!args[i+1].startsWith('--'),'Missing value: '+key)
  result[key]=args[++i]
 }
 return result
}
