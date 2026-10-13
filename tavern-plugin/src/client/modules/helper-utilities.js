function installTavernHelperUtilities({window:w,context,post,currentScript}) {
  const clone=value=>structuredClone(value),macros=[];
  const get=(object,path)=>{if(w._?.get)return w._.get(object,path,null);return String(path).split('.').reduce((value,key)=>value?.[key],object)??null};
  function stripPrivate(value){if(Array.isArray(value))return value.map(stripPrivate);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('$')).map(([key,value])=>[key,stripPrivate(value)]));return value;}
  function variable(type,path,id){return stripPrivate(get(w.getVariables(type==='message'?{type,message_id:id??'latest'}:{type}),path));}
  function runMacros(value,scope={}) {
    let text=String(value??'').replace(/{{get_(message|chat|character|preset|global)_variable::(.*?)}}/gi,(_m,type,path)=>{const value=variable(type,path,scope.message_id);return typeof value==='string'?value:JSON.stringify(value)});
    text=text.replace(/^(.*){{format_(message|chat|character|preset|global)_variable::(.*?)}}/gim,(_m,prefix,type,path)=>{const value=variable(type,path,scope.message_id),formatted=typeof value==='string'?value:w.YAML?.stringify? w.YAML.stringify(value).trimEnd():JSON.stringify(value,null,2);return prefix+formatted.replaceAll('\n','\n'+' '.repeat(prefix.length))});
    for(const macro of macros){macro.regex.lastIndex=0;text=text.replace(macro.regex,(...args)=>macro.replace(scope,...args));}return text;
  }
  w.registerMacroLike=(regex,replace)=>{if(!(regex instanceof RegExp)&&Object.prototype.toString.call(regex)!=='[object RegExp]'||typeof replace!=='function')throw new TypeError('助手宏需要正则和替换函数');if(!macros.some(m=>m.regex.source===regex.source))macros.push({regex,replace});return {unregister:()=>w.unregisterMacroLike(regex)}};
  w.unregisterMacroLike=regex=>{const index=macros.findIndex(m=>m.regex.source===regex.source);if(index>=0)macros.splice(index,1)};
  w.eventOn(w.tavern_events.CHAT_COMPLETION_PROMPT_READY,(data,dryRun)=>{if(dryRun)return;for(const message of data.prompt||[]){if(typeof message.content==='string')message.content=runMacros(message.content,{role:message.role});else for(const part of message.content||[])if(part.type==='text')part.text=runMacros(part.text,{role:message.role});}});
  const basic=w.substitudeMacros;
  w.substitudeMacros=text=>basic(String(text??'')).replace(/{{\s*(lastMessageId|lastMessage|lastUserMessage|lastCharMessage)\s*}}/gi,(_m,key)=>{const rows=context().messages||[];if(key.toLowerCase()==='lastmessageid')return String(rows.length-1);return (key.toLowerCase()==='lastusermessage'?rows.findLast(m=>m.role==='user'):key.toLowerCase()==='lastcharmessage'?rows.findLast(m=>m.role==='assistant'):rows.at(-1))?.message||'';});
  w.isCharacterTavernRegexesEnabled=()=>context().characterRegexesEnabled!==false;
  w.formatAsTavernRegexedString=(value,source,destination,options={})=>{
    if(!['user_input','ai_output','slash_command','world_info','reasoning'].includes(source)||!['display','prompt'].includes(destination))throw new Error('正则作用位置无效');
    if(options.character_name&&options.character_name!==context().characterName)throw new Error('请先读取目标角色的正则配置');
    let text=String(value??'');
    for(const type of ['global','preset','character'])for(const rule of w.getTavernRegexes({type})) {
      if(!rule.enabled||!rule.source[source]||(rule.destination.display||rule.destination.prompt)&&!rule.destination[destination]||type==='character'&&!w.isCharacterTavernRegexesEnabled())continue;
      if(options.depth!==undefined&&((rule.min_depth!==null&&rule.min_depth!==undefined&&options.depth<rule.min_depth)||(rule.max_depth!==null&&rule.max_depth!==undefined&&options.depth>rule.max_depth)))continue;
      const match=String(rule.find_regex).match(/^\/([\s\S]*)\/([a-z]*)$/i),regex=match?new RegExp(match[1],match[2]):new RegExp(rule.find_regex);
      text=text.replace(regex,(...args)=>{const groups=typeof args.at(-1)==='object'?args.at(-1):null,count=args.length-(groups?3:2);return String(rule.replace_string||'').replace(/{{match}}/gi,'$0').replace(/\$(\d+)|\$<([^>]+)>/g,(_m,n,name)=>{let value=String(n!==undefined?(Number(n)<count?args[Number(n)]??'':''):groups?.[name]??'');for(const trim of rule.trim_strings||[])if(trim)value=value.split(trim).join('');return value;})});
    }
    return runMacros(w.substitudeMacros(text),{role:source==='user_input'?'user':source==='ai_output'?'assistant':'system',message_id:options.depth===undefined?undefined:context().messages.length-options.depth-1});
  };
  w.formatAsDisplayedMessage=(value,{message_id='last'}={})=>{const messages=context().messages||[];const id=message_id==='last'?messages.length-1:message_id==='last_user'?messages.findLastIndex(m=>m.role==='user'):message_id==='last_char'?messages.findLastIndex(m=>m.role==='assistant'):message_id;if(!Number.isInteger(id)||id<0||id>=messages.length)throw new Error('消息楼层不存在');if(!w.marked?.parse)throw new Error('Markdown 渲染器尚未就绪');return w.marked.parse(w.formatAsTavernRegexedString(value,messages[id].role==='user'?'user_input':'ai_output','display',{depth:messages.length-id-1}),{gfm:true,breaks:true});};
  w.getIframeName=()=>w.name||('TH-script--'+(context().chatId||'current')+'--'+currentScript().id);
  w.getMessageId=name=>{const match=String(name).match(/^TH-message--(\d+)--\d+(_\d+)?$/);if(!match)throw new Error('getMessageId 只能用于聊天楼层 iframe');return Number(match[1]);};
  w.reloadIframe=async()=>{await w.__dshTavernFlushScriptStorage?.();post({type:'dsh-tavern-helper-reload-request'});};
  const id=prompt=>String(prompt?.id||'').replaceAll('_','').toLowerCase();
  w.isPresetSystemPrompt=prompt=>['main','nsfw','jailbreak','enhancedefinitions'].includes(id(prompt));w.isPresetPlaceholderPrompt=prompt=>['worldinfobefore','personadescription','chardescription','charpersonality','scenario','worldinfoafter','dialogueexamples','chathistory'].includes(id(prompt));w.isPresetNormalPrompt=prompt=>!w.isPresetSystemPrompt(prompt)&&!w.isPresetPlaceholderPrompt(prompt);
  w.addEventListener?.('pagehide',()=>{macros.length=0},{once:true});
  return {runMacros};
}
