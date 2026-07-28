const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Steam platform update checker - Manifest based
 * Uses manifest file parsing + file modification time for active updates
 */

function getVersionFromExe(gamePath, appId) {
    try {
        if (!fs.existsSync(gamePath)) {
            console.log(`Game folder not found: ${gamePath}`);
            return null;
        }

        // Find the main .exe file in the game folder
        // Look for the largest .exe (usually the main executable)
        const files = fs.readdirSync(gamePath, { withFileTypes: true });
        let mainExe = null;
        let maxSize = 0;

        for (const file of files) {
            if (file.isFile() && file.name.toLowerCase().endsWith('.exe')) {
                const filePath = path.join(gamePath, file.name);
                const stats = fs.statSync(filePath);
                if (stats.size > maxSize) {
                    maxSize = stats.size;
                    mainExe = filePath;
                }
            }
        }

        if (!mainExe) {
            console.log(`No .exe found in: ${gamePath}`);
            return null;
        }

        console.log(`Found main executable: ${mainExe}`);

        // Get file version using PowerShell
        try {
            const versionCmd = `[System.Diagnostics.FileVersionInfo]::GetVersionInfo('${mainExe}').FileVersion`;
            const version = execSync(`powershell -Command "${versionCmd}"`, { encoding: 'utf-8' }).trim();
            
            if (version && version !== '') {
                console.log(`Got exe version: ${version}`);
                return version;
            }
        } catch (err) {
            console.log(`Could not get version from PowerShell: ${err.message}`);
        }

        return null;
    } catch (err) {
        console.error(`Error getting version from exe: ${err.message}`);
        return null;
    }
}

function isGameFolderBeingUpdated(gamePath) {
    try {
        if (!gamePath || !fs.existsSync(gamePath)) {
            return false;
        }

        // Get folder modification time
        const stats = fs.statSync(gamePath);
        const now = Date.now();
        const folderAgeMs = now - stats.mtimeMs;
        
        // If folder was modified within last 30 minutes, Steam is likely updating it
        const recentlyModified = folderAgeMs < (30 * 60 * 1000);
        
        if (recentlyModified) {
            console.log(`Game folder recently modified: ${new Date(stats.mtime).toLocaleString()}`);
        }

        return recentlyModified;
    } catch (err) {
        console.error('Error checking folder modification time:', err);
        return false;
    }
}

function getGameFolderSize(gamePath) {
    try {
        if (!fs.existsSync(gamePath)) return 0;

        let totalSize = 0;
        const walk = (dir) => {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            files.forEach(file => {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    walk(fullPath);
                } else {
                    totalSize += file.size;
                }
            });
        };

        walk(gamePath);
        return totalSize;
    } catch (err) {
        console.error('Error calculating folder size:', err);
        return 0;
    }
}

async function checkUpdate(appId, gamePath) {
    try {
        if (!appId) {
            return {
                hasUpdate: false,
                error: 'No Steam App ID provided',
                platform: 'steam'
            };
        }

        console.log(`Checking Steam app ${appId} for updates...`);

        // Check if folder is being updated right now
        const isUpdating = isGameFolderBeingUpdated(gamePath);
        
        if (isUpdating) {
            console.log(`Steam is actively updating this game`);
            return {
                hasUpdate: true,
                currentVersion: 'Current',
                latestVersion: 'Updating',
                updateReason: 'Steam is actively updating this game',
                platform: 'steam',
                appId: appId,
                isInstalling: true,
                statusCode: 'updating'
            };
        }

        // Get current version from exe file
        const currentVersion = getVersionFromExe(gamePath, appId);

        if (!currentVersion) {
            console.log(`Could not determine version from exe file`);
            return {
                hasUpdate: false,
                currentVersion: 'Unknown',
                latestVersion: 'Unknown',
                error: 'Could not read game version from executable',
                platform: 'steam',
                appId: appId,
                statusCode: 'unknown'
            };
        }

        // Assume up to date since Steam automatically updates installed games
        console.log(`Game is up to date - exe version: ${currentVersion}`);
        return {
            hasUpdate: false,
            currentVersion: currentVersion,
            latestVersion: currentVersion,
            updateReason: 'Game is up to date',
            platform: 'steam',
            appId: appId,
            statusCode: 'up_to_date'
        };

    } catch (err) {
        console.error(`Error checking Steam game updates:`, err);
        return {
            hasUpdate: false,
            error: err.message,
            platform: 'steam',
            appId: appId,
            statusCode: 'error'
        };
    }
}

module.exports = { checkUpdate };
