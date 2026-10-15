// Explicit archive reader; never replaces the complete synchronous Helper state.
function createStoredMessageHistory(load) {
    let epoch=0, snapshot=null, error="", busy=false;
    const listeners=new Set();
    let state={snapshot,error,busy};
    function publish(){state={snapshot,error,busy};for(const listener of listeners)listener();}
    async function request(method,args){
        const current=++epoch;busy=true;error="";publish();
        try{const result=await load(method,args),value=result.window||result.slice;if(current!==epoch)return;
            if(!value||!['chat-window','chat-slice'].includes(value.kind)||value.id!==undefined)throw Error("存档窗口无效，请重新读取");
            snapshot=value;
        }catch(caught){if(current===epoch)error=String(caught?.message||caught);}
        finally{if(current===epoch){busy=false;publish();}}
    }
    return {subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},snapshot:()=>state,
        latest:()=>request("getTavernMessageWindow",{limit:20}),
        earlier:()=>snapshot?.previousCursor?request("getTavernMessageWindow",{cursor:snapshot.previousCursor,limit:20}):Promise.resolve(),
        at:index=>snapshot?request("getTavernMessageSlice",{indices:[index],pinnedRevision:snapshot.storageRevision,snapshotId:snapshot.snapshotId}):Promise.resolve(),
        dispose(){epoch++;listeners.clear();}};
}

function StoredMessageHistory(props) {
    const h=React.createElement,[open,setOpen]=React.useState(false),[floor,setFloor]=React.useState("");
    const reader=React.useMemo(()=>createStoredMessageHistory((method,args)=>rpc(method,{...args,sessionId:props.sessionId},props.sessionId)),[props.sessionId]);
    React.useEffect(()=>()=>reader.dispose(),[reader]);
    const state=React.useSyncExternalStore(reader.subscribe,reader.snapshot),snapshot=state.snapshot;
    return h(React.Fragment,null,
        h("button",{type:"button",className:"dsh-tavern-btn",onClick:()=>{setOpen(true);void reader.latest();}},"对照存档消息原文"),
        open?h("div",{role:"dialog","aria-label":"存档原文",className:"dsh-context-archive"},
            h("div",{className:"dsh-context-archive-toolbar"},h("strong",null,"存档原文"),h("button",{type:"button",onClick:()=>setOpen(false)},"关闭")),
            h("p",null,"用于对照发送时的上下文；存档原文可能包含尚未发送的消息。"),
            snapshot?h("p",null,"共 "+snapshot.messageCount+" 条 · 存档版本 "+snapshot.storageRevision):null,
            h("div",{className:"dsh-context-archive-toolbar"},h("button",{type:"button",disabled:state.busy||!snapshot?.previousCursor,onClick:()=>void reader.earlier()},"更早 20 条"),
            h("button",{type:"button",disabled:state.busy,onClick:()=>void reader.latest()},"重新读取最新"),
            h("label",null,"楼层（从 0 开始）",h("input",{type:"number",min:0,max:Math.max(0,(snapshot?.messageCount||1)-1),value:floor,onChange:event=>setFloor(event.target.value)})),
            h("button",{type:"button",disabled:state.busy||!snapshot||floor===""||!Number.isSafeInteger(Number(floor))||Number(floor)<0||Number(floor)>=snapshot.messageCount,onClick:()=>void reader.at(Number(floor))},"查看该楼")),
            state.busy?h("p",{role:"status"},"正在读取…"):null,
            state.error?h("p",{role:"alert"},state.error):null,
            ...(snapshot?.messages||[]).map(row=>h("article",{key:row.message_id},h("strong",null,"#"+row.message_id+" · "+String(row.message?.role||"未知消息")),h("pre",{style:{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}},String(row.message?.swipes?.[row.message?.swipeId||0]??row.message?.sourceText??row.message?.text??"[无可用正文]"))))) :null);
}
