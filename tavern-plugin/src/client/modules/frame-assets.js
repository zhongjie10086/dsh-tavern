function scopeTavernAssetUrl(value,access) {
  let source=String(value || '');
  if (!access?.prefix) return source;
  if(typeof document!=='undefined' && document.baseURI){
    try{const parsed=new URL(source,document.baseURI),base=new URL(document.baseURI);
      if(parsed.origin===base.origin && parsed.pathname.startsWith('/api/dsh-tavern/')){
        if(parsed.pathname.startsWith('/api/dsh-tavern/frame-assets/')||parsed.pathname.startsWith('/api/dsh-tavern/vendor/')||parsed.pathname.startsWith('/api/dsh-tavern/client-assets/'))return parsed.href;
        source=parsed.pathname+parsed.search;
      }
    }catch{}
  }
  if (/^https?:\/\//i.test(source)) source='/api/dsh-tavern/static-assets?url='+encodeURIComponent(source);
  if (!/^\/api\/dsh-tavern\/(?:static-assets\?|remote-assets\/|(?:card-image|scene-image)\?|script-images\/)/.test(source)) return source;
  // Module code can later be moved into a data/blob module by a card.
  // Its capability URL must keep the host origin without relying on that base.
  let prefix=access.prefix;
  if (typeof document !== 'undefined' && document.baseURI) prefix=new URL(prefix,document.baseURI).href;
  return prefix+'?url='+encodeURIComponent(source);
}
function scopeTavernAssetText(value,access) {
  if (!access?.prefix) return String(value);
  return String(value).replace(/\/api\/dsh-tavern\/(?:static-assets\?[^\s"'`<>\\)]+|remote-assets\/[^\s"'`<>\\)]+|(?:card-image|scene-image)\?[^\s"'`<>\\)]+|script-images\/[^\s"'`<>\\)]+)/g,url=>scopeTavernAssetUrl(url,access));
}
function tavernFrameAssetBootstrap(access) {
  if (!access?.prefix) return '';
  return '<script data-dsh-frame-assets>('+function(access,scope) {
    window.__dshTavernScopeAsset=value=>scope(value,access);
    const original=window.fetch;
    window.__dshTavernReadAssetFailures=async()=>{const response=await original.call(window,new URL(access.prefix,document.baseURI).href+'?diagnostics=1',{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!response.ok)return [];return (await response.json()).failures||[]};
    window.fetch=function(resource,init){const direct=access.networkAllowed && /^https?:\/\//i.test(typeof resource==='string'?resource:resource?.url || '');return original.call(this,direct?resource:typeof resource==='string'?window.__dshTavernScopeAsset(resource):resource,init)};
    const open=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,access.networkAllowed && /^https?:\/\//i.test(String(url))?url:window.__dshTavernScopeAsset(url),...args)};
  }.toString()+')('+JSON.stringify(access).replace(/</g,'\\u003c')+','+scopeTavernAssetUrl.toString()+');<\/script>';
}
