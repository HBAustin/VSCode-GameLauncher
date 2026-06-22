const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');

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
        return net.fetch('file:///' + pathValue);
    });
    createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

let activeGameProcesses = {};

ipcMain.on('launch-game-process', (event, { id, executablePath }) => {
    if (!executablePath || !fs.existsSync(executablePath)) return;
    
    const gameDir = path.dirname(executablePath);
    
    // Spawn keeps process handle alive independent of launcher
    const child = spawn(executablePath, [], { 
        cwd: gameDir, 
        detached: true, 
        stdio: 'ignore' 
    });
    child.unref();

    activeGameProcesses[id] = child;
    event.reply('game-started', { id });
});

// IMAGE DOWNLOAD HANDLER
async function downloadImage(gameId, imageUrl, subFolder, extension, oldPath, replyChannel) {
    try {
        const folder = path.join(app.getPath('documents'), `HB-Launcher-${subFolder}`);
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        
        const localPath = path.join(folder, `${gameId}.${extension}`);
        
        if (oldPath && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

        const res = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        fs.writeFileSync(localPath, Buffer.from(res.data));
        
        if (win) win.webContents.send(replyChannel, { id: gameId, path: localPath });
        if (pickerWin) pickerWin.close();
    } catch (err) { console.error(`Error applying ${subFolder}:`, err); }
}

ipcMain.on('apply-cover', (event, data) => downloadImage(data.gameId, data.imageUrl, 'Covers', 'jpg', data.oldPath, 'cover-updated'));
ipcMain.on('apply-icon', (event, data) => downloadImage(data.gameId, data.imageUrl, 'Icons', 'png', data.oldPath, 'icon-updated'));
ipcMain.on('apply-bg', (event, data) => downloadImage(data.gameId, data.imageUrl, 'Backgrounds', 'jpg', data.oldPath, 'bg-updated'));

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

ipcMain.handle('get-sgdb-grids', async (e, { gid, mode }) => {
    try {
        // Switch API endpoint based on what we are looking for
        let endpoint = `grids/game/${gid}`;
        if (mode === 'icon') endpoint = `icons/game/${gid}`;
        if (mode === 'bg') endpoint = `heroes/game/${gid}`;

        const res = await axios.get(`https://www.steamgriddb.com/api/v2/${endpoint}`, { headers: { 'Authorization': `Bearer ${SGDB_KEY}` } });
        return res.data.success ? res.data.data : [];
    } catch (err) { return []; }
});

ipcMain.on('open-picker', (event, gameData) => {
    if (pickerWin && !pickerWin.isDestroyed()) { pickerWin.close(); }
    pickerWin = new BrowserWindow({
        width: 800, height: 900, parent: win, modal: true, backgroundColor: '#1a1a1a',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    pickerWin.loadFile('picker.html');
    // Ensure data is sent AFTER window loads so GameID isn't lost
    pickerWin.webContents.on('did-finish-load', () => { 
        pickerWin.webContents.send('init-picker', gameData); 
    });
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

ipcMain.on('quit-app-now', () => { app.quit(); });