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
    return [...new Set(roots.filter(exists).map(r => path.resolve(r)))];
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
    return { appid: pick('appid'), name: pick('name'), installdir: pick('installdir'), state: parseInt(pick('StateFlags'), 10) || 0 };
}

async function scanSteam() {
    const found = [];
    const libraries = new Set();
    for (const root of await steamRoots()) {
        libraries.add(root);
        const vdf = readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
        for (const lib of parseLibraryFolders(vdf)) libraries.add(path.resolve(lib));
    }
    for (const lib of libraries) {
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
async function scanInstalled(existingPaths = []) {
    const [steam, epic, gog] = await Promise.all([
        scanSteam().catch(() => []), scanEpic().catch(() => []), scanGog().catch(() => [])
    ]);
    const have = existingPaths.map(norm).filter(Boolean);
    const alreadyAdded = (g) => {
        const launch = norm(g.launch), dir = norm(g.installDir);
        return have.some(p => p === launch || (dir && (p === dir || p.startsWith(dir + '/'))));
    };
    return [...steam, ...epic, ...gog]
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
        minimize: !!o.minimize
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

function startElevated(target, args) {
    let cmd = `Start-Process -FilePath ${psQuote(target)} -WorkingDirectory ${psQuote(path.dirname(target))} -Verb RunAs`;
    if (args.length) cmd += ` -ArgumentList ${psQuote(args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '))}`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
        { windowsHide: true }, (err) => { if (err) console.error('Elevated launch failed:', err.message); });
}

function launchNow(target, opts) {
    const args = parseArgs(opts.args);
    const isUri = /^[a-z][a-z\d+.-]*:\/\//i.test(target);
    const ext = path.extname(target).toLowerCase();
    const isWin = process.platform === 'win32';

    if (isUri) {
        let uri = target;
        const steam = target.match(/^steam:\/\/rungameid\/(\d+)/i);
        if (steam && opts.args) uri = `steam://run/${steam[1]}//${encodeURIComponent(opts.args)}/`;
        require('electron').shell.openExternal(uri).catch((e) => console.error('Failed to open', uri, e.message));
        return;
    }
    if (process.platform === 'darwin' && ext === '.app') {
        const child = spawn('open', args.length ? [target, '--args', ...args] : [target], { detached: true, stdio: 'ignore' });
        child.once('error', (e) => console.error('Failed to execute game instance:', e));
        child.unref();
        return;
    }
    if (!exists(target)) return;
    if (isWin && opts.admin) { startElevated(target, args); return; }
    const child = (isWin && (ext === '.lnk' || ext === '.url'))
        ? spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(target, args, { cwd: path.dirname(target), detached: true, stdio: 'ignore', windowsHide: isWin });
    child.once('error', (e) => console.error('Failed to execute game instance:', e));
    child.unref();
}

function launch(target, options, getWin) {
    if (!target) return;
    const opts = normalizeOptions(options);
    const go = () => {
        try { launchNow(target, opts); } catch (e) { console.error('Failed to execute game instance:', e); }
        if (opts.minimize) { const w = getWin && getWin(); if (w && !w.isDestroyed()) w.minimize(); }
    };
    if (opts.delay > 0) setTimeout(go, opts.delay * 1000); else go();
}

/* ------------------------------------------------------------------ registration */
function register({ ipcMain, app, getWin, loadSettings, fetchSteamGridArtwork }) {
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
    _test: { parseLibraryFolders, parseAppManifest, parseEpicItem, parseGogRegistry, parseArgs, normalizeOptions }
};
