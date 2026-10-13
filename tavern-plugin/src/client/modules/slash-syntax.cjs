// Shared verbatim Slash syntax for the host compiler and serialized iframe runtime.
function createTavernSlashSyntax(){
 function segments(source){const result=[];let start=0,quote='',escaped=false;for(let i=0;i<source.length;i++){const c=source[i];if(escaped){escaped=false;continue}if(c==='\\'){escaped=true;continue}if(quote){if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='|'&&/^\s*\//.test(source.slice(i+1))){result.push(source.slice(start,i).trim());start=i+1}}if(quote)throw Error('Slash 参数引号未闭合');result.push(source.slice(start).trim());return result}
 // Retain whitespace in the unnamed argument. Decode quoting without consuming
 // unrelated backslashes, e.g. Windows paths and regular expressions.
 function tokens(source){const rows=[];let index=0;while(index<source.length){while(/\s/.test(source[index]||'')&&index<source.length)index++;if(index>=source.length)break;const start=index;let value='',quote='';for(;index<source.length;index++){const c=source[index],next=source[index+1];if(c==='\\'&&next&&['\\','"',"'",'|'].includes(next)){value+=next;index++;continue}if(quote){if(c===quote)quote='';else value+=c;continue}if(c==='"'||c==="'"){quote=c;continue}if(/\s/.test(c))break;value+=c}if(quote)throw Error('Slash 参数引号未闭合');rows.push({value,start,end:index})}return rows}
 function parse(source){const rows=tokens(source),named=Object.create(null);let offset=1;for(;offset<rows.length;offset++){const match=/^([\w-]+)=([\s\S]*)$/.exec(rows[offset].value);if(!match)break;named[match[1]]=match[2]}const rest=rows.slice(offset),text=rest.map((row,i)=>row.value+(i+1<rest.length?source.slice(row.end,rest[i+1].start):'')).join('');return {name:rows[0]?.value.replace(/^\//,'').toLowerCase(),named,text,hasText:rest.length>0}}
 return {segments,tokens,parse};
}
// Client includes run inside the bundle module; only a real Node CJS module exports.
if(typeof module!=="undefined" && typeof module.filename==="string")module.exports=createTavernSlashSyntax;
