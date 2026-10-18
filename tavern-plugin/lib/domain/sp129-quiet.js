import {walkSp129,sp129RootNodes} from './sp129-source.js';
// Adapt only the bound logical-turn model invocation. Capture fetches do not
// dispatch, and all original preset selection/transport/cancellation stays intact.
export function adaptSp129Quiet(ctx){
 const forwards=[];sp129RootNodes(ctx).forEach(node=>{if(['FunctionDeclaration','FunctionExpression'].includes(node.type)&&node.id?.name==='forward_ACU')forwards.push(node)});
 if(forwards.length!==1)throw Error('SP 零层真实发送契约改变');
 const forward=forwards[0],calls=[];walkSp129(forward,node=>{if(node.type==='CallExpression'&&node.callee.name==='callAIWithResolvedPreset_ACU')calls.push(node)});
 if(calls.length!==1||!ctx.text(forward).includes('beforeDispatch()'))throw Error('SP 零层发送前确认契约改变');
 const call=calls[0],args=call.arguments.map(arg=>ctx.text(arg));
 if(args.length!==5||call.arguments[0].type!=='MemberExpression'||call.arguments[0].property.name!=='messages')throw Error('SP 零层最终消息契约改变');
 ctx.replace(call,`getHostWindow().__dshSpQuietRequest(${args[0]},async(__dshQuietMessages)=>callAIWithResolvedPreset_ACU(__dshQuietMessages,${args.slice(1).join(',')}),${args[2]})`);
}
