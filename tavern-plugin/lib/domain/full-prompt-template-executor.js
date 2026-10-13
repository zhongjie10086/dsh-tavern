import {createBackgroundContext,launchBackgroundBrowser,installBackgroundNetworkBoundary,createBackgroundBrowserOwner} from './background-browser.js'
import { FULL_PROMPT_TEMPLATE_ASSET_PREFIX, readFullPromptTemplateAsset } from './full-prompt-template-assets.js'
import { TAVERN_RUNTIME_ASSET_PREFIX, readTavernRuntimeAsset } from './tavern-runtime-assets.js'
import { packTemplateRpcResult, unpackTemplateRpcResult } from './template-rpc-wire.js'
import {installTemplateOperationTimers} from './template-operation-timers.js'
import { isRenderableHtmlCodeBlock } from './reply-presentation.js'

const ORIGIN = 'http://dsh-template.localhost'
const methods = new Set(['loadFullPromptTemplateWorldInfo','getFullPromptTemplateState', 'saveFullPromptTemplateState', 'saveFullPromptTemplateGlobals', 'saveFullPromptTemplateSettings'])
const documentHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH 模板执行器</title><link rel="icon" href="data:,"><script src="${TAVERN_RUNTIME_ASSET_PREFIX}jquery/jquery.min.js"></script><script src="${TAVERN_RUNTIME_ASSET_PREFIX}lodash/lodash.min.js"></script><div id="extensions_settings"></div><div id="chat"></div></html>`

/** The service owns disposable browser contexts; visible tabs never own template jobs. */
export function createFullPromptTemplateExecutor({ rpc, launch = launchBackgroundBrowser, networkPolicy=async()=>false, timeoutMs = 30000, idleMs = 180000, maxInstances = 3, maxQueuedPerSession = 16, serviceContext = async () => ({}) }) {
  const instances = new Map(), tails = new Map(), queued = new Map(), metrics = []
  const browserOwner=createBackgroundBrowserOwner(launch)
  let disposed = false
  function close(instance) {
    if (!instance) return
    if(instance.closePromise)return instance.closePromise
    instance.closed = true; clearTimeout(instance.idleTimer)
    if (instances.get(instance.sessionId) === instance) instances.delete(instance.sessionId)
    return instance.closePromise=(async()=>{await instance.context?.close().catch(() => {});await instance.browserLease?.release()})()
  }
  async function instanceFor(sessionId, operationRpc,networkOwner) {
    if (disposed) throw new Error('模板执行器已停止')
    const existing = instances.get(sessionId)
    if (existing && !existing.closed) { clearTimeout(existing.idleTimer); existing.operationRpc=operationRpc;existing.networkOwner=networkOwner;existing.epoch++;existing.busy=true;await existing.page.evaluate(epoch=>{window.__dshTemplateEpoch=epoch},existing.epoch); return existing }
    let eviction
    if (instances.size >= maxInstances) {
      const idle = [...instances.values()].filter(value => !value.busy).sort((a,b) => a.lastUsed-b.lastUsed)[0]
      if (!idle) throw new Error('模板执行器正忙，请稍后再试')
      eviction=close(idle)
    }
    const instance = { sessionId, operationRpc, networkOwner, epoch:1, requests:new Set(), sockets:new Set(), context: null, page: null, busy: true, closed: false, lastUsed: Date.now(), errors: [] }
    instances.set(sessionId, instance)
    let context
    try {
      await eviction
      if(disposed||instance.closed)throw new Error('模板任务已停止')
      instance.browserLease=browserOwner.acquire(()=>{void close(instance)})
      const browser=await instance.browserLease.browser.catch(error=>{throw new Error('无法启动模板浏览器，请安装与当前 Playwright 配套的 Chromium headless shell：'+error.message)})
      instance.browser=browser
      if(disposed||instance.closed)throw new Error('模板任务已停止')
      context=await createBackgroundContext(browser,{ viewport: { width: 1000, height: 720 }, serviceWorkers: 'block' })
      instance.context=context
      if(disposed||instance.closed){await context.close();throw new Error('模板任务已停止')}
      await installBackgroundNetworkBoundary(context,{origin:ORIGIN,authorize:()=>!instance.closed&&!!instance.operationRpc&&networkPolicy(sessionId,instance.networkOwner)})
      await context.route(ORIGIN + '/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        if (pathname === '/') { await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: documentHtml }); return }
        if (pathname === '/template-rpc-wire.js') {
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export '+packTemplateRpcResult.toString()+'\nexport '+unpackTemplateRpcResult.toString() }); return
        }
        // The server's fenced-HTML rule, so both renderers promote the same code blocks (Z92).
        if (pathname === '/template-code-blocks.js') {
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'export '+isRenderableHtmlCodeBlock.toString() }); return
        }
        const file = pathname.startsWith(FULL_PROMPT_TEMPLATE_ASSET_PREFIX) ? await readFullPromptTemplateAsset(pathname) : await readTavernRuntimeAsset(pathname)
        if (!file) { await route.fulfill({ status: 404, body: 'Unknown template resource' }); return }
        await route.fulfill({ status: 200, contentType: file.mediaType, body: file.body })
      })
      const page = instance.page = await context.newPage()
      page.on('request',request=>{if(!request.url().startsWith(ORIGIN+'/'))instance.requests.add(request)})
      page.on('requestfinished',request=>instance.requests.delete(request))
      page.on('requestfailed',request=>instance.requests.delete(request))
      page.on('websocket',socket=>{instance.sockets.add(socket);socket.on('close',()=>instance.sockets.delete(socket))})
      page.on('pageerror', error => { instance.errors.push(error.message); if(instance.errors.length>100)instance.errors.shift() })
      await page.exposeFunction('__dshTemplateRpc', async (method, wire, epoch) => {
        const args = unpackTemplateRpcResult(wire)
        const operationRpc=instance.operationRpc
        if (instance.closed || instance.signal?.aborted || !operationRpc || epoch!==instance.epoch) throw new Error('模板操作已取消或已结束')
        if (!methods.has(method) || args.sessionId !== sessionId) throw new Error('模板操作超出当前游戏范围')
        return packTemplateRpcResult(await operationRpc(method, args))
      })
      await page.goto(ORIGIN, { waitUntil: 'load', timeout: timeoutMs })
      await page.evaluate(epoch=>{window.__dshTemplateEpoch=epoch},instance.epoch)
      await page.evaluate(installTemplateOperationTimers)
      await page.evaluate(async ({ sessionId, prefix, runtime }) => {
        const { packTemplateRpcResult, unpackTemplateRpcResult } = await import('/template-rpc-wire.js')
        const { isRenderableHtmlCodeBlock } = await import('/template-code-blocks.js')
        const YAML = await import(runtime + 'yaml/index.mjs')
        const { connectTemplateSession, createTemplateBrowserServices } = await import(prefix + 'index.js')
        const settingsHtml = await fetch(prefix + 'settings.html').then(r => r.text())
        const pendingErrors = []
        window.toastr = Object.fromEntries(['info','success','warning','error'].map(level => [level, message => { if (level === 'error') pendingErrors.push(String(message)) }]))
        let plugin
        window.SillyTavern = { getContext: () => plugin?.context }
        const escape = value => { const n = document.createElement('div'); n.textContent = String(value ?? ''); return n.innerHTML }
        const services = createTemplateBrowserServices({context:()=>plugin.context, environment:()=>window.__dshEnvironment||{}, command:(...args)=>plugin.commandFromTemplate(...args), reportError:message=>pendingErrors.push(message)})
        const templateRpc = async (method, args) => unpackTemplateRpcResult(await window.__dshTemplateRpc(method, packTemplateRpcResult(args),window.__dshTemplateEpoch))
        plugin = await connectTemplateSession({ sessionId, rpc: templateRpc, services, settingsHtml, libraries: { yaml: YAML } })
        const renderedRows=[]
        function renderHistory() {
          const host=document.querySelector('#chat')
          const rules=[...(window.__dshEnvironment?.regexScripts||[]),...(plugin.context.extension_settings.regex||[])]
          const formatRevision=JSON.stringify(rules)
          const depthSensitive=rules.some(rule=>[rule.minDepth,rule.maxDepth].some(value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))))
          for (const [id,message] of plugin.context.chat.entries()) {
            const signature=JSON.stringify([message.mes,message.name,message.is_system,message.is_user,depthSensitive?plugin.context.chat.length-id:0])
            let cached=renderedRows[id]
            if(!cached||cached.signature!==signature||cached.formatRevision!==formatRevision){
              const normalized=document.createElement('template');normalized.innerHTML=services.messageFormatting(message.mes,message.name,message.is_system,message.is_user,id)
              cached=renderedRows[id]={signature,formatRevision,html:normalized.innerHTML,sourceText:message.mes}
            }
            let row=host.children[id]
            if(!row||row.getAttribute('mesid')!==String(id)||!row.querySelector('.mes_text')){const replacement=document.createElement('div');replacement.className='mes';replacement.setAttribute('mesid',id);const text=document.createElement('div');text.className='mes_text';replacement.append(text);if(row)row.replaceWith(replacement);else host.append(replacement);row=replacement}
            const text=row.querySelector('.mes_text')
            if(row.childNodes.length!==1)row.replaceChildren(text)
            // Restore baseline markup after a prior template operation, without
            // reformatting or replacing unchanged historical DOM on every call.
            if(text.innerHTML!==cached.html)text.innerHTML=cached.html
          }
          while(host.children.length>plugin.context.chat.length)host.lastElementChild.remove()
          renderedRows.length=plugin.context.chat.length
        }
        function captured(id) {
          const html=document.querySelector('div.mes[mesid="'+id+'"] .mes_text')?.innerHTML||''
          const parsed=document.createElement('template');parsed.innerHTML=html
          const root=parsed.content,parts=[]
          const append=content=>{if(content.trim())parts.push({kind:'html',content})}
          for(;;){
            // Rendered fences arrive as <pre><code class="language-x">, and cards may label a whole
            // UI document as text (Z92): apply the server's rule to the code text.
            const element=Array.from(root.querySelectorAll('[data-dsh-template-status], pre > code')).find(node=>node.hasAttribute('data-dsh-template-status')||isRenderableHtmlCodeBlock(node.textContent,(String(node.getAttribute('class')||'').match(/(?:^|\s)language-(\S+)/)||[])[1]||''))
            if(!element)break
            const status=element.hasAttribute('data-dsh-template-status'),target=status?element:element.parentElement
            const range=document.createRange();range.setStart(root,0);range.setEndBefore(target)
            const prefix=document.createElement('template');prefix.content.append(range.extractContents());append(prefix.innerHTML)
            if(status)parts.push({kind:'html',content:element.innerHTML,statusKey:decodeURIComponent(element.getAttribute('data-dsh-status-key'))})
            else append(element.textContent)
            target.remove()
          }
          append(parsed.innerHTML)
          return {html,parts,unchangedMarkup:renderedRows[id]?.html===html&&renderedRows[id]?.sourceText===plugin.context.chat[id]?.mes}
        }
        let initializedChat = null, firstOperation = true
        window.__dshRunTemplate = async operation => {
          pendingErrors.length=0
          // connectTemplateSession already loaded the request's captured state.
          // Reused instances refresh; a newly created transaction does not read
          // and transfer the same complete history a second time.
          if (!firstOperation) await plugin.refresh()
          firstOperation = false
          const signature=JSON.stringify([plugin.context.lifecycleRevision,plugin.context.worldbooks,plugin.context.extension_settings.EjsTemplate])
          if (initializedChat!==signature) { document.querySelector('#chat').replaceChildren(); await plugin.emit('CHAT_CHANGED', sessionId); initializedChat=signature }
          renderHistory()
          let result
          if (operation.kind === 'request') result=await plugin.processChatCompletion({messages:operation.messages,type:operation.type||'normal'})
          else if (operation.kind === 'worldbook') {
            const data={characterLore:operation.entries.map(entry=>({key:[],keysecondary:[],comment:"",content:"",...entry})),globalLore:[],personaLore:[],chatLore:[],type:operation.type||'normal'}
            await plugin.emit('WORLDINFO_ENTRIES_LOADED',data)
            result={entries:data.characterLore}
          }
          else if (operation.kind === 'command') result={value:await plugin.command(operation.name,operation.args||{},operation.value||'')}
          else if (operation.kind === 'evaluate') result={text:await plugin.api.evalTemplate(operation.code)}
          else if (operation.kind === 'history') {
            const messages=[]
            for(const event of operation.events) {
              if(event.kind==='event'){await plugin.emit(event.name,...(event.args||[]));continue}
              const id=Number(event.messageId),message=plugin.context.chat[id]
              if(!message)throw new Error('模板历史楼层不存在')
              if(event.event)await plugin.emit(event.event,id,event.type||'normal')
              // Updated/swiped events already render through the pinned upstream handler.
              if(!['MESSAGE_UPDATED','MESSAGE_SWIPED'].includes(event.event))await plugin.emit(message.is_user?'USER_MESSAGE_RENDERED':'CHARACTER_MESSAGE_RENDERED',String(id),event.type||'normal',event.dryRun===true)
              messages.push({messageId:id,text:message.mes,...captured(id)})
            }
            result={messages}
          }
          else if (operation.kind === 'message') {
            const id=Number(operation.messageId), message=plugin.context.chat[id]
            if(!message)throw new Error('模板目标楼层不存在')
            if(operation.created)await plugin.emit(message.is_user?'MESSAGE_SENT':'MESSAGE_RECEIVED',id,operation.type||'normal')
            await plugin.emit(message.is_user?'USER_MESSAGE_RENDERED':'CHARACTER_MESSAGE_RENDERED',String(id),operation.type||'normal',operation.dryRun===true)
            result={text:message.mes,...captured(id)}
          }
          else if (operation.kind === 'event') { await plugin.emit(operation.name,...(operation.args||[])); result={} }
          else if (operation.kind === 'response') { const data={message:operation.text}; await plugin.emit('js_generation_before_end',data,operation.id||'dsh'); result={text:data.message} }
          else if (operation.kind === 'features') { if(operation.settings)plugin.api.setFeatures(operation.settings);result={features:plugin.api.getFeatures(),commands:plugin.commands,version:plugin.version,tokenizer:'estimate-unicode'} }
          else throw new Error('模板操作无效')
          await plugin.api.saveVariables(true); await plugin.flush()
          if(pendingErrors.length)throw new Error(pendingErrors.join('\n'))
          return result
        }
        window.__dshExecuteTemplate = async ({ environment, operation }) => {
          window.__dshEnvironment = unpackTemplateRpcResult(environment)
          return packTemplateRpcResult(await window.__dshRunTemplate(unpackTemplateRpcResult(operation)))
        }
      }, { sessionId, prefix: FULL_PROMPT_TEMPLATE_ASSET_PREFIX, runtime: TAVERN_RUNTIME_ASSET_PREFIX })
      instance.busy = false
      return instance
    } catch (error) { await close(instance); throw error }
  }
  async function execute(sessionId, operation, { signal, timeout = timeoutMs, rpc: operationRpc, serviceContext: operationContext, networkOwner } = {}) {
    if (!sessionId) throw new Error('模板任务缺少游戏身份')
    if ((queued.get(sessionId) || 0) >= maxQueuedPerSession) throw new Error('模板任务排队已满，请稍后重试')
    queued.set(sessionId, (queued.get(sessionId) || 0) + 1)
    const previous = tails.get(sessionId) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      signal?.throwIfAborted()
      const started = Date.now(); let instance, timer, abort, stopped = false
      const aborted = new Promise((_,reject) => {
        abort = () => { stopped=true; void close(instance || instances.get(sessionId)); reject(signal?.reason || new Error('模板执行已取消')) }
        signal?.addEventListener('abort',abort,{once:true})
        timer = setTimeout(() => { stopped=true; void close(instance || instances.get(sessionId)); reject(new Error('模板执行超时，已终止该实例')) },timeout)
      })
      try {
        return await Promise.race([aborted, (async () => {
          let initialState=await (operationRpc || rpc)('getFullPromptTemplateState', {sessionId})
          const prefetchedRpc=(method,args)=>{
            if(method==='getFullPromptTemplateState'&&initialState){const value=initialState;initialState=undefined;return value}
            return (operationRpc || rpc)(method,args)
          }
          if(stopped)throw new Error('模板任务已终止')
          instance = await instanceFor(sessionId, prefetchedRpc,networkOwner); if (stopped) { await close(instance); throw new Error("模板任务已终止") } instance.signal=signal;instance.busy=true
          signal?.throwIfAborted()
          const payload = { environment:packTemplateRpcResult(operationContext ?? await serviceContext(sessionId)), operation:packTemplateRpcResult(operation) }
          const result=unpackTemplateRpcResult(await instance.page.evaluate(value => window.__dshExecuteTemplate(value),payload))
          metrics.push({at:Date.now(),kind:operation.kind,durationMs:Date.now()-started,ok:true});if(metrics.length>200)metrics.shift()
          return result
        })()])
      } catch(error) { metrics.push({at:Date.now(),kind:operation.kind,durationMs:Date.now()-started,ok:false,error:error.message});if(metrics.length>200)metrics.shift();await close(instance || instances.get(sessionId));throw error }
      finally {
        clearTimeout(timer);signal?.removeEventListener('abort',abort)
        if(instance&&!instance.closed) {
          try {await instance.page.evaluate(()=>window.__dshEndTemplateOperation())}catch{await close(instance)}
          // A detached network continuation may retain arbitrary template state.
          // Reuse quiescent pages; discard one still owning a request or socket.
          if(instance.requests.size||instance.sockets.size)await close(instance)
          instance.operationRpc=null;instance.networkOwner=undefined;instance.signal=null;instance.errors.length=0
          if(!instance.closed){instance.busy=false;instance.lastUsed=Date.now();instance.idleTimer=setTimeout(()=>{void close(instance)},idleMs);instance.idleTimer.unref?.()}
        }
      }
    })
    tails.set(sessionId,task)
    try { return await task } finally { if(tails.get(sessionId)===task)tails.delete(sessionId); const count=queued.get(sessionId)-1;if(count)queued.set(sessionId,count);else queued.delete(sessionId) }
  }
  return { execute, inspect: () => ({running:[...instances.values()].map(i=>({sessionId:i.sessionId,busy:i.busy,lastUsed:i.lastUsed})),metrics:[...metrics]}),
    async dispose() { disposed=true;await Promise.allSettled([...instances.values()].map(close));await browserOwner.dispose() } }
}
