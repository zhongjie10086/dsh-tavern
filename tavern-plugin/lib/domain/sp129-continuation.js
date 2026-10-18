import {walkSp129} from './sp129-source.js';

// The original UI pauses/clears pending before stopping the host. Its STOPPED
// listener can consequently retain a STARTED claim for the previous attempt.
// A new ordinary STARTED event may replace only that obsolete attempt claim.
export function adaptSp129Continuation(ctx){
 // A first logical module write has no prior frame. The original table-data
 // fingerprint cannot hash undefined; preserve both existence and value CAS.
 const storage=ctx.function('createZeroLayerContinuationAgentStorage_ACU'),frameGuards=[];
 walkSp129(storage,node=>{if(node.type==='BinaryExpression'&&ctx.text(node)==='Eg(t.previous)!==Eg(s[t.index][vi])')frameGuards.push(node)});
 if(frameGuards.length!==1)throw Error('SP logical continuation frame baseline guard changed');
 ctx.replace(frameGuards[0],'(Object.prototype.hasOwnProperty.call(s[t.index],vi)!==t.existed||(t.existed&&Eg(t.previous)!==Eg(s[t.index][vi])))');

 const classes=ctx.root.body.filter(node=>node.type==='ClassDeclaration'&&node.id.name==='ContinuationHostGenerationBridge_ACU');
 if(classes.length!==1)throw Error('SP continuation bridge class changed');
 const method=classes[0].body.body.filter(node=>node.key.name==='onGenerationStarted');
 if(method.length!==1)throw Error('SP continuation started method changed');
 const guards=[];walkSp129(method[0].value,node=>{if(node.type==='IfStatement'&&ctx.text(node.test)==='this.startedByChat.has(s)'&&ctx.text(node.consequent)==='return ignored("sequence_conflict");')guards.push(node)});
 if(guards.length!==1)throw Error('SP continuation sequence claim guard changed');
 ctx.replace(guards[0],`if(this.startedByChat.has(s)){
  const prior=this.startedByChat.get(s),pending=i.readPendingHostTurn()?.pending;
  if(!pending||prior.attemptId===pending.identity.attemptId||prior.sequence===t)return ignored("sequence_conflict");
  this.startedByChat.delete(s);
 }`);
}
