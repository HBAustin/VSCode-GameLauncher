/* HB Launcher: custom window buttons (Windows)
   ---------------------------------------------------------------------------------------------
   Replaces the native minimise / maximise / close buttons with our own, set in a row with the Full Screen
   button. They are ordinary page elements, so everything about them can be changed in the EDIT HERE block
   below. Does nothing on macOS (keeps the traffic lights) or Linux.

   Needs: the main window created with  titleBarOverlay: false  (see main.js), and the 'win-control' /
   'win-state' handlers that importer-main.js registers. */
(function () {
    if (process.platform !== 'win32') return;
    const { ipcRenderer } = require('electron');
    const root = document.documentElement;
    const header = document.getElementById('appHeader');
    const fsBtn = document.getElementById('fullScreenBtn');
    if (!header) return;

    // If the native buttons are still there (main.js not updated yet), don't add a second set.
    try { if (navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible) { console.warn('[titlebar] native window buttons are still on: set titleBarOverlay to false in main.js'); return; } } catch (e) {}

    /* ======================================================= EDIT HERE ======================================================= */
    const STYLE = `
        :root {
            --wc-btn-w: 34px;          /* button width */
            --wc-btn-h: 30px;          /* button height */
            --wc-radius: 8px;          /* corner radius: 0 = square, 15px = round */
            --wc-gap: 6px;             /* space between buttons */
            --wc-edge: 12px;           /* space between the buttons and the window edge */
            --wc-icon: 12px;           /* icon size */
            --wc-icon-weight: 1.3;     /* icon line thickness */
            --wc-bg: rgba(255,255,255,.06);
            --wc-bg-hover: rgba(255,255,255,.14);
            --wc-border: var(--stroke, rgba(255,255,255,.08));
            --wc-close-bg-hover: #e5383b;     /* close button hover colour */
            --wc-close-icon-hover: #ffffff;
        }`;
    // Which buttons to show, in order, left to right. Remove one to hide it.
    const ORDER = ['fullscreen', 'minimize', 'maximize', 'close'];
    /* ========================================================================================================================== */

    const ICONS = {
        minimize: '<path d="M2 6h8"/>',
        maximize: '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6"/>',
        restore: '<rect x="2" y="3.8" width="6.2" height="6.2" rx="1.4"/><path d="M4 3.8V3a1.4 1.4 0 0 1 1.4-1.4H9A1.4 1.4 0 0 1 10.4 3v3.6A1.4 1.4 0 0 1 9 8H8.2"/>',
        close: '<path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/>'
    };
    const svg = (name) => `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="var(--wc-icon-weight)" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

    const style = document.createElement('style');
    style.textContent = STYLE + `
        #appHeader { -webkit-app-region: drag; }
        #appHeader button, #appHeader input, #appHeader select, #appHeader a, #appHeader [role="button"] { -webkit-app-region: no-drag; }

        #winControls {
            position: fixed; z-index: 60;
            top: var(--tb-center, 32px); right: var(--wc-edge); transform: translateY(-50%);
            display: flex; align-items: center; gap: var(--wc-gap);
            -webkit-app-region: no-drag;
        }
        /* our three buttons */
        #winControls button.wc-win {
            all: unset; box-sizing: border-box; cursor: default;
            display: inline-flex; align-items: center; justify-content: center;
            width: var(--wc-btn-w); height: var(--wc-btn-h);
            border-radius: var(--wc-radius); border: 1px solid var(--wc-border);
            background: var(--wc-bg); color: var(--header-text, var(--text, #fff));
            transition: background .12s ease, color .12s ease;
            -webkit-app-region: no-drag;
        }
        #winControls button.wc-win:hover { background: var(--wc-bg-hover); }
        #winControls button.wc-win:active { filter: brightness(.9); }
        #winControls button.wc-win:focus-visible { box-shadow: var(--ring, 0 0 0 3px rgba(255,255,255,.3)); }
        #winControls button.wc-close:hover { background: var(--wc-close-bg-hover); color: var(--wc-close-icon-hover); border-color: transparent; }
        #winControls svg { width: var(--wc-icon); height: var(--wc-icon); display: block; }
        /* the existing Full Screen button keeps its own icon; only its size and shape follow the settings above */
        #winControls #fullScreenBtn {
            position: static !important; transform: none !important; margin: 0 !important;
            width: var(--wc-btn-w); min-width: 0; height: var(--wc-btn-h); min-height: 0; padding: 0 !important;
            border-radius: var(--wc-radius); box-sizing: border-box; flex: none;
            display: inline-flex; align-items: center; justify-content: center;
        }
        /* keep the bar's own contents clear of the buttons */
        #appHeader { padding-right: calc(var(--wc-w, 170px) + 8px) !important; box-sizing: border-box; }
        /* Real full screen has no window buttons: only the Full Screen button stays, to get back out */
        html.is-fullscreen #winControls .wc-win { display: none; }`;
    document.head.appendChild(style);

    const group = document.createElement('div');
    group.id = 'winControls';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Window controls');
    const buttons = {};
    const mk = (cls, label, name, action) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wc-win ' + cls; b.title = label; b.setAttribute('aria-label', label);
        b.innerHTML = svg(name);
        b.addEventListener('click', () => ipcRenderer.send('win-control', action));
        return b;
    };
    buttons.minimize = mk('wc-min', 'Minimise', 'minimize', 'minimize');
    buttons.maximize = mk('wc-max', 'Maximise', 'maximize', 'maximize');
    buttons.close = mk('wc-close', 'Close', 'close', 'close');
    if (fsBtn) buttons.fullscreen = fsBtn;   // moving the node keeps its click handler and controller focus order
    ORDER.forEach((k) => { if (buttons[k]) group.appendChild(buttons[k]); });
    document.body.appendChild(group);

    function setState(s) {
        s = s || {};
        root.classList.toggle('is-maximized', !!s.maximized);
        root.classList.toggle('is-fullscreen', !!s.fullscreen);
        const max = buttons.maximize;
        max.innerHTML = svg(s.maximized ? 'restore' : 'maximize');
        max.title = s.maximized ? 'Restore' : 'Maximise';
        max.setAttribute('aria-label', max.title);
    }
    ipcRenderer.on('win-state-changed', (e, s) => setState(s));
    ipcRenderer.invoke('win-state').then(setState).catch(() => {});

    // Keep the buttons on the top bar's middle line, and keep the bar's contents clear of them
    function sync() {
        const b = header.getBoundingClientRect();
        root.style.setProperty('--tb-center', (b.top + b.height / 2) + 'px');
        root.style.setProperty('--wc-w', Math.ceil(group.getBoundingClientRect().width + parseFloat(getComputedStyle(group).right || 0)) + 'px');
    }
    new ResizeObserver(sync).observe(header);
    new ResizeObserver(sync).observe(group);
    window.addEventListener('resize', sync);
    sync();
    setTimeout(sync, 400);   // after fonts / layout settle
})();
