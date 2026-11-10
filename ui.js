/**
 * ui.js (renderer). Load AFTER renderer.js.
 * Helpers for the Modern interface. Nothing here touches your game data or renderer.js state.
 *   - Builds the Modern layout (top bar, library header with filters, bottom bar) by moving existing elements
 *   - Launcher logo button (user's own image) + menu
 *   - Controller-support icon for the selected game
 *   - "Dynamic" theme: ambient backdrop and accent colour follow the selected game's artwork
 *   - Theme-aware surface colours, in-app right-click menu, resizable game list
 */
(() => {
    const BRAND_KEY = 'hb-brand';
    const CTRL_KEY = 'hb-controller';
    const root = document.documentElement;
    const isMac = /Mac/.test(navigator.userAgent);

    let ipc = null;
    let fs = null;
    try { ipc = require('electron').ipcRenderer; fs = require('fs'); } catch (_) { /* no Node access */ }

    // ======================================================================
    // Colour helpers
    // ======================================================================
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = 1;
    const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });

    // Any CSS colour -> [r,g,b], translucent colours composited over `base`.
    function parseColor(css, base = [18, 18, 20]) {
        colorCtx.clearRect(0, 0, 1, 1);
        colorCtx.fillStyle = `rgb(${base.join(',')})`;
        colorCtx.fillRect(0, 0, 1, 1);
        colorCtx.fillStyle = String(css || '').trim();
        colorCtx.fillRect(0, 0, 1, 1);
        const d = colorCtx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
    }
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }
    function hslToRgb(h, s, l) {
        const f = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
    }

    // Most vivid dominant colour of an image, tuned to work as an accent.
    function pickAccent(img) {
        const S = 32;
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, S, S);
        let data;
        try { data = x.getImageData(0, 0, S, S).data; } catch (_) { return null; }
        const buckets = Array.from({ length: 18 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < 0.14 || l > 0.9 || s < 0.15) continue;
            const w = (s * s + 0.05) * (1 - Math.abs(l - 0.5));
            const b = buckets[Math.min(17, Math.floor(h * 18))];
            b.w += w; b.r += data[i] * w; b.g += data[i + 1] * w; b.b += data[i + 2] * w;
        }
        const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
        if (best.w <= 0) return null;
        const [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
        return hslToRgb(h, Math.max(s, 0.55), Math.min(Math.max(l, 0.6), 0.72));
    }

    // ======================================================================
    // Theme sync: surface colours + the "Dynamic" theme
    // ======================================================================
    const DEFAULT_ACCENT = [252, 150, 119];
    let dynRGB = null; // dominant colour of the selected game's artwork
    let lastSig = '';

    const themeId = () => {
        try { return (typeof currentSettings !== 'undefined' && currentSettings.theme) || 'dark'; }
        catch (_) { return 'dark'; }
    };

    function syncTheme() {
        const id = themeId();
        if (root.dataset.theme !== id) root.dataset.theme = id; // CSS hook: html[data-theme="dynamic"]

        const cs = getComputedStyle(root);
        const bg = cs.getPropertyValue('--bg').trim();
        const text = cs.getPropertyValue('--text').trim();
        const sig = [id, bg, text, dynRGB ? dynRGB.join(',') : ''].join('|');
        if (sig === lastSig) return;
        lastSig = sig;

        // Opaque panel colour derived from the active theme (so themes matter again)
        let surface;
        let onSurface;
        if (id === 'dynamic') {
            surface = mix([11, 11, 15], dynRGB || DEFAULT_ACCENT, 0.1);
            // Text follows the panel colour it sits on, so it can never end up dark on dark (or light on light)
            onSurface = lum(surface) > 0.4 ? '#15151a' : '#f2f3f5';
        } else {
            const light = lum(parseColor(text, [0, 0, 0])) < 0.35; // dark text means a light theme
            const c = parseColor(bg, light ? [244, 244, 247] : [18, 18, 20]);
            surface = light ? mix(c, [255, 255, 255], 0.55) : mix(c, [8, 8, 12], 0.5);
            onSurface = light ? '#15151a' : '#f2f3f5';
        }
        root.style.setProperty('--m-surface', `rgb(${surface.join(',')})`);
        root.style.setProperty('--m-on-surface', onSurface);
        root.style.setProperty('--dyn-text', onSurface);
        root.style.setProperty('--dyn-text-muted', `color-mix(in srgb, ${onSurface} 62%, transparent)`);
        root.style.setProperty('--settings-card', `color-mix(in srgb, rgb(${surface.join(',')}) 88%, ${onSurface} 12%)`);
        const emptySurface = id === 'dynamic'
            ? mix(parseColor(bg, [18, 18, 20]), [8, 8, 12], 0.5)
            : surface;
        root.style.setProperty('--m-empty-surface', `rgb(${emptySurface.join(',')})`);

        // Accent used by the Dynamic theme
        const accent = dynRGB || DEFAULT_ACCENT;
        root.style.setProperty('--dyn-accent', `rgb(${accent.join(',')})`);
        root.style.setProperty('--dyn-contrast', lum(accent) > 0.179 ? '#111111' : '#ffffff');
    }

    // Dynamic theme text: the preset's own text colour logic (renderer.js) works from the theme's translucent surface colour and
    // can land on black. Here the text colour comes from --dyn-text, which syncTheme() derives from the real panel colour.
    // Edit the selector list to include or exclude parts of the interface.
    const dynText = document.createElement('style');
    dynText.textContent = `
    html[data-theme="dynamic"] { color-scheme: dark; }
    html[data-theme="dynamic"] #librarySearch,
    html[data-theme="dynamic"] #librarySearch::placeholder,
    html[data-theme="dynamic"] .sort-control select,
    html[data-theme="dynamic"] .control-btn:not(#settingsBtn),
    html[data-theme="dynamic"] .game-card .info-overlay div,
    html[data-theme="dynamic"] .game-card .fallback-title,
    html[data-theme="dynamic"] .game-card .list-title,
    html[data-theme="dynamic"] .lh-title,
    html[data-theme="dynamic"] .dp-title,
    html[data-theme="dynamic"] .dp-last-played-value,
    html[data-theme="dynamic"] .menu-btn,
    html[data-theme="dynamic"] .settings-toggle,
    html[data-theme="dynamic"] .brand-setting,
    html[data-theme="dynamic"] .brand-setting-text,
    html[data-theme="dynamic"] .brand-setting-text strong,
    html[data-theme="dynamic"] .modal-content { color: var(--dyn-text, #f2f3f5) !important; }
    html[data-theme="dynamic"] #librarySearch::placeholder,
    html[data-theme="dynamic"] .dp-last-played-label { color: var(--dyn-text-muted, rgba(242,243,245,.62)) !important; }`;
    document.head.appendChild(dynText);

    let accentRequest = 0;
    function updateDynamic(artUrl) {
        const request = ++accentRequest;
        if (!artUrl) { dynRGB = null; syncTheme(); return; }
        const img = new Image();
        img.onload = () => { if (request === accentRequest) { dynRGB = pickAccent(img); syncTheme(); } };
        img.onerror = () => { if (request === accentRequest) { dynRGB = null; syncTheme(); } };
        img.src = artUrl;
    }

    // ======================================================================
    // Search hint + shortcut
    // ======================================================================
    const search = document.getElementById('librarySearch');
    function syncPlaceholder() {
        if (!search) return;
        search.placeholder = `Search library   ${isMac ? '\u2318K' : 'Ctrl K'}`;
    }
    window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && search) {
            e.preventDefault();
            search.focus();
            search.select();
        }
    });

    // ======================================================================
    // Library pane: a fixed heading (title + sort slot) above the scrolling list
    // ======================================================================
    const library = document.getElementById('library');
    const wrapper = document.getElementById('contentWrapper');
    const detail = document.getElementById('detail-panel');

    let pane = null;
    let heading = null;
    let lhTitle = null;
    let lhCount = null;
    let lhFilter = null;
    let lhLauncherFilter = null;
    let lhSort = null;
    let lhHeadingFilters = null;
    if (library && library.parentElement) {
        pane = document.createElement('div');
        pane.className = 'library-pane';
        heading = document.createElement('div');
        heading.className = 'library-heading';
        heading.id = 'libraryHeading';
        lhTitle = document.createElement('span');
        lhTitle.className = 'lh-title';
        lhCount = document.createElement('span');
        lhCount.className = 'lh-count';
        lhFilter = document.createElement('button');
        lhFilter.type = 'button';
        lhFilter.className = 'lh-filter';
        lhFilter.id = 'libraryFilterBtn';
        lhFilter.dataset.headerIdx = '6';
        lhFilter.addEventListener('click', () => {
            const next = root.dataset.libraryFilter === 'installed' ? 'all' : 'installed';
            root.dataset.libraryFilter = next;
            try { localStorage.setItem('hb-library-filter', next); } catch (error) {
                console.warn('Could not persist library filter:', error);
            }
            updateFilterButton();
            document.dispatchEvent(new CustomEvent('hb-library-filter-changed', { detail: next }));
        });
        lhLauncherFilter = document.createElement('select');
        lhLauncherFilter.className = 'lh-launcher-filter';
        lhLauncherFilter.id = 'libraryLauncherFilter';
        lhLauncherFilter.dataset.headerIdx = '7';
        lhLauncherFilter.setAttribute('aria-label', 'Filter games by launcher');
        [
            ['all', 'All launchers'],
            ['steam', 'Steam'],
            ['epic', 'Epic'],
            ['gog', 'GOG'],
            ['other', 'Other']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            lhLauncherFilter.appendChild(option);
        });
        try {
            const savedLauncher = localStorage.getItem('hb-launcher-filter');
            if (['all', 'steam', 'epic', 'gog', 'other'].includes(savedLauncher)) {
                root.dataset.launcherFilter = savedLauncher;
            }
        } catch (error) {
            console.warn('Could not read launcher filter preference:', error);
        }
        lhLauncherFilter.value = root.dataset.launcherFilter || 'all';
        lhLauncherFilter.addEventListener('change', () => {
            const next = lhLauncherFilter.value;
            root.dataset.launcherFilter = next;
            try { localStorage.setItem('hb-launcher-filter', next); } catch (error) {
                console.warn('Could not persist launcher filter:', error);
            }
            document.dispatchEvent(new CustomEvent('hb-library-filter-changed', { detail: next }));
        });
        lhSort = document.createElement('span');
        lhSort.className = 'lh-sort';
        lhSort.id = 'lhSort';
        const titleGroup = document.createElement('div');
        titleGroup.className = 'lh-title-group';
        titleGroup.append(lhTitle, lhCount);
        const headingTop = document.createElement('div');
        headingTop.className = 'lh-heading-top';
        headingTop.append(titleGroup, lhSort);
        lhHeadingFilters = document.createElement('div');
        lhHeadingFilters.className = 'lh-heading-filters';
        lhHeadingFilters.append(lhFilter, lhLauncherFilter);
        heading.append(headingTop, lhHeadingFilters);
        library.before(pane);
        pane.append(heading, library); // #library keeps its identity, so renderer.js is unaffected
    }

    function updateFilterButton() {
        if (!lhFilter) return;
        const installedOnly = root.dataset.libraryFilter === 'installed';
        lhFilter.textContent = installedOnly ? 'Installed' : 'All games';
        lhFilter.setAttribute('aria-pressed', String(installedOnly));
        lhFilter.setAttribute('aria-label', installedOnly
            ? 'Show all games'
            : 'Show installed games only');
        lhFilter.title = installedOnly ? 'Show all games' : 'Show installed games only';
    }

    function updateLabel() {
        if (!library) return;
        const cards = library.querySelectorAll('.game-card');
        const n = cards.length;
        // Tooltips matter once the list is dragged narrow enough to show icons only
        cards.forEach((card) => {
            const title = card.querySelector('.list-title');
            if (title && card.title !== title.textContent) card.title = title.textContent;
        });
        if (lhTitle) lhTitle.textContent = 'Your games';
        if (lhCount) lhCount.textContent = String(n).padStart(2, '0');
    }
    updateFilterButton();
    if (library) {
        new MutationObserver(updateLabel).observe(library, { childList: true });
        updateLabel();
    }

    // ======================================================================
    // Ambient backdrop (two layers so artwork crossfades). Visible only in the Dynamic theme.
    // ======================================================================
    const layers = [0, 1].map(() => {
        const el = document.createElement('div');
        el.className = 'ambient-layer';
        el.setAttribute('aria-hidden', 'true');
        document.body.prepend(el);
        return el;
    });
    let activeLayer = 0;
    let lastArt = '';

    function syncAmbient() {
        const hero = document.getElementById('dpHero');
        const art = hero ? hero.style.backgroundImage : '';
        const key = (art || '').replace(/&t=\d+/, ''); // ignore the cache-busting timestamp
        if (key === lastArt) return;
        lastArt = key;

        if (!art || art === 'none') {
            layers.forEach((l) => l.classList.remove('on'));
            updateDynamic(null);
            return;
        }
        const next = 1 - activeLayer;
        layers[next].style.backgroundImage = art;
        layers[next].classList.add('on');
        layers[activeLayer].classList.remove('on');
        activeLayer = next;

        const match = art.match(/url\(["']?(.*?)["']?\)/);
        updateDynamic(match ? match[1] : null);
    }
    const heroEl = document.getElementById('dpHero');
    if (heroEl) {
        new MutationObserver(syncAmbient).observe(heroEl, { attributes: true, attributeFilter: ['style'] });
        syncAmbient();
    }

    // ======================================================================
    // Menus (shared by the right-click menu, the logo button and the controller icon)
    // ======================================================================
    let menu = null; // { el, mark, abort, owner }

    function closeMenu() {
        if (!menu) return;
        const owner = menu.owner;
        menu.abort.abort();
        menu.el.remove();
        if (menu.mark) menu.mark.classList.remove('ctx-target');
        menu = null;
        if (owner === 'brand') document.dispatchEvent(new Event('hb-controller-menu-closed'));
    }

    // items: 'sep' | { action, label, cls?, confirm?, run }
    function showMenu({ owner, x, y, head, items, mark, ignore }) {
        closeMenu();
        const el = document.createElement('div');
        el.className = 'ctx-menu';
        el.setAttribute('role', 'menu');

        if (head) {
            const h = document.createElement('div');
            h.className = 'ctx-head';
            const thumb = document.createElement('span');
            thumb.className = 'ctx-thumb';
            if (head.image) thumb.style.backgroundImage = `url("${head.image}")`;
            const meta = document.createElement('span');
            meta.className = 'ctx-meta';
            const title = document.createElement('span');
            title.className = 'ctx-title';
            title.textContent = head.title || '';
            const sub = document.createElement('span');
            sub.className = 'ctx-sub';
            sub.textContent = head.sub || '';
            meta.append(title, sub);
            h.append(thumb, meta);
            el.append(h);
        }

        items.forEach((item) => {
            if (item === 'sep') {
                const d = document.createElement('div');
                d.className = 'ctx-sep';
                el.append(d);
                return;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ctx-item' + (item.cls ? ' ' + item.cls : '');
            b.setAttribute('role', 'menuitem');
            b.dataset.action = item.action;
            b.textContent = item.label;
            b._item = item;
            el.append(b);
        });

        document.body.appendChild(el);

        // Keep it on screen
        const pad = 10;
        const rect = el.getBoundingClientRect();
        const flipX = x + rect.width > window.innerWidth - pad;
        el.style.left = (flipX ? Math.max(pad, x - rect.width) : x) + 'px';
        el.style.top = Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad)) + 'px';
        el.style.setProperty('--ox', flipX ? '100%' : '0');

        const abort = new AbortController();
        const { signal } = abort;
        menu = { el, mark, abort, owner };
        if (mark) mark.classList.add('ctx-target');
        if (owner === 'brand') document.dispatchEvent(new Event('hb-controller-menu-opened'));

        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.ctx-item');
            if (!btn) return;
            const item = btn._item;
            if (item.confirm && !btn.classList.contains('confirm')) {
                btn.classList.add('confirm'); // destructive: ask for a second click
                btn.textContent = item.confirm;
                return;
            }
            closeMenu();
            item.run();
        }, { signal });

        window.addEventListener('mousedown', (e) => {
            if (el.contains(e.target) || (ignore && ignore.contains(e.target))) return;
            closeMenu();
        }, { capture: true, signal });
        window.addEventListener('wheel', (e) => { if (!el.contains(e.target)) closeMenu(); }, { capture: true, passive: true, signal });
        window.addEventListener('blur', closeMenu, { signal });
        window.addEventListener('resize', closeMenu, { signal });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation(); // don't also exit full screen
                closeMenu();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const list = [...el.querySelectorAll('.ctx-item')];
                if (!list.length) return;
                const i = list.indexOf(document.activeElement);
                const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
                list[next].focus();
            }
        }, { capture: true, signal });
    }

    document.addEventListener('hb-close-controller-menu', () => {
        if (menu && menu.owner === 'brand') closeMenu();
    });

    // Capture phase lets the game menu use a styled popup window that can extend beyond the launcher.
    window.addEventListener('contextmenu', (e) => {
        if (!ipc) return;
        const card = e.target.closest ? e.target.closest('.game-card') : null;
        if (!card) { closeMenu(); return; }
        if (typeof gameData === 'undefined' || !gameData[card.id]) return;
        closeMenu();
        e.preventDefault();
        e.stopImmediatePropagation();
        const colors = getComputedStyle(root);
        const accentButton = document.getElementById('settingsBtn');
        const surfacePanel = document.getElementById('detail-panel');
        ipc.send('show-game-context-menu', {
            ...gameData[card.id],
            id: card.id,
            x: e.screenX,
            y: e.screenY,
            theme: {
                accent: accentButton ? getComputedStyle(accentButton).backgroundColor : colors.getPropertyValue('--accent').trim(),
                contrast: accentButton ? getComputedStyle(accentButton).color : colors.getPropertyValue('--accent-contrast').trim(),
                surface: surfacePanel ? getComputedStyle(surfacePanel).backgroundColor : colors.getPropertyValue('--m-surface').trim(),
                text: surfacePanel ? getComputedStyle(surfacePanel).color : colors.getPropertyValue('--m-on-surface').trim(),
            },
        });
    }, true);

    ipc?.on('context-menu-launch-options', (event, id) => {
        if (typeof window.hbLaunchOptions === 'function') window.hbLaunchOptions(id);
    });

    // ======================================================================
    // Launcher logo button
    // ======================================================================
    const header = document.getElementById('appHeader');
    const brandBtn = document.createElement('button');
    brandBtn.type = 'button';
    brandBtn.id = 'brandBtn';
    brandBtn.className = 'brand-btn';
    brandBtn.title = 'Launcher menu';
    brandBtn.setAttribute('aria-label', 'Launcher logo and menu');
    brandBtn.setAttribute('aria-haspopup', 'menu');
    if (header) header.prepend(brandBtn);

    const getBrand = () => { try { return localStorage.getItem(BRAND_KEY) || ''; } catch (_) { return ''; } };

    function applyBrand() {
        const url = getBrand();
        if (url) root.style.setProperty('--brand-image', `url("${url}")`);
        else root.style.removeProperty('--brand-image');
        brandBtn.classList.toggle('has-image', !!url);
        const preview = document.getElementById('brandPreview');
        if (preview) preview.classList.toggle('has-image', !!url);
        const reset = document.getElementById('brandReset');
        if (reset) reset.disabled = !url;
    }

    async function chooseBrand() {
        if (!ipc || !fs) return;
        try {
            const file = await ipc.invoke('select-asset-image');
            if (!file) return;
            const objectUrl = URL.createObjectURL(new Blob([fs.readFileSync(file)]));
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = objectUrl;
            });
            URL.revokeObjectURL(objectUrl);
            // Centre-crop to a square and shrink, so it stays small in localStorage
            const S = 192;
            const c = document.createElement('canvas');
            c.width = c.height = S;
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            c.getContext('2d').drawImage(
                img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S
            );
            localStorage.setItem(BRAND_KEY, c.toDataURL('image/png'));
            applyBrand();
        } catch (err) {
            console.warn('[ui] could not set the launcher logo:', err);
        }
    }

    function resetBrand() {
        try { localStorage.removeItem(BRAND_KEY); } catch (_) {}
        applyBrand();
    }

    const settingsBtn = document.getElementById('settingsBtn');
    brandBtn.addEventListener('click', () => {
        if (menu && menu.owner === 'brand') { closeMenu(); return; }
        const r = brandBtn.getBoundingClientRect();
        const hasImage = !!getBrand();
        showMenu({
            owner: 'brand',
            x: r.left,
            y: r.bottom + 8,
            ignore: brandBtn,
            head: { title: 'Launcher', sub: hasImage ? 'Using your own logo' : 'Settings and logo', image: getBrand() },
            items: [
                { action: 'brand-settings', label: 'Launcher settings', cls: 'primary', run: () => { if (settingsBtn) settingsBtn.click(); } },
                'sep',
                { action: 'brand-change', label: 'Change logo\u2026', run: chooseBrand },
                ...(hasImage ? [{ action: 'brand-reset', label: 'Reset logo', run: resetBrand }] : []),
            ],
        });
    });

    // ======================================================================
    // Layout: move the existing controls into the Modern bars
    // ======================================================================
    const controls = header ? header.querySelector('.controls') : null;
    const sortControl = document.querySelector('.sort-control');
    const fullBtn = document.getElementById('fullScreenBtn');
    const addBtn = document.getElementById('addBtn');

    const makeDiv = (cls, id) => {
        const d = document.createElement('div');
        d.className = cls;
        d.id = id;
        return d;
    };
    const topbarCard = makeDiv('topbar-card', 'topbarCard');
    const fullscreenControls = makeDiv('fullscreen-controls', 'fullscreenControls');
    const topbarActions = makeDiv('topbar-actions', 'topbarActions');
    const footerbar = makeDiv('footerbar', 'footerbar');

    function enterModern() {
        if (!header || !controls || !search) return;
        const mac = /^mac/.test(root.dataset.os || '');
        const fullList = fullBtn ? [fullBtn] : [];

        // Insert the card first so it always lands to the left of topbarActions below,
        // regardless of OS branch.
        header.insertBefore(topbarCard, controls);
        header.insertBefore(fullscreenControls, controls);

        if (mac) {
            // Traffic lights are on the left: search stretches, Full Screen and the logo go right
            topbarCard.replaceChildren(search, ...fullList, brandBtn);
            topbarActions.remove();
        } else {
            // Windows/Linux: logo + search card on the left, Full Screen on the right
            topbarCard.replaceChildren(brandBtn, search);
            topbarActions.replaceChildren(...fullList);
            header.insertBefore(topbarActions, controls);
        }

        if (wrapper) wrapper.after(footerbar);
        if (addBtn) footerbar.replaceChildren(addBtn);
        if (lhSort && sortControl) lhSort.replaceChildren(sortControl);
        if (settingsBtn) settingsBtn.style.display = 'none'; // Settings lives in the logo menu now
        brandBtn.dataset.headerIdx = '0';
        search.dataset.headerIdx = '1';
        if (sortControl) sortControl.querySelector('select').dataset.headerIdx = '2';
        if (lhFilter) lhFilter.dataset.headerIdx = '3';
        if (lhLauncherFilter) lhLauncherFilter.dataset.headerIdx = '4';
        if (fullBtn) fullBtn.dataset.headerIdx = '5';
        if (addBtn) addBtn.dataset.headerIdx = '6';
    }

    function syncFullscreenControls() {
        if (!fullscreenControls || !lhSort || !lhHeadingFilters || !heading) return;
        const useTopbar = document.body.classList.contains('full-screen-mode')
            && !document.body.classList.contains('full-screen-preview');
        if (useTopbar) {
            fullscreenControls.replaceChildren(lhSort, lhHeadingFilters);
        } else {
            heading.querySelector('.lh-heading-top')?.append(lhSort);
            heading.append(lhHeadingFilters);
            fullscreenControls.replaceChildren();
        }
    }

    const fullscreenControlsObserver = new MutationObserver(syncFullscreenControls);
    fullscreenControlsObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncFullscreenControls();

    function applyLayout() {
        enterModern();
    }

    // Icon-only buttons need tooltips
    if (fullBtn) {
        const syncFull = () => { fullBtn.title = fullBtn.textContent.trim() || 'Full screen'; };
        new MutationObserver(syncFull).observe(fullBtn, { childList: true, characterData: true, subtree: true });
        syncFull();
    }
    if (addBtn) addBtn.title = 'Add a game';
    const openFolderBtn = document.getElementById('dashBtnOpenFolder');
    const changePathBtn = document.getElementById('dashBtnChangePath');
    if (openFolderBtn) openFolderBtn.title = 'Browse files';
    if (changePathBtn) changePathBtn.title = 'Change game path';

    // ======================================================================
    // Controller support icon (like Steam)
    // Shown when Steam lists the selected game as supporting controllers AND a controller
    // is connected or remembered from before.
    // ======================================================================
    const mgmt = document.querySelector('.dp-management-actions');
    const ctrlBtn = document.createElement('button');
    ctrlBtn.type = 'button';
    ctrlBtn.id = 'dashControllerBtn';
    ctrlBtn.className = 'dash-btn ctrl-btn';
    ctrlBtn.hidden = true;
    ctrlBtn.setAttribute('aria-label', 'Controller support');
    if (mgmt) mgmt.prepend(ctrlBtn);

    function controllerKind(id) {
        const s = String(id || '').toLowerCase();
        if (/dualsense|dualshock|playstation|wireless controller|054c/.test(s)) return 'PlayStation';
        if (/xbox|xinput|microsoft|045e/.test(s)) return 'Xbox';
        if (/switch|pro controller|nintendo|057e/.test(s)) return 'Switch';
        return 'Generic';
    }
    function rememberController(id) {
        try { localStorage.setItem(CTRL_KEY, controllerKind(id)); } catch (_) {}
    }
    function knownController() {
        const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
        if (pads.length) {
            rememberController(pads[0].id);
            return { kind: controllerKind(pads[0].id), connected: true };
        }
        try {
            const kind = localStorage.getItem(CTRL_KEY);
            if (kind) return { kind, connected: false };
        } catch (_) {}
        return null;
    }
    window.addEventListener('gamepadconnected', (e) => { rememberController(e.gamepad.id); syncController(); });

    let ctrlSig = '';
    function syncController() {
        const id = typeof selectedListId !== 'undefined' ? selectedListId : null;
        const game = id && typeof gameData !== 'undefined' ? gameData[id] : null;
        const support = game && game.steamMedia ? game.steamMedia.controllerSupport : undefined;
        const ctrl = knownController();
        const show = !!ctrl && (support === 'full' || support === 'partial');
        const sig = [show, support, ctrl && ctrl.kind, ctrl && ctrl.connected].join('|');
        if (sig === ctrlSig) return;
        ctrlSig = sig;

        ctrlBtn.hidden = !show;
        if (!show) return;
        ctrlBtn.dataset.level = support;
        ctrlBtn.title = `${support === 'full' ? 'Full' : 'Partial'} controller support`;
        ctrlBtn.dataset.kind = ctrl.kind;
        ctrlBtn.dataset.connected = ctrl.connected ? '1' : '';
    }
    ctrlBtn.addEventListener('click', () => {
        if (menu && menu.owner === 'ctrl') { closeMenu(); return; }
        const level = ctrlBtn.dataset.level === 'full' ? 'Full' : 'Partial';
        const r = ctrlBtn.getBoundingClientRect();
        showMenu({
            owner: 'ctrl',
            x: r.left,
            y: r.bottom + 8,
            ignore: ctrlBtn,
            head: {
                title: `${level} controller support`,
                sub: `Steam lists this game \u00b7 your ${ctrlBtn.dataset.kind || 'controller'} ${ctrlBtn.dataset.connected ? 'is connected' : 'was last used'}`,
            },
            items: [],
        });
    });
    setInterval(syncController, 400);

    // ======================================================================
    // Settings -> Look: interface style + launcher logo + corners
    // ======================================================================
    function buildSettings() {
        const panel = document.getElementById('settingsAppearance');
        if (!panel || document.getElementById('uiStyleSection')) return;
        const html = `
            <div class="settings-group" id="uiStyleSection">
                <p class="settings-group-label">Interface</p>
                <p class="glass-status" id="uiStyleHint">Modern layout is enabled.</p>
                <div id="cornersRow">
                    <label class="settings-toggle" for="cornersToggle" style="margin-top: 12px">
                        <input type="checkbox" id="cornersToggle">
                        <span>Match my system's corner radius</span>
                    </label>
                    <p class="glass-status" id="cornersHint"></p>
                </div>
            </div>
            <div class="settings-group" id="brandSection">
                <p class="settings-group-label">Launcher logo</p>
                <div class="brand-setting">
                    <span class="brand-preview" id="brandPreview"></span>
                    <span class="brand-setting-text"><strong>Your logo</strong><span>Shown in the top bar. You can also click it there.</span></span>
                    <button type="button" class="menu-btn" id="brandChange">Change</button>
                    <button type="button" class="menu-btn" id="brandReset">Reset</button>
                </div>
            </div>`;
        panel.insertAdjacentHTML('beforeend', html);

        document.getElementById('brandChange').addEventListener('click', chooseBrand);
        document.getElementById('brandReset').addEventListener('click', resetBrand);

        const cornersToggle = document.getElementById('cornersToggle');
        const cornersHint = document.getElementById('cornersHint');
        const OS_NAMES = { win11: 'Windows 11', win10: 'Windows 10', mac: 'macOS', mac26: 'macOS 26', mac27: 'macOS 27' };
        const refreshCorners = () => {
            cornersToggle.checked = root.dataset.corners !== 'soft';
            const px = getComputedStyle(root).getPropertyValue('--os-radius').trim();
            cornersHint.textContent = cornersToggle.checked
                ? `Panels and menus use ${px} corners, like ${OS_NAMES[root.dataset.os] || 'your system'} windows.`
                : 'Original soft, rounded corners.';
        };
        cornersToggle.addEventListener('change', () => {
            root.dataset.corners = cornersToggle.checked ? 'system' : 'soft';
            try { localStorage.setItem('hb-corners', root.dataset.corners); } catch (_) {}
            refreshCorners();
        });
        refreshCorners();
        applyBrand();
    }

    // ======================================================================
    // Artwork customiser: show which game is being edited
    // ======================================================================
    const customizeModal = document.getElementById('customizeModal');
    if (customizeModal) {
        const title = customizeModal.querySelector('h2');
        const sub = document.createElement('p');
        sub.className = 'cz-sub';
        if (title) title.after(sub);
        new MutationObserver(() => {
            if (!customizeModal.style.display || customizeModal.style.display === 'none') return;
            const game = typeof gameData !== 'undefined' && typeof currentEditingId !== 'undefined'
                ? gameData[currentEditingId] : null;
            sub.textContent = game ? game.name : '';
        }).observe(customizeModal, { attributes: true, attributeFilter: ['style'] });
    }

    // ======================================================================
    // Resizable game list: drag the divider (double-click or Enter to reset)
    // ======================================================================
    const SPLIT_KEY = 'hb-sidebar-width';
    const MIN_SIDEBAR = 56; // icon rail
    if (wrapper && library && detail) {
        const splitter = document.createElement('div');
        splitter.id = 'splitter';
        splitter.className = 'splitter';
        splitter.setAttribute('role', 'separator');
        splitter.setAttribute('aria-orientation', 'vertical');
        splitter.setAttribute('aria-label', 'Resize game list');
        splitter.tabIndex = 0;
        splitter.title = 'Drag to resize \u00b7 double-click to reset';
        detail.before(splitter);

        let desired = null; // the width the user asked for; re-clamped whenever the window changes size
        try { desired = parseInt(localStorage.getItem(SPLIT_KEY), 10) || null; } catch (_) {}

        const maxWidth = () => Math.max(MIN_SIDEBAR, Math.min(window.innerWidth * 0.6, window.innerWidth - 440));
        const clamp = (w) => Math.round(Math.max(MIN_SIDEBAR, Math.min(maxWidth(), w)));
        const applyWidth = () => {
            if (desired == null) {
                root.style.removeProperty('--sidebar-width'); // back to the stylesheet default
                splitter.removeAttribute('aria-valuenow');
                return;
            }
            const w = clamp(desired);
            root.style.setProperty('--sidebar-width', w + 'px');
            splitter.setAttribute('aria-valuenow', String(w));
        };
        const persistWidth = () => {
            try {
                if (desired == null) localStorage.removeItem(SPLIT_KEY);
                else localStorage.setItem(SPLIT_KEY, String(desired));
            } catch (_) {}
        };
        const setWidth = (w, save) => { desired = clamp(w); applyWidth(); if (save) persistWidth(); };
        const resetWidth = () => { desired = null; applyWidth(); persistWidth(); };

        let drag = null;
        splitter.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, w: (pane || library).getBoundingClientRect().width };
            splitter.setPointerCapture(e.pointerId);
            document.body.classList.add('is-resizing');
            e.preventDefault();
        });
        splitter.addEventListener('pointermove', (e) => {
            if (drag) setWidth(drag.w + (e.clientX - drag.x), false);
        });
        const endDrag = (e) => {
            if (!drag) return;
            drag = null;
            document.body.classList.remove('is-resizing');
            if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
            persistWidth();
        };
        splitter.addEventListener('pointerup', endDrag);
        splitter.addEventListener('pointercancel', endDrag);
        splitter.addEventListener('dblclick', resetWidth);
        splitter.addEventListener('keydown', (e) => {
            const current = (pane || library).getBoundingClientRect().width;
            const step = e.shiftKey ? 48 : 16;
            if (e.key === 'ArrowLeft') setWidth(current - step, true);
            else if (e.key === 'ArrowRight') setWidth(current + step, true);
            else if (e.key === 'Home') setWidth(MIN_SIDEBAR, true);
            else if (e.key === 'End') setWidth(maxWidth(), true);
            else if (e.key === 'Enter') resetWidth();
            else return;
            e.preventDefault();
        });
        window.addEventListener('resize', applyWidth);
        applyWidth();
    }

    // ======================================================================
    // Start
    // ======================================================================
    root.dataset.ui = 'modern';
    applyLayout();
    syncPlaceholder();
    buildSettings();
    applyBrand();
    syncTheme();
    syncController();
    document.addEventListener('hb-settings-applied', syncTheme);
})();
