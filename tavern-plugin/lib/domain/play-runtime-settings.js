import { normalizeBackgroundTasks, normalizeDisabledWritingSkills } from './tavern-settings.js'
import { normalizeBackgroundModel, configuredBackgroundModel, configuredChatBackgroundModel, backgroundModelRevision } from './background-model-selection.js'
import { outboundDisabled } from './outbound-network-policy.js'
import { foregroundModelRevision } from './foreground-model-selection.js'
export function playRuntimeSettings(chat, settings = {}) {
 const local = chat?.runtimeConfigVersion === 1
 return {disabledWritingSkills:normalizeDisabledWritingSkills(Array.isArray(chat?.disabledWritingSkills)?chat.disabledWritingSkills:settings.defaultDisabledWritingSkills),backgroundModel: configuredChatBackgroundModel(chat, settings),
  backgroundTasks: normalizeBackgroundTasks(local ? chat.backgroundTasks : settings.backgroundTasks),
  webSearchEnabled: !outboundDisabled() && (local ? chat.webSearchEnabled : settings.webSearchEnabled) === true}
}
export function newGameRuntimeSettings(settings = {}) {
 return {runtimeConfigVersion: 1,foregroundModelRevision:foregroundModelRevision(settings),disabledWritingSkills:normalizeDisabledWritingSkills(settings.defaultDisabledWritingSkills),
  backgroundModelSelection: configuredBackgroundModel(settings), backgroundModelRevision: backgroundModelRevision(settings),
  backgroundTasks: normalizeBackgroundTasks(settings.defaultBackgroundTasks ?? settings.backgroundTasks),
  webSearchEnabled: !outboundDisabled() && (settings.defaultWebSearchEnabled ?? settings.webSearchEnabled) === true}
}
export function applyPlayRuntimePatch(chat, settings, patch) {
 if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('本局设置无效')
 const current = playRuntimeSettings(chat,settings)
 if(Object.hasOwn(patch,'disabledWritingSkills')){if(!Array.isArray(patch.disabledWritingSkills))throw Error('写作技能开关列表无效');current.disabledWritingSkills=normalizeDisabledWritingSkills(patch.disabledWritingSkills)}
 for (const name of Object.keys(patch)) if (!['backgroundModel','backgroundTasks','webSearchEnabled','disabledWritingSkills'].includes(name)) throw Error('未知本局设置: '+name)
 if (Object.hasOwn(patch,'webSearchEnabled')) {if(typeof patch.webSearchEnabled!=='boolean')throw Error('联网开关无效');current.webSearchEnabled=patch.webSearchEnabled}
 if (Object.hasOwn(patch,'backgroundModel')) {const model=normalizeBackgroundModel(patch.backgroundModel);if(patch.backgroundModel!==null&&!model)throw Error('后台模型配置无效');current.backgroundModel=model}
 if (Object.hasOwn(patch,'backgroundTasks')) {
  if (!patch.backgroundTasks || typeof patch.backgroundTasks!=='object' || Array.isArray(patch.backgroundTasks)) throw Error('后台任务设置无效')
  for(const [name,value]of Object.entries(patch.backgroundTasks))if(!['posture','characterDesign','variables','ledger'].includes(name)||typeof value!=='boolean')throw Error('后台任务开关无效')
  current.backgroundTasks=normalizeBackgroundTasks({...current.backgroundTasks,...patch.backgroundTasks})
 }
 // Unrelated switches must not make an obsolete model snapshot current again.
 return {runtimeConfigVersion:1,disabledWritingSkills:current.disabledWritingSkills,
  ...(Object.hasOwn(patch,'backgroundModel') ? {backgroundModelSelection:current.backgroundModel,backgroundModelRevision:backgroundModelRevision(settings)} : {}),
  backgroundTasks:current.backgroundTasks,webSearchEnabled:!outboundDisabled()&&current.webSearchEnabled}
}
