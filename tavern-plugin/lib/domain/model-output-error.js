/** Only an explicit output-parameter bound from a rejected request permits retry. */
export function modelOutputLimitFromError(payload,body){
 const error=payload?.error
 if(!error||typeof error!=='object')return null
 let parameter=['max_tokens','max_completion_tokens'].includes(error.param)?error.param:null
 let maximum=parameter?(error.maximum??error.max):null
 const message=typeof error.message==='string'&&error.message.length<=256?error.message:''
 if(!Number.isSafeInteger(maximum)){
  const field=/^(?:invalid(?: value| parameter)?(?: for)?\s*[:'" ]*)?(max_tokens|max_completion_tokens)\b/i.exec(message)
  if(!field)return null
  parameter=field[1].toLowerCase()
  const tail=message.slice(field[0].length)
  const match=/(?:less than or equal to|<=|≤|not exceed|exceeds?|maximum(?: value)?(?: is)?|between\s*1\s*and)\s*[:=]?\s*(\d{1,9})\b/i.exec(tail)||/\[\s*1\s*,\s*(\d{1,9})\s*\]/.exec(tail)
  maximum=match?Number(match[1]):null
 }
 return Number.isSafeInteger(maximum)&&maximum>0&&Number.isSafeInteger(body[parameter])&&body[parameter]>maximum?{parameter,requested:body[parameter],applied:maximum,source:'provider-rejection'}:null
}
