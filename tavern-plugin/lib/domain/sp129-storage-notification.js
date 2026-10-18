import {walkSp129} from './sp129-source.js'

// Settings alone do not complete a storage conversion. Notify the existing
// authority observer only after the original provider switch and UI refresh.
export function adaptSp129StorageNotification(ctx) {
 const scope=ctx.function('useDashboardPage'),setters=[]
 walkSp129(scope,node=>{if(node.type==='FunctionExpression'&&node.id?.name==='setStorageMode')setters.push(node)})
 if(setters.length!==1)throw Error('SP 1.2.9 存储模式 UI setter 不唯一')
 const setter=setters[0],tries=setter.body.body.filter(node=>node.type==='TryStatement')
 if(tries.length!==1||ctx.text(tries[0].finalizer)!=='{await refresh()}')throw Error('SP 1.2.9 存储模式最终刷新边界改变')
 const transaction=tries[0]
 ctx.insert(setter.body.start+1,'let __dshStorageSwitchHealthy=false;')
 ctx.insert(transaction.block.end-1,';__dshStorageSwitchHealthy=o!==i;')
 ctx.insert(transaction.finalizer.end-1,';if(__dshStorageSwitchHealthy)'+ctx.apiName+'._notifyTableUpdate({persisted:true});')
}


// A successful mirror rebuild strictly saves chat first, then regenerates the
// merged table object for readable worldbook entries. Publish that final view.
export function adaptSp129VectorNotification(ctx) {
 const scope=ctx.function('rebuildCurrentSummaryVectorIndexNow_ACU'),refreshes=[];
 walkSp129(scope,node=>{if(node.type==='TryStatement'&&ctx.text(node.block).includes('await updateReadableLorebookEntry_ACU(!0)'))refreshes.push(node)});
 if(refreshes.length!==1)throw Error('SP 1.2.9 向量重建最终刷新边界不唯一');
 const result=scope.body.body.find(node=>node.type==='VariableDeclaration'&&node.declarations.some(value=>value.init?.type==='AwaitExpression'&&value.init.argument?.callee?.name==='rebuildSummaryVectorMirror_ACU'))?.declarations[0]?.id?.name;
 if(!result)throw Error('SP 1.2.9 向量重建结果身份改变');
 ctx.insert(refreshes[0].block.end-1,';assertActive();if(!'+result+'.errors?.length)'+ctx.apiName+'._notifyTableUpdate({persisted:true});');
}
