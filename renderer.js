const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const library = document.getElementById('library');
const sortSelect = document.getElementById('sortSelect');
const librarySearch = document.getElementById('librarySearch'); 
const canvas = document.getElementById('colorCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const SAVE_PATH = './library.json';

// --- MODERN SYSTEM AUDIO SYNTHESIZER ENGINE (0KB FOOTPRINT) ---
let audioCtx = null;
function playUISound(type) {
    try {
        if (!audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;

        // Helper function to build clean organic layers safely
        function createLayer(waveType, startFreq, endFreq, volume, duration, delay = 0) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = waveType;
            osc.frequency.setValueAtTime(startFreq, now + delay);
            if (endFreq !== startFreq) {
                osc.frequency.exponentialRampToValueAtTime(endFreq, now + delay + duration);
            }
            
            gain.gain.setValueAtTime(volume, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now + delay);
            osc.stop(now + delay + duration);
        }

        if (type === 'navigate') {
            // Modern UI Organic Click: Layered low mechanical thud + soft transient click
            createLayer('sine', 120, 90, 0.15, 0.04);   // Low-end deep weight
            createLayer('triangle', 650, 400, 0.02, 0.02); // Crisp surface pop
        } 
        else if (type === 'select') {
            // Modern Dashboard Smooth Confirmation: Ethereal chord arrangement
            createLayer('sine', 330, 330, 0.10, 0.25); // Mid note base focus
            createLayer('sine', 440, 440, 0.08, 0.22, 0.02); // Harmony note layer delayed by 20ms
            createLayer('triangle', 554, 554, 0.03, 0.18, 0.04); // Bright top accent spark
        } 
        else if (type === 'back') {
            // Modern Fluid Dissolve Sweep: Smooth atmospheric descending glide
            createLayer('sine', 260, 140, 0.12, 0.20); // Low gliding dampener
            createLayer('sine', 196, 110, 0.08, 0.25); // Sub acoustic drop shadow
        }
    } catch (err) {
        console.error("Audio generation exception caught safely:", err);
    }
}

const keys = [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
    "q", "w", "e", "r", "t", "y", "u", "i", "o", "p",
    "a", "s", "d", "f", "g", "h", "j", "k", "l", "-",
    "z", "x", "c", "v", "b", "n", "m", ",", ".", "_"
];

let gameData = {};
let sortedIds = [];
let currentEditingId = null;

let isControllerMode = false;
let currentZone = 'grid'; 
let focusIndex = 0; 
let headerFocusIndex = 0; 

let lastMoveTime = 0;
let activeModal = null;
let modalFocusIndex = 0;
let kbFocusIndex = 0;
let isShift = false, isCapsLock = false, lastL3Click = 0;
let lastButtonState = new Array(20).fill(false);
let lastActiveGamepadIndex = null; 

// Continuous Backspace State Engine Mappings
let backspaceTimeout = null;
let backspaceInterval = null;
let isBackspaceHeld = false;

if (fs.existsSync(SAVE_PATH)) {
    try { 
        gameData = JSON.parse(fs.readFileSync(SAVE_PATH)); 
        Object.keys(gameData).forEach(id => {
            if (gameData[id].playtime === undefined) gameData[id].playtime = 0;
            if (gameData[id].lastPlayed === undefined) gameData[id].lastPlayed = 0;
            if (gameData[id].favorite === undefined) gameData[id].favorite = false;
        });
    } catch (e) { console.error(e); }
}

function saveToDisk() { fs.writeFileSync(SAVE_PATH, JSON.stringify(gameData, null, 2)); }

function launchItem(id) {
    const d = gameData[id];
    if (!d || !d.path) return;
    playUISound('select'); // Play sound right when starting executable launch thread
    ipcRenderer.send('launch-game-process', { id, executablePath: d.path });
}

ipcRenderer.on('game-stopped', (e, data) => {
    if (gameData[data.id]) {
        gameData[data.id].playtime += data.durationMinutes;
        gameData[data.id].lastPlayed = data.lastPlayed;
        saveToDisk();
        renderLibrary();
    }
});

function renderLibrary() {
    library.innerHTML = '';
    let ids = Object.keys(gameData);
    const searchQuery = librarySearch.value.toLowerCase();

    if (searchQuery) ids = ids.filter(id => gameData[id].name.toLowerCase().includes(searchQuery));

    if (sortSelect.value === 'alpha') ids.sort((a,b) => gameData[a].name.localeCompare(gameData[b].name));
    else if (sortSelect.value === 'added') ids.sort((a, b) => b.split('-')[1] - a.split('-')[1]);
    else if (sortSelect.value === 'played') ids.sort((a, b) => gameData[b].playtime - gameData[a].playtime);
    else if (sortSelect.value === 'last-played') ids.sort((a, b) => gameData[b].lastPlayed - gameData[a].lastPlayed);

    ids.sort((a, b) => (gameData[b].favorite ? 1 : 0) - (gameData[a].favorite ? 1 : 0));
    sortedIds = ids;

    ids.forEach(id => {
        const d = gameData[id];
        const card = document.createElement('div');
        card.className = 'game-card';
        card.id = id;
        if (d.favorite) card.classList.add('is-fav');
        if (d.cover) card.style.backgroundImage = `url("local-image://${d.cover.replace(/\\/g, '/')}?t=${Date.now()}")`;
        
        card.onmouseenter = () => { if (!isControllerMode && d.cover) calculateGlow(card, d.cover); };
        card.onmouseleave = () => { if (!isControllerMode) resetGlobalAccent(); };
        
        const hours = (d.playtime / 60).toFixed(1);
        card.innerHTML = `
            <div class="fav-badge">★ FAV</div>
            <div class="info-overlay">
                <div class="game-title">${d.name}</div>
                <div class="game-meta">${d.lastPlayed ? `${hours} hrs · Played recently` : `${hours} hrs · Unplayed`}</div>
            </div>`;
        card.onclick = () => launchItem(id);
        card.oncontextmenu = (e) => { e.preventDefault(); showOptionsModal(id); };
        library.appendChild(card);
    });
    if(isControllerMode) applyControllerFocus();
}

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
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const px = ctx.getImageData(0,0,50,50).data;
            let r=0, g=0, b=0, c=0;
            for(let i=0; i<px.length; i+=4){ r+=px[i]; g+=px[i+1]; b+=px[i+2]; c++; }
            const rAvg = Math.floor(r/c), gAvg = Math.floor(g/c), bAvg = Math.floor(b/c);
            document.documentElement.style.setProperty('--accent', `rgb(${rAvg}, ${gAvg}, ${bAvg})`);
            el.style.boxShadow = `0 0 35px 5px rgba(${rAvg}, ${gAvg}, ${bAvg}, 0.6)`;
        }
    };
}

function setInputMode(c) {
    if (isControllerMode === c) return;
    isControllerMode = c;
    document.body.classList.toggle('controller-mode', c);
    
    const kbContainer = document.getElementById('keyboardContainer');
    if (c && activeModal === 'edit') kbContainer.classList.add('visible');
    else kbContainer.classList.remove('visible');

    if(!c) resetGlobalAccent();
    if(c) applyControllerFocus();
}

window.addEventListener('mousemove', () => setInputMode(false));
window.addEventListener('keydown', () => { if(activeModal === 'edit') setInputMode(false); });

function updateGlyphs(gamepadId) {
    const id = gamepadId.toLowerCase();
    const isPS = id.includes('dualshock') || id.includes('dualsense') || id.includes('wireless controller') || id.includes('playstation');
    
    const targets = [
        { 
            a: '.footer .glyph-item:nth-child(1) .glyph', 
            x: '.footer .glyph-item:nth-child(2) .glyph', 
            b: '.footer .glyph-item:nth-child(3) .glyph',
            y: null 
        },
        { 
            a: '#oskLegend .glyph-item:nth-child(1) .glyph', 
            x: '#oskLegend .glyph-item:nth-child(2) .glyph', 
            y: '#oskLegend .glyph-item:nth-child(3) .glyph', 
            b: '#oskLegend .glyph-item:nth-child(5) .glyph' 
        }
    ];

    targets.forEach(set => {
        const aEl = document.querySelector(set.a);
        const xEl = document.querySelector(set.x);
        const bEl = document.querySelector(set.b);
        const yEl = set.y ? document.querySelector(set.y) : null;

        if (aEl) { aEl.className = 'glyph'; aEl.classList.add(isPS ? 'ps-cross' : 'a'); }
        if (xEl) { xEl.className = 'glyph'; xEl.classList.add(isPS ? 'ps-square' : 'x'); }
        if (bEl) { bEl.className = 'glyph'; bEl.classList.add(isPS ? 'ps-circle' : 'b'); }
        if (yEl) { yEl.className = 'glyph'; yEl.classList.add(isPS ? 'ps-triangle' : 'y'); }
    });
}

function applyControllerFocus() {
    if (!isControllerMode) return;
    const kbContainer = document.getElementById('keyboardContainer');
    document.querySelectorAll('[data-header-idx]').forEach(el => el.classList.remove('header-focused'));

    if (activeModal === 'edit') {
        kbContainer.classList.add('visible');
        const kElements = document.querySelectorAll('.key');
        kElements.forEach((k, i) => {
            k.classList.toggle('selected', i === kbFocusIndex);
            k.classList.toggle('uppercase', isShift || isCapsLock);
        });
        document.querySelectorAll('#editModal .menu-btn').forEach((b, i) => b.classList.toggle('selected', i === modalFocusIndex));
    } else {
        kbContainer.classList.remove('visible');
        if (activeModal) {
            document.querySelectorAll(`#${activeModal}Modal .menu-btn`).forEach((b, i) => b.classList.toggle('selected', i === modalFocusIndex));
        } else {
            if (currentZone === 'header') {
                document.querySelectorAll('.game-card').forEach(c => { c.classList.remove('focused'); c.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)'; });
                resetGlobalAccent();
                const targetHeaderItem = document.querySelector(`[data-header-idx="${headerFocusIndex}"]`);
                if (targetHeaderItem) { targetHeaderItem.classList.add('header-focused'); targetHeaderItem.focus(); }
            } else {
                document.getElementById('librarySearch').blur();
                const cards = document.querySelectorAll('.game-card');
                cards.forEach((c, i) => {
                    const isFocused = (i === focusIndex);
                    c.classList.toggle('focused', isFocused);
                    if (isFocused) {
                        c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        const actualId = sortedIds[i];
                        if (gameData[actualId] && gameData[actualId].cover) calculateGlow(c, gameData[actualId].cover);
                        else resetGlobalAccent();
                    } else c.style.boxShadow = '0 4px 15px rgba(0,0,0,0.5)';
                });
                if(sortedIds.length === 0) resetGlobalAccent();
            }
        }
    }
}

function triggerBackspace() {
    const input = document.getElementById('newNameInput');
    if (input && input.value.length > 0) {
        input.value = input.value.slice(0, -1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        playUISound('navigate'); // Click sound on every character deletion sequence
    }
}

function clearBackspaceTimers() {
    isBackspaceHeld = false;
    if (backspaceTimeout) { clearTimeout(backspaceTimeout); backspaceTimeout = null; }
    if (backspaceInterval) { clearInterval(backspaceInterval); backspaceInterval = null; }
}

function updateGamepad() {
    if (!document.hasFocus()) { requestAnimationFrame(updateGamepad); return; }
    const gamepads = navigator.getGamepads();
    const now = Date.now();
    let activeGp = null;

    for (const gp of gamepads) {
        if (!gp || !gp.connected) continue;
        if (gp.buttons.some(b => b.pressed) || gp.axes.some(a => Math.abs(a) > 0.5)) {
            activeGp = gp; setInputMode(true);
            if (lastActiveGamepadIndex !== gp.index) { lastActiveGamepadIndex = gp.index; updateGlyphs(gp.id); }
            break; 
        }
    }

    if (!activeGp && isControllerMode) activeGp = gamepads[lastActiveGamepadIndex] || Array.from(gamepads).find(p => p !== null);

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
                    if (left) { if (focusIndex > 0) { focusIndex--; moved = true; } }
                    if (down) { if (focusIndex + cols < sortedIds.length) { focusIndex += cols; moved = true; } }
                    if (up) { 
                        if (focusIndex < cols) { currentZone = 'header'; headerFocusIndex = 0; moved = true; } 
                        else { focusIndex -= cols; moved = true; } 
                    }
                    if(sortedIds.length > 0) focusIndex = Math.max(0, Math.min(focusIndex, sortedIds.length - 1));
                }
            }
            if (moved) { 
                applyControllerFocus(); 
                playUISound('navigate'); // Trigger UI move blip
                lastMoveTime = now; 
            }
        }

        // --- BUTTON HANDLING RULES ---
        if (activeGp.buttons[0].pressed && !lastButtonState[0]) handleA();
        if (activeGp.buttons[1].pressed && !lastButtonState[1]) handleB();
        
        // Advanced Repeat Backspace Mapping Loop (Button index 2: X / Square)
        if (activeGp.buttons[2].pressed) {
            if (activeModal === 'edit') {
                if (!isBackspaceHeld) {
                    isBackspaceHeld = true;
                    triggerBackspace(); // Immediate character drop on click down
                    
                    backspaceTimeout = setTimeout(() => {
                        backspaceInterval = setInterval(() => {
                            triggerBackspace();
                        }, 40); // Standard rapid repetition rate
                    }, 500); // Standard initial holding delay stall
                }
            } else if (!lastButtonState[2]) {
                handleX();
            }
        } else {
            if (isBackspaceHeld) clearBackspaceTimers();
        }
        
        if (activeGp.buttons[3].pressed && !lastButtonState[3]) {
            if (activeModal === 'edit') {
                const input = document.getElementById('newNameInput');
                input.value += " ";
                input.dispatchEvent(new Event('input', { bubbles: true }));
                playUISound('navigate'); // Treat spacebar input as a keyboard click noise
            }
        }

        // R2 / RT (Button Index 7) Virtual Keyboard Shortcut: Instantly saves the text changes
        if (activeGp.buttons[7].pressed && !lastButtonState[7]) {
            if (activeModal === 'edit') {
                executeAction('save-name');
            }
        }
        
        if (activeGp.buttons[8].pressed && !lastButtonState[8] && !activeModal) {
            currentZone = (currentZone === 'grid') ? 'header' : 'grid'; 
            applyControllerFocus();
            playUISound('navigate');
        }
        if (activeGp.buttons[10].pressed && !lastButtonState[10] && activeModal === 'edit') {
            if (now - lastL3Click < 300) { isCapsLock = !isCapsLock; isShift = false; } 
            else { isShift = !isShift; if (isShift) isCapsLock = false; }
            lastL3Click = now;
            
            const labelText = isCapsLock ? "Caps Lock" : "Shift";
            document.getElementById('oskShiftLabel').innerText = labelText;
            applyControllerFocus();
            playUISound('navigate');
        }

        for (let i = 0; i < activeGp.buttons.length; i++) {
            if (i === 2 && activeModal === 'edit') continue; 
            if (i === 7 && activeModal === 'edit') continue; // Bypass execution stepping during dynamic text saves
            lastButtonState[i] = activeGp.buttons[i].pressed;
        }
        if (activeModal !== 'edit') {
            if (lastButtonState[2] !== activeGp.buttons[2].pressed) lastButtonState[2] = activeGp.buttons[2].pressed;
            if (lastButtonState[7] !== activeGp.buttons[7].pressed) lastButtonState[7] = activeGp.buttons[7].pressed;
        }
    }
    requestAnimationFrame(updateGamepad);
}

function handleA() {
    if (activeModal === 'edit') {
        const k = keys[kbFocusIndex];
        const input = document.getElementById('newNameInput');
        input.value += (isShift || isCapsLock) ? k.toUpperCase() : k.toLowerCase();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        playUISound('navigate'); // Small typing click sound
        if (isShift) { isShift = false; applyControllerFocus(); } 
    } else if (activeModal) {
        const btns = document.querySelectorAll(`#${activeModal}Modal .menu-btn`);
        if(btns[modalFocusIndex]) executeAction(btns[modalFocusIndex].dataset.action);
    } else {
        if (currentZone === 'header') {
            playUISound('select');
            if (headerFocusIndex === 0) {
                currentEditingId = 'search-filter'; closeModal();
                setTimeout(() => { document.getElementById('newNameInput').value = librarySearch.value; openModal('edit'); }, 50);
            } else if (headerFocusIndex === 1) {
                const currIdx = sortSelect.selectedIndex;
                sortSelect.selectedIndex = (currIdx + 1) % sortSelect.options.length;
                sortSelect.dispatchEvent(new Event('change'));
            } else if (headerFocusIndex === 2) document.getElementById('addBtn').click();
        } else {
            const actualId = sortedIds[focusIndex];
            if (actualId) launchItem(actualId);
        }
    }
}

async function executeAction(action) {
    // Treat confirming modal actions as a structural validation sound
    playUISound('select');
    if (action === 'toggle-fav') {
        gameData[currentEditingId].favorite = !gameData[currentEditingId].favorite; saveToDisk(); renderLibrary(); closeModal();
    } else if (action === 'rename') {
        const old = gameData[currentEditingId].name; closeModal();
        setTimeout(() => { document.getElementById('newNameInput').value = old; openModal('edit'); }, 50);
    } else if (action === 'cover') { 
        closeModal(); ipcRenderer.send('open-picker', { id: currentEditingId, name: gameData[currentEditingId].name });
    } else if (action === 'open-folder') {
        ipcRenderer.send('open-file-location', gameData[currentEditingId].path); closeModal();
    } else if (action === 'change-path') {
        const p = await ipcRenderer.invoke('select-game');
        if (p) { gameData[currentEditingId].path = p; saveToDisk(); }
        closeModal();
    } else if (action === 'remove') { 
        delete gameData[currentEditingId]; saveToDisk(); renderLibrary(); closeModal();
    } else if (action === 'save-name') { 
        const val = document.getElementById('newNameInput').value;
        if (currentEditingId === 'search-filter') { librarySearch.value = val; renderLibrary(); } 
        else { gameData[currentEditingId].name = val; saveToDisk(); renderLibrary(); }
        closeModal();
    } else if (action === 'quit-confirm') ipcRenderer.send('quit-app-now');
    else closeModal();
}

function handleB() { 
    if (activeModal) {
        playUISound('back');
        closeModal(); 
    } else { 
        if(currentZone === 'header') { 
            currentZone = 'grid'; 
            applyControllerFocus(); 
            playUISound('back');
        } else {
            playUISound('select'); // Treat entering the final application quit menu prompt as an opening action
            openModal('quit');
        }
    } 
}

function handleX() {
    if (currentZone === 'header') return;
    const actualId = sortedIds[focusIndex];
    if (actualId && !activeModal) {
        playUISound('select'); // Pop sound when bringing up context options overlay
        showOptionsModal(actualId);
    }
}

function openModal(t) { 
    activeModal = t; modalFocusIndex = 0; 
    document.getElementById(t + 'Modal').style.display = 'flex'; 
    if (t === 'edit') { 
        document.getElementById('newNameInput').removeAttribute('readonly'); 
        document.getElementById('newNameInput').focus(); 
    }
    applyControllerFocus(); 
}

function closeModal() { 
    clearBackspaceTimers();
    if (activeModal) document.getElementById(activeModal + 'Modal').style.display = 'none';
    if (activeModal === 'edit') document.getElementById('newNameInput').setAttribute('readonly', true);
    document.getElementById('keyboardContainer').classList.remove('visible');
    activeModal = null; isShift = false; isCapsLock = false;
    applyControllerFocus(); 
}

document.querySelectorAll('.menu-btn').forEach(btn => {
    btn.onclick = () => executeAction(btn.dataset.action);
});

function initKeyboard() {
    const kbContainer = document.getElementById('virtualKeyboard');
    if (!kbContainer) return;
    kbContainer.innerHTML = '';
    
    keys.forEach((key) => {
        const keyEl = document.createElement('div');
        keyEl.className = 'key';
        keyEl.innerText = key;
        
        keyEl.onclick = () => {
            const input = document.getElementById('newNameInput');
            input.value += (isShift || isCapsLock) ? key.toUpperCase() : key.toLowerCase();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            playUISound('navigate'); // Typing sound for mouse clicks on OSK too
            if (isShift) { isShift = false; applyControllerFocus(); }
        };
        
        kbContainer.appendChild(keyEl);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initKeyboard();
    renderLibrary();
    requestAnimationFrame(updateGamepad);
});