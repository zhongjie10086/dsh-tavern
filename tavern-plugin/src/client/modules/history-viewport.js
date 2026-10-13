// Bound initial story rendering independently of host child-slot ownership.
// Only explicit input expands history; canonical records are never changed.
function createTavernHistoryViewport(initialLimit = 20) {
    const entries = new Map(), listeners = new Set(), limits = new Map();
    let snapshot = new Set();
    function publish(next, force = false) {
        if (!force && next.size === snapshot.size && [...next].every(key => snapshot.has(key))) return;
        const previous = snapshot;
        snapshot = new Set(next);
        for (const key of previous) if (!next.has(key)) entries.get(key)?.release();
        listeners.forEach(fn => fn());
    }
    function ordered(sessionId) {
        return [...entries.values()].filter(item => item.sessionId === sessionId).sort((a, b) => a.turn - b.turn);
    }
    function select(sessionId) {
        const rows = ordered(sessionId);
        publish(new Set([...snapshot].filter(key => entries.get(key)?.sessionId !== sessionId).concat(rows.slice(-(limits.get(sessionId) || initialLimit)).map(item => item.key))), true);
    }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        snapshot() { return snapshot; },
        register(sessionId, turn, release) {
            const key = JSON.stringify([sessionId, turn]);
            let item = entries.get(key);
            const added = !item;
            
            if (!item) { item = { key, sessionId, turn, release, mounts: 0 }; entries.set(key, item); }
            item.mounts++;
            if (added) select(sessionId);
            return () => {
                if (--item.mounts > 0) return;
                item.release();
                entries.delete(key);
                if (!ordered(sessionId).length) limits.delete(sessionId);
                publish(new Set([...snapshot].filter(k => k !== key)));
            };
        },
        more(sessionId) {
            limits.set(sessionId, (limits.get(sessionId) || initialLimit) + initialLimit);
            select(sessionId);
        },
        latest(sessionId) { limits.delete(sessionId); select(sessionId); },
        expanded(sessionId) { return (limits.get(sessionId) || initialLimit) > initialLimit; },
        first(sessionId, turn) { return ordered(sessionId).find(item => snapshot.has(item.key))?.turn === turn; },
        hasEarlier(sessionId, turn) {
            const rows = ordered(sessionId), selected = rows.filter(item => snapshot.has(item.key));
            return selected[0]?.turn === turn && rows[0]?.turn < turn;
        },
        key(sessionId, turn) { return JSON.stringify([sessionId, turn]); }
    };
}
const tavernHistoryViewport = createTavernHistoryViewport();

function TavernWindowedNode(props) {
    const ref = React.useRef(null);
    const state = useLiveTavernView(props.sessionId);
    const rawTurn = Number(props.node.location?.turn?.turn || 0);
    const mappedTurn = props.node.kind === "user" ? rawTurn : tavernStoryTurnForDshTurn(state.view, rawTurn);
    const native = tavernNativeMessageState(state.view, props.node.data, mappedTurn);
    const turn = native.turn;
    const managed = isPlayMode(state.view?.mode) && !native.hidden;
    const key = tavernHistoryViewport.key(props.sessionId, turn);
    const selected = React.useSyncExternalStore(tavernHistoryViewport.subscribe, tavernHistoryViewport.snapshot).has(key);
    const panels = React.useSyncExternalStore(tavernPanelRegistry.subscribe, tavernPanelRegistry.inspect);
    const pinned = panels.some(panel => panel.pinned && panel.sessionId === props.sessionId && panel.turn === turn);
    React.useLayoutEffect(() => managed ? tavernHistoryViewport.register(props.sessionId, turn, () => {}) : undefined, [key, managed]);
    // Wait for the shared view once; mounting every body before it resolves defeats the window.
    if (!state.view && state.phase === "connecting") return null;
    if (native.hidden) return null;
    if (!managed) return React.createElement(props.bodyComponent, props);
    const active = selected || pinned;
    const controls = props.node.kind !== "user" && tavernHistoryViewport.first(props.sessionId, turn);
    function more() {
        const node = ref.current, top = node?.getBoundingClientRect().top;
        const scroller = node?.closest("[data-conversation-scroll]");
        tavernHistoryViewport.more(props.sessionId);
        requestAnimationFrame(() => {
            if (node?.isConnected && scroller) scroller.scrollTop += node.getBoundingClientRect().top - top;
        });
    }
    function latest() {
        const scroller = ref.current?.closest("[data-conversation-scroll]");
        tavernHistoryViewport.latest(props.sessionId);
        requestAnimationFrame(() => { if (scroller?.isConnected) scroller.scrollTop = scroller.scrollHeight; });
    }
    return React.createElement("div", { ref, "data-tavern-history-turn": turn, hidden: !active },
        active ? React.createElement(React.Fragment, null,
            controls ? React.createElement("div", { className: "dsh-tavern-history-controls" },
                tavernHistoryViewport.hasEarlier(props.sessionId, turn) ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: more }, "加载更多（20 轮）") : null,
                tavernHistoryViewport.expanded(props.sessionId) ? React.createElement("button", { type: "button", className: "dsh-tavern-btn", onClick: latest }, "回到最新（20 轮）") : null) : null,
            React.createElement(props.bodyComponent, props)) : null);
}
