const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const library = document.getElementById('library');
const contentWrapper = document.getElementById('contentWrapper');
const fullScreenBtn = document.getElementById('fullScreenBtn');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 
const addBtn = document.getElementById('addBtn');

const SAVE_PATH = './library.json';

let gameData = {};
let sortedIds = [];
let currentEditingId = null;
const iconCache = {}; 

let viewMode = 'list';
let selectedListId = null;
let isFullScreenPreviewActive = false;

let isControllerMode = false;
let currentZone = 'library'; 
let focusIndex = 0;
let headerFocusIndex = 0;
let modalFocusIndex = 0;
let renameFocusIndex = 0;
let dashFocusIndex = 0;
let lastMoveTime = 0;
let lastButtonState = new Array(20).fill(false);
let lastActiveGamepadIndex = null;

if (fs.existsSync(SAVE_PATH)) {
    try { 
        const parsed = JSON.parse(fs.readFileSync(SAVE_PATH));
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
                d.currentVersion ??= '1.0.0';
                d.latestVersion ??= '1.0.0';
                d.platform ??= 'custom';
                d.platformId ??= null;
            }
        });
    } catch (e) { console.error("Error loading data file:", e); }
}

const saveToDisk = () => { 
    fs.writeFileSync(SAVE_PATH, JSON.stringify(gameData, null, 2)); 
};

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
    settings.customLayout.fontSize ??= settings.customLayout.fontSize || 'medium';
    settings.customLayout.useLogoOnHero ??= false;
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

const applySettings = (settings) => {
    const root = document.documentElement;
    const colors = settings.customColors || {};
    
    if (colors.background) root.style.setProperty('--bg', colors.background);
    if (colors.surface) root.style.setProperty('--card-bg', colors.surface);
    if (colors.text) root.style.setProperty('--text', colors.text);
    if (colors.accent) root.style.setProperty('--accent', colors.accent);
    
    const fonts = settings.customFonts || {};
    if (fonts.sizeBase) document.body.style.fontSize = fonts.sizeBase;
    if (fonts.family) document.body.style.fontFamily = fonts.family;
    
    const layout = settings.customLayout || {};
    if (layout.cardSize) document.body.dataset.cardSize = layout.cardSize;
    if (layout.fontSize) document.body.style.fontSize = layout.fontSize;

    try {
        const bg = (colors.background || getComputedStyle(root).getPropertyValue('--bg') || '#000').trim();
        const surface = (colors.surface || getComputedStyle(root).getPropertyValue('--card-bg') || '#111').trim();
        const isPreset = settings.theme && settings.theme !== 'custom';

        if (isPreset) {
            const headerColor = getAutoHeaderTextColor(surface || bg);
            root.style.setProperty('--header-text', headerColor);
            const headerEl = document.getElementById('appHeader');
            if (headerEl) {
                try {
                    headerEl.style.color = headerColor;
                    const headerTitle = headerEl.querySelector('h1');
                    if (headerTitle) headerTitle.style.color = headerColor;
                    const controls = headerEl.querySelectorAll('input, select, button, .control-btn');
                    controls.forEach(c => { try { c.style.color = headerColor; } catch (e) {} });
                } catch (e) {}
            }
            try {
                const cardTextSelectors = ['.game-card .info-overlay div', '.game-card .fallback-title', '.game-card .list-title', '.game-card .fav-badge', '.game-card .update-badge', '.dp-title', '.dash-value', '.menu-btn', '.modal-content', '.menu-options', '.dash-btn'];
                cardTextSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => { try { el.style.color = headerColor; } catch (e) {} });
                });
            } catch (e) {}
        } else {
            const manualText = (colors.text || getComputedStyle(root).getPropertyValue('--text') || '#ffffff').trim();
            root.style.setProperty('--header-text', manualText);
            try {
                const headerEl = document.getElementById('appHeader');
                if (headerEl) {
                    headerEl.style.color = manualText;
                    const headerTitle = headerEl.querySelector('h1');
                    if (headerTitle) headerTitle.style.color = manualText;
                    const controls = headerEl.querySelectorAll('input, select, button, .control-btn');
                    controls.forEach(c => { try { c.style.color = manualText; } catch (e) {} });
                }
            } catch (e) {}
            try {
                const cardTextSelectors = ['.game-card .info-overlay div', '.game-card .fallback-title', '.game-card .list-title', '.game-card .fav-badge', '.game-card .update-badge', '.dp-title', '.dash-value', '.menu-btn', '.modal-content', '.menu-options', '.dash-btn'];
                cardTextSelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => { try { el.style.color = manualText; } catch (e) {} });
                });
            } catch (e) {}
        }

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
                btn.className = 'menu-btn';
                btn.textContent = theme.name;
                btn.style.cssText = `
                    background: ${theme.preview.colors.surface};
                    color: ${theme.preview.colors.text};
                    border-color: ${currentSettings.theme === theme.id ? theme.preview.colors.accent : '#333'};
                    border-width: ${currentSettings.theme === theme.id ? '3px' : '2px'};
                `;
                btn.onclick = async () => {
                    try {
                        const preset = await ipcRenderer.invoke('get-theme-preset', theme.id);
                        currentSettings.theme = theme.id;
                        currentSettings.customColors = { ...preset.colors };
                        currentSettings.customFonts = { ...preset.fonts };
                        currentSettings.customLayout = { ...preset.layout };
                        updateColorInputs();
                        applySettings(currentSettings);
                        showSettingsModal();
                    } catch (e) { console.error('Error applying preset:', e); }
                };
                presetsContainer.appendChild(btn);
            } catch (e) { console.error('Error creating theme button:', e); }
        });

        updateColorInputs();
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
    document.getElementById('fontSize').value = currentSettings.customLayout?.fontSize || 'medium';
    document.getElementById('cardSize').value = currentSettings.customLayout?.cardSize || 'medium';
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
        const fontSizeEl = document.getElementById('fontSize');
        const cardSizeEl = document.getElementById('cardSize');

        if (apiKeyEl) currentSettings.steamGridApiKey = apiKeyEl.value.trim();
        if (colorBgEl) currentSettings.customColors.background = colorBgEl.value;
        if (colorAccentEl) currentSettings.customColors.accent = colorAccentEl.value;
        if (colorTextEl) currentSettings.customColors.text = colorTextEl.value;
        if (colorCardEl) currentSettings.customColors.surface = colorCardEl.value;
        if (fontSizeEl) currentSettings.customLayout.fontSize = fontSizeEl.value;
        if (cardSizeEl) currentSettings.customLayout.cardSize = cardSizeEl.value;
        const useLogoEl = document.getElementById('useLogoOnHero');
        if (useLogoEl) currentSettings.customLayout.useLogoOnHero = !!useLogoEl.checked;

        currentSettings.theme = 'custom';
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

ipcRenderer.on('settings-updated', (settings) => {
    currentSettings = ensureSettingsDefaults(settings);
    applySettings(currentSettings);
});

loadSettings();

const applyLayoutMode = () => {
    contentWrapper.className = `content-wrapper ${viewMode}-mode`;
    if (isFullScreenPreviewActive) {
        document.body.classList.add('full-screen-preview');
    } else {
        document.body.classList.remove('full-screen-preview');
    }
    if (!isFullScreenMode) {
        viewMode = 'list';
        isFullScreenPreviewActive = false;
    } else {
        if (!isFullScreenPreviewActive) viewMode = 'grid';
    }
    contentWrapper.className = `content-wrapper ${viewMode}-mode`;
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
        ipcRenderer.send('toggle-fullscreen');
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

const launchItem = (id) => { 
    if (gameData[id]?.path) { 
        gameData[id].lastPlayed = Date.now();
        saveToDisk(); 
        if(viewMode === 'list') selectListItem(id);
        ipcRenderer.send('launch-game-process', { id, executablePath: gameData[id].path }); 
        renderLibrary();
    }
};

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
    
    const heroBg = d.background || d.cover;
    document.getElementById('dpHero').style.backgroundImage = heroBg ? `url('local-image://asset?path=${encodeURIComponent(heroBg)}&t=${Date.now()}')` : 'none';
    document.getElementById('dpPlayBtn').onclick = () => launchItem(id);

    if (isFullScreenMode) {
        enterFullScreenPreview();
    }

    if (d.lastPlayed) {
        document.getElementById('dashLastPlayed').innerText = new Date(d.lastPlayed).toLocaleString();
    } else {
        document.getElementById('dashLastPlayed').innerText = "Never";
    }

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
            if (dpLogoContainer) dpLogoContainer.innerHTML = `<img src="${imgSrc}" style="height:64px; width:auto; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));" alt="logo"/>`;
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
    document.getElementById('contextModal').style.display = 'none';
    document.getElementById('customizeModal').style.display = 'none';
    document.getElementById('renameModal').style.display = 'none';
    document.getElementById('settingsModal').style.display = 'none';
    
    if (['contextModal', 'customizeModal', 'renameModal', 'settingsModal'].includes(currentZone)) {
        currentZone = sortedIds.length > 0 ? 'library' : 'header';
        if (isControllerMode) applyFocus();
    }
}

async function executeAction(action) {
    if (!currentEditingId || !gameData[currentEditingId]) return;
    const gameName = gameData[currentEditingId].name;
    const gObj = gameData[currentEditingId];
    
    const actions = { 
        'toggle-fav': () => { gObj.favorite = !gObj.favorite; saveToDisk(); renderLibrary(); closeModal(); }, 
        'rename': () => { 
            closeModal();
            document.getElementById('renameInput').value = gObj.name;
            openModal('rename');
            if (!isControllerMode) document.getElementById('renameInput').focus();
        }, 
        'open-customize': () => { 
            closeModal(); 
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
        'cover': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, type: 'cover', oldPath: gObj.cover || '' }); closeModal(); }, 
        'icon': () => { ipcRenderer.send('open-icon-picker', { gameId: currentEditingId, name: gameName, type: 'icon', oldPath: gObj.icon || '' }); closeModal(); }, 
        'logo': () => { ipcRenderer.send('open-logo-picker', { gameId: currentEditingId, name: gameName, type: 'logo', oldPath: gObj.logo || '' }); closeModal(); }, 
        'background': () => { ipcRenderer.send('open-bg-picker', { gameId: currentEditingId, name: gameName, type: 'background', oldPath: gObj.background || '' }); closeModal(); }, 
        'remove': () => { 
            ipcRenderer.send('delete-game-assets', [gObj.cover, gObj.icon, gObj.background, gObj.logo]);
            delete gameData[currentEditingId]; 
            saveToDisk(); 
            renderLibrary(); 
            closeModal(); 
        }, 
        'cancel': () => closeModal() 
    };
    
    if (actions[action]) actions[action]();
}

const handleRenameSave = () => {
    const newName = document.getElementById('renameInput').value.trim();
    if (newName && currentEditingId) {
        gameData[currentEditingId].name = newName;
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
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        platform: 'custom',
        platformId: null
    };

    saveToDisk();
    renderLibrary();
    if (viewMode === 'list') selectListItem(id);
}

ipcRenderer.on('add-game-confirmed', (event, newGameObj) => {
    addGameToLibrary(newGameObj);
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
    if (e.key === 'Escape' && isFullScreenPreviewActive) {
        exitFullScreenPreview();
        e.preventDefault();
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
    document.querySelectorAll('[data-header-idx]').forEach(el => el.classList.remove('header-focused'));

    if (currentZone === 'contextModal') {
        const ctxBtns = document.querySelectorAll('#contextOptionsList .menu-btn');
        if (ctxBtns[modalFocusIndex]) ctxBtns[modalFocusIndex].classList.add('focused');
    }
    else if (currentZone === 'customizeModal') {
        const customBtns = document.querySelectorAll('#customizeOptionsList .menu-btn');
        if (customBtns[modalFocusIndex]) customBtns[modalFocusIndex].classList.add('focused');
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
                if (viewMode === 'list') selectListItem(sortedIds[focusIndex]);
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
            else if (currentZone === 'customizeModal') {
                const btns = document.querySelectorAll('#customizeOptionsList .menu-btn');
                if (down && modalFocusIndex + 1 < btns.length) { modalFocusIndex++; moved = true; }
                if (up && modalFocusIndex > 0) { modalFocusIndex--; moved = true; }
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
                if (left && dashFocusIndex === 0) { currentZone = 'library'; moved = true; }
                if (down && dashFocusIndex === 0) { dashFocusIndex = 1; moved = true; }
                if (up && (dashFocusIndex === 1 || dashFocusIndex === 2)) { dashFocusIndex = 0; moved = true; }
                if (right && dashFocusIndex === 1) { dashFocusIndex = 2; moved = true; }
                if (left && dashFocusIndex === 2) { dashFocusIndex = 1; moved = true; }
            }

            if (moved) { applyFocus(); lastMoveTime = now; }
        }

        const pressedA = activeGp.buttons[0].pressed && !lastButtonState[0]; 
        const pressedB = activeGp.buttons[1].pressed && !lastButtonState[1]; 
        const pressedX = activeGp.buttons[2].pressed && !lastButtonState[2] || (activeGp.buttons[3].pressed && !lastButtonState[3]);

        if (pressedA) {
            if (currentZone === 'contextModal') { document.querySelectorAll('#contextOptionsList .menu-btn')[modalFocusIndex]?.click(); }
            else if (currentZone === 'customizeModal') { document.querySelectorAll('#customizeOptionsList .menu-btn')[modalFocusIndex]?.click(); }
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
            else if (currentZone === 'library' && sortedIds[focusIndex]) { launchItem(sortedIds[focusIndex]); }
            else if (currentZone === 'detail-panel') {
                if (dashFocusIndex === 0) document.getElementById('dpPlayBtn').click();
                if (dashFocusIndex === 1) document.getElementById('dashBtnOpenFolder').click();
                if (dashFocusIndex === 2) document.getElementById('dashBtnChangePath').click();
            }
        }

        if (pressedB) {
            if (['contextModal', 'customizeModal', 'renameModal'].includes(currentZone)) {
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

ipcRenderer.on('cover-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].cover = path; saveToDisk(); renderLibrary(); if(selectedListId === id) selectListItem(id); } });
ipcRenderer.on('bg-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].background = path; saveToDisk(); if(selectedListId === id) selectListItem(id); } });
ipcRenderer.on('icon-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].icon = path; saveToDisk(); renderLibrary(); } });
ipcRenderer.on('logo-updated', (e, { id, path }) => { if (gameData[id]) { gameData[id].logo = path; saveToDisk(); renderLibrary(); if(selectedListId === id) selectListItem(id); } });

applyLayoutMode();
requestAnimationFrame(handleGamepadLoop);