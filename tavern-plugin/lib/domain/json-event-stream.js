/** Incremental SSE for OpenAI-compatible responses. Existing per-response byte
 * budgets are supplied by the caller; only the current line/event is buffered.
 * Handles UTF-8 and CRLF split at any byte, multiline data, comments and EOF.
 */
export async function* readJsonEventStream(response,{signal,maxBytes,label='模型 API',onBuffer}={}) {
  const decoder=new TextDecoder(),done=Symbol('done')
  let bytes=0,lineParts=[],lineLength=0,data=[],dataLength=0,skipLF=false
  function buffered(){onBuffer?.(lineLength+dataLength)}
  function dispatch(){
    if(!data.length)return
    const source=data.join('\n');data=[];dataLength=0
    if(source.trim()==='[DONE]')return done
    if(!source.trim())return
    try{return JSON.parse(source)}catch{throw Error(label+' SSE 数据不是有效 JSON，流已停止')}
  }
  function line(value){
    if(value==='')return dispatch()
    if(value.startsWith('data:')){const content=value.slice(value[5]===' '?6:5);data.push(content);dataLength+=content.length+1;buffered()}
  }
  function* consume(text){
    let start=0
    if(skipLF&&text){start=text[0]==='\n'?1:0;skipLF=false}
    const newline=/[\r\n]/g;newline.lastIndex=start
    for(let match;(match=newline.exec(text));){
      const end=match.index;lineParts.push(text.slice(start,end));lineLength+=end-start;buffered()
      const value=lineParts.join('');lineParts=[];lineLength=0
      start=end+1
      if(match[0]==='\r'){if(text[start]==='\n'){start++;newline.lastIndex=start}else if(start===text.length)skipLF=true}
      const parsed=line(value);if(parsed!==undefined)yield parsed
    }
    if(start<text.length){lineParts.push(text.slice(start));lineLength+=text.length-start;buffered()}
  }
  for await(const chunk of response.body){
    signal?.throwIfAborted();bytes+=chunk.byteLength
    if(bytes>maxBytes)throw Error(label+' 响应超过 '+maxBytes/1000000+'MB')
    for(const value of consume(decoder.decode(chunk,{stream:true}))){if(value===done)return;yield value}
  }
  signal?.throwIfAborted()
  for(const value of consume(decoder.decode())){if(value===done)return;yield value}
  if(lineParts.length){const value=line(lineParts.join(''));if(value===done)return;if(value!==undefined)yield value}
  const value=dispatch();if(value!==undefined&&value!==done)yield value
}
