// Navigation belongs to the native UI owner; operation references belong to
// their caller. Never project a synthetic `current` into the Session catalog.
function tavernCurrentSessionId(sessions, snapshot = sessions.list.getSnapshot()) {
    if (Object.prototype.hasOwnProperty.call(snapshot, 'current')) return snapshot.current || '';
    return Object.values(snapshot.byId || {}).find(row => (row.retainedBy?.mainView || 0) > 0)?.id || '';
}

function tavernSubagentCatalog(sessions, parentId, snapshot = sessions.list.getSnapshot()) {
    if (snapshot.subagentsByParent) return snapshot.subagentsByParent[parentId];
    const projection = snapshot.projectionsBySession?.[parentId];
    if (!projection) return undefined;
    return { state: projection.state === 'idle' ? projection.values?.subagentCatalog === undefined ? 'loading' : 'ready' : projection.state,
        error: projection.error, entries: projection.values?.subagentCatalog || [] };
}

function createTavernHostNavigation({ sessions, uiWorkspace, workspaces }) {
    const retained = typeof sessions.retain === 'function';
    const lifetime = new AbortController(), references = new Set();
    let opening;
    const signalFor = signal => signal ? AbortSignal.any([lifetime.signal, signal]) : lifetime.signal;
    async function waitListed(id, { signal } = {}) {
        signal = signalFor(signal); signal.throwIfAborted();
        if (!sessions.list.getSnapshot().byId[id]) await sessions.refresh();
        signal.throwIfAborted();
        if (!sessions.list.getSnapshot().byId[id]) throw new Error('DSH Session 不在原生目录中：' + id);
    }
    async function acquire(target, { signal } = {}) {
        signal = signalFor(signal); signal.throwIfAborted();
        if (typeof target === 'string') await waitListed(target, { signal });
        signal.throwIfAborted();
        if (!retained && typeof target === 'string') {
            await createSessionListRecoveryModule({
                summary: id => sessions.list.getSnapshot().byId[id], binding: id => sessions.binding(id),
                refresh: () => sessions.refresh(), open: id => sessions.open(id)
            }).wait(target);
            signal.throwIfAborted();
        }
        if (!retained) return { sessionId: typeof target === 'string' ? target : target.childSessionId,
            binding: sessions.binding(typeof target === 'string' ? target : target.childSessionId), release() {} };
        const native = sessions.retain(target, { source: 'controllerOperation', signal });
        let released = false;
        const lease = { sessionId: native.sessionId,
            get binding() { return native.binding; },
            release() { if (!released) { released = true; references.delete(lease); native.release(); } } };
        references.add(lease);
        try { await native.ready; signal.throwIfAborted(); return lease; }
        catch (error) { lease.release(); throw error; }
    }
    async function using(target, operation, options) {
        const reference = await acquire(target, options);
        try { return await operation(reference); }
        finally { reference.release(); }
    }
    async function open(target, { signal, isCurrent } = {}) {
        opening?.abort();
        const attempt = new AbortController(); opening = attempt;
        signal = signalFor(signal ? AbortSignal.any([signal, attempt.signal]) : attempt.signal);
        try {
            return await using(target, () => {
                signal.throwIfAborted();
                if (isCurrent && !isCurrent()) throw new Error('Navigation request superseded');
                if (retained) {
                    if (!uiWorkspace || typeof uiWorkspace.openSession !== 'function') throw new Error('缺少原生主窗口导航服务');
                    uiWorkspace.openSession(target);
                } else if (typeof target === 'string') sessions.open(target);
                else sessions.openSubagent(target);
            }, { signal });
        } finally { if (opening === attempt) opening = undefined; }
    }
    async function refreshCatalog(parentId) {
        lifetime.signal.throwIfAborted();
        if (retained) await sessions.refreshProjections(parentId);
        else await sessions.refreshSubagents(parentId);
        lifetime.signal.throwIfAborted();
        const catalog = tavernSubagentCatalog(sessions, parentId);
        if (catalog?.state !== 'ready') throw new Error('原生子会话目录尚不可读取');
        return catalog;
    }
    async function openChild(address, options) {
        const catalog = await refreshCatalog(address.parentSessionId);
        const entry = catalog.entries.find(row => row.id === address.childSessionId &&
            (retained || row.kind === 'child'));
        if (!entry || !['continuable', 'one-shot'].includes(entry.mode) ||
            address.mode && address.mode !== entry.mode) throw new Error('原生子会话身份或模式已变化');
        return open({ parentSessionId: address.parentSessionId, childSessionId: entry.id, mode: entry.mode }, options);
    }
    return Object.freeze({
        currentId: snapshot => tavernCurrentSessionId(sessions, snapshot), waitListed, acquire, using, open, openChild, refreshCatalog,
        catalog: (id, snapshot) => tavernSubagentCatalog(sessions, id, snapshot),
        create: async options => { const id = await sessions.create(options); await waitListed(id); return id; },
        fork: (id, atSeq) => using(id, () => sessions.fork({ sessionId: id, atSeq, increaseTitle: true })),
        archive: id => retained ? uiWorkspace.archiveSession(id) : workspaces.archiveSession(id),
        clear() {
            if (!retained) return sessions.clear();
            // V4 owns selection. Archive clears deleted targets through archiveSession;
            // a resource/mode picker keeps the live view until replacement.
            // Starting a Session here would create an unrelated record.
        },
        dispose() { lifetime.abort(); opening?.abort(); for (const reference of [...references]) reference.release(); }
    });
}

const tavernHostNavigationOwners = new WeakMap();
function tavernHostNavigationFor(ctx) {
    let navigation = tavernHostNavigationOwners.get(ctx);
    if (!navigation) {
        navigation = createTavernHostNavigation({ sessions: ctx.sessions, uiWorkspace: ctx.get('uiWorkspace'), workspaces: ctx.workspaces });
        tavernHostNavigationOwners.set(ctx, navigation);
        ctx.effect(() => () => { navigation.dispose(); tavernHostNavigationOwners.delete(ctx); }, 'Tavern host navigation');
    }
    return navigation;
}
