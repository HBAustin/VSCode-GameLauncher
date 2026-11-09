const { BrowserWindow, globalShortcut, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseCsvLine, frameInterval } = require('./presentmon-csv');

class FpsOverlay {
    constructor() {
        this.window = null;
        this.collector = null;
        this.samples = [];
        this.lastFrameAt = 0;
        this.captureStartedAt = 0;
        this.lastUpdateAt = 0;
        this.stopped = true;
        this.buffer = '';
        this.intervalIndex = -1;
        this.timeout = null;
        this.windowReady = false;
        this.pendingUpdate = null;

        globalShortcut.register('CommandOrControl+Shift+O', () => {
            if (!this.window || this.window.isDestroyed() || this.stopped) return;
            if (this.window.isVisible()) this.window.hide();
            else this.window.showInactive();
        });
    }

    ensureWindow() {
        if (this.window && !this.window.isDestroyed()) return;
        const { x, y } = screen.getPrimaryDisplay().workArea;
        this.window = new BrowserWindow({
            x: x + 24,
            y: y + 24,
            width: 190,
            height: 58,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            movable: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            focusable: false,
            hasShadow: false,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false
            }
        });
        this.window.setAlwaysOnTop(true, 'screen-saver');
        this.window.setIgnoreMouseEvents(true, { forward: true });
        this.window.webContents.on('did-finish-load', () => {
            this.windowReady = true;
            if (this.pendingUpdate) this.send(this.pendingUpdate);
        });
        this.window.loadFile(path.join(__dirname, 'overlay.html'));
        this.window.on('closed', () => {
            this.window = null;
            this.windowReady = false;
        });
    }

    send(update) {
        if (this.window && !this.window.isDestroyed() && !this.window.webContents.isDestroyed()) {
            this.pendingUpdate = update;
            if (!this.windowReady) return;
            this.window.webContents.send('fps-overlay-update', update);
            this.pendingUpdate = null;
        }
    }

    start({ executable, processName }) {
        this.stop(false);
        if (process.platform !== 'win32') return;
        this.ensureWindow();
        if (!executable || !fs.existsSync(executable)) {
            this.showError('CONFIGURE PRESENTMON');
            return;
        }
        processName = String(processName || '').trim();
        if (!/^[^\\/:*?"<>|]+\.exe$/i.test(processName)) {
            this.showError('SET PROCESS NAME');
            return;
        }

        this.stopped = false;
        this.samples = [];
        this.lastFrameAt = 0;
        this.captureStartedAt = Date.now();
        this.lastUpdateAt = 0;
        this.buffer = '';
        this.intervalIndex = -1;
        this.send({ status: 'WAITING FOR GAME' });
        this.window.showInactive();
        this.collector = spawn(executable, [
            '--process_name', processName,
            '--output_stdout',
            '--no_console_stats',
            '--no_track_gpu',
            '--no_track_input'
        ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

        this.collector.stdout.setEncoding('utf8');
        this.collector.stdout.on('data', (chunk) => this.onData(chunk));
        this.collector.stderr.setEncoding('utf8');
        this.collector.stderr.on('data', (chunk) => {
            const message = String(chunk).trim();
            if (message) console.warn('PresentMon:', message);
        });
        this.collector.once('error', (error) => {
            console.error('Could not start PresentMon:', error);
            this.showError('PRESENTMON ERROR');
        });
        this.collector.once('close', (code) => {
            if (this.stopped) return;
            if (code !== 0) this.showError('CAPTURE STOPPED');
            else this.stop();
        });
        this.scheduleIdleCheck();
    }

    onData(chunk) {
        this.buffer += chunk;
        const lines = this.buffer.split(/\r?\n/);
        this.buffer = lines.pop() || '';
        for (const line of lines) this.readCsvLine(line);
    }

    readCsvLine(line) {
        if (!line) return;
        if (!this.header) {
            const header = parseCsvLine(line).map((name) => name.trim());
            if (!header.includes('MsBetweenPresents')) return;
            this.header = header;
            this.intervalIndex = this.header.indexOf('MsBetweenPresents');
            return;
        }
        if (this.intervalIndex < 0) return;
        const interval = frameInterval(this.header, line);
        if (interval === null) return;

        const now = Date.now();
        this.lastFrameAt = now;
        this.samples.push({ at: now, interval });
        this.samples = this.samples.filter((sample) => now - sample.at <= 1000);
        const totalMs = this.samples.reduce((sum, sample) => sum + sample.interval, 0);
        const currentFps = totalMs > 0 ? this.samples.length * 1000 / totalMs : 0;
        if (now - this.lastUpdateAt >= 250) {
            this.lastUpdateAt = now;
            this.send({ fps: currentFps });
        }
    }

    scheduleIdleCheck() {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            if (this.stopped) return;
            const now = Date.now();
            if ((this.lastFrameAt && now - this.lastFrameAt > 12000)
                || (!this.lastFrameAt && now - this.captureStartedAt > 60000)) {
                this.send({ status: this.lastFrameAt ? 'NO ACTIVE FRAMES' : 'NO FRAMES RECEIVED' });
                this.stop();
                return;
            }
            this.scheduleIdleCheck();
        }, 3000);
    }

    stop(closeWindow = true) {
        this.stopped = true;
        clearTimeout(this.timeout);
        this.timeout = null;
        this.header = null;
        this.samples = [];
        if (this.collector && !this.collector.killed) this.collector.kill();
        this.collector = null;
        if (this.window && !this.window.isDestroyed()) {
            if (closeWindow) this.window.close();
            else this.window.hide();
        }
    }

    showError(message) {
        this.stopped = true;
        clearTimeout(this.timeout);
        this.timeout = null;
        if (this.collector && !this.collector.killed) this.collector.kill();
        this.collector = null;
        this.send({ error: message });
        if (this.window && !this.window.isDestroyed()) {
            this.window.showInactive();
            this.timeout = setTimeout(() => {
                if (this.window && !this.window.isDestroyed()) this.window.close();
            }, 6000);
        }
    }

    dispose() {
        this.stop();
        globalShortcut.unregister('CommandOrControl+Shift+O');
        if (this.window && !this.window.isDestroyed()) this.window.close();
    }
}

module.exports = FpsOverlay;
