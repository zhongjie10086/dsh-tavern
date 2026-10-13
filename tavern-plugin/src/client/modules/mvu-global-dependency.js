// Serialized into each script realm. Core availability is authenticated by the
// runtime owner; companion data operations retain the companion's own identity.
function installTavernMvuGlobalDependency(options) {
  const { window, parent, metadata, currentScript, validate, createDataBridge } = options;
  const required = metadata.officialMvu === true;
  const isCore = () => currentScript().id === metadata.mvuCoreId;
  const waiters = new Set(), starters = new Set(), admissionWaiters = new Set(), attemptWaiters = new Set();
  // A preparation preview runs the core and its companions in one realm, where no host
  // answers admission requests; the core's state is observed here directly (Z92).
  const sharedRealm = required && Array.isArray(metadata.scripts) && metadata.scripts.length > 1
    && metadata.scripts.some(script => String(script && script.id) === String(metadata.mvuCoreId));
  let admitted = sharedRealm;
  let closed = false, retryableFailure = false, epoch = -1; const started = new Set();
  let initialized = false, failure = '', value;
  function settle() {
    if (!initialized && !failure) return;
    for (const waiter of waiters) failure ? waiter.reject(new Error(failure)) : waiter.resolve(value);
    waiters.clear();
  }
  function fail(message) {
    initialized = false;
    failure = 'MVU 依赖失败：' + String(message || '核心初始化失败');
    if (window.Mvu === value) delete window.Mvu;
    value = undefined;
    settle();
  }
  function ready(events) {
    // This is a readiness-gated, caller-owned data surface, never a way to
    // invoke privileged code or read another frame's variables or resources.
    if (!initialized) value = createDataBridge();
    value.events = { ...value.events, ...events };
    window.Mvu = value; initialized = true; failure = ''; retryableFailure = false;
    settle();
    for(const starter of starters) starter.resolve(value);
    starters.clear();
    attemptEnded();
  }
  // R8 Z86: the current core attempt has ended (ready or failed, even retryable).
  function attemptEnded() {
    for(const waiter of attemptWaiters) waiter.resolve();
    attemptWaiters.clear();
  }
  // A failed core in this realm ends the attempt like the host's failed notice.
  function releaseCompanions() {
    for(const starter of starters) starter.reject(new Error(failure));
    starters.clear();
    attemptEnded();
  }
  if (!required && options.enabled) window.Mvu = createDataBridge();
  // A realm created after the host saw the core ready starts with Mvu, like the
  // original helper predefining it for iframes opened after initialization.
  if (required && !isCore() && metadata.mvuReady && typeof metadata.mvuReady === 'object') ready(metadata.mvuReady.events || {});
  function initializeMvu(next) {
    if (!isCore()) throw new Error('MVU 只能由当前核心 initializeGlobal 初始化');
    try { validate(next, metadata.mvuVersionSelection); }
    catch (error) {
      // An incompatible publication ends this attempt now: waiters receive the
      // reason instead of hanging until the host's initialization deadline.
      initialized = false; value = undefined;
      failure = String(error && error.message || error || 'MVU 核心不兼容');
      settle();
      if (sharedRealm) releaseCompanions();
      throw error;
    }
    value = next; initialized = true; failure = '';
    window.Mvu = next;
    const events = {};
    for (const [key, event] of Object.entries(next.events || {})) if (typeof event === 'string') events[key] = event;
    parent.postMessage({ type: 'dsh-tavern-mvu-global-initialized', token: metadata.token, scriptId: metadata.mvuCoreId, events }, '*');
    settle();
    if (sharedRealm) {
      for (const starter of starters) starter.resolve(value);
      starters.clear();
      attemptEnded();
    }
  }
  if (required && isCore()) {
    // The pinned original publishes the same contract via set(window, 'Mvu')
    // plus eventEmit, instead of calling initializeGlobal. Only its own emitter
    // can normalize this publication; emitHost/relayed events cannot do so.
    const emit = window.eventEmit;
    const emitInitialized = function (name, ...args) {
      if (name === 'global_Mvu_initialized') initializeMvu(window.Mvu);
      return emit(name, ...args);
    };
    window.eventEmit = window.eventEmitAndWait = emitInitialized;
  }
  window.initializeGlobal = function (name, next) {
    if (name === 'Mvu' && required) initializeMvu(next);
    else window[name] = next;
    return window.eventEmit('global_' + String(name) + '_initialized');
  };
  window.waitGlobalInitialized = async function (name) {
    if (name === 'Mvu' && required) {
      // The core realm runs no other card script, so a value it assigned itself
      // is its own publication (the original helper accepts plain assignment).
      // It is validated and announced exactly like initializeGlobal.
      if (isCore() && window.Mvu !== undefined) {
        if (!initialized) initializeMvu(window.Mvu);
        else validate(window.Mvu, metadata.mvuVersionSelection);
      }
      if (failure) throw new Error(failure);
      if (initialized) return value;
      return await new Promise((resolve, reject) => waiters.add({ resolve, reject }));
    }
    if (window[name] !== undefined) return window[name];
    return await new Promise(resolve => {
      const eventName = 'global_' + String(name) + '_initialized';
      const listener = function () { window.eventOff(eventName, listener); resolve(window[name]); };
      window.eventOn(eventName, listener);
    });
  };
  function cancel(message) {
    if(closed)return;
    closed = true; fail(message || '脚本初始化已取消');
    for(const starter of starters)starter.reject(new Error(failure));
    starters.clear();
    for(const waiter of admissionWaiters)waiter.reject(new Error(failure));
    admissionWaiters.clear();
    for(const waiter of attemptWaiters)waiter.reject(new Error(failure));
    attemptWaiters.clear();
  }
  if (required) {
    window.addEventListener('message', function (event) {
      const data = event.data;
      if (event.source !== parent || data?.token !== metadata.token || isCore()) return;
      if(data.type==='dsh-tavern-mvu-start-cancel'){cancel(data.error);return;}
      if(data.type!=='dsh-tavern-mvu-dependency-state'||closed)return;
      admitted = true;
      for(const waiter of admissionWaiters)waiter.resolve();
      admissionWaiters.clear();
      const state = data.state;
      const incomingEpoch=Number(state?.epoch);
      if(Number.isFinite(incomingEpoch)){if(incomingEpoch<epoch)return;epoch=incomingEpoch;}
      if (state?.phase === 'failed') {
        retryableFailure=state.canRetry===true; fail(state.error);
        if(!retryableFailure){for(const starter of starters)starter.reject(new Error(failure));starters.clear();}
        attemptEnded();
      } else if (state?.phase === 'ready') ready(state.events);
      else if (state?.phase === 'pending') {
        if (window.Mvu === value) delete window.Mvu;
        value = undefined; initialized = false; failure = ''; retryableFailure=false;
      }
    });
    window.addEventListener('pagehide', () => cancel('脚本窗口已关闭'), { once: true });
    if (!isCore() && !sharedRealm) parent.postMessage({ type: 'dsh-tavern-mvu-dependency-request', token: metadata.token }, '*');
  }
  function runOnce(factory,id){
    if(closed)throw new Error('脚本初始化已取消');
    if(started.has(id))throw new Error('脚本模块已经执行，禁止自动重放');
    started.add(id);
    return factory();
  }
  async function afterCore(factory,id){
    for(;;){
      if(closed)throw new Error('脚本初始化已取消');
      if(failure&&!retryableFailure)throw new Error(failure);
      if(initialized)return runOnce(factory,id);
      await new Promise((resolve,reject)=>starters.add({resolve,reject}));
      // A newer pending/failed notice may have arrived in the same task as
      // ready. Check again before inserting the entry module and its imports.
    }
  }
  // An unknown-role script starts once this attempt ends; a failed core still
  // pauses settlement (2A). Only a confirmed validator waits for a ready core.
  async function afterAttempt(factory,id){
    for(;;){
      if(closed)throw new Error('脚本初始化已取消');
      if(initialized||failure)return runOnce(factory,id);
      await new Promise((resolve,reject)=>attemptWaiters.add({resolve,reject}));
    }
  }
  // Diagnostic timing only: even a missing-Mvu failure can follow successful
  // writes. The host must not use this flag to replay an executed module.
  return {
    start: (factory, gate) => {
      // The owner may have cancelled before this listener existed. Even an
      // independent inline entry waits for one authenticated admission reply;
      // it need not wait for core readiness, and no source has executed yet.
      const id = currentScript().id;
      if(closed)throw new Error('脚本初始化已取消');
      const launch = () => !gate || !required || isCore() ? runOnce(factory,id) : gate === 'attempt' ? afterAttempt(factory,id) : afterCore(factory,id);
      if(required && !isCore() && !admitted)return new Promise((resolve,reject)=>admissionWaiters.add({resolve,reject})).then(launch);
      return launch();
    },
    dependencyPending: () => required && !isCore() && !initialized,
    // The loader reports a core that failed to load in a shared realm (Z92).
    coreFailed: error => {
      if (!sharedRealm || initialized || failure) return;
      fail(error && error.message || error);
      releaseCompanions();
    }
  };
}
