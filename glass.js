/**
 * glass.js (renderer). Load AFTER renderer.js.
 * Wires the native window material (Liquid Glass / Acrylic) into the UI and themes.
 * If the main-process module isn't wired up, this does nothing and the launcher
 * keeps its previous CSS-only look.
 */
(() => {
    const ua = navigator.userAgent;
    const platform = /Mac/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'win' : 'other';
    document.body.classList.add('platform-' + platform);
    if (platform === 'other') return;

    function getBridge() {
        if (window.glassBridge) return window.glassBridge;           // contextIsolation + preload
        try {                                                          // nodeIntegration
            const { ipcRenderer } = require('electron');
            return {
                get: () => ipcRenderer.invoke('glass:get'),
                set: (p) => ipcRenderer.invoke('glass:set', p),
                onChange: (cb) => ipcRenderer.on('glass:changed', (_e, data) => cb(data)),
            };
        } catch (_) { return null; }
    }

    const bridge = getBridge();
    if (!bridge) return;

    const ACTIVE = ['liquid', 'vibrancy', 'acrylic', 'mica'];
    const STATUS = {
        liquid: 'Liquid Glass is active.',
        vibrancy: 'Using classic macOS blur (Liquid Glass needs macOS 26 or later).',
        acrylic: 'Acrylic is active.',
        mica: 'Mica is active.',
        off: 'Native material is off. The theme is drawn on a solid base.',
        unsupported: platform === 'win'
            ? 'Acrylic needs Windows 11 22H2 or later. Using the standard themed look.'
            : 'Native glass is not available here. Using the standard themed look.',
    };

    let info = null;

    function render() {
        const { settings, state, caps } = info;
        const body = document.body;
        const active = ACTIVE.includes(state);
        // Unsupported systems get neither class, so the original CSS look is untouched.
        body.classList.toggle('native-glass', active);
        body.classList.toggle('native-glass-off', state === 'off');
        body.classList.toggle('glass-liquid', state === 'liquid');
        body.classList.toggle('glass-acrylic', state === 'acrylic' || state === 'mica');
        document.documentElement.style.setProperty('--glass-strength', String(settings.strength / 100));

        const el = (id) => document.getElementById(id);
        if (!el('glassSection')) return;
        el('glassMode').value = settings.mode;
        el('glassStrength').value = settings.strength;
        el('glassStrengthValue').textContent = settings.strength + '%';
        if (el('glassMaterial')) el('glassMaterial').value = settings.material;
        el('glassStatus').textContent = STATUS[state] || '';
        el('glassSection').classList.toggle('is-unsupported', !caps.supported);
    }

    function buildPanel() {
        const host = document.getElementById('settingsAppearance');
        if (!host || document.getElementById('glassSection')) return;
        const name = platform === 'mac'
            ? (info.caps.kind === 'liquid' ? 'Liquid Glass' : 'macOS blur')
            : 'Acrylic';
        const autoLabel = platform === 'win' ? 'Automatic (follow theme)' : 'Automatic (on)';
        host.insertAdjacentHTML('beforeend', `
            <div class="settings-group" id="glassSection">
                <p class="settings-group-label">Window material</p>
                <label class="settings-field-label" for="glassMode">Native ${name}</label>
                <select class="settings-text-input" id="glassMode">
                    <option value="auto">${autoLabel}</option>
                    <option value="on">Always on</option>
                    <option value="off">Off</option>
                </select>
                <div class="settings-scale-control">
                    <label for="glassStrength"><span>Theme tint</span><output id="glassStrengthValue">60%</output></label>
                    <input type="range" id="glassStrength" min="0" max="100" step="5">
                    <p>Lower shows more of the glass. Higher lets your theme colour dominate.</p>
                </div>
                ${platform === 'win' ? `
                <div style="margin-top:12px">
                    <label class="settings-field-label" for="glassMaterial">Windows material</label>
                    <select class="settings-text-input" id="glassMaterial">
                        <option value="acrylic">Acrylic (frosted, shows desktop)</option>
                        <option value="mica">Mica (subtle, wallpaper tinted)</option>
                    </select>
                </div>` : ''}
                <p class="glass-status" id="glassStatus"></p>
            </div>`);

        const el = (id) => document.getElementById(id);
        let timer = null;
        const push = (patch) => {
            // Reflect instantly, then persist and apply natively.
            Object.assign(info.settings, patch);
            render();
            clearTimeout(timer);
            timer = setTimeout(async () => { info = await bridge.set(patch); render(); }, 120);
        };
        el('glassMode').addEventListener('change', (e) => push({ mode: e.target.value }));
        el('glassStrength').addEventListener('input', (e) => push({ strength: Number(e.target.value) }));
        if (el('glassMaterial')) el('glassMaterial').addEventListener('change', (e) => push({ material: e.target.value }));
    }

    (async () => {
        try {
            info = await bridge.get();
            buildPanel();
            render();
            // Theme switches (via the existing 'set-window-material' request) update the UI live.
            if (bridge.onChange) bridge.onChange((next) => { info = next; render(); });
        } catch (err) {
            console.warn('[glass] bridge unavailable:', err);
        }
    })();
})();
