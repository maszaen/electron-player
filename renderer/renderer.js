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
let resumeMode = 'ask'; // 'always', 'never', 'ask'
let autoplayNext = sessionStorage.getItem('autoplayNext') === 'true'; // Default false/never, persist on refresh
let isVideoEnded = false;
let nextVideoTimer = null;
let nextVideoInterval = null;
let lastSaveTime = 0;
let hasSavedProgress = false;
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

// Repair Progress Listener
window.api.onRepairProgress((percent) => {
    const loader = document.getElementById('generationLoader');
    const progressText = document.getElementById('genProgressText');
    const progressBar = document.getElementById('genProgressBar');
    
    if (loader && progressText && progressBar) {
        if (!loader.classList.contains('visible')) {
            loader.classList.add('visible');
        }
        
        progressText.innerText = `${percent}%`;
        progressBar.style.width = `${percent}%`;
        
        // Optional: Update detail text if needed, but handled by initial call usually
    }
});

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
async function playMovie(index) {
    const movie = currentMovies[index];
    if (!movie) return;
    
    currentMovieIndex = index;
    hasSavedProgress = false; // Reset tracking for new video

    // Highlight active
    document.querySelectorAll('.movie-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
    });

    titleDisplay.innerText = movie.name;
    video.src = movie.videoPath;
    
    // Hide placeholder
    document.querySelector('.main-content').classList.add('has-video');
    sidebar.classList.add('collapsed');

    // Reset Ended State & Overlay
    isVideoEnded = false;
    video.classList.remove('fade-out-video'); 
    hideNextVideoOverlay(); // Clear overlay if needed

    // RESUME LOGIC
    try {
        const savedTime = await window.api.invoke('get-progress', movie.videoPath);
        
        // Remove fade out immediately on load
        video.classList.remove('fade-out-video');

        if (savedTime && savedTime > 5) {
             if (resumeMode === 'always') {
                 video.currentTime = savedTime;
                 startPlayback();
                 showToast(`Resumed at ${formatTime(savedTime)}`, 'info');
             } else if (resumeMode === 'never') {
                 video.currentTime = 0;
                 startPlayback();
             } else {
                 // Ask
                 if (typeof showResumeModal === 'function') {
                    showResumeModal(savedTime);
                    updatePlayIcon(false);
                 } else {
                    // Fallback if modal missing
                    startPlayback();
                 }
             }
        } else {
             video.currentTime = 0;
             startPlayback();
        }
    } catch (err) {
        console.error("Resume error:", err);
        // Fallback: Start from beginning
        video.currentTime = 0;
        startPlayback();
    }
}

function startPlayback() {
    const playPromise = video.play();
    if (playPromise !== undefined) {
        playPromise.then(_ => {
            updatePlayIcon(true);
        })
        .catch(error => {
            console.warn("Autoplay prevented or failed:", error);
            updatePlayIcon(false);
        });
    }
}

// Title click checks empty state
titleDisplay.addEventListener('click', () => {
    if (currentMovieIndex === -1) {
        sidebar.classList.remove('collapsed');
    }
});

// Play/Pause - Button always works immediately
playBtn.addEventListener('click', (e) => {
    // Blur to prevent Space double-trigger if button keeps focus
    playBtn.blur();
    togglePlay();
});

// Video click with delay to distinguish from double-click (fullscreen)
// Video click with delay to distinguish from double-click (fullscreen)
// Use container to catch clicks even if blocked by transparent overlays
const playerContainer = document.getElementById('playerContainer');

playerContainer.addEventListener('click', (e) => {
    // IGNORE CLICKS ON INTERACTIVE ELEMENTS
    // Check if target is button, input, or inside menu/controls
    if (e.target.closest('button') || 
        e.target.closest('input') || 
        e.target.closest('.context-menu') ||
        e.target.closest('.modal-content') ||
        e.target.closest('.sidebar')) {
        return;
    }

    // Check if click is in overlay controls zone (bottom area) explicitly
    // This prevents clicks on the control bar area from toggling the video
    const overlayControls = document.querySelector('.overlay-controls');
    if (overlayControls) {
        const rect = overlayControls.getBoundingClientRect();
        // If click is within overlay controls Y range (plus buffer), ignore
        if (e.clientY >= rect.top - 10) { 
            return;
        }
    }

    // Cancel any pending single click
    if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
        return; // Double click detected (will be handled by dblclick listener on video/container)
    }
    
    // Set a timeout - if no second click, execute single click action
    clickTimeout = setTimeout(() => {
        clickTimeout = null;
        togglePlay();
    }, 250); // CLICK_DELAY
});

function togglePlay() {
    // Only toggle if a video is loaded
    if (currentMovieIndex === -1 || !video.src) return;

    if (isVideoEnded) {
        // Reset state first
        isVideoEnded = false;
        video.classList.remove('fade-out-video');
        hideNextVideoOverlay();

        if (autoplayNext) {
            if (currentMovieIndex < currentMovies.length - 1) {
                // Play next
                playMovie(currentMovieIndex + 1);
                return;
            }
        }
        
        // Replay (if autoplayNext is false OR if last video)
        video.currentTime = 0;
        startPlayback();
        return;
    }

    if (video.paused || video.ended) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.warn("Toggle play failed:", error);
            });
        }
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
    playBtn.classList.remove('is-replay'); // Reset Replay Style
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

    // "user slide manual ... = play the video"
    if (isVideoEnded) {
        hideNextVideoOverlay();
        video.play();
        isVideoEnded = false;
        video.classList.remove('fade-out-video');
    }
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
    const tooltipWidth = 220; 
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
        
        // Save Progress (Throttle 5s)
        const now = Date.now();
        // Resume Logic: > 20% Rule
        const progressRatio = video.currentTime / video.duration;
        
        if (progressRatio > 0.2) {
             // Save (Throttle 5s)
            if (now - lastSaveTime > 5000 && !video.paused) {
                if (currentMovieIndex !== -1) {
                    const path = currentMovies[currentMovieIndex].videoPath;
                    window.api.invoke('save-progress', { path, time: video.currentTime });
                    hasSavedProgress = true;
                }
                lastSaveTime = now;
            }
        } else if (hasSavedProgress) {
            // User sought back to < 20%, clear history
            if (currentMovieIndex !== -1) {
                window.api.invoke('clear-progress', currentMovies[currentMovieIndex].videoPath);
                hasSavedProgress = false;
            }
        }
    }
});

video.addEventListener('ended', () => {
    // Flag ended state
    isVideoEnded = true;

    // Clear progress on finish
    if (currentMovieIndex !== -1) {
        const path = currentMovies[currentMovieIndex].videoPath;
        window.api.invoke('clear-progress', path);
    }
    
    // Determine Next Video
    let nextMovie = null;
    if (currentMovieIndex < currentMovies.length - 1) {
        nextMovie = currentMovies[currentMovieIndex + 1];
    }

    if (autoplayNext && nextMovie) {
        // AUTOPLAY ACTIVE: Fade out -> Show Overlay with Timer -> Play Next after 5s
        video.classList.add('fade-out-video');
        
        // Show Overlay
        showNextVideoOverlay(nextMovie, true); // true = autoplay

        // Timer Logic
        let count = 5;
        // Start animation immediately
        setTimeout(() => {
             const box = document.querySelector('.next-card');
             if (box) box.classList.add('animating');
        }, 50);

        nextVideoInterval = setInterval(() => {
            count--;
            updateNextTimerText(count);
            if (count <= 0) {
                clearInterval(nextVideoInterval);
                // Play Next
                hideNextVideoOverlay();
                video.classList.remove('fade-out-video');
                playMovie(currentMovieIndex + 1);
            }
        }, 1000);

        // Allow cancellation via click anywhere (handled by togglePlay check?)
        // If user clicks, isVideoEnded is checked there. logic handles restart.

    } else {
        // AUTOPLAY OFF: Fade out -> Show Static Overlay -> Open Sidebar -> Wait 2s -> Exit Fullscreen
        video.classList.add('fade-out-video');
        updatePlayIcon(false);
        // Show Replay Icon & Style
        const pIcon = document.getElementById('playIcon');
        pIcon.setAttribute('data-lucide', 'rotate-ccw');
        lucide.createIcons();
        playBtn.classList.add('is-replay');
        
        // Show Overlay (Static)
        if (nextMovie) {
            showNextVideoOverlay(nextMovie, false);
        } else {
            // End of playlist, maybe show "Finished"
             showNextVideoOverlay({ name: 'Playlist Completed' }, false, true);
        }

        // 1. Open Sidebar immediately (as requested "open sidebar dulu") via fade delay
        setTimeout(() => {
             sidebar.classList.remove('collapsed');
             scrollToActiveItem();
        }, 500); 

        // 2. Wait 2 seconds (after fade logic) -> Exit Fullscreen
        // fade logic starts at 0s. Sidebar at 0.5s. Fullscreen exit at 2s.
        setTimeout(() => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        }, 2000); 
    }
});

// =====================================================
// NEXT VIDEO OVERLAY HELPERS
// =====================================================
const nextOverlay = document.getElementById('nextVideoOverlay');
const nextTitle = document.getElementById('nextTitle');
const nextTimer = document.getElementById('nextTimer');
const nextContentBox = document.querySelector('.next-card');

function showNextVideoOverlay(movie, isAutoplay, isEnd = false) {
    if (!nextOverlay) return;
    
    nextTitle.innerText = movie.name;
    nextOverlay.classList.add('visible');
    
    const coverImg = document.getElementById('nextCoverImg');
    const fallbackDiv = document.getElementById('nextCoverFallback');

    // Populate Cover
    if (movie.coverPath) {
        coverImg.src = movie.coverPath;
        coverImg.style.display = 'block';
        fallbackDiv.style.display = 'none';
    } else {
        coverImg.style.display = 'none';
        fallbackDiv.style.display = 'flex';
    }

    if (isAutoplay) {
        nextTimer.style.display = 'block';
        nextTimer.innerText = 'Playing next video in 5s';
        nextContentBox.classList.add('has-timer');
        
        // Reset animation state
        nextContentBox.classList.remove('animating');
        
    } else {
        nextTimer.style.display = 'none';
        nextContentBox.classList.remove('has-timer');
        nextContentBox.classList.remove('animating');
        
        if (isEnd) {
             document.querySelector('.next-label').innerText = "Finished";
        } else {
             document.querySelector('.next-label').innerText = "Up Next";
        }
    }
}

function hideNextVideoOverlay() {
    if (!nextOverlay) return;
    nextOverlay.classList.remove('visible');
    nextContentBox.classList.remove('animating'); // Reset bar
    
    if (nextVideoInterval) {
        clearInterval(nextVideoInterval);
        nextVideoInterval = null;
    }
}

function updateNextTimerText(seconds) {
    if (nextTimer) nextTimer.innerText = `Playing next video in ${seconds}s`;
}

function changePlayIconToReplay() {
    // Force icon to rotate-ccw
    const icon = document.getElementById('playIcon');
    icon.setAttribute('data-lucide', 'rotate-ccw');
    lucide.createIcons();
    playBtn.title = "Replay";
}

function exitOnNetworkEnd() {
    // Default behavior if playlist ends: Open sidebar
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    sidebar.classList.remove('collapsed');
    scrollToActiveItem();
}

function scrollToActiveItem() {
    // Find active item
    const activeEl = document.querySelector('.movie-item.active');
    if (activeEl) {
        // Scroll list so item is near top but with 50px offset
        // activeEl.scrollIntoView() aligns to top edge (0px). To add offset, we use scrollTop.
        const container = document.getElementById('movieList').parentElement; // wrapper .movie-list-wrapper or #movieList itself depending on css
        // Assuming #movieList is the scrollable container or its parent? 
        // Let's check CSS structure from previous context. 
        // Structure: .movie-list-wrapper (overflow-y: auto) > .movie-list > .movie-item
        
        const wrapper = document.querySelector('.movie-list-wrapper');
        if (wrapper) {
             const itemTop = activeEl.offsetTop;
             // We want itemTop to be at 50px from wrapper top
             wrapper.scrollTo({
                 top: itemTop - 50,
                 behavior: 'smooth'
             });
        } else {
             // Fallback
             activeEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

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

// Picture-in-Picture (PiP)
const pipBtn = document.getElementById('pipBtn');
if (pipBtn) {
    pipBtn.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled && video.src) {
                await video.requestPictureInPicture();
            }
        } catch (err) {
            console.error('PiP failed:', err);
            showToast('PiP failed or not supported', 'error');
        }
    });

    video.addEventListener('enterpictureinpicture', () => {
        pipBtn.classList.add('active');
        pipBtn.innerHTML = '<i data-lucide="picture-in-picture"></i>';
        
        const playerContainer = document.getElementById('playerContainer');
        if (playerContainer) playerContainer.classList.add('pip-active');
        
        showToast('PiP Mode Active', 'info');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    });

    video.addEventListener('leavepictureinpicture', () => {
        pipBtn.classList.remove('active');
        pipBtn.innerHTML = '<i data-lucide="picture-in-picture-2"></i>';
         
        const playerContainer = document.getElementById('playerContainer');
        if (playerContainer) playerContainer.classList.remove('pip-active');
        
        if (typeof lucide !== 'undefined') lucide.createIcons();
    });
}

// Restore Button inside Placeholder
const leavePipBtn = document.getElementById('leavePipBtn');
if (leavePipBtn) {
    leavePipBtn.addEventListener('click', async () => {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        }
    });
}


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
// =====================================================
// NEXT VIDEO CARD CLICK
// =====================================================
document.querySelector('.next-card').addEventListener('click', (e) => {
    e.stopPropagation();
    // Play next video immediately
    if (currentMovieIndex < currentMovies.length - 1) {
        // Clear timer if running
        if (nextVideoInterval) clearInterval(nextVideoInterval);
        
        hideNextVideoOverlay();
        video.classList.remove('fade-out-video');
        playMovie(currentMovieIndex + 1);
    }
});

// =====================================================
// KEYBOARD SHORTCUTS
// =====================================================
document.addEventListener('keydown', (e) => {
    // Only if video is loaded or UI is active
    if (currentMovieIndex === -1 && !video.src) return;

    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    
    // Global Prevent Default for keys we handle
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.key === ' ' || e.key === 'k') {
        e.preventDefault();
    }

    switch (e.code) {
        case 'Space':
        case 'KeyK': // Support K pause
            e.stopPropagation();
            togglePlay();
            break;
        case 'ArrowLeft':
            showSkipIndicator('left');
            break;
        case 'ArrowRight':
            showSkipIndicator('right');
            break;
        case 'ArrowUp':
            video.volume = Math.min(1, video.volume + 0.1);
            volumeSlider.value = video.volume;
            updateVolumeIcon(video.volume);
            updateVolumeSliderStyle(video.volume);
            break;
        case 'ArrowDown':
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
    
    // Also handle ' ' key explicitly if not caught by code 'Space'
    if (e.key === ' ' && e.code !== 'Space') {
         e.stopPropagation();
         togglePlay();
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
    
    // RESET ENDED STATE ON SEEK
    if (isVideoEnded) {
        isVideoEnded = false;
        video.classList.remove('fade-out-video');
        hideNextVideoOverlay();
        // Automatically play when seeking back from end
        video.play().catch(e => console.warn("Auto-play on seek failed", e));
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



// Keyboard listener merged above


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

// Toast Notification Helper
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Logic Icon
    let iconName = 'info';
    if (type === 'error') iconName = 'alert-circle';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    
    toast.innerHTML = `<i data-lucide="${iconName}"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    
    // Animate In
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });
    
    // Auto Remove
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 350);
    }, duration);
}

// =====================================================
// SETTINGS & REPAIR LOGIC
// =====================================================
const settingsBtn = document.getElementById('settingsBtn');
const settingsMenu = document.getElementById('settingsMenu');
const repairModal = document.getElementById('repairModal');
const cancelRepairBtn = document.getElementById('cancelRepair');
const confirmRepairBtn = document.getElementById('confirmRepair');

// Toggle Settings Menu
if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('visible');
    });
}

// AUTOPLAY MENU LOGIC
document.querySelectorAll('[data-autoplay]').forEach(opt => {
    opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = opt.dataset.autoplay; // 'never' or 'always'
        autoplayNext = (mode === 'always');
        
        sessionStorage.setItem('autoplayNext', autoplayNext);
        
        // Update UI active state
        document.querySelectorAll('[data-autoplay]').forEach(el => el.classList.remove('active'));
        opt.classList.add('active');
        
        // Close menu
        settingsMenu.classList.remove('visible');
    });
});

// Initialize UI based on state
const autoplayMode = autoplayNext ? 'always' : 'never';
const activeAutoplayOpt = document.querySelector(`[data-autoplay="${autoplayMode}"]`);
if (activeAutoplayOpt) activeAutoplayOpt.classList.add('active');

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (settingsMenu && settingsMenu.classList.contains('visible') && !settingsMenu.contains(e.target) && e.target !== settingsBtn) {
        settingsMenu.classList.remove('visible');
    }
});

// Playback Speed Logic
document.querySelectorAll('.speed-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(opt.dataset.speed);
        
        if (video) {
            video.playbackRate = speed;
            
            // Update UI
            document.querySelectorAll('.speed-opt').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            // Close menu
            settingsMenu.classList.remove('visible');
        }
    });
});

// =====================================================
// RESUME PLAYBACK LOGIC
// =====================================================
const resumeSubmenu = document.getElementById('resumeSubmenu');

// Load settings
window.api.invoke('get-config').then(config => {
    if (config.resumeMode) {
        resumeMode = config.resumeMode;
        updateResumeMenuState();
    }
});

if (resumeSubmenu) {
    resumeSubmenu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = item.getAttribute('data-resume');
            if (mode) {
                resumeMode = mode;
                window.api.invoke('set-config', { key: 'resumeMode', value: mode });
                updateResumeMenuState();
                
                const labels = { always: 'Autoplay', never: 'Never', ask: 'Ask Everytime' };
                showToast(`Resume Mode: ${labels[mode]}`, 'success');
                
                settingsMenu.classList.remove('visible');
            }
        });
    });
}

function updateResumeMenuState() {
    if (!resumeSubmenu) return;
    resumeSubmenu.querySelectorAll('.menu-item').forEach(el => {
        const mode = el.getAttribute('data-resume');
        el.classList.toggle('active', mode === resumeMode);
    });
}

// =====================================================
// AUTOPLAY NEXT LOGIC
// =====================================================
const autoplaySubmenu = document.getElementById('autoplaySubmenu');

// Initialize State
// is set at top level: let autoplayNext = sessionStorage.getItem('autoplayNext') === 'true';
// Update UI initially
updateAutoplayMenuState();

if (autoplaySubmenu) {
    autoplaySubmenu.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const valStr = item.getAttribute('data-autoplay');
            if (valStr) {
                const newState = (valStr === 'true');
                autoplayNext = newState;
                // Save to SessionStorage (clears on browser close, persists on refresh)
                sessionStorage.setItem('autoplayNext', newState);
                
                updateAutoplayMenuState();
                
                const label = newState ? 'Autoplay' : 'Never';
                showToast(`Autoplay Next: ${label}`, 'success');
                
                settingsMenu.classList.remove('visible');
            }
        });
    });
}

function updateAutoplayMenuState() {
    if (!autoplaySubmenu) return;
    autoplaySubmenu.querySelectorAll('.menu-item').forEach(el => {
        const valStr = el.getAttribute('data-autoplay');
        const boolVal = (valStr === 'true');
        el.classList.toggle('active', boolVal === autoplayNext);
    });
}

// Resume Modal
const resumeModal = document.getElementById('resumeModal');
const confirmResumeBtn = document.getElementById('confirmResume');
const cancelResumeBtn = document.getElementById('cancelResume');
let pendingResumeTime = 0;

function showResumeModal(time) {
    pendingResumeTime = time;
    document.getElementById('resumeTimeDisplay').textContent = `at ${formatTime(time)}`;
    setTimeout(() => resumeModal.classList.add('visible'), 100);
}

if (confirmResumeBtn) {
    confirmResumeBtn.addEventListener('click', () => {
        resumeModal.classList.remove('visible');
        video.currentTime = pendingResumeTime;
        video.play();
        updatePlayIcon(true);
    });
}

if (cancelResumeBtn) {
    cancelResumeBtn.addEventListener('click', () => {
        resumeModal.classList.remove('visible');
        video.currentTime = 0;
        video.play();
        updatePlayIcon(true);
        // User chose to restart, so clear history? Or keep it?
        // Usually restart implies forgetting previous session for now.
        if (currentMovieIndex !== -1) {
            window.api.invoke('clear-progress', currentMovies[currentMovieIndex].videoPath);
        }
    });
}

// Repair Video Logic
let currentRepairMode = 'remerge'; // 'remerge' | 'reencode'

const menuRemerge = document.getElementById('menuRemerge');
const menuReEncode = document.getElementById('menuReEncode');
const menuFpsRepair = document.getElementById('menuFpsRepair');

function openRepairModal(mode) {
    settingsMenu.classList.remove('visible');
    
    if (currentMovieIndex === -1) {
        showToast("Please select a video to repair first", 'warning');
        return;
    }
    
    currentRepairMode = mode;
    
    const titleEl = repairModal.querySelector('.modal-title');
    const descEl = repairModal.querySelector('.modal-desc');
    const confirmBtn = document.getElementById('confirmRepair');
    
    if (mode === 'remerge') {
        titleEl.textContent = 'Remerge Video (Fast)';
        descEl.innerHTML = 'Fixes seeking lag by optimizing index structure (moov atom).<br>Lossless, very fast (few seconds).';
        confirmBtn.textContent = 'Start Remerge';
    } else if (mode === 'fps') {
        titleEl.textContent = 'Fix FPS / Timestamp (VFR)';
        descEl.innerHTML = 'Forces Constant Frame Rate (CFR) and realigns timestamps.<br><b>Fixes "jumpy" seeking (skip 10s becoming 20s).</b>';
        confirmBtn.textContent = 'Start FPS Fix';
    } else {
        titleEl.textContent = 'Re-encode Video (Deep)';
        descEl.innerHTML = 'Fixes severe lag by restructuring keyframes (GOP).<br><b>Note: Takes longer (1-3 mins)</b> but guarantees smooth seeking.';
        confirmBtn.textContent = 'Start Re-encode';
    }
    
    repairModal.classList.add('visible');
}

if (menuRemerge) menuRemerge.addEventListener('click', () => openRepairModal('remerge'));
if (menuReEncode) menuReEncode.addEventListener('click', () => openRepairModal('reencode'));
if (menuFpsRepair) menuFpsRepair.addEventListener('click', () => openRepairModal('fps'));

if (cancelRepairBtn) {
    cancelRepairBtn.addEventListener('click', () => {
        repairModal.classList.remove('visible');
    });
}

if (confirmRepairBtn) {
    confirmRepairBtn.addEventListener('click', async () => {
        repairModal.classList.remove('visible');
        
        if (currentMovieIndex === -1) return;
        const movie = currentMovies[currentMovieIndex];
        
        // Capture State
        let wasPlaying = !video.paused;
        let savedTime = video.currentTime;
        console.log(`[REPAIR] Snapshot: Time=${savedTime}, Playing=${wasPlaying}, Mode=${currentRepairMode}`);
        
        // UNLOAD VIDEO TO RELEASE LOCK
        video.pause();
        video.removeAttribute('src');
        video.load();
        
        // Show Generating Loader
        let actionName = 'Processing';
        if (currentRepairMode === 'remerge') actionName = 'Remerging';
        else if (currentRepairMode === 'reencode') actionName = 'Re-encoding';
        else if (currentRepairMode === 'fps') actionName = 'Fixing FPS';
        
        showGeneratingLoader(0, 1, `${actionName}: ${movie.name}`);
        
        try {
            // Invoke Repair based on mode
            let channel = 'repair-video';
            if (currentRepairMode === 'reencode') channel = 'reencode-video';
            if (currentRepairMode === 'fps') channel = 'fps-repair';
            
            const newPath = await window.api.invoke(channel, movie.videoPath);
            
            // On Success
            console.log(`[REPAIR] Completed. New path: ${newPath}`);
            
            // Update State with New Path
            movie.videoPath = newPath;
            currentMovies[currentMovieIndex].videoPath = newPath;
            
            // Hide Loader
            const loader = document.getElementById('generationLoader');
             if (loader) {
                loader.classList.add('hiding');
                loader.classList.remove('visible');
                setTimeout(() => loader.classList.remove('hiding'), 400);
            }
            
            // Show Success Toast
            showToast(`${actionName} Complete`, 'success');
            
            // Reload Video Source
            const newSrc = `file://${newPath}?t=${Date.now()}`;
            const currentRate = video.playbackRate;
            
            video.src = newSrc;
            video.playbackRate = currentRate;
            
            // Restore Timestamp (-2s safety)
            video.addEventListener('loadedmetadata', () => {
                const seekTime = Math.max(0, savedTime - 2);
                video.currentTime = seekTime;
                if (wasPlaying) {
                    video.play().catch(e => console.error("Resume failed:", e));
                    // Update UI icon
                    const playIcon = document.getElementById('playIcon');
                    if (playIcon && typeof lucide !== 'undefined') {
                        playIcon.setAttribute('data-lucide', 'pause');
                        lucide.createIcons();
                    }
                }
            }, { once: true });

        } catch (err) {
            console.error('[REPAIR] Failed:', err);
             
             // Hide loader
             const loader = document.getElementById('generationLoader');
             if (loader) loader.classList.remove('visible');

             // Show Error Toast
             showToast(`${actionName} Failed: ` + (err.message || 'Unknown error'), 'error');
             
             // RESTORE VIDEO IF FAILED
             const oldSrc = `file://${movie.videoPath}?t=${Date.now()}`;
             video.src = oldSrc;
             video.currentTime = savedTime; 
        }
    });
}
