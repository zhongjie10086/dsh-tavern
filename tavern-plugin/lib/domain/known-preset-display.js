import {sha256Hex} from './portable-sha256.js'

// Audited against the supplied Izumi 0914 file and exercised in opaque browser
// frames. An edited rule falls back to the ordinary compatibility assessment.
const reviewed=new Map([
 ['ec057a96df276d4e964f14373a9cbb520c90f4fcdbcbfb50b376ff34a6f20821','izumi-danmaku'],
 ['e3e246b9d39446ce4b8afda4fd91c7a512b3d032b94caddac23c0293ed75ad13','izumi-thinking'],
 ['36a1ab14368980692e15879b9cd06bb22ed1c004266fdc745700ae572956d062','izumi-thinking-stream']
])
export function knownPresetDisplay(source){
 const text=String(source||'');if(!/<script\b/i.test(text))return null
 const adapter=reviewed.get(sha256Hex(text));if(!adapter)return null
 // A user can expand the streamed panel before its delayed listener is bound.
 // Reconcile its initial state after binding, without replaying any host event.
 const replacement=adapter==='izumi-thinking-stream'?text.replace('        });\n    }\n\n    setTimeout(init, 100);','        });\n        if(details.open)details.dispatchEvent(new Event("toggle"));\n    }\n\n    setTimeout(init, 100);'):text
 return {adapter,replacement}
}
