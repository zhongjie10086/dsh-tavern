// Display-only projection. Never mutate the host Session or its node store.
function tavernHistoryWindow(snapshot, outline, limit) {
	const byTurn = new Map();
	for (const item of Array.isArray(outline) ? outline : []) {
		if (Number.isSafeInteger(item.turn) && Number.isSafeInteger(item.seq)) byTurn.set(item.turn, item.seq);
	}
	for (const key of snapshot.order) {
		const node = snapshot.nodes.get(key);
		const turn = node?.location?.turn?.turn;
		if (Number.isSafeInteger(turn) && !byTurn.has(turn)) byTurn.set(turn, node.anchorSeq);
	}
	const turns = [...byTurn.keys()].sort((a, b) => a - b);
	const first = turns[Math.max(0, turns.length - limit)];
	const order = snapshot.order.filter(key => {
		const node = snapshot.nodes.get(key);
		const turn = node?.location?.turn?.turn;
		return turns.length <= limit || first === undefined || (Number.isSafeInteger(turn) ? turn >= first : Number(node?.anchorSeq) >= Number(byTurn.get(first)));
	});
	return { first, seq: byTurn.get(first), total: turns.length, order,
		outline: (Array.isArray(outline) ? outline : []).filter(item => item.turn >= first),
		navigation: snapshot.navigation.items().filter(item => item.turn >= first) };
}

function registerTavernHistoryWindow(ctx) {
	ctx.effect(() => ctx.slots.inject("conversation.view", () => {
		let remove;
		function install() {
		if (remove) return;
		const original = ctx.slots.entriesOfSlot("conversation.view").find(entry => entry.options.id === "chat");
		if (!original || typeof original.component !== "function") return;
		// Child slot ownership is global and cannot be copied to a shadow entry.
		// Omitting children also removes NativeChat's renderSlot authorization.
		// Preserve the native view until the host exposes an ownership-safe adapter.
		if (original.children && Object.keys(original.children).length > 0) return;
		const NativeChat = original.component;
		function WindowedChat(props) {
			const live = useLiveTavernView(props.sessionId, "history-window");
			if (!live.view) return (live.error || live.phase === "ready") ? React.createElement(NativeChat, props) : React.createElement("div", { role: "status" }, "正在读取对话…");
			return isPlayMode(live.view.mode) ? React.createElement(PlayHistory, { ...props, key: props.sessionId }) : React.createElement(NativeChat, props);
		}
		function PlayHistory(props) {
			const snapshot = props.useChat(value => value);
			const outline = props.useProjection("turnOutline");
			const hasMore = props.useSession(value => value.hasMore);
			const [limit, setLimit] = React.useState(20);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const root = React.useRef(null);
			const anchor = React.useRef(null);
			const pending = React.useRef(false);
			const windowed = React.useMemo(() => tavernHistoryWindow(snapshot, outline, limit), [snapshot, outline, limit]);
			const project = React.useMemo(() => {
				const cache = new WeakMap();
				return value => {
					if (!cache.has(value)) {
						const bounded = tavernHistoryWindow(value, outline, limit);
						const navigation = Object.create(value.navigation);
						navigation.items = () => bounded.navigation;
						cache.set(value, { ...value, order: bounded.order, navigation });
					}
					return cache.get(value);
				};
			}, [outline, limit]);
			const useChat = React.useCallback(selector => props.useChat(value => selector(project(value))), [props.useChat, project]);
			const useSession = React.useCallback(selector => props.useSession(value => selector({ ...value, hasMore: false })), [props.useSession]);
			const useProjection = React.useCallback(name => { const value = props.useProjection(name); return name === "turnOutline" ? windowed.outline : value; }, [props.useProjection, windowed]);
			function scrollport() { return root.current?.closest("[data-conversation-scroll]") || root.current?.querySelector("[data-chat-flow]")?.parentElement || root.current; }
			function rememberPosition() {
				const scroller = scrollport();
				const row = [...(root.current?.querySelectorAll("[data-chat-flow-key]") || [])].find(row => row.getBoundingClientRect().bottom > (scroller?.getBoundingClientRect().top || 0));
				anchor.current = row ? { key: row.getAttribute("data-chat-flow-key"), top: row.getBoundingClientRect().top } : null;
			}
			React.useLayoutEffect(() => {
				const held = anchor.current;
				if (!held) return;
				const scroller = scrollport();
				if (held.latest) { if (scroller) scroller.scrollTop = scroller.scrollHeight; }
				else {
					const row = [...(root.current?.querySelectorAll("[data-chat-flow-key]") || [])].find(row => row.getAttribute("data-chat-flow-key") === held.key);
					if (row && scroller) scroller.scrollTop += row.getBoundingClientRect().top - held.top;
				}
				anchor.current = null;
			}, [windowed]);
			// Host pages are event-based; load through the first required turn for a complete 20-turn opening.
			React.useEffect(() => {
				if (!hasMore || !Number.isSafeInteger(windowed.seq) || pending.current) return;
				pending.current = true; setBusy(true);
				Promise.resolve(props.loadThrough(windowed.seq)).catch(err => setError(String(err?.message || err))).finally(() => { pending.current = false; setBusy(false); });
			}, [windowed.seq, hasMore, props.loadThrough]);
			async function earlier() {
				if (busy || pending.current) return;
				rememberPosition(); setBusy(true); setError(""); pending.current = true;
				try {
					if ((!Array.isArray(outline) || outline.length === 0) && hasMore) throw new Error("历史轮次索引尚未就绪，请稍后重试");
					const next = tavernHistoryWindow(snapshot, outline, limit + 100);
					if (Number.isSafeInteger(next.seq)) await props.loadThrough(next.seq);
					else if (hasMore) await props.loadOlder();
					rememberPosition(); setLimit(value => value + 100);
				} catch (err) { setError(String(err?.message || err)); }
				finally { pending.current = false; setBusy(false); }
			}
			function latest() { props.chatScroll?.save(null); anchor.current = { latest: true }; setLimit(20); if (limit === 20) { const scroller = scrollport(); if (scroller) scroller.scrollTop = scroller.scrollHeight; } }
			return React.createElement("div", { ref: root, className: "dsh-tavern-history-window" },
				React.createElement("div", { className: "dsh-tavern-history-controls" },
					(windowed.total > limit || ((!Array.isArray(outline) || outline.length === 0) && hasMore)) ? React.createElement("button", { className: "dsh-tavern-btn", disabled: busy, onClick: earlier }, busy ? "正在加载…" : "查看更早（100 轮）") : null,
					limit > 20 ? React.createElement("button", { className: "dsh-tavern-btn", disabled: busy, onClick: latest }, "回到最新") : null,
					React.createElement("small", null, "显示最近 " + Math.min(limit, windowed.total) + " 轮"),
					error ? React.createElement("span", { role: "alert" }, error) : null),
				React.createElement(NativeChat, { ...props, useChat, useSession, useProjection }));
		}
		remove = ctx.slots.register({ ...original.options, name: "conversation.view", id: "chat", priority: -100,
			inject: original.inject, children: original.children, store: original.store, locale: original.locale }, WindowedChat);
		}
		const unsubscribe = ctx.slots.subscribe("conversation.view", install);
		install();
		return () => { unsubscribe(); if (remove) remove(); };
	}), "dsh-tavern: bounded conversation history");
}
