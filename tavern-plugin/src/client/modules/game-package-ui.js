function TavernGamePackageImport({disabled,onError,onImported}) {
  const input=React.useRef(null),[selection,setSelection]=React.useState(null),[busy,setBusy]=React.useState(false);
  const currentTransfer=React.useRef(null);
  function discard() {const id=currentTransfer.current;currentTransfer.current=null;if(id)void fetch('/api/dsh-tavern/game-package-files/'+id,{method:'DELETE'}).catch(()=>{});}
  React.useEffect(()=>()=>discard(),[]);
  async function preview(file) {
    if(!file)return;setBusy(true);onError("");discard();setSelection(null);
    try {
      if(file.size>512*1024*1024)throw new Error('整局包超过 512 MiB 文件上限');
      const response=await fetch('/api/dsh-tavern/game-package-files',{method:'POST',headers:{'Content-Type':'application/json'},body:file});
      const result=await readTavernJsonResponse(response);
      if(!response.ok||!result.ok)throw new Error(result.error||'文件上传失败');
      currentTransfer.current=result.transferId;
      setSelection({transferId:result.transferId,preview:result.preview,mode:"follow",trust:false});
    }
    catch(error){onError("整局包预览失败："+String(error.message||error));}finally{setBusy(false);}
  }
  async function run() {
    if(!selection||busy)return;setBusy(true);onError("");
    const key="dsh-tavern:game-package:"+selection.preview.sha256+":"+selection.mode+":"+selection.trust;
    try {
      let operationId=localStorage.getItem(key);if(!operationId){operationId=crypto.randomUUID();localStorage.setItem(key,operationId);}
      const result=await rpc("importGamePackage",{transferId:selection.transferId,mode:selection.mode,trustResources:selection.trust,operationId});
      await onImported({sessionId:result.sessionId,targetMode:result.mode});localStorage.removeItem(key);discard();setSelection(null);
    }catch(error){onError("整局包导入失败，可用相同文件与选项重试："+String(error.message||error));}finally{setBusy(false);}
  }
  const h=React.createElement;
  return h(React.Fragment,null,
    h("button",{className:"dsh-tavern-btn",style:{margin:"0 12px 8px"},disabled:disabled||busy,onClick:()=>input.current.click()},busy?"正在处理整局包…":"导入整局包"),
    h("input",{ref:input,type:"file",accept:".json,application/json","aria-label":"整局包文件",hidden:true,onChange:event=>{preview(event.target.files?.[0]);event.target.value="";}}),
    selection?h("div",{className:"dsh-tavern-picker-overlay",style:{position:"fixed",zIndex:10020}},
      h("section",{role:"dialog","aria-label":"导入整局包",style:{background:"var(--dsw-alias-bg-base,#fff)",color:"var(--dsw-alias-label-primary,#222)",borderRadius:12,padding:24,width:"min(620px,90vw)",maxHeight:"85vh",overflow:"auto",boxSizing:"border-box"}},
        h("h3",null,"导入整局包 · "+selection.preview.title),
        h("p",null,selection.preview.messages+" 条消息 · "+selection.preview.dependencies.length+" 项依赖 · "+selection.preview.storyCheckpoints+" 个历史版本"),
        h("p",null,selection.preview.notice),
        selection.preview.resourcePlan?.length?h("details",null,h("summary",null,"共享资源与配置核对："+selection.preview.resourcePlan.length+" 项"),selection.preview.resourcePlan.map((row,i)=>h("p",{key:i,style:{overflowWrap:"anywhere"}},row.path+"："+({new:"新增",reused:"复用现有相同内容",mismatch:"失配，按下方冲突方案分别保留"}[row.status])))):null,
        h("label",null,"资源版本 ",h("select",{"aria-label":"整局包资源版本",disabled:busy,value:selection.mode,onChange:event=>setSelection({...selection,mode:event.target.value})},h("option",{value:"follow"},"跟随已安装资源的后续更新"),h("option",{value:"pinned"},"固定本包的预设和脚本版本"))),
        h("p",null,h("label",null,h("input",{type:"checkbox",disabled:busy,checked:selection.trust,onChange:event=>setSelection({...selection,trust:event.target.checked})})," 信任本包的卡片、预设和脚本（一次授信，正常更新继续有效）")),
        selection.preview.conflicts.length?h("details",null,h("summary",null,"目标端已有资源："+selection.preview.conflicts.length+" 项"),selection.preview.conflicts.map((row,i)=>h("p",{key:i},row.path+"："+row.action))):null,
        selection.preview.missing.length?h("details",null,h("summary",null,"未携带或仍需联网："+selection.preview.missing.length+" 项"),selection.preview.missing.map((row,i)=>h("p",{key:i,style:{overflowWrap:"anywhere"}},row.source+"："+row.action))):null,
        h("div",{style:{display:"flex",gap:12,marginTop:20}},h("button",{className:"dsh-tavern-btn",disabled:busy,onClick:run},busy?"正在导入…":"导入并打开"),h("button",{className:"dsh-tavern-btn",disabled:busy,onClick:()=>{discard();setSelection(null);}},"取消")))):null);
}
