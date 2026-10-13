import {createBackgroundContext,launchBackgroundBrowser} from './background-browser.js'

// Dedicated, short-lived validator. It never receives user credentials, disk
// bindings or network access; original card code is never executed here.
let browserPromise,idle,active=0
export async function disposeMvuConversionBrowser(){clearTimeout(idle);const pending=browserPromise;browserPromise=undefined;await (await pending)?.close().catch(()=>{})}
export async function withMvuConversionPage(work) {
  clearTimeout(idle);active++
  let context,timer
  try {
    browserPromise ||= launchBackgroundBrowser().catch(error=>{browserPromise=undefined;throw Error('MVU 转换验证无法启动浏览器：'+error.message)})
    const browser=await browserPromise
    context=await createBackgroundContext(browser,{serviceWorkers:'block'})
    await context.route('**/*',route=>route.abort())
    const page=await context.newPage()
    return await Promise.race([work(page),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('MVU 转换浏览器验证超时')),15000)})])
  } finally {
    clearTimeout(timer);await context?.close().catch(()=>{})
    if(--active===0){idle=setTimeout(()=>void disposeMvuConversionBrowser(),1000);idle.unref?.()}
  }
}
