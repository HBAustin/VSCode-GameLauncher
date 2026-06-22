const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const library = document.getElementById('library');
const contentWrapper = document.getElementById('contentWrapper');
const viewToggleBtn = document.getElementById('viewToggleBtn');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 

const SAVE_PATH = './library.json';

// App Core State
let gameData = {};
let sortedIds = [];
let currentEditingId = null;
let runningGames = new Set();
const iconCache = {};

let viewMode = localStorage.getItem('hb-view-mode') || 'grid';
let selectedListId = null; 

// Controller State Variables
let isControllerMode = false;
let currentZone = 'library'; // zones: 'header', 'library', 'detail-panel', 'contextModal', 'customizeModal', 'renameModal'
let focusIndex = 0;          
let headerFocusIdx = 0;      
let modalFocusIdx = 0;       // Tracks options layout index
let customizeFocusIdx = 0;   // Tracks asset layout index
let renameFocusIdx = 0;      
let lastMoveTime = 0;
let lastButtonState = new Array(20).fill(false);
let lastActiveGamepadIdx = null;

// Disk IO
if (fs.existsSync(SAVE_PATH)) {
    try { 
        gameData = JSON.parse(fs.readFileSync(SAVE_PATH));
        Object.values(gameData).forEach(d => { 
            d.favorite ??= false; 
            d.background ??= ''; 
            d.icon ??= ''; 
            d.version ??= 0; 
        });
    } catch (e) { 
        console.error("Error reading configuration layout:", e);
    }
}

const saveToDisk = () => {
    fs.writeFileSync(SAVE_PATH, JSON.stringify(gameData, null, 2));
};

// Layout Adapters
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

const launchItem = (id) => { 
    if (runningGames.has(id)) return;
    if (gameData[id]?.path) { 
        gameData[id].lastPlayed = new Date().toISOString(); 
        saveToDisk(); 
        if(viewMode === 'list') selectListItem(id);
        ipcRenderer.send('launch-game-process', { id, executablePath: gameData[id].path }); 
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
    document.getElementById('dpPath').innerText = d.path;
    document.getElementById('dpLastPlayed').innerText = d.lastPlayed ? new Date(d.lastPlayed).toLocaleString() : "Never";

    const heroBg = d.background || d.cover;
    document.getElementById('dpHero').style.backgroundImage = heroBg ? `url('file:///${heroBg.replace(/\\/g, '/')}?v=${d.version || 0}')` : 'none';
    document.getElementById('dpPlayBtn').onclick = () => launchItem(id);
};

async function applyListIcon(thumbEl, gameId, gameDataObj) {
    if (gameDataObj.icon) {
        thumbEl.style.backgroundImage = `url('file:///${gameDataObj.icon.replace(/\\/g, '/')}?v=${gameDataObj.version || 0}')`;
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
        'last-played': (a, b) => new Date(gameData[b].lastPlayed || 0) - new Date(gameData[a].lastPlayed || 0)
    };
    
    if (sortModes[sortSelect.value]) ids.sort(sortModes[sortSelect.value]);
    ids.sort((a, b) => (gameData[b].favorite ? 1 : 0) - (gameData[a].favorite ? 1 : 0));
    sortedIds = ids;

    ids.forEach((id) => {
        const d = gameData[id];
        const card = document.createElement('div');
        const runningClass = runningGames.has(id) ? 'is-running' : '';
        const selectedClass = (viewMode === 'list' && id === selectedListId) ? 'list-selected' : '';
        
        card.className = `game-card ${d.favorite ? 'is-fav' : ''} ${runningClass} ${selectedClass}`;
        card.id = id;
        
        if (viewMode === 'grid') {
            const hasCover = !!d.cover;
            if (hasCover) card.style.backgroundImage = `url('file:///${d.cover.replace(/\\/g, '/')}?v=${d.version || 0}')`;
            card.innerHTML = `
                <div class="fav-badge">★</div>
                ${!hasCover ? `<div class="fallback-title">${d.name}</div>` : ''}
                <div class="info-overlay"><div style="font-weight:bold; font-size:0.9rem">${d.name}</div></div>`;
            card.onclick = () => launchItem(id);
        } else {
            card.innerHTML = `<div class="list-thumb"></div><div class="list-title">${d.name}</div><div class="fav-badge" style="position:static;">★</div>`;
            applyListIcon(card.querySelector('.list-thumb'), id, d);
            card.onclick = () => {
                if (selectedListId === id) launchItem(id);
                else selectListItem(id);
            };
        }

        card.oncontextmenu = (e) => { e.preventDefault(); showOptionsModal(id); };
        library.appendChild(card);
    });
    if (isControllerMode) applyFocus();
}

function showOptionsModal(id) {
    currentEditingId = id;
    modalFocusIdx = 0;
    currentZone = 'contextModal';
    document.getElementById('contextGameName').innerText = gameData[id].name;
    document.getElementById('favMenuBtn').innerText = gameData[id].favorite ? "Unfavorite" : "Favorite";
    document.getElementById('contextModal').style.display = 'flex';
    document.getElementById('customizeModal').style.display = 'none';
    if (isControllerMode) applyFocus();
}

function closeModal() { 
    document.getElementById('contextModal').style.display = 'none';
    document.getElementById('customizeModal').style.display = 'none';
    document.getElementById('renameModal').style.display = 'none';
    
    if (['contextModal', 'customizeModal', 'renameModal'].includes(currentZone)) {
        currentZone = 'library';
    }
    if (isControllerMode) applyFocus();
}

async function executeAction(action) {
    if (!currentEditingId || !gameData[currentEditingId]) return;
    const gameName = gameData[currentEditingId].name;
    
    const actions = {
        'toggle-fav': () => { 
            gameData[currentEditingId].favorite = !gameData[currentEditingId].favorite;
            saveToDisk(); renderLibrary(); closeModal(); 
        },
        'rename': () => {
            document.getElementById('contextModal').style.display = 'none';
            document.getElementById('renameInput').value = gameData[currentEditingId].name;
            document.getElementById('renameModal').style.display = 'flex';
            currentZone = 'renameModal';
            renameFocusIdx = 0;
            if (isControllerMode) applyFocus();
            else document.getElementById('renameInput').focus();
        },
        'open-customize': () => {
            document.getElementById('contextModal').style.display = 'none';
            document.getElementById('customizeModal').style.display = 'flex';
            currentZone = 'customizeModal';
            customizeFocusIdx = 0;
            if (isControllerMode) applyFocus();
        },
        'back-to-main': () => {
            document.getElementById('customizeModal').style.display = 'none';
            document.getElementById('contextModal').style.display = 'flex';
            currentZone = 'contextModal';
            modalFocusIdx = 2; // Return focus back on Customize button
            if (isControllerMode) applyFocus();
        },
        'change-path': async () => {
            const newPath = await ipcRenderer.invoke('select-game');
            if (newPath) {
                gameData[currentEditingId].path = newPath;
                saveToDisk(); renderLibrary();
                if (selectedListId === currentEditingId) selectListItem(currentEditingId);
            }
            closeModal();
        },
        'cover': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, oldPath: gameData[currentEditingId].cover || '', mode: 'cover' }); closeModal(); },
        'icon': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, oldPath: gameData[currentEditingId].icon || '', mode: 'icon' }); closeModal(); },
        'background': () => { ipcRenderer.send('open-picker', { gameId: currentEditingId, name: gameName, oldPath: gameData[currentEditingId].background || '', mode: 'bg' }); closeModal(); },
        'remove': () => { delete gameData[currentEditingId]; saveToDisk(); renderLibrary(); closeModal(); },
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

// --- CONTROLLER LOOPS & CORE INPUT MATRIX ---
function setControllerActive(state) {
    if (isControllerMode === state) return;
    isControllerMode = state;
    document.body.classList.toggle('controller-mode', state);
    if (state) applyFocus();
}

window.addEventListener('mousemove', () => setControllerActive(false));
window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl !== librarySearch && activeEl !== document.getElementById('renameInput')) {
        setControllerActive(false);
    }
});

function updateGlyphs(gamepadId) {
    const id = gamepadId.toLowerCase();
    const isPS = id.includes('dualshock') || id.includes('dualsense') || id.includes('playstation') || id.includes('wireless controller');
    const aEl = document.getElementById('glyphA');
    const bEl = document.getElementById('glyphB');
    const xEl = document.getElementById('glyphX');

    if (aEl) {
        aEl.className = 'glyph';
        aEl.classList.add(isPS ? 'ps-cross' : 'a');
        aEl.innerText = isPS ? '✕' : 'A';
    }
    if (bEl) {
        bEl.className = 'glyph';
        bEl.classList.add(isPS ? 'ps-circle' : 'b');
        bEl.innerText = isPS ? '◯' : 'B';
    }
    if (xEl) {
        xEl.className = 'glyph';
        xEl.classList.add(isPS ? 'ps-square' : 'x');
        xEl.innerText = isPS ? '▢' : 'X';
    }
}

function applyFocus() {
    if (!isControllerMode) return;

    librarySearch.classList.remove('header-focused');
    sortSelect.classList.remove('header-focused');
    viewToggleBtn.classList.remove('header-focused');
    document.getElementById('addBtn').classList.remove('header-focused');
    document.getElementById('dpPlayBtn').classList.remove('focused');
    document.getElementById('renameInput').classList.remove('focused');
    
    document.querySelectorAll('#library .game-card').forEach(el => el.classList.remove('focused'));
    document.querySelectorAll('#contextOptionsList .menu-btn').forEach(el => el.classList.remove('focused'));
    document.querySelectorAll('#customizeOptionsList .menu-btn').forEach(el => el.classList.remove('focused'));
    document.querySelectorAll('#renameActionsRow .menu-btn').forEach(el => el.classList.remove('focused'));

    if (currentZone === 'header') {
        const headerElements = [librarySearch, sortSelect, viewToggleBtn, document.getElementById('addBtn')];
        headerElements[headerFocusIdx]?.classList.add('header-focused');
        if (headerFocusIdx === 0) librarySearch.focus(); else librarySearch.blur();
    } 
    else if (currentZone === 'library') {
        librarySearch.blur();
        const cards = document.querySelectorAll('#library .game-card');
        if (cards[focusIndex]) {
            cards[focusIndex].classList.add('focused');
            cards[focusIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            if (viewMode === 'list' && sortedIds[focusIndex]) selectListItem(sortedIds[focusIndex]);
        }
    } 
    else if (currentZone === 'detail-panel') {
        document.getElementById('dpPlayBtn').classList.add('focused');
    } 
    else if (currentZone === 'contextModal') {
        const modalBtns = document.querySelectorAll('#contextOptionsList .menu-btn');
        if (modalBtns[modalFocusIdx]) modalBtns[modalFocusIdx].classList.add('focused');
    } 
    else if (currentZone === 'customizeModal') {
        const customBtns = document.querySelectorAll('#customizeOptionsList .menu-btn');
        if (customBtns[customizeFocusIdx]) customBtns[customizeFocusIdx].classList.add('focused');
    }
    else if (currentZone === 'renameModal') {
        const renameInputEl = document.getElementById('renameInput');
        if (renameFocusIdx === 0) {
            renameInputEl.classList.add('focused');
            renameInputEl.focus();
        } else {
            renameInputEl.blur();
            const actionBtns = document.querySelectorAll('#renameActionsRow .menu-btn');
            actionBtns[renameFocusIdx - 1]?.classList.add('focused');
        }
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
            if (lastActiveGamepadIdx !== gp.index) {
                lastActiveGamepadIdx = gp.index;
                updateGlyphs(gp.id);
            }
            break;
        }
    }

    if (!activeGp && isControllerMode) activeGp = gamepads[lastActiveGamepadIdx] || Array.from(gamepads).find(p => p !== null);

    if (activeGp && isControllerMode) {
        const now = Date.now();
        if (now - lastMoveTime > 180) {
            let moved = false;
            const up = activeGp.axes[1] < -0.5 || activeGp.buttons[12].pressed;
            const down = activeGp.axes[1] > 0.5 || activeGp.buttons[13].pressed;
            const left = activeGp.axes[0] < -0.5 || activeGp.buttons[14].pressed;
            const right = activeGp.axes[0] > 0.5 || activeGp.buttons[15].pressed;

            if (currentZone === 'header') {
                if (right && headerFocusIdx < 3) { headerFocusIdx++; moved = true; }
                if (left && headerFocusIdx > 0) { headerFocusIdx--; moved = true; }
                if (down && sortedIds.length > 0) { currentZone = 'library'; focusIndex = 0; moved = true; }
            } 
            else if (currentZone === 'library') {
                const cols = viewMode === 'grid' ? (Math.floor(library.offsetWidth / 200) || 1) : 1;
                if (down) { if (focusIndex + cols < sortedIds.length) { focusIndex += cols; moved = true; } }
                if (up) { 
                    if (focusIndex < cols) { currentZone = 'header'; headerFocusIdx = 0; moved = true; } 
                    else { focusIndex -= cols; moved = true; } 
                }
                if (right) { currentZone = 'detail-panel'; moved = true; }
                if (left && viewMode === 'grid' && focusIndex > 0) { focusIndex--; moved = true; }
            } 
            else if (currentZone === 'detail-panel') {
                if (left) { currentZone = 'library'; moved = true; }
            } 
            else if (currentZone === 'contextModal') {
                const totalBtns = document.querySelectorAll('#contextOptionsList .menu-btn').length;
                if (down && modalFocusIdx < totalBtns - 1) { modalFocusIdx++; moved = true; }
                if (up && modalFocusIdx > 0) { modalFocusIdx--; moved = true; }
            } 
            else if (currentZone === 'customizeModal') {
                const totalBtns = document.querySelectorAll('#customizeOptionsList .menu-btn').length;
                if (down && customizeFocusIdx < totalBtns - 1) { customizeFocusIdx++; moved = true; }
                if (up && customizeFocusIdx > 0) { customizeFocusIdx--; moved = true; }
            }
            else if (currentZone === 'renameModal') {
                if (down && renameFocusIdx === 0) { renameFocusIdx = 1; moved = true; }
                if (up && renameFocusIdx > 0) { renameFocusIdx = 0; moved = true; }
                if (right && renameFocusIdx === 1) { renameFocusIdx = 2; moved = true; }
                if (left && renameFocusIdx === 2) { renameFocusIdx = 1; moved = true; }
            }

            if (moved) { applyFocus(); lastMoveTime = now; }
        }

        // Button A (Select)
        if (activeGp.buttons[0].pressed && !lastButtonState[0]) { 
            if (currentZone === 'header') {
                const headerElements = [librarySearch, sortSelect, viewToggleBtn, document.getElementById('addBtn')];
                headerElements[headerFocusIdx]?.click();
            } 
            else if (currentZone === 'library') {
                if (sortedIds[focusIndex]) launchItem(sortedIds[focusIndex]);
            } 
            else if (currentZone === 'detail-panel') {
                if (selectedListId) launchItem(selectedListId);
            } 
            else if (currentZone === 'contextModal') {
                const modalBtns = document.querySelectorAll('#contextOptionsList .menu-btn');
                modalBtns[modalFocusIdx]?.click();
            } 
            else if (currentZone === 'customizeModal') {
                const customBtns = document.querySelectorAll('#customizeOptionsList .menu-btn');
                customBtns[customizeFocusIdx]?.click();
            }
            else if (currentZone === 'renameModal') {
                if (renameFocusIdx === 1) handleRenameSave();
                else if (renameFocusIdx === 2) closeModal();
            }
        }

        // Button B (Back)
        if (activeGp.buttons[1].pressed && !lastButtonState[1]) { 
            if (currentZone === 'renameModal') {
                closeModal();
            } else if (currentZone === 'customizeModal') {
                executeAction('back-to-main');
            } else if (currentZone === 'contextModal') {
                closeModal();
            } else if (currentZone === 'detail-panel' || currentZone === 'header') {
                currentZone = 'library';
                applyFocus();
            }
        }

        // Button X (Options Quick Trigger)
        if (activeGp.buttons[2].pressed && !lastButtonState[2]) {
            if (currentZone === 'library' && sortedIds[focusIndex]) showOptionsModal(sortedIds[focusIndex]);
            else if (currentZone === 'detail-panel' && selectedListId) showOptionsModal(selectedListId);
        }

        for (let i = 0; i < activeGp.buttons.length; i++) { lastButtonState[i] = activeGp.buttons[i].pressed; }
    }
    requestAnimationFrame(handleGamepadLoop);
}

// Global Event Handlers
document.getElementById('confirmRenameBtn').onclick = handleRenameSave;
document.getElementById('cancelRenameBtn').onclick = closeModal;

document.getElementById('renameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleRenameSave();
    else if (e.key === 'Escape') closeModal();
});

// Map events across both context and customization option lists
document.querySelectorAll('#contextOptionsList .menu-btn, #customizeOptionsList .menu-btn').forEach(btn => {
    btn.onclick = () => executeAction(btn.dataset.action);
});

const handleUpdate = (id, path, key) => {
    if (gameData[id]) {
        gameData[id][key] = path;
        gameData[id].version = (gameData[id].version || 0) + 1;
        saveToDisk(); renderLibrary();
        if(selectedListId === id) selectListItem(id);
    }
};

ipcRenderer.on('cover-updated', (e, { id, path }) => handleUpdate(id, path, 'cover'));
ipcRenderer.on('bg-updated', (e, { id, path }) => handleUpdate(id, path, 'background'));
ipcRenderer.on('icon-updated', (e, { id, path }) => handleUpdate(id, path, 'icon'));

ipcRenderer.on('add-game-confirmed', (event, filePath) => {
    const id = 'game-' + Date.now();
    const fileName = path.basename(filePath, path.extname(filePath));
    gameData[id] = { name: fileName, path: filePath, favorite: false, cover: '', icon: '', background: '', version: 0 };
    saveToDisk(); renderLibrary();
});

ipcRenderer.on('game-started', (e, { id }) => { runningGames.add(id); renderLibrary(); });
ipcRenderer.on('game-stopped', (e, { id }) => { runningGames.delete(id); renderLibrary(); });

librarySearch.addEventListener('input', renderLibrary);
sortSelect.addEventListener('change', renderLibrary);
document.getElementById('addBtn').onclick = () => ipcRenderer.send('add-game-requested');

applyViewMode();
const lastSelected = localStorage.getItem('hb-last-selected');
if (lastSelected && gameData[lastSelected]) selectListItem(lastSelected);

requestAnimationFrame(handleGamepadLoop);