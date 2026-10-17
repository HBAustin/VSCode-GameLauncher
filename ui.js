/**
 * ui.js (renderer). Load AFTER renderer.js.
 * Small helpers for the Modern interface. Nothing here touches your game data or renderer.js state.
 *   - Interface style switch (Modern / Classic), remembered between launches
 *   - Ambient backdrop that follows the selected game's artwork
 *   - Live "Library . N games" label
 *   - Ctrl/Cmd + K focuses search
 */
(() => {
    const KEY = 'hb-ui';
    const root = document.documentElement;
    const isMac = /Mac/.test(navigator.userAgent);

    const readStyle = () => {
        try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'modern'; }
        catch (_) { return 'modern'; }
    };
    const currentStyle = () => (root.dataset.ui === 'classic' ? 'classic' : 'modern');

    // ---- Search hint + shortcut ------------------------------------------------
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

    // ---- Library count label (CSS shows it via data-label) ---------------------
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

    // ---- Ambient backdrop (two layers so artwork crossfades) -------------------
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
            return;
        }
        const next = 1 - activeLayer;
        layers[next].style.backgroundImage = art;
        layers[next].classList.add('on');
        layers[activeLayer].classList.remove('on');
        activeLayer = next;
    }
    const hero = document.getElementById('dpHero');
    if (hero) {
        new MutationObserver(syncAmbient).observe(hero, { attributes: true, attributeFilter: ['style'] });
        syncAmbient();
    }

    // ---- Interface style switch in Settings -> Look ----------------------------
    function buildSwitch() {
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
            </div>`;
        if (heading) heading.insertAdjacentHTML('afterend', html);
        else panel.insertAdjacentHTML('afterbegin', html);

        const hint = document.getElementById('uiStyleHint');
        const refresh = () => {
            const style = currentStyle();
            panel.querySelectorAll('input[name="uiStyle"]').forEach((r) => { r.checked = r.value === style; });
            hint.textContent = style === 'modern'
                ? 'Cinematic layout with ambient artwork. Applies instantly.'
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
        refresh();
    }

    // ---- Right-click menu (Modern): in-app popover instead of the native OS menu ------
    // It replays the same events the native menu sends, so renderer.js handles the actions as before.
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch (_) { /* no Node access: keep the native menu */ }

    const CTX_CHANNELS = {
        play: 'context-menu-play',
        'toggle-fav': 'context-menu-fav',
        rename: 'context-menu-rename',
        'open-customize': 'context-menu-customize',
        'open-file-location': 'context-menu-open-location',
        'change-path': 'context-menu-change-path',
        remove: 'context-menu-remove',
    };
    let ctx = null; // { el, card, abort }

    function closeCtx() {
        if (!ctx) return;
        ctx.abort.abort();
        ctx.el.remove();
        if (ctx.card) ctx.card.classList.remove('ctx-target');
        ctx = null;
    }

    function openCtx(id, x, y, card) {
        if (typeof gameData === 'undefined' || !gameData[id]) return false;
        closeCtx();
        const game = gameData[id];

        const el = document.createElement('div');
        el.className = 'ctx-menu';
        el.setAttribute('role', 'menu');
        el.innerHTML = `
            <div class="ctx-head">
                <span class="ctx-thumb"></span>
                <span class="ctx-meta"><span class="ctx-title"></span><span class="ctx-sub"></span></span>
            </div>
            <button type="button" class="ctx-item primary" role="menuitem" data-action="play">Play</button>
            <div class="ctx-sep"></div>
            <button type="button" class="ctx-item" role="menuitem" data-action="toggle-fav"></button>
            <button type="button" class="ctx-item" role="menuitem" data-action="rename">Rename</button>
            <button type="button" class="ctx-item" role="menuitem" data-action="open-customize">Customize artwork</button>
            <div class="ctx-sep"></div>
            <button type="button" class="ctx-item" role="menuitem" data-action="open-file-location">Open file location</button>
            <button type="button" class="ctx-item" role="menuitem" data-action="change-path">Change game path</button>
            <div class="ctx-sep"></div>
            <button type="button" class="ctx-item danger" role="menuitem" data-action="remove">Remove from library</button>`;

        el.querySelector('.ctx-title').textContent = game.name || '';
        const played = typeof formatLastPlayed === 'function' ? formatLastPlayed(game.lastPlayed) : '';
        el.querySelector('.ctx-sub').textContent = game.lastPlayed ? `Last played \u00b7 ${played}` : played;
        if (game.icon) {
            el.querySelector('.ctx-thumb').style.backgroundImage =
                `url("local-image://asset?path=${encodeURIComponent(game.icon)}")`;
        }
        el.querySelector('[data-action="toggle-fav"]').textContent =
            game.favorite ? 'Remove from favorites' : 'Add to favorites';

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
        ctx = { el, card, abort };
        if (card) card.classList.add('ctx-target');

        el.addEventListener('click', (e) => {
            const btn = e.target.closest('.ctx-item');
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'remove' && !btn.classList.contains('confirm')) {
                btn.classList.add('confirm');           // destructive: ask for a second click
                btn.textContent = 'Click again to remove';
                return;
            }
            closeCtx();
            if (ipc && CTX_CHANNELS[action]) ipc.emit(CTX_CHANNELS[action], {}, { id, ...game });
        }, { signal });

        window.addEventListener('mousedown', (e) => { if (!el.contains(e.target)) closeCtx(); }, { capture: true, signal });
        window.addEventListener('wheel', (e) => { if (!el.contains(e.target)) closeCtx(); }, { capture: true, passive: true, signal });
        window.addEventListener('blur', closeCtx, { signal });
        window.addEventListener('resize', closeCtx, { signal });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation(); // don't also exit full screen
                closeCtx();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const items = [...el.querySelectorAll('.ctx-item')];
                const i = items.indexOf(document.activeElement);
                const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
                items[next].focus();
            }
        }, { capture: true, signal });
        return true;
    }

    // Capture phase on window: runs before renderer.js's own contextmenu handler.
    window.addEventListener('contextmenu', (e) => {
        if (currentStyle() !== 'modern' || !ipc) return; // Classic keeps the native menu
        const card = e.target.closest ? e.target.closest('.game-card') : null;
        if (!card) { closeCtx(); return; }
        if (!openCtx(card.id, e.clientX, e.clientY, card)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    // ---- Artwork customiser: show which game is being edited -----------------------
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

    root.dataset.ui = readStyle();
    syncPlaceholder();
    buildSwitch();
})();
