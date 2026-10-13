import {chromium} from 'playwright-core'
import {registry as browserRegistry} from 'playwright-core/lib/coreBundle'
import {existsSync} from 'node:fs'
import {homedir} from 'node:os'
import path from 'node:path'

/** Resolve the shell from the installed, pinned Playwright registry on each platform. */
export function backgroundBrowserExecutablePath(){
 let executablePath=browserRegistry.registry.findExecutable('chromium-headless-shell').executablePath()
 if(!process.env.PLAYWRIGHT_BROWSERS_PATH){
  // Desktop loads plugins in its existing process instead of the CLI launcher's
  // environment. Resolve the same private cache using the pinned registry path.
  const parts=executablePath.split(path.sep),start=parts.findLastIndex(part=>/^chromium_headless_shell-\d+$/.test(part))
  if(start>=0){const candidate=path.join(process.env.DSH_HOME||path.join(homedir(),'.dsh'),'browser-runtime',...parts.slice(start));if(existsSync(candidate))executablePath=candidate}
 }
 return executablePath
}
/** Uses Playwright's pinned shell and a private profile; no system proxy/DNS edits. */
export function launchBackgroundBrowser(){
 return chromium.launch({executablePath:backgroundBrowserExecutablePath(),headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']})
}

/** Reserve before awaiting launch; detach the final lease before asynchronous close. */
export function createBackgroundBrowserOwner(launch){
 let current,disposed=false
 const entries=new Set()
 function retire(entry){
  if(current===entry)current=undefined
  entry.closing ||=entry.promise.then(browser=>browser.close()).catch(()=>{}).finally(()=>entries.delete(entry))
  return entry.closing
 }
 return {
  acquire(onDisconnected){
   if(disposed)throw new Error('后台浏览器已停止')
   if(!current){
    const entry={leases:new Set()};current=entry;entries.add(entry)
    entry.promise=Promise.resolve().then(launch).then(browser=>{
     browser.on?.('disconnected',()=>{if(current===entry)current=undefined;for(const lease of entry.leases)lease.onDisconnected?.()})
     return browser
    }).catch(error=>{if(current===entry)current=undefined;throw error})
   }
   const entry=current,lease={onDisconnected};entry.leases.add(lease)
   return {browser:entry.promise,release(){entry.leases.delete(lease);return entry.leases.size?Promise.resolve():retire(entry)}}
  },
  async dispose(){disposed=true;current=undefined;await Promise.allSettled([...entries].map(retire))}
 }
}

// Playwright 1.62's built-in "block" initializer reads navigator.serviceWorker
// without catching SecurityError in opaque sandbox frames. Fresh contexts have
// no workers to restore; block registration before any page code, on the shared
// prototype too, while leaving that native opaque-origin restriction intact.
export async function blockBrowserServiceWorkers(context){
 await context.addInitScript?.(()=>{
  let workers;try{workers=navigator.serviceWorker}catch{return}
  if(!workers)return;
  const prototype=Object.getPrototypeOf(workers);
  if(Object.getOwnPropertyDescriptor(prototype,'register')?.configurable===false)return;
  Object.defineProperty(prototype,'register',{configurable:false,writable:false,value:async function(){throw new DOMException('Service workers are disabled in this private runtime','SecurityError')}});
 });
}
export async function createBackgroundContext(browser,options={}){
 const context=await browser.newContext({...options,serviceWorkers:'allow'});
 try{await blockBrowserServiceWorkers(context);return context}catch(error){await context.close();throw error}
}

/** The saved resource grant is the authority. URLs and DNS answers are unchanged. */
export async function installBackgroundNetworkBoundary(context,{origin,authorize=async()=>false,record=()=>{}}){
 // These private browser contexts have no permission UI. The route boundary
 // below decides access using the user's existing resource grant, including LAN.
 await context.grantPermissions?.(['local-network-access'],{origin})
 const allowed=async input=>{try{return await authorize(input)===true}catch{return false}}
 await context.route('**/*',async route=>{
  const request=route.request(),url=request.url()
  if(new URL(url).origin===origin)return route.fallback()
  let frame;try{frame=request.frame()}catch{}
  const permit=await allowed({kind:'http',frame,url})
  record({kind:'http',origin:new URL(url).origin,allowed:permit})
  return permit?route.continue():route.abort('blockedbyclient')
 })
 await context.routeWebSocket?.('**/*',async socket=>{
  const input={kind:'websocket',url:socket.url()},permit=await allowed(input)
  record({kind:'websocket',origin:new URL(input.url).origin,allowed:permit})
  if(!permit){socket.close({code:1008,reason:'Resource network permission required'});return}
  const server=socket.connectToServer()
  // Recheck existing connections too, so later grants do not keep a revoked
  // connection alive just because its handshake happened earlier.
  const forward=(from,to)=>{let tail=Promise.resolve();from.onMessage(message=>{tail=tail.then(async()=>{if(await allowed(input))to.send(message);else socket.close({code:1008,reason:'Resource network permission revoked'})}).catch(()=>socket.close({code:1011,reason:'Network permission unavailable'}))})}
  forward(socket,server);forward(server,socket)
 })
}

/** Resolve ownership in the host's frame registry, never from script arguments. */
export async function backgroundFrameSources(page,frame){
 if(!page)return []
 if(!frame||frame===page.mainFrame())return page.evaluate(()=>window.__dshBackgroundEngine?.networkSources(null)||[])
 while(frame.parentFrame()&&frame.parentFrame()!==page.mainFrame())frame=frame.parentFrame()
 const element=await frame.frameElement()
 try{return await page.evaluate(element=>window.__dshBackgroundEngine?.networkSources(element)||[],element)}finally{await element.dispose()}
}
