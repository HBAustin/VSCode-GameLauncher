const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const library = document.getElementById('library');
const contentWrapper = document.getElementById('contentWrapper');
const viewToggleBtn = document.getElementById('viewToggleBtn');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 
const addBtn = document.getElementById('addBtn');
const apiSetupBtn = document.getElementById('apiSetupBtn');
const modalApiKeyInput = document.getElementById('modalApiKeyInput');

const SAVE_PATH = './library.json';

let gameData = {};
let apiKey = '';
let sortedIds = [];
let currentEditingId = null;
const iconCache = {}; 

let viewMode = localStorage.getItem('hb-view-mode') || 'grid';
let selectedListId = null;

let isControllerMode = false;
let currentZone = 'library'; 
let focusIndex = 0;
let headerFocusIndex = 0;
let modalFocusIndex = 0;
let renameFocusIndex = 0;
let apiModalFocusIndex = 0;
let dashFocusIndex = 0;
let lastMoveTime = 0;
let lastButtonState = new Array(20).fill(false);
let lastActiveGamepadIndex = null;
let pendingGamePlatform = null; 

if (fs.existsSync(SAVE_PATH)) {
    try { 
        const parsed = JSON.parse(fs.readFileSync(SAVE_PATH));
        if (parsed.gameData && parsed.apiKey !== undefined) {
            gameData = parsed.gameData;
            apiKey = parsed.apiKey;
        } else {
            gameData = parsed;
            if (gameData.gameData) delete gameData.gameData;
            if (gameData.apiKey) delete gameData.apiKey;
        }
        Object.values(gameData).forEach(d => { 
            if (d && typeof d === 'object') {
                d.favorite ??= false; 
                d.background ??= ''; 
                d.icon ??= ''; 
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
    fs.writeFileSync(SAVE_PATH, JSON.stringify({ gameData, apiKey }, null, 2)); 
    updateAPIButtonVisibility();
};

function updateAPIButtonVisibility() {
    if (apiKey) {
        apiSetupBtn.style.display = 'none';
        if (headerFocusIndex === 4) headerFocusIndex = 0;
    } else {
        apiSetupBtn.style.display = 'inline-block';
    }
}

apiSetupBtn.onclick = () => {
    modalApiKeyInput.value = apiKey;
    openModal('apiKey');
};

ipcRenderer.on('trigger-api-key-prompt', () => {
    modalApiKeyInput.value = apiKey;
    openModal('apiKey');
});

const handleApiSave = () => {
    apiKey = modalApiKeyInput.value.trim();
    saveToDisk();
    closeModal();
    
    if (apiKey) {
        alert("API Key Saved. Please note that it can take a few seconds for your new games to appear in your library as the Artworks are fetched from SteamGridDB.\n\n If you have any issues with fetching artworks, please ensure your API Key is valid and that you have not exceeded your daily request limit on SteamGridDB. \n\n You can remove or update your API key by pressing 'File > Set SteamGridDB API Key' in the menu bar.");
    } else {
        alert("API Key cleared. You will not be able to fetch new artworks from SteamGridDB until you add a valid API Key.");
    }
};

document.getElementById('confirmApiBtn').onclick = handleApiSave;
document.getElementById('cancelApiBtn').onclick = closeModal;

let currentSettings = { theme: 'dark', customColors: {}, customFonts: {}, customLayout: {} };

const loadSettings = async () => {
    try {
        currentSettings = await ipcRenderer.invoke('get-settings');
        applySettings(currentSettings);
    } catch (err) {
        console.error('Error loading settings:', err);
    }
};

const applySettings = (settings) => {
    const root = document.documentElement;
    const colors = settings.customColors;
    
    if (colors.background) root.style.setProperty('--bg', colors.background);
    if (colors.surface) root.style.setProperty('--card-bg', colors.surface);
    if (colors.text) root.style.setProperty('--text', colors.text);
    if (colors.accent) root.style.setProperty('--accent', colors.accent);
    
    const fonts = settings.customFonts;
    if (fonts.sizeBase) document.body.style.fontSize = fonts.sizeBase;
    if (fonts.family) document.body.style.fontFamily = fonts.family;
    
    const layout = settings.customLayout;
    if (layout.compactMode) document.body.classList.add('compact-mode');
    if (layout.cardSize) document.body.dataset.cardSize = layout.cardSize;
};

const showSettingsModal = async () => {
    try {
        const themes = await ipcRenderer.invoke('get-all-themes');
        const presetsContainer = document.getElementById('themePresets');
        presetsContainer.innerHTML = '';
        
        themes.forEach(theme => {
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
                const preset = await ipcRenderer.invoke('get-theme-preset', theme.id);
                currentSettings.theme = theme.id;
                currentSettings.customColors = { ...preset.colors };
                currentSettings.customFonts = { ...preset.fonts };
                currentSettings.customLayout = { ...preset.layout };
                updateColorInputs();
                showSettingsModal();
            };
            presetsContainer.appendChild(btn);
        });
        
        updateColorInputs();
        openModal('settings');
    } catch (err) {
        console.error('Error showing settings:', err);
    }
};

const updateColorInputs = () => {
    document.getElementById('colorBg').value = currentSettings.customColors.background || '#1a1a1a';
    document.getElementById('colorAccent').value = currentSettings.customColors.accent || '#6366f1';
    document.getElementById('colorText').value = currentSettings.customColors.text || '#e0e0e0';
    document.getElementById('colorCard').value = currentSettings.customColors.surface || '#2a2a2a';
    document.getElementById('fontSize').value = currentSettings.customLayout?.fontSize || 'medium';
    document.getElementById('cardSize').value = currentSettings.customLayout?.cardSize || 'medium';
};

const saveSettings = async () => {
    try {
        currentSettings.customColors.background = document.getElementById('colorBg').value;
        currentSettings.customColors.accent = document.getElementById('colorAccent').value;
        currentSettings.customColors.text = document.getElementById('colorText').value;
        currentSettings.customColors.surface = document.getElementById('colorCard').value;
        currentSettings.customLayout = currentSettings.customLayout || {};
        currentSettings.customLayout.fontSize = document.getElementById('fontSize').value;
        currentSettings.customLayout.cardSize = document.getElementById('cardSize').value;
        
        const result = await ipcRenderer.invoke('save-settings', currentSettings);
        if (result && result.success) {
            applySettings(currentSettings);
            closeModal();
            console.log('Settings saved successfully');
        } else {
            alert('Failed to save settings');
        }
    } catch (err) {
        console.error('Error saving settings:', err);
        alert('Failed to save settings: ' + err.message);
    }
};

const settingsBtn = document.getElementById('settingsBtn');
settingsBtn.onclick = showSettingsModal;

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
    currentSettings = settings;
    applySettings(settings);
});

loadSettings();

const applyViewMode = () => {
    contentWrapper.className = `content-wrapper ${viewMode}-mode`;
    viewToggleBtn.innerText = viewMode === 'grid' ? "☰ List View" : "🔲 Grid View";
    if (viewMode === 'list' && sortedIds.length > 0 && !selectedListId) {
        selectListItem(sortedIds[0]);
    }
    renderLibrary();
};

viewToggleBtn.onclick = () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('hb-view-mode', viewMode);
    applyViewMode();
};

addBtn.onclick = () => {
    ipcRenderer.send('add-game-requested', { apiKey });
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

    document.getElementById('dashPath').innerText = d.path;

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
    document.getElementById('dashBtnCheckUpdate').onclick = () => checkGameUpdates(id);
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
            card.onclick = () => launchItem(id);
        } else {
            card.innerHTML = `<div class="list-thumb"></div> <div class="list-title">${d.name}</div> <div class="fav-badge" style="position:static;">★</div>`;
            applyListIcon(card.querySelector('.list-thumb'), id, d);
            card.onclick = () => { if (selectedListId === id) launchItem(id); else selectListItem(id); };
        }
        
        library.appendChild(card);
    });

    if (isControllerMode) applyFocus();
}

function openModal(modalName) {
    currentZone = modalName + 'Modal';
    modalFocusIndex = 0;
    renameFocusIndex = 0;
    apiModalFocusIndex = 0;
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
    document.getElementById('apiKeyModal').style.display = 'none';
    document.getElementById('platformModal').style.display = 'none';
    document.getElementById('settingsModal').style.display = 'none';
    
    if (['contextModal', 'customizeModal', 'renameModal', 'apiKeyModal', 'platformModal', 'settingsModal'].includes(currentZone)) {
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
            if (!apiKey) {
                alert("Please add your SteamGridDB API Key to manually adjust artwork resources.");
                return;
            }
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
        'cover': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, type: 'cover', oldPath: gObj.cover || '', apiKey }); closeModal(); }, 
        'icon': () => { ipcRenderer.send('open-icon-picker', { gameId: currentEditingId, name: gameName, type: 'icon', oldPath: gObj.icon || '', apiKey }); closeModal(); }, 
        'background': () => { ipcRenderer.send('open-bg-picker', { gameId: currentEditingId, name: gameName, type: 'background', oldPath: gObj.background || '', apiKey }); closeModal(); }, 
        'remove': () => { 
            ipcRenderer.send('delete-game-assets', [gObj.cover, gObj.icon, gObj.background]);
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

let currentUpdateGameId = null;

async function checkGameUpdates(gameId) {
    if (!gameId || !gameData[gameId]) return;
    const gData = gameData[gameId];
    currentUpdateGameId = gameId;
    
    const progressContainer = document.getElementById('progressContainer');
    const progressLabel = document.getElementById('progressLabel');
    const progressStatus = document.getElementById('progressStatus');
    const progressPercent = document.getElementById('progressPercent');
    const progressBarFill = document.getElementById('progressBarFill');
    const cancelBtn = document.getElementById('cancelUpdateBtn');
    
    progressContainer.classList.add('active');
    progressLabel.textContent = `Checking ${gData.name} for updates...`;
    progressStatus.textContent = `Using ${gData.platform} platform...`;
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';
    
    try {
        const result = await ipcRenderer.invoke('check-game-update', {
            gameId,
            gamePath: gData.path,
            platform: gData.platform || 'custom',
            platformId: gData.platformId || null,
            currentVersion: gData.currentVersion || '1.0.0'
        });
        
        if (result.error) {
            progressStatus.textContent = `Error: ${result.error}`;
            progressLabel.textContent = 'Update check failed';
            return;
        }

        gData.currentVersion = result.currentVersion;
        gData.latestVersion = result.latestVersion;
        
        if (result.hasUpdate) {
            progressLabel.textContent = `Update available for ${gData.name}`;
            progressStatus.textContent = `${result.updateReason || `Current: ${result.currentVersion} → Latest: ${result.latestVersion}`}`;
            progressPercent.textContent = '✓';
            progressBarFill.style.width = '100%';
            cancelBtn.style.display = 'none';

            const card = document.getElementById(gameId);
            if (card) card.classList.add('has-update');

            setTimeout(() => {
                alert(`Update available for ${gData.name}!\n\n${result.updateReason || `Current: ${result.currentVersion}\nLatest: ${result.latestVersion}`}\n\nPlease use the ${gData.platform.toUpperCase()} launcher to install the update.`);
            }, 500);
        } else {
            progressLabel.textContent = `${gData.name} is up to date`;
            progressStatus.textContent = `Version: ${result.currentVersion}`;
            progressPercent.textContent = '✓';
            progressBarFill.style.width = '100%';
            cancelBtn.style.display = 'none';
            
            const card = document.getElementById(gameId);
            if (card) card.classList.remove('has-update');
        }
        
        saveToDisk();
    } catch (err) {
        console.error('Update check error:', err);
        progressStatus.textContent = `Failed: ${err.message}`;
        progressLabel.textContent = 'Update check failed';
        cancelBtn.style.display = 'inline-block';
    }

    setTimeout(() => {
        if (progressContainer.classList.contains('active') && !progressStatus.textContent.includes('Error') && !progressStatus.textContent.includes('Failed')) {
            progressContainer.classList.remove('active');
        }
    }, 5000);
}

document.getElementById('cancelUpdateBtn')?.addEventListener('click', async () => {
    if (currentUpdateGameId) {
        await ipcRenderer.invoke('cancel-game-update', currentUpdateGameId);
        const progressContainer = document.getElementById('progressContainer');
        progressContainer.classList.remove('active');
        currentUpdateGameId = null;
    }
});

document.getElementById('platformGameNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('confirmPlatformBtn').click();
    } else if (e.key === 'Escape') {
        closePlatformModal();
    }
});

ipcRenderer.on('update-progress', (event, { gameId, progress, downloadedSize, totalSize, speed }) => {
    if (gameId !== currentUpdateGameId) return;
    
    const progressBarFill = document.getElementById('progressBarFill');
    const progressPercent = document.getElementById('progressPercent');
    const progressStatus = document.getElementById('progressStatus');
    
    progressBarFill.style.width = `${progress}%`;
    progressPercent.textContent = `${progress}%`;
    
    const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(2);
    const totalMB = (totalSize / 1024 / 1024).toFixed(2);
    progressStatus.textContent = `${downloadedMB}MB / ${totalMB}MB (${speed}MB/s)`;
});

async function detectAndShowPlatform(gameId, name, gamePath, cover, icon, background) {
    try {
        const result = await ipcRenderer.invoke('detect-game-platform', gamePath);

        pendingGamePlatform = {
            id: gameId,
            name,
            path: gamePath,
            cover,
            icon,
            background,
            detectedPlatform: result.platform,
            detectedPlatformId: result.platformId || '',
            confidence: result.confidence
        };

        showPlatformModal(result);
    } catch (err) {
        console.error('Platform detection error:', err);

        addGameWithPlatform('custom', null);
    }
}

function showPlatformModal(detectionResult) {
    const modal = document.getElementById('platformModal');
    const icon = document.getElementById('platformIcon');
    const name = document.getElementById('platformName');
    const details = document.getElementById('platformDetailText');
    const nameInput = document.getElementById('platformGameNameInput');
    
    const platformInfo = {
        steam: { icon: '🎮', name: 'Steam', detail: `App ID: ${detectionResult.platformId || 'Auto-detect'}` },
        xbox: { icon: '🎮', name: 'Xbox App / Game Pass', detail: `Package: ${detectionResult.platformId || 'Auto-detect'}` },
        custom: { icon: '⚙️', name: 'Custom / Other', detail: 'No launcher detected' }
    };

    const info = platformInfo[detectionResult.platform] || platformInfo.custom;
    icon.textContent = info.icon;
    name.textContent = info.name;
    details.textContent = info.detail;

    let displayName = pendingGamePlatform.name;
    if (displayName.toLowerCase().endsWith('.exe')) {
        displayName = displayName.slice(0, -4);
    }
    nameInput.value = displayName;

    document.getElementById('platformOverrideOptions').style.display = 'none';
    
    currentZone = 'platformModal';
    modalFocusIndex = 0;
    modal.style.display = 'flex';
    if (isControllerMode) applyFocus();
}

function closePlatformModal() {
    document.getElementById('platformModal').style.display = 'none';
    currentZone = 'library';
    pendingGamePlatform = null;
}

function addGameWithPlatform(platform, platformId) {
    if (!pendingGamePlatform) return;

    const editedName = document.getElementById('platformGameNameInput').value.trim();
    const gameName = editedName || pendingGamePlatform.name;
    
    const { id, path, cover, icon, background } = pendingGamePlatform;
    gameData[id] = {
        name: gameName,
        path,
        favorite: false,
        cover,
        icon,
        background,
        lastPlayed: 0,
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        platform: platform || 'custom',
        platformId: platformId || null
    };
    
    saveToDisk();
    closePlatformModal();
    renderLibrary();
    if (viewMode === 'list') selectListItem(id);
}

document.getElementById('confirmPlatformBtn')?.addEventListener('click', () => {
    if (pendingGamePlatform) {
        const { detectedPlatform, detectedPlatformId } = pendingGamePlatform;
        addGameWithPlatform(detectedPlatform, detectedPlatformId);
    }
});

document.getElementById('changePlatformBtn')?.addEventListener('click', () => {
    document.getElementById('platformOverrideOptions').style.display = 'block';
});

document.querySelectorAll('[data-platform-override]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const platform = e.target.dataset.platformOverride;
        let platformId = null;
        
        if (platform === 'steam' && pendingGamePlatform?.detectedPlatformId) {
            platformId = pendingGamePlatform.detectedPlatformId;
        } else if (platform === 'xbox' && pendingGamePlatform?.detectedPlatformId) {
            platformId = pendingGamePlatform.detectedPlatformId;
        }
        
        addGameWithPlatform(platform, platformId);
    });
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
    if (document.activeElement !== librarySearch && document.activeElement !== document.getElementById('renameInput') && document.activeElement !== modalApiKeyInput) {
        setControllerActive(false);
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

    document.querySelectorAll('.game-card, .menu-btn, #renameInput, #platformGameNameInput, .dash-btn, #dpPlayBtn, #modalApiKeyInput').forEach(el => el.classList.remove('focused'));
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
    else if (currentZone === 'apiKeyModal') {
        const apiInputEl = document.getElementById('modalApiKeyInput');
        if (apiModalFocusIndex === 0) {
            apiInputEl.classList.add('focused');
            apiInputEl.focus();
        } else {
            apiInputEl.blur();
            const actionBtns = document.querySelectorAll('#apiActionsRow .menu-btn');
            if (actionBtns[apiModalFocusIndex - 1]) actionBtns[apiModalFocusIndex - 1].classList.add('focused');
        }
    }
    else if (currentZone === 'platformModal') {
        const platformBtns = document.querySelectorAll('#platformActionsRow .menu-btn, [data-platform-override]');
        if (document.getElementById('platformOverrideOptions').style.display === 'none') {

            if (modalFocusIndex === 0) {
                document.getElementById('platformGameNameInput').classList.add('focused');
                document.getElementById('platformGameNameInput').focus();
            } else {
                document.getElementById('platformGameNameInput').blur();
                const mainBtns = document.querySelectorAll('#platformActionsRow .menu-btn');
                if (mainBtns[modalFocusIndex - 1]) mainBtns[modalFocusIndex - 1].classList.add('focused');
            }
        } else {

            const overrideBtns = document.querySelectorAll('[data-platform-override]');
            const idx = modalFocusIndex - 2;
            if (overrideBtns[idx]) overrideBtns[idx].classList.add('focused');
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
            else if (currentZone === 'apiKeyModal') {
                if (down && apiModalFocusIndex === 0) { apiModalFocusIndex = 1; moved = true; }
                if (up && apiModalFocusIndex > 0) { apiModalFocusIndex = 0; moved = true; }
                if (right && apiModalFocusIndex === 1) { apiModalFocusIndex = 2; moved = true; }
                if (left && apiModalFocusIndex === 2) { apiModalFocusIndex = 1; moved = true; }
            }
            else if (currentZone === 'platformModal') {
                const overrideShown = document.getElementById('platformOverrideOptions').style.display !== 'none';
                if (overrideShown) {
                    const overrideBtns = document.querySelectorAll('[data-platform-override]');
                    const idx = modalFocusIndex - 3;
                    if (down && idx + 1 < overrideBtns.length) { modalFocusIndex++; moved = true; }
                    if (up && idx > 0) { modalFocusIndex--; moved = true; }
                    if (up && idx === 0) { modalFocusIndex = 2; moved = true; } 
                } else {
                    if (down && modalFocusIndex === 0) { modalFocusIndex = 1; moved = true; }
                    if (up && modalFocusIndex > 0) { modalFocusIndex = 0; moved = true; }
                    if (right && modalFocusIndex === 1) { modalFocusIndex = 2; moved = true; }
                    if (left && modalFocusIndex === 2) { modalFocusIndex = 1; moved = true; }
                }
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
            else if (currentZone === 'apiKeyModal') {
                if (apiModalFocusIndex === 1) handleApiSave();
                else if (apiModalFocusIndex === 2) closeModal();
            }
            else if (currentZone === 'platformModal') {
                const overrideShown = document.getElementById('platformOverrideOptions').style.display !== 'none';
                if (overrideShown) {
                    const overrideBtns = document.querySelectorAll('[data-platform-override]');
                    const idx = modalFocusIndex - 3;
                    if (overrideBtns[idx]) overrideBtns[idx].click();
                } else {
                    if (modalFocusIndex === 0) {
                        
                    } else if (modalFocusIndex === 1) {
                        document.getElementById('confirmPlatformBtn').click();
                    } else if (modalFocusIndex === 2) {
                        document.getElementById('changePlatformBtn').click();
                    }
                }
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
            if (['contextModal', 'customizeModal', 'renameModal', 'apiKeyModal', 'platformModal'].includes(currentZone)) {
                closeModal();
            } else if (currentZone === 'library') {
                currentZone = 'header'; 
                const vis = Array.from(document.querySelectorAll('[data-header-idx]')).filter(el => el.style.display !== 'none');
                headerFocusIndex = vis.length > 0 ? parseInt(vis[0].dataset.headerIdx) : 0;
                applyFocus();
            } else if (currentZone === 'detail-panel') {
                currentZone = 'library'; applyFocus();
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
ipcRenderer.on('add-game-confirmed', (event, newGameObj) => { 
    const { id, name, path, cover, background, icon } = newGameObj; 
    
    detectAndShowPlatform(id, name, path, cover, icon, background);
});

applyViewMode();
updateAPIButtonVisibility();
requestAnimationFrame(handleGamepadLoop);