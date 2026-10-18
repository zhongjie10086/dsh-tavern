import {originalSpTableFields,originalSp129MaterialFields,originalSp129CarrierFields} from './sp-original-fields.js'
// SP 1.2.9 recovery adapter. Native replay/writers remain the authority.
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit)}
function matches(root,predicate){const found=[];walk(root,n=>{if(predicate(n))found.push(n)});return found}
function only(rows,label){if(rows.length!==1)throw Error('SP 1.2.9 '+label+' 结构缺失或不唯一');return rows[0]}
const migrationFields=originalSpTableFields;
export function describeSp129ReadbackConflict(chat,expectedChatId,identities,fields,currentChat,currentChatId){
 try{
  if(currentChat!==chat)return 'array_reference_changed';
  if(currentChatId!==expectedChatId)return 'chat_id_changed';
  if(chat.length<identities.length)return 'floor_count_shrank';
  const summary=value=>{const input=String(value);let hash=2166136261;for(let i=0;i<input.length;i++)hash=Math.imul(hash^input.charCodeAt(i),16777619);return input.length+':'+(hash>>>0).toString(16)};
  for(let index=0;index<identities.length;index++){
   const row=chat[index],serialized=JSON.stringify([!!row&&typeof row==='object',row?.message_id,row?.is_user,row?.is_system]);
   if(serialized!==identities[index]){
    const expected=JSON.parse(identities[index]),actual=JSON.parse(serialized),names=['is_object','message_id','is_user','is_system'];
    const component=actual.findIndex((value,i)=>JSON.stringify(value)!==JSON.stringify(expected[i]));
    const describe=value=>(value===null?'null':typeof value)+':'+summary(JSON.stringify(value));
    return 'floor_identity_changed index='+index+' identity_component='+names[component]+' expected_type_summary='+describe(expected[component])+' actual_type_summary='+describe(actual[component]);
   }
  }
  const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  for(const field of fields){const row=chat[field.index],existed=!!row&&Object.prototype.hasOwnProperty.call(row,field.key);const label=' index='+field.index+' field='+field.key;if(!row)return 'private_floor_missing'+label;if(existed!==field.existed)return 'private_presence_changed'+label+' expected='+field.existed+' actual='+existed;const actual=JSON.stringify(row[field.key]);if(actual!==field.content){let orderOnly=false;try{orderOnly=canonical(JSON.parse(field.content))===canonical(JSON.parse(actual))}catch(_){}return 'private_value_changed'+label+' object_key_order_only='+orderOnly+' expected_summary='+summary(field.content)+' actual_summary='+summary(actual);}}
  return 'guard_mismatch_unclassified';
 }catch(_){return 'diagnostic_unavailable';}
}
export function adaptSp129Recovery(ctx){
 const fn=name=>ctx.function(name),text=n=>ctx.text(n);
 const persist=fn('persistTableMutationLogV2Core_ACU');
 const intact=only(matches(persist,n=>n.type==='VariableDeclarator'&&n.id.name==='fieldsIntact'),'save readback guard');
 const arrayCheck=only(matches(intact.init,n=>n.type==='BinaryExpression'&&n.operator==='==='&&n.left.type==='CallExpression'&&n.left.callee.name==='getChatArray_ACU'),'save chat reference');
 const idCheck=only(matches(intact.init,n=>n.type==='BinaryExpression'&&n.operator==='==='&&n.left.type==='CallExpression'&&n.left.callee.name==='getActiveChatStorageIdentity_ACU'),'save chat identity');
 const every=matches(intact.init,n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='every');
 const privateCheck=only(every.filter(n=>matches(n.arguments[0],x=>x.type==='MemberExpression'&&x.property.name==='content').length),'private readback snapshot');
 const floorCheck=only(every.filter(n=>n!==privateCheck),'floor readback snapshot');
 const conflict=only(matches(persist,n=>n.type==='Literal'&&n.value==='table mutation save readback conflict: chat, floor identity or private fields changed.'),'readback error');
 ctx.replace(conflict,text(conflict)+"+' ['+__dshDescribeSp129ReadbackConflict("+[text(arrayCheck.right),text(idCheck.right),text(floorCheck.callee.object),text(privateCheck.callee.object),text(arrayCheck.left),text(idCheck.left)].join(',')+")+']'");
 ctx.insert(ctx.root.start+1,describeSp129ReadbackConflict.toString().replace('function describeSp129ReadbackConflict','function __dshDescribeSp129ReadbackConflict'));
 const boundary=fn('ensureV2BoundaryCheckpointForRetainedBufferCore_ACU');
 const nativeBoundary=only(matches(boundary,n=>n.type==='FunctionExpression'&&n.id?.name==='writeV2BoundaryCheckpointBeforePurge_ACU'),'native boundary writer');
 const existing=only(matches(nativeBoundary,n=>n.type==='CallExpression'&&n.callee.name==='hasV2CompactionCheckpointAtIndex_ACU'),'boundary existence check');
 ctx.replace(existing,'(!__dshRollbackMaterializing&&'+text(existing)+')');
 const saves=matches(boundary,n=>n.type==='CallExpression'&&n.callee.name==='saveChatToHostStrict_ACU');
 const save=only(saves,'boundary save');
 // The minified writer uses a LogicalExpression save guard. Verify before the
 // guard so unchanged native boundary results also require independent proof.
 const guard=only(matches(boundary,n=>n.type==='ExpressionStatement'&&n.start<=save.start&&n.end>=save.end),'boundary save statement');
 const options=boundary.params[2];if(options?.type!=='AssignmentPattern'||options.left.type!=='Identifier')throw Error('SP 1.2.9 boundary options contract changed');
 ctx.insert(guard.start,'if(typeof '+options.left.name+'.dshVerifyRollbackCheckpoint==="function")await '+options.left.name+'.dshVerifyRollbackCheckpoint();');
 for(const name of ['migrateLegacyStorageToV2OnLoad_ACU','commitMixedStorageDecision_ACU']){
  const migration=fn(name);const splices=matches(migration,n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='splice'&&n.arguments.length===3&&n.arguments[0].value===0&&n.arguments[2].type==='SpreadElement');
  if(splices.length!==4&&name==='migrateLegacyStorageToV2OnLoad_ACU'||splices.length!==2&&name==='commitMixedStorageDecision_ACU')throw Error('SP 1.2.9 migration commit/restore contract changed: '+name);
  for(const call of splices){const target=call.callee.object;if(target.type!=='Identifier'||call.arguments[1].type!=='MemberExpression'||call.arguments[1].object.name!==target.name||call.arguments[1].property.name!=='length')throw Error('SP 1.2.9 migration splice shape changed');ctx.replace(call,'__dshCommitSpMigrationInPlace('+target.name+','+text(call.arguments[2].argument)+')')}
 }
 const recovery=fn('recoverLostCheckpointsAfterMessageDeletion_ACU');
 const deletionSave=only(matches(recovery,n=>n.type==='CallExpression'&&n.callee.name==='saveChatToHostStrict_ACU'),'deletion save');
 ctx.replace(deletionSave,'(__dshRollbackDeleting?Promise.resolve():saveChatToHostStrict_ACU())');
 const materialSnapshot=fn('snapshotMaterialCheckpointFields_ACU');
 const fieldMap=only(matches(materialSnapshot,n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.object.type==='Identifier'&&n.callee.property.name==='map'&&n.callee.object.name!==materialSnapshot.params[0].name),'material fields');
 const materialFields=fieldMap.callee.object.name;
 const materialDeclaration=only(matches(ctx.root,n=>n.type==='VariableDeclarator'&&n.id.name===materialFields),'material field declaration');
 if(materialDeclaration.init?.type!=='ArrayExpression'||JSON.stringify(materialDeclaration.init.elements.map(n=>n.value))!==JSON.stringify(originalSp129MaterialFields))throw Error('SP 1.2.9 材料字段契约改变');
 const capture=fn('captureCheckpointVaultForCurrentChat_ACU');
 const vault=only(matches(capture,n=>n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&n.right.type==='ObjectExpression'&&n.right.properties.some(p=>p.key.name==='entriesByIsolationKey')),'checkpoint vault').left.name;
 ctx.insert(ctx.root.start+1,'function __dshResetCheckpointVault(){'+vault+'=null;}');
 const live=ctx.symbolFromSetter('_set_currentJsonTableData_ACU'),settings=ctx.symbolFromSetter('_set_settings_ACU');
 let injected=checkpointInjection+'\nconst __dshRecoveryFields=[...new Set([...'+JSON.stringify([...migrationFields,...originalSp129CarrierFields])+',...'+materialFields+'])];\n'+deletionInjection;
 injected=injected.replaceAll('__dshCommitSpMigrationInPlace(chat,originalChat);','__dshCommitSpMigrationInPlace(chat,originalChat,__dshRecoveryFields);').replaceAll('resetCheckpointVault_ACU','__dshResetCheckpointVault').replaceAll('currentJsonTableData_ACU',live).replaceAll('_set_'+live,'_set_currentJsonTableData_ACU').replaceAll('settings_ACU',settings).replaceAll("Object.defineProperty(api,",'Object.defineProperty('+ctx.apiName+',');
 const recoveryFields=injected.indexOf('const __dshRecoveryFields=');
 const checkpointApi=injected.indexOf('Object.defineProperty('),deletionVar=injected.indexOf('var __dshRollbackDeleting'),deletionApi=injected.indexOf('Object.defineProperty(',checkpointApi+1);
 ctx.insert(ctx.root.start+1,'\n'+injected.slice(0,checkpointApi)+injected.slice(deletionVar,deletionApi)+'\nvar __dshRecoveryFields;\n');
 ctx.atApi(injected.slice(recoveryFields,deletionVar).replace('const __dshRecoveryFields=','__dshRecoveryFields=')+injected.slice(checkpointApi,recoveryFields)+injected.slice(deletionApi));
}
const checkpointInjection=`var __dshRollbackMaterializing=false;
 function __dshCommitSpMigrationInPlace(chat,candidate,allowedKeys){
  const keys=allowedKeys||['TavernDB_ACU_IsolatedData','TavernDB_ACU_IndependentData','TavernDB_ACU_Data','TavernDB_ACU_SummaryData','TavernDB_ACU_Identity','TavernDB_ACU_LocalMessageAnchor','TavernDB_ACU_ModifiedKeys','TavernDB_ACU_UpdateGroupKeys','_acu_local_template_base_state_seeded'];
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
}});`;
const deletionInjection=`var __dshRollbackDeleting=false;
 function __dshStableJson(value){return JSON.stringify(value,(key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item)}
 function __dshFloorFields(row){const fields={};for(const key of __dshRecoveryFields)if(row&&Object.prototype.hasOwnProperty.call(row,key))fields[key]=structuredClone(row[key]);return fields}
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
   __dshCommitSpMigrationInPlace(chat,originalChat,__dshRecoveryFields);
   _set_currentJsonTableData_ACU(live);
   resetCheckpointVault_ACU();captureCheckpointVaultForCurrentChat_ACU(chat);
  }
  return {success:true,deletion:true,fieldNames:__dshRecoveryFields,kept:keep,deleted:removed.length,recovered:recovery?.recovered===true,graftedCount:Number(recovery?.graftedCount)||0,changed,proofs};
 }});`;

