// Native alert/confirm can strand Electron's input focus; prompt is unsupported.
// Keep product dialogs in the DOM. Never replace window.confirm with a Promise:
// callers expecting a boolean would treat even a cancelled Promise as approval.
let activeTavernConfirmation = null;
function askTavernConfirm(message, options) {
    const opts = options || {};
    if (typeof document === 'undefined' || opts.signal?.aborted || activeTavernConfirmation) return Promise.resolve(false);
    return new Promise(resolve => {
        const opener = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'dsh-tavern-prompt';
        dialog.setAttribute('aria-label', '确认操作');
        const panel = document.createElement('div');
        panel.className = 'dsh-tavern-prompt-panel';
        const title = document.createElement('div');
        title.className = 'dsh-tavern-prompt-title';
        title.textContent = opts.resourceImport ? '导入资源' : '确认操作';
        const description = document.createElement('div');
        description.textContent = String(message);
        description.style.whiteSpace = 'pre-wrap';
        const actions = document.createElement('div');
        actions.className = 'dsh-tavern-prompt-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button'; cancel.className = 'dsh-tavern-btn'; cancel.textContent = opts.cancelText || '取消';
        const confirm = document.createElement('button');
        confirm.type = 'button'; confirm.className = 'dsh-tavern-btn primary'; confirm.textContent = opts.confirmText || '确认';
        actions.append(cancel, confirm); panel.append(title, description);
        let trust;
        if(opts.resourceImport){
            const label=document.createElement('label');trust=document.createElement('input');trust.type='checkbox';trust.checked=true;
            label.append(trust,document.createTextNode('导入并永久信任此资源（包含同来源更新）'));
            const detail=document.createElement('p');detail.textContent=tavernResourceTrustExplanation;
            panel.append(label,detail);confirm.textContent='导入';
        }
        panel.append(actions); dialog.append(panel);
        let settled = false;
        function restoreOpenerFocus() {
            if (!opener?.isConnected || opts.signal?.aborted) return;
            const enabled = () => !opener.disabled && !opener.matches?.(':disabled');
            if (enabled()) { opener.focus({ preventScroll: true }); return; }
            const previousFocus = document.activeElement;
            const previousModals = [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')];
            let interrupted = false;
            const interrupt = () => { interrupted = true; };
            const focusChanged = () => { if (document.activeElement !== opener) interrupt(); };
            document.addEventListener('focusin', focusChanged, true);
            document.addEventListener('pointerdown', interrupt, true);
            document.addEventListener('keydown', interrupt, true);
            for (const event of ['pagehide','popstate','hashchange']) window.addEventListener(event, interrupt);
            opts.signal?.addEventListener('abort', interrupt, { once: true });
            // Promise continuations release their busy state before the next paint.
            window.requestAnimationFrame(() => {
                document.removeEventListener('focusin', focusChanged, true);
                document.removeEventListener('pointerdown', interrupt, true);
                document.removeEventListener('keydown', interrupt, true);
                for (const event of ['pagehide','popstate','hashchange']) window.removeEventListener(event, interrupt);
                opts.signal?.removeEventListener('abort', interrupt);
                const currentModals = [...document.querySelectorAll('dialog[open],[role="dialog"][aria-modal="true"]')];
                if (interrupted || opts.signal?.aborted || activeTavernConfirmation || !opener.isConnected || !enabled()
                    || currentModals.length !== previousModals.length || currentModals.some((element,index) => element !== previousModals[index])
                    || ![previousFocus,document.body,opener].includes(document.activeElement)) return;
                opener.focus({ preventScroll: true });
            });
        }
        function finish(value, restoreFocus = true) {
            if (settled) return;
            settled = true;
            opts.signal?.removeEventListener('abort', abort);
            window.removeEventListener('pagehide', abort);
            window.removeEventListener('popstate', abort);
            window.removeEventListener('hashchange', abort);
            if (dialog.open) dialog.close();
            dialog.remove();
            if (activeTavernConfirmation === dialog) activeTavernConfirmation = null;
            if (restoreFocus) restoreOpenerFocus();
            const accepted=value === true && !opts.signal?.aborted;
            resolve(accepted && opts.resourceImport ? {trustResource:trust.checked} : accepted);
        }
        function abort() { finish(false, false); }
        cancel.addEventListener('click', () => finish(false));
        confirm.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.addEventListener('close', () => finish(false));
        dialog.addEventListener('click', event => { if (event.target === dialog) finish(false); });
        dialog.addEventListener('keydown', event => {
            if (event.isComposing && event.key === 'Enter') event.preventDefault();
        });
        opts.signal?.addEventListener('abort', abort, { once: true });
        window.addEventListener('pagehide', abort);
        window.addEventListener('popstate', abort);
        window.addEventListener('hashchange', abort);
        activeTavernConfirmation = dialog;
        try { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
        catch (_) { finish(false); }
    });
}

// Tie outstanding confirmations to the initiating component and session.
function useTavernConfirm(scope) {
    const state = React.useRef({ scope, mounted: true, pending: null });
    state.current.scope = scope;
    React.useLayoutEffect(() => {
        state.current.mounted = true;
        return () => {
            state.current.mounted = false;
            state.current.pending?.abort();
            state.current.pending = null;
        };
    }, [scope]);
    return async (message,options) => {
        const owner = state.current;
        if (!owner.mounted || owner.scope !== scope || owner.pending) return false;
        const controller = new AbortController();
        owner.pending = controller;
        try {
            const accepted = await askTavernConfirm(message, { ...options,signal: controller.signal });
            return owner.mounted && owner.scope === scope && !controller.signal.aborted ? accepted : false;
        } finally {
            if (owner.pending === controller) owner.pending = null;
        }
    };
}
const tavernResourceTrustExplanation = '一次授信允许此资源操作宿主页、跨卡读取、共享设置和资源读写，以及 HTTP/HTTPS 和本机、局域网访问。新局、刷新、重启和同来源更新继续有效，可在脚本管理的“资源授信”中撤销。宿主页访问能力很宽，分项开关不构成同源脚本的绝对隔离。';
