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
        width: 1280,
        height: 756, // 720 (16:9 video) + 36 (titlebar)
        minHeight: 283,
        minWidth: 440,
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
// PREVIEW THUMBNAIL GENERATION
// =====================================================

// =====================================================
// ASSET PATHS
// =====================================================

// =====================================================
// SMART SCANNING & ASSET GENERATION
// =====================================================

// Helper to sanitize folder names
function sanitizeName(name) {
    return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function getThumbnailDir(rootPath, videoPath, mode) {
    const relativeDir = path.relative(rootPath, path.dirname(videoPath));
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const baseDir = path.join(rootPath, PREVIEW_FOLDER);
    
    // Create consistent, conflict-free path
    if (mode === 'folder-based') {
        // Folder mode: Thumbnails in PREVIEW/RelativePath/
        return path.join(baseDir, relativeDir);
    } else {
        // File mode: Thumbnails in PREVIEW/RelativePath/_file_VideoName/
        // Use a special prefix folder for loose files based on their name to avoid conflicts
        return path.join(baseDir, relativeDir, `_m_${sanitizeName(videoName)}`);
    }
}

// Check scanning mode for a folder
function detectFolderMode(folderPath) {
    try {
        const items = fs.readdirSync(folderPath, { withFileTypes: true });
        const videos = items.filter(i => i.isFile() && isVideoFile(i.name));
        
        // Strict Folder Mode: Only 1 video file in the folder
        if (videos.length === 1) {
            return { mode: 'folder-based', videos }; 
        }
        
        // File Mode: Multiple videos or mixed content
        return { mode: 'file-based', videos };
    } catch {
        return { mode: 'file-based', videos: [] };
    }
}

// Find existing cover in the same directory (Prioritize exact match -> random image)
function findExistingCover(videoPath) {
    const dir = path.dirname(videoPath);
    const videoName = path.basename(videoPath, path.extname(videoPath));
    
    try {
        const files = fs.readdirSync(dir);
        const images = files.filter(f => isImageFile(f));
        
        if (images.length === 0) return null;
        
        // 1. Exact name match (video.mp4 -> video.jpg)
        const exactMatch = images.find(img => 
            path.basename(img, path.extname(img)).toLowerCase() === videoName.toLowerCase()
        );
        if (exactMatch) return path.join(dir, exactMatch);
        
        // 2. Common names (cover.jpg, poster.png, etc)
        const commonNames = ['cover', 'poster', 'folder', 'thumb'];
        const commonMatch = images.find(img => 
            commonNames.some(name => img.toLowerCase().includes(name))
        );
        if (commonMatch) return path.join(dir, commonMatch);

        // 3. Fallback: First image found (Only relevant for Folder-Based mode)
        // But we handle this in the scanner to be safer
        return path.join(dir, images[0]);
    } catch {
        return null;
    }
}

// Find LEGACY preview (located inside subfolder next to video)
function findLegacyPreview(videoPath) {
    const dir = path.dirname(videoPath);
    const prevDir = path.join(dir, PREVIEW_FOLDER);
    const baseName = path.basename(videoPath, path.extname(videoPath));
    const legacyPath = path.join(prevDir, `${baseName}_preview.mp4`);
    
    if (fs.existsSync(legacyPath)) return legacyPath;
    return null;
}

// Core Recursive Scanner
function scanRecursive(currentPath, rootPath, depth, maxDepth, movies) {
    if (depth > maxDepth) return;
    if (!fs.existsSync(currentPath)) return;

    // Skip system folders
    const dirName = path.basename(currentPath);
    if (dirName === PREVIEW_FOLDER || dirName === 'node_modules' || dirName.startsWith('.')) return;

    const { mode, videos } = detectFolderMode(currentPath);
    
    // Process Videos in Current Folder
    for (const video of videos) {
        const videoPath = path.join(currentPath, video.name);
        const videoName = path.basename(videoPath, path.extname(videoPath));
        
        // Determination of Scan Mode for THIS video
        const currentMode = (mode === 'folder-based') ? 'folder-based' : 'file-based';
        
        // Display Name: Folder Name (if folder-based) OR File Name
        const displayName = (currentMode === 'folder-based') ? dirName : videoName;
        
        // Thumbnail Directory (New Centralized Structure)
        const thumbnailDir = getThumbnailDir(rootPath, videoPath, currentMode);
        
        // Cover Logic:
        // 1. Check existing image file near video
        let coverPath = findExistingCover(videoPath);
        
        // 2. If no existing cover, define path for text/generated cover
        const generatedCoverPath = path.join(thumbnailDir, 'cover.jpg');
        
        // Preview Logic:
        // 1. Check Legacy Path (In subfolder)
        let previewPath = findLegacyPreview(videoPath);
        
        // 2. Define path for New Generated preview (Centralized)
        const generatedPreviewPath = path.join(thumbnailDir, 'preview.mp4');
        
        // If legacy found, use it. If not, check if new generated one exists.
        if (!previewPath && fs.existsSync(generatedPreviewPath)) {
            previewPath = generatedPreviewPath;
        }

        movies.push({
            name: displayName,
            videoPath: videoPath,
            size: fs.statSync(videoPath).size,
            mode: currentMode,
            
            // Paths for Assets
            coverPath: coverPath, 
            generatedCoverPath: generatedCoverPath,
            previewPath: previewPath,
            generatedPreviewPath: generatedPreviewPath
        });
    }

    // Recurse into subfolders
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
            scanRecursive(path.join(currentPath, item.name), rootPath, depth + 1, maxDepth, movies);
        }
    }
}

// Entry Point for Scanning
ipcMain.handle('scan-directory', async () => {
    try {
        let rootPath;
        if (isDev) {
            rootPath = path.join(process.cwd(), '..');
        } else {
            const config = loadConfig();
            if (!config.libraryPath || !fs.existsSync(config.libraryPath)) {
                return { movies: [], needsAssetGeneration: { covers: [], previews: [] } };
            }
            rootPath = config.libraryPath;
        }

        const movies = [];
        scanRecursive(rootPath, rootPath, 0, 3, movies);
        
        // Sort alphabetically by name
        movies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Check what needs generation
        const needsGeneration = checkAssetsNeeded(movies);
        
        return { movies, needsGeneration };
    } catch (error) {
        console.error("Scan error:", error);
        return { movies: [], needsGeneration: { covers: [], previews: [] } };
    }
});

// Reuse logic for Select Folder
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!result.canceled && result.filePaths.length > 0) {
        const rootPath = result.filePaths[0];
        
        if (!isDev) {
            const config = loadConfig();
            config.libraryPath = rootPath;
            saveConfig(config);
        }
        
        const movies = [];
        scanRecursive(rootPath, rootPath, 0, 3, movies);
        movies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        
        const needsGeneration = checkAssetsNeeded(movies);
        return { movies, needsGeneration };
    }
    return null;
});

// =====================================================
// ASSET GENERATION PIPELINE
// =====================================================

function checkAssetsNeeded(movies) {
    const covers = [];
    const previews = [];
    
    for (const movie of movies) {
        // Check Cover
        if (!movie.coverPath) {
            // Check if we already generated one in a previous session
            if (fs.existsSync(movie.generatedCoverPath)) {
                movie.coverPath = movie.generatedCoverPath;
            } else {
                covers.push(movie);
            }
        }
        
        // Check Preview
        // (previewPath is already set if exists in scanRecursive, but double check)
        if (!movie.previewPath && !fs.existsSync(movie.generatedPreviewPath)) {
            // Check legacy path just in case? No, stick to new strict structure
            previews.push(movie);
        }
    }
    return { covers, previews };
}

// Generate Single Frame Cover at 30%
function generateCoverImage(videoPath, outputPath) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);
            
            const duration = metadata.format.duration || 10;
            const timestamp = duration * 0.3; // 30% mark
            
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [timestamp],
                    filename: path.basename(outputPath),
                    folder: dir,
                    size: '480x?', // 480px width, auto height
                })
                .on('end', () => resolve(outputPath))
                .on('error', (err) => reject(err));
        });
    });
}

// IPC: Process Generation Queue
ipcMain.handle('generate-assets', async (event, { movies, types }) => {
    // types = ['cover', 'preview']
    
    // Filter out what actually needs work so Total is accurate
    const needsCoverList = types.includes('cover') 
        ? movies.filter(m => !m.coverPath) 
        : [];
    
    const needsPreviewList = types.includes('preview') 
        ? movies.filter(m => !m.previewPath) 
        : [];
        
    const total = needsCoverList.length + needsPreviewList.length;
    let completed = 0;
    
    // If nothing to do, return immediately
    if (total === 0) return movies;
    
    // 1. Generate Covers
    for (const movie of needsCoverList) {
        try {
            await generateCoverImage(movie.videoPath, movie.generatedCoverPath);
            movie.coverPath = movie.generatedCoverPath;
            completed++;
            
            mainWindow.webContents.send('generation-progress', {
                current: completed,
                total: total,
                type: 'cover',
                movie: movie
            });
        } catch (err) {
            console.error(`Failed cover gen for ${movie.name}`, err);
            // Still count as completed (failed) so UI doesn't hang
            completed++;
            mainWindow.webContents.send('generation-progress', {
                current: completed,
                total: total,
                type: 'cover',
                movie: movie,
                error: true
            });
        }
    }

    // 2. Generate Previews
    for (const movie of needsPreviewList) {
        try {
            await generatePreviewVideo(movie.videoPath, movie.generatedPreviewPath);
            movie.previewPath = movie.generatedPreviewPath;
            completed++;
            
            mainWindow.webContents.send('generation-progress', {
                current: completed,
                total: total,
                type: 'preview',
                movie: movie
            });
        } catch (err) {
            console.error(`Failed preview gen for ${movie.name}`, err);
            completed++;
             mainWindow.webContents.send('generation-progress', {
                current: completed,
                total: total,
                type: 'preview',
                movie: movie,
                error: true
            });
        }
    }
    
    return movies;
});

// =====================================================
// VIDEO REPAIR LOGIC
// =====================================================
// =====================================================
// VIDEO REPAIR LOGIC
// =====================================================
ipcMain.handle('repair-video', async (event, videoPath) => {
    return new Promise((resolve, reject) => {
        // Force output to be .mp4 (Container Conversion / Optimization)
        const dir = path.dirname(videoPath);
        const name = path.parse(videoPath).name;
        // Normalize paths to avoid confusion
        const normVideoPath = path.normalize(videoPath);
        const tempPath = path.normalize(path.join(dir, `${name}.repaired.mp4`));
        const finalPath = path.normalize(path.join(dir, `${name}.mp4`));
        
        console.log(`[REPAIR] Probing: ${normVideoPath}`);
        
        // 1. Probe to check codecs
        ffmpeg.ffprobe(normVideoPath, (err, metadata) => {
            if (err) {
                console.error('[REPAIR] Probe failed:', err);
                return reject(err);
            }
            
            // 2. Build Options
            const outputOptions = [
                '-c', 'copy',                // Stream copy (fast, lossless)
                '-movflags', '+faststart'    // Optimize Atom placement for seeking
            ];
            
            // Only add AAC filter if AAC stream is present
            const hasAac = metadata.streams.some(s => s.codec_name === 'aac' && s.codec_type === 'audio');
            
            if (hasAac) {
                console.log('[REPAIR] AAC Audio detected. Adding bitstream filter.');
                outputOptions.push('-bsf:a', 'aac_adtstoasc');
            } else {
                console.log('[REPAIR] Non-AAC Audio (or no audio). Skipping aac_adtstoasc.');
            }
            
            console.log(`[REPAIR] Starting conversion to MP4...`);
            console.log(`[REPAIR] Temp: ${tempPath}`);

            ffmpeg(normVideoPath)
                .outputOptions(outputOptions)
                .output(tempPath)
                .format('mp4') // Explicitly force MP4 container
                .on('start', (cmd) => {
                    console.log('[REPAIR] Command:', cmd);
                })
                .on('error', (err) => {
                    console.error('[REPAIR] Error:', err);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                    reject(err);
                })
                .on('end', () => {
                    console.log('[REPAIR] Finished. Swapping files...');
                    try {
                        // 1. Remove original file (even if it was .mkv)
                        if (fs.existsSync(normVideoPath)) {
                             // Retry logic for file lock?
                             try {
                                fs.rmSync(normVideoPath, { force: true });
                             } catch(rmErr) {
                                 console.warn('[REPAIR] Could not delete original immediately (Lock?). Waiting 1s...');
                                 // This is risky in async context without pause, but let's try strict sync first.
                                 throw rmErr; 
                             }
                        }
                        
                        // 2. Rename temp file to final .mp4 path
                        if (fs.existsSync(finalPath) && finalPath !== normVideoPath) {
                             fs.rmSync(finalPath, { force: true });
                        }
                        
                        fs.renameSync(tempPath, finalPath);
                        
                        console.log(`[REPAIR] Success. New path: ${finalPath}`);
                        resolve(finalPath);
                    } catch (e) {
                        console.error('[REPAIR] Swap failed:', e);
                        // Cleanup temp if swap failed
                        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                        reject(e);
                    }
                })
                .run();
        });
    });
});

// Updated Preview Generator (Uses output path directly)
function generatePreviewVideo(videoPath, outputPath) {
    return new Promise((resolve, reject) => {
        const previewDir = path.dirname(outputPath);
        if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });
        
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) return reject(err);

            
            const duration = metadata.format.duration;
            const positions = [0.1, 0.3, 0.5, 0.7, 0.9];
            const clipDuration = 3;
            
            const tempFiles = [];
            let clipPromises = positions.map((pos, i) => {
                return new Promise((res, rej) => {
                    const startTime = duration * pos;
                    const tempFile = path.join(previewDir, `temp_${i}_${Date.now()}.mp4`);
                    tempFiles.push(tempFile);
                    
                    ffmpeg(videoPath)
                        .setStartTime(startTime)
                        .setDuration(clipDuration)
                        .outputOptions([
                            '-vf', 'scale=320:-2',
                            '-c:v', 'libx264',
                            '-preset', 'ultrafast',
                            '-crf', '28',
                            '-an' // Mute audio
                        ])
                        .output(tempFile)
                        .on('end', () => res(tempFile))
                        .on('error', rej)
                        .run();
                });
            });
            
            Promise.all(clipPromises)
                .then(() => {
                    const listFile = path.join(previewDir, `list_${Date.now()}.txt`);
                    const listContent = tempFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
                    fs.writeFileSync(listFile, listContent);
                    
                    ffmpeg()
                        .input(listFile)
                        .inputOptions(['-f', 'concat', '-safe', '0'])
                        .outputOptions(['-c', 'copy'])
                        .output(outputPath)
                        .on('end', () => {
                            tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
                            try { fs.unlinkSync(listFile); } catch (e) {}
                            resolve(outputPath);
                        })
                        .on('error', (err) => {
                            // Cleanup on error
                            tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
                            try { fs.unlinkSync(listFile); } catch (e) {}
                            reject(err);
                        })
                        .run();
                })
                .catch(reject);
        });
    });
}

// Helpers
function isVideoFile(filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mkv') || ext.endsWith('.avi') || ext.endsWith('.mov');
}

function isImageFile(filename) {
    const ext = filename.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || ext.endsWith('.webp');
}
