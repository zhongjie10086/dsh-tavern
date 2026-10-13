function createTavernDisplayedMessageRegistry(options = {}) {
  const callers = new WeakMap(), targets = new Set();
  const outcomes = new Map(); let outcomeBytes = 0;
  // Execution identity survives HTML-cache eviction and row virtualization.
  // Retain small digest keys for this page's session lifecycle. A newer
  // lifecycle fences the old records; business saves never use an LRU.
  const started = new Map(),lifecycles=new Map();
  function scope(identity){return JSON.stringify([identity.sessionId,identity.lifecycleRevision]);}
  function executionKey(identity,digest){return JSON.stringify([identity.messageId,identity.bodyId,identity.swipeId,digest||identity.messageDigest||'']);}
  function noteLifecycle(identity){
    const previous=lifecycles.get(identity.sessionId);
    if(previous===undefined||identity.lifecycleRevision>previous){
      lifecycles.set(identity.sessionId,identity.lifecycleRevision);
      for(const key of started.keys())if(JSON.parse(key)[0]===identity.sessionId)started.delete(key);
    }
  }
  let dispatch = null;
  function remember(key, value) {
    const bytes = (key.length + value.html.length) * 2;
    if (bytes > 2 * 1024 * 1024) return;
    if (outcomes.has(key)) outcomeBytes -= outcomes.get(key).bytes;
    outcomes.delete(key); outcomes.set(key,{...value,bytes}); outcomeBytes += bytes;
    while (outcomes.size > 64 || outcomeBytes > 2 * 1024 * 1024) {
      const oldest = outcomes.keys().next().value; outcomeBytes -= outcomes.get(oldest).bytes; outcomes.delete(oldest);
    }
  }
  function bind(frameWindow, scope) {
    if (!frameWindow) return function () {};
    const record = {scope}; callers.set(frameWindow, record);
    return () => { if (callers.get(frameWindow) === record) callers.delete(frameWindow); };
  }
  function retrieve(frameWindow, messageId) {
    const scope = callers.get(frameWindow)?.scope();
    if (!scope?.trusted || !scope.current || !Number.isInteger(messageId) || messageId < 0) return [];
    return Array.from(targets).filter(target => target.current() && target.identity.sessionId === scope.sessionId
      && target.identity.lifecycleRevision === scope.lifecycleRevision && target.identity.messageId === messageId
      && (scope.renderTarget ? scope.renderTarget === target && target.active : target.committed)).map(target => target.layer);
  }
  function register(native, layer, identity) {
    noteLifecycle(identity);
    // Only static text/Markdown. Never clone a live renderer/frame/media job.
    if (!native || !layer || native.querySelector('iframe,script,img,video,audio,object,embed,canvas') || identity.key.length > 512 * 1024) {
      layer?.setAttribute?.('data-dsh-display-state','unavailable'); return null;
    }
    let alive = true, baseline = '', committedHtml = '', writing = false;
    const cached = outcomes.get(identity.key);
    const target = {native,layer,identity,active:false,committed:false,attempted:!!cached,
      wasStarted(digest){identity.messageDigest=digest;return started.get(scope(identity))?.has(executionKey(identity,digest))===true;},
      current: () => alive && native.isConnected && layer.isConnected,
      begin() {
        if (!target.current()) throw new Error('正文显示目标已失效');
        const key=scope(identity);if(!started.has(key))started.set(key,new Set());started.get(key).add(executionKey(identity));target.attempted=true;
        baseline = native.innerHTML; writing = true; layer.innerHTML = baseline; writing = false;
        target.active = true;
        layer.setAttribute?.('data-dsh-display-state','rendering');
      },
      seal() {target.active=false;committedHtml=layer.innerHTML;layer.setAttribute?.('data-dsh-display-state','awaiting-host');},
      commit() {
        if (!target.current() || native.innerHTML !== baseline) throw new Error('正文显示版本已变化');
        target.active = false;
        target.committed = layer.innerHTML !== baseline;
        committedHtml = target.committed ? layer.innerHTML : baseline;
        native.hidden = target.committed; layer.hidden = !target.committed;
        layer.setAttribute?.('data-dsh-display-state',target.committed?'applied':'unchanged');
        target.acknowledged=true;
        // Re-mounting a virtualized row must not replay a callback's business
        // saves. Only an inert result can be restored without re-executing it.
        const restore = !layer.querySelector?.('script,iframe,img,video,audio,object,embed,canvas,input,textarea,select,button,form,[contenteditable]')
          && !Array.from(layer.querySelectorAll?.('*') || []).some(node=>Array.from(node.attributes||[]).some(attribute=>/^on/i.test(attribute.name)));
        remember(identity.key,{html:restore?committedHtml:'',changed:target.committed,restore});
      },
      abort(error) {
        target.active = false; target.committed = false; native.hidden = false; layer.hidden = true;
        writing = true; layer.replaceChildren(); writing = false; committedHtml = '';
        layer.setAttribute?.('data-dsh-display-state',error?'failed':'native');
        if(error)remember(identity.key,{html:'',changed:false,restore:false});
      },
      dispose() {
        alive = false; observer?.disconnect(); targets.delete(target); target.abort(target.attempted&&!target.acknowledged?new Error('正文显示实例已销毁'):undefined);
      }
    };
    const Observer = options.MutationObserver;
    const observer = Observer ? new Observer(() => {
      if (writing || target.active || !target.current() || layer.innerHTML === committedHtml) return;
      // A detached event callback has no save receipt that could acknowledge a
      // new display. Restore the acknowledged version rather than adopt it.
      writing = true; layer.innerHTML = committedHtml; writing = false;
      options.reportError?.(new Error('正文显示事件已结束，迟到改写未采用'));
    }) : null;
    observer?.observe(layer,{childList:true,subtree:true,attributes:true,characterData:true});
    if (cached) {
      target.committed = cached.changed && cached.restore;
      committedHtml = target.committed ? cached.html : '';
      writing = true; layer.innerHTML = committedHtml; writing = false;
      native.hidden = target.committed; layer.hidden = !target.committed;
      layer.setAttribute?.('data-dsh-display-state',target.committed?'restored':'native');
    } else layer.setAttribute?.('data-dsh-display-state','pending');
    targets.add(target); if (!target.attempted) dispatch?.(target); return target;
  }
  return {bind,retrieve,register,setDispatcher(value){dispatch=value; if(dispatch)for(const target of targets)dispatch(target);}};
}

function TavernDisplayedMessage(props) {
  const native = React.useRef(null), layer = React.useRef(null);
  React.useLayoutEffect(function () {
    const target = tavernDisplayedMessages.register(native.current,layer.current,props.identity);
    return () => target?.dispose();
  }, [props.identity.key]);
  return React.createElement('div',{className:'dsh-tavern-displayed-message'},
    React.createElement('div',{ref:native,'data-dsh-native-message-text':true},props.children),
    React.createElement('div',{ref:layer,hidden:true,className:'mes_text','data-mesid':props.identity.messageId,
      'data-dsh-session-id':props.identity.sessionId,'data-dsh-display-body-id':props.identity.bodyId,
      'data-dsh-display-swipe-id':props.identity.swipeId}));
}

function createTavernDisplayedMessageQueue(reportError) {
  const pending = new Map(), finished = new WeakSet();
  const jobs = new Map();let sequence = 0;
  return {
    add(target) { if (!finished.has(target) && !target.attempted) pending.set(target.identity.key,target); },
    hasPending() { return pending.size > 0; },
    clear() { pending.clear();const old=Array.from(jobs.values());jobs.clear();for(const job of old){finished.add(job.target);job.target.abort(job.target.attempted?new Error('正文显示已取消'):undefined);}return old; },
    take(eventId, target) { const job=jobs.get(eventId);return job && ['messageId','lifecycleRevision','swipeId','bodyId','messageDigest'].every(key=>job.packet[key]===target[key])?job:null; },
    defer(eventId) {
      const job=jobs.get(eventId);if(!job)return false;
      if(job.target.attempted)throw new Error('正文显示已开始，不能重新排队');
      jobs.delete(eventId);job.target.layer.setAttribute?.('data-dsh-display-state','pending');return true;
    },
    finish(eventId,error) {
      const job=jobs.get(eventId);if(!job)return;
      jobs.delete(eventId);pending.delete(job.target.identity.key);job.target.attempted=true;finished.add(job.target);
      try {if(error)throw error;job.target.commit();}
      catch(failure){job.target.abort(failure);reportError(failure);}
    },
    async flush(sessionId, runtime, current, enqueue) {
      for (const [key,target] of pending) {
        if (!target.current() || target.identity.sessionId !== sessionId) { pending.delete(key); continue; }
        if (!current()) return;
        if(Array.from(jobs.values()).some(job=>job.target===target))continue;
        try {
          const scriptIds=runtime.displayedMessageRecipients();
          if(scriptIds===null)continue;
          if(!scriptIds.length){target.attempted=true;finished.add(target);pending.delete(key);target.layer.setAttribute?.('data-dsh-display-state','unsubscribed');continue;}
          const job=await enqueue(target,scriptIds,++sequence);
          if(job?.alreadyStarted){target.attempted=true;finished.add(target);pending.delete(key);target.layer.setAttribute?.('data-dsh-display-state','native');continue;}
          if(job?.pending)continue;
          if(!job?.queued)throw new Error('正文显示工作未被宿主接受');
          jobs.set(job.packet.eventId,{...job,target});
          target.layer.setAttribute?.('data-dsh-display-state','queued');
          return true;
        } catch(error) {
          target.abort(error); target.attempted=true; finished.add(target); pending.delete(key); reportError(error);
        }
      }
    }
  };
}
