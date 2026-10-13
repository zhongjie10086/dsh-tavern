const cache=new Map();let cacheBytes=0
function hideVariableBlocks(html) {
 if(typeof html!=='string'||!/<(?:initvar|updatevariable)\b/i.test(html))return html
 if(cache.has(html))return cache.get(html)
 const source=html,ranges=[],protectedTags=new Set(['pre','code','textarea','template','script','style']),rawTags=new Set(['textarea','script','style']),stack=[]
 let offset=0,block=null
 // A source-preserving tag scanner: quoted attributes/comments and protected
 // examples never become protocol blocks. No DOM execution or serialization.
 while(offset<html.length){
  const start=html.indexOf('<',offset);if(start<0)break
  if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);offset=end<0?html.length:end+3;continue}
  const match=/^<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b/i.exec(html.slice(start));if(!match){offset=start+1;continue}
  let end=start+match[0].length,quote=''
  for(;end<html.length;end++){const ch=html[end];if(quote){if(ch===quote)quote=''}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break}
  if(end===html.length)break
  offset=end+1;const name=match[2].toLowerCase(),closing=!!match[1]
  const raw=stack.at(-1)
  if(rawTags.has(raw)){if(closing&&name===raw)stack.pop();continue}
  if(protectedTags.has(name)){
   if(closing){const at=stack.lastIndexOf(name);if(at>=0)stack.length=at}else stack.push(name)
   continue
  }
  if(stack.length)continue
  if(name!=='initvar'&&name!=='updatevariable')continue
  if(!closing){if(block)block.names.push(name);else block={start,names:[name]}}
  else if(block){const at=block.names.lastIndexOf(name);if(at>=0)block.names.length=at;if(!block.names.length){ranges.push([block.start,offset]);block=null}}
 }
 if(block)ranges.push([block.start,html.length])
 for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))html=html.slice(0,start)+html.slice(end)
 const bytes=(source.length+html.length)*2
 if(bytes<=4*1024*1024){while(cache.size>=64||cacheBytes+bytes>4*1024*1024){const key=cache.keys().next().value;cacheBytes-=(key.length+cache.get(key).length)*2;cache.delete(key)}cache.set(source,html);cacheBytes+=bytes}
 return html
}
export function visibleTemplateDisplay(display) {
 const result={...display,html:hideVariableBlocks(display.html)}
 if(Array.isArray(display.parts))result.parts=display.parts.map(part=>part.kind==='html'?{...part,content:hideVariableBlocks(part.content)}:part)
 return result
}
