const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Check if running in development mode
const isDev = !app.isPackaged;

// Config file path for storing user preferences
const configPath = path.join(app.getPath('userData'), 'config.json');

// Preview thumbnails folder name
const PREVIEW_FOLDER = 'preview-thumbnails';

let mainWindow = null;

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
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        backgroundColor: '#0f0f0f',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        }
    });

    mainWindow.loadFile('renderer/index.html');
    
    // mainWindow.webContents.openDevTools();

    // Window Control Handlers
    ipcMain.handle('window-minimize', () => mainWindow.minimize());
    ipcMain.handle('window-maximize', () => {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
    });
    ipcMain.handle('window-close', () => mainWindow.close());
    ipcMain.handle('window-refresh', () => mainWindow.reload());
    ipcMain.handle('window-is-maximized', () => mainWindow.isMaximized());

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window-maximized', true);
    });
    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window-maximized', false);
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

ipcMain.handle('scan-directory', async () => {
    try {
        let movies;
        if (isDev) {
            const scanPath = path.join(process.cwd(), '..');
            movies = scanMoviesDev(scanPath);
        } else {
            const config = loadConfig();
            if (config.libraryPath && fs.existsSync(config.libraryPath)) {
                movies = scanMoviesProduction(config.libraryPath, 0, 3);
            } else {
                return { movies: [], needsGeneration: false };
            }
        }
        
        // Check which videos need preview generation
        const needsGeneration = checkPreviewsNeeded(movies);
        
        return { movies, needsGeneration };
    } catch (error) {
        console.error("Scan error:", error);
        return { movies: [], needsGeneration: false };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        
        if (!isDev) {
            const config = loadConfig();
            config.libraryPath = selectedPath;
            saveConfig(config);
        }
        
        let movies;
        if (isDev) {
            movies = scanMoviesDev(selectedPath);
        } else {
            movies = scanMoviesProduction(selectedPath, 0, 3);
        }
        
        const needsGeneration = checkPreviewsNeeded(movies);
        return { movies, needsGeneration };
    }
    return null;
});

// =====================================================
// PREVIEW THUMBNAIL GENERATION
// =====================================================

function getPreviewPath(videoPath) {
    const dir = path.dirname(videoPath);
    const previewDir = path.join(dir, PREVIEW_FOLDER);
    const baseName = path.basename(videoPath, path.extname(videoPath));
    return path.join(previewDir, `${baseName}_preview.mp4`);
}

function checkPreviewsNeeded(movies) {
    const needed = [];
    for (const movie of movies) {
        const previewPath = getPreviewPath(movie.videoPath);
        if (!fs.existsSync(previewPath)) {
            needed.push(movie);
        } else {
            movie.previewPath = previewPath;
        }
    }
    return needed;
}

ipcMain.handle('generate-previews', async (event, movies) => {
    const total = movies.length;
    let completed = 0;
    
    for (const movie of movies) {
        try {
            await generatePreview(movie.videoPath);
            movie.previewPath = getPreviewPath(movie.videoPath);
            completed++;
            
            // Send progress update
            mainWindow.webContents.send('preview-progress', {
                current: completed,
                total: total,
                name: movie.name
            });
        } catch (err) {
            console.error(`Failed to generate preview for ${movie.name}:`, err);
            completed++;
            mainWindow.webContents.send('preview-progress', {
                current: completed,
                total: total,
                name: movie.name,
                error: true
            });
        }
    }
    
    return movies;
});

function generatePreview(videoPath) {
    return new Promise((resolve, reject) => {
        const previewPath = getPreviewPath(videoPath);
        const previewDir = path.dirname(previewPath);
        
        // Create preview folder if not exists
        if (!fs.existsSync(previewDir)) {
            fs.mkdirSync(previewDir, { recursive: true });
        }
        
        // First, get video duration
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                reject(err);
                return;
            }
            
            const duration = metadata.format.duration;
            const positions = [0.1, 0.3, 0.5, 0.7, 0.9]; // 10%, 30%, 50%, 70%, 90%
            const clipDuration = 3; // 3 seconds each
            
            // Generate filter complex for extracting and concatenating clips
            const tempFiles = [];
            let clipPromises = positions.map((pos, i) => {
                return new Promise((res, rej) => {
                    const startTime = duration * pos;
                    const tempFile = path.join(previewDir, `temp_${i}.mp4`);
                    tempFiles.push(tempFile);
                    
                    ffmpeg(videoPath)
                        .setStartTime(startTime)
                        .setDuration(clipDuration)
                        .outputOptions([
                            '-vf', 'scale=320:-2',
                            '-c:v', 'libx264',
                            '-preset', 'ultrafast',
                            '-crf', '28',
                            '-an' // No audio
                        ])
                        .output(tempFile)
                        .on('end', () => res(tempFile))
                        .on('error', rej)
                        .run();
                });
            });
            
            Promise.all(clipPromises)
                .then(() => {
                    // Concatenate all clips
                    const listFile = path.join(previewDir, 'list.txt');
                    const listContent = tempFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
                    fs.writeFileSync(listFile, listContent);
                    
                    ffmpeg()
                        .input(listFile)
                        .inputOptions(['-f', 'concat', '-safe', '0'])
                        .outputOptions(['-c', 'copy'])
                        .output(previewPath)
                        .on('end', () => {
                            // Cleanup temp files
                            tempFiles.forEach(f => {
                                try { fs.unlinkSync(f); } catch (e) {}
                            });
                            try { fs.unlinkSync(listFile); } catch (e) {}
                            resolve(previewPath);
                        })
                        .on('error', (err) => {
                            tempFiles.forEach(f => {
                                try { fs.unlinkSync(f); } catch (e) {}
                            });
                            try { fs.unlinkSync(listFile); } catch (e) {}
                            reject(err);
                        })
                        .run();
                })
                .catch(reject);
        });
    });
}

// =====================================================
// DEV MODE SCANNING - Depth 1
// =====================================================
function scanMoviesDev(dirPath) {
    const movies = [];
    if (!fs.existsSync(dirPath)) return [];

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
        if (item.isDirectory() && item.name !== 'electron-player' && item.name !== 'node_modules' && item.name !== PREVIEW_FOLDER) {
            const folderPath = path.join(dirPath, item.name);
            
            const files = fs.readdirSync(folderPath);
            const videoFile = files.find(f => isVideoFile(f));
            const coverFile = files.find(f => isImageFile(f));

            if (videoFile) {
                const videoPath = path.join(folderPath, videoFile);
                const previewPath = getPreviewPath(videoPath);
                
                movies.push({
                    name: item.name,
                    videoPath: videoPath,
                    coverPath: coverFile ? path.join(folderPath, coverFile) : null,
                    previewPath: fs.existsSync(previewPath) ? previewPath : null,
                    size: fs.statSync(videoPath).size
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
            
            if (item.isDirectory() && item.name !== 'node_modules' && !item.name.startsWith('.') && item.name !== PREVIEW_FOLDER) {
                const files = fs.readdirSync(itemPath);
                const videoFile = files.find(f => isVideoFile(f));
                const coverFile = files.find(f => isImageFile(f));

                if (videoFile) {
                    const videoPath = path.join(itemPath, videoFile);
                    const previewPath = getPreviewPath(videoPath);
                    
                    movies.push({
                        name: item.name,
                        videoPath: videoPath,
                        coverPath: coverFile ? path.join(itemPath, coverFile) : null,
                        previewPath: fs.existsSync(previewPath) ? previewPath : null,
                        size: fs.statSync(videoPath).size
                    });
                }
                
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
