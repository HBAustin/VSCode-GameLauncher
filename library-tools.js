/* HB Launcher: Add-game chooser, "Find installed games" dialog and per-game Launch options (interface)
   ---------------------------------------------------------------------------------------------------
   Loaded after ui.js. Builds its own dialogs, styled from the active theme, so index.html needs only the
   <script> tag. Works with importer-main.js (scan / import) and the launch handler in main.js. */
(function () {
    const { ipcRenderer } = require('electron');
    const isWin = process.platform === 'win32';

    /* ------------------------------------------------------------------ styles */
    const css = document.createElement('style');
    css.textContent = `
    .hb-pop { position: fixed; z-index: 3000; min-width: 230px; padding: 6px; border-radius: var(--r-1, 14px);
        background: color-mix(in srgb, var(--m-surface, #17171a) 94%, #000); color: var(--text);
        border: 1px solid var(--stroke-strong); box-shadow: 0 18px 50px rgba(0,0,0,.5);
        animation: hb-in .16s var(--ease, ease); -webkit-app-region: no-drag; }
    .hb-pop button { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 10px 12px;
        border: 0; border-radius: var(--r-2, 10px); background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
    .hb-pop button:hover, .hb-pop button:focus-visible { background: color-mix(in srgb, var(--accent) 16%, transparent); }
    .hb-pop b { font-size: .88rem; font-weight: 650; }
    .hb-pop small { color: var(--muted); font-size: .76rem; }

    .hb-dialog { position: fixed; inset: 0; z-index: 3100; display: none; align-items: center; justify-content: center;
        background: rgba(0,0,0,.5); -webkit-app-region: no-drag; }
    .hb-dialog.open { display: flex; }
    .hb-card { width: min(92vw, 560px); max-height: min(86vh, 640px); display: flex; flex-direction: column; gap: 14px; padding: 22px 24px;
        border-radius: var(--r-1, 16px); color: var(--text); text-align: left;
        background: color-mix(in srgb, var(--m-surface, #17171a) 96%, #000); border: 1px solid var(--stroke-strong);
        box-shadow: 0 30px 80px rgba(0,0,0,.6); animation: hb-in .2s var(--ease, ease); }
    .hb-card h2 { margin: 0; font-size: 1.25rem; font-weight: 780; letter-spacing: -.02em; }
    .hb-card p { margin: 0; color: var(--muted); font-size: .86rem; line-height: 1.45; }
    .hb-foot { display: flex; align-items: center; gap: 10px; padding-top: 4px; }
    .hb-foot .spacer { flex: 1; }
    .hb-btn { height: 38px; padding: 0 18px; border-radius: var(--r-3, 10px); border: 1px solid var(--stroke); background: var(--surface-raised);
        color: var(--text); font: inherit; font-weight: 650; font-size: .88rem; cursor: pointer; }
    .hb-btn:hover { background: rgba(255,255,255,.14); }
    .hb-btn.primary { background: var(--accent); color: var(--accent-contrast); border-color: transparent; font-weight: 750; }
    .hb-btn.primary:hover { filter: brightness(1.08); background: var(--accent); }
    .hb-btn:disabled { opacity: .45; cursor: default; filter: none; }
    @keyframes hb-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }

    .hb-list { flex: 1 1 auto; min-height: 120px; overflow-y: auto; margin: 0 -8px; padding: 2px 8px; display: flex; flex-direction: column; gap: 2px; }
    .hb-row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: var(--r-2, 10px); cursor: pointer; }
    .hb-row:hover { background: var(--surface-raised); }
    .hb-row input { accent-color: var(--accent); width: 17px; height: 17px; flex: none; cursor: pointer; }
    .hb-row .nm { flex: 1; min-width: 0; font-size: .9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hb-tag { flex: none; padding: 2px 8px; border-radius: 999px; font-size: .68rem; font-weight: 750; letter-spacing: .06em; text-transform: uppercase;
        color: var(--muted); border: 1px solid var(--stroke); }
    .hb-empty { padding: 36px 12px; text-align: center; color: var(--muted); font-size: .9rem; }
    .hb-bar { height: 6px; border-radius: 6px; background: var(--surface-raised); overflow: hidden; }
    .hb-bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .25s var(--ease, ease); }
    .hb-link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: .82rem; font-weight: 650; cursor: pointer; }

    .hb-field { display: flex; flex-direction: column; gap: 6px; }
    .hb-field > label, .hb-label { font-size: .84rem; font-weight: 650; }
    .hb-input { box-sizing: border-box; width: 100%; height: 40px; padding: 0 14px; border-radius: var(--r-3, 10px); border: 1px solid var(--stroke); background: rgba(0,0,0,.28);
        color: var(--text); font: inherit; font-size: .92rem; }
    .hb-input:focus { border-color: var(--accent); box-shadow: var(--ring); }
    .hb-check { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-2, 10px); background: var(--surface);
        border: 1px solid var(--stroke); cursor: pointer; font-size: .9rem; font-weight: 600; }
    .hb-check input { accent-color: var(--accent); width: 17px; height: 17px; flex: none; }
    .hb-check small { display: block; color: var(--muted); font-weight: 500; font-size: .76rem; margin-top: 2px; }
    .hb-note { font-size: .78rem; color: var(--muted); }
    `;
    document.head.appendChild(css);

    /* ------------------------------------------------------------------ tiny DOM helper */
    function el(tag, props = {}, ...kids) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
        }
        kids.flat().forEach(c => n.append(c));
        return n;
    }
    function dialog(card) {
        const wrap = el('div', { class: 'hb-dialog' }, card);
        wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && wrap._dismiss) wrap._dismiss(); });
        document.body.appendChild(wrap);
        return wrap;
    }
    const open = (d) => d.classList.add('open');
    const close = (d) => d.classList.remove('open');
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const d = [...document.querySelectorAll('.hb-dialog.open')].pop();
        if (d) { e.stopPropagation(); (d._dismiss || (() => close(d)))(); }
        else closePop();
    }, true);

    /* ------------------------------------------------------------------ Add game chooser */
    let pop = null;
    function closePop() { if (pop) { pop.remove(); pop = null; } }
    document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('#addBtn')) closePop(); }, true);

    function showAddChooser(anchor) {
        closePop();
        const item = (title, sub, run) => el('button', { type: 'button', onclick: () => { closePop(); run(); } },
            el('b', { text: title }), el('small', { text: sub }));
        pop = el('div', { class: 'hb-pop', role: 'menu' },
            item('Find installed games', 'Steam, Epic Games and GOG', openImport),
            item('Browse for a file…', 'Pick an app, shortcut or script', () => ipcRenderer.send('add-game-requested')));
        document.body.appendChild(pop);
        const r = anchor.getBoundingClientRect(), p = pop.getBoundingClientRect();
        const spaceBelow = window.innerHeight - r.bottom;
        pop.style.top = (spaceBelow > p.height + 16 ? r.bottom + 8 : Math.max(8, r.top - p.height - 8)) + 'px';
        pop.style.left = Math.max(8, Math.min(r.right - p.width, window.innerWidth - p.width - 8)) + 'px';
    }

    // Capture phase on the document: runs before the button's own handler in renderer.js, which we replace.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('#addBtn');
        if (!btn) return;
        e.stopPropagation(); e.preventDefault();
        if (pop) closePop(); else showAddChooser(btn);
    }, true);

    /* ------------------------------------------------------------------ Find installed games */
    let importDlg = null, importUI = null, found = [], importing = false;

    function buildImport() {
        const status = el('p', { text: '' });
        const list = el('div', { class: 'hb-list' });
        const bar = el('div', { class: 'hb-bar', hidden: '' }, el('i'));
        const selAll = el('button', { class: 'hb-link', type: 'button', text: 'Select all' });
        const selNone = el('button', { class: 'hb-link', type: 'button', text: 'None' });
        const cancel = el('button', { class: 'hb-btn', type: 'button', text: 'Close' });
        const add = el('button', { class: 'hb-btn primary', type: 'button', text: 'Add games', disabled: '' });
        const card = el('div', { class: 'hb-card', role: 'dialog', 'aria-label': 'Find installed games' },
            el('h2', { text: 'Find installed games' }),
            status, list, bar,
            el('div', { class: 'hb-foot' }, selAll, selNone, el('span', { class: 'spacer' }), cancel, add));
        importDlg = dialog(card);
        importDlg._dismiss = () => { if (!importing) close(importDlg); };
        cancel.onclick = importDlg._dismiss;
        importUI = { status, list, bar, selAll, selNone, add, cancel };

        const boxes = () => [...list.querySelectorAll('input[type=checkbox]')];
        const refresh = () => {
            const n = boxes().filter(b => b.checked).length;
            add.disabled = importing || n === 0;
            add.textContent = n ? `Add ${n} game${n === 1 ? '' : 's'}` : 'Add games';
        };
        list.addEventListener('change', refresh);
        selAll.onclick = () => { boxes().forEach(b => b.checked = true); refresh(); };
        selNone.onclick = () => { boxes().forEach(b => b.checked = false); refresh(); };
        importUI.refresh = refresh;

        add.onclick = () => {
            const picked = boxes().filter(b => b.checked).map(b => found[Number(b.dataset.i)]);
            if (!picked.length) return;
            importing = true;
            bar.hidden = false; bar.firstChild.style.width = '0%';
            status.textContent = 'Adding games and fetching artwork…';
            [selAll, selNone, add, cancel].forEach(b => b.disabled = true);
            list.style.opacity = '.5'; list.style.pointerEvents = 'none';
            ipcRenderer.send('import-games', picked);
        };
    }

    async function openImport() {
        if (!importDlg) buildImport();
        const { status, list, bar, selAll, selNone, add, cancel } = importUI;
        importing = false;
        bar.hidden = true; list.style.opacity = ''; list.style.pointerEvents = '';
        cancel.disabled = false; selAll.disabled = selNone.disabled = false;
        list.replaceChildren(el('div', { class: 'hb-empty', text: 'Looking for installed games…' }));
        status.textContent = 'Games that are already in your library are left out.';
        add.disabled = true; add.textContent = 'Add games';
        open(importDlg);

        const existing = Object.values(typeof gameData === 'object' ? gameData : {}).flatMap(g => [g.path, g.folder]).filter(Boolean);
        const res = await ipcRenderer.invoke('scan-installed-games', existing);
        found = (res && res.games) || [];
        if (!found.length) {
            list.replaceChildren(el('div', { class: 'hb-empty', text: res && res.success === false
                ? 'The scan failed: ' + res.error
                : 'No new games found. Games already in your library are skipped, and the Steam, Epic or GOG launcher must be installed.' }));
            return;
        }
        status.textContent = `${found.length} game${found.length === 1 ? '' : 's'} found. Pick the ones to add.`;
        list.replaceChildren(...found.map((g, i) => el('label', { class: 'hb-row' },
            el('input', { type: 'checkbox', 'data-i': String(i), checked: '' }),
            el('span', { class: 'nm', text: g.name, title: g.name }),
            el('span', { class: 'hb-tag', text: g.store }))));
        importUI.refresh();
    }

    ipcRenderer.on('import-progress', (event, { done, total, name, finished }) => {
        if (!importUI) return;
        importUI.bar.firstChild.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
        if (finished) {
            importing = false;
            importUI.status.textContent = `Added ${total} game${total === 1 ? '' : 's'}.`;
            setTimeout(() => close(importDlg), 700);
        } else if (name) {
            importUI.status.textContent = `Adding ${name} (${done + 1} of ${total})…`;
        }
    });

    /* ------------------------------------------------------------------ Launch options */
    let optDlg = null, optUI = null, optId = null;

    function buildOptions() {
        const args = el('input', { class: 'hb-input', type: 'text', placeholder: 'e.g. -windowed -novid', autocomplete: 'off', spellcheck: 'false' });
        const argsNote = el('span', { class: 'hb-note' });
        const delay = el('input', { class: 'hb-input', type: 'number', min: '0', max: '300', step: '1', value: '0' });
        const admin = el('input', { type: 'checkbox' });
        const minimize = el('input', { type: 'checkbox' });
        const title = el('h2', { text: 'Launch options' });
        const sub = el('p');
        const save = el('button', { class: 'hb-btn primary', type: 'button', text: 'Save' });
        const reset = el('button', { class: 'hb-link', type: 'button', text: 'Reset to defaults' });
        const cancel = el('button', { class: 'hb-btn', type: 'button', text: 'Cancel' });
        const adminRow = el('label', { class: 'hb-check' }, admin,
            el('span', {}, 'Run as administrator', el('small', { text: 'Windows asks for permission each time the game starts.' })));
        if (!isWin) adminRow.hidden = true;

        const card = el('div', { class: 'hb-card', role: 'dialog', 'aria-label': 'Launch options' },
            title, sub,
            el('div', { class: 'hb-field' }, el('label', { text: 'Launch arguments' }), args, argsNote),
            el('div', { class: 'hb-field' }, el('label', { text: 'Wait before starting (seconds)' }), delay),
            adminRow,
            el('label', { class: 'hb-check' }, minimize,
                el('span', {}, 'Minimise the launcher when the game starts')),
            el('div', { class: 'hb-foot' }, reset, el('span', { class: 'spacer' }), cancel, save));
        optDlg = dialog(card);
        optDlg._dismiss = () => close(optDlg);
        cancel.onclick = optDlg._dismiss;
        optUI = { args, argsNote, delay, admin, minimize, title, sub, save, reset };

        const fill = (o) => {
            args.value = o.args || ''; delay.value = o.delay || 0;
            admin.checked = !!o.admin; minimize.checked = !!o.minimize;
        };
        optUI.fill = fill;
        reset.onclick = () => fill({});
        save.onclick = () => {
            const g = typeof gameData === 'object' ? gameData[optId] : null;
            if (!g) { close(optDlg); return; }
            const o = {
                args: args.value.trim(),
                delay: Math.max(0, Math.min(300, Math.round(Number(delay.value) || 0))),
                admin: isWin && admin.checked,
                minimize: minimize.checked
            };
            if (o.args || o.delay || o.admin || o.minimize) g.launch = o; else delete g.launch;
            saveToDisk();
            close(optDlg);
        };
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') save.click(); });
    }

    function argsHint(path) {
        const p = String(path || '');
        if (/^steam:\/\//i.test(p)) return 'Sent to the game through Steam.';
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(p)) return 'Arguments are not supported for games started through their store launcher; the other options still apply.';
        if (/\.(lnk|url)$/i.test(p)) return 'Arguments are ignored for shortcuts. Point the game at the program itself to use them.';
        return 'Passed to the game when it starts.';
    }

    window.hbLaunchOptions = function (id) {
        const g = typeof gameData === 'object' ? gameData[id] : null;
        if (!g) return;
        if (!optDlg) buildOptions();
        optId = id;
        optUI.sub.textContent = g.name;
        optUI.argsNote.textContent = argsHint(g.path);
        optUI.fill(g.launch || {});
        open(optDlg);
        setTimeout(() => optUI.args.focus(), 30);
    };

    /* Detail page: a button next to Browse Files / Change Path */
    const actions = document.querySelector('.dp-management-actions');
    if (actions && !document.getElementById('dashBtnLaunchOpts')) {
        const b = el('button', { class: 'dash-btn play-themed-btn', id: 'dashBtnLaunchOpts', type: 'button',
            title: 'Launch options', 'aria-label': 'Launch options' });
        b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
            + '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>';
        b.onclick = () => { if (typeof selectedListId !== 'undefined' && selectedListId) window.hbLaunchOptions(selectedListId); };
        actions.prepend(b);
    }
})();
