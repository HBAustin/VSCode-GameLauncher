const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { exec } = require('child_process');

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
        let pathValue = decodeURIComponent(request.url.replace('local-image://', '')).split('?')[0];
        if (pathValue[1] !== ':' && /^[a-zA-Z]/.test(pathValue)) {
            pathValue = pathValue[0] + ':/' + pathValue.substring(1);
        }
        try {
            const finalPath = path.isAbsolute(pathValue) ? pathValue : path.join(__dirname, pathValue);
            return await net.fetch('file:///' + finalPath.replace(/\\/g, '/'));
        } catch (err) { return new Response("Not Found", { status: 404 }); }
    });
    createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

let activeGameProcesses = {};

ipcMain.on('launch-game-process', (event, { id, executablePath }) => {
    if (!executablePath || !fs.existsSync(executablePath)) return;
    if (activeGameProcesses[id]) return;

    const startTime = Date.now();
    const gameDir = path.dirname(executablePath);
    const child = exec(`"${executablePath}"`, { cwd: gameDir }, (error) => {
        if (error) console.error(error);
    });

    activeGameProcesses[id] = child;
    event.reply('game-started', { id, startTime });

    child.on('exit', () => {
        const endTime = Date.now();
        const durationMinutes = Math.round((endTime - startTime) / 1000 / 60);
        delete activeGameProcesses[id];
        if (win && !win.isDestroyed()) {
            win.webContents.send('game-stopped', { id, durationMinutes, lastPlayed: endTime });
        }
    });
});

// --- KEEP THIS VERSION (Handles old cover file removal & updates renderer) ---
ipcMain.on('apply-cover', async (event, { gameId, imageUrl, oldPath }) => {
    try {
        const folder = path.join(app.getPath('documents'), 'HB-Launcher-Covers');
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        const localPath = path.join(folder, `${gameId}.jpg`);
        
        // If there was an old image, delete it to prevent asset bloat
        if (oldPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
        }

        const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, Buffer.from(res.data));
        
        // Notify renderer to update gameData and trigger instant DOM cache-busting refresh
        if (win) win.webContents.send('cover-updated', { id: gameId, path: localPath });
        if (pickerWin) pickerWin.close();
    } catch (err) { console.error("Cover apply error:", err); }
});

// Listener to clean up cover art files when a game is entirely removed from your library
ipcMain.on('delete-cover-file', (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
});

ipcMain.handle('scan-steam-library', async () => {
    const discovered = [];
    const possiblePaths = [
        "C:\\Program Files (x86)\\Steam\\steamapps",
        "C:\\Program Files\\Steam\\steamapps",
        "D:\\SteamLibrary\\steamapps",
        "E:\\SteamLibrary\\steamapps"
    ];
    possiblePaths.forEach(appsPath => {
        if (fs.existsSync(appsPath)) {
            try {
                const files = fs.readdirSync(appsPath);
                files.forEach(file => {
                    if (file.startsWith('appmanifest_') && file.endsWith('.acf')) {
                        const content = fs.readFileSync(path.join(appsPath, file), 'utf8');
                        const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
                        const commonPath = path.join(appsPath, 'common', nameMatch ? nameMatch[1] : '');
                        if (nameMatch && fs.existsSync(commonPath)) {
                            const folderFiles = fs.readdirSync(commonPath);
                            const exeFile = folderFiles.find(f => f.endsWith('.exe') && !f.toLowerCase().includes('crash'));
                            if (exeFile) discovered.push({ name: nameMatch[1], path: path.join(commonPath, exeFile) });
                        }
                    }
                });
            } catch (e) {}
        }
    });
    return discovered;
});

ipcMain.handle('search-sgdb', async (e, query) => {
    try {
        const res = await axios.get(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query)}`, { headers: { 'Authorization': `Bearer ${SGDB_KEY}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.handle('get-sgdb-grids', async (e, gid) => {
    try {
        const res = await axios.get(`https://www.steamgriddb.com/api/v2/grids/game/${gid}`, { headers: { 'Authorization': `Bearer ${SGDB_KEY}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.on('open-picker', (event, gameData) => {
    if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.focus(); return; }
    pickerWin = new BrowserWindow({
        width: 800, height: 900, parent: win, modal: true, backgroundColor: '#1a1a1a',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    pickerWin.loadFile('picker.html');
    pickerWin.once('ready-to-show', () => { pickerWin.webContents.send('init-picker', gameData); });
});

ipcMain.on('add-game-requested', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] }
        ]
    });

    if (!canceled && filePaths.length > 0) {
        event.sender.send('add-game-confirmed', filePaths[0]);
    }
});

ipcMain.handle('select-game', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ 
        properties: ['openFile'], 
        filters: [
            { name: 'Games & Shortcuts', extensions: ['exe', 'url', 'lnk'] }
        ] 
    });
    return canceled ? null : filePaths[0];
});

ipcMain.on('open-file-location', (event, filePath) => { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); });
ipcMain.on('quit-app-now', () => { app.quit(); });