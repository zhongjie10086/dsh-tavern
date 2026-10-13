import { statusViewDeclaration } from './status-view-declaration.js'
import { marked } from 'marked'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { renderTavernMacros } from './tavern-macro-engine.js'

export function createTemplateBrowserServices({ context, environment = () => ({}), command, reportError = () => {} }) {
  function regex(value, placement, options = {}) {
    const scripts = [...(environment().regexScripts || []), ...(context().extension_settings.regex || [])]
    const displayScripts=options.statusBoundaries?scripts.map((rule,index)=>{
      const declaration=statusViewDeclaration(rule)
      if(!declaration||!/<(?:script|iframe|object|embed)\b/i.test(rule.replaceString||''))return rule
      const content=String(rule.replaceString).replace(/^\s*```(?:html|htm)?\s*\n([\s\S]*?)\n```\s*$/i,'$1')
      return {...rule,replaceString:'<div data-dsh-template-status="'+index+'" data-dsh-status-key="'+encodeURIComponent(declaration.key)+'">'+content+'</div>'}
    }):scripts
    const result=applyTavernRegexText(value,displayScripts.map(rule=>({...rule,enabled:rule.enabled!==false&&rule.disabled!==true})),{...options,placement})
    for(const warning of result.warnings)reportError(warning)
    return result.text
  }
  function macros(value) {
    const c=context(), globals=c.extension_settings.variables ||= {}, local=c.chat_metadata.variables ||= {}
    const result=renderTavernMacros(value,{chatId:c.chatId||c.chat_id||c.getCurrentChatId?.(),charName:c.name2,userName:c.name1,localVariables:local,globalVariables:globals.global||{},lastUserMessage:c.chat.findLast(m=>m.is_user)?.mes,lastCharMessage:c.chat.findLast(m=>!m.is_user&&!m.is_system)?.mes,lastMessage:c.chat.at(-1)?.mes})
    for(const key of Object.keys(local))if(!Object.hasOwn(result.localVariables,key))delete local[key]
    Object.assign(local,result.localVariables);globals.global=result.globalVariables
    return result.text
  }
  function formatting(value, _name, isSystem=false, isUser=false, id=-1) {
    const text=regex(value,isUser?1:2,{isMarkdown:true,statusBoundaries:true,depth:Math.max(0,context().chat.length-Number(id)-1)})
    const templates=[]
    const protectedText=String(text).replace(/<%[\s\S]*?%>/g,match=>{templates.push(match);return 'DSHTEMPLATETOKEN'+(templates.length-1)+'END'})
    return marked.parse(protectedText,{gfm:true,breaks:true}).replace(/DSHTEMPLATETOKEN(\d+)END/g,(_match,index)=>templates[Number(index)].replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'))
  }
  return {
    getUserAvatar: () => environment().userAvatar || '',
    getThumbnailUrl: (_kind,name) => environment().avatars?.[name] || '',
    getCharaFilename: () => environment().characterFilename || '',
    getChatCompletionModel: () => environment().model || '',
    substituteParams: macros, getRegexedString: regex,
    getTokenCountAsync: async value => Math.ceil(Array.from(String(value??'')).reduce((count,char)=>count+(char.codePointAt(0)>127?1:0.25),0)),
    messageFormatting: formatting,
    updateMessageBlock: (id,message) => { const block=document.querySelector('div.mes[mesid="'+Number(id)+'"] .mes_text');if(block)block.innerHTML=formatting(message.mes,message.name,message.is_system,message.is_user,id) },
    appendMediaToMessage: (message,parent) => { const element=parent?.jquery?parent[0]:parent;for(const media of message.extra?.media||[])if(media.url){const image=document.createElement('img');image.src=media.url;element?.append(image)} },
    addCopyToCodeBlocks: parent => { for(const pre of parent.find('pre')) {if(pre.querySelector('[data-template-copy]'))continue;const button=document.createElement('button');button.textContent='复制';button.dataset.templateCopy='true';button.addEventListener('click',()=>navigator.clipboard.writeText(pre.querySelector('code')?.textContent||pre.textContent).catch(error=>reportError(error.message)));pre.append(button)} },
    updateReasoningUI: parent => { parent.find('.reasoning').attr('data-ready','true') },
    executeSlashCommandsWithOptions: async source => { const match=String(source).match(/^\/?([\w-]+)\s*([\s\S]*)$/);if(!match)throw new Error('命令格式无效');return {pipe:await command(match[1],{},match[2])} },
    callGenericPopup: () => { throw new Error('此操作需要在模板设置窗口执行') },
    copyText: value => {if(!navigator.clipboard?.writeText)throw new Error('当前窗口不能访问剪贴板');return navigator.clipboard.writeText(String(value))},
    onPersistenceError: error=>reportError(error.message)
  }
}
