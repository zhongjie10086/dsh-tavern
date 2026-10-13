import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'

/** Only the installer invokes this; ordinary game opens never download a browser. */
export function ensureBrowserRuntime({sourceRoot,env=process.env,execute=spawnSync}){
 const require=createRequire(path.join(sourceRoot,'package.json'))
 const packageFile=require.resolve('playwright-core/package.json')
 const cli=path.join(path.dirname(packageFile),'cli.js')
 const probe='import {registry} from "playwright-core/lib/coreBundle";import {accessSync} from "node:fs";accessSync(registry.registry.findExecutable("chromium-headless-shell").executablePath());'
 const options={cwd:sourceRoot,env,encoding:'utf8',windowsHide:true,shell:false}
 const before=execute(process.execPath,['--input-type=module','-e',probe],{...options,stdio:'pipe'})
 if(!before.error&&before.status===0)return {reused:true}
 const installed=execute(process.execPath,[cli,'install','chromium','--only-shell'],{...options,stdio:'inherit'})
 if(installed.error||installed.status!==0)throw new Error('独立 Chromium headless shell 安装失败；请修复网络后重试安装。'+(installed.error?.message||''))
 const checked=execute(process.execPath,['--input-type=module','-e',probe],{...options,stdio:'pipe'})
 if(checked.error||checked.status!==0)throw new Error('独立 Chromium headless shell 安装后仍缺少匹配的浏览器文件')
 return {reused:false}
}
