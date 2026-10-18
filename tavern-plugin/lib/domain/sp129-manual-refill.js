import {walkSp129} from './sp129-source.js';

// A partial refill can remove the selected sheet from a full root that retains
// other sheets. The original early return then leaves subsequent SQL rootless.
export function adaptSp129ManualRefill(ctx){
 const found=[];walkSp129(ctx.function('orchestrateManualUpdate_ACU'),node=>{if(node.type==='FunctionExpression'&&node.id?.name==='establishManualRefillTemplateRoot_ACU')found.push(node)});
 if(found.length!==1)throw Error('SP manual refill template root contract changed');
 const fn=found[0],branch=fn.body.body.find(node=>node.type==='IfStatement'&&ctx.text(node.test).includes('.fullCheckpointIndices.length>0'));
 if(!branch||branch.consequent.type!=='ReturnStatement')throw Error('SP manual refill existing-root branch changed');
 const binding=fn.body.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(item=>item.init?.callee?.name==='resolveManualRefillReplayAnchor_ACU'))?.declarations[0];
 const args=binding?.init?.arguments;if(!args||args.length!==3)throw Error('SP manual refill root binding changed');
 const destructure=fn.body.body[0].declarations?.[0]?.id?.properties;
 const name=key=>destructure?.find(item=>item.key.name===key)?.value.name;
 if(!name('templateData')||!name('targetSheetKeys'))throw Error('SP manual refill input changed');
 ctx.replace(branch.consequent,`return await __dshEstablishPartialManualRoot_ACU(${args.map(arg=>ctx.text(arg)).join(',')},${ctx.text(binding.id)},${name('targetSheetKeys')},${name('templateData')});`);
 ctx.insert(ctx.root.start+1,partialManualRoot);
}

export const partialManualRoot=`
async function __dshEstablishPartialManualRoot_ACU(chat,isolationKey,range,anchor,selected,template){
 const unchanged={success:true,changed:false,targetMessageIndex:-1};
 if(anchor.fullCheckpointIndices.length!==1)return unchanged;
 const index=anchor.fullCheckpointIndices[0];if(!range.includes(index))return unchanged;
 const message=chat[index],frame=readIsolatedTagData_ACU(message,isolationKey)?.storageFrame,previous=frame?.checkpoint;
 if(previous?.kind!=='full'||!previous.data)return unchanged;
 const missing=selected.filter(key=>!Object.prototype.hasOwnProperty.call(previous.data,key));if(!missing.length)return unchanged;
 const data=JSON.parse(JSON.stringify(previous.data)),headers=stripSeedRowsFromTemplate_ACU(JSON.parse(JSON.stringify(template)));
 for(const key of missing){if(!headers?.[key])return{success:false,changed:false,targetMessageIndex:index,error:'手动重填缺少所选表的冻结结构：'+key};data[key]=JSON.parse(JSON.stringify(headers[key]));}
 const built=buildCanonicalFullCheckpoint_ACU({...previous,data,context:{messageIndex:index,isolationKey,reason:previous.reason}});
 if(!built.checkpoint)return{success:false,changed:false,targetMessageIndex:index,error:built.error||'手动重填部分根结构校验失败'};
 const snapshot=messageFieldSnapshot_ACU(message);
 try{
  frame.checkpoint={...previous,...built.checkpoint};
  await saveChatToHostStrict_ACU();
  return{success:true,changed:true,targetMessageIndex:index};
 }catch(error){restoreMessageFieldSnapshot_ACU(message,snapshot);return{success:false,changed:false,targetMessageIndex:index,error:error?.message||String(error)}}
}
`;
