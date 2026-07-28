const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Xbox App / Game Pass update checker
 * Queries Windows Registry and local app data to detect updates
 */

async function getXboxAppVersion(packageId) {
    try {
        // Try to get version from Windows Registry
        // Xbox/Game Pass apps are registered in: HKEY_CURRENT_USER\Software\Microsoft\GamesUWP
        
        const { stdout } = await execAsync(
            `reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\GamesUWP" /s`,
            { shell: 'cmd.exe', timeout: 5000 }
        );

        // Look for the package in registry output
        if (stdout.includes(packageId)) {
            return {
                found: true,
                packageId: packageId
            };
        }

        return { found: false };
    } catch (err) {
        console.error('Xbox registry query error:', err.message);
        return { found: false, error: err.message };
    }
}

async function getXboxGameState(gamePath) {
    try {
        // Check if game folder exists
        if (!fs.existsSync(gamePath)) {
            return {
                installed: false,
                error: 'Game path not found'
            };
        }

        // Look for Xbox package metadata
        // Xbox Game Pass games typically have a.metadata or appxmanifest.xml
        const files = fs.readdirSync(gamePath);
        const hasMetadata = files.some(f => 
            f.toLowerCase().includes('metadata') || 
            f.toLowerCase().includes('appxmanifest') ||
            f.toLowerCase().includes('package.xml')
        );

        // Check if files are being updated (mod times recent)
        const stats = fs.statSync(gamePath);
        const now = Date.now();
        const fileAge = now - stats.mtimeMs;
        const isRecentlyModified = fileAge < 3600000; // Modified within last hour

        return {
            installed: true,
            hasMetadata,
            recentlyModified: isRecentlyModified,
            lastModified: new Date(stats.mtime)
        };
    } catch (err) {
        console.error('Xbox game state check error:', err);
        return {
            installed: false,
            error: err.message
        };
    }
}

async function checkUpdate(packageId, gamePath) {
    try {
        if (!packageId || !gamePath) {
            return {
                hasUpdate: false,
                error: 'Xbox Package ID or game path not provided',
                platform: 'xbox'
            };
        }

        // Get game state
        const gameState = await getXboxGameState(gamePath);

        if (!gameState.installed) {
            return {
                hasUpdate: false,
                error: gameState.error || 'Xbox game not installed',
                platform: 'xbox'
            };
        }

        // Check if recently modified (indicates active update)
        if (gameState.recentlyModified) {
            return {
                hasUpdate: true,
                currentVersion: 'Current',
                latestVersion: 'Updating',
                updateReason: 'Xbox app is actively updating game',
                platform: 'xbox',
                packageId: packageId,
                lastModified: gameState.lastModified
            };
        }

        return {
            hasUpdate: false,
            currentVersion: 'Current',
            latestVersion: 'Current',
            platform: 'xbox',
            packageId: packageId,
            lastModified: gameState.lastModified
        };

    } catch (err) {
        console.error('Xbox update check error:', err);
        return {
            hasUpdate: false,
            error: err.message,
            platform: 'xbox'
        };
    }
}

module.exports = { checkUpdate };
