const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { pathToFileURL } = require('url');

app.commandLine.appendSwitch('enable-high-dpi-support', 'true');

protocol.registerSchemesAsPrivileged([
    { scheme: 'local-image', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

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

function createApplicationMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'SteamGridDB Settings...',
                    accelerator: 'CmdOrCtrl+Shift+P',
                    click: () => { if (win) win.webContents.send('trigger-api-key-prompt'); }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
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
    createApplicationMenu();
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
            console.error("Protocol error:", err);
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
        console.error("Failed to execute game instance:", err);
    }
});

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

function openPickerWindow(gameData, type, apiKey) {
    if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.focus(); return; }
    pickerWin = new BrowserWindow({
        width: 800, height: 900, parent: win, modal: true, backgroundColor: '#1a1a1a',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    pickerWin.loadFile('picker.html');
    pickerWin.once('ready-to-show', () => { 
        pickerWin.webContents.send('init-picker', { ...gameData, type, apiKey }); 
    });
}

ipcMain.on('open-picker', (event, data) => openPickerWindow(data, 'cover', data.apiKey));
ipcMain.on('open-icon-picker', (event, data) => openPickerWindow(data, 'icon', data.apiKey));
ipcMain.on('open-bg-picker', (event, data) => openPickerWindow(data, 'background', data.apiKey));

ipcMain.on('apply-asset', async (event, { gameId, imageUrl, type, oldPath }) => {
    try {
        const folderMap = { cover: 'HB-Launcher-Covers', icon: 'HB-Launcher-Icons', background: 'HB-Launcher-Backgrounds' };
        const folderName = folderMap[type] || 'HB-Launcher-Assets';
        const folder = path.join(app.getPath('documents'), folderName);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        if (oldPath && fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error("Could not drop old asset image:", e); }
        }

        const ext = type === 'icon' ? '.png' : '.jpg';
        const localPath = path.join(folder, `${gameId}${ext}`);
        const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, Buffer.from(res.data));
        
        const channelMap = { cover: 'cover-updated', icon: 'icon-updated', background: 'bg-updated' };
        const replyChannel = channelMap[type] || 'cover-updated';
        
        if (win) win.webContents.send(replyChannel, { id: gameId, path: localPath });
        if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    } catch (err) { console.error("Asset modification error:", err); }
});

ipcMain.on('delete-game-assets', (event, assetPaths) => {
    assetPaths.forEach(assetPath => {
        if (assetPath && fs.existsSync(assetPath)) {
            try { fs.unlinkSync(assetPath); } catch(e) { console.error("Error wiping asset index from drive:", e); }
        }
    });
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
        const nativeImg = await app.getFileIcon(filePath, { size: 'normal' });
        return nativeImg.toDataURL();
    } catch (err) { return null; }
});

ipcMain.handle('search-sgdb', async (e, { query, apiKey }) => {
    if (!apiKey) return [];
    try {
        const res = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.handle('get-sgdb-assets', async (e, { id, type, apiKey }) => {
    if (!apiKey) return [];
    try {
        let endpoint = 'grids';
        if (type === 'icon') endpoint = 'icons';
        if (type === 'background') endpoint = 'heroes';

        const res = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${id}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.on('add-game-requested', async (event, { apiKey }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] }]
    });
    if (canceled || filePaths.length === 0) return;

    const filePath = filePaths[0];
    const fileName = path.basename(filePath, path.extname(filePath));
    const gameId = 'game-' + Date.now();
    
    let coverPath = '';
    let iconPath = '';
    let bgPath = '';

    // Automatic SteamGridDB asset scraping loop
    if (apiKey) {
        try {
            const searchRes = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(fileName)}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            if (searchRes.data && searchRes.data.success && searchRes.data.data.length > 0) {
                const sgdbId = searchRes.data.data[0].id;
                const docsPath = app.getPath('documents');
                
                const fetchAndSaveAsset = async (endpoint, folderName, ext) => {
                    try {
                        const assetRes = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgdbId}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                        if (assetRes.data && assetRes.data.success && assetRes.data.data.length > 0) {
                            const targetUrl = assetRes.data.data[0].url;
                            const folder = path.join(docsPath, folderName);
                            if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
                            
                            const outPath = path.join(folder, `${gameId}${ext}`);
                            const dataBuffer = await axios({ url: targetUrl, responseType: 'arraybuffer' });
                            fs.writeFileSync(outPath, Buffer.from(dataBuffer.data));
                            return outPath;
                        }
                    } catch (e) { console.error(`Auto asset compilation failed for endpoint: ${endpoint}`, e); }
                    return '';
                };

                coverPath = await fetchAndSaveAsset('grids', 'HB-Launcher-Covers', '.jpg');
                bgPath = await fetchAndSaveAsset('heroes', 'HB-Launcher-Backgrounds', '.jpg');
                iconPath = await fetchAndSaveAsset('icons', 'HB-Launcher-Icons', '.png');
            }
        } catch (err) {
            console.error("Automated background network query rejected:", err);
        }
    }

    // Native environment application fallback icon collection 
    if (!iconPath) {
        try {
            const nativeImg = await app.getFileIcon(filePath, { size: 'normal' });
            const base64Data = nativeImg.toDataURL().replace(/^data:image\/png;base64,/, "");
            const docsPath = app.getPath('documents');
            const iconFolder = path.join(docsPath, 'HB-Launcher-Icons');
            if (!fs.existsSync(iconFolder)) fs.mkdirSync(iconFolder, { recursive: true });
            
            const p = path.join(iconFolder, `${gameId}.png`);
            fs.writeFileSync(p, Buffer.from(base64Data, 'base64'));
            iconPath = p;
        } catch(e) {
            console.error("Local executable binary shell icon collection failed:", e);
        }
    }

    event.sender.send('add-game-confirmed', {
        id: gameId,
        name: fileName,
        path: filePath,
        cover: coverPath,
        background: bgPath,
        icon: iconPath
    });
});

ipcMain.handle('select-game', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ 
        properties: ['openFile'], 
        filters: [{ name: 'Games & Shortcuts', extensions: ['exe', 'url', 'lnk'] }] 
    });
    return canceled ? null : filePaths[0];
});

ipcMain.on('open-file-location', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });