const { ipcRenderer } = require('electron');

const hud = document.querySelector('.hud');
const fps = document.getElementById('fps');
const status = document.getElementById('status');

ipcRenderer.on('fps-overlay-update', (event, update) => {
    if (update.error) {
        fps.textContent = '--';
        status.textContent = update.error;
        hud.className = 'hud error';
        return;
    }

    if (Number.isFinite(update.fps)) {
        fps.textContent = String(Math.round(update.fps));
        status.textContent = 'FPS';
        hud.className = 'hud';
    } else {
        fps.textContent = '--';
        status.textContent = update.status || 'WAITING FOR FRAMES';
        hud.className = 'hud waiting';
    }
});
