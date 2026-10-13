function TavernSessionHealth(props){
 const h=React.createElement,[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),health=props.item?.storageHealth;
 if(!health)return null;
 const label=({unreadable:'存档不可读取',missing:'存档缺失',blocked:'需人工检查',unknown:'状态待检查',partial:'恢复未完成',repairable:'可恢复'}[health.status]||'状态需检查');
 async function run(exporting){setBusy(true);setError('');try{
  if(exporting){const result=await props.api('exportStorageDiagnostic',{chatId:props.item.chatId}),url=URL.createObjectURL(new Blob([result.text],{type:'application/json;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=result.filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
  else await props.api('doctorTavern',{chatId:props.item.chatId,repair:false});
  await props.onChanged?.();
 }catch(e){setError(e.message)}finally{setBusy(false)}}
 return h('details',{className:'dsh-storage-health','aria-label':'存档状态：'+(props.item.title||props.item.cardName||props.item.chatId)},
  h('summary',null,h('span',{role:'status'},label)),
  h('p',null,'上次检查：'+new Date(health.checkedAt).toLocaleString()),
  health.resourcePath?h('p',null,'无法读取的路径：',h('code',{style:{overflowWrap:'anywhere'}},health.resourcePath)):null,
  health.code?h('p',null,'诊断代码：'+health.code):null,
  health.dataDirectory?h('label',null,'数据目录（可选中复制）',h('input',{'aria-label':'存档数据目录',readOnly:true,value:health.dataDirectory,onFocus:e=>e.target.select()})):null,
  h('p',null,'诊断文件包含状态、路径与运行版本；不包含聊天正文或API凭据。'),
  h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>run(false)},'重新检查此存档'),
  h('button',{className:'dsh-tavern-btn',disabled:busy,onClick:()=>run(true)},'导出存档诊断'),error?h('p',{role:'alert'},error):null);
}
