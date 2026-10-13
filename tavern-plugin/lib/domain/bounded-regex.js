import {REGEX_LIMITS,withRegexBudget} from './regex-budget.js'
export {REGEX_LIMITS,withRegexBudget} from './regex-budget.js'
const natives=new WeakMap(),previous=new WeakMap(),replacements=new WeakMap()
function execute(regex,input,operation){
 if(input.length>REGEX_LIMITS.inputChars)throw Error('正则输入超过 2 Mi 字符限制')
 const start=operation==='matches'&&regex.global?0:Number(regex.lastIndex)||0,cached=previous.get(regex)
 if(operation==='matches'&&cached?.input===input&&cached.start===start){regex.lastIndex=cached.lastIndex;return cached.result}
 let native=natives.get(regex);if(!native){native=new RegExp(regex.source,regex.flags);natives.set(regex,native)}
 native.lastIndex=start
 const result=withRegexBudget(()=>{
  if(operation==='exec')return native.exec(input)
  const matches=[];let chars=0
  input.replace(native,(...args)=>{
   const groups=typeof args.at(-1)==='object'?args.pop():undefined;args.pop();const index=args.pop()
   chars+=args.reduce((n,s)=>n+(s?.length||0),0)
   // Empty matches may occur at every input boundary. Captured bytes and final
   // output, rather than a fixed 10k count, bound legitimate long transcripts.
   if(matches.length>input.length||chars>REGEX_LIMITS.outputChars)throw Error('正则捕获数据超过容量限制')
   matches.push({captures:args,index,groups});return ''
  })
  return matches
 })
 regex.lastIndex=native.lastIndex
 if(operation==='matches')previous.set(regex,{input,start,lastIndex:native.lastIndex,result})
 return result
}
function substitute(template,captures,index,input,groups){
 return template.replace(/\$([$&'`]|<([^>]+)>|(\d{1,2}))/g,(token,kind,name,digits)=>{
  if(kind==='$')return '$';if(kind==='&')return captures[0];if(kind==='`')return input.slice(0,index);if(kind==="'")return input.slice(index+captures[0].length)
  if(name!==undefined)return groups===undefined?token:groups[name]??''
  let number=Number(digits);if(number>0&&number<captures.length)return captures[number]??''
  if(digits.length===2){number=Number(digits[0]);if(number>0&&number<captures.length)return (captures[number]??'')+digits[1]}
  return token
 })
}
export class BoundedRegExp extends RegExp {
 constructor(pattern,flags){if(String(pattern).length>REGEX_LIMITS.patternChars)throw Error('正则表达式过长');super(pattern,flags)}
 exec(input){return execute(this,String(input),'exec')}
 [Symbol.replace](value,replacement){
  const input=String(value),start=this.global?0:Number(this.lastIndex)||0,cached=replacements.get(this)
  if(typeof replacement==='string'&&cached?.input===input&&cached.replacement===replacement&&cached.start===start){this.lastIndex=cached.lastIndex;return cached.output}
  const matches=execute(this,input,'matches');let offset=0,size=0;const parts=[]
  const append=part=>{size+=part.length;if(size>REGEX_LIMITS.outputChars)throw Error('正则替换结果超过 8 Mi 字符限制');parts.push(part)}
  for(const {captures,index,groups}of matches){
   const args=[...captures,index,input];if(groups!==undefined)args.push(Object.assign(Object.create(null),groups))
   const next=String(typeof replacement==='function'?replacement(...args):substitute(String(replacement),captures,index,input,groups))
   append(input.slice(offset,index));append(next);offset=index+captures[0].length
  }
  append(input.slice(offset));const output=parts.join('')
  if(typeof replacement==='string')replacements.set(this,{input,replacement,start,lastIndex:this.lastIndex,output})
  return output
 }
}
