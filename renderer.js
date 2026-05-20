const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const library = document.getElementById('library');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 
const canvas = document.getElementById('colorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const SAVE_PATH = './library.json';

let audioCtx = null;
function playUISound(type) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const now = audioCtx.currentTime;

        const createLayer = (waveType, start, end, vol, dur, delay = 0) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = waveType;
            osc.frequency.setValueAtTime(start, now + delay);
            if (end !== start) osc.frequency.exponentialRampToValueAtTime(end, now + delay + dur);
            gain.gain.setValueAtTime(vol, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now + delay); osc.stop(now + delay + dur);
        };

        if (type === 'navigate') { createLayer('sine', 120, 90, 0.15, 0.04); createLayer('triangle', 650, 400, 0.02, 0.02); }
        else if (type === 'select') { createLayer('sine', 330, 330, 0.10, 0.25); createLayer('sine', 440, 440, 0.08, 0.22, 0.02); createLayer('triangle', 554, 554, 0.03, 0.18, 0.04); }
        else if (type === 'back') { createLayer('sine', 260, 140, 0.12, 0.20); createLayer('sine', 196, 110, 0.08, 0.25); }
    } catch (e) { console.error(e); }
}

const keys = ["1","2","3","4","5","6","7","8","9","0","q","w","e","r","t","y","u","i","o","p","a","s","d","f","g","h","j","k","l","-","z","x","c","v","b","n","m",",",".","_"];
let gameData = {}, sortedIds = [], currentEditingId = null;
let isControllerMode = false, currentZone = 'grid', focusIndex = 0, headerFocusIndex = 0; 
let lastMoveTime = 0, activeModal = null, modalFocusIndex = 0, kbFocusIndex = 0, isShift = false, isCapsLock = false, lastL3Click = 0;
let lastButtonState = new Array(20).fill(false), lastActiveGamepadIndex = null, backspaceTimeout = null, backspaceInterval = null, isBackspaceHeld = false;

if (fs.existsSync(SAVE_PATH)) {
    try { 
        gameData = JSON.parse(fs.readFileSync(SAVE_PATH)); 
        Object.values(gameData).forEach(d => { d.favorite ??= false; });
    } catch (e) { console.error(e); }
}

const saveToDisk = () => fs.writeFileSync(SAVE_PATH, JSON.stringify(gameData, null, 2));

const launchItem = (id) => { 
    if (gameData[id]?.path) { 
        playUISound('select'); 
        
        gameData[id].lastPlayed = new Date().toISOString(); 
        saveToDisk(); 
        
        renderLibrary(); 
        
        ipcRenderer.send('launch-game-process', { id, executablePath: gameData[id].path }); 
    }
};

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

    ids.forEach((id, i) => {
        const d = gameData[id];
        const card = document.createElement('div');
        card.className = `game-card ${d.favorite ? 'is-fav' : ''}`;
        card.id = id;
        if (d.cover) card.style.backgroundImage = `url("local-image://${d.cover.replace(/\\/g, '/')}?t=${Date.now()}")`;
        
        card.onmouseenter = () => { if (!isControllerMode && d.cover) calculateGlow(card, d.cover); };
        card.onmouseleave = () => { if (!isControllerMode) resetGlobalAccent(); };
        card.onclick = () => launchItem(id);
        card.oncontextmenu = (e) => { e.preventDefault(); showOptionsModal(id); };

        card.innerHTML = `
            <div class="fav-badge">★ FAV</div>
            <div class="info-overlay">
                <div class="game-title">${d.name}</div>
            </div>`;
        library.appendChild(card);
    });
    if (isControllerMode) applyControllerFocus();
}

sortSelect.onchange = () => renderLibrary();

function showOptionsModal(id) {
    currentEditingId = id;
    document.getElementById('contextGameName').innerText = gameData[id].name;
    document.getElementById('favMenuBtn').innerText = gameData[id].favorite ? "Unfavorite" : "Favorite";
    openModal('context');
}

function resetGlobalAccent() {
    document.documentElement.style.setProperty('--accent', '#0078d4');
    document.querySelectorAll('.game-card').forEach(c => c.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)');
}

async function calculateGlow(el, p) {
    const img = new Image();
    img.src = `local-image://${p.replace(/\\/g, '/')}`;
    img.onload = () => {
        if (el.matches(':hover') || el.classList.contains('focused')) {
            canvas.width = canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const px = ctx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0, c = 0;
            for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i+1]; b += px[i+2]; c++; }
            const rA = Math.floor(r/c), gA = Math.floor(g/c), bA = Math.floor(b/c);
            document.documentElement.style.setProperty('--accent', `rgb(${rA}, ${gA}, ${bA})`);
            el.style.boxShadow = `0 0 35px 5px rgba(${rA}, ${gA}, ${bA}, 0.6)`;
        }
    };
}

function setInputMode(c) {
    if (isControllerMode === c) return;
    isControllerMode = c;
    document.body.classList.toggle('controller-mode', c);
    document.getElementById('keyboardContainer').classList.toggle('visible', c && activeModal === 'edit');
    if (!c) resetGlobalAccent();
    else applyControllerFocus();
}

window.addEventListener('mousemove', () => setInputMode(false));
window.addEventListener('keydown', (e) => { 
    if (activeModal === 'edit') return; 
    setInputMode(false); 
});

function updateGlyphs(gamepadId) {
    const isPS = /dualshock|dualsense|wireless controller|playstation/.test(gamepadId.toLowerCase());
    const pairs = [['.footer', ''], ['#oskLegend', '']];
    pairs.forEach(([parent]) => {
        const pEl = document.querySelector(parent);
        if (!pEl) return;
        const glyphs = pEl.querySelectorAll('.glyph');
        const classes = isPS ? ['ps-cross', 'ps-square', 'ps-circle', 'ps-triangle'] : ['a', 'x', 'b', 'y'];
        glyphs.forEach((g, idx) => {
            if (classes[idx]) { g.className = 'glyph'; g.classList.add(classes[idx]); }
        });
    });
}

function applyControllerFocus() {
    if (!isControllerMode) return;
    document.querySelectorAll('[data-header-idx]').forEach(el => el.classList.remove('header-focused'));

    if (activeModal === 'edit') {
        document.querySelectorAll('.key').forEach((k, i) => {
            k.classList.toggle('selected', i === kbFocusIndex);
            k.classList.toggle('uppercase', isShift || isCapsLock);
        });
    }
    if (activeModal) {
        document.querySelectorAll(`#${activeModal}Modal .menu-btn`).forEach((b, i) => b.classList.toggle('selected', i === modalFocusIndex));
    } else {
        document.getElementById('librarySearch').blur();
        document.querySelectorAll('.game-card').forEach((c, i) => {
            const isFocused = (i === focusIndex && currentZone === 'grid');
            c.classList.toggle('focused', isFocused);
            if (isFocused) {
                c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                if (gameData[sortedIds[i]]?.cover) calculateGlow(c, gameData[sortedIds[i]].cover);
                else resetGlobalAccent();
            } else c.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
        });
        if (currentZone === 'header') {
            resetGlobalAccent();
            document.querySelector(`[data-header-idx="${headerFocusIndex}"]`)?.classList.add('header-focused');
        }
        if (sortedIds.length === 0) resetGlobalAccent();
    }
}

function appendOskChar(char) {
    const input = document.getElementById('newNameInput');
    if (!input) return;
    input.value += (isShift || isCapsLock) ? char.toUpperCase() : char.toLowerCase();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    playUISound('navigate');
    if (isShift) { isShift = false; applyControllerFocus(); }
}

function triggerBackspace() {
    const input = document.getElementById('newNameInput');
    if (input?.value.length > 0) {
        input.value = input.value.slice(0, -1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        playUISound('navigate');
    }
}

function clearBackspaceTimers() {
    isBackspaceHeld = false;
    clearTimeout(backspaceTimeout); clearInterval(backspaceInterval);
}

function updateGamepad() {
    if (!document.hasFocus()) { requestAnimationFrame(updateGamepad); return; }
    const gamepads = navigator.getGamepads();
    const now = Date.now();
    let activeGp = Array.from(gamepads).find(gp => gp?.connected && (gp.buttons.some(b => b.pressed) || gp.axes.some(a => Math.abs(a) > 0.5)));

    if (activeGp) {
        setInputMode(true);
        if (lastActiveGamepadIndex !== activeGp.index) { lastActiveGamepadIndex = activeGp.index; updateGlyphs(activeGp.id); }
    } else if (isControllerMode) {
        activeGp = gamepads[lastActiveGamepadIndex] || Array.from(gamepads).find(p => p !== null);
    }

    if (activeGp && isControllerMode) {
        if (now - lastMoveTime > 180) {
            let moved = false;
            const up = activeGp.axes[1] < -0.5 || activeGp.buttons[12].pressed;
            const down = activeGp.axes[1] > 0.5 || activeGp.buttons[13].pressed;
            const left = activeGp.axes[0] < -0.5 || activeGp.buttons[14].pressed;
            const right = activeGp.axes[0] > 0.5 || activeGp.buttons[15].pressed;

            if (activeModal === 'edit') {
                if (right) { kbFocusIndex = (kbFocusIndex + 1) % keys.length; moved = true; }
                if (left) { kbFocusIndex = (kbFocusIndex - 1 + keys.length) % keys.length; moved = true; }
                if (down) { kbFocusIndex = Math.min(keys.length - 1, kbFocusIndex + 10); moved = true; }
                if (up) { kbFocusIndex = Math.max(0, kbFocusIndex - 10); moved = true; }
            } else if (activeModal) {
                const btns = document.querySelectorAll(`#${activeModal}Modal .menu-btn`);
                if (btns.length > 0) {
                    if (down) { modalFocusIndex = (modalFocusIndex + 1) % btns.length; moved = true; }
                    if (up) { modalFocusIndex = (modalFocusIndex - 1 + btns.length) % btns.length; moved = true; }
                }
            } else {
                if (currentZone === 'header') {
                    if (right) { headerFocusIndex = (headerFocusIndex + 1) % 3; moved = true; }
                    if (left) { headerFocusIndex = (headerFocusIndex - 1 + 3) % 3; moved = true; }
                    if (down) { currentZone = 'grid'; focusIndex = 0; moved = true; }
                } else {
                    const cols = Math.floor(library.offsetWidth / 200) || 5;
                    if (right) { focusIndex++; moved = true; }
                    if (left && focusIndex > 0) { focusIndex--; moved = true; }
                    if (down && focusIndex + cols < sortedIds.length) { focusIndex += cols; moved = true; }
                    if (up) { 
                        if (focusIndex < cols) { currentZone = 'header'; headerFocusIndex = 0; } 
                        else { focusIndex -= cols; }
                        moved = true;
                    }
                    if (sortedIds.length > 0) focusIndex = Math.max(0, Math.min(focusIndex, sortedIds.length - 1));
                }
            }
            if (moved) { applyControllerFocus(); playUISound('navigate'); lastMoveTime = now; }
        }

        if (activeGp.buttons[0].pressed && !lastButtonState[0]) handleA();
        if (activeGp.buttons[1].pressed && !lastButtonState[1]) handleB();
        
        if (activeGp.buttons[2].pressed) {
            if (activeModal === 'edit' && !isBackspaceHeld) {
                isBackspaceHeld = true; triggerBackspace(); 
                backspaceTimeout = setTimeout(() => { backspaceInterval = setInterval(triggerBackspace, 40); }, 500); 
            } else if (activeModal !== 'edit' && !lastButtonState[2]) handleX();
        } else if (isBackspaceHeld) clearBackspaceTimers();
        
        if (activeGp.buttons[3].pressed && !lastButtonState[3] && activeModal === 'edit') appendOskChar(" ");
        if (activeGp.buttons[7].pressed && !lastButtonState[7] && activeModal === 'edit') executeAction('save-name');
        
        if (activeGp.buttons[8].pressed && !lastButtonState[8] && !activeModal) {
            currentZone = (currentZone === 'grid') ? 'header' : 'grid'; applyControllerFocus(); playUISound('navigate');
        }
        if (activeGp.buttons[10].pressed && !lastButtonState[10] && activeModal === 'edit') {
            if (now - lastL3Click < 300) { isCapsLock = !isCapsLock; isShift = false; } 
            else { isShift = !isShift; if (isShift) isCapsLock = false; }
            lastL3Click = now;
            document.getElementById('oskShiftLabel').innerText = isCapsLock ? "Caps Lock" : "Shift";
            applyControllerFocus(); playUISound('navigate');
        }

        activeGp.buttons.forEach((b, i) => {
            if (!(activeModal === 'edit' && (i === 2 || i === 7))) lastButtonState[i] = b.pressed;
        });
    }
    requestAnimationFrame(updateGamepad);
}

function handleA() {
    if (activeModal === 'edit') appendOskChar(keys[kbFocusIndex]);
    else if (activeModal) {
        const btns = document.querySelectorAll(`#${activeModal}Modal .menu-btn`);
        if (btns[modalFocusIndex]) executeAction(btns[modalFocusIndex].dataset.action);
    } else if (currentZone === 'header') {
        playUISound('select');
        if (headerFocusIndex === 0) {
            currentEditingId = 'search-filter'; closeModal();
            setTimeout(() => { document.getElementById('newNameInput').value = librarySearch.value; openModal('edit'); }, 50);
        } else if (headerFocusIndex === 1) {
            sortSelect.selectedIndex = (sortSelect.selectedIndex + 1) % sortSelect.options.length;
            renderLibrary();
        } else if (headerFocusIndex === 2) document.getElementById('addBtn').click();
    } else if (sortedIds[focusIndex]) launchItem(sortedIds[focusIndex]);
}

async function executeAction(action) {
    playUISound('select');
    const actions = {
        'toggle-fav': () => { gameData[currentEditingId].favorite = !gameData[currentEditingId].favorite; saveToDisk(); renderLibrary(); closeModal(); },
        'rename': () => { const old = gameData[currentEditingId].name; closeModal(); setTimeout(() => { document.getElementById('newNameInput').value = old; openModal('edit'); }, 50); },
        'cover': () => { closeModal(); ipcRenderer.send('open-picker', { id: currentEditingId, name: gameData[currentEditingId].name }); },
        'open-folder': () => { ipcRenderer.send('open-file-location', gameData[currentEditingId].path); closeModal(); },
        'change-path': async () => { const p = await ipcRenderer.invoke('select-game'); if (p) { gameData[currentEditingId].path = p; saveToDisk(); } closeModal(); },
        'remove': () => { if (gameData[currentEditingId]?.cover) ipcRenderer.send('delete-cover-file', gameData[currentEditingId].cover); delete gameData[currentEditingId]; saveToDisk(); renderLibrary(); closeModal(); },
        'save-name': () => { 
            const val = document.getElementById('newNameInput').value; 
            if (currentEditingId !== 'search-filter') { gameData[currentEditingId].name = val; saveToDisk(); }
            renderLibrary(); closeModal(); 
        },
        'quit-confirm': () => ipcRenderer.send('quit-app-now')
    };
    if (actions[action]) await actions[action](); else closeModal();
}

function handleB() {
    playUISound(activeModal ? 'back' : (currentZone === 'header' ? 'back' : 'select'));
    if (activeModal) closeModal();
    else if (currentZone === 'header') { currentZone = 'grid'; applyControllerFocus(); }
    else openModal('quit');
}

function handleX() {
    if (currentZone !== 'header' && sortedIds[focusIndex] && !activeModal) { playUISound('select'); showOptionsModal(sortedIds[focusIndex]); }
}

function openModal(t) { 
    activeModal = t; modalFocusIndex = 0; 
    document.getElementById(`${t}Modal`).style.display = 'flex'; 
    if (t === 'edit') { 
        document.getElementById('newNameInput').removeAttribute('readonly'); 
        document.getElementById('newNameInput').focus(); 
    }
    document.getElementById('keyboardContainer').classList.toggle('visible', isControllerMode && t === 'edit');
    applyControllerFocus(); 
}

function closeModal() { 
    clearBackspaceTimers();
    if (activeModal) document.getElementById(`${activeModal}Modal`).style.display = 'none';
    if (activeModal === 'edit') document.getElementById('newNameInput').setAttribute('readonly', true);
    document.getElementById('keyboardContainer').classList.remove('visible');
    activeModal = null; isShift = isCapsLock = false;
    applyControllerFocus(); 
}

document.querySelectorAll('.menu-btn').forEach(btn => btn.onclick = () => executeAction(btn.dataset.action));

document.addEventListener('DOMContentLoaded', () => {
    const kbContainer = document.getElementById('virtualKeyboard');
    if (kbContainer) {
        kbContainer.innerHTML = '';
        keys.forEach(key => {
            const keyEl = document.createElement('div');
            keyEl.className = 'key'; keyEl.innerText = key;
            keyEl.onclick = () => appendOskChar(key);
            kbContainer.appendChild(keyEl);
        });
    }

    document.getElementById('librarySearch')?.addEventListener('input', () => renderLibrary());
    document.getElementById('newNameInput')?.addEventListener('input', () => {
        if (currentEditingId === 'search-filter') {
            librarySearch.value = document.getElementById('newNameInput').value;
            renderLibrary();
        }
    });

    renderLibrary();
    requestAnimationFrame(updateGamepad);
    document.getElementById('addBtn')?.addEventListener('click', () => ipcRenderer.send('add-game-requested'));
});

ipcRenderer.on('add-game-confirmed', (e, filePath) => {
    gameData['game-' + Date.now()] = { name: path.basename(filePath, path.extname(filePath)), path: filePath, favorite: false, cover: '' };
    saveToDisk(); renderLibrary();
});

ipcRenderer.on('cover-updated', (e, { id, path }) => {
    if (gameData[id]) {
        gameData[id].cover = path; saveToDisk();
        const card = document.getElementById(id);
        if (card) card.style.backgroundImage = `url("local-image://${path.replace(/\\/g, '/')}?t=${Date.now()}")`;
    }
});