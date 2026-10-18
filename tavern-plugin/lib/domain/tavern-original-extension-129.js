import {adaptSp129Continuation} from './sp129-continuation.js'
import {adaptSp129ManualRefill} from './sp129-manual-refill.js'
import {adaptSp129VectorTasks} from './sp129-vector-tasks.js'
import {adaptSp129NativeInput} from './sp129-native-input.js'
import {adaptSp129TemplateCheckpoint} from './sp129-template-checkpoint.js'
import {adaptSp129StorageNotification,adaptSp129VectorNotification} from './sp129-storage-notification.js'
import {adaptSp129BridgeSource} from './sp129-bridge-source.js'
import {createHash} from 'node:crypto'
import {parse} from 'acorn'
import {projectParsedTavernHostScript} from './tavern-host-script-projection.js'
import {createSp129Context} from './sp129-source.js'
import {adaptSp129Data} from './sp129-data.js'
import {adaptSp129Work} from './sp129-work.js'
import {adaptSp129Recovery} from './sp129-recovery.js'
import {adaptSp129Lifecycle} from './sp129-lifecycle.js'
import {adaptSp129Quiet} from './sp129-quiet.js'
import {adaptSp129OwnedTask} from './sp129-owned-task.js'

export const SP129_COMMIT='85eaa78ab6908adc84a2ef5c5278f25e8d296317'
export const SP129_SOURCE_SHA256='afc83e77a113ec4a37c422c0dc4dfd1c7b7f52bdc8237f5e8f7c6ea5d408ee48'
let prepared

export function projectOriginalSp129(original) {
 return projectSp129(original)
}
// Keep the final syntax check, handing its transient AST straight to the next
// projection. A prepared-source hit can use the existing host source cache.
export function projectOriginalSp129HostScript(original) {
 return projectSp129(original,parsed=>projectParsedTavernHostScript(parsed,{storageOwner:true}))
}
function projectSp129(original,consumeParsed) {
 const file=original?.files?.[original?.manifest?.js],source=file?.text
 if(original?.manifest?.version!=='1.2.9'||original.commit!==SP129_COMMIT||typeof source!=='string')throw Error('数据库 1.2.9 原包身份与已验证版本不符')
 if(prepared?.source===source&&file.sha256===SP129_SOURCE_SHA256)return consumeParsed?consumeParsed({source:prepared.projected}):prepared.projected
 if(file.sha256!==SP129_SOURCE_SHA256||createHash('sha256').update(source).digest('hex')!==SP129_SOURCE_SHA256)throw Error('数据库 1.2.9 原包内容与已验证版本不符')
 const context=createSp129Context(source)
 adaptSp129Data(context)
 adaptSp129Work(context)
 adaptSp129Recovery(context)
 adaptSp129Lifecycle(context)
 adaptSp129Quiet(context)
 adaptSp129NativeInput(context)
 adaptSp129TemplateCheckpoint(context)
 adaptSp129StorageNotification(context)
 adaptSp129VectorNotification(context)
 adaptSp129BridgeSource(context)
 adaptSp129VectorTasks(context)
 adaptSp129ManualRefill(context)
 adaptSp129Continuation(context)
 adaptSp129OwnedTask(context)
 const projected=context.apply()
 // A syntactically invalid projection must fail before replacing an installed
 // package. This does not execute the publisher's source or certify business use.
 const tree=parse(projected,{ecmaVersion:'latest',sourceType:'module'})
 prepared={source,projected}
 return consumeParsed?consumeParsed({source:projected,tree}):projected
}
