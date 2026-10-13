import { decodeTavernSource } from './session-message-source.js'
/** The native system projection owns system/message nodes and replaces them each turn.
 * Authored system floors therefore keep a native plugin envelope and restore their
 * individual system role only at the final model request boundary. */
export function projectHelperSystemHistory(request) {
  let changed=false
  const messages=request.messages.map(message=>{
    const source=decodeTavernSource(message.source)
    if(message.role!=='user'||source?.plugin!=='dsh-tavern-helper-system'||source.authoredRole!=='system')return message
    changed=true;return {...message,role:'system'}
  })
  return changed?{...request,messages}:request
}
