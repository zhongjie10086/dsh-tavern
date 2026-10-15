function TavernBackgroundGenerationSettings() {
  const h=React.createElement,[sessionId,setSessionId]=React.useState(''),[state,setState]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[recovery,setRecovery]=React.useState(null);
  React.useEffect(()=>{
    let active=true,timer;
    async function load(){
      try {const result=await rpc('getBackgroundScriptGeneration',{sessionId});if(active){setState(result);setError('');if(result.jobs.some(job=>job.status==='running'))timer=setTimeout(load,2000)}}
      catch(e){if(active)setError(e.message)}
    }
    void load();return()=>{active=false;clearTimeout(timer)};
  },[sessionId]);
  async function change(policy){setBusy(true);setError('');try{const result=await rpc('updateTavernSettings',{patch:{backgroundScriptGeneration:policy}});setState(current=>({...current,policy:result.settings.backgroundScriptGeneration}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function stop(job){setBusy(true);setError('');try{await rpc('stopBackgroundScriptGeneration',{sessionId:job.scope.sessionId,id:job.id});setState(await rpc('getBackgroundScriptGeneration',{sessionId}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function inspect(job,reviewed=false){setBusy(true);setError('');try{setRecovery(await rpc('recoverScriptGeneration',{sessionId:job.scope.sessionId,id:job.id,reviewed}));setState(await rpc('getBackgroundScriptGeneration',{sessionId}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  const policy=state?.policy;
  return h('section',{className:'dsh-tavern-settings-group',style:{minWidth:0,overflowWrap:'anywhere'}},h('h3',null,'后台脚本生成'),
    h('p',{className:'dsh-tavern-settings-desc'},'后台实例可按脚本自己的开关和 API 生成，重开页面会等待该实例处理完再接管。主模型脚本继续用正文模型。若关闭的是正在生成的前台页面，其后续脚本处理不能迁移：请在下方核对原结果，不会自动重发。关闭开关仅阻止之后的后台请求；已有任务可单独停止。'),
    policy?h('label',null,h('input',{type:'checkbox',checked:policy.enabled,disabled:busy,onChange:event=>change({...policy,enabled:event.target.checked})}),'允许后台脚本调用模型（全局）'):h('p',null,'正在读取…'),
    state?h('div',null,h('label',null,'查看脚本：',h('select',{'aria-label':'后台脚本所属游戏',value:sessionId,disabled:busy,onChange:event=>setSessionId(event.target.value)},h('option',{value:''},'全局脚本'),...state.sessions.map(row=>h('option',{key:row.sessionId,value:row.sessionId},row.title)))),
      h('p',null,'每个脚本的开关对相同脚本 ID 的游戏生效；同一轮后台最多 20 次请求，超过时暂停并在脚本日志提示。'),
      ...state.scripts.map(script=>h('label',{key:script.id,style:{display:'block'}},h('input',{type:'checkbox',checked:!policy.disabledScripts.includes(script.id),disabled:busy,onChange:event=>change({...policy,disabledScripts:event.target.checked?policy.disabledScripts.filter(id=>id!==script.id):[...policy.disabledScripts,script.id]})}),script.name)),
      state.jobs.length?h('ul',null,...state.jobs.map(job=>h('li',{key:job.id},(state.scripts.find(script=>script.id===job.scriptId)?.name||job.scriptId)+' · '+({'running':'生成中','completed':'模型已返回','failed':'失败','cancelled':'已停止','interrupted':'服务已重启，结果未知'}[job.status]||job.status)+(job.unconfirmed?' · 脚本处理尚未确认':'')+(job.error?'：'+job.error:''),job.status==='running'?h('button',{disabled:busy,onClick:()=>stop(job)},'停止原任务'):null,job.hasResult?h('button',{disabled:busy,onClick:()=>inspect(job)},'查看原结果'):null,job.unconfirmed&&job.status!=='running'?h('button',{disabled:busy,onClick:()=>inspect(job,true)},'已核对，允许后续请求'):null))):null):null,
    recovery?h('div',null,h('p',null,recovery.notice),h('textarea',{'aria-label':'原模型返回结果',readOnly:true,value:typeof recovery.result==='string'?recovery.result:recovery.result?JSON.stringify(recovery.result,null,2):'结果未保存或已中断；没有重新调用模型。',rows:8,style:{width:'100%',boxSizing:'border-box'}})):null,
    error?h('p',{role:'alert'},error):null);
}
