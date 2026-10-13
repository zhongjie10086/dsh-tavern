function installTavernSlash({window:w,call,assertSlash=()=>{},trusted=false,currentScript=()=>({id:''}),publish=()=>{},syntax=createTavernSlashSyntax()}){
 const commands=new Map();
 const owners=new Map(),listeners=new Set();
 const fromProps=value=>({...value});
 w.SlashCommand={fromProps};w.SlashCommandArgument={fromProps};w.SlashCommandNamedArgument={fromProps};
 w.ARGUMENT_TYPE=Object.freeze({STRING:'string',NUMBER:'number',BOOLEAN:'boolean',LIST:'list',DICTIONARY:'dictionary',CLOSURE:'closure'});
 w.SlashCommandParser={addCommandObject(command){
  if(!command?.name||typeof command.callback!=='function')throw Error('Slash 命令需要名称和回调');
  const owner=String(currentScript().id||''),names=[command.name,...(command.aliases||[])].map(value=>String(value).toLowerCase());
  if(names.some(name=>!name||/[\s/|]/.test(name)))throw Error('Slash 命令名称不能包含空格、斜线或管道');
  const changedOwners=new Set([...owners.values(),owner]);
  for(const name of names){commands.set(name,command);owners.set(name,owner)}
  if(owner&&w.eventOn&&!listeners.has(owner)){
   listeners.add(owner);w.eventOn('dsh_registered_slash_'+owner,async packet=>{
    if(owners.get(parse(packet.line).name)!==owner)throw Error('Slash 命令已由其他脚本替换，请重试');
    packet.pipe=await w.triggerSlash(packet.line);packet.handled=true;
   });
  }
  for(const id of changedOwners)publish({type:'dsh-tavern-helper-slash-commands',scriptId:id,names:[...owners].filter(([,value])=>value===id).map(([name])=>name)});
 },get commands(){return Object.fromEntries(commands)}};
 const {segments,tokens,parse}=syntax;
 const yes=value=>value===true||/^(?:true|1)$/i.test(String(value));
 async function run(line,pipe=''){
  const {name,named,text,hasText}=parse(line),value=hasText?text:pipe,ctx=w.SillyTavern?.getContext();
  if(commands.has(name)){const command=commands.get(name);for(const arg of command.namedArgumentList||[]){if(!Object.hasOwn(named,arg.name)&&arg.defaultValue!==undefined)named[arg.name]=arg.defaultValue;if(Object.hasOwn(named,arg.name)&&arg.typeList?.includes('boolean'))named[arg.name]=yes(named[arg.name]);else if(Object.hasOwn(named,arg.name)&&arg.typeList?.includes('number'))named[arg.name]=Number(named[arg.name])}return String(await command.callback(named,value)??'')}
  if(['setvar','getvar','flushvar'].includes(name)){
   const positional=tokens(text),key=named.key||(name==='setvar'?positional[0]?.value:text),option={type:'chat'};if(!key)throw Error('变量名称不能为空');
   if(name==='getvar'){const values=w.getVariables(option);return Object.hasOwn(values,key)?typeof values[key]==='string'?values[key]:JSON.stringify(values[key]):''}
   if(name==='flushvar'){await w.deleteVariable([key],option);return ''}
   const next=named.key?value:positional.length>1?text.slice(positional[1].start):pipe;await w.insertOrAssignVariables({[key]:next},option);return next;
  }
  if(name==='getcharbook')return String(w.getCharWorldbookNames('current').primary||'');
  if(name==='getchatbook')return String(yes(named.create)?await w.getOrCreateChatWorldbook('current',named.name):w.getChatWorldbookName('current')||'');
  if(['createentry','setentryfield','getentryfield','deleteentry'].includes(name)){
   const book=named.file||w.getChatWorldbookName('current')||w.getCharWorldbookNames('current').primary;if(!book)throw Error('没有可用世界书');const data=await ctx.loadWorldInfo(book);data.entries||={};
   let uid=String(named.uid??'');if(name==='createentry'){uid=String(Math.max(-1,...Object.keys(data.entries).map(Number).filter(Number.isFinite))+1);data.entries[uid]={uid:Number(uid),key:String(named.key||'').split(',').map(s=>s.trim()).filter(Boolean),keysecondary:[],content:value,comment:'',constant:false,disable:false,selective:true,position:0,order:100,depth:4};}
   else{if(!Object.hasOwn(data.entries,uid))throw Error('世界书条目不存在：'+uid);const field=named.field;if(name==='getentryfield'){const result=data.entries[uid][field];return typeof result==='string'?result:JSON.stringify(result??'')}
    if(name==='deleteentry')delete data.entries[uid];else{if(!field||['__proto__','constructor','prototype','uid'].includes(field))throw Error('世界书字段无效');const booleans=['constant','disable','selective','excludeRecursion','preventRecursion','ignoreBudget','addMemo'],numbers=['position','order','depth','probability','selectiveLogic','sticky','cooldown','delay','scanDepth'];let next=['key','keysecondary'].includes(field)?String(value).split(',').map(s=>s.trim()).filter(Boolean):booleans.includes(field)?yes(value):numbers.includes(field)?Number(value):value;if(typeof next==='number'&&!Number.isFinite(next))throw Error('世界书数值字段无效：'+field);data.entries[uid][field]=next;}}
   await ctx.saveWorldInfo(book,data);return name==='createentry'?uid:value;
  }
  if(name==='trigger')return (await call('triggerTavernSlash',{line})).pipe||'';
  if(['setinput','getinput'].includes(name)){const before=await call('tavernHelperComposer',{operation:{kind:'read'}});if(name==='getinput')return before.draft;const raw=line.replace(/^\/setinput\s*/,'');const draft=segments(line).length===1&&!/^["']/.test(raw)?raw:value;await call('tavernHelperComposer',{operation:{kind:'write',text:draft,expectedDraft:before.draft}});return draft}
  if(name==='send'){await w.createChatMessages([{role:'user',message:value}]);return value}
  if(name==='echo'){w.toastr?.info?.(value);return value}
  // ST's /pass returns its argument with identity macros resolved; resident scripts
  // query the player's name with /pass {{user}}. (upstream cce921e1)
  if(name==='pass')return String(value).replace(/{{\s*(user|char)\s*}}/gi,(_,key)=>key.toLowerCase()==='user'?String(ctx?.name1||'你'):String(ctx?.name2||'角色'))
  if(name==='gen')return w.generateRaw({user_input:value,should_stream:false});
  throw Error('统一兼容层尚未实现此 Slash 命令：/'+(name||'无效命令'));
 }
 w.triggerSlash=async function(source){const line=String(source||'').trim();assertSlash(line,trusted);if(/^\/send\s+[\s\S]+\|\s*\/trigger(?:\s+await=(?:true|false))?\s*$/.test(line))return (await call('triggerTavernSlash',{line})).pipe||'';let pipe='';for(const part of segments(line))pipe=await run(part,pipe);return pipe};
 w.executeSlashCommandsWithOptions=async source=>({pipe:await w.triggerSlash(source),isError:false});
}

// Intercept only registered plugin commands at the real host composer. Keep
// ordinary text/native commands on their existing path, and never erase a new
// draft when an asynchronous command finishes.
function installTavernRegisteredSlashComposer({window:w,document:doc,getRoot,getInput,resolveCommand,report=()=>{}}){
 let disposed=false,pending=false,status=null;
 function show(root,text){if(!status||status.parentNode!==root){status?.remove();status=doc.createElement('div');status.dataset.tavernSlashStatus='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.appendChild(status)}status.textContent=text;}
 function receive(event){
  if(disposed||event.defaultPrevented||event.isComposing)return;
  const root=getRoot(),input=getInput(),editor=root?.querySelector('[data-composer-input]'),buttons=root?.querySelectorAll('button'),button=buttons?.[buttons.length-1];
  if(!editor||!input||(event.type==='keydown'?(event.target!==editor||event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey):!button?.contains(event.target)))return;
  const draft=String(input.state.getSnapshot().draft||''),name=/^\s*\/([^\s|/]+)/.exec(draft)?.[1]?.toLowerCase(),command=name&&resolveCommand(name);
  if(!command)return;
  event.preventDefault();event.stopImmediatePropagation();if(pending)return;
  pending=true;show(root,'正在执行 /'+name+'…');
  Promise.resolve().then(()=>command(draft.trim())).then(result=>{
   if(disposed)return;if(input.state.getSnapshot().draft===draft)input.setDraft('');show(root,String(result||'命令已完成'));
  },error=>{if(disposed)return;show(root,String(error.message||error));report(error)}).finally(()=>pending=false);
 }
 for(const type of ['keydown','click'])w.addEventListener(type,receive,true);
 return ()=>{disposed=true;for(const type of ['keydown','click'])w.removeEventListener(type,receive,true);status?.remove()};
}
