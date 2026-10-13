// Runs inside message frames. A sidebar refresh computes a static display in a
// sandbox, then updates the ORIGINAL realm; it never promotes a reduced-capability
// candidate to an interactive trusted frame.
function installTavernStaticStatusDisplay(token, candidate) {
  const controls = 'input,textarea,select,button,form,details,a[href],[contenteditable], [role="button"],[role="tab"],audio,video,iframe,object,embed';
  let protectedState = false, failed = false;
  function hasControls(root) {
    return Array.from(root.querySelectorAll(controls)).some(node => !node.closest('[data-dsh-script-composer]')?.hidden);
  }
  function protect(event) {
    if (!event.isTrusted || !event.target?.closest?.(controls)) return;
    protectedState = true;
    parent.postMessage({type:'dsh-tavern-frame-stateful',token}, '*');
  }
  ['input','change','click','toggle','play'].forEach(name => addEventListener(name, protect, true));
  function reject(reason) {
    failed = true;
    parent.postMessage({type:'dsh-tavern-status-refresh-failed',token,reason:typeof reason==='string'?reason:'candidate-failed'}, '*');
  }
  function displayChildren(node) {
    return Array.from(node.childNodes).filter(child => child.nodeType !== 1 || child.tagName !== 'SCRIPT'
      && !(child.matches('[data-dsh-script-composer]') && child.hidden));
  }
  function rootAttributes(node) { return Array.from(node?.attributes || [],attribute=>[attribute.name,attribute.value]); }
  function safeRootAttributes(entries) {
    return Array.isArray(entries) && entries.every(entry=>Array.isArray(entry) && entry.length===2 && typeof entry[0]==='string' && typeof entry[1]==='string'
      && /^[A-Za-z_:][\w:.-]*$/.test(entry[0]) && !/^on|^(?:contenteditable|srcdoc|is|nonce|manifest)$/i.test(entry[0])
      && !/^(?:javascript|vbscript):/i.test(entry[1].trim()));
  }
  function prepareRootAttributes(target, entries, updates) {
    if (!target || !safeRootAttributes(entries) || !safeRootAttributes(rootAttributes(target))) return false;
    const next=new Map(entries);
    for(const attribute of Array.from(target.attributes || []))if(!next.has(attribute.name))updates.push(()=>target.removeAttribute(attribute.name));
    for(const [name,value] of next)if(target.getAttribute(name)!==value)updates.push(()=>target.setAttribute(name,value));
    return true;
  }
  // Removing non-display scripts and serializing merges adjacent text nodes.
  // Compare logical text runs without dropping whitespace or moving elements.
  function displayGroups(node) {
    const groups=[];
    for (const child of displayChildren(node)) {
      // Layout normalization can leave an empty Text node in the live realm;
      // HTML serialization omits it. Ignore only that zero-length bookkeeping
      // in comparison, retaining the actual node and every nonempty whitespace.
      if (child.nodeType===3 && child.nodeValue==='') continue;
      const previous=groups[groups.length-1];
      if (child.nodeType===3 && previous?.nodeType===3) {previous.nodes.push(child);previous.nodeValue+=child.nodeValue;}
      else groups.push(child.nodeType===3?{nodeType:3,nodeValue:child.nodeValue,nodes:[child]}:child);
    }
    return groups;
  }
  function updateTextRun(group, value) {
    let offset=0;
    group.nodes.forEach((node,index)=>{
      const end=index===group.nodes.length-1?value.length:Math.min(value.length,offset+node.nodeValue.length);
      node.nodeValue=value.slice(offset,end);offset=end;
    });
  }
  function prepareUpdate(target, source, updates) {
    const oldChildren = displayGroups(target), nextChildren = displayGroups(source);
    if (oldChildren.every(node=>node.nodeType===3) && nextChildren.every(node=>node.nodeType===3)) {
      const value = nextChildren.map(node=>node.nodeValue).join('');
      if (oldChildren.length) updates.push(()=>updateTextRun(oldChildren[0],value));
      else if(value) updates.push(()=>target.appendChild(document.createTextNode(value)));
      return true;
    }
    if (oldChildren.length !== nextChildren.length) return false;
    for (let index=0;index<oldChildren.length;index++) {
      const before=oldChildren[index],after=nextChildren[index];
      if (before.nodeType !== after.nodeType) return false;
      if (before.nodeType === 3) {updates.push(()=>updateTextRun(before,after.nodeValue));continue;}
      if (before.nodeType !== 1 || before.tagName !== after.tagName || before.namespaceURI !== after.namespaceURI) return false;
      const attributes = new Map(Array.from(after.attributes,attribute=>[attribute.name,attribute.value]));
      for (const attribute of Array.from(before.attributes)) if (!attributes.has(attribute.name)) updates.push(()=>before.removeAttribute(attribute.name));
      for (const [name,value] of attributes) if (before.getAttribute(name)!==value) updates.push(()=>before.setAttribute(name,value));
      if (!prepareUpdate(before,after,updates)) return false;
    }
    return true;
  }
  if (candidate) {
    addEventListener('error', reject, true);
    addEventListener('unhandledrejection', reject);
  }
  window.__dshTavernStaticStatusSafe = () => !protectedState && !failed && !!document.body && !hasControls(document.body);
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || data?.token !== token) return;
    if (candidate && data.type === 'dsh-tavern-status-snapshot-request') {
      if (!window.__dshTavernStaticStatusSafe()) { reject(); return; }
      const copy = document.body.cloneNode(true);
      copy.querySelectorAll('script,[data-dsh-script-composer]').forEach(node => node.remove());
      for (const node of copy.querySelectorAll('*')) {
        for (const attribute of Array.from(node.attributes)) {
          if (/^on/i.test(attribute.name) || /^(?:javascript|vbscript):/i.test(attribute.value.trim())) { reject(); return; }
        }
      }
      const roots={html:rootAttributes(document.documentElement),body:rootAttributes(document.body)};
      if(!safeRootAttributes(roots.html)||!safeRootAttributes(roots.body)){reject();return;}
      parent.postMessage({type:'dsh-tavern-status-snapshot',token,html:copy.innerHTML,rootAttributes:roots,reads:window.__dshTavernStatusDisplayReads?.() || []}, '*');
    } else if (!candidate && data.type === 'dsh-tavern-status-apply') {
      if (!window.__dshTavernStaticStatusSafe() || !window.__dshTavernStatusCanApply?.(data.reads)) { reject(); return; }
      // Check again in the receiving realm, even though the host authenticated
      // the candidate. Do not import listeners, executable nodes or new controls.
      const template = document.createElement('template');
      template.innerHTML = String(data.html || '');
      if (template.content.querySelector(controls + ',script')) { reject(); return; }
      for (const node of template.content.querySelectorAll('*')) {
        for (const attribute of Array.from(node.attributes)) {
          if (/^on/i.test(attribute.name) || /^(?:javascript|vbscript):/i.test(attribute.value.trim())) { reject(); return; }
        }
      }
      const updates=[];
      if(data.rootAttributes && (!prepareRootAttributes(document.documentElement,data.rootAttributes.html,updates)||!prepareRootAttributes(document.body,data.rootAttributes.body,updates))){reject();return;}
      if (!prepareUpdate(document.body,template.content,updates)) { reject('structure-changed'); return; }
      // Validate the complete tree before the first edit. Keep every original
      // element, its handlers, private state and composer nodes in their realm.
      for (const update of updates) update();
      window.__dshTavernStatusDisplayApplied?.();
      parent.postMessage({type:'dsh-tavern-status-applied',token,refreshToken:data.refreshToken}, '*');
    }
  });
}

function tavernStatusReadCall(method, args) {
  return method === 'getTavernHelperWorldbook' || method === 'getTavernSqlCode'
    || method === 'tavernHelperComposer' && args?.operation?.kind === 'read'
    || method === 'tavernHelperBrowserCache' && args?.operation?.kind === 'get';
}
