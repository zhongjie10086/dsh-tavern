import {randomBytes} from 'node:crypto'
const prefix='/api/dsh-tavern/frame-unload/'
// One narrow, ephemeral capability. Lease state and consumption remain in dispatch.
// No cookies, general RPC, network grants, asset capabilities or user data here.
export function createFrameUnloadCapabilities({dispatch,scopeFor,random=()=>randomBytes(32).toString('base64url')}){
 function issue(sessionId,runtimeId){const scope=scopeFor(sessionId);if(!scope)return null;const access=dispatch.issueUnloadTicket(sessionId,runtimeId,scope,random);if(!access)return null;return {...access,participants:access.participants.map(({token,...participant})=>({...participant,path:prefix+Buffer.from(sessionId).toString('base64url')+'/'+token}))}}
 function parse(req){
  const origin=req.headers?.origin,authority=(req.socket?.encrypted?'https:':'http:')+'//'+req.headers?.host;
  if(req.method!=='POST'||origin!=='null'&&origin!==authority||req.headers?.['sec-fetch-mode']==='navigate'||['document','iframe','frame','object','embed'].includes(req.headers?.['sec-fetch-dest']))return null
  let pathname;try{const url=new URL(req.url,'http://cap.invalid');if(url.search||url.hash)return null;pathname=url.pathname}catch{return null}
  const match=new RegExp('^'+prefix+'([A-Za-z0-9_-]{1,512})/([A-Za-z0-9_-]{43})$').exec(pathname);if(!match)return null
  let sessionId;try{sessionId=Buffer.from(match[1],'base64url').toString('utf8');if(Buffer.from(sessionId).toString('base64url')!==match[1])return null}catch{return null}
  const scope=scopeFor(sessionId);if(!scope||!dispatch.acceptsUnloadTicket(sessionId,match[2],scope))return null
  return {sessionId,token:match[2],scope}
 }
 return Object.freeze({issue,accepts:req=>Boolean(parse(req)),vote(req){const value=parse(req);return value?dispatch.voteUnload(value.sessionId,value.token,value.scope):{released:false,invalid:true}}})
}
