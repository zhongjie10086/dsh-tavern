// The pre-game iframe can select a card greeting, but cannot write Session history.
function installOpeningPreviewBridge(token, preview) {
  const original = preview.runtime ? {
    host: window.SillyTavern, helper: window.TavernHelper,
    getChatMessages: window.getChatMessages, setChatMessages: window.setChatMessages,
    waitGlobalInitialized: window.waitGlobalInitialized
  } : null;
  const swipes = preview.swipes.slice();
  let selected = preview.selectedIndex;
  let nextId = 0;
  const pending = new Map();
  let worldbook = preview.worldbook ? JSON.parse(JSON.stringify(preview.worldbook)) : null;
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function request(type, payload) {
    // document.open() removes window listeners while preserving these API functions.
    addEventListener('message', receive);
    const requestId = 'opening-preview:' + (++nextId);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { pending.delete(requestId); reject(new Error('开场操作超时，请重试')); }, type === 'dsh-tavern-helper-call' ? 300000 : 10000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage(Object.assign({ type, token, requestId }, payload), '*');
    });
  }
  window.triggerSlash = function (line) {
    const command = String(line || '');
    return request('dsh-tavern-helper-call', { method: 'triggerTavernSlash', args: { line: command } }).then(function (result) {
      if (/^\s*\/echo\b/i.test(command)) window.toastr?.info?.(result.pipe);
      return result.pipe || '';
    }).catch(function (error) {
      if (typeof document !== 'undefined' && document.body) {
        document.querySelector('[data-dsh-opening-error]')?.remove();
        const notice = document.createElement('div');
        notice.setAttribute('data-dsh-opening-error', ''); notice.setAttribute('role', 'alert');
        notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:16px;background:Canvas;color:CanvasText;border:1px solid currentColor;border-radius:8px;font:14px/1.6 system-ui';
        const message = document.createElement('p'); message.textContent = '开局未完成：' + error.message;
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试开局';
        retry.onclick = function () { notice.remove(); window.triggerSlash(command).catch(function () {}); };
        notice.append(message, retry); document.body.append(notice);
      }
      throw error;
    });
  };
  window.executeSlashCommandsWithOptions = async source => ({ pipe: await window.triggerSlash(source), isError: false });
  window.iframe_events ||= Object.freeze({MESSAGE_IFRAME_RENDER_STARTED:'message_iframe_render_started',MESSAGE_IFRAME_RENDER_ENDED:'message_iframe_render_ended',GENERATION_STARTED:'js_generation_started',STREAM_TOKEN_RECEIVED_FULLY:'js_stream_token_received_fully',STREAM_TOKEN_RECEIVED_INCREMENTALLY:'js_stream_token_received_incrementally',GENERATION_ENDED:'js_generation_ended'});
  window.generateRaw = async function (config) {
    const payload=copy(config||{}),streaming=payload.should_stream===true&&typeof window.eventEmit==='function',types=window.iframe_events;
    const id=String(payload.generation_id||window.crypto?.randomUUID?.()||('preview-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)));
    if(streaming){payload.generation_id=id;await window.eventEmit(types.GENERATION_STARTED,id);}
    const result=await request('dsh-tavern-helper-call', { method: 'generateTavernHelperRaw', args: { config: payload } });
    if(streaming){await window.eventEmit(types.STREAM_TOKEN_RECEIVED_FULLY,result.text,id);await window.eventEmit(types.STREAM_TOKEN_RECEIVED_INCREMENTALLY,result.text,id);await window.eventEmit(types.GENERATION_ENDED,result.text,id);}
    return result.text;
  };
  window.getCharWorldbookNames = function () { return { primary: worldbook ? worldbook.name : null, additional: [] }; };
  window.getWorldbook = async function (name) {
    if (preview.preparationId) {
      const result = await request('dsh-tavern-opening-read', {});
      worldbook = result.worldbook;
    }
    if (!worldbook || name !== worldbook.name) throw new Error('开场准备只能访问绑定的世界书');
    return copy(worldbook.entries);
  };
  window.updateWorldbookWith = async function (name, updater) {
    const previous = await window.getWorldbook(name);
    const draft = copy(previous);
    const updated = await updater(draft);
    const entries = updated === undefined ? draft : updated;
    const result = await request('dsh-tavern-opening-worldbook', { entries, expectedEntries: previous });
    worldbook = copy(result.worldbook);
    return copy(worldbook.entries);
  };
  window.TavernHelper = Object.assign({}, original && original.helper, { triggerSlash: window.triggerSlash, executeSlashCommandsWithOptions: window.executeSlashCommandsWithOptions, iframe_events:window.iframe_events,tavern_events:window.tavern_events,generateRaw: window.generateRaw, getCharWorldbookNames: window.getCharWorldbookNames,
    getWorldbook: window.getWorldbook, updateWorldbookWith: window.updateWorldbookWith });
  const chat = [{ is_user: false, name: preview.characterName || '', mes: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
  let savedIndex = selected;
  const swipe = { to: async function (_chatId, direction, options = {}) {
    if (options.forceMesId !== undefined && Number(options.forceMesId) !== 0) throw new Error('只能切换开场消息');
    const index = options.forceSwipeId !== undefined ? Number(options.forceSwipeId)
      : direction === 'left' ? selected - 1 : direction === 'right' ? selected + 1 : NaN;
    return window.setChatMessages([{ message_id: 0, swipe_id: index }]);
  } };
  if (!window.toastr) window.toastr = { info: console.info, success: console.info, warning: console.warn, error: console.error };
  window.SillyTavern = Object.assign({}, original && original.host, {
    chat, swipe,
    getContext: function () { return Object.assign({}, original && original.host.getContext(), { chat, swipe, extensionSettings: original ? original.host.getContext().extensionSettings : {} }); },
    saveChat: async function () {
      const message = chat[0];
      const index = Number(message && message.swipe_id);
      if (chat.length !== 1 || !Number.isInteger(index) || !preview.openingIds[index] || message.mes !== swipes[index]) {
        throw new Error('开场准备只能选择人物卡已有开场');
      }
      // Persist selection before acknowledging save, without unmounting its caller.
      await request('dsh-tavern-opening-save', { swipeId: index });
      savedIndex = index;
    },
    reloadCurrentChat: async function () {
      await window.setChatMessages([{ message_id: 0, swipe_id: savedIndex }]);
    }
  });
  window.getCurrentMessageId = window.getLastMessageId = function () { return 0; };
  window.getChatMessages = function (id, options) {
    if (original) return original.getChatMessages(id, options);
    if (Number(id) !== 0 || (options && options.role && !['all', 'assistant'].includes(options.role))) return [];
    return [{ message_id: 0, role: 'assistant', message: swipes[selected], swipe_id: selected, swipes: swipes.slice() }];
  };
  // Some chooser pages await this gate without reading MVU. No game state exists yet.
  window.waitGlobalInitialized = async function (name) {
    if (original) return original.waitGlobalInitialized(name);
    if (name === 'Mvu' && !preview.preparationId) return undefined;
    if (window[name] !== undefined) return window[name];
    throw new Error('开场预览尚未初始化 ' + name);
  };
  window.errorCatched = function (callback) {
    return function () { return Promise.resolve().then(() => callback.apply(this, arguments)).catch(console.error); };
  };
  window.setChatMessages = async function (patches) {
    if (original && Array.isArray(patches) && patches.every(patch => patch.swipe_id === undefined && patch.message === undefined)) return original.setChatMessages(patches);
    if (!Array.isArray(patches) || patches.length !== 1) throw new Error('开场预览只能选择一条开场');
    const patch = patches[0];
    const index = Number(patch && patch.swipe_id);
    if (!patch || Number(patch.message_id) !== 0 || !Number.isInteger(index) || !preview.openingIds[index] ||
        Object.keys(patch).some(key => !['message_id', 'swipe_id', 'message'].includes(key)) ||
        (patch.message !== undefined && patch.message !== swipes[index])) {
      throw new Error('开场预览只支持选择人物卡已有开场，不能修改正文或变量');
    }
    await request('dsh-tavern-opening-select', { swipeId: index });
    selected = index;
  };
  window.setChatMessage = function (message, messageId, options) {
    return window.setChatMessages([{ message_id: messageId, message, swipe_id: options && options.swipe_id }]);
  };
  function receive(event) {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token || !['dsh-tavern-opening-response', 'dsh-tavern-helper-response'].includes(data.type)) return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '开场选择失败'));
  }
  addEventListener('message', receive);
}

function openingPreviewSelection(preview, swipeId) {
  if (!preview || !Number.isInteger(swipeId) || swipeId < 0 || !preview.openingIds[swipeId]) throw new Error('人物卡开场白不存在');
  return preview.openingIds[swipeId];
}

// A legacy home already saved as a greeting can finish setup via the native
// new-game coordinator. It never edits the source session's event history.
function installSessionOpeningBridge(token, descriptor) {
  const swipes = descriptor.swipes.slice();
  const chat = [{ is_user: false, name: descriptor.characterName, mes: swipes[descriptor.selectedIndex], swipe_id: descriptor.selectedIndex, swipes }];
  const getChatMessages = window.getChatMessages;
  if (typeof getChatMessages === 'function') window.getChatMessages = function (target, options) {
    // Preserve the host's range/filter semantics and all message metadata. A
    // legacy greeting may store only its menu marker; its available openings
    // belong to this descriptor, just as they do for the setter below.
    const messages = getChatMessages.call(this, target, options);
    if (!options || options.include_swipes !== true) return messages;
    return messages.map(function (message) {
      return Number(message.message_id) === 0 ? Object.assign({}, message, {
        message: chat[0].mes, swipe_id: chat[0].swipe_id, swipes: swipes.slice()
      }) : message;
    });
  };
  const pending = new Map();
  let sequence = 0, saved = null, starting = null;
  function call(method, args) {
    const requestId = 'opening-session:' + (++sequence);
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () { pending.delete(requestId); reject(new Error('开始旅程超时，请检查左侧错误提示')); }, 120000);
      pending.set(requestId, { resolve, reject, timer });
      parent.postMessage({ type: 'dsh-tavern-helper-call', token, requestId, method, args }, '*');
    });
  }
  addEventListener('message', function (event) {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token || data.type !== 'dsh-tavern-helper-response') return;
    const task = pending.get(data.requestId);
    if (!task) return;
    pending.delete(data.requestId); clearTimeout(task.timer);
    if (data.ok) task.resolve(data.result); else task.reject(new Error(data.error || '开始旅程失败'));
  });
  const swipe = { to: async function (_chatId, direction, options = {}) {
    if (options.forceMesId !== undefined && Number(options.forceMesId) !== 0) throw new Error('只能切换开场消息');
    const index = options.forceSwipeId !== undefined ? Number(options.forceSwipeId)
      : direction === 'left' ? chat[0].swipe_id - 1 : direction === 'right' ? chat[0].swipe_id + 1 : NaN;
    if (!Number.isInteger(index) || !descriptor.openingIds[index]) throw new Error('人物卡开场白不存在');
    return window.setChatMessage(swipes[index], 0, { swipe_id: index });
  } };
  if (!window.toastr) window.toastr = { info: console.info, success: console.info, warning: console.warn, error: console.error };
  window.SillyTavern = Object.assign({}, window.SillyTavern, {
    extensionSettings: descriptor.extensionSettings || {},
    TavernHelper: window.TavernHelper,
    chat, swipe,
    getContext: function () { return window.SillyTavern; },
    saveChat: async function () {
      const row = chat[0], index = row && row.swipe_id;
      if (chat.length !== 1 || !Number.isInteger(index) || !descriptor.openingIds[index] || row.mes !== swipes[index]) throw new Error('只能选择人物卡已有开场');
      saved = await call('prepareSessionOpening', { swipeId: index, message: row.mes });
    },
    reloadCurrentChat: function () {
      if (!saved) return Promise.reject(new Error('请先保存开场选择'));
      if (!starting) starting = call('startSessionOpening', { preparationId: saved.preparationId }).catch(function (error) { starting = null; throw error; });
      return starting;
    }
  });
  window.setChatMessage = async function (message, messageId, options) {
    const index = options && options.swipe_id;
    if (Number(messageId) !== 0 || !Number.isInteger(index) || message !== swipes[index]) throw new Error('只能选择人物卡已有开场');
    chat[0].swipe_id = index;
    chat[0].mes = message;
    await window.SillyTavern.saveChat();
    return window.SillyTavern.reloadCurrentChat();
  };

}
// One preparation owns one submission. A failed initial send retains the created
// Session and its compiled command, so every entry retries that same Session.
function createOpeningSubmission() {
  let pending = null, created = null, command = null, send = null, completed = false;
  return function submit(options) {
    if (pending) return pending;
    if (completed) return Promise.resolve(created);
    pending = Promise.resolve().then(async function () {
      if (!created) {
        command = await options.prepare();
        options.begin?.();
        created = await options.create(command);
        send = options.send;
      } else options.begin?.();
      await send(created, command);
      completed = true;
      return created;
    }).catch(function (error) { options.failed?.(error, created); throw error; })
      .finally(function () { pending = null; options.finish?.(); });
    return pending;
  };
}

function openingResponseChoices(response) {
  const openings = Array.isArray(response.openings) ? response.openings : [];
  if (response.openingDataVersion !== 2 || !response.openingShared) return openings;
  return openings.map(function (opening) {
    return opening.openingPreview ? Object.assign({}, opening, { openingPreview: Object.assign({}, response.openingShared, opening.openingPreview) }) : opening;
  });
}
