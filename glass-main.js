'use strict';
/**
 * glass-main.js  (Electron MAIN process)
 *
 * Native window materials:
 *   macOS 26+   -> Liquid Glass (NSGlassEffectView via `electron-liquid-glass`)
 *   macOS <26   -> classic vibrancy fallback (what the launcher used before)
 *   Windows 11  -> Acrylic / Mica via backgroundMaterial (22H2 / build 22621+)
 *   anything else -> reports "unsupported"; the UI keeps its CSS-only look
 *
 * Modes (Settings -> Look -> Window material):
 *   auto : Windows follows the theme's `set-window-material` request (your existing behaviour),
 *          macOS is always on (your existing behaviour)
 *   on   : always use the native material, regardless of theme
 *   off  : never use it
 */
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

const DEFAULTS = { mode: 'auto', strength: 60, material: 'acrylic' };
const CORNER_RADIUS = 16;   // match your window's corner radius if the glass edge looks off
const FORCE_DARK = true;    // keep the native material dark while it is active (set false to follow the OS)

// ---- capability detection -------------------------------------------------
let liquidGlass = null;
if (isMac) {
    try {
        const mod = require('electron-liquid-glass');
        liquidGlass = mod.default || mod;
    } catch (_) { /* addon not installed or not built for this Electron */ }
}

const darwinMajor = isMac ? parseInt(os.release(), 10) : 0;          // Darwin 25 == macOS 26
const winBuild = isWin ? parseInt(os.release().split('.')[2], 10) || 0 : 0;

let kind = null; // 'liquid' | 'vibrancy' | 'acrylic' | null
if (isMac) {
    const glassOk = liquidGlass && darwinMajor >= 25 &&
        (typeof liquidGlass.isGlassSupported !== 'function' || liquidGlass.isGlassSupported());
    kind = glassOk ? 'liquid' : 'vibrancy';
} else if (isWin && winBuild >= 22621) {
    kind = 'acrylic';
}

// ---- settings (own file, so the launcher's settings.json is never touched) -
const settingsPath = () => path.join(app.getPath('userData'), 'glass-settings.json');

function load() {
    try {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
    } catch (_) {
        return { ...DEFAULTS };
    }
}
function save(s) {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (_) {}
}

// What the current theme asked for through 'set-window-material' (true until told otherwise).
let themeWantsGlass = true;

function wantsOn(s) {
    if (s.mode === 'on') return true;
    if (s.mode === 'off') return false;
    return isWin ? themeWantsGlass : true; // auto
}

// ---- window options (call BEFORE creating the window) ---------------------
function windowOptions(base = {}) {
    const on = wantsOn(load());
    const o = { ...base };
    if (isMac) {
        delete o.vibrancy; // never combine vibrancy with Liquid Glass
        if (kind === 'liquid') {
            o.transparent = true;
            o.backgroundColor = '#00000000';
        } else if (on) {
            o.vibrancy = 'under-window';
        }
    } else if (isWin) {
        delete o.transparent; // transparent:true breaks resizing/snapping on Windows
        o.backgroundColor = '#00000000';
        if (kind === 'acrylic' && on) o.backgroundMaterial = load().material;
    }
    return o;
}

// ---- applying a material at runtime ---------------------------------------
const glassViews = new WeakMap(); // win -> liquid glass view id

function apply(win, s) {
    if (!win || win.isDestroyed() || !kind) return 'unsupported';
    const on = wantsOn(s);

    if (FORCE_DARK) nativeTheme.themeSource = on ? 'dark' : 'system';

    if (isMac) {
        if (kind === 'liquid') {
            if (on && !glassViews.has(win)) {
                try {
                    win.setWindowButtonVisibility(true);
                    glassViews.set(win, liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: CORNER_RADIUS }));
                } catch (e) {
                    console.warn('[glass] Liquid Glass failed:', e.message);
                    return 'unsupported';
                }
            }
            // "Off" keeps the view but the UI paints an opaque layer over it.
            return on ? 'liquid' : 'off';
        }
        win.setVibrancy(on ? 'under-window' : null);
        return on ? 'vibrancy' : 'off';
    }

    if (typeof win.setBackgroundMaterial !== 'function') return 'unsupported';
    try {
        win.setBackgroundMaterial(on ? s.material : 'none');
    } catch (e) {
        console.warn('[glass] background material failed:', e.message);
        return 'unsupported';
    }
    return on ? s.material : 'off';
}

function info(win, state) {
    const settings = load();
    return {
        settings,
        caps: { kind, supported: !!kind, windowsBuild: winBuild, darwin: darwinMajor },
        state: state || apply(win, settings),
    };
}

// ---- theme hook: replaces the old 'set-window-material' behaviour ----------
function applyThemeMaterial(win, material) {
    themeWantsGlass = ['acrylic', 'mica', 'glass', 'liquid'].includes(material);
    if (!win || win.isDestroyed()) return;
    const s = load();
    if (!isWin || s.mode !== 'auto') return; // macOS stays on; on/off modes ignore the theme
    const state = apply(win, s);
    win.webContents.send('glass:changed', info(win, state));
}

// ---- IPC ------------------------------------------------------------------
ipcMain.handle('glass:get', (e) => info(BrowserWindow.fromWebContents(e.sender)));

ipcMain.handle('glass:set', (e, patch = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const s = load();
    if (['auto', 'on', 'off'].includes(patch.mode)) s.mode = patch.mode;
    if (Number.isFinite(patch.strength)) s.strength = Math.max(0, Math.min(100, Math.round(patch.strength)));
    if (['acrylic', 'mica'].includes(patch.material)) s.material = patch.material;
    save(s);
    return info(win, apply(win, s));
});

function attach(win) {
    // Apply once the native window exists and the page has loaded.
    win.webContents.once('did-finish-load', () => apply(win, load()));
}

module.exports = { windowOptions, attach, applyThemeMaterial, kind };
