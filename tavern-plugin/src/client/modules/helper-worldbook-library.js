function installTavernWorldbookLibrary(options) {
  const {window:w,call,context,copy}=options;
  const fallback=()=>({names:context().worldbook?.name?[context().worldbook.name]:[],global:[],character:{primary:context().worldbook?.name||null,additional:[]},chat:null});
  let acknowledged=null,ackBinding='';
  const binding=()=>String(context().chatId||'')+':'+Number(context().lifecycleRevision||0);
  function catalog(){const incoming=context().worldbookLibrary||fallback(),owner=binding();if(acknowledged&&ackBinding===owner&&(Number(acknowledged.localRevision)>Number(incoming.localRevision||0)||Number(acknowledged.revision)>Number(incoming.revision||0)))return acknowledged;acknowledged=incoming;ackBinding=owner;return incoming;}
  async function mutate(operation){const owner=binding(),result=await call('tavernHelperWorldbookLibrary',{operation});if(result.catalog&&owner===binding()){ackBinding=owner;acknowledged=copy(result.catalog);context().worldbookLibrary=copy(result.catalog)}return result.value;}
  w.getWorldbookNames=()=>copy(catalog().names);
  w.getGlobalWorldbookNames=()=>copy(catalog().global);
  w.getCharWorldbookNames=(name='current')=>{if(name!=='current'&&name!==context().characterName)throw new Error('请通过角色资源 API 查询其他角色的世界书');return copy(catalog().character);};
  w.getChatWorldbookName=(name='current')=>{if(name!=='current')throw new Error('聊天世界书必须使用 current');return catalog().chat;};
  w.rebindGlobalWorldbooks=async names=>{await mutate({kind:'bind-global',names:copy(names),expectedRevision:catalog().revision});};
  w.rebindCharWorldbooks=async(name,books)=>{if(name!=='current')throw new Error('角色世界书绑定必须使用 current');await mutate({kind:'bind-character',books:copy(books)});};
  w.rebindChatWorldbook=async(name,book)=>{if(name!=='current')throw new Error('聊天世界书绑定必须使用 current');await mutate({kind:'bind-chat',name:book});};
  const entries=value=>(value||[]).map(entry=>{const next=copy(entry);if(entry.strategy?.keys)next.strategy.keys=entry.strategy.keys.map(String);if(entry.strategy?.keys_secondary?.keys)next.strategy.keys_secondary.keys=entry.strategy.keys_secondary.keys.map(String);return next;});
  w.createWorldbook=(name,book=[])=>mutate({kind:'create',name,entries:entries(book)});
  w.createOrReplaceWorldbook=(name,book=[])=>mutate({kind:'upsert',name,entries:entries(book)});
  w.deleteWorldbook=name=>mutate({kind:'delete',name});
  w.getOrCreateChatWorldbook=async(name='current',book)=>{const current=w.getChatWorldbookName(name);if(current)return current;const selected=book||('聊天世界书 '+context().chatId);await w.createWorldbook(selected);await w.rebindChatWorldbook(name,selected);return selected;};
  w.getLorebooks=w.getWorldbookNames;w.deleteLorebook=w.deleteWorldbook;
  w.createLorebook=(name,book=[])=>w.createWorldbook(name,book.map(entry=>options.legacyPatch(entry)));
  w.getCharLorebooks=async()=>w.getCharWorldbookNames('current');w.getCurrentCharPrimaryLorebook=()=>w.getCharWorldbookNames('current').primary;
  w.setCurrentCharLorebooks=books=>w.rebindCharWorldbooks('current',books);
  w.getChatLorebook=()=>w.getChatWorldbookName('current');w.setChatLorebook=book=>w.rebindChatWorldbook('current',book);w.getOrCreateChatLorebook=book=>w.getOrCreateChatWorldbook('current',book);
  w.replaceLorebookEntries=(name,book)=>w.replaceWorldbook(name,book.map(entry=>options.legacyPatch(entry)));
  w.updateLorebookEntriesWith=async(name,updater)=>{const changed=await w.updateWorldbookWith(name,async current=>{const legacy=current.map(options.legacyEntry),next=await updater(legacy);return (next??legacy).map(entry=>options.legacyPatch(entry,current.find(row=>row.uid===entry.uid)));});return changed.map(options.legacyEntry);};
}
