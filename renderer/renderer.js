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
    await handleScanResult(result);
}

// UPDATED: Use overlay, do not clear movieList
function showGeneratingLoader(current, total, name = '') {
    const percent = total > 0 ? (current / total) * 100 : 0;
    
    const loader = document.getElementById('generationLoader');
    const progressText = document.getElementById('genProgressText');
    const progressBar = document.getElementById('genProgressBar');
    const detailText = document.getElementById('genDetailText');
    
    if (loader && progressText && progressBar) {
        // Show overlay
        loader.classList.add('visible');
        
        // Update content
        progressText.innerText = `${current}/${total}`;
        progressBar.style.width = `${percent}%`;
        if (detailText) detailText.innerText = name;
    }
}

loadLibrary();

// REWRITE HANDLER TO MATCH NEW MAIN LOGIC
async function handleScanResult(result) {
    if (!result) return;
    
    const { movies, needsGeneration } = result;
    renderMovies(movies);
    
    const { covers, previews } = needsGeneration;
    const hasCovers = covers.length > 0;
    const hasPreviews = previews.length > 0;
    
    if (hasCovers || hasPreviews) {
        isGenerating = true;
        const totalOps = covers.length + previews.length;
        console.log(`[GEN] Starting generation. Total ops: ${totalOps} (Covers: ${covers.length}, Previews: ${previews.length})`);
        
        showGeneratingLoader(0, totalOps, 'Initializing generation...');
        
        // Combine all movies needing attention
        const allNeedingMap = new Map();
        covers.forEach(m => allNeedingMap.set(m.videoPath, m));
        previews.forEach(m => allNeedingMap.set(m.videoPath, m));
        const moviesToProcess = Array.from(allNeedingMap.values());
        
        const types = [];
        if (hasCovers) types.push('cover');
        if (hasPreviews) types.push('preview');
        
        // Trigger generation
        console.log('[GEN] Invoking generating-assets...');
        await window.api.invoke('generate-assets', { 
            movies: moviesToProcess, 
            types: types 
        });
        
        console.log('[GEN] Invoke finished. Force hiding loader.');
        
        // Force hide loader when process completes (even if 0 items were processed)
        isGenerating = false;
        const loader = document.getElementById('generationLoader');
        if (loader) {
            console.log('[GEN] Triggering exit animation.');
            loader.classList.add('hiding');
            loader.classList.remove('visible');
            setTimeout(() => {
                loader.classList.remove('hiding');
            }, 400);
        } else {
            console.log('[GEN] Loader element not found!');
        }
    } else {
        console.log('[GEN] No generation needed.');
    }
}

document.getElementById('scanBtn').addEventListener('click', async () => {
    console.log('[UI] Scan button clicked');
    const result = await window.api.selectFolder();
    await handleScanResult(result);
});

// Update progress listener to handle types
window.api.onGenerationProgress((progress) => {
    console.log(`[GEN-PROGRESS] ${progress.type} | Current: ${progress.current} / Total: ${progress.total} | Movie: ${progress.movie.name}`);
    
    // Update local movie data
    const movieIndex = currentMovies.findIndex(m => m.videoPath === progress.movie.videoPath);
    if (movieIndex !== -1) {
        const original = currentMovies[movieIndex];
        if (progress.type === 'cover') {
            original.coverPath = progress.movie.coverPath;
            // Update DOM if visible
            const el = movieList.children[movieIndex];
            if (el) {
                const coverEl = el.querySelector('.movie-cover');
                // Force cache bust
                const newSrc = `file://${progress.movie.coverPath}?t=${Date.now()}`;
                
                if (coverEl.tagName === 'DIV') {
                    // Replace fallback DIV with IMG
                    const img = document.createElement('img');
                    img.className = 'movie-cover movie-cover-img';
                    img.src = newSrc;
                    img.alt = '';
                    el.replaceChild(img, coverEl);
                } else {
                    // Update existing IMG
                    coverEl.src = newSrc;
                }
            }
        } else if (progress.type === 'preview') {
            original.previewPath = progress.movie.previewPath;
            // No valid visual update for preview needed immediately (it loads on hover)
        }
    }
    
    const label = progress.type === 'cover' ? `Generating Cover: ${progress.movie.name}` : `Generating Preview: ${progress.movie.name}`;
    showGeneratingLoader(progress.current, progress.total, label);
    
    if (progress.current >= progress.total) {
        console.log('[GEN-PROGRESS] Progress complete (current >= total). Hiding loader in 1s...');
        isGenerating = false;
        
        // Wait a bit before closing
        setTimeout(() => {
            const loader = document.getElementById('generationLoader');
            if (loader) {
                // Trigger exit animation
                console.log('[GEN-PROGRESS] Triggering exit animation (scale down).');
                loader.classList.add('hiding');
                loader.classList.remove('visible');
                
                // Reset after animation
                setTimeout(() => {
                    loader.classList.remove('hiding');
                }, 400); // Match CSS transition
            }
        }, 1200);
    }
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
    
    // Collapse sidebar when video selected
    sidebar.classList.add('collapsed');
}

// Title click checks empty state
titleDisplay.addEventListener('click', () => {
    if (currentMovieIndex === -1) {
        sidebar.classList.remove('collapsed');
    }
});

// Play/Pause - Button always works immediately
playBtn.addEventListener('click', togglePlay);

// Video click with delay to distinguish from double-click (fullscreen)
video.addEventListener('click', (e) => {
    // Check if click is in overlay controls zone (bottom area)
    const overlayControls = document.querySelector('.overlay-controls');
    if (overlayControls) {
        const rect = overlayControls.getBoundingClientRect();
        // If click is within overlay controls Y range, ignore
        if (e.clientY >= rect.top - 10) { // 10px buffer above controls
            return;
        }
    }

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
    // Only toggle if a video is loaded
    if (currentMovieIndex === -1 || !video.src) return;

    if (video.paused) {
        video.play();
    } else {
        video.pause();
    }
    // Icon update handled by native events below
}

// =====================================================
// NATIVE PLAY/PAUSE EVENTS (Sync with keyboard/gesture)
// =====================================================
const playIndicator = document.getElementById('playIndicator');

function showPlayIndicator(isPlaying) {
    // Replace icon HTML (Lucide converts <i> to <svg>, so we need fresh element)
    const iconName = isPlaying ? 'play' : 'pause';
    playIndicator.innerHTML = `<i data-lucide="${iconName}"></i>`;
    lucide.createIcons();
    
    // Trigger animation
    playIndicator.classList.remove('animate');
    void playIndicator.offsetWidth; // Force reflow
    playIndicator.classList.add('animate');
}

video.addEventListener('play', () => {
    updatePlayIcon(true);
    showPlayIndicator(true);
});

video.addEventListener('pause', () => {
    updatePlayIcon(false);
    showPlayIndicator(false);
});

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

/* Skipper UX: JS handles 2s delay ONLY when fully open */
const skipperBack = document.querySelector('.skipper-back');
const skipperFwd = document.querySelector('.skipper-fwd');

if (skipperBack && skipperFwd) {
    const backControls = skipperBack.querySelector('.skipper-controls');
    const fwdControls = skipperFwd.querySelector('.skipper-controls');
    
    let backFullyOpen = false;
    let fwdFullyOpen = false;
    let backCloseTimeout = null;
    let fwdCloseTimeout = null;

    // Detect fully open via transitionend
    backControls.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'max-width') {
            const maxW = getComputedStyle(backControls).maxWidth;
            backFullyOpen = maxW !== '0px' && maxW !== '0';
        }
    });

    fwdControls.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'max-width') {
            const maxW = getComputedStyle(fwdControls).maxWidth;
            fwdFullyOpen = maxW !== '0px' && maxW !== '0';
        }
    });

    // Back: mouseenter - cancel pending close, clear other's keep-open
    skipperBack.addEventListener('mouseenter', () => {
        clearTimeout(backCloseTimeout);
        backControls.classList.remove('keep-open');
        // Cross-cancel: close Fwd immediately
        clearTimeout(fwdCloseTimeout);
        fwdControls.classList.remove('keep-open');
        fwdFullyOpen = false;
    });

    // Back: mouseleave - if fully open, hold 2s
    skipperBack.addEventListener('mouseleave', () => {
        if (backFullyOpen) {
            backControls.classList.add('keep-open');
            backCloseTimeout = setTimeout(() => {
                backControls.classList.remove('keep-open');
                backFullyOpen = false;
            }, 2000);
        }
    });

    // Fwd: mouseenter - cancel pending close, clear other's keep-open
    skipperFwd.addEventListener('mouseenter', () => {
        clearTimeout(fwdCloseTimeout);
        fwdControls.classList.remove('keep-open');
        // Cross-cancel: close Back immediately
        clearTimeout(backCloseTimeout);
        backControls.classList.remove('keep-open');
        backFullyOpen = false;
    });

    // Fwd: mouseleave - if fully open, hold 2s
    skipperFwd.addEventListener('mouseleave', () => {
        if (fwdFullyOpen) {
            fwdControls.classList.add('keep-open');
            fwdCloseTimeout = setTimeout(() => {
                fwdControls.classList.remove('keep-open');
                fwdFullyOpen = false;
            }, 2000);
        }
    });
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
        icon.setAttribute('data-lucide', 'volume-off');
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
// CONTROLS VISIBILITY
// =====================================================
const appContainer = document.querySelector('.app-container');
let controlsHideTimer = null;
let controlsIdleTimer = null;

// Initial load: Show controls
appContainer.classList.add('controls-visible');

function showControls() {
    // Clear pending hide timers
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    if (controlsIdleTimer) clearTimeout(controlsIdleTimer);
    
    appContainer.classList.add('controls-visible');
    
    // Start idle timer (auto hide if mouse doesn't move)
    startIdleTimer();
}

function hideControlsDelayed(delay) {
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    if (controlsIdleTimer) clearTimeout(controlsIdleTimer);
    
    // If paused, controls stay visible (CSS handled, but logic here for state)
    if (video.paused) return;
    
    controlsHideTimer = setTimeout(() => {
        if (!video.paused) {
             appContainer.classList.remove('controls-visible');
        }
    }, delay);
}

function startIdleTimer() {
    // Only auto-hide if playing
    if (video.paused) return;
    
    controlsIdleTimer = setTimeout(() => {
        // Prevent hiding if user is hovering over controls
        const isHoveringControls = document.querySelector('.overlay-controls:hover') || document.querySelector('.top-overlay:hover');
        
        if (isHoveringControls) {
            startIdleTimer(); // Restart timer, keep visible
            return;
        }

         if (!video.paused) {
            appContainer.classList.remove('controls-visible');
        }
    }, 2500); // 2.5s idle timeout
}

// Event Listeners on Main Content (Video Area)
const mainContent = document.querySelector('.main-content');

mainContent.addEventListener('mouseenter', () => {
    showControls();
});

mainContent.addEventListener('mouseleave', () => {
    hideControlsDelayed(1000); // 1s delay on leave
});

mainContent.addEventListener('mousemove', () => {
    showControls(); // Show and reset idle timer
});

// Ensure controls visible instantly on pause
video.addEventListener('pause', () => {
    showControls();
    // Don't start idle timer if paused (controls should stay)
    if (controlsIdleTimer) clearTimeout(controlsIdleTimer);
});

// Start idle timer on play
video.addEventListener('play', () => {
    startIdleTimer();
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

// =====================================================
// ARROW KEY SKIP (Left/Right)
// =====================================================
const skipIndicatorLeft = document.getElementById('skipIndicatorLeft');
const skipIndicatorRight = document.getElementById('skipIndicatorRight');
const skipAmountLeft = document.getElementById('skipAmountLeft');
const skipAmountRight = document.getElementById('skipAmountRight');

let leftCumulative = 0;
let rightCumulative = 0;
let leftScaledUp = false;
let rightScaledUp = false;
let leftScaleDownTimeout = null;
let rightScaleDownTimeout = null;
let leftFadeOutTimeout = null;
let rightFadeOutTimeout = null;

function showSkipIndicator(direction) {
    const isLeft = direction === 'left';
    const indicator = isLeft ? skipIndicatorLeft : skipIndicatorRight;
    const amountEl = isLeft ? skipAmountLeft : skipAmountRight;
    
    // Cancel other direction completely
    if (isLeft) {
        clearTimeout(rightScaleDownTimeout);
        clearTimeout(rightFadeOutTimeout);
        skipIndicatorRight.classList.remove('visible');
        skipAmountRight.classList.remove('scale-up');
        rightCumulative = 0;
        rightScaledUp = false;
    } else {
        clearTimeout(leftScaleDownTimeout);
        clearTimeout(leftFadeOutTimeout);
        skipIndicatorLeft.classList.remove('visible');
        skipAmountLeft.classList.remove('scale-up');
        leftCumulative = 0;
        leftScaledUp = false;
    }
    
    // Track state BEFORE updating
    const wasScaledUp = isLeft ? leftScaledUp : rightScaledUp;
    const wasVisible = indicator.classList.contains('visible');
    
    // Update cumulative and video time
    if (isLeft) {
        leftCumulative += 10;
        video.currentTime = Math.max(0, video.currentTime - 10);
        // Delay 200ms before number shows
        setTimeout(() => {
            skipAmountLeft.textContent = `-${leftCumulative}`;
        }, 200);
    } else {
        rightCumulative += 10;
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
        // Delay 200ms before number shows
        setTimeout(() => {
            skipAmountRight.textContent = `+${rightCumulative}`;
        }, 200);
    }
    
    // Show indicator
    indicator.classList.add('visible');
    
    // Scale animation logic
    if (!wasScaledUp) {
        if (!wasVisible) {
            // First press: ANIMATED scale up 0.9 → 1, NO bounce after
            amountEl.classList.add('scale-up');
        } else {
            // Press after bounce: INSTANT scale up 0.9 → 1
            amountEl.classList.add('instant');
            amountEl.classList.add('scale-up');
            void amountEl.offsetWidth;
            amountEl.classList.remove('instant');
        }
        if (isLeft) leftScaledUp = true;
        else rightScaledUp = true;
    }
    // If wasScaledUp = true: just update number, NO animation
    
    // Clear timeouts
    if (isLeft) {
        clearTimeout(leftScaleDownTimeout);
        clearTimeout(leftFadeOutTimeout);
    } else {
        clearTimeout(rightScaleDownTimeout);
        clearTimeout(rightFadeOutTimeout);
    }
    
    // Debounced bounce - ONLY for subsequent presses (wasVisible = true)
    if (wasVisible) {
        const scaleDownTimeout = setTimeout(() => {
            // Add slow transition for bounce down
            amountEl.classList.add('bouncing');
            
            // Scale down 1 → 0.9 (209ms animation)
            amountEl.classList.remove('scale-up');
            
            // After 150ms animation, snap back to 1 (animated)
            setTimeout(() => {
                amountEl.classList.add('scale-up');
                amountEl.classList.remove('bouncing');
            }, 150);
        }, 200);
        if (isLeft) leftScaleDownTimeout = scaleDownTimeout;
        else rightScaleDownTimeout = scaleDownTimeout;
    }
    
    // Fade out after 1 second
    const fadeOutTimeout = setTimeout(() => {
        indicator.classList.remove('visible');
        amountEl.classList.remove('scale-up');
        if (isLeft) {
            leftCumulative = 0;
            leftScaledUp = false;
        } else {
            rightCumulative = 0;
            rightScaledUp = false;
        }
    }, 1000);
    if (isLeft) leftFadeOutTimeout = fadeOutTimeout;
    else rightFadeOutTimeout = fadeOutTimeout;
}



// Keyboard listener
// Keyboard listener
document.addEventListener('keydown', (e) => {
    // Only if video is loaded
    if (currentMovieIndex === -1 || !video.src) return;
    
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        showSkipIndicator('left');
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        showSkipIndicator('right');
    }
});

// =====================================================
// LOGO ENTRANCE ANIMATION
// =====================================================
window.addEventListener('load', () => {
    // Target the parent placeholder
    const placeholder = document.querySelector('.video-placeholder');
    if (placeholder) {
        setTimeout(() => {
            // Trigger sequenced animation via CSS
            placeholder.classList.add('animate-in');
        }, 500); // 0.5s delay before start
    }
});

// Initialize Lucide icons for skip indicators
lucide.createIcons();
