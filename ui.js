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

    root.dataset.ui = readStyle();
    syncPlaceholder();
    buildSwitch();
})();
