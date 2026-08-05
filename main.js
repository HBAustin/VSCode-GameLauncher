const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { pathToFileURL } = require('url');
const THEMES = require('./themes/default-themes.js');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

app.commandLine.appendSwitch('enable-high-dpi-support', 'true');
let win, pickerWin;

function createWindow() {
    app.setAppUserModelId('com.hb.launcher.v1');
    win = new BrowserWindow({
        width: 1200, height: 850, minWidth: 800, minHeight: 600,
        backgroundColor: '#0f0f0f',
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });
    win.loadFile('index.html');
    win.on('closed', () => { win = null; });
    win.on('enter-full-screen', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('fullscreen-changed', true);
        }
    });
    win.on('leave-full-screen', () => {
        if (win && !win.isDestroyed()) {
            win.webContents.send('fullscreen-changed', false);
        }
    });
    createApplicationMenu();
}

function createApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forcereload' },
                { type: 'separator' },
                { role: 'toggledevtools' },
                { type: 'separator' },
                { role: 'resetzoom' },
                { role: 'zoomin' },
                { role: 'zoomout' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
        }
    } catch (err) {
        console.error('Failed to read settings:', err);
    }
    return {};
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('Failed to write settings:', err);
        return false;
    }
}

async function fetchSteamGridArtwork(gameName, apiKey, gameId) {
    const results = { cover: '', background: '', logo: '', icon: '' };
    if (!apiKey) return results;

    const headers = { Authorization: `Bearer ${apiKey}` };

    try {
        const searchRes = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        if (!searchRes.data.success || !searchRes.data.data.length) return results;

        const sgGameId = searchRes.data.data[0].id;
        const docsPath = app.getPath('documents');

        const downloadAsset = async (endpoint, folderName, ext) => {
            try {
                const res = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgGameId}`, { headers });
                if (res.data.success && res.data.data.length > 0) {
                    const imgUrl = res.data.data[0].url;
                    const folder = path.join(docsPath, folderName);
                    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

                    const localPath = path.join(folder, `${gameId}${ext}`);
                    const response = await axios({ url: imgUrl, responseType: 'arraybuffer' });
                    fs.writeFileSync(localPath, Buffer.from(response.data));
                    return localPath;
                }
            } catch (err) {
                console.error(`Failed to fetch ${endpoint} from SteamGridDB:`, err.message);
            }
            return '';
        };

        results.cover = await downloadAsset('grids', 'HB-Launcher-Covers', '.jpg');
        results.background = await downloadAsset('heroes', 'HB-Launcher-Backgrounds', '.jpg');
        results.logo = await downloadAsset('logos', 'HB-Launcher-Logos', '.png');
        results.icon = await downloadAsset('icons', 'HB-Launcher-Icons', '.png');
    } catch (err) {
        console.error('SteamGridDB Search Error:', err.message);
    }

    return results;
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

ipcMain.on('toggle-fullscreen', (event) => {
    if (!win || win.isDestroyed()) return;
    const targetFullScreen = !win.isFullScreen();
    win.setFullScreen(targetFullScreen);
    event.sender.send('fullscreen-changed', targetFullScreen);
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
ipcMain.on('open-logo-picker', (event, data) => openPickerWindow(data, 'logo'));

ipcMain.on('apply-asset', async (event, { gameId, imageUrl, imagePath, type, oldPath }) => {
    try {
        const folderMap = { cover: 'HB-Launcher-Covers', icon: 'HB-Launcher-Icons', background: 'HB-Launcher-Backgrounds', logo: 'HB-Launcher-Logos' };
        const folderName = folderMap[type] || 'HB-Launcher-Assets';
        const folder = path.join(app.getPath('documents'), folderName);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        if (oldPath && fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error("Could not drop old asset image:", e); }
        }

        let localPath = '';
        const ext = (type === 'icon' || type === 'logo') ? '.png' : '.jpg';
        localPath = path.join(folder, `${gameId}${ext}`);

        if (imagePath && fs.existsSync(imagePath)) {
            fs.copyFileSync(imagePath, localPath);
        } else if (imageUrl) {
            const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
            fs.writeFileSync(localPath, Buffer.from(res.data));
        } else {
            throw new Error('No asset source provided');
        }
        
        const channelMap = { cover: 'cover-updated', icon: 'icon-updated', background: 'bg-updated', logo: 'logo-updated' };
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

ipcMain.handle('get-settings', async (event) => {
    return loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
    const success = saveSettings(settings);
    if (success && win && !win.isDestroyed()) {
        win.webContents.send('settings-updated', settings);
    }
    return { success };
});

ipcMain.handle('get-theme-preset', async (event, themeName) => {
    return THEMES[themeName] || THEMES.dark;
});

ipcMain.handle('get-all-themes', async (event) => {
    return Object.entries(THEMES).map(([key, theme]) => ({
        id: key,
        name: theme.name,
        preview: {
            colors: theme.colors,
            fonts: theme.fonts
        }
    }));
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
        const nativeImg = await app.getFileIcon(filePath, { size: 'normal' });
        return nativeImg.toDataURL();
    } catch (err) { return null; }
});

ipcMain.handle('select-asset-image', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
});

ipcMain.on('add-game-requested', async (event) => {
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
    let logoPath = '';
    let bgPath = '';

    const settings = loadSettings();
    if (settings.steamGridApiKey) {
        const fetchedAssets = await fetchSteamGridArtwork(fileName, settings.steamGridApiKey, gameId);
        coverPath = fetchedAssets.cover || '';
        bgPath = fetchedAssets.background || '';
        logoPath = fetchedAssets.logo || '';
        iconPath = fetchedAssets.icon || '';
    }

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
        logo: logoPath,
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