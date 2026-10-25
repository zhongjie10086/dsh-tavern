// Identifier scanner adapted from SP 1.2.9, AlbusKen/shujuku commit 85eaa78ab6908adc84a2ef5c5278f25e8d296317.
// Retains upstream handling of strings/comments/quoted identifiers and DML targets.
// Only the target identifier is rebound; SQLite resolves read aliases via views.
const quote = value => '"'+String(value).replaceAll('"','""')+'"'
export function spSqlAliasBindings(schema) {
 const physical=new Set(schema.map(table=>table.name.toLowerCase())),aliases=new Map(),ambiguous=new Set()
 for(const table of schema)for(const name of table.aliases||[]) {
  const key=name.toLowerCase();if(physical.has(key)||ambiguous.has(key))continue
  if(aliases.has(key)&&aliases.get(key)!==table.name){aliases.delete(key);ambiguous.add(key)}else aliases.set(key,table.name)
 }
 return {aliases,ambiguous}
}
export function bindSpSqlMutationTarget(source,{aliases,ambiguous}) {
 const parsed=tokens(source),target=mutationTarget(source,parsed)
 if(!target)return source
 const key=target.value.toLowerCase()
 if(ambiguous.has(key))throw Object.assign(Error('SQL 表别名存在歧义：'+target.value),{code:'SP_SQL_ALIAS_AMBIGUOUS'})
 const physical=aliases.get(key);if(!physical)return source
 // Preserve the authored table qualifier (including UPSERT expressions). Explicit
 // AS aliases are already authoritative and must remain byte-for-byte unchanged.
 const next=parsed[parsed.indexOf(target)+1],suffix=keyword(next,'AS')?'':' AS '+quote(target.value)
 return source.slice(0,target.start)+quote(physical)+suffix+source.slice(target.end)
}
function wordStart(t){
  return/^[A-Za-z_\u0080-\uFFFF]$/.test(t)
}
function wordPart(t){
  return/^[A-Za-z0-9_$\u0080-\uFFFF]$/.test(t)
}
function keyword(t,n){
  return!!t&&null===t.quote&&t.value.toUpperCase()===n
}
function tokens(t){
  const n=[];
  let o=0,i=0;
  const s=new Set;
  for(;
  o<t.length;
  ){
    const l=t[o],g=t[o+1];
    if("-"!==l||"-"!==g){
      if("/"===l&&"*"===g){
        const n=t.indexOf("*/",o+2);
        if(n<0)throw new Error("unterminated comment");
        o=n+2;
        continue
      }
      if("'"!==l)if(","!==l)if("("!==l)if(")"!==l){
        if('"'===l||"`"===l||"["===l){
          const g=l,u="["===g?"]":g,C=o;
          let I="";
          o+=1;
          let m=!1;
          for(;
          o<t.length;
          )if(t[o]!==u)I+=t[o++];
          else{
            if(t[o+1]!==u){
              o+=1,m=!0;
              break
            }
            I+=u,o+=2
          }
          if(!m)throw new Error("unterminated quoted identifier");
          n.push({
            start:C,end:o,value:I,quote:g,depth:i,commaBefore:s.delete(i)
          }
          );
          continue
        }
        if(wordStart(l)){
          const l=o;
          for(o+=1;
          o<t.length&&wordPart(t[o]);
          )o+=1;
          n.push({
            start:l,end:o,value:t.slice(l,o),quote:null,depth:i,commaBefore:s.delete(i)
          }
          );
          continue
        }
        o+=1
      }
      else i=Math.max(0,i-1),o+=1;
      else s.delete(i),i+=1,o+=1;
      else s.add(i),o+=1;
      else{
        for(o+=1;
        o<t.length;
        )if("'"!==t[o])o+=1;
        else{
          if("'"!==t[o+1]){
            o+=1;
            break
          }
          o+=2
        }
        if("'"!==t[o-1])throw new Error("unterminated string")
      }
    }
    else for(o+=2;
    o<t.length&&"\n"!==t[o]&&"\r"!==t[o];
    )o+=1
  }
  return n
}
function qualifiedTail(t,n,o){
  let i=n[o];
  if(!i)return;
  let s=o;
  for(;
  n[s+1]&&n[s+1].depth===i.depth&&/^\s*\.\s*$/.test(t.slice(i.end,n[s+1].start));
  )i=n[++s];
  return i
}
function mutationTarget(t,n){
  const o=keyword(n[0],"WITH")?n.findIndex((t,n)=>n>0&&0===t.depth&&["INSERT","REPLACE","UPDATE","DELETE"].includes(t.value.toUpperCase())):0,i=n[o];
  if(i){
    if(keyword(i,"INSERT")||keyword(i,"REPLACE")){
      let s=o+1;
      return keyword(i,"INSERT")&&keyword(n[s],"OR")&&(s+=2),keyword(n[s],"INTO")?qualifiedTail(t,n,s+1):void 0
    }
    if(keyword(i,"UPDATE")){
      let i=o+1;
      return keyword(n[i],"OR")&&(i+=2),qualifiedTail(t,n,i)
    }
    return keyword(i,"DELETE")&&keyword(n[o+1],"FROM")?qualifiedTail(t,n,o+2):void 0
  }
}
