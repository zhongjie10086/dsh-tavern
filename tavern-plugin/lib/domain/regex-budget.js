import {createContext,Script} from 'node:vm'
// Only application callbacks run here; card patterns remain RegExp data. V8's
// deadline interrupts native RegExp even when called through this host callback.
export const REGEX_LIMITS=Object.freeze({timeoutMs:50,inputChars:2*1024*1024,outputChars:8*1024*1024,patternChars:32768})
const program=new Script('perform()',{filename:'tavern-bounded-regex.js'})
let context,executing=false
export function withRegexBudget(perform,timeoutMs=REGEX_LIMITS.timeoutMs){
 if(executing)return perform()
 context||=createContext({},{codeGeneration:{strings:false,wasm:false}})
 const active=context;active.perform=perform;executing=true
 try{return program.runInContext(active,{timeout:timeoutMs})}
 catch(error){if(error.code==='ERR_SCRIPT_EXECUTION_TIMEOUT'){context=undefined;throw Object.assign(Error('正则执行超过 '+timeoutMs+' 毫秒预算，已停止此规则'),{code:'DSH_TAVERN_REGEX_TIMEOUT'})}throw error}
 finally{executing=false;active.perform=undefined}
}
