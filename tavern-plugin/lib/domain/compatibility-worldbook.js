import {createHash} from 'node:crypto'
import {regexFromString} from './tavern-regex-display.js'

const text=value=>typeof value==='string'?value:''
const integer=(value,fallback=0)=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):fallback
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const draw=value=>parseInt(digest(value).slice(0,8),16)/0x100000000
const order=(a,b)=>(Number(b.order)||0)-(Number(a.order)||0)||(Number(a.displayIndex)||0)-(Number(b.displayIndex)||0)
const groups=entry=>text(entry.group).split(',').map(s=>s.trim()).filter(Boolean)

export function compatibilityKeywordMatch(entry,source,settings={}) {
  if(entry.constant===true)return true
  const match=value=>{
    const key=text(value).trim();if(!key)return false
    if(/^\/.*\/[dgimsuvy]*$/.test(key)) { try{return regexFromString(key).test(source)}catch{return false} }
    const sensitive=entry.caseSensitive??settings.world_info_case_sensitive??false
    const haystack=sensitive?source:source.toLocaleLowerCase(),needle=sensitive?key:key.toLocaleLowerCase()
    if(!(entry.matchWholeWords??settings.world_info_match_whole_words))return haystack.includes(needle)
    return new RegExp('(^|[^\\p{L}\\p{N}_])'+needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}_])','u').test(haystack)
  }
  if(!(entry.primaryKeys||[]).some(match))return false
  const secondary=entry.secondaryKeys||[]
  if(!entry.selective||!secondary.length)return true
  const hits=secondary.map(match)
  return [()=>hits.some(Boolean),()=>!hits.every(Boolean),()=>!hits.some(Boolean),()=>hits.every(Boolean)][integer(entry.selectiveLogic)]?.()??false
}

/** Pure request selection. Timed effects use only traces belonging to committed
 * messages, so aborted requests and rolled-back branches cannot consume them. */
export function selectCompatibilityWorldInfo({chat,entries,input,settings={},book={},countTokens=value=>Array.from(value).length}) {
  const diagnostics=[],active=[],chosen=new Set(),failedProbability=new Set(),occupiedGroups=new Set()
  const available=(entries||[]).filter(entry=>entry?.enabled!==false&&text(entry.content).trim()&&!text(entry.comment).startsWith('[InitialVariables]')&&!/^(?:@@[^\r\n]*\r?\n)*@@initial_variables(?:\s|$)/m.test(text(entry.content))).filter(entry=>{
    if (['before','before_char','after','after_char'].includes(entry.position)||[0,1,2,3,4,5,6].includes(entry.position)) return true
    diagnostics.push({code:'worldbook-position',ref:entry.ref,message:'世界书位置不受支持，未混入其他位置。'});return false
  })
  const digests=new Map(available.map(entry=>[entry,digest(entry)]))
  const history=(chat.messages||[]).filter(message=>['user','assistant'].includes(message.role)&&message.is_system!==true)
  const pastTurns=[...new Set(history.filter(m=>m.role==='assistant'&&Number.isSafeInteger(m.turn)).map(m=>m.turn))]
  const round=pastTurns.length,activation=new Map()
  for(const [index,turn] of pastTurns.entries()) {
    for(const event of chat.compatibilityTraces?.[String(turn)]?.worldBookActivations||[]) {
      if(event&&typeof event.ref==='string')activation.set(event.ref,{...event,round:index})
    }
  }
  const seed=digest([chat.id,history.map(m=>[m.turn,m.role,m.sourceText||m.text]),input])
  const depth=integer(settings.world_info_depth,integer(book.scan_depth,2))
  const capacity=integer(settings.max_context,8192),budgetPercent=Math.min(100,integer(settings.world_info_budget,25))
  const budgets=[Math.floor(capacity*budgetPercent/100),integer(book.token_budget,Infinity),integer(settings.world_info_budget_cap,Infinity)||Infinity]
  const budget=Math.min(...budgets),recursive=settings.world_info_recursive??book.recursive_scanning??false
  const maxPasses=recursive?Math.min(100,available.length+1,integer(settings.world_info_max_recursion_steps)||100):1
  const activations=[];let used=0,recursiveText=''
  for(let pass=0;pass<maxPasses;pass++) {
    const candidates=available.filter(entry=>{
      if(chosen.has(entry.ref)||failedProbability.has(entry.ref))return false
      const prior=activation.get(entry.ref),age=prior?round-prior.round:Infinity
      const sticky=prior&&prior.digest===digests.get(entry)&&age<integer(prior.sticky)
      if(!sticky&&prior&&prior.digest===digests.get(entry)&&age<integer(prior.sticky)+integer(prior.cooldown))return false
      if(round<integer(entry.delay))return false
      if(sticky)return true
      if(pass===0&&entry.delayUntilRecursion)return false
      if(pass>0&&(entry.excludeRecursion||integer(entry.delayUntilRecursion)>pass))return false
      const scanDepth=integer(entry.scanDepth,depth)
      const scan=[...history.map(m=>text(m.sourceText||m.text)),text(input)].slice(-scanDepth||Infinity).join('\n')
      if(!compatibilityKeywordMatch(entry,scan+(pass?'\n'+recursiveText:''),settings))return false
      if(entry.probabilityEnabled!==false&&draw([seed,entry.ref,digests.get(entry)])*100>=Math.min(100,integer(entry.probability,100))) {failedProbability.add(entry.ref);return false}
      return true
    }).sort(order)
    // A group chooses one weighted candidate. Fixed request seed prevents a
    // retry from repeatedly rolling until a low-probability entry wins.
    const winners=new Map()
    for(const entry of candidates)for(const group of groups(entry)) {
      if(winners.has(group))continue
      const members=candidates.filter(row=>groups(row).includes(group)),overrides=members.filter(row=>row.rawEntry?.groupOverride)
      const sticky=members.find(row=>{const prior=activation.get(row.ref);return prior?.digest===digests.get(row)&&round-prior.round<integer(prior.sticky)})
      if(sticky){winners.set(group,sticky);continue}
      if(overrides.length){winners.set(group,overrides[0]);continue}
      const total=members.reduce((sum,row)=>sum+Math.max(1,integer(row.rawEntry?.groupWeight,100)),0)
      let threshold=draw([seed,'group',group])*total
      winners.set(group,members.find(row=>(threshold-=Math.max(1,integer(row.rawEntry?.groupWeight,100)))<0)||members.at(-1))
    }
    const accepted=[]
    for(const entry of candidates) {
      if(groups(entry).some(group=>occupiedGroups.has(group)||winners.get(group)!==entry))continue
      const size=Math.max(0,countTokens(text(entry.content)))
      if(used+size>budget&&entry.rawEntry?.ignoreBudget!==true){diagnostics.push({code:'worldbook-budget',ref:entry.ref,message:'世界书预算不足，未注入此条目。'});continue}
      used+=size;chosen.add(entry.ref);active.push(entry);accepted.push(entry)
      groups(entry).forEach(group=>occupiedGroups.add(group))
      const prior=activation.get(entry.ref),same=prior&&prior.digest===digests.get(entry)&&round-prior.round<integer(prior.sticky)
      if(!same)activations.push({ref:entry.ref,digest:digests.get(entry),sticky:Math.max(1,integer(entry.sticky)),cooldown:integer(entry.cooldown)})
    }
    if(!recursive||!accepted.length)break
    const additions=accepted.filter(entry=>!entry.preventRecursion).map(entry=>entry.content)
    if(!additions.length)break
    recursiveText+='\n'+additions.join('\n')
  }
  const before=[],after=[],atDepth=[],examplesBefore=[],examplesAfter=[],noteTop=[],noteBottom=[]
  for(const entry of active.sort(order)) {
    const content=text(entry.content).trim(),position=entry.position
    if(position===0||['before','before_char'].includes(position))before.push(content)
    else if(position===1||['after','after_char'].includes(position))after.push(content)
    else if(Number(position)===4)atDepth.push({content,depth:integer(entry.depth,4),role:['system','user','assistant'][integer(entry.role)]||'system',ref:entry.ref})
    else if(Number(position)===5)examplesBefore.push(content)
    else if(Number(position)===6)examplesAfter.push(content)
    else if(Number(position)===2)noteTop.push(content)
    else if(Number(position)===3)noteBottom.push(content)
    else diagnostics.push({code:'worldbook-position',ref:entry.ref,message:'世界书位置不受支持，未混入其他位置。'})
  }
  const note=[...noteTop,text(chat.tavernChatMetadata?.note_prompt||settings.author_note),...noteBottom].filter(Boolean).join('\n\n')
  if(note)atDepth.push({content:note,depth:integer(chat.tavernChatMetadata?.note_depth,integer(settings.author_note_depth,4)),role:'system',ref:'author-note'})
  return {before:before.join('\n\n'),after:after.join('\n\n'),depth:atDepth,examplesBefore,examplesAfter,refs:active.map(entry=>entry.ref),activations,diagnostics,tokens:used,budget}
}
