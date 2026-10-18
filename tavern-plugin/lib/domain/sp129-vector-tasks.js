import {sp129RootNodes} from './sp129-source.js';

// Only the fixed flush-task store moves to the existing owned host storage.
// Each write performs the original RMW inside the host JSON update lock.
export function adaptSp129VectorTasks(ctx){
 const replacements={
 getSummaryVectorFlushTaskStrict_ACU:`async function getSummaryVectorFlushTaskStrict_ACU(t){const n=normalizeKeyPart_ACU(t);if(!n)throw new Error("读取交火向量 flush task 失败：scopeKey 为空");const rows=await __dshSpVectorTaskSnapshot_ACU();return Object.prototype.hasOwnProperty.call(rows,n)?cloneFlushTask_ACU(JSON.parse(rows[n])):null}`,
 upsertSummaryVectorFlushTask_ACU:`async function upsertSummaryVectorFlushTask_ACU(t){try{const n=normalizeKeyPart_ACU(t.scopeKey),o=normalizeKeyPart_ACU(t.chatKey);if(!n||!o)return null;return await __dshSpUpdateVectorTask_ACU({action:'upsert',scopeKey:n,task:{...t,scopeKey:n}})}catch{return null}}`,
 markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU:`async function markSummaryVectorFlushTaskReadyIfGenerationMatchesStrict_ACU(t,n){const o=normalizeKeyPart_ACU(t),i=Math.max(0,Number(n)||0);if(!o)throw new Error("按代次完成交火向量 flush task 失败：scopeKey 为空");const l=await __dshSpUpdateVectorTask_ACU({action:'mark-ready',scopeKey:o,generation:i}),g=await getSummaryVectorFlushTaskStrict_ACU(o);if(l&&(!g||g.generation!==i||"ready"!==g.status))throw new Error('按代次完成交火向量 flush task 后校验失败：scope='+o);return l}`,
 listSummaryVectorFlushTasks_ACU:`async function listSummaryVectorFlushTasks_ACU(t){try{const n=normalizeKeyPart_ACU(t?.chatKey),o=null==t?.isolationKey?"":normalizeSummaryVectorIsolationKey_ACU(t.isolationKey),i=normalizeKeyPart_ACU(t?.sourceTableKey),rows=await __dshSpVectorTaskSnapshot_ACU();return Object.values(rows).map(value=>cloneFlushTask_ACU(JSON.parse(value))).filter(s=>!(n&&s.chatKey!==n||o&&normalizeSummaryVectorIsolationKey_ACU(s.isolationKey)!==o||i&&s.sourceTableKey!==i)).sort((t,n)=>t.debounceUntil-n.debounceUntil||t.scopeKey.localeCompare(n.scopeKey))}catch{return[]}}`,
 deleteSummaryVectorFlushTaskStrict_ACU:`async function deleteSummaryVectorFlushTaskStrict_ACU(t){const n=normalizeKeyPart_ACU(t);if(!n)throw new Error("删除交火向量 flush task 失败：scopeKey 为空");await __dshSpUpdateVectorTask_ACU({action:'delete',scopeKey:n});if(await getSummaryVectorFlushTaskStrict_ACU(n))throw new Error('删除交火向量 flush task 后校验失败：scope='+n)}`,
 invalidateSummaryVectorFlushTaskStrict_ACU:`async function invalidateSummaryVectorFlushTaskStrict_ACU(t){const n=normalizeKeyPart_ACU(t.scopeKey),o=normalizeKeyPart_ACU(t.chatKey),s=normalizeKeyPart_ACU(t.sourceTableKey);if(!n||!o||!s)throw new Error("持久化交火向量 flush 失效墓碑失败：scope 不完整");const g=await __dshSpUpdateVectorTask_ACU({action:'invalidate',scopeKey:n,task:{...t,scopeKey:n}}),u=await getSummaryVectorFlushTaskStrict_ACU(n);if(!u||"invalidated"!==u.status||u.generation!==g.generation)throw new Error('持久化交火向量 flush 失效墓碑后校验失败：scope='+n);return u}`,
 };
 const found=new Map();sp129RootNodes(ctx).forEach(node=>{if(['FunctionDeclaration','FunctionExpression'].includes(node.type)&&Object.hasOwn(replacements,node.id?.name)){const name=node.id.name;if(found.has(name))throw Error('SP flush task function ambiguous: '+name);found.set(name,node)}});
 for(const[name,text]of Object.entries(replacements)){const node=found.get(name);if(!node||!ctx.text(node).includes('openDb_ACU$1'))throw Error('SP flush task storage boundary changed: '+name);ctx.replace(node,text)}
 ctx.insert(ctx.root.start+1,vectorTaskHelpers);
}
export const vectorTaskHelpers=`
async function __dshSpVectorTaskSnapshot_ACU(){
 if(typeof __dshUiStorage?.__dshSpVectorFlushSnapshot!=='function')throw new Error('SP 持久向量任务存储不可用');
 const reply=await __dshUiStorage.__dshSpVectorFlushSnapshot();if(!reply?.records||typeof reply.records!=='object'||Array.isArray(reply.records))throw new Error('SP 持久向量任务回执无效');return reply.records;
}
async function __dshSpUpdateVectorTask_ACU(operation){
 if(typeof __dshUiStorage?.__dshSpVectorFlushUpdate!=='function')throw new Error('SP 持久向量任务存储不可用');
 const reply=await __dshUiStorage.__dshSpVectorFlushUpdate(operation);if(!reply||!Object.prototype.hasOwnProperty.call(reply,'result'))throw new Error('SP 向量任务持久写入回执无效');return reply.result;
}
`;
