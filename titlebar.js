/* HB Launcher: Windows title bar fit
   Makes the native minimise / maximise / close buttons sit on the same line as the rest of the top bar,
   and keeps the header's content from sliding underneath them. Does nothing on macOS or Linux.
   Needs the 'titlebar-height' handler in main.js. */
(function () {
    if (process.platform !== 'win32') return;
    const { ipcRenderer } = require('electron');
    const root = document.documentElement;
    const header = document.getElementById('appHeader');
    if (!header) return;

    const style = document.createElement('style');
    style.textContent = `
        /* leave room for the native window buttons at the right edge of the top bar */
        #appHeader { padding-right: calc(var(--wco-w, 138px) + 8px) !important; box-sizing: border-box; }
        /* the top bar (not its buttons) drags the window */
        #appHeader { -webkit-app-region: drag; }
        #appHeader button, #appHeader input, #appHeader select, #appHeader a, #appHeader [role="button"] { -webkit-app-region: no-drag; }`;
    document.head.appendChild(style);

    let lastH = 0;
    function sync() {
        // width taken by the native buttons
        let w = 138;
        try {
            const r = navigator.windowControlsOverlay.getTitlebarAreaRect();
            if (r && r.width > 0) w = Math.max(0, window.innerWidth - (r.x + r.width)) || w;
        } catch (e) { /* use the default */ }
        root.style.setProperty('--wco-w', w + 'px');

        // make the native button strip as tall as the top bar, so the buttons are centred on its middle line
        const b = header.getBoundingClientRect();
        const h = Math.max(32, Math.round(b.top + b.bottom));   // bar plus its top margin mirrored below
        if (h && h !== lastH) { lastH = h; ipcRenderer.send('titlebar-height', h); }
    }

    new ResizeObserver(sync).observe(header);
    window.addEventListener('resize', sync);
    try { navigator.windowControlsOverlay.addEventListener('geometrychange', sync); } catch (e) {}
    sync();
    setTimeout(sync, 400);   // after fonts / layout settle
})();
