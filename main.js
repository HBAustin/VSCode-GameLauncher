const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { pathToFileURL } = require('url');

app.commandLine.appendSwitch('enable-high-dpi-support', 'true');

protocol.registerSchemesAsPrivileged([
    { scheme: 'local-image', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const SGDB_KEY = '3c4442286b22830d7e350c5559c2d679'; 
let win, pickerWin;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

function createWindow() {
    app.setAppUserModelId('com.hb.launcher.v1');
    win = new BrowserWindow({
        width: 1200, height: 850, minWidth: 800, minHeight: 600,
        backgroundColor: '#0f0f0f',
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });
    win.loadFile('index.html');
    win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
    protocol.handle('local-image', async (request) => {
        try {
            const urlObj = new URL(request.url);
            const filePath = urlObj.searchParams.get('path');
            if (filePath) {
                return net.fetch(pathToFileURL(filePath).href);
            }
            return new Response('Not Found', { status: 404 });
        } catch (err) {
            console.error("Protocol handler error:", err);
            return new Response('Not Found', { status: 404 });
        }
    });
    createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

ipcMain.on('launch-game-process', async (event, { id, executablePath }) => {
    if (!executablePath || !fs.existsSync(executablePath)) return;
    try {
        await shell.openPath(executablePath);
        event.reply('game-started', { id });
    } catch (err) {
        console.error("Failed to launch game:", err);
    }
});

// NATIVE CONTEXT MENU (For Mouse)
ipcMain.on('show-game-context-menu', (event, gameData) => {
    const template = [
        { label: `Play ${gameData.name}`, click: () => { event.sender.send('context-menu-play', gameData); } },
        { type: 'separator' },
        { label: gameData.favorite ? 'Unfavorite' : 'Favorite', click: () => { event.sender.send('context-menu-fav', gameData); } },
        { label: 'Rename Game', click: () => { event.sender.send('context-menu-rename', gameData); } },
        { label: 'Customize Artwork...', click: () => { event.sender.send('context-menu-customize', gameData); } },
        { type: 'separator' },
        { label: 'Open File Location', click: () => { event.sender.send('context-menu-open-location', gameData); } },
        { label: 'Change Game Path', click: () => { event.sender.send('context-menu-change-path', gameData); } },
        { type: 'separator' },
        { label: 'Remove from Library', click: () => { event.sender.send('context-menu-remove', gameData); } }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function openPickerWindow(gameData, type) {
    if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.focus(); return; }
    pickerWin = new BrowserWindow({
        width: 800, height: 900, parent: win, modal: true, backgroundColor: '#1a1a1a',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    pickerWin.loadFile('picker.html');
    pickerWin.once('ready-to-show', () => { 
        pickerWin.webContents.send('init-picker', { ...gameData, type }); 
    });
}

ipcMain.on('open-picker', (event, data) => openPickerWindow(data, 'cover'));
ipcMain.on('open-icon-picker', (event, data) => openPickerWindow(data, 'icon'));
ipcMain.on('open-bg-picker', (event, data) => openPickerWindow(data, 'background'));

// FIXED: Receives and deletes old asset before writing the new one
ipcMain.on('apply-asset', async (event, { gameId, imageUrl, type, oldPath }) => {
    try {
        const folderMap = { cover: 'HB-Launcher-Covers', icon: 'HB-Launcher-Icons', background: 'HB-Launcher-Backgrounds' };
        const folderName = folderMap[type] || 'HB-Launcher-Assets';
        const folder = path.join(app.getPath('documents'), folderName);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        // Delete old asset if it exists
        if (oldPath && fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error("Could not delete old asset:", e); }
        }

        const localPath = path.join(folder, `${gameId}.jpg`);
        const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, Buffer.from(res.data));
        
        const channelMap = { cover: 'cover-updated', icon: 'icon-updated', background: 'bg-updated' };
        const replyChannel = channelMap[type] || 'cover-updated';
        
        if (win) win.webContents.send(replyChannel, { id: gameId, path: localPath });
        if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    } catch (err) { console.error("Asset apply error:", err); }
});

// ADDED: Cleans up all orphaned image files when a game is removed
ipcMain.on('delete-game-assets', (event, assetPaths) => {
    assetPaths.forEach(assetPath => {
        if (assetPath && fs.existsSync(assetPath)) {
            try { fs.unlinkSync(assetPath); } catch(e) { console.error("Could not delete asset:", e); }
        }
    });
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
        const nativeImg = await app.getFileIcon(filePath, { size: 'normal' });
        return nativeImg.toDataURL();
    } catch (err) { return null; }
});

ipcMain.handle('search-sgdb', async (e, query) => {
    try {
        const res = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`, { headers: { 'Authorization': `Bearer ${SGDB_KEY}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.handle('get-sgdb-assets', async (e, { id, type }) => {
    try {
        let endpoint = 'grids';
        if (type === 'icon') endpoint = 'icons';
        if (type === 'background') endpoint = 'heroes';

        const res = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${id}`, { headers: { 'Authorization': `Bearer ${SGDB_KEY}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { 
        return []; 
    }
});

ipcMain.on('add-game-requested', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] }]
    });
    if (!canceled && filePaths.length > 0) event.sender.send('add-game-confirmed', filePaths[0]);
});

ipcMain.handle('select-game', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ 
        properties: ['openFile'], 
        filters: [{ name: 'Games & Shortcuts', extensions: ['exe', 'url', 'lnk'] }] 
    });
    return canceled ? null : filePaths[0];
});

ipcMain.on('open-file-location', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });