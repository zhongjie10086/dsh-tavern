// Serialized into the message frame. A completed DOM can still have no layout
// while the browser activates it; that is not an actual 48px content measurement.
function installTavernFrameMeasurement(token, overlayOpen) {
    const root = document.documentElement;
    let active = true, stopped = false, last = 0, queued = null, queuedAsFrame = false;
    let retryTimer = null, retries = 0, observedBody = null, overlay = false, actedAt = -Infinity;
    const retryDelays = [16, 32, 64, 128, 256, 512];
    const current = () => !stopped && document.documentElement === root;
    function cancelQueued() {
        if (queued !== null) {
            if (queuedAsFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(queued);
            else clearTimeout(queued);
            queued = null;
        }
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
    }
    function nodeBottom(node) {
        if (!node || typeof node.getBoundingClientRect !== "function") return 0;
        let style;
        try { style = getComputedStyle(node); } catch (_) { return 0; }
        if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return 0;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return 0;
        let top = rect.top, bottom = rect.bottom + Math.max(0, parseFloat(style.marginBottom) || 0);
        for (let ancestor = node.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
            if (String(ancestor.tagName || "").toLowerCase() === "details" && !ancestor.open) {
                const summary = ancestor.querySelector("summary");
                if (!summary || !summary.contains(node)) return 0;
            }
            let ancestorStyle;
            try { ancestorStyle = getComputedStyle(ancestor); } catch (_) { ancestorStyle = null; }
            const overflow = String(ancestorStyle && (ancestorStyle.overflowY || ancestorStyle.overflow) || "visible");
            if (overflow !== "visible") {
                const box = ancestor.getBoundingClientRect();
                top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
                if (bottom <= top) return 0;
            }
        }
        return Math.ceil(bottom + (window.scrollY || 0));
    }
    function measure() {
        const body = document.body;
        if (!body || document.hidden === true || !(window.innerWidth > 0 && window.innerHeight > 0)) return null;
        const bodyRect = body.getBoundingClientRect(), scroll = body.scrollHeight || 0;
        let laidOut = bodyRect.width > 0 || bodyRect.height > 0 || scroll > 0;
        let height = Math.max(scroll, Math.ceil(bodyRect.bottom + (window.scrollY || 0)), 48);
        for (const node of [body].concat(Array.from(body.querySelectorAll("*")))) {
            const bottom = nodeBottom(node);
            if (bottom > 0) laidOut = true;
            height = Math.max(height, bottom);
        }
        if (!laidOut) {
            // An author can deliberately remove the body box or all its contents.
            // A laid-out html viewport distinguishes that from a missing layout.
            const style = getComputedStyle(body);
            const emptyBox = style.display === "none" || style.display === "contents";
            if (!emptyBox || !(root.getBoundingClientRect().width > 0)) return null;
        }
        return height;
    }
    function checkOverlay() {
        let open = false;
        try { open = overlayOpen(document, window) === true; } catch (_) {}
        if (open && !overlay && Date.now() - actedAt < 3000) parent.postMessage({type:"dsh-tavern-frame-overlay",token}, "*");
        overlay = open;
    }
    function retry() {
        if (!active || !current() || retryTimer !== null || retries >= retryDelays.length) return;
        retryTimer = setTimeout(function () { retryTimer = null; enqueue(); }, retryDelays[retries++]);
    }
    function report() {
        queued = null;
        if (!current()) { stop(); return; }
        if (!active) return;
        observeBody();
        const height = measure();
        if (height === null) { retry(); return; }
        retries = 0;
        checkOverlay();
        root.toggleAttribute("data-dsh-tavern-scroll", height >= 1200);
        if (height === last) return;
        last = height;
        parent.postMessage({type:"dsh-tavern-frame-height",token:token,height:height},"*");
    }
    function enqueue() {
        if (!current()) { stop(); return; }
        if (!active || queued !== null) return;
        queued = true;
        queuedAsFrame = typeof requestAnimationFrame === "function";
        const id = queuedAsFrame ? requestAnimationFrame(report) : setTimeout(report, 0);
        // Also supports synchronous animation-frame providers in pure tests.
        if (queued !== null) queued = id;
    }
    function schedule() {
        if (!current()) { stop(); return; }
        if (!active) return;
        if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
        retries = 0; enqueue();
    }
    function acted(event) {
        if (!event.isTrusted) return;
        try { overlay = overlayOpen(document, window) === true; } catch (_) { overlay = false; }
        actedAt = Date.now(); schedule();
    }
    function animation() { if (Date.now() - actedAt < 3000) schedule(); }
    const mutations = new MutationObserver(schedule);
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    function observeBody() {
        if (!sizes || observedBody === document.body) return;
        if (observedBody) sizes.unobserve?.(observedBody);
        observedBody = document.body;
        if (observedBody) sizes.observe(observedBody);
    }
    function observe() {
        mutations.observe(root, {subtree:true,childList:true,attributes:true,characterData:true});
        if (sizes) {
            sizes.observe(root);
            observeBody();
        }
    }
    function receive(event) {
        const data = event.data;
        if (event.source !== parent || !data || data.token !== token || data.type !== "dsh-tavern-frame-measure-active") return;
        if (!current()) { stop(); return; }
        active = data.active !== false;
        if (active) { observe(); schedule(); }
        else { cancelQueued(); mutations.disconnect(); sizes?.disconnect(); observedBody = null; }
    }
    const events = [["pointerdown",acted,true],["keydown",acted,true],["transitionend",animation,true],["animationend",animation,true],
        ["load",schedule],["toggle",schedule,true],["resize",schedule],["message",receive],["pagehide",stop]];
    function stop() {
        if (stopped) return;
        stopped = true; active = false; cancelQueued(); mutations.disconnect(); sizes?.disconnect(); observedBody = null;
        for (const [name, fn, capture] of events) removeEventListener(name, fn, capture);
    }
    for (const [name, fn, capture] of events) addEventListener(name, fn, capture);
    if (document.fonts?.ready) document.fonts.ready.then(schedule);
    observe(); schedule();
    return stop;
}
