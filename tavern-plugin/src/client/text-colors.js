function findTavernQuoteRanges(text) {
    // Match only complete same-line pairs, including the delimiters.
    const pattern = /"[^"\r\n]+"|“[^”\r\n]+”|«[^»\r\n]+»|「[^」\r\n]+」|『[^』\r\n]+』|＂[^＂\r\n]+＂/g;
    return Array.from(String(text).matchAll(pattern), match => [match.index, match.index + match[0].length]);
}

function installTavernTextColors(root, options, findQuotes) {
    const doc = root.ownerDocument, win = doc.defaultView;
    if (!win.CSS || !win.CSS.highlights || typeof win.Highlight !== 'function') return { setEnabled() {}, setColors() {}, dispose() {} };
    const colors = { 'quote-light': '#875000', 'quote-dark': '#edb75f', 'em-light': '#75529b', 'em-dark': '#bba4e3' };
    // Self-contained because HTML frames receive this function as source text.
    // Equal palettes share four highlights; different callers retain their colors.
    const shared = win.__dshTavernTextColors || (win.__dshTavernTextColors = { users: 0, groups: new Map(), nextGroup: 0, themed: new Set() });
    function themeKey() {
        return win.getComputedStyle(doc.documentElement).colorScheme + '|' + win.getComputedStyle(doc.body || doc.documentElement).color;
    }
    if (!shared.users++) {
        shared.themeKey = themeKey();
        shared.theme = new win.MutationObserver(function () {
            const next = themeKey();
            if (next === shared.themeKey) return;
            shared.themeKey = next;
            shared.themed.forEach(function (notify) { notify(); });
        });
        const attributes = { attributes: true, attributeFilter: ['style', 'class', 'data-ds-dark-theme', 'data-ds-theme-source', 'color-scheme'] };
        shared.theme.observe(doc.documentElement, attributes);
        if (doc.body) shared.theme.observe(doc.body, attributes);
    }
    let group;
    const owned = [];
    function releaseGroup(value) {
        if (!value || --value.users) return;
        for (const kind of Object.keys(colors)) win.CSS.highlights.delete(value.prefix + '-' + kind);
        value.style.remove();
        shared.groups.delete(value.key);
    }
    function setColors(overrides) {
        if (disposed) return;
        const resolved = Object.entries(colors).map(([kind, fallback]) => {
            const value = overrides && overrides[kind.startsWith('quote') ? 'quote' : 'em'];
            return [kind, typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback];
        });
        const key = JSON.stringify(resolved);
        if (group?.key === key) return;
        let next = shared.groups.get(key);
        if (!next) {
            const prefix = 'dsh-tavern-text-' + (++shared.nextGroup);
            const style = doc.createElement('style'), highlights = new Map();
            style.setAttribute('data-dsh-tavern-text-colors', '');
            style.textContent = resolved.map(([kind, color]) => '::highlight(' + prefix + '-' + kind + '){color:' + color + '}').join('\n');
            doc.head.appendChild(style);
            for (const kind of Object.keys(colors)) {
                const highlight = new win.Highlight();
                highlight.priority = kind.startsWith('quote') ? 2 : 1;
                highlights.set(kind, highlight);
                win.CSS.highlights.set(prefix + '-' + kind, highlight);
            }
            next = { key, prefix, style, highlights, users: 0 };
            shared.groups.set(key, next);
        }
        next.users++;
        for (const [kind, range] of owned) {
            group.highlights.get(kind).delete(range);
            next.highlights.get(kind).add(range);
        }
        releaseGroup(group);
        group = next;
    }
    function clearOwned() {
        for (const [kind, range] of owned) group.highlights.get(kind).delete(range);
        owned.length = 0;
    }
    let enabled = options.enabled !== false, disposed = false, timer = null;
    setColors(options.colors);
    const excluded = 'script,style,textarea,input,select,button,a,code,pre,kbd,samp,svg,math,[hidden],[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"]';
    const blocks = 'p,div,li,td,th,blockquote,section,article,h1,h2,h3,h4,h5,h6';
    function explicitColor(element) {
        for (let current = element; current; current = current.parentElement) {
            if (current.hasAttribute('color') || current.style.color || current.style.webkitTextFillColor) return true;
            // A block's baseline color is not a specialized dialogue/emphasis color.
            if (current.matches('span,font,q,em,i,b,strong,u,mark') && current.parentElement
                && win.getComputedStyle(current).color !== win.getComputedStyle(current.parentElement).color) return true;
            if (current === root) break;
        }
        return false;
    }
    const paletteCache = new Map();
    let canvas;
    function palette(element) {
        const color = win.getComputedStyle(element).color;
        if (paletteCache.has(color)) return paletteCache.get(color);
        let rgb = color.match(/[\d.]+/g) || [];
        if (!/^rgba?\(/.test(color)) {
            // Modern themes may use oklch/display-p3; read their sRGB equivalent.
            if (!canvas) { canvas = doc.createElement('canvas'); canvas.width = canvas.height = 1; }
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (context) { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); rgb = context.getImageData(0, 0, 1, 1).data; }
        }
        const result = Number(rgb[0]) * .2126 + Number(rgb[1]) * .7152 + Number(rgb[2]) * .0722 > 145 ? 'dark' : 'light';
        paletteCache.set(color, result);
        return result;
    }
    function add(kind, entry, start, end) {
        const range = doc.createRange();
        range.setStart(entry.node, start); range.setEnd(entry.node, end);
        group.highlights.get(kind + '-' + entry.palette).add(range);
        owned.push([kind + '-' + entry.palette, range]);
    }
    function refresh() {
        timer = null;
        clearOwned();
        if (disposed || !enabled) return;
        const walker = doc.createTreeWalker(root, 4); // SHOW_TEXT; never edit React/card-owned DOM.
        let group = [], block = null, text = '';
        function flush() {
            for (const [start, end] of findQuotes(text)) for (const entry of group) {
                const from = Math.max(start, entry.offset), to = Math.min(end, entry.offset + entry.node.length);
                if (from < to) add('quote', entry, from - entry.offset, to - entry.offset);
            }
            group = []; text = '';
        }
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node.parentElement;
            if (!element || element.closest(excluded) || explicitColor(element)) { flush(); block = null; continue; }
            const owner = element.closest(blocks) || root;
            // <br> is a rendered line break even without a newline text node.
            if (owner !== block || (node.previousSibling && node.previousSibling.nodeName === 'BR')) flush();
            block = owner;
            const entry = { node, offset: text.length, palette: palette(element) };
            group.push(entry); text += node.data;
            if (element.closest('q')) add('quote', entry, 0, node.length);
            else if (element.closest('em,i')) add('em', entry, 0, node.length);
        }
        flush();
    }
    function schedule() { if (!disposed && enabled && timer === null) timer = win.setTimeout(refresh, 32); }
    const observer = new win.MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'color', 'hidden'] });
    shared.themed.add(schedule);
    // Batch mounts before reading computed styles.
    schedule();
    return {
        setColors,
        setEnabled(value) {
            enabled = value !== false;
            if (timer !== null) win.clearTimeout(timer);
            timer = null;
            if (enabled) schedule();
            else clearOwned();
        },
        dispose() {
            if (disposed) return;
            disposed = true; observer.disconnect(); if (timer !== null) win.clearTimeout(timer);
            clearOwned(); releaseGroup(group); shared.themed.delete(schedule);
            if (!--shared.users) { shared.theme.disconnect(); shared.theme = null; }
        }
    };
}

function tavernTextColorsEnabled(host) {
    try { return host.localStorage.getItem('dsh-tavern-text-colors') !== 'off'; } catch (_) { return true; }
}
function setTavernTextColorsEnabled(enabled) {
    try { window.localStorage.setItem('dsh-tavern-text-colors', enabled ? 'on' : 'off'); } catch (_) {}
    window.dispatchEvent(new CustomEvent('dsh-tavern-text-colors-changed', { detail: enabled }));
}
function tavernTextColorOverrides(host) {
    try {
        const value = JSON.parse(host.localStorage.getItem('dsh-tavern-text-color-overrides') || '{}');
        const result = {};
        for (const key of ['quote', 'em']) if (value && typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key];
        return result;
    } catch (_) { return {}; }
}
function setTavernTextColorOverrides(colors) {
    try { window.localStorage.setItem('dsh-tavern-text-color-overrides', JSON.stringify(colors)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('dsh-tavern-text-colors-changed'));
}
function TavernColoredMarkdown(props) {
    const root = React.useRef(null);
    React.useEffect(function () {
        const colors = installTavernTextColors(root.current, { enabled: tavernTextColorsEnabled(window), colors: tavernTextColorOverrides(window) }, findTavernQuoteRanges);
        const changed = () => { colors.setColors(tavernTextColorOverrides(window)); colors.setEnabled(tavernTextColorsEnabled(window)); };
        window.addEventListener('dsh-tavern-text-colors-changed', changed);
        window.addEventListener('storage', changed);
        return function () { window.removeEventListener('dsh-tavern-text-colors-changed', changed); window.removeEventListener('storage', changed); colors.dispose(); };
    }, []);
    return React.createElement('div', { ref: root, className: 'dsh-tavern-colored-markdown' }, React.createElement(DshUi.MarkdownText, props));
}
function TavernTextColorSettings() {
    const [enabled, setEnabled] = React.useState(() => tavernTextColorsEnabled(window));
    const [overrides, setOverrides] = React.useState(() => tavernTextColorOverrides(window));
    React.useEffect(function () {
        const changed = () => { setEnabled(tavernTextColorsEnabled(window)); setOverrides(tavernTextColorOverrides(window)); };
        window.addEventListener('dsh-tavern-text-colors-changed', changed);
        window.addEventListener('storage', changed);
        return function () { window.removeEventListener('dsh-tavern-text-colors-changed', changed); window.removeEventListener('storage', changed); };
    }, []);
    return React.createElement('div', { className: 'dsh-tavern-settings-group' },
        React.createElement('label', { className: 'dsh-tavern-settings-row' },
            React.createElement('span', { className: 'dsh-tavern-settings-copy' },
                React.createElement('span', { className: 'dsh-tavern-settings-title' }, '正文分色'),
                React.createElement('span', { className: 'dsh-tavern-settings-desc' }, '当前浏览器 · 开关与颜色自动保存。为引号内对白和斜体文字分别选色，普通文字保持原色。保留人物卡已有配色；仅影响当前浏览器显示。')),
            React.createElement('span', { className: 'dsh-tavern-settings-switch' },
                React.createElement('input', { type: 'checkbox', role: 'switch', 'aria-label': '正文分色', checked: enabled, onChange: event => { setEnabled(event.target.checked); setTavernTextColorsEnabled(event.target.checked); } }),
                React.createElement('span', { className: 'dsh-tavern-settings-track', 'aria-hidden': 'true' }))),
        ...[['quote', '对白颜色', '#edb75f'], ['em', '斜体颜色', '#bba4e3']].map(([key, label, fallback]) =>
            React.createElement('label', { key, className: 'dsh-tavern-settings-row' },
                React.createElement('span', { className: 'dsh-tavern-settings-copy' },
                    React.createElement('span', { className: 'dsh-tavern-settings-title' }, label),
                    React.createElement('span', { className: 'dsh-tavern-settings-desc' }, overrides[key] ? overrides[key].toUpperCase() : '默认：自动适配深浅背景')),
                React.createElement('input', { type: 'color', 'aria-label': label, style: { width: 48, height: 32, flexShrink: 0, cursor: 'pointer' }, value: overrides[key] || fallback, disabled: !enabled,
                    onChange: event => { const next = { ...overrides, [key]: event.target.value }; setOverrides(next); setTavernTextColorOverrides(next); } }))),
        React.createElement('div', { className: 'dsh-tavern-settings-row' }, React.createElement('button', { type: 'button', className: 'dsh-tavern-btn', disabled: !Object.keys(overrides).length,
            onClick: () => { setOverrides({}); setTavernTextColorOverrides({}); } }, '恢复默认配色')));
}
