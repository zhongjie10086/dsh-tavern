function applySessionViewPatch(input, changes) {
    const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value)),copied=new WeakSet();let result=input;
    const own=value=>{if(!value||typeof value!=="object")throw Error("视图差量路径无效");if(copied.has(value))return value;const next=Array.isArray(value)?value.slice():{...value};copied.add(next);return next;};
    const put=(target,key,value)=>Object.defineProperty(target,key,{value,enumerable:true,writable:true,configurable:true});
    if(!Array.isArray(changes))throw Error("视图差量无效");
    for(const change of changes){
        const path=change.path;
        if(!Array.isArray(path)||path.some(part=>typeof part!=="string"&&(!Number.isSafeInteger(part)||part<0)))throw Error("视图差量路径无效");
        if(!path.length&&change.op==="set"){result=clone(change.value);continue;}
        if(!path.length&&change.op!=="splice")throw Error("视图差量根节点无效");
        result=own(result);let cursor=result;
        const depth=change.op==="splice"?path.length:path.length-1;
        for(let i=0;i<depth;i++){const key=path[i];if(!Object.prototype.hasOwnProperty.call(cursor,key))throw Error("视图差量缺少基线");put(cursor,key,own(cursor[key]));cursor=cursor[key];}
        const key=path[path.length-1];
        if(change.op==="set")put(cursor,key,clone(change.value));
        else if(change.op==="delete"){if(Array.isArray(cursor))throw Error("视图数组删除无效");delete cursor[key];}
        else if(change.op==="splice"){
            if(!Array.isArray(cursor)||!Number.isSafeInteger(change.index)||change.index<0||change.index>cursor.length||!Number.isSafeInteger(change.deleteCount)||change.deleteCount<0||change.index+change.deleteCount>cursor.length||!Array.isArray(change.items))throw Error("视图数组差量无效");
            cursor.splice(change.index,change.deleteCount,...clone(change.items));
        }else throw Error("视图差量操作无效");
    }
    return result;
}
function expandSessionViewWire(bundle) {
    const view=JSON.parse(JSON.stringify(bundle.view));if(!view)return view;
    function at(path){let value=view;for(const key of path){if(!value||typeof value!=="object"||!Object.prototype.hasOwnProperty.call(value,key))throw Error("视图字符串引用无效");value=value[key];}return value;}
    for(const [target,source] of bundle.aliases?.strings||[]){
        if(!Array.isArray(target)||!target.length||!Array.isArray(source))throw Error("视图字符串引用无效");
        const value=at(source),parent=at(target.slice(0,-1)),key=target.at(-1);
        if(typeof value!=="string"||!Object.prototype.hasOwnProperty.call(parent,key)||parent[key]!==null)throw Error("视图字符串引用无效");
        Object.defineProperty(parent,key,{value,enumerable:true,writable:true,configurable:true});
    }
    for(const index of bundle.aliases?.helperSwipes||[]){const row=view.tavernHelper?.messages?.[index];if(!row||typeof row.message!=="string")throw Error("视图消息别名无效");row.swipes=[row.message];}
    for(const index of bundle.aliases?.replyText||[]){const row=view.replyProjections?.[index];if(typeof row?.parts?.[0]?.content!=="string")throw Error("视图正文别名无效");row.text=row.parts[0].content;}
    if(bundle.aliases?.globalRegex){
        const raw=view.tavernHelper?.extensionSettings?.regex,target=view.tavernHelper?.regexScripts;
        if(!Array.isArray(raw)||!target||Object.hasOwn(target,'global'))throw Error('视图全局正则投影无效');
        const str=value=>typeof value==='string'?value:value==null?'':String(value),depth=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
        const global=raw.filter(value=>value!==null&&typeof value==='object'&&!Array.isArray(value)).map((script,index)=>{
            const id=str(script.id).trim()||'regex-'+(index+1);
            return {ref:'regex:'+index,id,name:str(script.scriptName||script.name).trim()||id,findRegex:str(script.findRegex),replaceString:str(script.replaceString),trimStrings:Array.isArray(script.trimStrings)?script.trimStrings.map(str):[],placement:Array.isArray(script.placement)?script.placement.slice():[],enabled:script.disabled!==true&&script.enabled!==false,markdownOnly:script.markdownOnly===true,promptOnly:script.promptOnly===true,runOnEdit:script.runOnEdit===true,substituteRegex:script.substituteRegex===undefined?null:script.substituteRegex,minDepth:depth(script.minDepth),maxDepth:depth(script.maxDepth)};
        });
        Object.defineProperty(target,'global',{value:global,enumerable:false,writable:true,configurable:true});
    }
    for(const [target,source] of bundle.aliases?.objects||[]){
        const allowed=JSON.stringify([target,source]);
        if(![
            JSON.stringify([['tavernHelperWorldbook'],['tavernHelper','worldbook']]),
            JSON.stringify([['tavernStatusView'],['tavernStatusViews',0]]),
            JSON.stringify([['tavernHelper','extensionSettings','regex'],['tavernHelper','regexScripts','global']])
        ].includes(allowed))throw Error("视图资源别名无效");
        const parent=at(target.slice(0,-1)),key=target.at(-1);
        if(Object.hasOwn(parent,key))throw Error("视图资源别名重复");
        Object.defineProperty(parent,key,{value:at(source),enumerable:false,writable:true,configurable:true});
    }
    return view;
}
function createLiveTavernViewModule(options) {
	if (!options || typeof options.load !== "function") throw new Error("Live Tavern View 缺少 load adapter");
	const records = new Map();
	const shouldPoll = typeof options.shouldPoll === "function" ? options.shouldPoll : function (view) { return view && view.settleStatus === "running"; };
	const isTerminalError = typeof options.isTerminalError === "function" ? options.isTerminalError : function () { return false; };
	const scheduleTimer = typeof options.schedule === "function" ? options.schedule : function (run, delay) { return window.setTimeout(run, delay); };
	const cancelTimer = typeof options.cancel === "function" ? options.cancel : function (timer) { window.clearTimeout(timer); };
	const startWatchdog = typeof options.startWatchdog === "function" ? options.startWatchdog : function (run, delay) { return window.setInterval(run, delay); };
	const stopWatchdog = typeof options.stopWatchdog === "function" ? options.stopWatchdog : function (timer) { window.clearInterval(timer); };
	const watchdogIntervalMs = Number(options.watchdogIntervalMs) > 0 ? Number(options.watchdogIntervalMs) : 1000;
	const loadTimeoutMs = Number(options.loadTimeoutMs) > 0 ? Number(options.loadTimeoutMs) : 0;
	const timeoutRetryDelayMs = Number(options.timeoutRetryDelayMs) > 0 ? Number(options.timeoutRetryDelayMs) : 0;
	const idlePollIntervalMs = Number(options.idlePollIntervalMs) > 0 ? Number(options.idlePollIntervalMs) : 0;
	const pollWhileBusy = options.pollWhileBusy !== false;
	function initialState() { return { phase: "idle", view: null, error: "", updatedAt: 0 }; }
	const emptyState = Object.freeze(initialState());
	function retire(record) {
		if (records.get(record.id) !== record) return;
		record.retired = true; record.operation = null; record.optimisticOwner = null; record.controller?.abort();
		if (record.timer !== null) cancelTimer(record.timer);
		if (record.watchdog !== null) stopWatchdog(record.watchdog);
		record.timer = record.watchdog = null; record.state = emptyState; record.version = undefined; record.wireView = null; record.authoritativeView = null;
		records.delete(record.id);
		options.onRelease?.(record.id);
	}
	function recordFor(sessionId) {
		const id = String(sessionId || "");
		if (!records.has(id)) {
			const inactive = [...records.values()].filter(record => !record.listeners.size);
			while (inactive.length >= 4) retire(inactive.shift());
			records.set(id, { id: id, state: initialState(), listeners: new Set(), timer: null, watchdog: null, loading: false, reloadRequested: false, optimisticBusy: false, operation: null, optimisticOwner: null, retryAt: 0, authoritativeView: null });
		}
		return records.get(id);
	}
	function publish(record, state) {
		if (record.retired) return;
		record.state = state;
		record.listeners.forEach(function (listener) { listener(state); });
	}
	function schedule(record, delay, replaceRetry) {
		if (record.listeners.size === 0) return;
		// A queued invalidation is not authority to erase an error backoff.
		if (!replaceRetry && record.retryAt > Date.now() && record.timer !== null) return;
		if (record.timer !== null) cancelTimer(record.timer);
		const retryAt = record.retryAt;
		let timer = scheduleTimer(function () {
			if (record.timer !== timer) return;
			record.timer = null;
			// A fired retry timer has served its delay, including synthetic timers.
			if (record.retryAt === retryAt) record.retryAt = 0;
			void refresh(record);
		}, Math.max(delay, record.retryAt - Date.now(), 0));
		record.timer = timer;
	}
	async function refresh(record) {
		if (record.retired || record.listeners.size === 0) return;
		if (record.loading) { record.reloadRequested = true; return; }
		if (record.retryAt > Date.now()) { if (record.timer === null) schedule(record, 0); return; }
		const operation = {}; record.operation = operation;
		record.loading = true;
		if (record.state.view === null) publish(record, Object.assign({}, record.state, { phase: "loading", error: "" }));
		let deadlineExpired = false;
		try {
			if (record.operation !== operation) return;
			let deadlineTimer = null;
			let controller = typeof AbortController === 'function' ? new AbortController() : null;
			record.controller = controller;
			const loadVersion=record.version;
			let load = null;
			if (loadTimeoutMs > 0) {
				load = Promise.race([
					Promise.resolve(options.load(record.id, { signal: controller.signal, ifVersion:record.version, viewProtocol:4 })),
					new Promise(function (_resolve, reject) {
						deadlineTimer = scheduleTimer(function () {
							deadlineExpired = true;
							controller.abort();
							reject(new Error("Tavern 状态同步超时"));
						}, loadTimeoutMs);
					})
				]);
			} else load = options.load(record.id, {ifVersion:record.version, viewProtocol:4, signal:controller?.signal});
			let result = null;
			try { result = await load; }
			finally { if (deadlineTimer !== null) cancelTimer(deadlineTimer); }
			if (record.retired || record.operation !== operation) return;
            record.retryAt = 0;
            const unchanged=result?.unchanged===true && record.authoritativeView!==null;
            let view = unchanged ? record.authoritativeView : result && result.view ? result.view : null;
            if(!unchanged&&[2,3,4].includes(result?.viewEncoding)){
                try{
                    if(result.patch&&(!record.wireView||result.patch.baseVersion!==record.version||loadVersion!==record.version))throw Error("视图差量基线已变化");
                    const wire=result.patch?applySessionViewPatch(record.wireView,result.patch.changes):{view:result.view,aliases:result.aliases};
                    view=expandSessionViewWire(wire);record.wireView=wire;
                }catch(error){
                    record.version=undefined;record.wireView=null;record.authoritativeView=null;
                    if(result.patch){schedule(record,0);return;}throw error;
                }
            }else if(!unchanged)record.wireView=null;
			record.version=result?.version;
            // The wire baseline belongs to the accepted server response, not an
            // optimistic display that may intentionally remain busy until release.
            record.authoritativeView=view;
			if (pollWhileBusy && record.optimisticBusy && !shouldPoll(view)) {
				schedule(record, 200);
				return;
			}
			if (shouldPoll(view)) record.optimisticBusy = false;
			if(!unchanged || record.state.phase!=="ready" || record.state.view!==view)publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
			if (record.retired || record.operation !== operation) return;
			if (pollWhileBusy && shouldPoll(view)) schedule(record, 200);
			else if (idlePollIntervalMs > 0) schedule(record, idlePollIntervalMs);
		} catch (error) {
			if (record.retired || record.operation !== operation) return;
			const terminal = !deadlineExpired && isTerminalError(error);
			if (terminal) {
				record.reloadRequested = false; record.retryAt = 0;
				if (record.timer !== null) cancelTimer(record.timer); record.timer = null;
				publish(record, { phase: "unavailable", view: null, error: String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
			}
			else {
				publish(record, { phase: "retrying", view: record.state.view, error: deadlineExpired ? "" : String(error && error.message || error || ""), updatedAt: record.state.updatedAt });
				if (record.retired || record.operation !== operation) return;
				const retryDelay = deadlineExpired && timeoutRetryDelayMs > 0
					? timeoutRetryDelayMs
					: (pollWhileBusy && shouldPoll(record.state.view) ? 300 : (idlePollIntervalMs > 0 ? Math.min(1500, idlePollIntervalMs) : 1500));
				record.retryAt = Date.now() + retryDelay;
				schedule(record, retryDelay, true);
			}
		} finally {
			if (record.operation === operation) {
				record.operation = null; record.controller = null;
				record.loading = false;
				if (record.reloadRequested) { record.reloadRequested = false; schedule(record, 0); }
			}
		}
	}
	function invalidate(sessionId) {
		const targets = sessionId === undefined || sessionId === null || sessionId === "" ? Array.from(records.values()) : [records.get(String(sessionId))].filter(Boolean);
		targets.forEach(function (record) {
			if (record.loading) record.reloadRequested = true;
			else schedule(record, 0);
		});
	}
	return {
		getSnapshot: function (sessionId) { return records.get(String(sessionId || ''))?.state || emptyState; },
		setView: function (sessionId, view) {
			const record = recordFor(sessionId);
			// Explicit authoritative/optimistic state supersedes every older read,
			// even adapters that ignore abort and resolve their response later.
			const optimisticOwner = {}; record.optimisticOwner = optimisticOwner;
			const previousController = record.controller;
			record.operation = null; record.controller = null;
			record.loading = false; record.reloadRequested = false; record.retryAt = 0;
			if (record.timer !== null) cancelTimer(record.timer); record.timer = null;
			record.version=undefined;record.wireView=null;record.authoritativeView=null;
			previousController?.abort();
			if (record.retired || record.optimisticOwner !== optimisticOwner) return function () {};
            record.optimisticBusy = shouldPoll(view);
			publish(record, { phase: "ready", view: view, error: "", updatedAt: Date.now() });
			if (record.optimisticOwner === optimisticOwner && !record.retired && pollWhileBusy && shouldPoll(view)) schedule(record, 0);
			let released = false;
			return function () {
				if (released) return;
				released = true;
				if (record.retired || record.optimisticOwner !== optimisticOwner) return;
				record.optimisticOwner = null; record.optimisticBusy = false;
				if (!record.listeners.size) { retire(record); return; }
				invalidate(sessionId);
			};
		},
		subscribe: function (sessionId, listener) {
			const record = recordFor(sessionId);
			record.listeners.add(listener);
			listener(record.state);
			schedule(record, 0);
			if (record.watchdog === null) {
				record.watchdog = startWatchdog(function () {
					if (record.listeners.size > 0 && record.state.phase !== "unavailable" && ((pollWhileBusy && shouldPoll(record.state.view)) || idlePollIntervalMs > 0)) void refresh(record);
				}, watchdogIntervalMs);
			}
			return function () {
				record.listeners.delete(listener);
				if (record.listeners.size === 0) {
					retire(record);
				}
			};
		},
		invalidate: invalidate
	};
}
