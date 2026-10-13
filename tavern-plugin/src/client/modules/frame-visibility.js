// Pause only measurement, never gameplay execution. The receiver authenticates source + token.
function observeTavernFrameVisibility(host, node, token) {
    let nearby = true, observer = null;
    const doc = host.document;
    function sync() { node.contentWindow?.postMessage({type:"dsh-tavern-frame-measure-active",token,active:nearby && doc?.visibilityState !== "hidden"}, "*"); }
    if (typeof host.IntersectionObserver === "function") {
        observer = new host.IntersectionObserver(entries => { nearby = entries.at(-1)?.isIntersecting !== false; sync(); }, {rootMargin:"240px 0px"});
        observer.observe(node);
    }
    node.addEventListener?.("load", sync);
    doc?.addEventListener?.("visibilitychange", sync);
    sync();
    const stop = () => { observer?.disconnect(); node.removeEventListener?.("load", sync); doc?.removeEventListener?.("visibilitychange", sync); };
    stop.sync = sync;
    return stop;
}
