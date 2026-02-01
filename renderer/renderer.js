// =====================================================
// DOM ELEMENTS
// =====================================================
const video = document.getElementById('mainVideo');
const playBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressThumb = document.getElementById('progressThumb');
const timeDisplay = document.getElementById('currentTime');
const totalTimeDisplay = document.getElementById('totalTime');
const volumeSlider = document.getElementById('volumeSlider');
const volumeBtn = document.getElementById('volumeBtn');
const volumeIcon = document.getElementById('volumeIcon');
const movieList = document.getElementById('movieList');
const titleDisplay = document.getElementById('videoTitle');
const sidebar = document.getElementById('sidebar');

// =====================================================
// STATE
// =====================================================
let isPlaying = false;
let currentMovies = [];
let currentMovieIndex = -1;
let previousVolume = 0.5; // Store volume before mute (default restore to 50%)
let clickTimeout = null; // For single/double click detection
const CLICK_DELAY = 250; // ms delay to distinguish single from double click
let volumeSliderLocked = false; // Keep slider open after user adjusts volume

// =====================================================
// WINDOW CONTROLS
// =====================================================
document.getElementById('refreshBtn').addEventListener('click', () => window.api.refresh());
document.getElementById('minBtn').addEventListener('click', () => window.api.minimize());
document.getElementById('maxBtn').addEventListener('click', () => window.api.maximize());
document.getElementById('closeBtn').addEventListener('click', () => window.api.close());

// Update maximize icon based on window state
function updateMaximizeIcon(isMaximized) {
    const btn = document.getElementById('maxBtn');
    if (btn) {
        // Replace with new icon element (Lucide converts i to svg, so we need fresh element)
        btn.innerHTML = `<i data-lucide="${isMaximized ? 'copy' : 'square'}"></i>`;
        lucide.createIcons();
    }
}

// Listen for maximize state changes
window.api.onMaximizeChange((isMaximized) => {
    updateMaximizeIcon(isMaximized);
});

// Check initial state
window.api.isMaximized().then(updateMaximizeIcon);

// =====================================================
// INITIALIZE LUCIDE ICONS
// =====================================================
lucide.createIcons();

// =====================================================
// LIBRARY SCANNING & PREVIEW GENERATION
// =====================================================
let isGenerating = false;

async function loadLibrary() {
    const result = await window.api.scanDefault();
    if (!result) return;
    
    const { movies, needsGeneration } = result;
    
    if (needsGeneration && needsGeneration.length > 0) {
        // Show generating loader
        showGeneratingLoader(0, needsGeneration.length);
        isGenerating = true;
        
        // Generate previews
        const updatedMovies = await window.api.generatePreviews(needsGeneration);
        
        // Merge updated preview paths
        for (const updated of updatedMovies) {
            const original = movies.find(m => m.videoPath === updated.videoPath);
            if (original) {
                original.previewPath = updated.previewPath;
            }
        }
        
        isGenerating = false;
    }
    
    renderMovies(movies);
}

// Listen for preview progress updates
window.api.onPreviewProgress((progress) => {
    showGeneratingLoader(progress.current, progress.total, progress.name);
});

function showGeneratingLoader(current, total, name = '') {
    const percent = total > 0 ? (current / total) * 100 : 0;
    movieList.innerHTML = `
        <div class="generating-loader">
            <div class="loader-text">Generating thumbnails</div>
            <div class="loader-progress">${current}/${total}</div>
            <div class="loader-bar">
                <div class="loader-bar-fill" style="width: ${percent}%"></div>
            </div>
            ${name ? `<div class="loader-name">${name}</div>` : ''}
        </div>
    `;
}

loadLibrary();

document.getElementById('scanBtn').addEventListener('click', async () => {
    const result = await window.api.selectFolder();
    if (!result) return;
    
    const { movies, needsGeneration } = result;
    
    if (needsGeneration && needsGeneration.length > 0) {
        showGeneratingLoader(0, needsGeneration.length);
        isGenerating = true;
        
        const updatedMovies = await window.api.generatePreviews(needsGeneration);
        
        for (const updated of updatedMovies) {
            const original = movies.find(m => m.videoPath === updated.videoPath);
            if (original) {
                original.previewPath = updated.previewPath;
            }
        }
        
        isGenerating = false;
    }
    
    renderMovies(movies);
});

function renderMovies(movies) {
    currentMovies = movies;
    movieList.innerHTML = '';
    
    if (movies.length === 0) {
        movieList.innerHTML = `
            <div class="movie-list-empty">
                No MP4/WebM/MKV videos found.<br>
                Click "Open Folder" to scan a directory.
            </div>
        `;
        return;
    }

    movies.forEach((movie, index) => {
        const el = document.createElement('div');
        el.className = 'movie-item';
        el.onclick = () => playMovie(index);
        
        // Use img tag for cover + hidden preview video
        let coverHtml = `<div class="movie-cover"></div>`;
        if (movie.coverPath) {
            coverHtml = `<img src="${movie.coverPath}" class="movie-cover movie-cover-img" alt="">`;
        }

        el.innerHTML = `
            ${coverHtml}
            <video class="movie-preview" muted loop preload="none"></video>
            <div class="movie-overlay">
                <div class="movie-title">${movie.name}</div>
                <div class="movie-meta">
                    <span>${formatSize(movie.size)}</span>
                </div>
            </div>
        `;
        
        // Preview on hover
        const previewVideo = el.querySelector('.movie-preview');
        let previewInterval = null;
        
        // Check if generated preview exists
        const hasPreview = movie.previewPath && movie.previewPath.length > 0;
        
        el.addEventListener('mouseenter', () => {
            if (hasPreview) {
                // Use generated preview video - just play and loop
                previewVideo.src = movie.previewPath;
                previewVideo.load();
                previewVideo.onloadeddata = () => {
                    previewVideo.play().catch(() => {});
                    el.classList.add('previewing');
                };
            } else {
                // Fallback: seek through original video
                const previewPositions = [0.1, 0.3, 0.5, 0.7, 0.9];
                let currentPosIndex = 0;
                
                previewVideo.src = movie.videoPath;
                previewVideo.load();
                
                previewVideo.onloadedmetadata = () => {
                    previewVideo.currentTime = previewVideo.duration * previewPositions[0];
                    previewVideo.play().catch(() => {});
                    el.classList.add('previewing');
                    
                    previewInterval = setInterval(() => {
                        currentPosIndex = (currentPosIndex + 1) % previewPositions.length;
                        previewVideo.currentTime = previewVideo.duration * previewPositions[currentPosIndex];
                    }, 3000);
                };
            }
        });
        
        el.addEventListener('mouseleave', () => {
            if (previewInterval) {
                clearInterval(previewInterval);
                previewInterval = null;
            }
            previewVideo.pause();
            previewVideo.src = '';
            previewVideo.load();
            el.classList.remove('previewing');
        });
        
        movieList.appendChild(el);
    });
}

// =====================================================
// VIDEO PLAYBACK
// =====================================================
function playMovie(index) {
    const movie = currentMovies[index];
    if (!movie) return;
    
    currentMovieIndex = index;

    // Highlight active
    document.querySelectorAll('.movie-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });

    titleDisplay.innerText = movie.name;
    video.src = movie.videoPath;
    video.play();
    updatePlayIcon(true);
    
    // Hide placeholder
    document.querySelector('.main-content').classList.add('has-video');
}

// Play/Pause - Button always works immediately
playBtn.addEventListener('click', togglePlay);

// Video click with delay to distinguish from double-click (fullscreen)
video.addEventListener('click', (e) => {
    // Cancel any pending single click
    if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
        return; // This was second click of double-click, ignore
    }
    
    // Set a timeout - if no second click, execute single click action
    clickTimeout = setTimeout(() => {
        clickTimeout = null;
        togglePlay();
    }, CLICK_DELAY);
});

function togglePlay() {
    if (video.paused) {
        video.play();
        updatePlayIcon(true);
    } else {
        video.pause();
        updatePlayIcon(false);
    }
}

function updatePlayIcon(playing) {
    isPlaying = playing;
    const icon = document.getElementById('playIcon');
    if (playing) {
        icon.setAttribute('data-lucide', 'pause');
    } else {
        icon.setAttribute('data-lucide', 'play');
    }
    lucide.createIcons();
    
    // Unlock volume slider when play/pause is triggered
    unlockVolumeSlider();
}

function unlockVolumeSlider() {
    if (volumeSliderLocked) {
        volumeSliderLocked = false;
        volumeBtn.classList.remove('slider-locked');
    }
}

// =====================================================
// PROGRESS BAR & SEEKING
// =====================================================
const progressPreview = document.getElementById('progressPreview');
const previewCanvas = document.getElementById('previewCanvas');
const previewTime = document.getElementById('previewTime');
const previewCtx = previewCanvas.getContext('2d');

// Hidden video for frame capture
const seekerPreviewVideo = document.createElement('video');
seekerPreviewVideo.muted = true;
seekerPreviewVideo.preload = 'metadata';

// Delay state
let previewDelayTimer = null;
let previewVisible = false;
const PREVIEW_DELAY = 200; // ms before showing

progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
});

progressBar.addEventListener('mouseenter', () => {
    // Set video source for preview
    if (video.src && seekerPreviewVideo.src !== video.src) {
        seekerPreviewVideo.src = video.src;
    }
    
    // Delay before showing preview
    previewDelayTimer = setTimeout(() => {
        previewVisible = true;
        progressPreview.classList.add('visible');
    }, PREVIEW_DELAY);
});

// Cache for sprite image
// let spriteImage = null;
// let lastSpritePath = null;

progressBar.addEventListener('mousemove', (e) => {
    if (!video.duration) return;
    
    const rect = progressBar.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const pos = Math.max(0, Math.min(1, mouseX / rect.width));
    const previewTimeValue = pos * video.duration;
    
    // Calculate clamped position for tooltip
    // Tooltip width is approx 160px (canvas) + borders
    const tooltipWidth = 162; 
    let tooltipLeft = mouseX - (tooltipWidth / 2);
    
    // Clamp to [0,  width - tooltipWidth]
    tooltipLeft = Math.max(0, Math.min(tooltipLeft, rect.width - tooltipWidth));
    
    // Update position and time
    progressPreview.style.left = `${tooltipLeft}px`;
    previewTime.innerText = formatTime(previewTimeValue);
    
    // Seek immediately
    if (previewVisible) {
        seekerPreviewVideo.currentTime = previewTimeValue;
    }
});

// Capture frame when seek completes
seekerPreviewVideo.addEventListener('seeked', () => {
    if (previewVisible) {
        previewCtx.drawImage(seekerPreviewVideo, 0, 0, 160, 90);
    }
});

progressBar.addEventListener('mouseleave', () => {
    // Cancel delay timer
    if (previewDelayTimer) {
        clearTimeout(previewDelayTimer);
        previewDelayTimer = null;
    }
    
    previewVisible = false;
    progressPreview.classList.remove('visible');
});

video.addEventListener('timeupdate', () => {
    if (video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = `${pct}%`;
        progressThumb.style.left = `${pct}%`;
        timeDisplay.innerText = formatTime(video.currentTime);
        totalTimeDisplay.innerText = formatTime(video.duration);
    }
});

video.addEventListener('ended', () => {
    updatePlayIcon(false);
});

// =====================================================
// SKIP BUTTONS
// =====================================================
document.getElementById('skipBack10s').addEventListener('click', () => skipTime(-10));
document.getElementById('skipBack30s').addEventListener('click', () => skipTime(-30));
document.getElementById('skipBack1m').addEventListener('click', () => skipTime(-60));
document.getElementById('skipBack10m').addEventListener('click', () => skipTime(-600));
document.getElementById('skipBack30m').addEventListener('click', () => skipTime(-1800));

document.getElementById('skipFwd10s').addEventListener('click', () => skipTime(10));
document.getElementById('skipFwd30s').addEventListener('click', () => skipTime(30));
document.getElementById('skipFwd1m').addEventListener('click', () => skipTime(60));
document.getElementById('skipFwd10m').addEventListener('click', () => skipTime(600));
document.getElementById('skipFwd30m').addEventListener('click', () => skipTime(1800));

function skipTime(seconds) {
    if (!video.duration) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
}

// =====================================================
// VOLUME CONTROL
// =====================================================

// Slider input - update volume & lock slider open
volumeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    const value = parseFloat(e.target.value);
    video.volume = value;
    updateVolumeIcon(value);
    updateVolumeSliderStyle(value);
    if (value > 0) {
        previousVolume = value;
    }
    
    // Lock slider open until play/pause
    if (!volumeSliderLocked) {
        volumeSliderLocked = true;
        volumeBtn.classList.add('slider-locked');
    }
});

// Prevent slider clicks from bubbling
volumeSlider.addEventListener('click', (e) => {
    e.stopPropagation();
});
volumeSlider.addEventListener('mousedown', (e) => {
    e.stopPropagation();
});

// Click on ICON only to mute/unmute (with 5px tolerance)
volumeBtn.addEventListener('click', (e) => {
    const iconEl = volumeBtn.querySelector('svg') || volumeBtn.querySelector('i');
    if (!iconEl) return;
    
    const iconRect = iconEl.getBoundingClientRect();
    const tolerance = 5;
    
    // Check if click is within icon bounds + tolerance
    const isOnIcon = (
        e.clientX >= iconRect.left - tolerance &&
        e.clientX <= iconRect.right + tolerance &&
        e.clientY >= iconRect.top - tolerance &&
        e.clientY <= iconRect.bottom + tolerance
    );
    
    if (!isOnIcon) return;
    
    // Toggle mute
    if (video.volume > 0) {
        previousVolume = video.volume;
        video.volume = 0;
        volumeSlider.value = 0;
    } else {
        video.volume = previousVolume || 0.5;
        volumeSlider.value = video.volume;
    }
    updateVolumeIcon(video.volume);
    updateVolumeSliderStyle(video.volume);
    
    // Unlock slider so it closes on unhover
    unlockVolumeSlider();
});

function updateVolumeIcon(volume) {
    const icon = document.getElementById('volumeIcon');
    
    // Set icon type based on volume level
    if (volume === 0) {
        icon.setAttribute('data-lucide', 'volume-x');
    } else if (volume < 0.5) {
        icon.setAttribute('data-lucide', 'volume-1');
    } else {
        icon.setAttribute('data-lucide', 'volume-2');
    }
    lucide.createIcons();
}

function updateVolumeSliderStyle(volume) {
    const percent = volume * 100;
    volumeSlider.style.setProperty('--volume-percent', `${percent}%`);
}

// Initialize with volume muted (0)
video.volume = 0;
volumeSlider.value = 0;
updateVolumeSliderStyle(0);
updateVolumeIcon(0);

// =====================================================
// FULLSCREEN
// =====================================================
document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

let wasCollapsedBeforeFullscreen = false;

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.querySelector('.app-container').requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// Auto-collapse sidebar on fullscreen, restore on exit
document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
        // Entering fullscreen - remember state & collapse
        wasCollapsedBeforeFullscreen = sidebar.classList.contains('collapsed');
        sidebar.classList.add('collapsed');
    } else {
        // Exiting fullscreen - restore previous state
        if (!wasCollapsedBeforeFullscreen) {
            sidebar.classList.remove('collapsed');
        }
    }
});

// Double click on video for fullscreen - cancel pending single click
video.addEventListener('dblclick', (e) => {
    // Cancel the pending single click
    if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
    }
    toggleFullscreen();
});

// Double click on other main-content areas
document.querySelector('.main-content').addEventListener('dblclick', (e) => {
    if (e.target !== video && !e.target.closest('.overlay-controls')) {
        toggleFullscreen();
    }
});

// =====================================================
// SIDEBAR TOGGLE
// =====================================================
document.getElementById('sidebarToggle').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
});

// =====================================================
// KEYBOARD SHORTCUTS
// =====================================================
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            togglePlay();
            break;
        case 'ArrowLeft':
            skipTime(e.shiftKey ? -60 : -10);
            break;
        case 'ArrowRight':
            skipTime(e.shiftKey ? 60 : 10);
            break;
        case 'ArrowUp':
            e.preventDefault();
            video.volume = Math.min(1, video.volume + 0.1);
            volumeSlider.value = video.volume;
            updateVolumeIcon(video.volume);
            updateVolumeSliderStyle(video.volume);
            break;
        case 'ArrowDown':
            e.preventDefault();
            video.volume = Math.max(0, video.volume - 0.1);
            volumeSlider.value = video.volume;
            updateVolumeIcon(video.volume);
            updateVolumeSliderStyle(video.volume);
            break;
        case 'KeyF':
            toggleFullscreen();
            break;
        case 'KeyM':
            volumeBtn.click(); // Trigger mute toggle
            break;
        case 'Escape':
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
            break;
    }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}
