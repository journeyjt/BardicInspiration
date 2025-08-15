/**
 * YouTube DJ Application - Synced YouTube Player for FoundryVTT
 * MVP-U1: Single client YouTube player integration
 */

interface YouTubeDJData {
  currentVideoId: string | null;
  currentVideoTitle: string;
  isPlayerReady: boolean;
  hasAutoplayConsent: boolean;
  isDJ: boolean;
  playerState: string;
}

export class YouTubeDJApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  
  private youtubePlayer: any = null;
  private autoplayConsent: boolean = false;
  private playerReady: boolean = false;
  private isRecreating: boolean = false;
  private containerObserver: MutationObserver | null = null;
  
  // Configuration for development vs production
  private get isDevelopment(): boolean {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1' ||
           window.location.hostname.includes('localhost');
  }
  
  private get youtubeProtocol(): string {
    // Always use HTTPS for YouTube API to match their requirements
    return 'https';
  }
  
  constructor(options = {}) {
    super(options);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'bardic-inspiration-youtube-dj',
      window: {
        title: 'YouTube DJ - Synced Player',
        minimizable: true,
        resizable: true
      },
      position: {
        width: 600,
        height: 500
      },
      classes: ['bardic-inspiration', 'youtube-dj']
    });
  }

  static get PARTS() {
    return {
      main: {
        template: 'modules/bardic-inspiration/templates/youtube-dj.hbs'
      }
    };
  }

  /** @override */
  async _prepareContext(options: any): Promise<YouTubeDJData> {
    return {
      currentVideoId: null,
      currentVideoTitle: 'No video loaded',
      isPlayerReady: this.playerReady,
      hasAutoplayConsent: this.autoplayConsent,
      isDJ: true, // MVP: Single user is always DJ
      playerState: this.playerReady ? 'Ready' : 'Initializing...'
    };
  }
  
  /** @override */
  async render(options: any = {}): Promise<this> {
    // Prevent unnecessary re-renders if player is working, unless forced
    if (this.youtubePlayer && this.playerReady && !options.force) {
      console.log('🎵 YouTube DJ | Skipping render to preserve player');
      return this;
    }
    
    console.log('🎵 YouTube DJ | Allowing render', { 
      hasPlayer: !!this.youtubePlayer, 
      isReady: this.playerReady, 
      force: options.force 
    });
    
    return super.render(options);
  }

  /** @override */
  _onRender(context: YouTubeDJData, options: any): void {
    const html = this.element;
    
    console.log('🎵 YouTube DJ | _onRender called, checking for existing player...');
    
    // Check if we have an existing player that needs protection
    const existingContainer = html.querySelector('#youtube-player-container');
    let existingIframe = existingContainer?.querySelector('#youtube-player') as HTMLIFrameElement;
    
    if (existingIframe && this.youtubePlayer) {
      console.log('🎵 YouTube DJ | Found existing iframe, protecting from re-render');
      
      // Detach the iframe temporarily to prevent it from being destroyed
      const parent = existingIframe.parentNode;
      parent?.removeChild(existingIframe);
      
      // Store reference
      const savedIframe = existingIframe;
      
      // Wait for template to finish rendering, then restore
      setTimeout(() => {
        const newContainer = this.element.querySelector('#youtube-player-container');
        if (newContainer) {
          // Clear any placeholder content and restore our iframe
          newContainer.innerHTML = '';
          newContainer.appendChild(savedIframe);
          console.log('🎵 YouTube DJ | Successfully restored existing iframe after re-render');
        } else {
          console.error('🎵 YouTube DJ | Container disappeared during re-render!');
        }
      }, 0);
    }
    
    // Initialize YouTube player if not already done
    if (!this.youtubePlayer) {
      console.log('🎵 YouTube DJ | No existing player, initializing new one');
      this._initializeYouTubePlayer();
    }
    
    // Event listeners
    html.querySelector('.youtube-url-input')?.addEventListener('keypress', this._onUrlInputKeypress.bind(this));
    html.querySelector('.load-video-btn')?.addEventListener('click', this._onLoadVideoClick.bind(this));
    html.querySelector('.play-btn')?.addEventListener('click', this._onPlayClick.bind(this));
    html.querySelector('.pause-btn')?.addEventListener('click', this._onPauseClick.bind(this));
    html.querySelector('.enable-autoplay-btn')?.addEventListener('click', this._onEnableAutoplayClick.bind(this));
    html.querySelector('.recreate-player-btn')?.addEventListener('click', this._onRecreatePlayerClick.bind(this));
    html.querySelector('.close-btn')?.addEventListener('click', this._onCloseClick.bind(this));
  }

  /**
   * Initialize YouTube Player using proper API (now that render issues are fixed)
   */
  private _initializeYouTubePlayer(): void {
    // Load YouTube IFrame Player API if not already loaded
    if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
      console.log('🎵 YouTube DJ | Loading YouTube API for full programmatic control');
      this._loadYouTubeAPI();
      return;
    }

    console.log('🎵 YouTube DJ | Using YouTube API with render protection');
    
    const playerContainer = this.element.querySelector('#youtube-player-container');
    if (!playerContainer) {
      console.warn('YouTube player container not found');
      return;
    }

    // Clean up any existing player first
    if (this.youtubePlayer) {
      try {
        this.youtubePlayer.destroy();
      } catch (e) {
        console.log('🎵 YouTube DJ | Old player cleanup (expected)');
      }
      this.youtubePlayer = null;
    }

    // Clear container and create fresh player div
    playerContainer.innerHTML = '';
    const playerDiv = document.createElement('div');
    playerDiv.id = 'youtube-player';
    playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; background: #333; border: 1px solid #666;';
    playerContainer.appendChild(playerDiv);
    
    console.log('🎵 YouTube DJ | Player div created for YouTube API');

    // Wait a moment for DOM to settle before creating player
    setTimeout(() => {
      const finalPlayerDiv = this.element.querySelector('#youtube-player');
      if (!finalPlayerDiv) {
        console.error('🎵 YouTube DJ | Player div disappeared before initialization');
        return;
      }

      // Initialize the YouTube player with proper API
      // For development, let YouTube handle protocol automatically
      console.log(`🎵 YouTube DJ | Creating YouTube API player - Origin: ${window.location.origin}`);
      
      this.youtubePlayer = new YT.Player('youtube-player', {
        height: '315',
        width: '560',
        videoId: 'M7lc1UVf-VE', // Default video to initialize player
        playerVars: {
          'playsinline': 1,
          'controls': 1,
          'rel': 0,
          'modestbranding': 1,
          'autoplay': 0,
          'mute': 1,
          'enablejsapi': 1
          // Don't set origin parameter to avoid protocol mismatch
        },
        events: {
          'onReady': this._onPlayerReady.bind(this),
          'onStateChange': this._onPlayerStateChange.bind(this),
          'onError': this._onPlayerError.bind(this)
        }
      });

      console.log('🎵 YouTube DJ | YouTube API player initialized');
    }, 100);
  }
  
  /**
   * Build YouTube embed URL with proper parameters
   */
  private _buildYouTubeEmbedUrl(videoId: string, enableApi: boolean = true): string {
    const protocol = this.youtubeProtocol;
    const baseUrl = `${protocol}://www.youtube.com/embed/${videoId}`;
    
    const params = new URLSearchParams({
      'origin': window.location.origin,
      'enablejsapi': enableApi ? '1' : '0', // Enable JS API for programmatic control
      'controls': '1',
      'rel': '0',
      'modestbranding': '1',
      'autoplay': '0'
    });
    
    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Load YouTube IFrame Player API
   */
  private _loadYouTubeAPI(): void {
    // Check if API is already loading
    if ((window as any).youtubeAPILoading) {
      return;
    }

    (window as any).youtubeAPILoading = true;

    // Create script tag for YouTube API
    const script = document.createElement('script');
    const apiUrl = `${this.youtubeProtocol}://www.youtube.com/iframe_api`;
    
    script.src = apiUrl;
    script.async = true;

    console.log(`🎵 YouTube DJ | Loading YouTube API from: ${apiUrl} (${this.isDevelopment ? 'DEV' : 'PROD'} mode)`);

    // Set up the callback for when API loads
    (window as any).onYouTubeIframeAPIReady = () => {
      console.log('🎵 YouTube DJ | YouTube API loaded');
      this._initializeYouTubePlayer();
      (window as any).youtubeAPILoading = false;
    };

    script.onerror = () => {
      console.error(`🎵 YouTube DJ | Failed to load YouTube API from ${apiUrl}`);
      // In development, if HTTP fails, try HTTPS fallback
      if (this.isDevelopment && script.src.startsWith('http://')) {
        console.warn('🎵 YouTube DJ | HTTP API failed in dev mode, falling back to HTTPS');
        const httpsScript = document.createElement('script');
        httpsScript.src = 'https://www.youtube.com/iframe_api';
        httpsScript.async = true;
        httpsScript.onload = (window as any).onYouTubeIframeAPIReady;
        httpsScript.onerror = () => {
          console.error('🎵 YouTube DJ | Both HTTP and HTTPS API loading failed');
          ui.notifications?.error('Failed to load YouTube API. Check your internet connection.');
          (window as any).youtubeAPILoading = false;
        };
        document.head.appendChild(httpsScript);
      } else {
        ui.notifications?.error('Failed to load YouTube API. Check your internet connection.');
        (window as any).youtubeAPILoading = false;
      }
    };

    document.head.appendChild(script);
  }

  /**
   * YouTube player ready callback
   */
  private _onPlayerReady(event: any): void {
    console.log('🎵 YouTube DJ | YouTube API player ready');
    console.log('🎵 YouTube DJ | Player element exists:', !!this.element.querySelector('#youtube-player'));
    
    // Check if iframe was created this time
    const iframe = this.element.querySelector('#youtube-player iframe');
    console.log('🎵 YouTube DJ | Player iframe exists:', !!iframe);
    
    if (iframe) {
      console.log('🎵 YouTube DJ | SUCCESS! YouTube API created persistent iframe');
    } else {
      console.warn('🎵 YouTube DJ | YouTube API ready but no iframe detected');
    }
    
    this.playerReady = true;
    console.log('🎵 YouTube DJ | Player marked as ready with full API control');
    
    // Update UI elements without full re-render to preserve player
    this._updatePlayerStatusUI();
    ui.notifications?.info('YouTube player ready! Full programmatic control available.');
    
    // Set up DOM protection for the player container
    this._setupContainerProtection();
  }
  
  /**
   * Debug iframe lifecycle to see why it disappears
   */
  private _debugIframeLifecycle(): void {
    const playerDiv = this.element.querySelector('#youtube-player');
    if (!playerDiv) {
      console.error('🎵 YouTube DJ | No player div found during iframe debug');
      return;
    }
    
    console.log('🎵 YouTube DJ | Starting iframe lifecycle debugging...');
    
    // Check current state
    const currentIframes = playerDiv.querySelectorAll('iframe');
    console.log(`🎵 YouTube DJ | Current iframes in player div: ${currentIframes.length}`);
    currentIframes.forEach((iframe, index) => {
      console.log(`🎵 YouTube DJ | Iframe ${index}:`, {
        src: iframe.src,
        width: iframe.width,
        height: iframe.height,
        style: iframe.style.cssText,
        id: iframe.id
      });
    });
    
    // Monitor for changes every 100ms for 10 seconds
    let checkCount = 0;
    const maxChecks = 100; // 10 seconds
    
    const monitorInterval = setInterval(() => {
      checkCount++;
      const newIframes = playerDiv.querySelectorAll('iframe');
      
      if (newIframes.length !== currentIframes.length) {
        console.log(`🎵 YouTube DJ | [${checkCount * 100}ms] Iframe count changed: ${currentIframes.length} -> ${newIframes.length}`);
        
        if (newIframes.length === 0) {
          console.error('🎵 YouTube DJ | ALL IFRAMES DISAPPEARED!');
          console.error('🎵 YouTube DJ | Player div content:', playerDiv.innerHTML);
          console.trace('🎵 YouTube DJ | Iframe disappearance stack trace');
        }
      }
      
      // Check if iframes are visible
      newIframes.forEach((iframe, index) => {
        const rect = iframe.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;
        if (!isVisible && checkCount % 10 === 0) { // Log every second
          console.warn(`🎵 YouTube DJ | [${checkCount * 100}ms] Iframe ${index} not visible:`, {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            display: getComputedStyle(iframe).display,
            visibility: getComputedStyle(iframe).visibility
          });
        }
      });
      
      if (checkCount >= maxChecks) {
        console.log('🎵 YouTube DJ | Iframe lifecycle monitoring complete');
        clearInterval(monitorInterval);
      }
    }, 100);
  }

  /**
   * Set up DOM protection for the player container
   */
  private _setupContainerProtection(): void {
    const container = this.element.querySelector('#youtube-player-container');
    if (!container) return;
    
    // Make container immutable to prevent external modifications
    this._lockContainerDOM(container);
    
    // Set up mutation observer to detect when container content is modified
    this.containerObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Check for any removals
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.id === 'youtube-player' || element.querySelector('#youtube-player')) {
                console.error('🎵 YouTube DJ | YouTube player was REMOVED from DOM!');
                console.error('🎵 YouTube DJ | Removed by:', mutation.target);
                console.trace('🎵 YouTube DJ | Removal stack trace');
                
                // Immediately restore
                this._emergencyRestorePlayer(container);
              }
            }
          });
          
          // Also check if player just disappeared
          const hasPlayer = container.querySelector('#youtube-player');
          const hasIframe = container.querySelector('#youtube-player iframe');
          
          if (!hasPlayer && this.youtubePlayer && this.playerReady) {
            console.warn('🎵 YouTube DJ | Player disappeared, emergency restore...');
            this._emergencyRestorePlayer(container);
          }
        }
      });
    });
    
    // Observe changes to container children with aggressive settings
    this.containerObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true
    });
    
    console.log('🎵 YouTube DJ | Aggressive container protection enabled');
  }
  
  /**
   * Lock container DOM to prevent external modifications
   */
  private _lockContainerDOM(container: Element): void {
    // Override innerHTML setter to prevent clearing
    const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (originalInnerHTML) {
      Object.defineProperty(container, 'innerHTML', {
        get: originalInnerHTML.get,
        set: function(value: string) {
          // Only allow setting if it contains our player or is empty initialization
          if (value.includes('youtube-player') || value.includes('<!-- YouTube player will be inserted here -->')) {
            console.log('🎵 YouTube DJ | Allowing innerHTML change:', value.substring(0, 50) + '...');
            originalInnerHTML.set?.call(this, value);
          } else {
            console.warn('🎵 YouTube DJ | BLOCKED innerHTML change that would remove player:', value.substring(0, 50) + '...');
          }
        }
      });
    }
    
    // Override removeChild to prevent player removal
    const originalRemoveChild = container.removeChild;
    container.removeChild = function(child: Node) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (element.id === 'youtube-player' || element.querySelector('#youtube-player')) {
          console.error('🎵 YouTube DJ | BLOCKED attempt to remove YouTube player!');
          console.trace('🎵 YouTube DJ | Removal attempt stack trace');
          return child; // Pretend we removed it but don't actually do it
        }
      }
      return originalRemoveChild.call(this, child);
    };
    
    console.log('🎵 YouTube DJ | Container DOM locked against modifications');
  }
  
  /**
   * Emergency restore of player when it disappears
   */
  private _emergencyRestorePlayer(container: Element): void {
    if (this.isRecreating) return;
    
    console.log('🎵 YouTube DJ | Emergency restore in progress...');
    
    // Find or create player div
    let playerDiv = container.querySelector('#youtube-player');
    if (!playerDiv) {
      playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-player';
      playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; position: relative; z-index: 1; background: black; border: 2px solid red;';
      container.appendChild(playerDiv);
      console.log('🎵 YouTube DJ | Created emergency player div');
    }
    
    // Try to restore YouTube functionality
    if (this.youtubePlayer) {
      try {
        const state = this.youtubePlayer.getPlayerState();
        console.log(`🎵 YouTube DJ | Player object still exists, state: ${state}`);
      } catch (error) {
        console.log('🎵 YouTube DJ | Player object lost, flagging for recreation');
        this.playerReady = false;
        this.youtubePlayer = null;
      }
    }
  }
  
  /**
   * Restore player to container if it was removed
   */
  private _restorePlayerToContainer(): void {
    const container = this.element.querySelector('#youtube-player-container');
    if (!container) return;
    
    // Create player div if missing
    let playerDiv = container.querySelector('#youtube-player');
    if (!playerDiv && this.youtubePlayer) {
      console.log('🎵 YouTube DJ | Recreating player div after external removal');
      playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-player';
      playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; position: relative; z-index: 1;';
      container.appendChild(playerDiv);
      
      // The YouTube player object might still be valid, so we may not need to recreate it
      try {
        const state = this.youtubePlayer.getPlayerState();
        console.log(`🎵 YouTube DJ | Existing player still functional, state: ${state}`);
      } catch (error) {
        console.log('🎵 YouTube DJ | Player object lost, will need recreation');
        this._recreatePlayer();
      }
    }
  }

  /**
   * Monitor player element to detect if it disappears
   */
  private _startPlayerMonitoring(): void {
    // Add flag to prevent recreation loops
    if (this.isRecreating) {
      console.log('🎵 YouTube DJ | Already recreating, skipping monitor');
      return;
    }
    
    let consecutiveFailures = 0;
    const maxFailures = 3;
    
    const monitor = setInterval(() => {
      // Only check if player element exists - iframe might load asynchronously
      const playerElement = this.element.querySelector('#youtube-player');
      
      if (!playerElement) {
        consecutiveFailures++;
        console.warn(`🎵 YouTube DJ | Player element missing (${consecutiveFailures}/${maxFailures})`);
        
        if (consecutiveFailures >= maxFailures) {
          console.error('🎵 YouTube DJ | Player element disappeared persistently!');
          clearInterval(monitor);
          // Only recreate if we're not already recreating
          if (!this.isRecreating) {
            this._recreatePlayer();
          }
        }
      } else {
        // Reset failure counter if element exists
        consecutiveFailures = 0;
      }
    }, 2000); // Check every 2 seconds instead of 1
    
    // Stop monitoring after 30 seconds
    setTimeout(() => clearInterval(monitor), 30000);
  }

  /**
   * Recreate the YouTube player if it disappears
   */
  private _recreatePlayer(): void {
    if (this.isRecreating) {
      console.log('🎵 YouTube DJ | Already recreating, ignoring duplicate request');
      return;
    }
    
    console.log('🎵 YouTube DJ | Attempting to recreate player...');
    this.isRecreating = true;
    this.playerReady = false;
    this.youtubePlayer = null;
    
    // Clear the container
    const container = this.element.querySelector('#youtube-player-container');
    if (container) {
      container.innerHTML = '<!-- YouTube player will be inserted here -->';
    }
    
    // Reinitialize after a delay
    setTimeout(() => {
      this._initializeYouTubePlayer();
      // Reset flag after initialization
      setTimeout(() => {
        this.isRecreating = false;
      }, 2000);
    }, 1000);
  }

  /**
   * Verify player is properly attached to DOM
   */
  private _verifyPlayerAttachment(): boolean {
    try {
      if (!this.youtubePlayer) {
        console.warn('🎵 YouTube DJ | No player object');
        return false;
      }
      
      // Primary check: can we call the YouTube API?
      const state = this.youtubePlayer.getPlayerState();
      console.log(`🎵 YouTube DJ | Player API working, state: ${state}`);
      
      // If API works, player is functional - ignore DOM warnings
      return true;
    } catch (error) {
      console.warn('🎵 YouTube DJ | Player API failed:', error);
      return false;
    }
  }

  /**
   * YouTube player state change callback
   */
  private _onPlayerStateChange(event: any): void {
    const states = ['ended', 'playing', 'paused', 'buffering', 'cued'];
    const stateName = states[event.data + 1] || 'unknown';
    console.log(`🎵 YouTube DJ | Player state: ${stateName}`);
    
    // Update UI if needed
    this._updatePlayerStatus();
  }

  /**
   * YouTube player error callback
   */
  private _onPlayerError(event: any): void {
    const errorMessages = {
      2: 'Invalid video ID',
      5: 'HTML5 player error',
      100: 'Video not found or private',
      101: 'Video not allowed in embedded players',
      150: 'Video not allowed in embedded players'
    };
    
    const message = errorMessages[event.data] || `Unknown error: ${event.data}`;
    console.error('🎵 YouTube DJ | Player error:', message);
    
    // For initialization errors, don't show notification (expected for default video)
    if (event.data !== 101 && event.data !== 150) {
      ui.notifications?.error(`YouTube Error: ${message}`);
    } else {
      console.log('🎵 YouTube DJ | Embedded player restriction (expected for default video)');
    }
  }

  /**
   * Extract YouTube video ID from URL
   */
  private _extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Handle URL input keypress (Enter to load)
   */
  private _onUrlInputKeypress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this._onLoadVideoClick();
    }
  }

  /**
   * Handle load video button click
   */
  private _onLoadVideoClick(): void {
    const input = this.element.querySelector('.youtube-url-input') as HTMLInputElement;
    if (!input || !input.value.trim()) {
      ui.notifications?.warn('Please enter a YouTube URL or video ID');
      return;
    }

    const videoId = this._extractVideoId(input.value.trim());
    if (!videoId) {
      ui.notifications?.error('Invalid YouTube URL or video ID');
      return;
    }

    if (!this.playerReady || !this.youtubePlayer) {
      ui.notifications?.error('YouTube player not ready');
      return;
    }

    // Verify player is actually ready before loading
    if (!this._verifyPlayerAttachment()) {
      ui.notifications?.error('YouTube player not properly attached. Please wait and try again.');
      return;
    }

    console.log(`🎵 YouTube DJ | Loading video: ${videoId}`);
    
    // Add a small delay before the API call to let any pending operations finish
    setTimeout(() => {
      this._attemptVideoLoad(videoId, input, 0);
    }, 100);
  }
  
  /**
   * Attempt to load video using YouTube API
   */
  private _attemptVideoLoad(videoId: string, input: HTMLInputElement, retryCount: number): void {
    const maxRetries = 3;
    
    try {
      // Check if player is ready
      if (!this.youtubePlayer || !this.playerReady) {
        if (retryCount < maxRetries) {
          console.log(`🎵 YouTube DJ | Player not ready, retry ${retryCount + 1}/${maxRetries}`);
          setTimeout(() => {
            this._attemptVideoLoad(videoId, input, retryCount + 1);
          }, 1000);
          return;
        } else {
          ui.notifications?.error('Player not ready after retries');
          return;
        }
      }
      
      // Use YouTube API to load video
      this.youtubePlayer.loadVideoById(videoId);
      input.value = ''; // Clear input
      ui.notifications?.info(`Loading video: ${videoId}`);
      console.log(`🎵 YouTube DJ | Successfully loaded video via API: ${videoId}`);
      
    } catch (error) {
      console.error('🎵 YouTube DJ | Error loading video:', error);
      
      if (retryCount < maxRetries) {
        console.log(`🎵 YouTube DJ | Load failed, retry ${retryCount + 1}/${maxRetries}`);
        setTimeout(() => {
          this._attemptVideoLoad(videoId, input, retryCount + 1);
        }, 1000);
      } else {
        ui.notifications?.error('Failed to load video after multiple attempts.');
      }
    }
  }

  /**
   * Handle play button click
   */
  private _onPlayClick(): void {
    if (!this.autoplayConsent) {
      ui.notifications?.warn('Please enable autoplay first');
      return;
    }

    if (!this.playerReady || !this.youtubePlayer) {
      ui.notifications?.error('YouTube player not ready');
      return;
    }

    try {
      this.youtubePlayer.playVideo();
      console.log('🎵 YouTube DJ | Play command sent via API');
    } catch (error) {
      console.error('🎵 YouTube DJ | Error playing video:', error);
      ui.notifications?.error('Failed to play video. Try again in a moment.');
    }
  }

  /**
   * Handle pause button click
   */
  private _onPauseClick(): void {
    if (!this.playerReady || !this.youtubePlayer) {
      ui.notifications?.error('YouTube player not ready');
      return;
    }

    try {
      this.youtubePlayer.pauseVideo();
      console.log('🎵 YouTube DJ | Pause command sent via API');
    } catch (error) {
      console.error('🎵 YouTube DJ | Error pausing video:', error);
      ui.notifications?.error('Failed to pause video. Try again in a moment.');
    }
  }

  /**
   * Handle enable autoplay button click
   */
  private _onEnableAutoplayClick(): void {
    if (!this.playerReady || !this.youtubePlayer) {
      ui.notifications?.error('YouTube player not ready');
      return;
    }

    // This requires a user gesture to enable autoplay
    try {
      // For autoplay consent, we just need the user to click
      // Modern browsers require explicit user interaction
      this.autoplayConsent = true;
      
      // Update UI without destroying the player
      this._hideAutoplayConsentUI();
      ui.notifications?.info('Autoplay consent granted! You can now play videos with sound.');
      
      console.log('🎵 YouTube DJ | Autoplay consent granted by user interaction');
    } catch (error) {
      console.error('🎵 YouTube DJ | Autoplay enable failed:', error);
      ui.notifications?.error('Failed to enable autoplay consent.');
    }
  }

  /**
   * Handle recreate player button click
   */
  private _onRecreatePlayerClick(): void {
    ui.notifications?.info('Recreating YouTube player...');
    this._recreatePlayer();
  }

  /**
   * Handle close button click
   */
  private _onCloseClick(): void {
    this.close();
  }
  
  /** @override */
  close(options?: any): Promise<void> {
    // Clean up mutation observer
    if (this.containerObserver) {
      this.containerObserver.disconnect();
      this.containerObserver = null;
      console.log('🎵 YouTube DJ | Container protection disabled');
    }
    
    // Clean up YouTube player
    if (this.youtubePlayer) {
      try {
        this.youtubePlayer.destroy();
        console.log('🎵 YouTube DJ | YouTube player destroyed');
      } catch (error) {
        console.log('🎵 YouTube DJ | Player cleanup error (expected)');
      }
      this.youtubePlayer = null;
    }
    
    return super.close(options);
  }

  /**
   * Update player status UI without full re-render
   */
  private _updatePlayerStatusUI(): void {
    // Update player ready status
    const playerStatusElement = this.element.querySelector('.player-status');
    if (playerStatusElement) {
      playerStatusElement.textContent = this.playerReady ? 'Ready' : 'Initializing...';
    }
    
    // Update current video title if we can get it
    const videoTitleElement = this.element.querySelector('.current-video-title');
    if (videoTitleElement && this.youtubePlayer && this.playerReady) {
      try {
        // Try to get video data, but don't fail if it's not available
        const videoData = this.youtubePlayer.getVideoData();
        if (videoData && videoData.title) {
          videoTitleElement.textContent = videoData.title;
        }
      } catch (error) {
        // Video data might not be available yet, that's OK
        console.log('🎵 YouTube DJ | Video data not yet available');
      }
    }
    
    console.log('🎵 YouTube DJ | UI status updated without re-render');
  }

  /**
   * Hide autoplay consent UI without re-rendering
   */
  private _hideAutoplayConsentUI(): void {
    const consentSection = this.element.querySelector('.autoplay-consent');
    if (consentSection) {
      consentSection.style.display = 'none';
      console.log('🎵 YouTube DJ | Autoplay consent UI hidden without re-render');
    }
  }

  /**
   * Update player status display
   */
  private _updatePlayerStatus(): void {
    const statusElement = this.element.querySelector('.player-status');
    if (statusElement && this.youtubePlayer) {
      const state = this.youtubePlayer.getPlayerState();
      const states = {
        '-1': 'Unstarted',
        '0': 'Ended',
        '1': 'Playing',
        '2': 'Paused', 
        '3': 'Buffering',
        '5': 'Cued'
      };
      statusElement.textContent = states[state] || 'Unknown';
    }
  }

  /**
   * Static method to open the YouTube DJ window
   */
  static open(): YouTubeDJApp {
    const app = new YouTubeDJApp();
    app.render({ force: true });
    return app;
  }
}