/* HB Launcher: installed-game scanner, bulk import and launching with per-game options (main process)
   -----------------------------------------------------------------------------------------------
   Scans for games installed through Steam, Epic Games Store and GOG Galaxy, imports the ones you pick
   (with SteamGridDB artwork when a key is set), and starts games with their launch options.

   main.js calls register({...}) once. Everything else in here is self-contained. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

/* ------------------------------------------------------------------ helpers */
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const listDir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };
// Keep the first of each item that maps to the same key (Windows paths differ only by case and slashes)
const uniqueBy = (items, keyOf) => { const seen = new Set(); return items.filter(i => { const k = keyOf(i); if (seen.has(k)) return false; seen.add(k); return true; }); };
// "Mass Effect(TM): Andromeda Deluxe Edition" and "mass effect andromeda" compare equal
const titleKey = (name) => String(name || '').replace(/[\u2122\u00ae\u00a9]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]/g, '').replace(/(deluxeedition|standardedition|ultimateedition|completeedition|gameoftheyearedition|goty)$/, '');
const run = (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => resolve(err ? '' : String(stdout)));
});

/* ------------------------------------------------------------------ Steam */
const STEAM_IGNORE_IDS = new Set(['228980', '1070560', '1391110', '1493710', '1628350', '1826330', '2180100']);
const STEAM_IGNORE_NAMES = /^(Steam Linux Runtime|Proton\b|Steamworks Common|Steam Controller Configs|SteamVR Media Player)/i;

async function steamRoots() {
    const roots = [];
    if (process.platform === 'win32') {
        const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
        const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
        if (m) roots.push(m[1].trim());
        for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
            if (base) roots.push(path.join(base, 'Steam'));
        }
    } else if (process.platform === 'darwin') {
        roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Steam'));
    } else {
        roots.push(path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local', 'share', 'Steam'));
    }
    return uniqueBy(roots.filter(exists).map(r => path.resolve(r)), norm);
}

function parseLibraryFolders(vdfText) {
    const out = [];
    const re = /"path"\s+"([^"]+)"/g;
    let m;
    while ((m = re.exec(vdfText))) out.push(m[1].replace(/\\\\/g, '\\'));
    return out;
}

function parseAppManifest(text) {
    const pick = (key) => (text.match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')) || [])[1];
    const num = (key) => parseInt(pick(key), 10) || 0;
    return {
        appid: pick('appid'), name: pick('name'), installdir: pick('installdir'), state: num('StateFlags'),
        buildid: pick('buildid') || '', targetBuildId: pick('TargetBuildID') || '',
        bytesToDownload: num('BytesToDownload'), bytesDownloaded: num('BytesDownloaded')
    };
}

// StateFlags bits Steam sets: 2 update required, 4 fully installed, 256 update running, 512 update paused
function updateStatus(m) {
    const f = m.state || 0;
    const pending = !!(f & 2) || (m.targetBuildId && m.targetBuildId !== '0' && m.buildid && m.targetBuildId !== m.buildid);
    if (f & 256) {
        const p = m.bytesToDownload > 0 ? Math.min(1, m.bytesDownloaded / m.bytesToDownload) : 0;
        return { state: 'updating', progress: p };
    }
    if ((f & 512) && pending) return { state: 'paused', progress: m.bytesToDownload > 0 ? Math.min(1, m.bytesDownloaded / m.bytesToDownload) : 0 };
    if (pending) return { state: 'update', progress: 0 };
    return { state: 'ok', progress: 0 };
}

async function steamLibraryDirs() {
    const candidates = [];
    for (const root of await steamRoots()) {
        candidates.push(root);
        const vdf = readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
        for (const lib of parseLibraryFolders(vdf)) candidates.push(path.resolve(lib));
    }
    return uniqueBy(candidates, norm);
}

// appid -> { state, progress }, straight from Steam's local files (no network)
async function steamUpdateStates(appids) {
    const wanted = new Set((appids || []).map(String));
    const out = {};
    for (const lib of await steamLibraryDirs()) {
        const steamapps = path.join(lib, 'steamapps');
        for (const id of wanted) {
            if (out[id]) continue;
            const text = readText(path.join(steamapps, `appmanifest_${id}.acf`));
            if (text) out[id] = updateStatus(parseAppManifest(text));
        }
    }
    return out;
}

async function scanSteam() {
    const found = [];
    for (const lib of await steamLibraryDirs()) {
        const steamapps = path.join(lib, 'steamapps');
        for (const file of listDir(steamapps)) {
            if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
            const m = parseAppManifest(readText(path.join(steamapps, file)));
            if (!m.appid || !m.name || STEAM_IGNORE_IDS.has(m.appid) || STEAM_IGNORE_NAMES.test(m.name)) continue;
            if (!(m.state & 4)) continue;   // not fully installed
            const installDir = m.installdir ? path.join(steamapps, 'common', m.installdir) : '';
            found.push({
                store: 'Steam', key: `steam:${m.appid}`, name: m.name,
                launch: `steam://rungameid/${m.appid}`, installDir, iconSource: ''
            });
        }
    }
    return found;
}

/* ------------------------------------------------------------------ Epic Games Store (Windows) */
function parseEpicItem(text) {
    let j; try { j = JSON.parse(text); } catch { return null; }
    if (!j || !j.DisplayName || !j.LaunchExecutable || j.bIsIncompleteInstall) return null;
    return j;
}

async function scanEpic() {
    if (process.platform !== 'win32') return [];
    const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    const found = [];
    for (const file of listDir(dir)) {
        if (!file.toLowerCase().endsWith('.item')) continue;
        const j = parseEpicItem(readText(path.join(dir, file)));
        if (!j) continue;
        const exe = path.join(j.InstallLocation || '', j.LaunchExecutable);
        if (!exists(exe)) continue;
        const uri = `com.epicgames.launcher://apps/${encodeURIComponent(j.CatalogNamespace)}%3A${encodeURIComponent(j.CatalogItemId)}%3A${encodeURIComponent(j.AppName)}?action=launch&silent=true`;
        found.push({
            store: 'Epic', key: `epic:${j.AppName}`, name: j.DisplayName,
            launch: uri, installDir: j.InstallLocation || '', iconSource: exe
        });
    }
    return found;
}

/* ------------------------------------------------------------------ GOG Galaxy (Windows) */
function parseGogRegistry(output) {
    const games = [];
    let cur = null;
    for (const line of String(output).split(/\r?\n/)) {
        if (/^HKEY_/i.test(line.trim())) { cur = {}; games.push(cur); continue; }
        const m = line.match(/^\s+(\w+)\s+REG_\w+\s+(.*)$/);
        if (m && cur) cur[m[1]] = m[2].trim();
    }
    return games.filter(g => g.gameName && g.exe);
}

async function scanGog() {
    if (process.platform !== 'win32') return [];
    const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
    return parseGogRegistry(out).filter(g => exists(g.exe)).map(g => ({
        store: 'GOG', key: `gog:${g.gameID || g.gameName}`, name: g.gameName,
        launch: g.exe, installDir: g.path || path.dirname(g.exe), iconSource: g.exe
    }));
}

/* ------------------------------------------------------------------ scan */
async function scanInstalled(existing = {}) {
    const [steam, epic, gog] = await Promise.all([
        scanSteam().catch(() => []), scanEpic().catch(() => []), scanGog().catch(() => [])
    ]);
    // existing: { paths: [...], names: [...] } (a plain array of paths also works)
    const paths = Array.isArray(existing) ? existing : (existing.paths || []);
    const names = Array.isArray(existing) ? [] : (existing.names || []);
    const have = paths.map(norm).filter(Boolean);
    const haveNames = new Set(names.map(titleKey).filter(Boolean));
    const alreadyAdded = (g) => {
        const launch = norm(g.launch), dir = norm(g.installDir);
        return haveNames.has(titleKey(g.name))   // added by hand under the same title (a launcher shortcut, say)
            || have.some(p => p === launch || (dir && (p === dir || p.startsWith(dir + '/'))));
    };
    // The same game can show up twice (two library folders, or two stores): keep one of each
    const unique = uniqueBy([...steam, ...epic, ...gog], g => g.key);
    return uniqueBy(unique, g => titleKey(g.name))
        .filter(g => !alreadyAdded(g))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/* ------------------------------------------------------------------ launch options */
function normalizeOptions(o) {
    o = o && typeof o === 'object' ? o : {};
    return {
        args: String(o.args || '').slice(0, 2000).trim(),
        admin: process.platform === 'win32' && !!o.admin,
        delay: Math.max(0, Math.min(300, Number(o.delay) || 0)),
        minimize: !!o.minimize,
        mode: ['auto', 'steam', 'direct'].includes(o.mode) ? o.mode : 'auto',   // how to start: Steam if it's a Steam game, via Steam, or the file itself
        cwd: String(o.cwd || '').slice(0, 500).trim(),                            // "start in" folder
        steamAppId: /^\d+$/.test(String(o.steamAppId || '')) ? String(o.steamAppId) : ''
    };
}

function parseArgs(str) {
    const out = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
    return out;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const quoteArg = (a) => (/\s/.test(a) ? `"${a}"` : a);

function startElevated(target, args, cwd) {
    let cmd = `Start-Process -FilePath ${psQuote(target)} -WorkingDirectory ${psQuote(cwd || path.dirname(target))} -Verb RunAs`;
    if (args.length) cmd += ` -ArgumentList ${psQuote(args.map(quoteArg).join(' '))}`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
        { windowsHide: true }, (err) => { if (err) console.error('Elevated launch failed:', err.message); });
}

// Windows' own "start": opens anything the way a double-click would, including asking for admin rights when the program needs them
function startViaShell(target, args, cwd) {
    const a = ['/c', 'start', '', ...(cwd ? ['/D', cwd] : []), target, ...args];
    const child = spawn('cmd.exe', a, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', (e) => console.error('Failed to execute game instance:', e));
    child.unref();
}

/* Is this file part of a Steam game? Looks it up in Steam's own manifests (cached for a minute). */
let steamFolderCache = { at: 0, list: [] };
async function steamAppForPath(file) {
    if (Date.now() - steamFolderCache.at > 60000) {
        const list = [];
        for (const lib of await steamLibraryDirs()) {
            const steamapps = path.join(lib, 'steamapps');
            for (const f of listDir(steamapps)) {
                if (!/^appmanifest_\d+\.acf$/i.test(f)) continue;
                const m = parseAppManifest(readText(path.join(steamapps, f)));
                if (m.appid && m.installdir) list.push({ appid: m.appid, dir: norm(path.join(steamapps, 'common', m.installdir)) });
            }
        }
        steamFolderCache = { at: Date.now(), list };
    }
    const p = norm(file);
    const hit = steamFolderCache.list.find(g => p === g.dir || p.startsWith(g.dir + '/'));
    return hit ? hit.appid : '';
}

function openUri(uri, args) {
    let u = uri;
    const steam = uri.match(/^steam:\/\/(?:rungameid|run)\/(\d+)/i);
    if (steam && args) u = `steam://run/${steam[1]}//${encodeURIComponent(args)}/`;
    return require('electron').shell.openExternal(u).catch((e) => console.error('Failed to open', u, e.message));
}

async function launchNow(target, opts) {
    const isWin = process.platform === 'win32';
    const isUri = (t) => /^[a-z][a-z\d+.-]*:\/\//i.test(t);
    let extra = parseArgs(opts.args);
    let cwd = opts.cwd && exists(opts.cwd) ? opts.cwd : '';

    if (isUri(target)) { await openUri(target, opts.args); return; }

    // Shortcuts: use what they point to, so their own arguments and start folder are kept and yours are added
    let ext = path.extname(target).toLowerCase();
    if (ext === '.url') {
        const u = (readText(target).match(/^URL=(.+)$/mi) || [])[1];
        if (u && isUri(u.trim())) { await openUri(u.trim(), opts.args); return; }
    }
    if (isWin && ext === '.lnk' && exists(target)) {
        try {
            const info = require('electron').shell.readShortcutLink(target);
            if (info && info.target) {
                extra = [...parseArgs(info.args), ...extra];
                cwd = cwd || info.cwd || '';
                target = info.target;
                ext = path.extname(target).toLowerCase();
                if (isUri(target)) { await openUri(target, opts.args); return; }
            }
        } catch (e) { /* unreadable shortcut: start it as it is below */ }
    }

    // Games that insist on Steam: start them through Steam
    if (opts.mode !== 'direct') {
        const appId = (await steamAppForPath(target)) || (opts.mode === 'steam' ? opts.steamAppId : '');
        if (appId) { await openUri(`steam://rungameid/${appId}`, opts.args); return; }
    }

    if (process.platform === 'darwin' && ext === '.app') {
        const child = spawn('open', extra.length ? [target, '--args', ...extra] : [target], { detached: true, stdio: 'ignore' });
        child.once('error', (e) => console.error('Failed to execute game instance:', e));
        child.unref();
        return;
    }
    if (!exists(target)) return;
    cwd = cwd || path.dirname(target);
    if (isWin && opts.admin) { startElevated(target, extra, cwd); return; }
    if (isWin && (ext === '.lnk' || ext === '.url')) { startViaShell(target, extra, cwd); return; }

    const child = spawn(target, extra, { cwd, detached: true, stdio: 'ignore', windowsHide: isWin });
    // Programs that need admin rights, or can't be started this way, fail here: hand them to Windows
    child.once('error', (e) => {
        console.error('Direct start failed, trying the Windows shell:', e.message);
        if (isWin) startViaShell(target, extra, cwd);
    });
    child.unref();
}

function launch(target, options, getWin) {
    if (!target) return;
    const opts = normalizeOptions(options);
    const go = async () => {
        try { await launchNow(target, opts); } catch (e) { console.error('Failed to execute game instance:', e); }
        if (opts.minimize) { const w = getWin && getWin(); if (w && !w.isDestroyed()) w.minimize(); }
    };
    if (opts.delay > 0) setTimeout(go, opts.delay * 1000); else go();
}

/* ------------------------------------------------------------------ registration */
function register({ ipcMain, app, getWin, loadSettings, fetchSteamGridArtwork }) {
    // Take over launching and "open location" so main.js needs no other edits (call register after those handlers exist)
    ipcMain.removeAllListeners('launch-game-process');
    ipcMain.on('launch-game-process', (event, payload) => {
        launch(payload && payload.executablePath, payload && payload.options, getWin);
    });
    ipcMain.removeAllListeners('open-file-location');
    ipcMain.on('open-file-location', (event, filePath) => {
        const { shell } = require('electron');
        if (!filePath || !exists(filePath)) return;
        if (fs.statSync(filePath).isDirectory()) shell.openPath(filePath);   // imported games point at their install folder
        else shell.showItemInFolder(filePath);
    });

    /* Custom window buttons (titlebar.js): act on whichever window asked, and tell it when it is maximised / full screen */
    const { BrowserWindow } = require('electron');
    const winState = (w) => ({ maximized: !!w && w.isMaximized(), fullscreen: !!w && w.isFullScreen() });
    ipcMain.on('win-control', (event, action) => {
        const w = BrowserWindow.fromWebContents(event.sender);
        if (!w || w.isDestroyed()) return;
        if (action === 'minimize') w.minimize();
        else if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
        else if (action === 'close') w.close();
    });
    ipcMain.handle('win-state', (event) => winState(BrowserWindow.fromWebContents(event.sender)));
    app.on('browser-window-created', (e, w) => {
        const send = () => { if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('win-state-changed', winState(w)); };
        ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => w.on(ev, send));
    });

    ipcMain.handle('pick-folder', async (event) => {
        const { dialog } = require('electron');
        const w = getWin && getWin();
        const r = await dialog.showOpenDialog(w || undefined, { properties: ['openDirectory'] });
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    });

    ipcMain.handle('steam-update-status', async (event, appids) => {
        try { return await steamUpdateStates(Array.isArray(appids) ? appids.slice(0, 500) : []); }
        catch (err) { return {}; }
    });

    ipcMain.handle('scan-installed-games', async (event, existingPaths) => {
        try { return { success: true, games: await scanInstalled(Array.isArray(existingPaths) ? existingPaths : []) }; }
        catch (err) { return { success: false, error: err.message, games: [] }; }
    });

    ipcMain.on('import-games', async (event, items) => {
        if (!Array.isArray(items) || !items.length) return;
        const apiKey = (loadSettings() || {}).steamGridApiKey;
        const iconFolder = path.join(app.getPath('documents'), 'HB-Launcher', 'Icons');
        const send = (channel, payload) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload); };
        let done = 0;

        for (const item of items) {
            const name = String(item.name || '').trim();
            const launchTarget = String(item.launch || '');
            send('import-progress', { done, total: items.length, name });
            if (!name || !launchTarget) { done++; continue; }

            const gameId = `game-${Date.now()}-${done}`;
            let art = { cover: '', background: '', logo: '', icon: '' };
            try { art = await fetchSteamGridArtwork(name, apiKey, gameId); } catch (e) { /* no artwork is fine */ }

            if (!art.icon && item.iconSource && exists(item.iconSource)) {
                try {
                    const img = await app.getFileIcon(item.iconSource, { size: 'normal' });
                    fs.mkdirSync(iconFolder, { recursive: true });
                    const p = path.join(iconFolder, `${gameId}.png`);
                    fs.writeFileSync(p, img.toPNG());
                    art.icon = p;
                } catch (e) { /* keep going without an icon */ }
            }

            send('add-game-confirmed', {
                id: gameId, name, path: launchTarget, folder: item.installDir || '', source: item.store || '',
                cover: art.cover || '', background: art.background || '', logo: art.logo || '', icon: art.icon || ''
            });
            done++;
        }
        send('import-progress', { done, total: items.length, name: '', finished: true });
    });
}

module.exports = {
    register, launch, scanInstalled,
    _test: { updateStatus, titleKey, uniqueBy, norm, parseLibraryFolders, parseAppManifest, parseEpicItem, parseGogRegistry, parseArgs, normalizeOptions }
};
