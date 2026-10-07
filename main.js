const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const { pathToFileURL } = require('url');
const THEMES = require('./themes/default-themes.js');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

app.commandLine.appendSwitch('enable-high-dpi-support', 'true');
let win, pickerWin;

function createWindow() {
    app.setAppUserModelId('com.hb.launcher.v1');

    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    win = new BrowserWindow({
        width: 1200, height: 850, minWidth: 800, minHeight: 600,
        frame: true,
        
        // --- Cross-Platform Modern Titlebar & Glass Styling ---
        titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
        titleBarOverlay: isWin ? {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 38
        } : false,
        trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
        
        // --- Translucency & Vibrancy ---
        vibrancy: isMac ? 'under-window' : undefined,
        visualEffectState: isMac ? 'active' : undefined,
        backgroundColor: '#00000000', // Fully transparent background required for glass effects
        
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    });

    // Apply Windows 11 Acrylic Background Material
    if (isWin && typeof win.setBackgroundMaterial === 'function') {
        try {
            win.setBackgroundMaterial('acrylic');
        } catch (err) {
            console.error('Failed to apply Windows Acrylic material:', err);
        }
    }

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
                    const folder = path.join(docsPath, 'HB-Launcher', folderName);
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

        results.cover = await downloadAsset('grids', 'Covers', '.jpg');
        results.background = await downloadAsset('heroes', 'Backgrounds', '.jpg');
        results.logo = await downloadAsset('logos', 'Logos', '.png');
        results.icon = await downloadAsset('icons', 'Icons', '.png');
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
    if (!executablePath) return;
    try {
        const isUri = /^[a-z][a-z\d+.-]*:\/\//i.test(executablePath);
        const extension = path.extname(executablePath).toLowerCase();
        const isMac = process.platform === 'darwin';
        const isAppBundle = isMac && extension === '.app';
        const usesWindowsLauncher = process.platform === 'win32' && (isUri || extension === '.lnk' || extension === '.url');

        const child = isAppBundle
            ? spawn('open', [executablePath], { detached: true, stdio: 'ignore' })
            : usesWindowsLauncher
                ? spawn('cmd.exe', ['/c', 'start', '', executablePath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                })
                : fs.existsSync(executablePath)
                    ? spawn(executablePath, [], {
                        cwd: path.dirname(executablePath),
                        detached: true,
                        stdio: 'ignore',
                        windowsHide: process.platform === 'win32'
                    })
                    : null;

        if (!child) return;
        child.once('error', (err) => {
            console.error('Failed to execute game instance:', err);
        });
        child.unref();
    } catch (err) {
        console.error("Failed to execute game instance:", err);
    }
});

ipcMain.handle('get-user-data-path', () => {
    const userLibraryPath = path.join(app.getPath('userData'), 'library.json');
    if (!fs.existsSync(userLibraryPath)) {
        const bundledLibraryPath = path.join(app.getAppPath(), 'library.json');
        if (fs.existsSync(bundledLibraryPath)) {
            try {
                fs.mkdirSync(app.getPath('userData'), { recursive: true });
                fs.copyFileSync(bundledLibraryPath, userLibraryPath);
            } catch (err) {
                console.error('Failed to migrate library data:', err);
            }
        }
    }
    return userLibraryPath;
});

ipcMain.on('set-fullscreen', (event, shouldBeFullScreen) => {
    if (!win || win.isDestroyed()) return;
    const targetFullScreen = !!shouldBeFullScreen;
    win.setFullScreen(targetFullScreen);
    event.sender.send('fullscreen-changed', targetFullScreen);
});

ipcMain.on('set-window-material', (event, material) => {
    if (process.platform !== 'win32' || !win || win.isDestroyed() || typeof win.setBackgroundMaterial !== 'function') return;
    try {
        win.setBackgroundMaterial(material === 'acrylic' ? 'acrylic' : 'none');
    } catch (err) {
        console.error('Failed to set window background material:', err);
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

ipcMain.handle('search-steamgriddb-games', async (event, gameName) => {
    const settings = loadSettings();
    if (!settings.steamGridApiKey) return { success: false, error: 'No API Key configured in Settings' };

    const headers = { Authorization: `Bearer ${settings.steamGridApiKey}` };
    try {
        const searchRes = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        if (!searchRes.data.success || !searchRes.data.data.length) return { success: false, error: 'Game not found on SteamGridDB' };

        const parsed = searchRes.data.data.map(item => ({
            id: item.id,
            name: item.name || item.gameName || item.title || '',
            platform: Array.isArray(item.platforms) ? item.platforms.join(', ') : item.platform || '',
            thumb: item.thumb || item.logo || '',
            slug: item.slug || '',
            releaseDate: item.released || item.release_date || item.releaseDate || ''
        }));

        return { success: true, data: parsed };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

function normalizeSteamTitle(title) {
    return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

ipcMain.handle('get-steam-game-media', async (event, gameTitle) => {
    const normalizedTitle = normalizeSteamTitle(gameTitle);
    if (!normalizedTitle) return { success: false, error: 'A game title is required.' };

    try {
        const searchResponse = await axios.get('https://store.steampowered.com/api/storesearch/', {
            params: { term: gameTitle, l: 'english', cc: 'US' },
            timeout: 15000
        });
        const exactMatch = searchResponse.data?.items?.find(item => normalizeSteamTitle(item.name) === normalizedTitle);
        if (!exactMatch) return { success: false, error: 'No exact Steam Store title match was found.' };

        const appId = String(exactMatch.id);
        const [detailsResponse, recommendationsResponse] = await Promise.all([
            axios.get('https://store.steampowered.com/api/appdetails', {
                params: { appids: appId, cc: 'US', l: 'en' },
                timeout: 15000
            }),
            axios.get(`https://store.steampowered.com/recommended/morelike/app/${appId}/`, {
                params: { cc: 'US', l: 'en' },
                timeout: 15000
            }).catch(() => ({ data: '' }))
        ]);

        const details = detailsResponse.data?.[appId]?.data;
        if (!detailsResponse.data?.[appId]?.success || !details) {
            return { success: false, error: 'Steam Store details are unavailable for this title.' };
        }

        return {
            success: true,
            appId,
            title: details.name || exactMatch.name,
            genres: (details.genres || []).map(genre => genre.description).filter(Boolean),
            screenshots: (details.screenshots || []).slice(0, 12).map(screenshot => screenshot.path_full).filter(Boolean),
            recommendationsHtml: recommendationsResponse.data || ''
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.on('open-steam-game', (event, appId) => {
    const safeAppId = String(appId || '');
    if (/^\d+$/.test(safeAppId)) {
        shell.openExternal(`https://store.steampowered.com/app/${safeAppId}/`);
    }
});

// API integration for pulling options directly to the artwork picker
ipcMain.handle('fetch-steamgriddb-assets', async (event, gameName, type, sgGameId) => {
    const settings = loadSettings();
    if (!settings.steamGridApiKey) return { success: false, error: 'No API Key configured in Settings' };

    const headers = { Authorization: `Bearer ${settings.steamGridApiKey}` };
    try {
        let selectedGameId = sgGameId;
        if (!selectedGameId) {
            const searchRes = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
            if (!searchRes.data.success || !searchRes.data.data.length) return { success: false, error: 'Game not found on SteamGridDB' };
            selectedGameId = searchRes.data.data[0].id;
        }

        const typeToEndpoint = { cover: 'grids', background: 'heroes', logo: 'logos', icon: 'icons' };
        const endpoint = typeToEndpoint[type] || 'grids';

        const res = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${selectedGameId}`, { headers });
        if (res.data.success && res.data.data.length > 0) {
            return { success: true, data: res.data.data.slice(0, 30).map(item => ({ thumb: item.thumb, url: item.url })) };
        } else {
            return { success: false, error: 'No assets found for this category' };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.on('apply-asset', async (event, { gameId, imageUrl, imagePath, type, oldPath, protectedPaths = [] }) => {
    let temporaryPath = null;
    try {
        const folderMap = { cover: 'Covers', icon: 'Icons', background: 'Backgrounds', logo: 'Logos' };
        const folderName = folderMap[type] || 'Assets';
        const folder = path.join(app.getPath('documents'), 'HB-Launcher', folderName);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        let localPath = '';
        const ext = (type === 'icon' || type === 'logo') ? '.png' : '.jpg';
        localPath = path.join(folder, `${gameId}${ext}`);
        temporaryPath = `${localPath}.tmp-${Date.now()}`;

        if (imagePath && fs.existsSync(imagePath)) {
            fs.copyFileSync(imagePath, temporaryPath);
        } else if (imageUrl) {
            const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
            fs.writeFileSync(temporaryPath, Buffer.from(res.data));
        } else {
            throw new Error('No asset source provided');
        }

        const protectedPathSet = new Set(protectedPaths.map(assetPath => path.resolve(assetPath).toLowerCase()));
        if (oldPath && fs.existsSync(oldPath) && path.resolve(oldPath) !== path.resolve(localPath) && !protectedPathSet.has(path.resolve(oldPath).toLowerCase())) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error("Could not drop old asset image:", e); }
        }
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        fs.renameSync(temporaryPath, localPath);
        
        const channelMap = { cover: 'cover-updated', icon: 'icon-updated', background: 'bg-updated', logo: 'logo-updated' };
        const replyChannel = channelMap[type] || 'cover-updated';
        
        if (win) win.webContents.send(replyChannel, { id: gameId, path: localPath });
        if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    } catch (err) {
        if (temporaryPath && fs.existsSync(temporaryPath)) {
            try { fs.unlinkSync(temporaryPath); } catch (cleanupError) { console.error('Failed to clean temporary asset:', cleanupError); }
        }
        console.error("Asset modification error:", err);
    }
});

ipcMain.on('delete-game-assets', (event, payload) => {
    const assetPaths = Array.isArray(payload) ? payload : payload?.assetPaths || [];
    const protectedPaths = new Set((Array.isArray(payload) ? [] : payload?.protectedPaths || []).map(assetPath => path.resolve(assetPath).toLowerCase()));
    const deletedPaths = new Set();
    assetPaths.forEach(assetPath => {
        if (!assetPath) return;
        const normalizedPath = path.resolve(assetPath).toLowerCase();
        if (protectedPaths.has(normalizedPath) || deletedPaths.has(normalizedPath)) return;
        if (fs.existsSync(assetPath)) {
            try {
                fs.unlinkSync(assetPath);
                deletedPaths.add(normalizedPath);
            } catch(e) { console.error("Error wiping asset index from drive:", e); }
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
        experimental: !!theme.experimental,
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
        treatPackageAsDirectory: false,
        filters: [{ name: 'Executables & Applications', extensions: ['exe', 'app', 'bat', 'cmd', 'lnk', 'url', 'sh'] }]
    });
    if (canceled || filePaths.length === 0) return;

    const filePath = filePaths[0];
    const suggestedName = filePath.endsWith('.app') 
        ? path.basename(filePath, '.app') 
        : path.basename(filePath, path.extname(filePath));

    event.sender.send('confirm-add-game-name', { filePath, suggestedName });
});

ipcMain.on('add-game-name-confirmed', async (event, { filePath, gameName }) => {
    const name = typeof gameName === 'string' ? gameName.trim() : '';
    const supportedExtensions = new Set(['.exe', '.app', '.bat', '.cmd', '.lnk', '.url', '.sh']);
    if (!name || !filePath || !fs.existsSync(filePath) || !supportedExtensions.has(path.extname(filePath).toLowerCase())) return;

    const gameId = 'game-' + Date.now();
    
    let coverPath = '';
    let iconPath = '';
    let logoPath = '';
    let bgPath = '';

    const settings = loadSettings();
    if (settings.steamGridApiKey) {
        const fetchedAssets = await fetchSteamGridArtwork(name, settings.steamGridApiKey, gameId);
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
            const iconFolder = path.join(docsPath, 'HB-Launcher', 'Icons');
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
        name,
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
        treatPackageAsDirectory: false,
        filters: [{ name: 'Games & Shortcuts', extensions: ['exe', 'app', 'url', 'lnk', 'sh'] }] 
    });
    return canceled ? null : filePaths[0];
});

ipcMain.on('open-file-location', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });