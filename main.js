const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const { pathToFileURL } = require('url');
const BASE_THEMES = require('./themes/default-themes.js');
const THEMES = {
    // Built-in "Dynamic" theme: the background and accent colour follow the selected game's artwork (see ui.js).
    // Listed first; a theme with the same key in default-themes.js would take precedence.
    dynamic: {
        name: 'Dynamic',
        colors: {
            background: 'rgba(12, 12, 12, 0.65)',
            surface: 'rgba(255, 255, 255, 0.05)',
            text: '#ffffff',
            accent: '#fc9677'
        },
        fonts: { ...((BASE_THEMES.dark || {}).fonts || {}) }
    },
    ...BASE_THEMES
};
const glass = require('./glass-main');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

let win = null;
let pickerWin = null;

function createWindow() {
    app.setAppUserModelId('com.hb.launcher.v1');

    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    // Window material (Liquid Glass / vibrancy on macOS, Acrylic/Mica on Windows) is handled by glass-main.js
    win = new BrowserWindow(glass.windowOptions({
        width: 1200, height: 850, minWidth: 800, minHeight: 600,
        frame: true,
        titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
        titleBarOverlay: isWin ? {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 38
        } : false,
        trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
        visualEffectState: isMac ? 'active' : undefined,
        backgroundColor: '#00000000',
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
    }));
    glass.attach(win);

    win.loadFile('index.html');
    win.on('closed', () => { win = null; });
    win.on('enter-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('fullscreen-changed', true);
    });
    win.on('leave-full-screen', () => {
        if (win && !win.isDestroyed()) win.webContents.send('fullscreen-changed', false);
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
            submenu: [ isMac ? { role: 'close' } : { role: 'quit' } ]
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
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
        const searchRes = await axios.get(
            `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
            { headers }
        );
        if (!searchRes.data.success || !searchRes.data.data.length) return results;

        const sgGameId = searchRes.data.data[0].id;
        const docsPath = app.getPath('documents');

        const downloadAsset = async (endpoint, folderName, ext) => {
            try {
                const res = await axios.get(
                    `https://www.steamgriddb.com/api/v2/${endpoint}/game/${sgGameId}`,
                    { headers }
                );
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

        // Parallel downloads instead of 4 sequential round-trips
        const [cover, background, logo, icon] = await Promise.all([
            downloadAsset('grids', 'Covers', '.jpg'),
            downloadAsset('heroes', 'Backgrounds', '.jpg'),
            downloadAsset('logos', 'Logos', '.png'),
            downloadAsset('icons', 'Icons', '.png')
        ]);

        results.cover = cover;
        results.background = background;
        results.logo = logo;
        results.icon = icon;
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
            if (filePath && fs.existsSync(filePath)) {
                return net.fetch(pathToFileURL(filePath).href);
            }
            return new Response('Not Found', { status: 404 });
        } catch (err) {
            console.error("Protocol error:", err);
            return new Response('Not Found', { status: 404 });
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

const importer = require('./importer-main');
ipcMain.on('launch-game-process', (event, { executablePath, options }) => {
    importer.launch(executablePath, options, () => win);
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

// Themes still request a material through this channel; glass-main.js decides how to apply it.
ipcMain.on('set-window-material', (event, material) => {
    glass.applyThemeMaterial(win, material);
});

ipcMain.on('show-game-context-menu', (event, gameData) => {
    const template = [
        { label: `Play ${gameData.name}`, click: () => event.sender.send('context-menu-play', gameData) },
        { type: 'separator' },
        { label: gameData.favorite ? 'Unfavorite' : 'Favorite', click: () => event.sender.send('context-menu-fav', gameData) },
        { label: 'Rename Game', click: () => event.sender.send('context-menu-rename', gameData) },
        { label: 'Customize Artwork...', click: () => event.sender.send('context-menu-customize', gameData) },
        { type: 'separator' },
        { label: 'Open File Location', click: () => event.sender.send('context-menu-open-location', gameData) },
        { label: 'Change Game Path', click: () => event.sender.send('context-menu-change-path', gameData) },
        { type: 'separator' },
        { label: 'Remove from Library', click: () => event.sender.send('context-menu-remove', gameData) }
    ];
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(event.sender) });
});

function openPickerWindow(gameData, type) {
    if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.focus(); return; }
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    // Same window treatment as the main launcher: hidden title bar, native glass, no menu bar.
    pickerWin = new BrowserWindow(glass.windowOptions({
        width: 860, height: 900, minWidth: 560, minHeight: 520,
        parent: win || undefined, modal: false,
        title: 'Select Artwork',
        autoHideMenuBar: true,
        titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
        titleBarOverlay: isWin ? {
            color: '#00000000',
            symbolColor: '#ffffff',
            height: 38
        } : false,
        trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
        backgroundColor: '#00000000',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    }));
    pickerWin.setMenuBarVisibility(false);
    glass.attach(pickerWin);
    pickerWin.loadFile('picker.html');
    pickerWin.on('closed', () => { pickerWin = null; });
    pickerWin.webContents.once('did-finish-load', () => {
        if (pickerWin && !pickerWin.isDestroyed()) {
            pickerWin.webContents.send('init-picker', { ...gameData, type });
        }
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
        const searchRes = await axios.get(
            `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
            { headers }
        );
        if (!searchRes.data.success || !searchRes.data.data.length) {
            return { success: false, error: 'Game not found on SteamGridDB' };
        }
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
    return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Windows: the renderer reports its top bar height so the native window buttons line up with it (titlebar.js)
ipcMain.on('titlebar-height', (event, height) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    const h = Math.round(Number(height));
    if (!w || process.platform !== 'win32' || typeof w.setTitleBarOverlay !== 'function' || !(h >= 28 && h <= 160)) return;
    try { w.setTitleBarOverlay({ color: '#00000000', symbolColor: '#ffffff', height: h }); } catch (e) { /* window closing */ }
});

/* ---- Steam Store requests: polite by design --------------------------------------------------
   Steam's CDN (Akamai) blocks an IP that sends too many requests ("Access Denied ... Reference #18...").
   To stay under the limit this section:
     - queues every request and spaces them out (STEAM_MIN_GAP_MS apart, one at a time)
     - caches results on disk (hits for 14 days, "no match" for 1 day, errors for 10 minutes)
     - shares one request between identical lookups that are in flight at the same time
     - backs off completely after a 403/429 (STEAM_COOLDOWN_MS) and makes no requests until it ends  */
const STEAM_MIN_GAP_MS = 1500;
const STEAM_COOLDOWN_MS = 15 * 60 * 1000;
const STEAM_TTL = { hit: 14 * 24 * 3600e3, miss: 24 * 3600e3, error: 10 * 60e3 };
const STEAM_CACHE_FILE = path.join(app.getPath('userData'), 'steam-cache.json');
const STEAM_HEADERS = { 'User-Agent': 'Mozilla/5.0 (HBLauncher) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' };

let steamCache = {};
try { steamCache = JSON.parse(fs.readFileSync(STEAM_CACHE_FILE, 'utf8')) || {}; } catch { steamCache = {}; }
let steamCacheTimer = null;
function saveSteamCache() {
    clearTimeout(steamCacheTimer);
    steamCacheTimer = setTimeout(() => {
        const now = Date.now();
        for (const k of Object.keys(steamCache)) if (steamCache[k].expires < now) delete steamCache[k];
        fs.writeFile(STEAM_CACHE_FILE, JSON.stringify(steamCache), () => {});
    }, 2000);
}

let steamBlockedUntil = 0;
let steamQueue = Promise.resolve();
let steamLastRequest = 0;
const steamInFlight = new Map();

function steamGet(url, config = {}) {
    const run = async () => {
        if (Date.now() < steamBlockedUntil) {
            const err = new Error('Steam is rate-limiting this connection. Pausing requests for a few minutes.');
            err.steamBlocked = true;
            throw err;
        }
        const wait = steamLastRequest + STEAM_MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        steamLastRequest = Date.now();
        try {
            return await axios.get(url, { timeout: 15000, headers: STEAM_HEADERS, ...config });
        } catch (err) {
            const status = err.response?.status;
            if (status === 403 || status === 429) {
                steamBlockedUntil = Date.now() + STEAM_COOLDOWN_MS;
                err.steamBlocked = true;
                err.message = 'Steam is rate-limiting this connection. Pausing requests for a few minutes.';
            }
            throw err;
        }
    };
    const result = steamQueue.then(run, run);
    steamQueue = result.catch(() => {});
    return result;
}

async function lookupSteamMedia(gameTitle, normalizedTitle) {
    const searchResponse = await steamGet('https://store.steampowered.com/api/storesearch/', {
        params: { term: gameTitle, l: 'english', cc: 'US' }
    });
    const exactMatch = searchResponse.data?.items?.find(
        item => normalizeSteamTitle(item.name) === normalizedTitle
    );
    if (!exactMatch) return { success: false, miss: true, error: 'No exact Steam Store title match was found.' };

    const appId = String(exactMatch.id);
    const detailsResponse = await steamGet('https://store.steampowered.com/api/appdetails', {
        params: { appids: appId, cc: 'US', l: 'en' }
    });
    const details = detailsResponse.data?.[appId]?.data;
    if (!detailsResponse.data?.[appId]?.success || !details) {
        return { success: false, miss: true, error: 'Steam Store details are unavailable for this title.' };
    }

    // "More like this" is optional; skip it quietly if Steam objects
    let recommendationsHtml = '';
    try {
        recommendationsHtml = (await steamGet(`https://store.steampowered.com/recommended/morelike/app/${appId}/`, {
            params: { cc: 'US', l: 'en' }
        })).data || '';
    } catch (err) { if (err.steamBlocked) recommendationsHtml = ''; }

    return {
        success: true,
        appId,
        title: details.name || exactMatch.name,
        genres: (details.genres || []).map(genre => genre.description).filter(Boolean),
        screenshots: (details.screenshots || []).slice(0, 12).map(s => s.path_full).filter(Boolean),
        recommendationsHtml
    };
}

ipcMain.handle('get-steam-game-media', async (event, gameTitle) => {
    const normalizedTitle = normalizeSteamTitle(gameTitle);
    if (!normalizedTitle) return { success: false, error: 'A game title is required.' };

    const cached = steamCache[normalizedTitle];
    if (cached && cached.expires > Date.now()) return cached.value;
    if (Date.now() < steamBlockedUntil) {
        return { success: false, error: 'Steam is rate-limiting this connection. Pausing requests for a few minutes.' };
    }

    if (steamInFlight.has(normalizedTitle)) return steamInFlight.get(normalizedTitle);
    const job = (async () => {
        try {
            const value = await lookupSteamMedia(gameTitle, normalizedTitle);
            const ttl = value.success ? STEAM_TTL.hit : STEAM_TTL.miss;
            steamCache[normalizedTitle] = { expires: Date.now() + ttl, value };
            saveSteamCache();
            return value;
        } catch (err) {
            if (!err.steamBlocked) {
                steamCache[normalizedTitle] = { expires: Date.now() + STEAM_TTL.error, value: { success: false, error: err.message } };
                saveSteamCache();
            }
            return { success: false, error: err.message };
        } finally {
            steamInFlight.delete(normalizedTitle);
        }
    })();
    steamInFlight.set(normalizedTitle, job);
    return job;
});

ipcMain.on('open-steam-game', (event, appId) => {
    const safeAppId = String(appId || '');
    if (/^\d+$/.test(safeAppId)) {
        shell.openExternal(`https://store.steampowered.com/app/${safeAppId}/`);
    }
});

ipcMain.handle('fetch-steamgriddb-assets', async (event, gameName, type, sgGameId) => {
    const settings = loadSettings();
    if (!settings.steamGridApiKey) return { success: false, error: 'No API Key configured in Settings' };

    const headers = { Authorization: `Bearer ${settings.steamGridApiKey}` };
    try {
        let selectedGameId = sgGameId;
        if (!selectedGameId) {
            const searchRes = await axios.get(
                `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`,
                { headers }
            );
            if (!searchRes.data.success || !searchRes.data.data.length) {
                return { success: false, error: 'Game not found on SteamGridDB' };
            }
            selectedGameId = searchRes.data.data[0].id;
        }

        const typeToEndpoint = { cover: 'grids', background: 'heroes', logo: 'logos', icon: 'icons' };
        const endpoint = typeToEndpoint[type] || 'grids';

        const res = await axios.get(
            `https://www.steamgriddb.com/api/v2/${endpoint}/game/${selectedGameId}`,
            { headers }
        );
        if (res.data.success && res.data.data.length > 0) {
            return {
                success: true,
                data: res.data.data.slice(0, 30).map(item => ({ thumb: item.thumb, url: item.url }))
            };
        }
        return { success: false, error: 'No assets found for this category' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.on('apply-asset', async (event, { gameId, imageUrl, imagePath, type, oldPath, protectedPaths = [] }) => {
    let temporaryPath = null;
    const sender = event.sender;

    const notifyFailure = (message) => {
        try {
            if (!sender.isDestroyed()) sender.send('apply-asset-failed', { gameId, type, error: message });
            if (pickerWin && !pickerWin.isDestroyed()) {
                pickerWin.webContents.send('apply-asset-failed', { gameId, type, error: message });
            }
        } catch (_) { /* ignore */ }
    };

    try {
        const folderMap = { cover: 'Covers', icon: 'Icons', background: 'Backgrounds', logo: 'Logos' };
        const folderName = folderMap[type] || 'Assets';
        const folder = path.join(app.getPath('documents'), 'HB-Launcher', folderName);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

        const ext = (type === 'icon' || type === 'logo') ? '.png' : '.jpg';
        const localPath = path.join(folder, `${gameId}${ext}`);
        temporaryPath = `${localPath}.tmp-${Date.now()}`;

        if (imagePath && fs.existsSync(imagePath)) {
            fs.copyFileSync(imagePath, temporaryPath);
        } else if (imageUrl) {
            const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
            fs.writeFileSync(temporaryPath, Buffer.from(res.data));
        } else {
            throw new Error('No asset source provided');
        }

        // Move existing destination aside as a backup before swapping in the new file.
        let backupPath = null;
        if (fs.existsSync(localPath)) {
            backupPath = `${localPath}.bak-${Date.now()}`;
            fs.renameSync(localPath, backupPath);
        }

        try {
            fs.renameSync(temporaryPath, localPath);
        } catch (renameErr) {
            // Restore backup on failure so we don't lose the original asset.
            if (backupPath && fs.existsSync(backupPath)) {
                try { fs.renameSync(backupPath, localPath); } catch (_) {}
            }
            throw renameErr;
        }

        if (backupPath && fs.existsSync(backupPath)) {
            try { fs.unlinkSync(backupPath); } catch (_) {}
        }

        const protectedPathSet = new Set(protectedPaths.map(p => path.resolve(p).toLowerCase()));
        if (oldPath && fs.existsSync(oldPath)
            && path.resolve(oldPath) !== path.resolve(localPath)
            && !protectedPathSet.has(path.resolve(oldPath).toLowerCase())) {
            try { fs.unlinkSync(oldPath); } catch (e) { console.error("Could not drop old asset image:", e); }
        }

        const channelMap = { cover: 'cover-updated', icon: 'icon-updated', background: 'bg-updated', logo: 'logo-updated' };
        const replyChannel = channelMap[type] || 'cover-updated';

        if (win && !win.isDestroyed()) win.webContents.send(replyChannel, { id: gameId, path: localPath });
        if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    } catch (err) {
        if (temporaryPath && fs.existsSync(temporaryPath)) {
            try { fs.unlinkSync(temporaryPath); } catch (e) { console.error('Failed to clean temporary asset:', e); }
        }
        console.error("Asset modification error:", err);
        notifyFailure(err.message || 'Asset modification failed');
    }
});

ipcMain.on('delete-game-assets', (event, payload) => {
    const assetPaths = Array.isArray(payload) ? payload : payload?.assetPaths || [];
    const protectedPaths = new Set(
        (Array.isArray(payload) ? [] : payload?.protectedPaths || [])
            .map(p => path.resolve(p).toLowerCase())
    );
    const deletedPaths = new Set();
    assetPaths.forEach(assetPath => {
        if (!assetPath) return;
        const normalizedPath = path.resolve(assetPath).toLowerCase();
        if (protectedPaths.has(normalizedPath) || deletedPaths.has(normalizedPath)) return;
        if (fs.existsSync(assetPath)) {
            try {
                fs.unlinkSync(assetPath);
                deletedPaths.add(normalizedPath);
            } catch (e) { console.error("Error wiping asset index from drive:", e); }
        }
    });
});

ipcMain.handle('get-settings', async () => loadSettings());

ipcMain.handle('save-settings', async (event, settings) => {
    const success = saveSettings(settings);
    if (success && win && !win.isDestroyed()) {
        win.webContents.send('settings-updated', settings);
    }
    return { success };
});

ipcMain.handle('get-theme-preset', async (event, themeName) => THEMES[themeName] || THEMES.dark);

ipcMain.handle('get-all-themes', async () => {
    return Object.entries(THEMES).map(([key, theme]) => ({
        id: key,
        name: theme.name,
        experimental: !!theme.experimental,
        preview: { colors: theme.colors, fonts: theme.fonts }
    }));
});

ipcMain.handle('get-file-icon', async (event, filePath) => {
    try {
        if (!filePath) return null;
        // URI/URL pseudo-paths can't be resolved by app.getFileIcon.
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(filePath)) return null;
        if (!fs.existsSync(filePath)) return null;
        const nativeImg = await app.getFileIcon(filePath, { size: 'normal' });
        return nativeImg.toDataURL();
    } catch (err) { return null; }
});

ipcMain.handle('select-asset-image', async () => {
    const parentWindow = pickerWin && !pickerWin.isDestroyed()
        ? pickerWin
        : (win && !win.isDestroyed() ? win : undefined);
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
});

ipcMain.on('add-game-requested', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
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
    if (!name || !filePath || !fs.existsSync(filePath)
        || !supportedExtensions.has(path.extname(filePath).toLowerCase())) return;

    const gameId = 'game-' + Date.now();
    let coverPath = '', iconPath = '', logoPath = '', bgPath = '';

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
        } catch (e) {
            console.error("Local executable binary shell icon collection failed:", e);
        }
    }

    event.sender.send('add-game-confirmed', {
        id: gameId, name, path: filePath,
        cover: coverPath, background: bgPath, logo: logoPath, icon: iconPath
    });
});

ipcMain.handle('select-game', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
        properties: ['openFile'],
        treatPackageAsDirectory: false,
        filters: [{ name: 'Games & Shortcuts', extensions: ['exe', 'app', 'url', 'lnk', 'sh'] }]
    });
    return canceled ? null : filePaths[0];
});

ipcMain.on('open-file-location', (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    if (fs.statSync(filePath).isDirectory()) shell.openPath(filePath);   // imported games point at their install folder
    else shell.showItemInFolder(filePath);
});

importer.register({ ipcMain, app, getWin: () => win, loadSettings, fetchSteamGridArtwork });