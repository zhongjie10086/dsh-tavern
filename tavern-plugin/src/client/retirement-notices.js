// Read-only annotations supplement rc.2's schema-stripped native catalog. They
// never replace its entries, titles, activity, navigation, or durable state.
function createTavernRetirementNoticeFeature(options) {
    const React = options.React, h = React.createElement;
    const listeners = new Set();
    let state = { phase: 'idle', notices: [] }, sessions, navigation, active = false;
    let epoch = 0, pending = null, repeat = false, controller;
    function publish(next) { state = next; for (const listener of listeners) listener(); }
    function getSnapshot() { return state; }
    function subscribe(listener) { listeners.add(listener); return function () { listeners.delete(listener); }; }
    function refresh() {
        if (!active) return Promise.resolve();
        if (pending) { repeat = true; return pending; }
        const ticket = epoch;
        controller = new AbortController();
        publish({ phase: 'loading', notices: state.notices });
        pending = Promise.resolve(options.rpc('getTavernBackgroundRetirementNotices', {}, undefined, { signal: controller.signal }))
            .then(function (result) {
                if (!active || epoch !== ticket || repeat) return;
                if (!Array.isArray(result && result.notices)) throw new Error('Invalid notice response');
                publish({ phase: 'ready', notices: result.notices });
            }, function () {
                if (active && epoch === ticket && !repeat) publish({ phase: 'error', notices: [] });
            }).catch(function () {
                if (active && epoch === ticket && !repeat) publish({ phase: 'error', notices: [] });
            }).finally(function () {
                if (!active || epoch !== ticket) return;
                pending = null;
                if (repeat) { repeat = false; return refresh(); }
            });
        return pending;
    }
    function connect(nextSessions, nextNavigation) {
        navigation = nextNavigation; sessions = nextSessions; active = true; epoch++;
        function signature() {
            const snapshot = sessions.list.getSnapshot();
            return JSON.stringify([tavernCurrentSessionId(sessions, snapshot),
                Object.values(snapshot.byId || {}).map(function (row) { return [row.id, row.parentId, row.origin, row.displayTitle, row.running]; }),
                [...new Set([...Object.keys(snapshot.subagentsByParent || {}), ...Object.keys(snapshot.projectionsBySession || {})])].map(function (id) { const catalog = tavernSubagentCatalog(sessions, id, snapshot); return [id, catalog?.state, catalog?.entries]; })]);
        }
        let previous = signature();
        const stop = sessions.list.subscribe(function () {
            const next = signature();
            if (next !== previous) { previous = next; void refresh(); }
        });
        const events = ['focus', 'dsh-tavern-data-changed', 'dsh-tavern-settings-changed'];
        function changed() { void refresh(); }
        for (const name of events) options.events.addEventListener(name, changed);
        void refresh();
        return function () {
            active = false; epoch++; repeat = false; controller?.abort(); pending = null;
            stop(); for (const name of events) options.events.removeEventListener(name, changed);
            publish({ phase: 'idle', notices: [] });
        };
    }
    function NoticeList(props) {
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
        const [error, setError] = React.useState('');
        const scope = props.parentSessionId || props.sessionId;
        const life = React.useRef(0);
        React.useEffect(function () { life.current++; setError(''); return function () { life.current++; }; }, [scope]);
        const notices = snapshot.notices.filter(function (row) {
            return props.parentSessionId ? row.rootSessionId === scope
                : row.parentSessionId === scope || row.sessionId === scope;
        });
        if (!notices.length && snapshot.phase !== 'error') return null;
        const summary = sessions?.list.getSnapshot();
        async function open(row) {
            const ticket = life.current, connection = epoch;
            setError('');
            try {
                await navigation.openChild({ parentSessionId: row.parentSessionId, childSessionId: row.sessionId },
                    { isCurrent: () => active && epoch === connection && life.current === ticket });
            } catch (_) {
                if (active && epoch === connection && life.current === ticket) setError('子会话暂不可打开，请刷新原生子会话目录后重试');
            }
        }
        const body = [
            snapshot.phase === 'error' ? h('p', { key: 'error', role: 'alert' }, '后台会话标注暂不可读取，未确认父会话是否恢复。') : null,
            snapshot.phase === 'loading' ? h('p', { key: 'loading', role: 'status' }, '正在重新检查，以下为上次标注。') : null,
            ...notices.map(function (row) {
                const title = summary?.byId?.[row.sessionId]?.displayTitle || row.sessionId;
                return h('div', { key: row.sessionId, 'data-session-id': row.sessionId, style: { margin: '4px 0', overflowWrap: 'anywhere' } },
                    h('button', { type: 'button', 'aria-label': '打开子会话：' + title, onClick: function () { return open(row); } }, title),
                    title !== row.sessionId ? h('small', { style: { display: 'block' } }, row.sessionId) : null,
                    h('span', { role: 'status', style: { display: 'block' } }, '父会话不可读，退休状态未确认'));
            }),
            error ? h('p', { key: 'open-error', role: 'alert' }, error) : null,
            h('button', { key: 'refresh', type: 'button', disabled: snapshot.phase === 'loading', onClick: refresh }, '重新检查后台会话')
        ];
        return props.header ? h('details', { className: 'dsh-tavern-retirement-notices', 'aria-label': '后台会话标注' },
            h('summary', null, snapshot.phase === 'error' ? '后台会话标注读取失败' : '后台会话需检查 · ' + notices.length), ...body)
            : h('div', { className: 'dsh-tavern-retirement-notices', 'aria-label': '后台会话标注', style: { padding: '6px 10px', overflowWrap: 'anywhere' } }, ...body);
    }
    function Row(props) { return NoticeList(props); }
    function Header(props) { return NoticeList({ sessionId: props.sessionId, header: true }); }
    function register(input) {
        input.ctx.effect(function () { return connect(input.ctx.sessions, tavernHostNavigationFor(input.ctx)); }, 'dsh-tavern: retirement notice reads');
        input.ctx.effect(function () {
            return input.slots.inject('conversation.session.header.actions', function () {
                return input.slots.register({ name: 'conversation.session.header.actions', id: 'dsh-tavern-retirement-notices', order: 20 }, Header);
            });
        }, 'dsh-tavern: retirement notice action');
    }
    return Object.freeze({ register, Row, refresh, getSnapshot });
}
