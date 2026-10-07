const { ipcRenderer, webFrame } = require('electron');
const fs = require('fs');

const library = document.getElementById('library');
const contentWrapper = document.getElementById('contentWrapper');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 
const addBtn = document.getElementById('addBtn');

let SAVE_PATH = null;
let currentWindowMaterial = null;

let gameData = {};
let sortedIds = [];
let currentEditingId = null;
let pendingAddGamePath = null;
const iconCache = {}; 

let viewMode = 'list';
let selectedListId = null;
let isFullScreenPreviewActive = false;
let currentHeroImage = null;
let heroImageRequestId = 0;
let steamMediaRequestId = 0;

let isControllerMode = false;
let currentZone = 'library'; 
let focusIndex = 0;
let headerFocusIndex = 0;
let modalFocusIndex = 0;
let customizeActionMode = false;
let customizeActionIndex = 0;
let renameFocusIndex = 0;
let dashFocusIndex = 0;
let lastMoveTime = 0;
let lastButtonState = new Array(20).fill(false);
let lastActiveGamepadIndex = null;

async function loadLibrary() {
    try {
        SAVE_PATH = await ipcRenderer.invoke('get-user-data-path');
        if (!SAVE_PATH || !fs.existsSync(SAVE_PATH)) return;

        const parsed = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf-8'));
        if (parsed.gameData) {
            gameData = parsed.gameData;
        } else {
            gameData = parsed;
            if (gameData.gameData) delete gameData.gameData;
        }
        Object.values(gameData).forEach(d => {
            if (d && typeof d === 'object') {
                d.favorite ??= false;
                d.background ??= '';
                d.icon ??= '';
                d.logo ??= '';
                d.lastPlayed ??= 0;
                d.heroLogoScale ??= 100;
                d.heroLogoPosition ??= 'bottom-left';
                d.heroLogoX ??= 50;
                d.heroLogoY ??= 50;
                d.heroLogoSnapToGrid ??= false;
            }
        });
    } catch (e) {
        console.error('Error loading data file:', e);
    } finally {
        renderLibrary();
    }
}

const saveToDisk = () => { 
    if (!SAVE_PATH) return;
    fs.writeFileSync(SAVE_PATH, JSON.stringify(gameData, null, 2), 'utf-8');
};

function getArtworkPathsInUse(excludeId = null) {
    return Object.entries(gameData)
        .filter(([id]) => id !== excludeId)
        .flatMap(([, game]) => [game.cover, game.icon, game.background, game.logo])
        .filter(Boolean);
}

let currentSettings = { theme: 'dark', steamGridApiKey: '', customColors: {}, customFonts: {}, customLayout: {} };

function ensureSettingsDefaults(settings) {
    if (!settings || typeof settings !== 'object') settings = {};
    settings.theme ??= 'dark';
    settings.steamGridApiKey ??= '';
    settings.customColors = settings.customColors || {};
    settings.customFonts = settings.customFonts || {};
    settings.customLayout = settings.customLayout || {};
    settings.customColors.background ??= getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#1a1a1a';
    settings.customColors.surface ??= getComputedStyle(document.documentElement).getPropertyValue('--card-bg') || '#2a2a2a';
    settings.customColors.text ??= getComputedStyle(document.documentElement).getPropertyValue('--text') || '#e0e0e0';
    settings.customColors.accent ??= getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#6366f1';
    settings.customFonts.family ??= document.body.style.fontFamily || '';
    settings.customFonts.sizeBase ??= document.body.style.fontSize || '';
    settings.customLayout.customScaleEnabled ??= false;
    settings.customLayout.customScale ??= 100;
    settings.customLayout.useLogoOnHero ??= true;
    return settings;
}

async function loadSettings() {
    try {
        const loaded = await ipcRenderer.invoke('get-settings');
        currentSettings = ensureSettingsDefaults(loaded);
        applySettings(currentSettings);
    } catch (err) {
        console.error('Error loading settings:', err);
        currentSettings = ensureSettingsDefaults(currentSettings);
        applySettings(currentSettings);
    }
}

function getAccentTextColor(accentHex) {
    try {
        return luminance(hexToRgb(accentHex)) > 0.179 ? '#111111' : '#ffffff';
    } catch (e) { return '#ffffff'; }
}

const applySettings = (settings) => {
    const root = document.documentElement;
    const colors = settings.customColors || {};
    
    if (colors.background) root.style.setProperty('--bg', colors.background);
    if (colors.surface) root.style.setProperty('--card-bg', colors.surface);
    if (colors.text) root.style.setProperty('--text', colors.text);
    if (colors.accent) root.style.setProperty('--accent', colors.accent);
    root.style.setProperty('--accent-contrast', getAccentTextColor(colors.accent || getComputedStyle(root).getPropertyValue('--accent').trim()));
    const isAcrylicTheme = settings.theme === 'liquidGlass';
    document.body.classList.toggle('windows-acrylic-theme', isAcrylicTheme);
    const windowMaterial = isAcrylicTheme ? 'acrylic' : 'none';
    if (currentWindowMaterial !== windowMaterial) {
        currentWindowMaterial = windowMaterial;
        ipcRenderer.send('set-window-material', windowMaterial);
    }
    
    const fonts = settings.customFonts || {};
    if (fonts.sizeBase) document.body.style.fontSize = fonts.sizeBase;
    if (fonts.family) document.body.style.fontFamily = fonts.family;
    
    const layout = settings.customLayout || {};
    const customScale = Math.max(75, Math.min(200, Number(layout.customScale) || 100));
    try {
        webFrame.setZoomFactor(layout.customScaleEnabled ? customScale / 100 : 1);
    } catch (e) { console.error('Error applying interface scale:', e); }
    applyHeroLogoSettings();

    try {
        const bg = (colors.background || getComputedStyle(root).getPropertyValue('--bg') || '#000').trim();
        const surface = (colors.surface || getComputedStyle(root).getPropertyValue('--card-bg') || '#111').trim();
        const backgroundLuminance = luminance(hexToRgb(bg));
        const detailSurface = adjustHex(bg, backgroundLuminance < 0.5 ? 5 : -5);
        const detailLuminance = luminance(hexToRgb(detailSurface));
        root.style.setProperty('--detail-surface', detailSurface);
        root.style.setProperty('--detail-text', detailLuminance > 0.179 ? '#111' : '#fff');
        const isPreset = settings.theme && settings.theme !== 'custom';
        const headerColor = isPreset
            ? getAutoHeaderTextColor(surface || bg)
            : (colors.text || getComputedStyle(root).getPropertyValue('--text') || '#ffffff').trim();
        root.style.setProperty('--header-text', headerColor);

        const headerEl = document.getElementById('appHeader');
        if (headerEl) {
            headerEl.style.color = headerColor;
            const headerTitle = headerEl.querySelector('h1');
            if (headerTitle) headerTitle.style.color = headerColor;
            headerEl.querySelectorAll('input, select, button, .control-btn').forEach(element => {
                element.style.color = headerColor;
            });
        }

        const cardTextSelectors = [
            '.game-card .info-overlay div', '.game-card .fallback-title', '.game-card .list-title',
            '.game-card .fav-badge', '.dp-title', '.menu-btn', '.modal-content', '.menu-options', '.dash-btn:not(.play-themed-btn)'
        ];
        document.querySelectorAll(cardTextSelectors.join(', ')).forEach(element => {
            element.style.color = headerColor;
        });

        let hover;
        try {
            const surfLum = luminance(hexToRgb(surface));
            hover = surfLum < 0.5 ? adjustHex(surface, 8) : adjustHex(surface, -6);
        } catch (e) {
            hover = 'rgba(255,255,255,0.06)';
        }
        root.style.setProperty('--card-bg-hover', hover);
    } catch (e) { console.error('Error computing derived theme colors:', e); }
};

function hexToRgb(hex) {
    hex = hex.replace('#','').trim();
    if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
    const num = parseInt(hex,16);
    return { r: (num>>16)&255, g: (num>>8)&255, b: num&255 };
}

function luminance({r,g,b}) {
    const srgb = [r,g,b].map(v=>{
        v/=255;
        return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    });
    return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
}

function adjustHex(hex, percent) {
    const {r,g,b} = hexToRgb(hex);
    const amt = Math.round(255 * (percent/100));
    const nr = Math.max(0, Math.min(255, r + amt));
    const ng = Math.max(0, Math.min(255, g + amt));
    const nb = Math.max(0, Math.min(255, b + amt));
    return `#${((1<<24) + (nr<<16) + (ng<<8) + nb).toString(16).slice(1)}`;
}

function getAutoHeaderTextColor(bgHex) {
    try {
        const rgb = hexToRgb(bgHex);
        const lum = luminance(rgb);
        if (lum < 0.25) return '#ffffff';
        if (lum < 0.7) return '#888888';
        return '#000000';
    } catch (e) { return '#ffffff'; }
}

let activeSettingsTab = 'appearance';
let settingsFocusIndex = 0;
let settingsFocusedElement = null;

function getSettingsFocusableElements() {
    return Array.from(document.querySelectorAll(
        '#settingsModal .settings-tab, #settingsModal .settings-mode-option, #themePresets button, #settingsModal summary, #settingsModal input:not([disabled]), #settingsModal .settings-actions button'
    )).filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'));
}

function applySettingsFocus() {
    const elements = getSettingsFocusableElements();
    if (!elements.length) return;
    settingsFocusIndex = Math.max(0, Math.min(settingsFocusIndex, elements.length - 1));
    document.querySelectorAll('#settingsModal .settings-focused').forEach((element) => element.classList.remove('settings-focused'));
    settingsFocusedElement = elements[settingsFocusIndex];
    settingsFocusedElement.classList.add('settings-focused');
    settingsFocusedElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

function moveSettingsFocus(horizontal, vertical) {
    const elements = getSettingsFocusableElements();
    if (!elements.length) return;
    const currentIndex = elements.indexOf(settingsFocusedElement);
    if (currentIndex < 0) {
        settingsFocusIndex = 0;
        applySettingsFocus();
        return;
    }

    const current = elements[currentIndex];
    if (horizontal && current.matches('#themePresets .theme-option')) {
        const currentRect = current.getBoundingClientRect();
        const currentX = currentRect.left + currentRect.width / 2;
        const currentY = currentRect.top + currentRect.height / 2;
        const sameRow = elements.filter((element) => {
            if (!element.matches('#themePresets .theme-option') || element === current) return false;
            const rect = element.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            return Math.abs(centerY - currentY) <= Math.max(currentRect.height, rect.height) * 0.55;
        });
        const neighbor = sameRow
            .map((element) => ({
                element,
                distance: (element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2 - currentX) * horizontal
            }))
            .filter((candidate) => candidate.distance > 0)
            .sort((a, b) => a.distance - b.distance)[0];
        if (neighbor) {
            settingsFocusIndex = elements.indexOf(neighbor.element);
            applySettingsFocus();
        }
        return;
    }
    if (horizontal && current.type === 'range' && !current.disabled) {
        const step = Number(current.step) || 1;
        current.value = String(Math.max(Number(current.min), Math.min(Number(current.max), Number(current.value) + horizontal * step)));
        current.dispatchEvent(new Event('input', { bubbles: true }));
        current.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    const currentRect = current.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let nextIndex = currentIndex;
    let bestScore = Infinity;
    elements.forEach((element, index) => {
        if (index === currentIndex) return;
        const rect = element.getBoundingClientRect();
        const deltaX = rect.left + rect.width / 2 - currentX;
        const deltaY = rect.top + rect.height / 2 - currentY;
        const primary = horizontal ? deltaX * horizontal : deltaY * vertical;
        if (primary <= 0) return;
        const perpendicular = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);
        const score = primary + perpendicular * 1.5;
        if (score < bestScore) {
            bestScore = score;
            nextIndex = index;
        }
    });
    if (nextIndex !== currentIndex) {
        settingsFocusIndex = nextIndex;
        applySettingsFocus();
    }
}

function activateSettingsTab(tabName) {
    activeSettingsTab = tabName;
    document.querySelectorAll('.settings-tab').forEach((tab) => {
        const isActive = tab.dataset.settingsTab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });
    document.querySelectorAll('.settings-panel').forEach((panel) => {
        panel.hidden = panel.dataset.settingsPanel !== tabName;
    });
    if (currentZone === 'settingsModal' && isControllerMode) requestAnimationFrame(applySettingsFocus);
}

function activateThemeMode(mode, focusButton = null) {
    const activeMode = mode === 'themes' ? 'themes' : 'custom';
    document.querySelectorAll('.settings-mode-option').forEach((button) => {
        const isActive = button.dataset.themeMode === activeMode;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('[data-theme-view]').forEach((view) => {
        view.hidden = view.dataset.themeView !== activeMode;
    });
    if (activeMode === 'custom') currentSettings.theme = 'custom';

    if (currentZone === 'settingsModal' && isControllerMode) {
        requestAnimationFrame(() => {
            const elements = getSettingsFocusableElements();
            const target = focusButton || document.querySelector(`[data-theme-mode="${activeMode}"]`);
            const targetIndex = elements.indexOf(target);
            if (targetIndex >= 0) settingsFocusIndex = targetIndex;
            applySettingsFocus();
        });
    }
}

document.querySelectorAll('.settings-mode-option').forEach((button) => {
    button.addEventListener('click', () => activateThemeMode(button.dataset.themeMode, button));
});

document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => activateSettingsTab(tab.dataset.settingsTab));
    tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        const tabs = Array.from(document.querySelectorAll('.settings-tab'));
        const currentIndex = tabs.indexOf(tab);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
        event.preventDefault();
        nextTab.focus();
        activateSettingsTab(nextTab.dataset.settingsTab);
    });
});

const showSettingsModal = async () => {
    try {
        const themes = await ipcRenderer.invoke('get-all-themes');
        const presetsContainer = document.getElementById('themePresets');
        if (!presetsContainer) {
            openModal('settings');
            return;
        }
        presetsContainer.innerHTML = '';

        themes.forEach(theme => {
            try {
                const btn = document.createElement('button');
                btn.className = 'theme-option';
                btn.dataset.themeId = theme.id;
                btn.setAttribute('aria-pressed', String(currentSettings.theme === theme.id));
                btn.innerHTML = '<span class="theme-option-swatch" aria-hidden="true"></span><span class="theme-option-copy"><span class="theme-option-name"></span><small class="theme-option-note" hidden></small></span>';
                btn.querySelector('.theme-option-name').textContent = theme.name;
                const note = btn.querySelector('.theme-option-note');
                if (theme.experimental) {
                    note.id = `theme-performance-${theme.id}`;
                    note.textContent = 'Experimental; blur may affect older GPUs.';
                    note.hidden = false;
                    btn.setAttribute('aria-describedby', note.id);
                }
                btn.querySelector('.theme-option-swatch').style.backgroundColor = theme.preview.colors.accent;
                btn.onclick = async () => {
                    try {
                        const preset = await ipcRenderer.invoke('get-theme-preset', theme.id);
                        currentSettings.theme = theme.id;
                        currentSettings.customColors = { ...preset.colors };
                        currentSettings.customFonts = { ...preset.fonts };
                        presetsContainer.querySelectorAll('.theme-option').forEach((option) => option.setAttribute('aria-pressed', 'false'));
                        btn.setAttribute('aria-pressed', 'true');
                        updateColorInputs();
                        applySettings(currentSettings);
                    } catch (e) { console.error('Error applying preset:', e); }
                };
                presetsContainer.appendChild(btn);
            } catch (e) { console.error('Error creating theme button:', e); }
        });

        updateColorInputs();
        activateThemeMode(currentSettings.theme === 'custom' ? 'custom' : 'themes');
        activateSettingsTab(activeSettingsTab);
        openModal('settings');
    } catch (err) {
        console.error('Error showing settings:', err);
        try { openModal('settings'); } catch (e) {}
    }
};

const updateColorInputs = () => {
    document.getElementById('steamGridApiKey').value = currentSettings.steamGridApiKey || '';
    document.getElementById('colorBg').value = currentSettings.customColors.background || '#1a1a1a';
    document.getElementById('colorAccent').value = currentSettings.customColors.accent || '#6366f1';
    document.getElementById('colorText').value = currentSettings.customColors.text || '#e0e0e0';
    document.getElementById('colorCard').value = currentSettings.customColors.surface || '#2a2a2a';
    const customScaleEnabledEl = document.getElementById('customScaleEnabled');
    const customScaleEl = document.getElementById('customScale');
    const customScaleValueEl = document.getElementById('customScaleValue');
    const customScaleEnabled = !!currentSettings.customLayout?.customScaleEnabled;
    const customScale = Math.max(75, Math.min(200, Number(currentSettings.customLayout?.customScale) || 100));
    if (customScaleEnabledEl) customScaleEnabledEl.checked = customScaleEnabled;
    if (customScaleEl) {
        customScaleEl.value = customScale;
        customScaleEl.disabled = !customScaleEnabled;
    }
    if (customScaleValueEl) customScaleValueEl.textContent = `${customScale}%`;
    const useLogoEl = document.getElementById('useLogoOnHero');
    if (useLogoEl) useLogoEl.checked = !!currentSettings.customLayout?.useLogoOnHero;
};

const saveSettings = async () => {
    try {
        currentSettings.customColors = currentSettings.customColors || {};
        currentSettings.customLayout = currentSettings.customLayout || {};

        const apiKeyEl = document.getElementById('steamGridApiKey');
        const colorBgEl = document.getElementById('colorBg');
        const colorAccentEl = document.getElementById('colorAccent');
        const colorTextEl = document.getElementById('colorText');
        const colorCardEl = document.getElementById('colorCard');

        if (apiKeyEl) currentSettings.steamGridApiKey = apiKeyEl.value.trim();
        if (colorBgEl) currentSettings.customColors.background = colorBgEl.value;
        if (colorAccentEl) currentSettings.customColors.accent = colorAccentEl.value;
        if (colorTextEl) currentSettings.customColors.text = colorTextEl.value;
        if (colorCardEl) currentSettings.customColors.surface = colorCardEl.value;
        const customScaleEnabledEl = document.getElementById('customScaleEnabled');
        const customScaleEl = document.getElementById('customScale');
        if (customScaleEnabledEl) currentSettings.customLayout.customScaleEnabled = customScaleEnabledEl.checked;
        if (customScaleEl) currentSettings.customLayout.customScale = Number(customScaleEl.value);
        const useLogoEl = document.getElementById('useLogoOnHero');
        if (useLogoEl) currentSettings.customLayout.useLogoOnHero = !!useLogoEl.checked;
        currentSettings = ensureSettingsDefaults(currentSettings);

        const safeSettings = {
            theme: currentSettings.theme,
            steamGridApiKey: currentSettings.steamGridApiKey,
            customColors: { ...(currentSettings.customColors || {}) },
            customFonts: { ...(currentSettings.customFonts || {}) },
            customLayout: { ...(currentSettings.customLayout || {}) },
            windowSize: currentSettings.windowSize || {}
        };

        const result = await ipcRenderer.invoke('save-settings', safeSettings);
        if (result && result.success) {
            currentSettings = ensureSettingsDefaults(safeSettings);
            applySettings(currentSettings);
            closeModal();
        } else {
            alert('Failed to save settings');
        }
    } catch (err) {
        console.error('Error saving settings:', err);
        alert('Failed to save settings: ' + err.message);
    }
};

let settingsBtn = document.getElementById('settingsBtn');
if (!settingsBtn) settingsBtn = document.querySelector('[data-header-idx="4"]');
if (settingsBtn) {
    settingsBtn.onclick = (e) => {
        try {
            e.preventDefault();
            showSettingsModal();
        } catch (err) {
            console.error('Error opening settings modal:', err);
        }
    };
}

const ensureSettingsButtonsReady = () => {
    const saveBtn = document.getElementById('saveSettingsBtn');
    const closeBtn = document.getElementById('closeSettingsBtn');
    
    if (saveBtn) {
        saveBtn.onclick = (e) => {
            e.preventDefault();
            saveSettings();
        };
    }
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.preventDefault();
            closeModal();
        };
    }
};

ensureSettingsButtonsReady();

const customScaleEnabledEl = document.getElementById('customScaleEnabled');
const customScaleEl = document.getElementById('customScale');
const customScaleValueEl = document.getElementById('customScaleValue');
if (customScaleEnabledEl) {
    customScaleEnabledEl.addEventListener('change', () => {
        customScaleEl.disabled = !customScaleEnabledEl.checked;
        currentSettings.customLayout.customScaleEnabled = customScaleEnabledEl.checked;
        applySettings(currentSettings);
    });
}
if (customScaleEl) {
    customScaleEl.addEventListener('input', () => {
        if (customScaleValueEl) customScaleValueEl.textContent = `${customScaleEl.value}%`;
    });
    customScaleEl.addEventListener('change', () => {
        currentSettings.customLayout.customScale = Number(customScaleEl.value);
        applySettings(currentSettings);
    });
}

ipcRenderer.on('settings-updated', (settings) => {
    currentSettings = ensureSettingsDefaults(settings);
    applySettings(currentSettings);
});

loadSettings();

const applyLayoutMode = () => {
    if (!isFullScreenMode) {
        viewMode = 'list';
        isFullScreenPreviewActive = false;
    } else {
        if (!isFullScreenPreviewActive) viewMode = 'grid';
    }
    contentWrapper.className = `content-wrapper ${viewMode}-mode`;
    document.body.classList.toggle('full-screen-preview', isFullScreenPreviewActive);
    renderLibrary();
};

let isFullScreenMode = false;

const enterFullScreenPreview = () => {
    if (!isFullScreenMode) return;
    isFullScreenPreviewActive = true;
    document.body.classList.add('full-screen-preview');
    contentWrapper.className = `content-wrapper ${viewMode}-mode`;
    currentZone = 'detail-panel';
    dashFocusIndex = 0;
    applyFocus();
};

const exitFullScreenPreview = () => {
    if (!isFullScreenPreviewActive) return;
    isFullScreenPreviewActive = false;
    document.body.classList.remove('full-screen-preview');
    currentZone = 'library';
    focusIndex = sortedIds.indexOf(selectedListId);
    if (focusIndex < 0) focusIndex = 0;
    applyFocus();
};

const updateFullScreenButton = (isFull) => {
    isFullScreenMode = !!isFull;
    if (fullScreenBtn) {
        fullScreenBtn.innerText = isFull ? '🗗 Exit Full Screen' : '⛶ Full Screen';
    }
    document.body.classList.toggle('full-screen-mode', isFull);
    if (!isFull) {
        exitFullScreenPreview();
    }
    applyLayoutMode();
};

if (fullScreenBtn) {
    fullScreenBtn.onclick = () => {
        ipcRenderer.send('set-fullscreen', !isFullScreenMode);
    };
}

ipcRenderer.on('fullscreen-changed', (event, isFull) => {
    updateFullScreenButton(isFull);
});

addBtn.onclick = () => {
    ipcRenderer.send('add-game-requested');
};

sortSelect.onchange = () => renderLibrary();
librarySearch.oninput = () => renderLibrary();

function formatLastPlayed(timestamp) {
    if (!timestamp) return 'Never played';
    const playedAt = new Date(timestamp);
    if (Number.isNaN(playedAt.getTime())) return 'Never played';

    const today = new Date();
    const dayNumber = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const daysAgo = dayNumber(today) - dayNumber(playedAt);
    if (daysAgo <= 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo < 7) return 'A few days ago';
    return playedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const launchItem = (id) => { 
    if (gameData[id]?.path) { 
        gameData[id].lastPlayed = Date.now();
        saveToDisk(); 
        document.getElementById('dashLastPlayed').innerText = formatLastPlayed(gameData[id].lastPlayed);
        ipcRenderer.send('launch-game-process', { id, executablePath: gameData[id].path }); 
    }
};

function applyPlayButtonColor(image) {
    const button = document.getElementById('dpPlayBtn');
    if (!button) return;
    const managementButtons = document.querySelectorAll('.dp-management-actions .dash-btn');

    try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const buckets = new Map();
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 128) continue;
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const key = `${red >> 3},${green >> 3},${blue >> 3}`;
            const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
            bucket.count++;
            bucket.red += red;
            bucket.green += green;
            bucket.blue += blue;
            buckets.set(key, bucket);
        }

        const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
        if (!dominant) throw new Error('No opaque image colors found');

        const red = Math.round(dominant.red / dominant.count);
        const green = Math.round(dominant.green / dominant.count);
        const blue = Math.round(dominant.blue / dominant.count);
        const toLinear = value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        };
        const luminance = 0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);

        button.style.setProperty('--play-color', `rgb(${red}, ${green}, ${blue})`);
        const contrastColor = luminance > 0.179 ? '#000' : '#fff';
        button.style.setProperty('--play-text-color', contrastColor);
        button.style.setProperty('--play-outline-color', contrastColor);
        managementButtons.forEach((actionButton) => {
            actionButton.style.setProperty('--play-color', `rgb(${red}, ${green}, ${blue})`);
            actionButton.style.setProperty('--play-text-color', contrastColor);
        });
    } catch (error) {
        button.style.removeProperty('--play-color');
        button.style.removeProperty('--play-text-color');
        button.style.removeProperty('--play-outline-color');
        managementButtons.forEach((actionButton) => {
            actionButton.style.removeProperty('--play-color');
            actionButton.style.removeProperty('--play-text-color');
        });
    }
}

function resetPlayButtonColor() {
    const button = document.getElementById('dpPlayBtn');
    if (!button) return;
    button.style.removeProperty('--play-color');
    button.style.removeProperty('--play-text-color');
    button.style.removeProperty('--play-outline-color');
    document.querySelectorAll('.dp-management-actions .dash-btn').forEach((actionButton) => {
        actionButton.style.removeProperty('--play-color');
        actionButton.style.removeProperty('--play-text-color');
    });
}

function applyHeroLogoSettings(game = selectedListId ? gameData[selectedListId] : null) {
    const logoContainer = document.getElementById('dpLogoContainer');
    if (!logoContainer) return;

    applyLogoPosition(logoContainer, game?.heroLogoPosition || 'bottom-left', game);

    const logoImage = logoContainer.querySelector('img');
    if (logoImage) {
        logoImage.onload = () => applyLogoImageScale(logoImage, game, logoContainer.parentElement);
        applyLogoImageScale(logoImage, game, logoContainer.parentElement);
    }
}

function getLogoScale(game) {
    return Math.max(25, Math.min(250, Number(game?.heroLogoScale) || 100));
}

function applyLogoImageScale(image, game, container) {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const windowScale = Math.max(0.45, Math.min(1.25, (container?.clientWidth || 1200) / 1200));
    const height = 64 * (getLogoScale(game) / 100) * windowScale;
    image.style.maxWidth = 'none';
    image.style.maxHeight = 'none';
    image.style.height = `${height}px`;
    image.style.width = `${height * image.naturalWidth / image.naturalHeight}px`;
}

function applyLogoPosition(element, position, game = {}) {
    const positions = {
        'bottom-left': { x: 5, y: 82, transform: 'translate(0, -50%)' },
        'bottom-right': { x: 95, y: 82, transform: 'translate(-100%, -50%)' },
        'top-left': { x: 5, y: 18, transform: 'translate(0, -50%)' },
        'top-right': { x: 95, y: 18, transform: 'translate(-100%, -50%)' },
        center: { x: 50, y: 50, transform: 'translate(-50%, -50%)' }
    };
    const selectedPosition = position === 'custom'
        ? { x: Number(game.heroLogoX) || 50, y: Number(game.heroLogoY) || 50, transform: 'translate(-50%, -50%)' }
        : positions[position] || positions['bottom-left'];

    element.style.left = `${selectedPosition.x}%`;
    element.style.top = `${selectedPosition.y}%`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = selectedPosition.transform;
}

function updateLogoLivePreview(game, forceReload = false) {
    const preview = document.getElementById('logoLivePreview');
    if (!preview) return;

    const backgroundPath = game?.background || game?.cover;
    const logoPath = game?.logo || game?.icon;
    if (forceReload) {
        preview.dataset.backgroundPath = '';
        const existingLogo = preview.querySelector('img');
        if (existingLogo) existingLogo.dataset.logoPath = '';
    }
    if (preview.dataset.backgroundPath !== (backgroundPath || '')) {
        preview.dataset.backgroundPath = backgroundPath || '';
        preview.style.backgroundImage = backgroundPath
            ? `url('local-image://asset?path=${encodeURIComponent(backgroundPath)}${forceReload ? `&t=${Date.now()}` : ''}')`
            : 'none';
        preview.style.aspectRatio = '16 / 9';

        if (backgroundPath) {
            const backgroundImage = new Image();
            backgroundImage.onload = () => {
                if (preview.dataset.backgroundPath === backgroundPath) {
                    preview.style.aspectRatio = `${backgroundImage.naturalWidth} / ${backgroundImage.naturalHeight}`;
                }
            };
            backgroundImage.src = `local-image://asset?path=${encodeURIComponent(backgroundPath)}${forceReload ? `&t=${Date.now()}` : ''}`;
        }
    }

    let logoImage = preview.querySelector('img');
    if (!logoPath) {
        if (logoImage) logoImage.remove();
        return;
    }

    if (!logoImage) {
        logoImage = document.createElement('img');
        preview.appendChild(logoImage);
    }
    if (logoImage.dataset.logoPath !== logoPath) {
        logoImage.dataset.logoPath = logoPath;
        logoImage.src = `local-image://asset?path=${encodeURIComponent(logoPath)}${forceReload ? `&t=${Date.now()}` : ''}`;
    }
    applyLogoPosition(logoImage, game.heroLogoPosition || 'bottom-left', game);
    logoImage.onload = () => applyLogoImageScale(logoImage, game, preview);
    applyLogoImageScale(logoImage, game, preview);
}

function updateGameLogoControls(game) {
    const scaleControl = document.getElementById('gameLogoScale');
    const scaleValue = document.getElementById('gameLogoScaleValue');
    const positionControl = document.getElementById('gameLogoPosition');
    const snapControl = document.getElementById('gameLogoSnapToGrid');
    const logoScale = getLogoScale(game);
    if (scaleControl) scaleControl.value = logoScale;
    if (scaleValue) scaleValue.textContent = `${logoScale}%`;
    if (positionControl) positionControl.value = game?.heroLogoPosition || 'bottom-left';
    if (snapControl) snapControl.checked = !!game?.heroLogoSnapToGrid;
}

const gameLogoScaleControl = document.getElementById('gameLogoScale');
if (gameLogoScaleControl) {
    gameLogoScaleControl.addEventListener('input', () => {
        if (!currentEditingId || !gameData[currentEditingId]) return;
        const value = Number(gameLogoScaleControl.value);
        gameData[currentEditingId].heroLogoScale = value;
        const valueLabel = document.getElementById('gameLogoScaleValue');
        if (valueLabel) valueLabel.textContent = `${value}%`;
        saveToDisk();
        updateLogoLivePreview(gameData[currentEditingId]);
        if (selectedListId === currentEditingId) {
            applyHeroLogoSettings(gameData[currentEditingId]);
        }
    });
}

const gameLogoPositionControl = document.getElementById('gameLogoPosition');
if (gameLogoPositionControl) {
    gameLogoPositionControl.addEventListener('change', () => {
        if (!currentEditingId || !gameData[currentEditingId]) return;
        gameData[currentEditingId].heroLogoPosition = gameLogoPositionControl.value;
        if (gameLogoPositionControl.value === 'custom') {
            gameData[currentEditingId].heroLogoX ??= 50;
            gameData[currentEditingId].heroLogoY ??= 50;
        }
        saveToDisk();
        updateLogoLivePreview(gameData[currentEditingId]);
        if (selectedListId === currentEditingId) {
            applyHeroLogoSettings(gameData[currentEditingId]);
        }
    });
}

const gameLogoSnapControl = document.getElementById('gameLogoSnapToGrid');
if (gameLogoSnapControl) {
    gameLogoSnapControl.addEventListener('change', () => {
        if (!currentEditingId || !gameData[currentEditingId]) return;
        gameData[currentEditingId].heroLogoSnapToGrid = gameLogoSnapControl.checked;
        saveToDisk();
    });
}

let isDraggingLogo = false;
const logoLivePreview = document.getElementById('logoLivePreview');
if (logoLivePreview) {
    logoLivePreview.addEventListener('pointerdown', (event) => {
        const logoImage = event.target.closest('img');
        const game = currentEditingId ? gameData[currentEditingId] : null;
        if (!logoImage || !game || game.heroLogoPosition !== 'custom') return;
        isDraggingLogo = true;
        logoLivePreview.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    logoLivePreview.addEventListener('pointermove', (event) => {
        if (!isDraggingLogo || !currentEditingId || !gameData[currentEditingId]) return;
        const game = gameData[currentEditingId];
        const rect = logoLivePreview.getBoundingClientRect();
        let x = ((event.clientX - rect.left) / rect.width) * 100;
        let y = ((event.clientY - rect.top) / rect.height) * 100;
        if (game.heroLogoSnapToGrid) {
            x = Math.round(x / 10) * 10;
            y = Math.round(y / 10) * 10;
        }
        game.heroLogoX = Math.max(5, Math.min(95, x));
        game.heroLogoY = Math.max(5, Math.min(95, y));
        const logoImage = logoLivePreview.querySelector('img');
        if (logoImage) applyLogoPosition(logoImage, 'custom', game);
        if (selectedListId === currentEditingId) applyHeroLogoSettings(game);
    });

    const finishLogoDrag = (event) => {
        if (!isDraggingLogo) return;
        isDraggingLogo = false;
        if (logoLivePreview.hasPointerCapture(event.pointerId)) logoLivePreview.releasePointerCapture(event.pointerId);
        saveToDisk();
    };
    logoLivePreview.addEventListener('pointerup', finishLogoDrag);
    logoLivePreview.addEventListener('pointercancel', finishLogoDrag);
}

function updateHeroHeight() {
    const hero = document.getElementById('dpHero');
    if (!hero || !currentHeroImage?.naturalWidth || !currentHeroImage.naturalHeight) return;

    const heroWidth = hero.clientWidth;
    if (!heroWidth) return;

    const heroHeight = Math.min(heroWidth * currentHeroImage.naturalHeight / currentHeroImage.naturalWidth, 440);
    hero.style.height = `${heroHeight}px`;
    hero.style.minHeight = `${heroHeight}px`;
}

window.addEventListener('resize', updateHeroHeight);
window.addEventListener('resize', () => {
    applyHeroLogoSettings();
    if (currentEditingId && document.getElementById('logoLivePreview')) {
        updateLogoLivePreview(gameData[currentEditingId]);
    }
});

function parseSteamRecommendations(html) {
    if (!html) return [];
    const recommendationsDocument = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(recommendationsDocument.querySelectorAll('.similar_grid_ctn .similar_grid_capsule'))
        .slice(0, 12)
        .map((card) => {
            const appId = card.dataset.dsAppid;
            const image = card.querySelector('img')?.getAttribute('src');
            const storeUrl = card.getAttribute('href');
            const slug = storeUrl ? new URL(storeUrl).pathname.split('/')[3] : '';
            return {
                appId,
                name: decodeURIComponent(slug || '').replace(/_/g, ' '),
                image
            };
        })
        .filter((game) => game.appId && game.name && game.image);
}

function renderSteamMedia(selectedId, media) {
    const game = gameData[selectedId];
    const screenshotGrid = document.getElementById('dpScreenshotGrid');
    const screenshotStatus = document.getElementById('dpScreenshotStatus');
    const genres = document.getElementById('dpGameGenres');
    const recommendationsSection = document.getElementById('dpRelated');
    const recommendationsGrid = document.getElementById('relatedGamesGrid');
    const recommendationsStatus = document.getElementById('relatedGamesEmpty');
    if (!game || !screenshotGrid || !screenshotStatus || !recommendationsSection || !recommendationsGrid || !recommendationsStatus) return;

    screenshotGrid.replaceChildren();
    genres.textContent = media?.genres?.join(' · ') || '';
    if (media?.loading) {
        screenshotStatus.textContent = 'Looking for official Steam screenshots...';
    } else if (media?.success && media.screenshots.length) {
        screenshotStatus.textContent = '';
        media.screenshots.forEach((source, index) => {
            const frame = document.createElement('div');
            frame.className = 'dp-screenshot';
            const image = document.createElement('img');
            image.src = source;
            image.alt = `${game.name} screenshot ${index + 1}`;
            image.loading = 'lazy';
            frame.appendChild(image);
            screenshotGrid.appendChild(frame);
        });
    } else if (game.background || game.cover) {
        screenshotStatus.textContent = 'Steam screenshots are unavailable; showing saved artwork.';
        const frame = document.createElement('div');
        frame.className = 'dp-screenshot';
        const image = document.createElement('img');
        image.src = `local-image://asset?path=${encodeURIComponent(game.background || game.cover)}`;
        image.alt = `${game.name} saved artwork`;
        image.loading = 'lazy';
        frame.appendChild(image);
        screenshotGrid.appendChild(frame);
    } else {
        screenshotStatus.textContent = media?.error || 'No screenshots are available for this title.';
    }

    recommendationsGrid.replaceChildren();
    recommendationsSection.hidden = false;
    recommendationsStatus.hidden = !!media?.loading || !!media?.recommendations?.length;
    recommendationsStatus.textContent = media?.loading
        ? 'Loading suggestions...'
        : media?.success
            ? 'No Steam suggestions were found for this title.'
            : 'Suggestions are unavailable without an exact Steam Store match.';

    (media?.recommendations || []).forEach((suggestion) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'related-game-card';
        card.title = suggestion.name;
        card.setAttribute('aria-label', `Open ${suggestion.name} in Steam`);

        const artwork = document.createElement('div');
        artwork.className = 'related-game-art';
        artwork.style.backgroundImage = `url('${suggestion.image}')`;

        const name = document.createElement('span');
        name.className = 'related-game-name';
        name.textContent = suggestion.name;
        card.append(artwork, name);
        card.onclick = () => ipcRenderer.send('open-steam-game', suggestion.appId);
        recommendationsGrid.appendChild(card);
    });
}

function loadSteamMedia(selectedId) {
    const game = gameData[selectedId];
    const screenshotsSection = document.getElementById('dpScreenshots');
    const recommendationsSection = document.getElementById('dpRelated');
    if (!game || !screenshotsSection || !recommendationsSection) return;

    const requestKey = `${selectedId}:${game.name}`;
    if (screenshotsSection.dataset.requestKey === requestKey) return;
    screenshotsSection.dataset.requestKey = requestKey;

    if (game.steamMedia?.query === game.name) {
        renderSteamMedia(selectedId, game.steamMedia);
        return;
    }

    const requestId = ++steamMediaRequestId;
    const loadingMedia = { loading: true };
    renderSteamMedia(selectedId, loadingMedia);
    ipcRenderer.invoke('get-steam-game-media', game.name).then((result) => {
        if (requestId !== steamMediaRequestId || selectedListId !== selectedId) return;

        if (!result.success) {
            renderSteamMedia(selectedId, { error: result.error });
            return;
        }

        game.steamMedia = {
            query: game.name,
            success: true,
            appId: result.appId,
            genres: result.genres || [],
            screenshots: result.screenshots || [],
            recommendations: parseSteamRecommendations(result.recommendationsHtml)
        };
        saveToDisk();
        renderSteamMedia(selectedId, game.steamMedia);
    }).catch((error) => {
        if (requestId !== steamMediaRequestId || selectedListId !== selectedId) return;
        renderSteamMedia(selectedId, { error: error.message });
    });
}

document.querySelectorAll('.dp-screenshot-grid, .related-games-grid').forEach((gallery) => {
    gallery.addEventListener('wheel', (event) => {
        const maxScrollLeft = gallery.scrollWidth - gallery.clientWidth;
        if (maxScrollLeft <= 0) return;

        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (!delta) return;
        if ((delta < 0 && gallery.scrollLeft <= 0) || (delta > 0 && gallery.scrollLeft >= maxScrollLeft)) return;

        const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? gallery.clientWidth
                : 1;
        event.preventDefault();
        gallery.scrollLeft += delta * scale;
    }, { passive: false });
});

const selectListItem = (id) => {
    selectedListId = id;
    localStorage.setItem('hb-last-selected', id);
    const d = gameData[id];
    if (!d) return;
    
    document.querySelectorAll('.game-card').forEach(c => c.classList.remove('list-selected'));
    document.getElementById(id)?.classList.add('list-selected');

    document.getElementById('dp-empty-state').style.display = 'none';
    const dpContent = document.getElementById('dp-content-state');
    dpContent.style.display = 'flex';
    document.getElementById('dpTitle').innerText = d.name;
    loadSteamMedia(id);
    
    const heroBg = d.background || d.cover;
    document.getElementById('dpHero').style.backgroundImage = heroBg ? `url('local-image://asset?path=${encodeURIComponent(heroBg)}&t=${Date.now()}')` : 'none';
    const requestId = ++heroImageRequestId;
    currentHeroImage = null;
    if (heroBg) {
        const heroImage = new Image();
        heroImage.onload = () => {
            if (requestId !== heroImageRequestId) return;
            currentHeroImage = heroImage;
            applyPlayButtonColor(heroImage);
            updateHeroHeight();
        };
        heroImage.onerror = () => {
            if (requestId === heroImageRequestId) resetPlayButtonColor();
        };
        heroImage.src = `local-image://asset?path=${encodeURIComponent(heroBg)}&t=${Date.now()}`;
    } else {
        resetPlayButtonColor();
        const hero = document.getElementById('dpHero');
        hero.style.height = '';
        hero.style.minHeight = '';
    }
    document.getElementById('dpPlayBtn').onclick = () => launchItem(id);

    if (isFullScreenMode) {
        enterFullScreenPreview();
    }

    document.getElementById('dashLastPlayed').innerText = formatLastPlayed(d.lastPlayed);

    document.getElementById('dashBtnOpenFolder').onclick = () => ipcRenderer.send('open-file-location', d.path);
    document.getElementById('dashBtnChangePath').onclick = async () => {
        currentEditingId = id;
        executeAction('change-path');
    };

    try {
        const dpLogoContainer = document.getElementById('dpLogoContainer');
        const dpTitleEl = document.getElementById('dpTitle');
        const logoPath = d.logo || d.icon;
        if (currentSettings?.customLayout?.useLogoOnHero && logoPath) {
            const imgSrc = `local-image://asset?path=${encodeURIComponent(logoPath)}&t=${Date.now()}`;
            if (dpLogoContainer) dpLogoContainer.innerHTML = `<img src="${imgSrc}" style="width:auto; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));" alt="logo"/>`;
            applyHeroLogoSettings(d);
            if (dpTitleEl) dpTitleEl.style.display = 'none';
        } else {
            if (dpLogoContainer) dpLogoContainer.innerHTML = '';
            if (dpTitleEl) dpTitleEl.style.display = '';
        }
    } catch (e) { console.error('Error rendering hero logo:', e); }
};

async function applyListIcon(thumbEl, gameId, gameDataObj) {
    if (gameDataObj.icon) {
        thumbEl.style.backgroundImage = `url('local-image://asset?path=${encodeURIComponent(gameDataObj.icon)}&t=${Date.now()}')`;
        return;
    }
    if (iconCache[gameId]) {
        thumbEl.style.backgroundImage = `url('${iconCache[gameId]}')`;
        return;
    }
    if (gameDataObj.path) {
        try {
            const base64Icon = await ipcRenderer.invoke('get-file-icon', gameDataObj.path);
            if (base64Icon) {
                iconCache[gameId] = base64Icon;
                thumbEl.style.backgroundImage = `url('${base64Icon}')`;
            } else { thumbEl.innerHTML = '🎮'; }
        } catch (err) { thumbEl.innerHTML = '🎮'; }
    }
}

function renderLibrary() {
    library.innerHTML = '';
    const query = librarySearch.value.toLowerCase();
    
    let ids = Object.keys(gameData).filter(id => !query || gameData[id].name.toLowerCase().includes(query));
    
    const sortModes = { 
        alpha: (a, b) => gameData[a].name.localeCompare(gameData[b].name), 
        added: (a, b) => b.split('-')[1] - a.split('-')[1],
        recent: (a, b) => (gameData[b].lastPlayed || 0) - (gameData[a].lastPlayed || 0)
    };
    
    if (sortModes[sortSelect.value]) ids.sort(sortModes[sortSelect.value]);
    ids.sort((a, b) => (gameData[b].favorite ? 1 : 0) - (gameData[a].favorite ? 1 : 0));
    sortedIds = ids;

    ids.forEach((id) => {
        const d = gameData[id];
        const card = document.createElement('div');
        const selectedClass = (viewMode === 'list' && id === selectedListId) ? 'list-selected' : '';
        
        card.className = `game-card ${d.favorite ? 'is-fav' : ''} ${selectedClass}`;
        card.id = id;
        
        if (viewMode === 'grid') {
            const hasCover = !!d.cover;
            if (hasCover) card.style.backgroundImage = `url('local-image://asset?path=${encodeURIComponent(d.cover)}&t=${Date.now()}')`;
            card.innerHTML = `<div class="fav-badge">★</div> ${!hasCover ? `<div class="fallback-title">${d.name}</div>` : ''} <div class="info-overlay"><div style="font-weight:bold; font-size:0.9rem">${d.name}</div></div>`;
            card.onclick = () => {
                if (isFullScreenMode) selectListItem(id);
                else launchItem(id);
            };
        } else {
            card.innerHTML = `<div class="list-thumb"></div> <div class="list-title">${d.name}</div> <div class="fav-badge" style="position:static;">★</div>`;
            applyListIcon(card.querySelector('.list-thumb'), id, d);
            card.onclick = () => { if (selectedListId === id) launchItem(id); else selectListItem(id); };
        }
        
        library.appendChild(card);
    });

    try { applySettings(currentSettings); } catch (e) { console.error('Failed to reapply settings after render:', e); }

    if (isControllerMode) applyFocus();
}

function openModal(modalName) {
    currentZone = modalName + 'Modal';
    modalFocusIndex = 0;
    renameFocusIndex = 0;
    customizeActionMode = false;
    customizeActionIndex = 0;
    if (modalName === 'settings') {
        settingsFocusIndex = 0;
        settingsFocusedElement = null;
    }
    document.getElementById(`${currentZone}`).style.display = 'flex';
    
    if (modalName === 'context') {
        document.getElementById('contextGameName').innerText = gameData[currentEditingId].name;
        document.getElementById('favMenuBtn').innerText = gameData[currentEditingId].favorite ? "Unfavorite" : "Favorite";
    }
    
    if (modalName === 'settings') {
        ensureSettingsButtonsReady();
    }
    
    if (isControllerMode) applyFocus();
}

function closeModal() {
    if (currentZone === 'renameModal') {
        pendingAddGamePath = null;
        setRenameModalMode(false);
    }
    document.getElementById('contextModal').style.display = 'none';
    document.getElementById('customizeModal').style.display = 'none';
    document.getElementById('renameModal').style.display = 'none';
    document.getElementById('settingsModal').style.display = 'none';
    customizeActionMode = false;
    
    if (['contextModal', 'customizeModal', 'renameModal', 'settingsModal'].includes(currentZone)) {
        currentZone = sortedIds.length > 0 ? 'library' : 'header';
        if (isControllerMode) applyFocus();
    }
}

function updateCustomizePreviews(game, forceReload = false) {
    updateGameLogoControls(game);
    updateLogoLivePreview(game, forceReload);
    ['cover', 'background', 'logo', 'icon'].forEach(type => {
        const preview = document.querySelector(`[data-preview="${type}"]`);
        if (!preview) return;
        const assetPath = game[type];
        preview.style.backgroundImage = assetPath
            ? `url('local-image://asset?path=${encodeURIComponent(assetPath)}&t=${Date.now()}')`
            : 'none';
    });
}

async function executeAction(action) {
    if (!currentEditingId || !gameData[currentEditingId]) return;
    const gameName = gameData[currentEditingId].name;
    const gObj = gameData[currentEditingId];
    
    const actions = { 
        'toggle-fav': () => { gObj.favorite = !gObj.favorite; saveToDisk(); renderLibrary(); closeModal(); }, 
        'rename': () => { 
            closeModal();
            setRenameModalMode(false);
            document.getElementById('renameInput').value = gObj.name;
            openModal('rename');
            if (!isControllerMode) document.getElementById('renameInput').focus();
        }, 
        'open-customize': () => { 
            closeModal(); 
            updateCustomizePreviews(gObj);
            openModal('customize'); 
        },
        'open-file-location': () => { if (gObj.path) ipcRenderer.send('open-file-location', gObj.path); closeModal(); },
        'change-path': async () => { 
            const newPath = await ipcRenderer.invoke('select-game'); 
            if (newPath) { 
                gObj.path = newPath; 
                saveToDisk(); renderLibrary(); 
                if (selectedListId === currentEditingId) selectListItem(currentEditingId);
            } 
            closeModal();
        }, 
        'cover': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, type: 'cover', oldPath: gObj.cover || '', protectedPaths: getArtworkPathsInUse(currentEditingId) }); },
        'icon': () => { ipcRenderer.send('open-icon-picker', { gameId: currentEditingId, name: gameName, type: 'icon', oldPath: gObj.icon || '', protectedPaths: getArtworkPathsInUse(currentEditingId) }); },
        'logo': () => { ipcRenderer.send('open-logo-picker', { gameId: currentEditingId, name: gameName, type: 'logo', oldPath: gObj.logo || '', protectedPaths: getArtworkPathsInUse(currentEditingId) }); },
        'background': () => { ipcRenderer.send('open-bg-picker', { gameId: currentEditingId, name: gameName, type: 'background', oldPath: gObj.background || '', protectedPaths: getArtworkPathsInUse(currentEditingId) }); },
        'reset-cover': () => resetArtwork('cover', gObj),
        'reset-background': () => resetArtwork('background', gObj),
        'reset-logo': () => resetArtwork('logo', gObj),
        'reset-icon': () => resetArtwork('icon', gObj),
        'remove': () => { 
            ipcRenderer.send('delete-game-assets', {
                assetPaths: [gObj.cover, gObj.icon, gObj.background, gObj.logo],
                protectedPaths: getArtworkPathsInUse(currentEditingId)
            });
            delete gameData[currentEditingId]; 
            saveToDisk(); 
            renderLibrary(); 
            closeModal(); 
        }, 
        'cancel': () => closeModal() 
    };
    
    if (actions[action]) actions[action]();
}

function resetArtwork(type, game) {
    const oldPath = game[type];
    if (!oldPath) return;
    ipcRenderer.send('delete-game-assets', {
        assetPaths: [oldPath],
        protectedPaths: getArtworkPathsInUse(currentEditingId)
    });
    game[type] = '';
    saveToDisk();
    renderLibrary();
    if (selectedListId === currentEditingId) selectListItem(currentEditingId);
    updateCustomizePreviews(game);
}

function setRenameModalMode(isAddingGame) {
    document.getElementById('renameModalTitle').innerText = isAddingGame ? 'Confirm Game Name' : 'Rename Game';
    document.getElementById('renameModalHint').style.display = isAddingGame ? 'block' : 'none';
    document.getElementById('confirmRenameBtn').innerText = isAddingGame ? 'Continue' : 'Save';
}

const handleRenameSave = () => {
    const newName = document.getElementById('renameInput').value.trim();
    if (pendingAddGamePath) {
        if (!newName) return;
        const filePath = pendingAddGamePath;
        pendingAddGamePath = null;
        closeModal();
        ipcRenderer.send('add-game-name-confirmed', { filePath, gameName: newName });
        return;
    }
    if (newName && currentEditingId) {
        gameData[currentEditingId].name = newName;
        delete gameData[currentEditingId].steamMedia;
        saveToDisk();
        renderLibrary();
        if (selectedListId === currentEditingId) selectListItem(currentEditingId);
    }
    closeModal();
};

document.getElementById('confirmRenameBtn').onclick = handleRenameSave;
document.getElementById('cancelRenameBtn').onclick = closeModal;
document.getElementById('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleRenameSave(); else if (e.key === 'Escape') closeModal();
});

function addGameToLibrary({ id, name, path, cover, icon, logo, background }) {
    gameData[id] = {
        name,
        path,
        favorite: false,
        cover,
        icon,
        logo,
        background,
        lastPlayed: 0,
        heroLogoScale: 100,
        heroLogoPosition: 'bottom-left',
        heroLogoX: 50,
        heroLogoY: 50,
        heroLogoSnapToGrid: false
    };

    saveToDisk();
    renderLibrary();
    if (viewMode === 'list') selectListItem(id);
}

ipcRenderer.on('add-game-confirmed', (event, newGameObj) => {
    addGameToLibrary(newGameObj);
});

ipcRenderer.on('confirm-add-game-name', (event, { filePath, suggestedName }) => {
    pendingAddGamePath = filePath;
    setRenameModalMode(true);
    document.getElementById('renameInput').value = suggestedName || '';
    openModal('rename');
    if (!isControllerMode) document.getElementById('renameInput').focus();
});

document.querySelectorAll('.menu-btn[data-action]').forEach(btn => {
    btn.onclick = () => executeAction(btn.dataset.action);
});

document.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.game-card');
    if (card) {
        e.preventDefault();
        currentEditingId = card.id;
        const gData = gameData[currentEditingId];
        if (gData) {
            ipcRenderer.send('show-game-context-menu', { id: currentEditingId, ...gData });
        }
    }
});

ipcRenderer.on('context-menu-play', (event, data) => launchItem(data.id));
ipcRenderer.on('context-menu-fav', (event, data) => { currentEditingId = data.id; executeAction('toggle-fav'); });
ipcRenderer.on('context-menu-rename', (event, data) => { currentEditingId = data.id; executeAction('rename'); });
ipcRenderer.on('context-menu-customize', (event, data) => { currentEditingId = data.id; executeAction('open-customize'); });
ipcRenderer.on('context-menu-open-location', (event, data) => { currentEditingId = data.id; executeAction('open-file-location'); });
ipcRenderer.on('context-menu-change-path', (event, data) => { currentEditingId = data.id; executeAction('change-path'); });
ipcRenderer.on('context-menu-remove', (event, data) => { currentEditingId = data.id; executeAction('remove'); });

function setControllerActive(state) {
    if (isControllerMode === state) return;
    isControllerMode = state;
    document.body.classList.toggle('controller-mode', state);
    if (state) applyFocus();
}

window.addEventListener('mousemove', () => setControllerActive(false));
window.addEventListener('keydown', (e) => {
    if (document.activeElement !== librarySearch && document.activeElement !== document.getElementById('renameInput') && document.activeElement !== document.getElementById('steamGridApiKey')) {
        setControllerActive(false);
    }
    if (e.key === 'Escape') {
        if (isFullScreenPreviewActive) {
            exitFullScreenPreview();
            e.preventDefault();
        } else if (isFullScreenMode) {
            ipcRenderer.send('set-fullscreen', false);
            e.preventDefault();
        }
    }
});

function updateGlyphs(gamepadId) {
    const id = gamepadId.toLowerCase();
    const isPS = id.includes('dualshock') || id.includes('dualsense') || id.includes('wireless controller') || id.includes('playstation');
    
    document.getElementById('aLabel').innerText = "Select / Play";
    document.getElementById('xLabel').innerText = "Options";
    document.getElementById('bLabel').innerText = "Back";
    
    const footerGlyphs = document.querySelectorAll('.footer .glyph');
    if (footerGlyphs.length >= 3) {
        footerGlyphs[0].className = 'glyph ' + (isPS ? 'ps-cross' : 'a');
        footerGlyphs[1].className = 'glyph ' + (isPS ? 'ps-square' : 'x');
        footerGlyphs[2].className = 'glyph ' + (isPS ? 'ps-circle' : 'b');
    }
}

function applyFocus() {
    if (!isControllerMode) return;

    document.querySelectorAll('.game-card, .menu-btn, #renameInput, .dash-btn, #dpPlayBtn').forEach(el => el.classList.remove('focused'));
    document.querySelectorAll('.artwork-row').forEach(el => el.classList.remove('controller-focused'));
    document.querySelectorAll('[data-header-idx]').forEach(el => el.classList.remove('header-focused'));

    if (currentZone === 'contextModal') {
        const ctxBtns = document.querySelectorAll('#contextOptionsList .menu-btn');
        if (ctxBtns[modalFocusIndex]) ctxBtns[modalFocusIndex].classList.add('focused');
    }
    else if (currentZone === 'customizeModal') {
        const artworkRows = document.querySelectorAll('#customizeOptionsList .artwork-row');
        const activeRow = artworkRows[modalFocusIndex];
        if (!activeRow) return;
        if (customizeActionMode) {
            const activeButton = activeRow.querySelectorAll('.artwork-actions .menu-btn')[customizeActionIndex];
            activeButton?.classList.add('focused');
            activeButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            activeRow.classList.add('controller-focused');
            activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    else if (currentZone === 'renameModal') {
        const renameInputEl = document.getElementById('renameInput');
        if (renameFocusIndex === 0) {
            renameInputEl.classList.add('focused');
            renameInputEl.focus();
        } else {
            renameInputEl.blur();
            const actionBtns = document.querySelectorAll('#renameActionsRow .menu-btn');
            if (actionBtns[renameFocusIndex - 1]) actionBtns[renameFocusIndex - 1].classList.add('focused');
        }
    }
    else if (currentZone === 'settingsModal') {
        applySettingsFocus();
    }
    else if (currentZone === 'header') {
        const headerElements = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
        const activeEl = headerElements.find(el => parseInt(el.dataset.headerIdx) === headerFocusIndex) || headerElements[0];
        if (activeEl) {
            activeEl.classList.add('header-focused');
            if (activeEl.id === 'librarySearch') activeEl.focus(); 
            else { librarySearch.blur(); }
        }
    } 
    else if (currentZone === 'library') {
        librarySearch.blur();
        if (sortedIds.length > 0) {
            if (focusIndex >= sortedIds.length) focusIndex = sortedIds.length - 1;
            const activeCard = document.getElementById(sortedIds[focusIndex]);
            if (activeCard) {
                activeCard.classList.add('focused');
                activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                if (viewMode === 'list' && selectedListId !== sortedIds[focusIndex]) {
                    selectListItem(sortedIds[focusIndex]);
                }
            }
        }
    }
    else if (currentZone === 'detail-panel') {
        if (dashFocusIndex === 0) document.getElementById('dpPlayBtn').classList.add('focused');
        else if (dashFocusIndex === 1) document.getElementById('dashBtnOpenFolder').classList.add('focused');
        else if (dashFocusIndex === 2) document.getElementById('dashBtnChangePath').classList.add('focused');
    }
}

function handleGamepadLoop() {
    if (!document.hasFocus()) { requestAnimationFrame(handleGamepadLoop); return; }
    if (isFullScreenPreviewActive && currentZone !== 'detail-panel') {
        currentZone = 'detail-panel';
    }
    
    const gamepads = navigator.getGamepads();
    let activeGp = null;
    
    for (const gp of gamepads) {
        if (!gp || !gp.connected) continue;
        if (gp.buttons.some(b => b.pressed) || gp.axes.some(a => Math.abs(a) > 0.5)) {
            activeGp = gp;
            setControllerActive(true);
            if (lastActiveGamepadIndex !== gp.index) {
                lastActiveGamepadIndex = gp.index;
                updateGlyphs(gp.id);
            }
            break;
        }
    }

    if (!activeGp && isControllerMode) activeGp = gamepads[lastActiveGamepadIndex] || Array.from(gamepads).find(p => p !== null);

    if (activeGp && isControllerMode) {
        const now = Date.now();
        if (now - lastMoveTime > 180) {
            let moved = false;
            const up = activeGp.axes[1] < -0.5 || activeGp.buttons[12].pressed;
            const down = activeGp.axes[1] > 0.5 || activeGp.buttons[13].pressed;
            const left = activeGp.axes[0] < -0.5 || activeGp.buttons[14].pressed;
            const right = activeGp.axes[0] > 0.5 || activeGp.buttons[15].pressed;

            if (currentZone === 'contextModal') {
                const btns = document.querySelectorAll('#contextOptionsList .menu-btn');
                if (down && modalFocusIndex + 1 < btns.length) { modalFocusIndex++; moved = true; }
                if (up && modalFocusIndex > 0) { modalFocusIndex--; moved = true; }
            }
            else if (currentZone === 'settingsModal') {
                const horizontal = (right ? 1 : 0) - (left ? 1 : 0);
                const vertical = (down ? 1 : 0) - (up ? 1 : 0);
                if (horizontal || vertical) {
                    const previousFocus = settingsFocusedElement;
                    const wasRange = previousFocus?.type === 'range' && !previousFocus.disabled && horizontal;
                    moveSettingsFocus(horizontal, vertical);
                    moved = settingsFocusedElement !== previousFocus || !!wasRange;
                }
            }
            else if (currentZone === 'customizeModal') {
                const artworkRows = document.querySelectorAll('#customizeOptionsList .artwork-row');
                if (customizeActionMode) {
                    if (right && customizeActionIndex < 1) { customizeActionIndex++; moved = true; }
                    if (left && customizeActionIndex > 0) { customizeActionIndex--; moved = true; }
                } else {
                    if (down && modalFocusIndex + 1 < artworkRows.length) { modalFocusIndex++; moved = true; }
                    if (up && modalFocusIndex > 0) { modalFocusIndex--; moved = true; }
                }
            }
            else if (currentZone === 'renameModal') {
                if (down && renameFocusIndex === 0) { renameFocusIndex = 1; moved = true; }
                if (up && renameFocusIndex > 0) { renameFocusIndex = 0; moved = true; }
                if (right && renameFocusIndex === 1) { renameFocusIndex = 2; moved = true; }
                if (left && renameFocusIndex === 2) { renameFocusIndex = 1; moved = true; }
            }
            else if (currentZone === 'header') {
                const headerElements = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
                let currentVisIdx = headerElements.findIndex(el => parseInt(el.dataset.headerIdx) === headerFocusIndex);
                if (currentVisIdx === -1) currentVisIdx = 0;

                if (right && currentVisIdx + 1 < headerElements.length) { 
                    headerFocusIndex = parseInt(headerElements[currentVisIdx + 1].dataset.headerIdx); 
                    moved = true; 
                }
                if (left && currentVisIdx > 0) { 
                    headerFocusIndex = parseInt(headerElements[currentVisIdx - 1].dataset.headerIdx); 
                    moved = true; 
                }
                if (down && sortedIds.length > 0) { currentZone = 'library'; moved = true; }
            } 
            else if (currentZone === 'library') {
                let cols = 1;
                if (viewMode === 'grid') {
                    const gridComp = window.getComputedStyle(library);
                    cols = gridComp.getPropertyValue('grid-template-columns').split(' ').length || 1;
                }

                if (down) { if (focusIndex + cols < sortedIds.length) { focusIndex += cols; moved = true; } }
                if (up) { 
                    if (focusIndex < cols) { 
                        currentZone = 'header'; 
                        const vis = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
                        headerFocusIndex = vis.length > 0 ? parseInt(vis[0].dataset.headerIdx) : 0;
                        moved = true; 
                    } else { focusIndex -= cols; moved = true; } 
                }
                if (right) { 
                    if (viewMode === 'grid') {
                        if (focusIndex + 1 < sortedIds.length) { focusIndex++; moved = true; }
                    } else if (viewMode === 'list') {
                        currentZone = 'detail-panel'; dashFocusIndex = 0; moved = true; 
                    }
                }
                if (left && viewMode === 'grid') { if (focusIndex > 0) { focusIndex--; moved = true; } }
            }
            else if (currentZone === 'detail-panel') {
                if (left && dashFocusIndex === 2) { dashFocusIndex = 1; moved = true; }
                else if (left && dashFocusIndex === 1) { dashFocusIndex = 0; moved = true; }
                else if (left && dashFocusIndex === 0 && !isFullScreenPreviewActive) { currentZone = 'library'; moved = true; }
                if (right && dashFocusIndex === 0) { dashFocusIndex = 1; moved = true; }
                else if (right && dashFocusIndex === 1) { dashFocusIndex = 2; moved = true; }
                if (down && dashFocusIndex === 0) { dashFocusIndex = 1; moved = true; }
                if (up && (dashFocusIndex === 1 || dashFocusIndex === 2)) { dashFocusIndex = 0; moved = true; }
            }

            if (moved) { applyFocus(); lastMoveTime = now; }
        }

        const pressedA = activeGp.buttons[0].pressed && !lastButtonState[0]; 
        const pressedB = activeGp.buttons[1].pressed && !lastButtonState[1]; 
        const pressedX = activeGp.buttons[2].pressed && !lastButtonState[2] || (activeGp.buttons[3].pressed && !lastButtonState[3]);

        if (pressedA) {
            if (currentZone === 'settingsModal') {
                const focusedElement = settingsFocusedElement;
                if (focusedElement) {
                    if (focusedElement.matches('input[type="text"], input[type="password"]')) focusedElement.focus();
                    else focusedElement.click();
                }
            }
            else if (currentZone === 'contextModal') { document.querySelectorAll('#contextOptionsList .menu-btn')[modalFocusIndex]?.click(); }
            else if (currentZone === 'customizeModal') {
                const artworkRows = document.querySelectorAll('#customizeOptionsList .artwork-row');
                const activeRow = artworkRows[modalFocusIndex];
                if (activeRow && !customizeActionMode) {
                    customizeActionMode = true;
                    customizeActionIndex = 0;
                    applyFocus();
                } else if (activeRow) {
                    activeRow.querySelectorAll('.artwork-actions .menu-btn')[customizeActionIndex]?.click();
                }
            }
            else if (currentZone === 'renameModal') {
                if (renameFocusIndex === 1) handleRenameSave();
                else if (renameFocusIndex === 2) closeModal();
            }
            else if (currentZone === 'header') { 
                const headerElements = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
                const activeEl = headerElements.find(el => parseInt(el.dataset.headerIdx) === headerFocusIndex);
                if (activeEl) {
                    if (activeEl.id === 'sortSelect') {
                        sortSelect.selectedIndex = (sortSelect.selectedIndex + 1) % sortSelect.options.length;
                        sortSelect.dispatchEvent(new Event('change'));
                    } else { activeEl.click(); }
                }
            } 
            else if (currentZone === 'library' && sortedIds[focusIndex]) {
                const selectedId = sortedIds[focusIndex];
                if (viewMode === 'grid' && isFullScreenMode) selectListItem(selectedId);
                else launchItem(selectedId);
            }
            else if (currentZone === 'detail-panel') {
                if (dashFocusIndex === 0) document.getElementById('dpPlayBtn').click();
                if (dashFocusIndex === 1) document.getElementById('dashBtnOpenFolder').click();
                if (dashFocusIndex === 2) document.getElementById('dashBtnChangePath').click();
            }
        }

        if (pressedB) {
            if (currentZone === 'settingsModal') {
                closeModal();
            } else if (currentZone === 'customizeModal' && customizeActionMode) {
                customizeActionMode = false;
                applyFocus();
            } else if (['contextModal', 'customizeModal', 'renameModal'].includes(currentZone)) {
                closeModal();
            } else if (currentZone === 'library') {
                currentZone = 'header'; 
                const vis = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
                headerFocusIndex = vis.length > 0 ? parseInt(vis[0].dataset.headerIdx) : 0;
                applyFocus();
            } else if (currentZone === 'detail-panel') {
                if (isFullScreenPreviewActive) {
                    exitFullScreenPreview();
                } else {
                    currentZone = 'library'; applyFocus();
                }
            }
        }

        if (pressedX && currentZone === 'library' && sortedIds[focusIndex]) {
            currentEditingId = sortedIds[focusIndex];
            openModal('context');
        }

        for (let i = 0; i < activeGp.buttons.length; i++) { lastButtonState[i] = activeGp.buttons[i].pressed; }
    }
    requestAnimationFrame(handleGamepadLoop);
}

ipcRenderer.on('cover-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].cover = path; saveToDisk(); renderLibrary(); updateCustomizePreviews(gameData[id], true); if(selectedListId === id) selectListItem(id); } });
ipcRenderer.on('bg-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].background = path; saveToDisk(); updateCustomizePreviews(gameData[id], true); if(selectedListId === id) selectListItem(id); } });
ipcRenderer.on('icon-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].icon = path; saveToDisk(); renderLibrary(); updateCustomizePreviews(gameData[id], true); } });
ipcRenderer.on('logo-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].logo = path; saveToDisk(); renderLibrary(); updateCustomizePreviews(gameData[id], true); if(selectedListId === id) selectListItem(id); } });

loadLibrary();
applyLayoutMode();
requestAnimationFrame(handleGamepadLoop);