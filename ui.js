/**
 * ui.js (renderer). Load AFTER renderer.js.
 * Helpers for the Modern interface. Nothing here touches your game data or renderer.js state.
 *   - Interface style switch (Modern / Classic), remembered between launches
 *   - Launcher logo button (user's own image) + menu
 *   - "Dynamic" theme: ambient backdrop and accent colour follow the selected game's artwork
 *   - Theme-aware surface colours for the Modern panels and menus
 *   - In-app right-click menu
 *   - Live "Library . N games" label, Ctrl/Cmd + K search shortcut
 */
(() => {
    const KEY = 'hb-ui';
    const BRAND_KEY = 'hb-brand';
    const root = document.documentElement;
    const isMac = /Mac/.test(navigator.userAgent);

    let ipc = null;
    let fs = null;
    try { ipc = require('electron').ipcRenderer; fs = require('fs'); } catch (_) { /* no Node access */ }

    const readStyle = () => {
        try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'modern'; }
        catch (_) { return 'modern'; }
    };
    const currentStyle = () => (root.dataset.ui === 'classic' ? 'classic' : 'modern');

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
            onSurface = '#f2f3f5';
        } else {
            const light = lum(parseColor(text, [0, 0, 0])) < 0.35; // dark text means a light theme
            const c = parseColor(bg, light ? [244, 244, 247] : [18, 18, 20]);
            surface = light ? mix(c, [255, 255, 255], 0.55) : mix(c, [8, 8, 12], 0.5);
            onSurface = light ? '#15151a' : '#f2f3f5';
        }
        root.style.setProperty('--m-surface', `rgb(${surface.join(',')})`);
        root.style.setProperty('--m-on-surface', onSurface);

        // Accent used by the Dynamic theme
        const accent = dynRGB || DEFAULT_ACCENT;
        root.style.setProperty('--dyn-accent', `rgb(${accent.join(',')})`);
        root.style.setProperty('--dyn-contrast', lum(accent) > 0.179 ? '#111111' : '#ffffff');
    }

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
    const basePlaceholder = search ? search.placeholder : '';
    function syncPlaceholder() {
        if (!search) return;
        search.placeholder = currentStyle() === 'modern'
            ? `${basePlaceholder.replace(/\.*$/, '')}   ${isMac ? '\u2318K' : 'Ctrl K'}`
            : basePlaceholder;
    }
    window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && search) {
            e.preventDefault();
            search.focus();
            search.select();
        }
    });

    // ======================================================================
    // Library count label (CSS shows it via data-label)
    // ======================================================================
    const library = document.getElementById('library');
    function updateLabel() {
        if (!library) return;
        const n = library.querySelectorAll('.game-card').length;
        library.dataset.label = `Library \u00b7 ${n} ${n === 1 ? 'game' : 'games'}`;
    }
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
    // Menus (shared by the right-click menu and the logo button)
    // ======================================================================
    let menu = null; // { el, mark, abort, owner }

    function closeMenu() {
        if (!menu) return;
        menu.abort.abort();
        menu.el.remove();
        if (menu.mark) menu.mark.classList.remove('ctx-target');
        menu = null;
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
                const i = list.indexOf(document.activeElement);
                const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
                list[next].focus();
            }
        }, { capture: true, signal });
    }

    // ======================================================================
    // Right-click menu (Modern): in-app, replays the native menu's events
    // ======================================================================
    const CTX_CHANNELS = {
        play: 'context-menu-play',
        'toggle-fav': 'context-menu-fav',
        rename: 'context-menu-rename',
        'open-customize': 'context-menu-customize',
        'open-file-location': 'context-menu-open-location',
        'change-path': 'context-menu-change-path',
        remove: 'context-menu-remove',
    };

    function openGameMenu(id, x, y, card) {
        if (typeof gameData === 'undefined' || !gameData[id]) return false;
        const game = gameData[id];
        const emit = (action) => () => { if (ipc) ipc.emit(CTX_CHANNELS[action], {}, { id, ...game }); };
        const played = typeof formatLastPlayed === 'function' ? formatLastPlayed(game.lastPlayed) : '';

        showMenu({
            owner: 'game',
            x, y, mark: card,
            head: {
                title: game.name,
                sub: game.lastPlayed ? `Last played \u00b7 ${played}` : played,
                image: game.icon ? `local-image://asset?path=${encodeURIComponent(game.icon)}` : '',
            },
            items: [
                { action: 'play', label: 'Play', cls: 'primary', run: emit('play') },
                'sep',
                { action: 'toggle-fav', label: game.favorite ? 'Remove from favorites' : 'Add to favorites', run: emit('toggle-fav') },
                { action: 'rename', label: 'Rename', run: emit('rename') },
                { action: 'open-customize', label: 'Customize artwork', run: emit('open-customize') },
                'sep',
                { action: 'open-file-location', label: 'Open file location', run: emit('open-file-location') },
                { action: 'change-path', label: 'Change game path', run: emit('change-path') },
                'sep',
                { action: 'remove', label: 'Remove from library', cls: 'danger', confirm: 'Click again to remove', run: emit('remove') },
            ],
        });
        return true;
    }

    // Capture phase on window: runs before renderer.js's own contextmenu handler.
    window.addEventListener('contextmenu', (e) => {
        if (currentStyle() !== 'modern' || !ipc) return; // Classic keeps the native menu
        const card = e.target.closest ? e.target.closest('.game-card') : null;
        if (!card) { closeMenu(); return; }
        if (!openGameMenu(card.id, e.clientX, e.clientY, card)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    // ======================================================================
    // Launcher logo button (replaces the old fixed "HB" badge)
    // ======================================================================
    const header = document.getElementById('appHeader');
    const brandBtn = document.createElement('button');
    brandBtn.type = 'button';
    brandBtn.id = 'brandBtn';
    brandBtn.className = 'brand-btn';
    brandBtn.title = 'Launcher logo';
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

    brandBtn.addEventListener('click', () => {
        if (menu && menu.owner === 'brand') { closeMenu(); return; }
        const r = brandBtn.getBoundingClientRect();
        const hasImage = !!getBrand();
        showMenu({
            owner: 'brand',
            x: r.left,
            y: r.bottom + 8,
            ignore: brandBtn,
            head: { title: 'Launcher logo', sub: hasImage ? 'Using your own image' : 'Use any image you like', image: getBrand() },
            items: [
                { action: 'brand-change', label: 'Change logo\u2026', run: chooseBrand },
                ...(hasImage ? [{ action: 'brand-reset', label: 'Reset to default', run: resetBrand }] : []),
                'sep',
                { action: 'brand-settings', label: 'Launcher settings', run: () => { const b = document.getElementById('settingsBtn'); if (b) b.click(); } },
            ],
        });
    });

    // ======================================================================
    // Settings -> Look: interface style + launcher logo
    // ======================================================================
    function buildSettings() {
        const panel = document.getElementById('settingsAppearance');
        if (!panel || document.getElementById('uiStyleSection')) return;
        const heading = panel.querySelector('h3');
        const html = `
            <div class="settings-group" id="uiStyleSection" style="margin: 0 0 20px">
                <p class="settings-group-label">Interface style</p>
                <div class="ui-style-switch" role="radiogroup" aria-label="Interface style">
                    <label><input type="radio" name="uiStyle" value="modern"><span>Modern</span></label>
                    <label><input type="radio" name="uiStyle" value="classic"><span>Classic</span></label>
                </div>
                <p class="glass-status" id="uiStyleHint"></p>
            </div>
            <div class="settings-group" id="brandSection" style="margin: 0 0 20px">
                <p class="settings-group-label">Launcher logo</p>
                <div class="brand-setting">
                    <span class="brand-preview" id="brandPreview"></span>
                    <span class="brand-setting-text"><strong>Your logo</strong><span>Shown top-left. You can also click it there.</span></span>
                    <button type="button" class="menu-btn" id="brandChange">Change</button>
                    <button type="button" class="menu-btn" id="brandReset">Reset</button>
                </div>
            </div>`;
        if (heading) heading.insertAdjacentHTML('afterend', html);
        else panel.insertAdjacentHTML('afterbegin', html);

        const hint = document.getElementById('uiStyleHint');
        const refresh = () => {
            const style = currentStyle();
            panel.querySelectorAll('input[name="uiStyle"]').forEach((r) => { r.checked = r.value === style; });
            hint.textContent = style === 'modern'
                ? 'Cinematic layout. Applies instantly.'
                : 'The original layout. Applies instantly.';
        };
        panel.querySelectorAll('input[name="uiStyle"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                root.dataset.ui = radio.value;
                try { localStorage.setItem(KEY, radio.value); } catch (_) {}
                syncPlaceholder();
                refresh();
            });
        });
        document.getElementById('brandChange').addEventListener('click', chooseBrand);
        document.getElementById('brandReset').addEventListener('click', resetBrand);
        refresh();
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
    // Start
    // ======================================================================
    root.dataset.ui = readStyle();
    syncPlaceholder();
    buildSettings();
    applyBrand();
    syncTheme();
    // Theme changes happen inside renderer.js with no event, so check cheaply a few times a second.
    setInterval(syncTheme, 300);
})();
