// The host owns this baseline. Only signatures survive between updates, so a
// script's optimistic edits and RPC replies cannot change the comparison data.
function createTavernScriptContextSender() {
    let sequence = 0, fields = new Map(), messages = [], identity = "";
    function encode(context, force) {
        const nextIdentity = JSON.stringify([context.chatId, context.lifecycleRevision]);
        const values = new Map(), nextMessages = (context.messages || []).map(item => JSON.stringify(item));
        for (const key of Object.keys(context)) if (key !== "messages" && !["__proto__", "constructor", "prototype"].includes(key)) values.set(key, JSON.stringify(context[key]));
        const snapshot = force || sequence === 0 || nextIdentity !== identity;
        const set = {}, remove = [], replace = [];
        if (!snapshot) {
            for (const [key, value] of values) if (fields.get(key) !== value) set[key] = context[key];
            for (const key of fields.keys()) if (!values.has(key)) remove.push(key);
            for (let i = 0; i < nextMessages.length; i++) if (messages[i] !== nextMessages[i]) replace.push([i, context.messages[i]]);
            if (!Object.keys(set).length && !remove.length && !replace.length && messages.length === nextMessages.length) return null;
        }
        const update = snapshot ? { version: 1, kind: "snapshot", sequence: ++sequence, context }
            : { version: 1, kind: "patch", baseSequence: sequence, sequence: ++sequence, set, remove, messages: { length: nextMessages.length, replace } };
        fields = values; messages = nextMessages; identity = nextIdentity;
        return update;
    }
    return { encode };
}

// Transport sequence is separate from Chat revisions: settings, audio and
// independent RPC receipts can change without advancing the Chat journal.
function applyTavernScriptContextUpdate(previous, update) {
    const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    if (update.version !== 1) throw Error("不支持的脚本上下文协议");
    if (update.kind === "snapshot") return copy(update.context || {});
    if (update.kind !== "patch") throw Error("脚本上下文更新无效");
    const next = Object.assign({}, previous), safe = key => !["__proto__", "constructor", "prototype"].includes(key);
    for (const [key, value] of Object.entries(update.set || {})) if (safe(key)) next[key] = copy(value);
    for (const key of update.remove || []) if (safe(key)) delete next[key];
    next.messages = (previous.messages || []).slice(0, update.messages.length);
    for (const [index, value] of update.messages.replace) next.messages[index] = copy(value);
    return next;
}
