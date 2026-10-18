import {walkSp129} from './sp129-source.js'

// The upstream hard-delete writer creates a second full root. Reuse its
// covered-checkpoint downgrade only after strict replay proves every retained
// assistant boundary unchanged. Keep the original transaction's rollback/save.
export function adaptSp129TemplateCheckpoint(ctx) {
 const fn=ctx.function('commitCurrentFloorTemplateChanges_ACU'),matches=[]
 walkSp129(fn,node=>{if(node.type==='LogicalExpression'&&node.left.type==='Identifier'&&node.right.type==='AssignmentExpression'&&node.right.right.type==='CallExpression'&&node.right.right.callee.name==='beginMaterialCheckpointSync_ACU')matches.push(node)})
 if(matches.length!==1||ctx.text(matches[0])!=='N&&(F=beginMaterialCheckpointSync_ACU(C,m.index))')throw Error('SP 1.2.9 hard-delete checkpoint boundary changed')
 ctx.replace(matches[0],'(N&&B&&B.index<m.index&&await __dshConvergeHardDeleteCheckpoint_ACU(C,g,B.index,m.index),'+'assertTemplateCommitChatContext_ACU(C,t),'+ctx.text(matches[0])+')')
 ctx.insert(ctx.root.start+1,hardDeleteCheckpointProof)
}

export const hardDeleteCheckpointProof=`
async function __dshConvergeHardDeleteCheckpoint_ACU(chat,key,rootIndex,targetIndex){
 const roots=collectV2FullCheckpointIndices_ACU(chat,key);
 if(roots.length!==2||roots[0]!==rootIndex||roots[1]!==targetIndex)throw new Error('模板删表 checkpoint 根身份不唯一，已拒绝汇合');
 const boundaries=[];for(let index=rootIndex;index<=targetIndex;index++)if(chat[index]&&!chat[index].is_user)boundaries.push(index);
 const options={updateRuntimeState:false,compatibilityMode:'disabled',allowTemporaryTemplateBaseline:false};
 const stamp=computeReplayHeadRevisionDigest_ACU(chat,key),target=chat[targetIndex];
 const before=await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(chat,key,boundaries,options),candidate=structuredClone(chat);
 if(!downgradeV2FullCheckpointAtIndex_ACU(candidate,key,targetIndex))throw new Error('模板删表 checkpoint 无法复用原包边界转换');
 const violation=assertSingleActiveFullCheckpointV2_ACU(candidate,key,'hard_delete_convergence');if(violation)throw new Error(violation);
 const after=await loadTableStatesAtBoundariesFromFramesV2Detailed_ACU(candidate,key,boundaries,options);
 for(const index of boundaries){
  const a=before.get(index),b=after.get(index);
  if(!a||!b||a.requiresCheckpointConvergence||b.requiresCheckpointConvergence||a.compatibilityRepairs?.length||b.compatibilityRepairs?.length||getTableDataFingerprint_ACU(a.data)!==getTableDataFingerprint_ACU(b.data))throw new Error('模板删表历史回放不等价，已拒绝汇合：'+index);
  const left=deriveSheetLifecycleFromFramesV2_ACU(chat,key,{maxMessageIndex:index}),right=deriveSheetLifecycleFromFramesV2_ACU(candidate,key,{maxMessageIndex:index});
  if(left.indeterminateSheetKeys?.length||right.indeterminateSheetKeys?.length||JSON.stringify(left.hiddenSheetKeys)!==JSON.stringify(right.hiddenSheetKeys))throw new Error('模板删表隐藏表历史不等价，已拒绝汇合：'+index);
  for(const sheet of left.hiddenSheetKeys)if(getTableDataFingerprint_ACU({[sheet]:left.statusBySheetKey[sheet]?.restoreSourceData})!==getTableDataFingerprint_ACU({[sheet]:right.statusBySheetKey[sheet]?.restoreSourceData}))throw new Error('模板删表隐藏表恢复数据不等价，已拒绝汇合：'+index);
 }
 if(chat[targetIndex]!==target||computeReplayHeadRevisionDigest_ACU(chat,key)!==stamp)throw new Error('模板删表历史在证明期间变化，已拒绝汇合');
 const frame=candidate[targetIndex].TavernDB_ACU_IsolatedData[key].storageFrame;
 chat[targetIndex].TavernDB_ACU_IsolatedData[key].storageFrame=frame;
}
`;
