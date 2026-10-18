import {walkSp129} from './sp129-source.js'

// Helper renews this nonpersistent ownership marker after a successful save.
// It must not change SP's fingerprint of the durable bridge source.
export function adaptSp129BridgeSource(ctx) {
 const fn=ctx.function('bridgeSourceFingerprint_ACU'),deletions=[]
 walkSp129(fn,node=>{if(node.type==='UnaryExpression'&&node.operator==='delete')deletions.push(node)})
 if(deletions.length!==1||deletions[0].argument.type!=='MemberExpression'||deletions[0].argument.object.type!=='Identifier')throw Error('SP 1.2.9 桥接来源字段边界改变')
 const node=deletions[0],row=ctx.text(node.argument.object)
 ctx.replace(node,'('+ctx.text(node)+',delete '+row+'.__dshTavernChatCopyGeneration)')
}
