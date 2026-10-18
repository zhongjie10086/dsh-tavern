import {walkSp129} from './sp129-source.js';

// Map a host-authenticated admitted native input to the original intent hook.
// No DOM controls or synthetic user clicks are created.
export function adaptSp129NativeInput(ctx){
 const handlers=[];walkSp129(ctx.function('mainInitialize_ACU'),node=>{
  if(node.type==='ArrowFunctionExpression'&&node.params.length===3&&node.body.type==='BlockStatement'){
   const text=ctx.text(node.body);
   if(text.includes('const assertVectorSend=')||!text.includes('shouldProcessSummaryVectorIndexForGeneration_ACU')||!text.includes('recordGenerationContext_ACU')&& !text.includes('after_commands'))return;
   if(text.includes('runUnmaskedPlotAfterCommands_ACU'))handlers.push(node);
  }
 });
 if(handlers.length!==1)throw Error('SP native input admission listener contract changed');
 const handler=handlers[0],options=handler.params[1].name,kind=handler.params[0].name,dry=handler.params[2].name;
 ctx.insert(handler.body.start+1,`if(${options}?.__dshNativeInput){if(${kind}!=="normal"||${dry})throw Error("Invalid native admission kind");window.__dshAssertSpNativeInput(${options}.__dshNativeInput);markUserSendIntent_ACU();}`);
 // Native input is a projected user floor, not durable chat history. Both
 // original plot branches already return options.prompt; the authenticated
 // event receipt persists that exact text after all listeners succeed. Their
 // remaining code saves plugin markers/feedback or refreshes the display. Its
 // feedback lookup accepts the source-input hash as well as the final-message
 // hash; no later calculation requires the local replacement. Other script
 // realms see the committed prompt receipt later.
 ctx.insert(handler.body.start+1,`function __dshWriteNativePlotMessage_ACU(row,index,text){
  if(!${options}?.__dshNativeInput){row.mes=text;return;}
  window.__dshAssertSpNativeInput(${options}.__dshNativeInput);
  if(index!==${options}.__dshNativeInput.floor||row!==Ve.chat[index]||!row?.is_user||typeof text!=="string"||${options}.prompt!==text)throw Error("Native plot input writeback identity changed");
 }`);
 const writes=[];walkSp129(handler.body,node=>{
  if(node.type==='AssignmentExpression'&&['C.mes=I.finalMessage','D.message.mes=t.finalMessage'].includes(ctx.text(node)))writes.push(node);
 });
 if(writes.length!==2)throw Error('SP native plot message writeback branches changed');
 for(const write of writes)ctx.replace(write,ctx.text(write)==='C.mes=I.finalMessage'?'__dshWriteNativePlotMessage_ACU(C,u,I.finalMessage)':'__dshWriteNativePlotMessage_ACU(D.message,D.index,t.finalMessage)');
 // Host journal receipts use emitHost, not the extension's replaceable emit.
 // Reuse the original gates as ordered listeners only for an admitted native
 // vector state. Direct emit still reaches the same gate; consuming its state
 // makes the wrapper/listener pair idempotent, with original failure semantics.
 const gates=[];walkSp129(ctx.function('mainInitialize_ACU'),node=>{
  if(node.type==='CallExpression'&&node.callee.name==='installHostEventWaitGate_ACU'&&['USER_MESSAGE_RENDERED','GENERATE_AFTER_DATA'].includes(node.arguments[1]?.property?.name))gates.push(node);
 });
 if(gates.length!==2)throw Error('SP native vector event gate contract changed');
 for(const gate of gates){
  const callback=gate.arguments[2],capture=callback?.body?.body?.[0]?.declarations?.[0]?.init;
  if(callback?.type!=='ArrowFunctionExpression'||capture?.type!=='Identifier')throw Error('SP native vector gate state changed');
  ctx.replace(gate,'('+ctx.text(gate)+','+ctx.text(gate.arguments[0])+'.on('+ctx.text(gate.arguments[1])+',async(...args)=>{if('+ctx.text(capture)+'?.__dshNativeInput)return ('+ctx.text(callback)+')(...args)}))');
 }
 const waits=[];walkSp129(handler.body,node=>{if(node.type==='Property'&&node.key.name==='awaitUserMessage')waits.push(node)});
 if(waits.length!==1)throw Error('SP vector user floor wait contract changed');
 ctx.insert(waits[0].start,'__dshNativeInput:!!'+options+'?.__dshNativeInput,');
 // Native input is already projected at its admitted floor before the original
 // after-commands hook. USER_MESSAGE_RENDERED confirms that same floor next.
 ctx.replace(waits[0].value,`(${ctx.text(waits[0].value)}||!!${options}?.__dshNativeInput)`);
}
