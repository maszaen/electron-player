const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Check if running in development mode
const isDev = !app.isPackaged;

// Config file path for storing user preferences
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
    return {};
}

function saveConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false, // Frameless for custom pro look
        backgroundColor: '#0f0f0f',
        icon: path.join(__dirname, 'assets', 'icon.png'), // App icon
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // Often needed for loading local media files
        }
    });

    win.loadFile('renderer/index.html');
    
    // win.webContents.openDevTools(); // Debug use only

    // Window Control Handlers
    ipcMain.handle('window-minimize', () => win.minimize());
    ipcMain.handle('window-maximize', () => {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
    });
    ipcMain.handle('window-close', () => win.close());
    ipcMain.handle('window-refresh', () => win.reload());
    ipcMain.handle('window-is-maximized', () => win.isMaximized());

    // Send maximize state changes to renderer
    win.on('maximize', () => {
        win.webContents.send('window-maximized', true);
    });
    win.on('unmaximize', () => {
        win.webContents.send('window-maximized', false);
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// =====================================================
// FILE SCANNING LOGIC
// =====================================================

// Default scan on startup
ipcMain.handle('scan-directory', async () => {
    try {
        if (isDev) {
            // DEV MODE: Scan parent folder of CWD, depth 1
            const scanPath = path.join(process.cwd(), '..');
            return scanMoviesDev(scanPath);
        } else {
            // PRODUCTION MODE: Load saved folder from config
            const config = loadConfig();
            if (config.libraryPath && fs.existsSync(config.libraryPath)) {
                return scanMoviesProduction(config.libraryPath, 0, 3);
            }
            // No saved path - return empty, user needs to select folder
            return [];
        }
    } catch (error) {
        console.error("Scan error:", error);
        return [];
    }
});

// User selects folder
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        
        // Save to config for production mode
        if (!isDev) {
            const config = loadConfig();
            config.libraryPath = selectedPath;
            saveConfig(config);
        }
        
        if (isDev) {
            return scanMoviesDev(selectedPath);
        } else {
            return scanMoviesProduction(selectedPath, 0, 3);
        }
    }
    return null;
});

// =====================================================
// DEV MODE SCANNING - Depth 1 (current behavior)
// =====================================================
function scanMoviesDev(dirPath) {
    const movies = [];
    if (!fs.existsSync(dirPath)) return [];

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
        if (item.isDirectory() && item.name !== 'electron-player' && item.name !== 'node_modules') {
            const folderPath = path.join(dirPath, item.name);
            
            // Look for video files in this folder
            const files = fs.readdirSync(folderPath);
            const videoFile = files.find(f => isVideoFile(f));
            const coverFile = files.find(f => isImageFile(f));

            if (videoFile) {
                movies.push({
                    name: item.name,
                    videoPath: path.join(folderPath, videoFile),
                    coverPath: coverFile ? path.join(folderPath, coverFile) : null,
                    size: fs.statSync(path.join(folderPath, videoFile)).size
                });
            }
        }
    }
    return movies;
}

// =====================================================
// PRODUCTION MODE SCANNING - Recursive, Max Depth 3
// =====================================================
function scanMoviesProduction(dirPath, currentDepth, maxDepth) {
    const movies = [];
    if (!fs.existsSync(dirPath) || currentDepth > maxDepth) return [];

    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const item of items) {
            const itemPath = path.join(dirPath, item.name);
            
            if (item.isDirectory() && item.name !== 'node_modules' && !item.name.startsWith('.')) {
                // Check for video in this folder
                const files = fs.readdirSync(itemPath);
                const videoFile = files.find(f => isVideoFile(f));
                const coverFile = files.find(f => isImageFile(f));

                if (videoFile) {
                    movies.push({
                        name: item.name,
                        videoPath: path.join(itemPath, videoFile),
                        coverPath: coverFile ? path.join(itemPath, coverFile) : null,
                        size: fs.statSync(path.join(itemPath, videoFile)).size
                    });
                }
                
                // Recurse into subdirectories
                if (currentDepth < maxDepth) {
                    const subMovies = scanMoviesProduction(itemPath, currentDepth + 1, maxDepth);
                    movies.push(...subMovies);
                }
            }
        }
    } catch (e) {
        console.error('Scan error at', dirPath, e);
    }
    
    return movies;
}

// =====================================================
// HELPERS
// =====================================================
function isVideoFile(filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mkv') || ext.endsWith('.avi') || ext.endsWith('.mov');
}

function isImageFile(filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp');
}
