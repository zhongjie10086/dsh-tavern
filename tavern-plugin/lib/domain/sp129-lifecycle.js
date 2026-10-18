import {walkSp129,sp129RootNodes} from './sp129-source.js';
// Keep original session, persistence, branch and generation logic intact. Only
// the DOM-dependent presentation methods cross the authenticated host channel.
export function adaptSp129Lifecycle(ctx){
 const classes=[];sp129RootNodes(ctx).forEach(node=>{if(node.type==='ClassExpression'&&node.id?.name==='ZeroLayerStableView_ACU')classes.push(node)});
 if(classes.length!==1)throw Error('SP 零层稳定视图契约改变');
 const methods=new Map(classes[0].body.body.map(node=>[node.key.name,node]));
 // A committed branch changes logical scope. The original resync rejects and
 // disposes the previous mounted scope; remount through its normal entry instead.
 const branchChanges=[];sp129RootNodes(ctx).forEach(node=>{if(node.type==='FunctionExpression'&&node.id?.name==='changeZeroLayerBranchForPage_ACU')branchChanges.push(node)});
 if(branchChanges.length!==1)throw Error('SP branch page operation changed');
 const branchSync=[];walkSp129(branchChanges[0],node=>{if(node.type==='AwaitExpression'&&node.argument?.type==='CallExpression'&&node.argument.callee.name==='syncConfirmedZeroLayerView_ACU')branchSync.push(node)});
 if(branchSync.length!==1)throw Error('SP branch confirmed view sync changed');
 ctx.replace(branchSync[0],'(invalidateZeroLayerView_ACU(),'+ctx.text(branchSync[0])+')');
 const mount=methods.get('mount'),text=ctx.text(mount),facade=/await (\w+)\.getSnapshot\(/.exec(text)?.[1];
 if(!facade||!text.includes('captureZeroLayerCarrier_ACU')||!text.includes('subscribeZeroLayerViewPreview_ACU'))throw Error('SP 零层视图挂载契约改变');
 ctx.replace(mount,`async mount(){this.dispose();const epoch=this.epoch,context=captureZeroLayerCarrier_ACU(),result=await ${facade}.getSnapshot({version:1});if(epoch!==this.epoch)throw Error('scope-changed');if(result.ok===false)throw Error(result.error.code);assertZeroLayerCarrier_ACU(context);this.context=context;this.snapshot=result.value;try{await window.__dshSpView.mount({carrierIndex:context.carrierIndex,snapshot:this.snapshot,body:this.publishedBody()});}catch(error){this.dispose();throw error}if(epoch!==this.epoch)throw Error('scope-changed');this.releasePreview=subscribeZeroLayerViewPreview_ACU(value=>this.receivePreview(value));this.releaseHistory=${facade}.subscribe(value=>{if(value.kind==='scope-invalidated')this.dispose();else{this.dirty=true;this.resync().catch(()=>{})}});}`);
 ctx.replace(methods.get('assertSlot'),`assertSlot(){if(!this.context||!this.snapshot)throw Error('view-out-of-sync');assertZeroLayerCarrier_ACU(this.context);}`);
 ctx.replace(methods.get('paint'),`paint(body){this.assertSlot();this.hostPublish=window.__dshSpView.publish({carrierIndex:this.context.carrierIndex,snapshot:this.snapshot,body:this.busyKey===this.context.key&&!this.preview?body+'\\n\\n（零层回合处理中…）':body,preview:this.preview});this.hostPublish.catch(()=>this.markOutOfSync());}`);
 ctx.replace(methods.get('bindGameFrame'),`bindGameFrame(frame,origin){this.assertSlot();const frameToken=frame?.dshFrameToken??frame?.dataset?.dshTavernFrameToken??frame?.getAttribute?.('data-dsh-tavern-frame-token');if(!frameToken)throw Error('请提供真实 iframe 的认证身份');return window.__dshSpView.bindGameFrame({carrierIndex:this.context.carrierIndex,snapshot:this.snapshot,body:this.preview?.body??this.publishedBody(),expectedOrigin:origin,frameToken});}`);
 ctx.replace(methods.get('markOutOfSync'),`markOutOfSync(){window.__dshSpView.error('正文显示未同步，请使用数据重同步；不会重新生成或重载游戏。');}`);
 ctx.insert(methods.get('dispose').value.body.start+1,`window.__dshSpView?.dispose();`);
 walkSp129(methods.get('readPublished'),node=>{if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.type==='ThisExpression'&&node.callee.property.name==='render')ctx.replace(node,'('+ctx.text(node)+',await this.hostPublish)')});
}
