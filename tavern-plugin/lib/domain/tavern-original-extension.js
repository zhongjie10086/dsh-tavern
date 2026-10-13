import {createHash} from 'node:crypto'
import {projectTavernHostScript} from './tavern-host-script-projection.js'
import {safeOutboundFetch} from './outbound-network-policy.js'
// Verified against the user's installed shujuku extension git origin.
export const SP_ORIGINAL_REPOSITORY='https://github.com/AlbusKen/shujuku'
const digest=text=>createHash('sha256').update(text).digest('hex')
export function githubExtensionSource(value,ref='main'){
 if(String(value).replace(/\.git$/,'').replace(/\/$/,'')!==SP_ORIGINAL_REPOSITORY)throw Error('当前登记的原仓库为 '+SP_ORIGINAL_REPOSITORY)
 if(typeof ref!=='string'||!ref||ref.length>200||!/^[-\w./]+$/.test(ref)||ref.includes('..'))throw Error('扩展版本引用无效')
 return {repository:SP_ORIGINAL_REPOSITORY,owner:'AlbusKen',repo:'shujuku',ref}
}
async function limitedText(response,limit){if(!response.ok)throw Error('读取扩展仓库失败：HTTP '+response.status);let bytes=0;const chunks=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('扩展文件超过大小限制');chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
export async function fetchOriginalExtension(repository=SP_ORIGINAL_REPOSITORY,ref='main',{request,lookup}={}){
 const transport=request;request=(url,init)=>safeOutboundFetch(url,init,{fetcher:transport,lookup})
 const source=githubExtensionSource(repository,ref),headers={Accept:'application/vnd.github+json','User-Agent':'dsh-tavern-extension-host'}
 const revision=JSON.parse(await limitedText(await request('https://api.github.com/repos/AlbusKen/shujuku/commits/'+encodeURIComponent(ref),{headers,redirect:'error',signal:AbortSignal.timeout(30000)}),2000000))
 const commit=revision.sha;if(!/^[0-9a-f]{40}$/.test(commit||''))throw Error('仓库未返回有效提交版本')
 const base='https://raw.githubusercontent.com/AlbusKen/shujuku/'+commit+'/'
 const manifest=JSON.parse(await limitedText(await request(base+'manifest.json',{redirect:'error',signal:AbortSignal.timeout(30000)}),200000))
 if(!manifest||typeof manifest.js!=='string'||!manifest.js||typeof manifest.version!=='string')throw Error('仓库缺少 SillyTavern manifest.json 入口或版本')
 const names=[manifest.js,...(manifest.css?[manifest.css]:[])];if(names.some(n=>typeof n!=='string'||!/^[\w./ -]+$/.test(n)||n.startsWith('/')||n.split('/').includes('..')))throw Error('扩展入口文件路径无效')
 const files={};for(const name of names){const text=await limitedText(await request(base+name.split('/').map(encodeURIComponent).join('/'),{redirect:'error',signal:AbortSignal.timeout(60000)}),24000000);files[name]={text,sha256:digest(text)}}
 return {repository:source.repository,ref,commit,manifest,files}
}
export function validateOriginalExtension(value){
 const source=githubExtensionSource(value?.repository,value?.ref),commit=String(value?.commit||'');if(!/^[0-9a-f]{40}$/.test(commit))throw Error('原扩展提交号无效')
 const manifest=value.manifest,files=value.files;if(!manifest||!files||typeof manifest.js!=='string'||typeof manifest.version!=='string')throw Error('原扩展缺少清单和代码')
 const entries=[manifest.js,...(manifest.css?[manifest.css]:[])];let size=0
 for(const name of entries){if(!/^[\w./ -]+$/.test(name)||name.startsWith('/')||name.split('/').includes('..'))throw Error('扩展入口文件路径无效');const file=files[name];if(!file||typeof file.text!=='string'||digest(file.text)!==file.sha256)throw Error('原扩展文件校验失败：'+name);size+=Buffer.byteLength(file.text)}
 if(size>32000000)throw Error('原扩展包超过 32 MB')
 return {repository:source.repository,ref:source.ref,commit,manifest:structuredClone(manifest),files:Object.fromEntries(entries.map(name=>[name,structuredClone(files[name])]))}
}
// SP 9.2.4/9.2.5 rebinds DDL names after its change detector. Persist that
// real change through the normal rebase transaction; keep scope-only validation.
export function projectOriginalDatabaseTemplateCommit(source, version) {
 if (!['9.2.4','9.2.5'].includes(version)) throw Error('SP '+version+' 模板提交适配尚未验证')
 const condition='else if (rebaseKeys.has(key)) {'
 if (!source.includes('function templatePersistentProjectionMatches_ACU(') || source.split(condition).length!==2) throw Error('SP '+version+' 模板提交适配锚点缺失或不唯一')
 return source.replace(condition, 'else if (rebaseKeys.has(key) || !templatePersistentProjectionMatches_ACU({ [key]: input.baselineData[key] }, { [key]: sheet })) {')
}
const scriptCache=new Map()
// The original event listener intentionally returns before its debounce timer.
// Track only the verified original pipeline timers, never arbitrary user scripts.
export function projectOriginalSpPendingWork(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' pending 工作适配尚未验证');
 const start=source.indexOf('async function handleNewMessageDebounced_ACU('),end=source.indexOf('// [重构] 核心触发逻辑',start),anchor='topLevelWindow_ACU.AutoCardUpdaterAPI = api;';
 if(start<0||end<start||source.split(anchor).length!==2)throw Error('SP '+version+' pending 工作适配锚点缺失');
 const part=source.slice(start,end),schedule='_set_autoFillDebounceTimer_ACU(setTimeout(async () => {';
 if(part.split(schedule).length!==2||part.split('clearTimeout(autoFillDebounceTimer_ACU);').length!==2)throw Error('SP '+version+' pending 工作适配锚点不唯一');
 source=source.slice(0,start)+part.replace('clearTimeout(autoFillDebounceTimer_ACU);','__dshCancelOriginalWork(autoFillDebounceTimer_ACU);').replace(schedule,'_set_autoFillDebounceTimer_ACU(__dshScheduleOriginalWork(async () => {')+source.slice(end);
 const hydration='const scheduledChatIdentifier_ACU = cleanChatName_ACU(chatFileName);',hydrateStart=source.indexOf(hydration),timerStart=source.indexOf('setTimeout(async () => {',hydrateStart);
 if(hydrateStart<0||timerStart<hydrateStart||timerStart-hydrateStart>500)throw Error('SP '+version+' pending 水合适配锚点缺失');
 source=source.slice(0,timerStart)+'__dshScheduleOriginalWork(async () => {'+source.slice(timerStart+'setTimeout(async () => {'.length);
 const followup='queueMicrotask(() => { void triggerAutomaticUpdateIfNeeded_ACU(followUpContext); });';
 if(source.includes(followup))source=source.replace(followup,'__dshScheduleOriginalWork(() => triggerAutomaticUpdateIfNeeded_ACU(followUpContext),0);');
 return source.replace(anchor,anchor+`
 const __dshOriginalWork=new Map();let __dshOriginalWorkDrains=0;
 function __dshScheduleOriginalWork(work,delay){
  let resolve;const settled=new Promise(done=>{resolve=done;});const entry={settled,resolve,running:false};
  const timer=setTimeout(async()=>{
   entry.running=true;let failure=null;try{await work();}catch(error){failure=error;}
   // A visible page that nobody is draining keeps the original timer's own
   // semantics: finished work leaves the ledger and its failure is reported
   // as the original's unhandled rejection, never swallowed or kept forever.
   const detached=topLevelWindow_ACU.__dshAwaitOriginalWork===false&&!__dshOriginalWorkDrains;
   if(detached&&__dshOriginalWork.get(timer)===entry)__dshOriginalWork.delete(timer);
   resolve(detached?null:failure);
   if(detached&&failure)throw failure;
  },delay);__dshOriginalWork.set(timer,entry);return timer;
 }
 function __dshCancelOriginalWork(timer){const entry=__dshOriginalWork.get(timer);if(entry&&!entry.running){clearTimeout(timer);entry.resolve(null);__dshOriginalWork.delete(timer);}else if(!entry)clearTimeout(timer);}
 Object.defineProperty(api,'__dshGetCurrentIsolationCode',{value:()=>getCurrentIsolationKey_ACU()});
 Object.defineProperty(api,'__dshPendingWork',{value:()=>__dshOriginalWork.size});
 Object.defineProperty(api,'__dshFlushPendingWork',{value:async()=>{let failure;__dshOriginalWorkDrains++;try{while(__dshOriginalWork.size){const batch=[...__dshOriginalWork];const results=await Promise.all(batch.map(([,entry])=>entry.settled));for(const [timer,entry]of batch)if(__dshOriginalWork.get(timer)===entry)__dshOriginalWork.delete(timer);failure ||= results.find(Boolean);}}finally{__dshOriginalWorkDrains--;}if(failure)throw failure;}});
 `);
}
// A failed automatic fill is silent in the original. When the update plan
// returns failed groups it only shows a toast its user can mute; when the plan
// throws (a table whose fill prompt cannot be built, a failed refresh) the
// trigger's own `finally { …; return; }` discards the exception. Both are
// reported as the script's own error: `reportError` reaches the frame's error
// listener and from there the script error center, whether or not an event is
// active (a console message during an event only travels with that event's
// receipt). The original's control flow is unchanged: the exception is rethrown.
// Optional: a build without these exact lines runs unprojected.
export function projectOriginalSpFillFailureReport(source){
 const emit='if (typeof globalThis.reportError === "function") globalThis.reportError(dshFillFailure); else console.error(dshFillFailure.message);'
 const returned='if (result.failedGroups > 0) {'
 if(source.split(returned).length===2)source=source.replace(returned,()=>returned+'\ntry { const dshFillFailure = new Error("[DSH] SP 自动填表有 " + result.failedGroups + " 组失败" + (Array.isArray(result.errors) && result.errors[0] ? "：" + String(result.errors[0]) : "")); '+emit+' } catch (_) {}')
 const call='result = await executeAutoUpdatePlan_ACU(',cleanup='clearAutoUpdateToast_ACU(autoProgressToast);'
 const start=source.indexOf(call),end=source.indexOf(cleanup)
 if(start<0||end<start||source.indexOf(call,start+1)>=0||source.indexOf(cleanup,end+1)>=0||/\bcatch\b/.test(source.slice(start,end)))return source
 const head=source.slice(0,end),tail=head.match(/\}\s*finally\s*\{\s*$/)
 if(!tail)return source
 return head.slice(0,tail.index)+'}\ncatch (dshFillError) { try { const dshFillFailure = new Error("[DSH] SP 自动填表失败：" + String(dshFillError && dshFillError.message || dshFillError)); '+emit+' } catch (_) {} throw dshFillError; }\nfinally {\n'+source.slice(end)
}
// Hidden columns describe a particular schema, just like DDL. When replay owns
// a different header from the guide, copying the guide's visibility metadata
// can create names which have no column in that replayed table. Accept the
// guide's list only when the original projection validates it against replay's
// schema; otherwise preserve the target's entire list. Never repair either one.
export function projectOriginalSpGuideStructuralMetadata(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' 指导表结构元数据适配尚未验证')
 const start='function applyGuideMetadataToSheet_ACU(targetSheet, guideSheet, options) {',offset=source.indexOf(start),validator='function getSheetColumnProjection_ACU(sheet) {'
 if(offset<0||source.indexOf(start,offset+start.length)>=0||source.split(validator).length!==2)throw Error('SP '+version+' 指导表结构元数据适配锚点缺失或不唯一')
 const end=source.indexOf('\n    }',offset)+6,body=source.slice(offset,end),anchor="if (key === 'ddl')"
 if(end<=offset||body.split(anchor).length!==2)throw Error('SP '+version+' 指导表结构元数据字段锚点缺失或不唯一')
 return source.slice(0,offset)+body.replace(anchor,`if (key === 'hiddenPhysicalColumns' && !options.inheritDdl) {
                    try { getSheetColumnProjection_ACU({ ...targetSheet, sourceData: { ...targetSourceData, hiddenPhysicalColumns: value } }); }
                    catch (_) { return; }
                }
                if (key === 'ddl')`)+source.slice(end)
}
// These original serializers used a whole-string whitespace replacement,
// changing DEFAULT/CHECK literals while rebuilding a sheet's DDL. Normalize
// only SQL layout; quoted values/identifiers and comments retain their bytes.
export function projectOriginalSpSqlDefinitionWhitespace(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' SQL 定义空白适配尚未验证')
 const replacements=[
  ['function parseDDLColumnInfos_ACU(ddl) {',"normalizedDefinition: definition.replace(/\\s+/g, ' ').trim(),",'normalizedDefinition: __dshNormalizeSqlDefinitionWhitespace_ACU(definition),'],
  ['function parseDDLTableConstraints_ACU(ddl) {',".map(definition => stripSqlLineComments_ACU(definition).replace(/\\s+/g, ' ').trim())",'.map(definition => __dshNormalizeSqlDefinitionWhitespace_ACU(stripSqlLineComments_ACU(definition)))'],
 ]
 for(const [start,anchor,replacement] of replacements){
  const offset=source.indexOf(start),end=source.indexOf('\n    }',offset)+6,body=source.slice(offset,end)
  if(source.split(start).length!==2||end<=offset||body.split(anchor).length!==2)throw Error('SP '+version+' SQL 定义空白适配锚点缺失或不唯一')
  source=source.slice(0,offset)+body.replace(anchor,replacement)+source.slice(end)
 }
 const helper=`function __dshNormalizeSqlDefinitionWhitespace_ACU(value) {
        const input = String(value);
        let result = '', quote = '', pendingSpace = false, lineComment = false, blockComment = false;
        for (let index = 0; index < input.length; index += 1) {
            const char = input[index], next = input[index + 1];
            if (lineComment) {
                result += char;
                if (char === '\\n') lineComment = false;
                continue;
            }
            if (blockComment) {
                result += char;
                if (char === '*' && next === '/') { result += next; index += 1; blockComment = false; }
                continue;
            }
            if (quote) {
                result += char;
                if (char === quote) {
                    if (quote !== ']' && next === quote) { result += next; index += 1; }
                    else quote = '';
                }
                continue;
            }
            if (/\\s/.test(char)) { pendingSpace = true; continue; }
            if (pendingSpace && result) result += ' ';
            pendingSpace = false;
            result += char;
            if (char === '-' && next === '-') { result += next; index += 1; lineComment = true; }
            else if (char === '/' && next === '*') { result += next; index += 1; blockComment = true; }
            else if (char === "'" || char === '"' || char === '\x60' || char === '[') quote = char === '[' ? ']' : char;
        }
        // Never turn an unterminated token into a different candidate statement.
        return quote || blockComment ? input : result;
    }
    `
 return source.replace(replacements[0][0],helper+replacements[0][0])
}
// Native reconciliation keeps dormant columns in content while retaining the
// narrower template DDL. Give those proven trailing columns a runtime-only SQL
// representation before hydration and subsequent SQLite reconciliation; never
// rewrite the source snapshot/template to make it pass the schema contract.
export function projectOriginalSpNativeRetainedColumns(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' 原生休眠列物化适配尚未验证')
 const start='function resolveEffectiveDDL(sheet, fallbackTableName, runtimeTableName) {',offset=source.indexOf(start)
 const required=[start,'function resolveInsertColumnMappings(sheet, headers, ddlOverride) {','function getSheetColumnProjection_ACU(sheet) {','function findCreateTableDefinitionBounds_ACU(value) {','function splitColumnDefinitions(body) {','function parseDDLColumnNames(ddl) {','function parseDDLColumnComments(ddl) {','function skipSqlTrivia_ACU(value, start) {','function reserveSqlName_ACU(baseName, usedSqlNames) {','function toSqlIdentifierBase_ACU(displayName, index = 0) {']
 if(required.some(anchor=>source.split(anchor).length!==2))throw Error('SP '+version+' 原生休眠列物化适配锚点缺失或不唯一')
 const end=source.indexOf('\n    }',offset)+6,body=source.slice(offset,end),ddl='const normalizedDDL = normalizeSqlStructure(originalDDL);',effective='const effectiveDDL = runtimeTableName',explicit="source: 'explicit',",fallback="if (resolvedDDL.source !== 'explicit' || !allowRuntimeDdlFallback ||"
 if(end<=offset||body.split(ddl).length!==2||body.split(effective).length!==2||body.split(explicit).length!==2||source.split(fallback).length!==2)throw Error('SP '+version+' 原生休眠列 DDL 适配锚点缺失或不唯一')
 const reconcile='function reconcileMatchedSheet_ACU(before, template, sheetKey, templateSheetKey, contract) {',reconcileOffset=source.indexOf(reconcile),reconcileEnd=source.indexOf('\n    }',reconcileOffset)+6,reconcileBody=source.slice(reconcileOffset,reconcileEnd)
 const beforeColumns="const beforeColumns = sqlite ? parseDDLColumnInfos_ACU(String(before.sourceData?.ddl || '')) : [];",widthGate='if (sqlite && (beforeColumns.length !== beforeHeaders.length || targetColumns.length !== targetHeaders.length))'
 if(source.split(reconcile).length!==2||reconcileEnd<=reconcileOffset||reconcileBody.split(beforeColumns).length!==2||reconcileBody.split(widthGate).length!==2)throw Error('SP '+version+' 原生休眠列协调适配锚点缺失或不唯一')
 const chatReconcile='async function reconcileChatTemplate_ACU(input) {',chatOffset=source.indexOf(chatReconcile),chatEnd=source.indexOf('\n    }',chatOffset)+6,chatBody=source.slice(chatOffset,chatEnd)
 const blockers='const blockers = [];',matched="const reconciled = reconcileMatchedSheet_ACU(previous.sheet, templateEntry.sheet, previous.key, templateEntry.key, input.storageMode === 'native' ? 'native' : 'sqlite');",hydrate='await hydrateTableDataStrict_ACU(candidateData, { allowRuntimeDdlFallback: true });'
 if(source.split(chatReconcile).length!==2||chatEnd<=chatOffset||[blockers,matched,hydrate].some(anchor=>chatBody.split(anchor).length!==2))throw Error('SP '+version+' 原生休眠列协调水合适配锚点缺失或不唯一')
 const helper=`function __dshPreserveNativeRetainedColumns_ACU(sheet, ddl, headers, columns) {
        const mappings = resolveInsertColumnMappings({ ...sheet, content: [headers] }, headers, ddl);
        const mapped = new Set(mappings.map(mapping => mapping.sourceIndex));
        const missing = headers.map((_, index) => index).filter(index => !mapped.has(index));
        const hidden = sheet.sourceData?.hiddenPhysicalColumns;
        const hiddenNames = new Set(Array.isArray(hidden) ? hidden.map(name => String(name ?? '').trim().toLowerCase()) : []);
        if (!missing.some(index => hiddenNames.has(headers[index].toLowerCase()))) return ddl;
        // A pre-existing invalid list is not a mode-conversion license to repair it.
        getSheetColumnProjection_ACU(sheet);
        if (mappings.length !== columns.length || !mappings.every((mapping, index) => mapping.sourceIndex === index)
            || missing.some((index, position) => index !== columns.length + position || !hiddenNames.has(headers[index].toLowerCase())
                || headers[index] !== headers[index].trim() || /[\\r\\n]/.test(headers[index])
                || columns.some(column => column.sqlName.toLowerCase() === headers[index].toLowerCase()))) {
            throw new Error('原生休眠列与 DDL 无法无歧义对齐，已拒绝丢弃列。');
        }
        const bounds = findCreateTableDefinitionBounds_ACU(ddl);
        if (!bounds) throw new Error('原生休眠列缺少可验证的 DDL 边界。');
        const used = new Set(columns.map(column => column.sqlName.toLowerCase()));
        const additions = missing.map(index => ({
            name: reserveSqlName_ACU(toSqlIdentifierBase_ACU(headers[index], index), used),
            header: headers[index]
        }));
        // Preserve all existing SQL bytes, including default literals, comments,
        // constraints, and suffixes. Insert before table constraints, never after.
        const parts = splitColumnDefinitions(ddl.slice(bounds.openingIndex + 1, bounds.closingIndex));
        let position = bounds.openingIndex + 1, insertion = bounds.closingIndex, beforeConstraint = false;
        for (const part of parts) {
            const trivia = skipSqlTrivia_ACU(part, 0);
            if (/^(?:PRIMARY\\s+KEY|FOREIGN\\s+KEY|UNIQUE|CHECK|CONSTRAINT)\\b/i.test(part.slice(trivia))) {
                insertion = position + trivia; beforeConstraint = true; break;
            }
            position += part.length + 1;
        }
        const added = additions.map((column, index) => column.name + ' TEXT'
            + (beforeConstraint || index < additions.length - 1 ? ',' : '') + ' -- ' + column.header).join('\\n');
        const expanded = ddl.slice(0, insertion) + (beforeConstraint ? '\\n' : ',\\n') + added + '\\n' + ddl.slice(insertion);
        // The export path reads display names from SQL comments. Prove exact
        // round-trip names before creating anything; never silently trim them.
        const physicalNames = parseDDLColumnNames(expanded), comments = parseDDLColumnComments(expanded);
        if (physicalNames.length !== headers.length || physicalNames.some((name, index) =>
            (name === 'row_id' ? 'row_id' : comments.get(name) || name) !== headers[index])) {
            throw new Error('原生休眠列的显示名无法经 DDL 原样回读，已拒绝改名。');
        }
        return expanded;
    }
    `
 const patched=body.replace(ddl,'let normalizedDDL = normalizeSqlStructure(originalDDL);').replace(effective,'const dshRetainedDDL = __dshPreserveNativeRetainedColumns_ACU(sheet, normalizedDDL, safeHeaders, columns);\n            const dshRetainedColumns = dshRetainedDDL !== normalizedDDL;\n            normalizedDDL = dshRetainedDDL;\n            '+effective).replace(explicit,explicit+'\n                dshRetainedColumns,')
 // An augmented CREATE failure must not fall back to an all-TEXT schema and
 // silently discard the explicit constraints we promised to preserve.
 // Reuse precisely the hydration proof for the old sheet's column descriptors.
 // The original width gate still validates both sides, including unproved old
 // columns and all target-template mismatches. The original reconciler owns
 // the output DDL, hidden list, rows and audit; neither input object is changed.
 const reconciled=reconcileBody.replace(beforeColumns,beforeColumns.replace('const beforeColumns','let beforeColumns')+`
        if (sqlite && beforeColumns.length !== beforeHeaders.length) {
            const dshBeforeDDL = __dshPreserveNativeRetainedColumns_ACU(before, String(before.sourceData?.ddl || ''), beforeHeaders, beforeColumns);
            beforeColumns = parseDDLColumnInfos_ACU(dshBeforeDDL);
        }`)
 // Only a successful reconciliation of an originally mismatched old schema
 // can reach this flag: that call has just completed the shared retained-column
 // proof. Its newly supported transaction must validate the complete candidate
 // without discarding constraints through TEXT fallback. Existing transactions
 // retain the original fallback policy. This flag never enters a saved sheet.
 const strictChat=chatBody.replace(blockers,blockers+'\n        let dshStrictRetainedSchema = false;').replace(matched,matched+`
                if (input.storageMode !== 'native' && parseDDLColumnInfos_ACU(String(previous.sheet.sourceData?.ddl || '')).length !== headers_ACU(previous.sheet).length) {
                    dshStrictRetainedSchema = true;
                }`).replace(hydrate,'await hydrateTableDataStrict_ACU(candidateData, { allowRuntimeDdlFallback: !dshStrictRetainedSchema });')
 return projectOriginalSpSqlDefinitionWhitespace((source.slice(0,offset)+helper+patched+source.slice(end)).replace(reconcileBody,reconciled).replace(chatBody,strictChat).replace(fallback,"if (resolvedDDL.dshRetainedColumns === true || resolvedDDL.source !== 'explicit' || !allowRuntimeDdlFallback ||"),version)
}
export function projectOriginalSpRollbackCheckpoint(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' 回退 checkpoint 适配尚未验证')
 const anchor='topLevelWindow_ACU.AutoCardUpdaterAPI = api;'
 const boundaryAnchor='const hasExistingBoundaryCheckpoint = hasV2CompactionCheckpointAtIndex_ACU(chat, isolationKey, boundaryAnchorIndex);'
 if(source.split(anchor).length!==2||source.split(boundaryAnchor).length!==2||!source.includes('async function ensureV2BoundaryCheckpointForRetainedBufferCore_ACU('))throw Error('SP '+version+' 回退 checkpoint 适配锚点缺失或不唯一')
 const saveBoundary='if ((changed || downgradedCount > 0 || obsoleteInitDowngradedCount > 0) && options.save !== false) {';
 if(source.split(saveBoundary).length!==2)throw Error('SP '+version+' 回退 checkpoint 保存证明锚点缺失或不唯一');
 source=source.replace(saveBoundary,'if (typeof options.dshVerifyRollbackCheckpoint === "function") await options.dshVerifyRollbackCheckpoint();\n'+saveBoundary);
 const migrationStart=source.indexOf('async function migrateLegacyStorageToV2OnLoad_ACU('),migrationEnd=source.indexOf('async function ensureLegacyStorageMigratedBeforeWrite_ACU(',migrationStart)
 if(migrationStart<0||migrationEnd<migrationStart)throw Error('SP '+version+' 旧存储迁移适配锚点缺失')
 const migration=source.slice(migrationStart,migrationEnd).replace(/chat\.splice\(0, chat\.length, \.\.\.(keepV2Chat|chatBeforeKeepV2|candidateChat|originalChat)\);/g,(_match,name)=>'__dshCommitSpMigrationInPlace(chat, '+name+');')
 source=source.slice(0,migrationStart)+migration+source.slice(migrationEnd)
 return source.replace(boundaryAnchor,'const hasExistingBoundaryCheckpoint = !__dshRollbackMaterializing && hasV2CompactionCheckpointAtIndex_ACU(chat, isolationKey, boundaryAnchorIndex);').replace(anchor,anchor+`\nvar __dshRollbackMaterializing=false;
 function __dshCommitSpMigrationInPlace(chat,candidate){
  const keys=['TavernDB_ACU_IsolatedData','TavernDB_ACU_IndependentData','TavernDB_ACU_Data','TavernDB_ACU_SummaryData','TavernDB_ACU_Identity','TavernDB_ACU_LocalMessageAnchor','TavernDB_ACU_ModifiedKeys','TavernDB_ACU_UpdateGroupKeys','_acu_local_template_base_state_seeded'];
  const body=row=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!keys.includes(key)));
  if(chat.length!==candidate.length||chat.some((row,index)=>JSON.stringify(body(row))!==JSON.stringify(body(candidate[index]))))throw new Error('SP 原包迁移不能更改历史正文、身份或楼层顺序');
  const fields=candidate.map(row=>Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(row,key)).map(key=>[key,structuredClone(row[key])])));
  for(let index=0;index<chat.length;index++){for(const key of keys)delete chat[index][key];Object.assign(chat[index],fields[index]);}
 }
 function __dshRollbackProof(chat,key,index){
  return (async()=>{
   const read=await loadTableStateFromFramesV2Detailed_ACU(chat,key,{maxMessageIndex:index,updateRuntimeState:false});
   if(!read||!read.data||typeof read.data!=='object'||Array.isArray(read.data))throw new Error('SP 原包回读缺少 checkpoint 证明，原始恢复副本已保留');
   const lifecycle=deriveSheetLifecycleFromFramesV2_ACU(chat,key,{maxMessageIndex:index});
   if(!lifecycle||!Array.isArray(lifecycle.hiddenSheetKeys)||lifecycle.indeterminateSheetKeys?.length)throw new Error('SP 原包隐藏表回读证明不完整，原始恢复副本已保留');
   const hidden={};for(const sheet of lifecycle.hiddenSheetKeys){const data=lifecycle.statusBySheetKey?.[sheet]?.restoreSourceData;if(!data||typeof data!=='object')throw new Error('SP 原包隐藏表回读证明缺失，原始恢复副本已保留');hidden[sheet]=data;}
   return {data:getTableDataFingerprint_ACU(read.data),hidden:getTableDataFingerprint_ACU(hidden)};
  })();
 }
 Object.defineProperty(api,'__dshMaterializeRollbackCheckpoint',{value:async function(){
 const chat=getChatArray_ACU(),index=getLatestAiMessageIndexFromChat_ACU(chat);
 if(index<0)throw new Error('SP 原包没有可承载 checkpoint 的 AI 楼层');
 if(hasActiveProvisionalBridgeAnywhere_ACU(chat)){const recovery=await recoverProvisionalBridgeSession_ACU({isolationKey:getCurrentIsolationKey_ACU()});if(!recovery.ok)throw new Error(recovery.error||'SP 原包活动恢复事务未完成');}
 const flush=await flushRuntimeOnlyPendingChanges_ACU('dsh_rollback_checkpoint');
 if(flush.error)throw new Error(flush.error);
 const live=structuredClone(currentJsonTableData_ACU),currentKey=getCurrentIsolationKey_ACU(),originalChat=structuredClone(chat);
 let receipt;
 const result=await runTableWriteTransaction_ACU({source:'system_cleanup',reason:'dsh_rollback_checkpoint',isolationKey:currentKey,writeSet:[{kind:'all'}],maintenanceMode:'exclusive'},async()=>{
  try{
   const keys=new Set(collectIsolationKeysWithV2Frames_ACU(chat));
   for(const message of chat){if(!message||message.is_user)continue;for(const key of Object.keys(message.TavernDB_ACU_IsolatedData||{}))keys.add(key);const identity=message.TavernDB_ACU_Identity||'';if(hasLegacyTopLevelTableData_ACU(message,{enabled:identity!=='',code:identity}))keys.add(identity);}
   // A stored current scope is proved like every other scope. A current scope
   // with nothing stored at all (an isolation code switched to but never filled;
   // the original's own flush above found nothing pending for it) has nothing to
   // materialize: the original writes no checkpoint for it and keeps showing the
   // previous scope's tables in memory until it reloads.
   const currentStored=keys.has(currentKey);
   const originalIsolation={enabled:settings_ACU.dataIsolationEnabled,code:settings_ACU.dataIsolationCode},runtimeData=structuredClone(currentJsonTableData_ACU);
   try{for(const key of keys){const config={enabled:key!=='',code:key};if(resolveTableStorageStrategy_ACU(chat,key,config).mode!=='legacy-v1')continue;settings_ACU.dataIsolationEnabled=key!=='';settings_ACU.dataIsolationCode=key;const migration=await ensureLegacyStorageMigratedBeforeWrite_ACU('dsh_rollback_checkpoint');if(!migration.success)throw new Error(migration.error||'SP 原包旧格式迁移失败');}}
   finally{settings_ACU.dataIsolationEnabled=originalIsolation.enabled;settings_ACU.dataIsolationCode=originalIsolation.code;_set_currentJsonTableData_ACU(runtimeData);}
   const before=new Map();for(const key of keys)before.set(key,await __dshRollbackProof(chat,key,index));
   const liveFingerprint=getTableDataFingerprint_ACU(live);
   if(currentStored&&(!liveFingerprint||before.get(currentKey).data!==liveFingerprint))throw new Error('SP 原包运行态与回读指纹不一致，原始恢复副本已保留');
   const verifyCheckpoint=async()=>{
   const slots=chat[index]?.TavernDB_ACU_IsolatedData;
   if(!slots||typeof slots!=='object'||Array.isArray(slots)||Object.keys(slots).length!==keys.size||[...keys].some(key=>slots[key]?.storageFrame?.version!==2||slots[key].storageFrame.checkpoint?.kind!=='full'))throw new Error('SP 原包未生成完整回退 checkpoint，原始恢复副本已保留');
   // Verify the new root in isolation: older floors must not conceal lost hidden
   // recovery data or a missing scope in the materialized checkpoint.
   const retained=structuredClone(chat);for(let n=0;n<retained.length;n++)if(n!==index){for(const key of ['TavernDB_ACU_IsolatedData','TavernDB_ACU_IndependentData','TavernDB_ACU_Data','TavernDB_ACU_SummaryData'])delete retained[n][key];}
   const proofs=[];for(const key of keys){const expected=before.get(key),verified=await __dshRollbackProof(retained,key,index);if(!verified.data||expected.data!==verified.data||expected.hidden!==verified.hidden)throw new Error('SP 原包 checkpoint 回读指纹不一致，原始恢复副本已保留');proofs.push({isolationCode:key,liveFingerprint:expected.data,persistedFingerprint:verified.data,hiddenFingerprint:expected.hidden,persistedHiddenFingerprint:verified.hidden});}
   receipt=currentStored?{liveFingerprint,persistedFingerprint:proofs.find(row=>row.isolationCode===currentKey).persistedFingerprint,proofs}:{liveFingerprint:'unstored-scope',persistedFingerprint:'unstored-scope',unstoredIsolationCode:currentKey,runtimeFingerprint:liveFingerprint,proofs};
   };
   let materialized;__dshRollbackMaterializing=true;
   try{materialized=await ensureV2BoundaryCheckpointForRetainedBufferCore_ACU(chat,{shouldRotateCheckpoint:true,indicesToPurge:[0],anchorIndex:index},{save:true,dshVerifyRollbackCheckpoint:verifyCheckpoint},'compaction');}
   finally{__dshRollbackMaterializing=false;_set_currentJsonTableData_ACU(live);}
   if(!materialized?.success)throw new Error(materialized?.error||'SP 原包 checkpoint 物化失败');
   if(!receipt)throw new Error('SP 原包回读证明未执行，原始恢复副本已保留');
   return materialized;
  }catch(error){__dshCommitSpMigrationInPlace(chat,originalChat);_set_currentJsonTableData_ACU(live);throw error;}
 });
 if(!result?.success)throw new Error(result?.error||'SP 原包 checkpoint 物化失败');
 resetCheckpointVault_ACU();
 return {success:true,materialized:true,messageIndex:index,changed:result.changed===true,receipt};
}});`)
}
export function assertOriginalSpRollbackReceipt(result){
 const proof=result?.receipt;
 if(result?.success!==true||result.materialized!==true||!proof||typeof proof.liveFingerprint!=='string'||!proof.liveFingerprint||proof.liveFingerprint!==proof.persistedFingerprint||!Array.isArray(proof.proofs)||!proof.proofs.length||proof.proofs.some(row=>typeof row.isolationCode!=='string'||!row.liveFingerprint||row.liveFingerprint!==row.persistedFingerprint||!row.hiddenFingerprint||row.hiddenFingerprint!==row.persistedHiddenFingerprint))throw new Error('SP 原包回退证明缺失或指纹不一致；当前剧情与原始恢复副本已保留');
 return result;
}
// 1.7: rollback deletes the latest floors the way the host deletes messages in
// SillyTavern. The original's own delete guard grafts what those floors carry
// (replay roots, per-sheet checkpoints) onto survivors from its live vault; the
// floors' own logs are not restored, so their fills are undone by its replay.
// A rollback recreates the frames (a new lifecycle) and with them the vault, so
// the live instance computes this before the commit and returns the survivors'
// changed fields instead of saving; the host commits them with the rollback.
export function projectOriginalSpRollbackDeletion(source,version){
 if(!['9.2.4','9.2.5'].includes(version))throw Error('SP '+version+' 回退删楼适配尚未验证')
 const anchor='topLevelWindow_ACU.AutoCardUpdaterAPI = api;'
 const save=/await saveChatToHostStrict_ACU\(\);(\s*)captureCheckpointVaultForCurrentChat_ACU\(chat\);(\s*)logWarn_ACU\(`\[删楼守卫\] 删楼 checkpoint 前移恢复完成/g
 const required=['async function recoverLostCheckpointsAfterMessageDeletion_ACU(','function captureCheckpointVaultForCurrentChat_ACU(','function resetCheckpointVault_ACU(','const MESSAGE_TABLE_FIELDS_ACU','function __dshCommitSpMigrationInPlace(']
 if(source.split(anchor).length!==2||(source.match(save)||[]).length!==1||required.some(text=>!source.includes(text)))throw Error('SP '+version+' 回退删楼适配锚点缺失或不唯一')
 return source.replace(save,(match,first,second)=>'if (!__dshRollbackDeleting) await saveChatToHostStrict_ACU();'+first+'captureCheckpointVaultForCurrentChat_ACU(chat);'+second+'logWarn_ACU(`[删楼守卫] 删楼 checkpoint 前移恢复完成').replace(anchor,anchor+`\nvar __dshRollbackDeleting=false;
 function __dshStableJson(value){return JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item)}
 function __dshFloorFields(row){const fields={};for(const key of MESSAGE_TABLE_FIELDS_ACU)if(row&&Object.prototype.hasOwnProperty.call(row,key))fields[key]=structuredClone(row[key]);return fields}
 Object.defineProperty(api,'__dshDeleteRollbackFloors',{value:async function(request){
  const chat=getChatArray_ACU(),keep=Number(request?.keep);
  if(!Number.isSafeInteger(keep)||keep<1||keep>=chat.length)throw new Error('SP 原包回退删楼范围无效');
  if(hasActiveProvisionalBridgeAnywhere_ACU(chat)){const recovery=await recoverProvisionalBridgeSession_ACU({isolationKey:getCurrentIsolationKey_ACU()});if(!recovery.ok)throw new Error(recovery.error||'SP 原包活动恢复事务未完成');}
  const flush=await flushRuntimeOnlyPendingChanges_ACU('dsh_rollback_delete');
  if(flush.error)throw new Error(flush.error);
  const live=structuredClone(currentJsonTableData_ACU),originalChat=structuredClone(chat),before=chat.slice(0,keep).map(row=>__dshStableJson(__dshFloorFields(row)));
  captureCheckpointVaultForCurrentChat_ACU(chat);
  const removed=chat.splice(keep);
  let recovery;const changed=[],proofs=[];
  __dshRollbackDeleting=true;
  try{
   recovery=await recoverLostCheckpointsAfterMessageDeletion_ACU();
   if(recovery?.error)throw new Error('SP 原包删楼 checkpoint 前移失败：'+recovery.error);
   for(let index=0;index<keep;index++){const fields=__dshFloorFields(chat[index]);if(__dshStableJson(fields)!==before[index])changed.push({index,user:Boolean(chat[index]?.is_user),before:before[index],fields});}
   for(const key of collectIsolationKeysWithV2Frames_ACU(chat)){const read=await loadTableStateFromFramesV2Detailed_ACU(chat,key,{maxMessageIndex:keep-1,updateRuntimeState:false});proofs.push({isolationCode:key,fingerprint:read?.data&&typeof read.data==='object'&&!Array.isArray(read.data)?getTableDataFingerprint_ACU(read.data):''});}
  }finally{
   __dshRollbackDeleting=false;
   chat.push(...removed);
   __dshCommitSpMigrationInPlace(chat,originalChat);
   _set_currentJsonTableData_ACU(live);
   resetCheckpointVault_ACU();captureCheckpointVaultForCurrentChat_ACU(chat);
  }
  return {success:true,deletion:true,kept:keep,deleted:removed.length,recovered:recovery?.recovered===true,graftedCount:Number(recovery?.graftedCount)||0,changed,proofs};
 }});`)
}
export function assertOriginalSpDeletionReceipt(result,keep){
 const valid=result?.success===true&&result.deletion===true&&result.kept===keep&&Number.isSafeInteger(result.deleted)&&result.deleted>0&&Array.isArray(result.changed)&&Array.isArray(result.proofs)
  &&result.changed.every(row=>Number.isSafeInteger(row?.index)&&row.index>=0&&row.index<keep&&typeof row.before==='string'&&row.fields&&typeof row.fields==='object'&&!Array.isArray(row.fields))
  &&result.proofs.every(row=>typeof row?.isolationCode==='string'&&typeof row.fingerprint==='string')
 if(!valid)throw Error('SP 原包删楼回执不完整，未回退；当前剧情与原始恢复副本已保留')
 return result
}
export function originalExtensionScript(original){
 if(!original)return null
 const key=digest(JSON.stringify([original.commit,original.manifest,Object.entries(original.files).map(([path,file])=>[path,file.sha256])]));if(scriptCache.has(key))return scriptCache.get(key)
 let source,rollbackAdapterError,deletionAdapterError;try{source=projectOriginalDatabaseTemplateCommit(original.files[original.manifest.js].text,original.manifest.version);source=projectOriginalSpPendingWork(source,original.manifest.version);source=projectOriginalSpFillFailureReport(source);source=projectOriginalSpGuideStructuralMetadata(source,original.manifest.version);source=projectOriginalSpNativeRetainedColumns(source,original.manifest.version);try{source=projectOriginalSpRollbackCheckpoint(source,original.manifest.version)}catch(error){rollbackAdapterError=error.message}if(rollbackAdapterError)deletionAdapterError=rollbackAdapterError;else try{source=projectOriginalSpRollbackDeletion(source,original.manifest.version)}catch(error){deletionAdapterError=error.message}source=projectTavernHostScript(source,{storageOwner:true})}catch(error){source='throw new Error('+JSON.stringify(error.message)+');'}
 const style=original.manifest.css?original.files[original.manifest.css].text:''
 const content='/* tavernOriginalUi: extension-sp-database */\nconst __dshUiStorage=globalThis.__dshTavernStorageFor(getScriptId());\nawait globalThis.__dshInstallExtensionHost('+JSON.stringify({id:'sp-database',name:original.manifest.display_name,version:original.manifest.version,commit:original.commit,style})+');\nconst window=globalThis.__dshExtensionWindow,parent=window,top=window,self=window;const $=window.jQuery,jQuery=$;\n'+source+'\nawait globalThis.__dshConnectOriginalDatabase();\neventOn("DSH_SP_DRAIN",()=>{});\neventOn("DSH_SP_ROLLBACK_CHECKPOINT",async request=>{'+(rollbackAdapterError?'throw new Error('+JSON.stringify(rollbackAdapterError)+');':'request.receipt=await window.AutoCardUpdaterAPI.__dshMaterializeRollbackCheckpoint();')+'});\neventOn("DSH_SP_ROLLBACK_DELETE",async request=>{'+(deletionAdapterError?'throw new Error('+JSON.stringify(deletionAdapterError)+');':'request.receipt=await window.AutoCardUpdaterAPI.__dshDeleteRollbackFloors(request);')+'});'
 const script={type:'script',id:'extension-sp-database',name:original.manifest.display_name||'SP·数据库',enabled:true,content,scope:'extension',extension:true,data:{}}
 if(scriptCache.size>=2)scriptCache.delete(scriptCache.keys().next().value);scriptCache.set(key,script);return script
}
