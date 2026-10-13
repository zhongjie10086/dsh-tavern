/** Evaluate text blocks once while preserving images, tools and message identity. */
export function renderLightTemplateRequest(runtime,messages,context){
 const projected=structuredClone(messages),slots=[],text=[];
 for(const message of projected){
  if(typeof message.content==='string'){slots.push(value=>{message.content=value});text.push({role:message.role,content:message.content});}
  else for(const block of message.content||[])if(block.type==='text'){slots.push(value=>{block.text=value});text.push({role:message.role,content:block.text});}
 }
 const result=runtime.renderMessages(text,context);
 result.messages.forEach((message,index)=>slots[index](message.content));
 return {...result,messages:projected};
}
