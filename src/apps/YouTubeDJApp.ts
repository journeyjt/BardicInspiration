/**
 * YouTube DJ Application - Synced YouTube Player for FoundryVTT
 * MVP-U3: Multi-Client Sync with Heartbeat System
 */

interface YouTubeDJData {
  currentVideoId: string | null;
  currentVideoTitle: string;
  isPlayerReady: boolean;
  hasAutoplayConsent: boolean;
  isDJ: boolean;
  playerState: string;
  djUser: string | null;
  isConnected: boolean;
  hasJoinedSession: boolean;
  sessionMembers: Array<{id: string, name: string, isDJ: boolean}>;
}

interface YouTubeDJMessage {
  type: 'PLAY' | 'PAUSE' | 'SEEK' | 'LOAD' | 'DJ_CLAIM' | 'DJ_RELEASE' | 'USER_JOIN' | 'USER_LEAVE' | 'STATE_REQUEST' | 'STATE_RESPONSE' | 'HEARTBEAT';
  data?: any;
  userId: string;
  timestamp: number;
}

interface HeartbeatData {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  serverTimestamp: number;
}

export class YouTubeDJApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  
  private youtubePlayer: any = null;
  private autoplayConsent: boolean = false;
  private playerReady: boolean = false;
  private isRecreating: boolean = false;
  private containerObserver: MutationObserver | null = null;
  private seekUpdateInterval: number | null = null;
  
  // Socket communication properties
  private static readonly SOCKET_NAME = 'module.bardic-inspiration';
  private isDJ: boolean = false;
  private djUserId: string | null = null;
  private isConnected: boolean = false;
  private hasJoinedSession: boolean = false;
  private sessionMembers: Array<{id: string, name: string, isDJ: boolean}> = [];
  
  // MVP-U3: Multi-Client Sync properties
  private heartbeatInterval: number | null = null;
  private lastHeartbeat: HeartbeatData | null = null;
  private driftTolerance: number = 1.0; // 1 second tolerance
  private heartbeatFrequency: number = 2000; // 2 seconds (5-10 second range from spec)
  
  // World-level state management
  private static readonly WORLD_DJ_SETTING = 'youtubeDJ.currentDJ';
  private static readonly WORLD_MEMBERS_SETTING = 'youtubeDJ.sessionMembers';
  
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
      isDJ: this.isDJ,
      playerState: this.playerReady ? 'Ready' : 'Initializing...',
      djUser: this.djUserId ? game.users?.get(this.djUserId)?.name || 'Unknown' : null,
      isConnected: this.isConnected,
      hasJoinedSession: this.hasJoinedSession,
      sessionMembers: this.sessionMembers
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
    
    // Player initialization happens only when user clicks "Join Session"
    // No automatic initialization to respect user consent
    
    // Event listeners
    html.querySelector('.youtube-url-input')?.addEventListener('keypress', this._onUrlInputKeypress.bind(this));
    html.querySelector('.load-video-btn')?.addEventListener('click', this._onLoadVideoClick.bind(this));
    html.querySelector('.play-btn')?.addEventListener('click', this._onPlayClick.bind(this));
    html.querySelector('.pause-btn')?.addEventListener('click', this._onPauseClick.bind(this));
    html.querySelector('.join-session-btn')?.addEventListener('click', this._onJoinSessionClick.bind(this));
    html.querySelector('.recreate-player-btn')?.addEventListener('click', this._onJoinSessionClick.bind(this));
    html.querySelector('.claim-dj-btn')?.addEventListener('click', this._onClaimDJClick.bind(this));
    html.querySelector('.release-dj-btn')?.addEventListener('click', this._onReleaseDJClick.bind(this));
    html.querySelector('.close-btn')?.addEventListener('click', this._onCloseClick.bind(this));
    html.querySelector('.seek-bar')?.addEventListener('input', this._onSeekBarInput.bind(this));
    html.querySelector('.seek-bar')?.addEventListener('change', this._onSeekBarChange.bind(this));
    
    // Initialize socket communication
    this._initializeSocket();
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
    this._updateTransportControls();
    
    // Start seek bar updates for DJ
    this._startSeekBarUpdates();
    
    // Start heartbeat system for DJ
    if (this.isDJ) {
      this._startHeartbeat();
    }
    
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
      
      // Use YouTube API to load video locally
      this.youtubePlayer.loadVideoById(videoId);
      input.value = ''; // Clear input
      ui.notifications?.info(`Loading video: ${videoId}`);
      console.log(`🎵 YouTube DJ | Successfully loaded video via API: ${videoId}`);
      
      // Broadcast LOAD message to sync with other clients
      if (this.isDJ) {
        console.log(`🎵 YouTube DJ | Broadcasting LOAD message to sync video: ${videoId}`);
        this._broadcastMessage({
          type: 'LOAD',
          data: { videoId },
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      }
      
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
    if (!this.playerReady || !this.youtubePlayer) {
      ui.notifications?.error('YouTube player not ready');
      return;
    }

    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can control playback');
      return;
    }

    try {
      this.youtubePlayer.playVideo();
      console.log('🎵 YouTube DJ | Play command sent via API');
      
      // Broadcast play command to other clients
      this._broadcastMessage({
        type: 'PLAY',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
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

    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can control playback');
      return;
    }

    try {
      this.youtubePlayer.pauseVideo();
      console.log('🎵 YouTube DJ | Pause command sent via API');
      
      // Broadcast pause command to other clients
      this._broadcastMessage({
        type: 'PAUSE',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('🎵 YouTube DJ | Error pausing video:', error);
      ui.notifications?.error('Failed to pause video. Try again in a moment.');
    }
  }

  /**
   * Handle seek bar input (while dragging)
   */
  private _onSeekBarInput(event: Event): void {
    if (!this.isDJ || !this.playerReady || !this.youtubePlayer) {
      return;
    }
    
    const seekBar = event.target as HTMLInputElement;
    const percentage = parseFloat(seekBar.value);
    
    // Update current time display while dragging (no seeking yet)
    try {
      const duration = this.youtubePlayer.getDuration();
      if (duration && duration > 0) {
        const seekTime = (percentage / 100) * duration;
        this._updateCurrentTimeDisplay(seekTime);
      }
    } catch (error) {
      console.warn('🎵 YouTube DJ | Error getting duration for seek preview:', error);
    }
  }

  /**
   * Handle seek bar change (on release)
   */
  private _onSeekBarChange(event: Event): void {
    if (!this.isDJ || !this.playerReady || !this.youtubePlayer) {
      return;
    }
    
    const seekBar = event.target as HTMLInputElement;
    const percentage = parseFloat(seekBar.value);
    
    try {
      const duration = this.youtubePlayer.getDuration();
      if (duration && duration > 0) {
        const seekTime = (percentage / 100) * duration;
        
        // Seek locally
        this.youtubePlayer.seekTo(seekTime, true);
        console.log(`🎵 YouTube DJ | Seeking to ${seekTime.toFixed(1)}s (${percentage.toFixed(1)}%)`);
        
        // Broadcast seek command to other clients
        this._broadcastMessage({
          type: 'SEEK',
          data: { time: seekTime },
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
        
      }
    } catch (error) {
      console.error('🎵 YouTube DJ | Error seeking video:', error);
      ui.notifications?.error('Failed to seek video. Try again in a moment.');
    }
  }

  /**
   * Update current time display
   */
  private _updateCurrentTimeDisplay(time: number): void {
    const currentTimeElement = this.element.querySelector('.current-time');
    if (currentTimeElement) {
      currentTimeElement.textContent = this._formatTime(time);
    }
  }

  /**
   * Update seek bar and time displays
   */
  private _updateSeekBar(): void {
    if (!this.youtubePlayer || !this.playerReady) {
      return;
    }

    try {
      const currentTime = this.youtubePlayer.getCurrentTime();
      const duration = this.youtubePlayer.getDuration();
      
      if (duration && duration > 0) {
        const percentage = (currentTime / duration) * 100;
        
        // Update seek bar position
        const seekBar = this.element.querySelector('.seek-bar') as HTMLInputElement;
        if (seekBar && !seekBar.matches(':active')) { // Don't update if user is dragging
          seekBar.value = percentage.toString();
          seekBar.max = '100';
        }
        
        // Update time displays
        this._updateCurrentTimeDisplay(currentTime);
        
        const totalTimeElement = this.element.querySelector('.total-time');
        if (totalTimeElement) {
          totalTimeElement.textContent = this._formatTime(duration);
        }
      }
    } catch (error) {
      console.warn('🎵 YouTube DJ | Error updating seek bar:', error);
    }
  }

  /**
   * Format time in MM:SS format
   */
  private _formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Handle join session button click
   */
  private _onJoinSessionClick(): void {
    if (this.playerReady && this.youtubePlayer) {
      console.log('🎵 YouTube DJ | Player already exists, recreating...');
      // If player exists, recreate it
      this._recreatePlayer();
      return;
    }

    console.log('🎵 YouTube DJ | User joining session with consent...');
    
    try {
      // Grant autoplay consent with user gesture
      this.autoplayConsent = true;
      
      // Mark user as having joined the session
      this.hasJoinedSession = true;
      
      // Add current user to session members
      const currentUser = game.user;
      if (currentUser) {
        const memberData = {
          id: currentUser.id,
          name: currentUser.name || 'Unknown',
          isDJ: this.isDJ
        };

        // Add to session members if not already present
        const existingIndex = this.sessionMembers.findIndex(m => m.id === currentUser.id);
        if (existingIndex === -1) {
          this.sessionMembers.push(memberData);
        }

        // Broadcast USER_JOIN message to other clients
        this._broadcastMessage({
          type: 'USER_JOIN',
          userId: currentUser.id,
          timestamp: Date.now()
        });
        
        // MVP-U3: Request sync state for late joiners
        if (!this.isDJ) {
          this._requestLatejoinSync();
        }
      }
      
      // Try to claim DJ role if no one is DJ yet
      this._tryClaimDJRole();
      
      // Initialize the YouTube player with user consent
      this._initializeYouTubePlayer();
      
      // Create session sections manually if they don't exist
      this._ensureSessionSectionsExist();
      
      // Update UI elements
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
      
      ui.notifications?.info('Joining session... YouTube player will load momentarily.');
      console.log('🎵 YouTube DJ | Session joined with user consent');
    } catch (error) {
      console.error('🎵 YouTube DJ | Failed to join session:', error);
      ui.notifications?.error('Failed to join session. Please try again.');
    }
  }


  /**
   * Handle claim DJ button click
   */
  private _onClaimDJClick(): void {
    console.log(`🎵 YouTube DJ | Claim DJ clicked - hasJoinedSession: ${this.hasJoinedSession}, isDJ: ${this.isDJ}, djUserId: ${this.djUserId}`);
    
    if (!this.hasJoinedSession) {
      ui.notifications?.warn('Please join the session first');
      return;
    }
    
    if (this.isDJ) {
      ui.notifications?.info('You are already the DJ');
      return;
    }
    
    if (this.djUserId && this.djUserId !== game.user?.id) {
      console.log(`🎵 YouTube DJ | Cannot claim DJ - current DJ is ${this.djUserId}, user is ${game.user?.id}`);
      ui.notifications?.warn('Someone else is already the DJ. They need to release the role first.');
      return;
    }
    
    console.log('🎵 YouTube DJ | Attempting to claim DJ role manually...');
    this.isDJ = true;
    this.djUserId = game.user?.id || '';
    
    // Save to world state
    this._saveWorldState();
    
    this._broadcastMessage({
      type: 'DJ_CLAIM',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    console.log('🎵 YouTube DJ | Claimed DJ role manually');
    ui.notifications?.success('You are now the DJ!');
    
    // Start heartbeat for new DJ
    if (this.playerReady) {
      this._startHeartbeat();
    }
    
    this._updatePlayerStatusUI();
    this._updateDJControls();
    this._updateDJStatusHeader();
    this._updateTransportControls();
    this._updateSessionMembersUI();
  }

  /**
   * Handle release DJ button click
   */
  private _onReleaseDJClick(): void {
    if (!this.isDJ) {
      ui.notifications?.warn('You are not the DJ');
      return;
    }
    
    console.log('🎵 YouTube DJ | Releasing DJ role...');
    this.isDJ = false;
    this.djUserId = null;
    
    // Save to world state
    this._saveWorldState();
    
    this._broadcastMessage({
      type: 'DJ_RELEASE',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    // Stop heartbeat for released DJ
    this._stopHeartbeat();
    
    ui.notifications?.info('DJ role released');
    this._updatePlayerStatusUI();
    this._updateDJControls();
    this._updateDJStatusHeader();
    this._updateTransportControls();
    this._updateSessionMembersUI();
  }

  /**
   * Handle close button click
   */
  private _onCloseClick(): void {
    this.close();
  }
  
  /** @override */
  close(options?: any): Promise<void> {
    // Broadcast USER_LEAVE message if user was in session
    const currentUser = game.user;
    if (currentUser && this.isConnected && this.sessionMembers.some(m => m.id === currentUser.id)) {
      this._broadcastMessage({
        type: 'USER_LEAVE',
        userId: currentUser.id,
        timestamp: Date.now()
      });
      
      // Remove current user from session members
      const memberIndex = this.sessionMembers.findIndex(m => m.id === currentUser.id);
      if (memberIndex !== -1) {
        this.sessionMembers.splice(memberIndex, 1);
      }
    }

    // Clean up timers and observers
    this._stopSeekBarUpdates();
    this._stopHeartbeat();
    
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
   * Initialize socket communication
   */
  private _initializeSocket(): void {
    console.log('🎵 YouTube DJ | Initializing socket communication...');
    console.log(`🎵 YouTube DJ | Socket channel: ${YouTubeDJApp.SOCKET_NAME}`);
    console.log(`🎵 YouTube DJ | Current user: ${game.user?.name} (${game.user?.id})`);
    console.log(`🎵 YouTube DJ | Socket instance:`, game.socket);
    console.log(`🎵 YouTube DJ | Socket connected:`, game.socket?.connected);
    console.log(`🎵 YouTube DJ | All users in world:`, Array.from(game.users?.values() || []).map(u => ({id: u.id, name: u.name, active: u.active})));
    console.log(`🎵 YouTube DJ | World ID:`, game.world?.id);
    console.log(`🎵 YouTube DJ | Game session:`, game.sessionId);
    console.log(`🎵 YouTube DJ | Socket ID:`, game.socket?.id);
    
    // Set up socket listener
    game.socket?.on(YouTubeDJApp.SOCKET_NAME, this._onSocketMessage.bind(this));
    
    // Also listen to system socket for testing
    game.socket?.on('system', (data: any) => {
      if (data.type === 'test' && data.data?.userId !== game.user?.id) {
        console.log('🎵 YouTube DJ | Received basic socket test from:', data.data);
      }
    });
    
    // Listen to fallback channel
    game.socket?.on('module.bardic-inspiration.fallback', (data: any) => {
      console.log('🎵 YouTube DJ | Received FALLBACK message:', data);
      if (data.bardic_dj_message && data.bardic_dj_message.userId !== game.user?.id) {
        console.log('🎵 YouTube DJ | Processing fallback message...');
        this._onSocketMessage(data.bardic_dj_message);
      }
    });
    
    this.isConnected = true;
    
    // Test basic socket functionality
    console.log('🎵 YouTube DJ | Testing socket with ping message...');
    setTimeout(() => {
      // First test with our custom channel
      this._broadcastMessage({
        type: 'PING' as any,
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      // Also test with a direct socket emit to see if basic socket works
      console.log('🎵 YouTube DJ | Testing basic socket.emit...');
      game.socket?.emit('system', {
        type: 'test',
        data: {message: 'Test from YouTube DJ', userId: game.user?.id}
      });
    }, 1000);
    
    // Load existing world state first
    this._loadWorldState();
    
    // Update UI to reflect loaded state
    this._updateDJControls();
    this._updateDJStatusHeader();
    this._updateTransportControls();
    this._updateSessionMembersUI();
    
    // Request current session state from other users
    this._requestSessionState();
    
    // Socket communication is now working properly!
    
    console.log('🎵 YouTube DJ | Socket communication initialized');
  }

  /**
   * Load world-level state
   */
  private _loadWorldState(): void {
    console.log('🎵 YouTube DJ | Loading world state...');
    
    // Load DJ state from world settings
    const worldDJ = game.settings.get('core', YouTubeDJApp.WORLD_DJ_SETTING) as string | null;
    const worldMembers = game.settings.get('core', YouTubeDJApp.WORLD_MEMBERS_SETTING) as Array<{id: string, name: string, isDJ: boolean}> | null;
    
    if (worldDJ) {
      const djUser = game.users?.get(worldDJ);
      const djActive = djUser?.active;
      console.log(`🎵 YouTube DJ | Found existing DJ in world: ${worldDJ} (${djUser?.name}), active: ${djActive}`);
      
      if (djActive) {
        this.djUserId = worldDJ;
        this.isDJ = worldDJ === game.user?.id;
        console.log(`🎵 YouTube DJ | Loaded DJ state - Current user is DJ: ${this.isDJ}`);
      } else {
        console.log(`🎵 YouTube DJ | Previous DJ ${worldDJ} is inactive, clearing DJ state`);
        this.djUserId = null;
        this.isDJ = false;
      }
    }
    
    if (worldMembers && Array.isArray(worldMembers)) {
      console.log(`🎵 YouTube DJ | Found existing session members:`, worldMembers);
      this.sessionMembers = worldMembers;
    }
  }

  /**
   * Save current state to world settings (GM only)
   */
  private _saveWorldState(): void {
    console.log('🎵 YouTube DJ | Saving world state...');
    
    // Only GMs can write to world settings
    if (!game.user?.isGM) {
      console.log('🎵 YouTube DJ | Non-GM user, skipping world state save');
      return;
    }
    
    game.settings.set('core', YouTubeDJApp.WORLD_DJ_SETTING, this.djUserId);
    game.settings.set('core', YouTubeDJApp.WORLD_MEMBERS_SETTING, this.sessionMembers);
  }

  /**
   * Request current session state from other users
   */
  private _requestSessionState(): void {
    console.log('🎵 YouTube DJ | Requesting session state from other users...');
    
    this._broadcastMessage({
      type: 'STATE_REQUEST',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
  }

  /**
   * MVP-U3: Request sync state for late joiners
   */
  private _requestLatejoinSync(): void {
    console.log('🎵 YouTube DJ | Requesting sync state as late joiner...');
    
    // Wait a moment for player to be ready, then request sync
    setTimeout(() => {
      if (this.playerReady && this.youtubePlayer) {
        this._broadcastMessage({
          type: 'STATE_REQUEST',
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      }
    }, 1000);
  }

  /**
   * Try to claim DJ role (first user becomes DJ)
   */
  private _tryClaimDJRole(): void {
    // Check if current DJ is still active
    const currentDJActive = this.djUserId && game.users?.get(this.djUserId)?.active;
    
    // Try to claim DJ role if no one is currently DJ or current DJ is inactive
    if (!this.isDJ && (!this.djUserId || !currentDJActive)) {
      if (this.djUserId && !currentDJActive) {
        console.log(`🎵 YouTube DJ | Current DJ ${this.djUserId} is inactive, claiming role...`);
      } else {
        console.log('🎵 YouTube DJ | No DJ found, attempting to claim DJ role...');
      }
      
      this.isDJ = true;
      this.djUserId = game.user?.id || '';
      
      // Save to world state
      this._saveWorldState();
      
      this._broadcastMessage({
        type: 'DJ_CLAIM',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      console.log('🎵 YouTube DJ | Claimed DJ role');
      
      // Start heartbeat for new DJ
      if (this.playerReady) {
        this._startHeartbeat();
      }
      
      this._updatePlayerStatusUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
    } else {
      console.log(`🎵 YouTube DJ | DJ role not claimed - isDJ: ${this.isDJ}, djUserId: ${this.djUserId}, currentDJActive: ${currentDJActive}`);
    }
  }

  /**
   * Handle incoming socket messages
   */
  private _onSocketMessage(message: YouTubeDJMessage): void {
    console.log('🎵 YouTube DJ | Received socket message:', message);
    console.log(`🎵 YouTube DJ | Message from: ${message.userId}, Current user: ${game.user?.id}`);
    console.log(`🎵 YouTube DJ | All connected users:`, Array.from(game.users?.values() || []).map(u => ({id: u.id, name: u.name, active: u.active})));
    
    // Ignore messages from self
    if (message.userId === game.user?.id) {
      console.log('🎵 YouTube DJ | Ignoring message from self');
      return;
    }

    console.log(`🎵 YouTube DJ | Processing message type: ${message.type}`);

    switch (message.type) {
      case 'STATE_REQUEST':
        this._handleStateRequest(message);
        break;
      case 'STATE_RESPONSE':
        this._handleStateResponse(message);
        break;
      case 'DJ_CLAIM':
        this._handleDJClaim(message);
        break;
      case 'DJ_RELEASE':
        this._handleDJRelease(message);
        break;
      case 'PLAY':
        this._handleRemotePlay(message);
        break;
      case 'PAUSE':
        this._handleRemotePause(message);
        break;
      case 'SEEK':
        this._handleRemoteSeek(message);
        break;
      case 'LOAD':
        this._handleRemoteLoad(message);
        break;
      case 'USER_JOIN':
        this._handleUserJoin(message);
        break;
      case 'USER_LEAVE':
        this._handleUserLeave(message);
        break;
      case 'HEARTBEAT':
        this._handleHeartbeat(message);
        break;
      case 'PING':
        console.log(`🎵 YouTube DJ | PING received from ${message.userId}!`);
        break;
      default:
        console.log(`🎵 YouTube DJ | Unknown message type: ${message.type}`);
        break;
    }
  }

  /**
   * Handle state request message
   */
  private _handleStateRequest(message: YouTubeDJMessage): void {
    console.log(`🎵 YouTube DJ | Sending state response to ${message.userId}`);
    
    // Prepare response data
    const responseData: any = {
      djUserId: this.djUserId,
      sessionMembers: this.sessionMembers
    };
    
    // MVP-U3: Include current playback state if we're the DJ
    if (this.isDJ && this.playerReady && this.youtubePlayer) {
      try {
        const videoData = this.youtubePlayer.getVideoData();
        const currentTime = this.youtubePlayer.getCurrentTime();
        const duration = this.youtubePlayer.getDuration();
        const playerState = this.youtubePlayer.getPlayerState();
        const isPlaying = playerState === 1;
        
        responseData.currentPlayback = {
          videoId: videoData?.video_id || '',
          currentTime: currentTime,
          isPlaying: isPlaying,
          duration: duration || 0,
          serverTimestamp: Date.now()
        };
        
        console.log(`🎵 YouTube DJ | Including playback state in response: ${isPlaying ? 'PLAYING' : 'PAUSED'} at ${currentTime.toFixed(1)}s`);
      } catch (error) {
        console.warn('🎵 YouTube DJ | Error getting playback state for response:', error);
      }
    }
    
    // Send current state to the requesting user
    this._broadcastMessage({
      type: 'STATE_RESPONSE',
      userId: game.user?.id || '',
      data: responseData,
      timestamp: Date.now()
    });
  }

  /**
   * Handle state response message
   */
  private _handleStateResponse(message: YouTubeDJMessage): void {
    console.log(`🎵 YouTube DJ | Received state response:`, message.data);
    
    if (message.data) {
      // Update local state with received state
      if (message.data.djUserId && !this.djUserId) {
        this.djUserId = message.data.djUserId;
        this.isDJ = this.djUserId === game.user?.id;
        console.log(`🎵 YouTube DJ | Updated DJ from state response: ${this.djUserId}`);
      }
      
      if (message.data.sessionMembers && Array.isArray(message.data.sessionMembers)) {
        // Merge session members, avoiding duplicates
        message.data.sessionMembers.forEach((member: any) => {
          const existingIndex = this.sessionMembers.findIndex(m => m.id === member.id);
          if (existingIndex === -1) {
            this.sessionMembers.push(member);
          }
        });
        console.log(`🎵 YouTube DJ | Updated session members from state response`);
      }
      
      // MVP-U3: Handle late joiner sync with current playback state
      if (message.data.currentPlayback && !this.isDJ && this.playerReady && this.youtubePlayer) {
        const playback = message.data.currentPlayback;
        console.log(`🎵 YouTube DJ | Late joiner sync - Loading ${playback.videoId} at ${playback.currentTime.toFixed(1)}s`);
        
        try {
          // Load the video and seek to current position
          if (playback.videoId) {
            this.youtubePlayer.loadVideoById(playback.videoId, playback.currentTime);
            
            // Set playing state after load
            setTimeout(() => {
              if (playback.isPlaying) {
                this.youtubePlayer.playVideo();
                console.log('🎵 YouTube DJ | Late joiner sync - Started playback');
              } else {
                this.youtubePlayer.pauseVideo();
                console.log('🎵 YouTube DJ | Late joiner sync - Paused');
              }
            }, 500);
            
            ui.notifications?.info('Synced with ongoing session!');
          }
        } catch (error) {
          console.error('🎵 YouTube DJ | Error during late joiner sync:', error);
        }
      }
      
      // Save updated state and refresh UI
      this._saveWorldState();
      this._updateSessionMembersUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
    }
  }

  /**
   * Handle DJ claim message
   */
  private _handleDJClaim(message: YouTubeDJMessage): void {
    if (!this.djUserId) {
      // First claim wins
      this.djUserId = message.userId;
      this.isDJ = (message.userId === game.user?.id);
      console.log(`🎵 YouTube DJ | DJ role claimed by: ${game.users?.get(message.userId)?.name}`);
      
      // Only GM saves to world state, others just update UI
      this._saveWorldState();
      
      // Start heartbeat if this user became DJ
      if (this.isDJ && this.playerReady) {
        this._startHeartbeat();
      }
      
      this._updatePlayerStatusUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateSessionMembersUI();
    }
  }

  /**
   * Handle DJ release message
   */
  private _handleDJRelease(message: YouTubeDJMessage): void {
    console.log(`🎵 YouTube DJ | Received DJ_RELEASE from ${message.userId}, current DJ: ${this.djUserId}`);
    
    if (this.djUserId === message.userId) {
      this.djUserId = null;
      this.isDJ = false;
      console.log('🎵 YouTube DJ | DJ role released, updating local state');
      
      // Save to world state
      this._saveWorldState();
      
      // Stop heartbeat if this user lost DJ role
      this._stopHeartbeat();
      
      this._updatePlayerStatusUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateSessionMembersUI();
    } else {
      console.log(`🎵 YouTube DJ | DJ_RELEASE ignored - not from current DJ (${this.djUserId} vs ${message.userId})`);
    }
  }

  /**
   * Handle remote play command
   */
  private _handleRemotePlay(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady) {
      console.log('🎵 YouTube DJ | Executing remote PLAY command');
      this.youtubePlayer.playVideo();
    }
  }

  /**
   * Handle remote pause command
   */
  private _handleRemotePause(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady) {
      console.log('🎵 YouTube DJ | Executing remote PAUSE command');
      this.youtubePlayer.pauseVideo();
    }
  }

  /**
   * Handle remote seek command
   */
  private _handleRemoteSeek(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady && message.data?.time) {
      console.log('🎵 YouTube DJ | Executing remote SEEK command to:', message.data.time);
      this.youtubePlayer.seekTo(message.data.time, true);
    }
  }

  /**
   * Handle remote load command
   */
  private _handleRemoteLoad(message: YouTubeDJMessage): void {
    if (!this.isDJ && message.data?.videoId) {
      console.log('🎵 YouTube DJ | Executing remote LOAD command for:', message.data.videoId);
      if (this.youtubePlayer && this.playerReady) {
        this.youtubePlayer.loadVideoById(message.data.videoId);
      }
    }
  }

  /**
   * Handle user join message
   */
  private _handleUserJoin(message: YouTubeDJMessage): void {
    const user = game.users?.get(message.userId);
    if (user) {
      const memberData = {
        id: user.id,
        name: user.name || 'Unknown',
        isDJ: message.userId === this.djUserId
      };

      // Add to session members if not already present
      const existingIndex = this.sessionMembers.findIndex(m => m.id === user.id);
      if (existingIndex === -1) {
        this.sessionMembers.push(memberData);
        console.log(`🎵 YouTube DJ | User joined session: ${user.name}`);
        
        // Save updated session members to world state
        this._saveWorldState();
        this._updateSessionMembersUI();
      }
    }
  }

  /**
   * Handle user leave message
   */
  private _handleUserLeave(message: YouTubeDJMessage): void {
    const memberIndex = this.sessionMembers.findIndex(m => m.id === message.userId);
    if (memberIndex !== -1) {
      const member = this.sessionMembers[memberIndex];
      this.sessionMembers.splice(memberIndex, 1);
      console.log(`🎵 YouTube DJ | User left session: ${member.name}`);
      this._updateSessionMembersUI();
    }
  }

  /**
   * MVP-U3: Start heartbeat system for DJ
   */
  private _startHeartbeat(): void {
    // Clear any existing heartbeat
    this._stopHeartbeat();
    
    if (!this.isDJ) {
      console.log('🎵 YouTube DJ | Not DJ, skipping heartbeat start');
      return;
    }
    
    console.log(`🎵 YouTube DJ | Starting heartbeat system (${this.heartbeatFrequency}ms interval)`);
    
    this.heartbeatInterval = window.setInterval(() => {
      if (this.isDJ && this.playerReady && this.youtubePlayer) {
        this._sendHeartbeat();
      }
    }, this.heartbeatFrequency);
  }

  /**
   * MVP-U3: Stop heartbeat system
   */
  private _stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('🎵 YouTube DJ | Heartbeat stopped');
    }
  }

  /**
   * MVP-U3: Send heartbeat with current player state
   */
  private _sendHeartbeat(): void {
    if (!this.youtubePlayer || !this.playerReady) {
      return;
    }
    
    try {
      const videoData = this.youtubePlayer.getVideoData();
      const currentTime = this.youtubePlayer.getCurrentTime();
      const duration = this.youtubePlayer.getDuration();
      const playerState = this.youtubePlayer.getPlayerState();
      const isPlaying = playerState === 1; // YT.PlayerState.PLAYING
      
      const heartbeatData: HeartbeatData = {
        videoId: videoData?.video_id || '',
        currentTime: currentTime,
        isPlaying: isPlaying,
        duration: duration || 0,
        serverTimestamp: Date.now()
      };
      
      // Store for reference
      this.lastHeartbeat = heartbeatData;
      
      // Broadcast to all listeners
      this._broadcastMessage({
        type: 'HEARTBEAT',
        data: heartbeatData,
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      console.log(`🎵 YouTube DJ | Heartbeat sent - ${isPlaying ? 'PLAYING' : 'PAUSED'} at ${currentTime.toFixed(1)}s`);
      
    } catch (error) {
      console.warn('🎵 YouTube DJ | Error sending heartbeat:', error);
    }
  }

  /**
   * MVP-U3: Handle heartbeat from DJ
   */
  private _handleHeartbeat(message: YouTubeDJMessage): void {
    // Only non-DJ users should process heartbeats
    if (this.isDJ || !this.playerReady || !this.youtubePlayer) {
      return;
    }
    
    const heartbeat = message.data as HeartbeatData;
    if (!heartbeat) {
      console.warn('🎵 YouTube DJ | Invalid heartbeat data received');
      return;
    }
    
    console.log(`🎵 YouTube DJ | Heartbeat received - ${heartbeat.isPlaying ? 'PLAYING' : 'PAUSED'} at ${heartbeat.currentTime.toFixed(1)}s`);
    
    try {
      // Check if we need to sync video
      const currentVideoData = this.youtubePlayer.getVideoData();
      if (currentVideoData?.video_id !== heartbeat.videoId && heartbeat.videoId) {
        console.log(`🎵 YouTube DJ | Video sync needed: ${currentVideoData?.video_id} -> ${heartbeat.videoId}`);
        this.youtubePlayer.loadVideoById(heartbeat.videoId, heartbeat.currentTime);
        return;
      }
      
      // Get current local state
      const localTime = this.youtubePlayer.getCurrentTime();
      const localState = this.youtubePlayer.getPlayerState();
      const localIsPlaying = localState === 1;
      
      // Calculate drift
      const timeDrift = Math.abs(localTime - heartbeat.currentTime);
      
      console.log(`🎵 YouTube DJ | Sync check - Local: ${localTime.toFixed(1)}s, Remote: ${heartbeat.currentTime.toFixed(1)}s, Drift: ${timeDrift.toFixed(1)}s`);
      
      // Sync playback state if different
      if (localIsPlaying !== heartbeat.isPlaying) {
        console.log(`🎵 YouTube DJ | Playback state sync: ${localIsPlaying ? 'PLAYING' : 'PAUSED'} -> ${heartbeat.isPlaying ? 'PLAYING' : 'PAUSED'}`);
        if (heartbeat.isPlaying) {
          this.youtubePlayer.playVideo();
        } else {
          this.youtubePlayer.pauseVideo();
        }
      }
      
      // Drift correction - seek if out of tolerance
      if (timeDrift > this.driftTolerance) {
        console.log(`🎵 YouTube DJ | Drift correction: seeking from ${localTime.toFixed(1)}s to ${heartbeat.currentTime.toFixed(1)}s (drift: ${timeDrift.toFixed(1)}s)`);
        this.youtubePlayer.seekTo(heartbeat.currentTime, true);
      }
      
    } catch (error) {
      console.error('🎵 YouTube DJ | Error processing heartbeat:', error);
    }
  }

  /**
   * Update session members UI without full re-render
   */
  private _updateSessionMembersUI(): void {
    // Update only the session members section without destroying player
    const membersContainer = this.element.querySelector('.members-list');
    if (!membersContainer) {
      console.log('🎵 YouTube DJ | Members list container not found, skipping update');
      return;
    }
    
    console.log(`🎵 YouTube DJ | Updating session members - count: ${this.sessionMembers.length}`);
    
    // Clear existing members
    membersContainer.innerHTML = '';
    
    if (this.sessionMembers.length === 0) {
      // Show fallback for current user
      const fallbackMember = document.createElement('div');
      fallbackMember.className = `member-item ${this.isDJ ? 'member-dj' : 'member-listener'}`;
      fallbackMember.innerHTML = `
        <i class="fas ${this.isDJ ? 'fa-microphone' : 'fa-headphones'}"></i>
        <span class="member-name">You</span>
        ${this.isDJ ? '<span class="member-role">DJ</span>' : ''}
      `;
      membersContainer.appendChild(fallbackMember);
    } else {
      // Show all session members
      this.sessionMembers.forEach(member => {
        const memberElement = document.createElement('div');
        memberElement.className = `member-item ${member.isDJ ? 'member-dj' : 'member-listener'}`;
        memberElement.innerHTML = `
          <i class="fas ${member.isDJ ? 'fa-microphone' : 'fa-headphones'}"></i>
          <span class="member-name">${member.name}</span>
          ${member.isDJ ? '<span class="member-role">DJ</span>' : ''}
        `;
        membersContainer.appendChild(memberElement);
      });
    }
  }

  /**
   * Update transport controls without full re-render
   */
  private _updateTransportControls(): void {
    const transportContainer = this.element.querySelector('.transport-controls');
    if (!transportContainer) {
      console.log('🎵 YouTube DJ | Transport controls container not found, skipping update');
      return;
    }
    
    console.log(`🎵 YouTube DJ | Updating transport controls - isDJ: ${this.isDJ}, playerReady: ${this.playerReady}`);
    
    // Update transport controls content based on DJ status
    transportContainer.innerHTML = '';
    
    if (this.isDJ) {
      // Show DJ controls (play/pause buttons)
      const disabledAttr = this.playerReady ? '' : 'disabled';
      transportContainer.innerHTML = `
        <button 
          type="button" 
          class="play-btn transport-btn"
          ${disabledAttr}
        >
          <i class="fas fa-play"></i>
          Play
        </button>
        <button 
          type="button" 
          class="pause-btn transport-btn"
          ${disabledAttr}
        >
          <i class="fas fa-pause"></i>
          Pause
        </button>
      `;
    } else {
      // Show listener info
      transportContainer.innerHTML = `
        <div class="listener-info">
          <i class="fas fa-info-circle"></i>
          <p>Playback is controlled by the DJ</p>
        </div>
      `;
    }
    
    // Re-attach event listeners for DJ controls
    if (this.isDJ) {
      const playBtn = transportContainer.querySelector('.play-btn');
      const pauseBtn = transportContainer.querySelector('.pause-btn');
      
      playBtn?.addEventListener('click', this._onPlayClick.bind(this));
      pauseBtn?.addEventListener('click', this._onPauseClick.bind(this));
    }
    
    // Update seek section for DJ
    this._updateSeekSection();
    
    // Update URL input section for DJ
    this._updateUrlInputSection();
    
    console.log(`🎵 YouTube DJ | Transport controls updated - isDJ: ${this.isDJ}, playerReady: ${this.playerReady}`);
  }

  /**
   * Start periodic seek bar updates
   */
  private _startSeekBarUpdates(): void {
    // Clear any existing interval
    this._stopSeekBarUpdates();
    
    // Update seek bar every 500ms for smooth progress
    this.seekUpdateInterval = window.setInterval(() => {
      if (this.isDJ && this.playerReady && this.youtubePlayer) {
        this._updateSeekBar();
      }
    }, 500);
    
    console.log('🎵 YouTube DJ | Seek bar updates started');
  }

  /**
   * Stop periodic seek bar updates
   */
  private _stopSeekBarUpdates(): void {
    if (this.seekUpdateInterval) {
      clearInterval(this.seekUpdateInterval);
      this.seekUpdateInterval = null;
      console.log('🎵 YouTube DJ | Seek bar updates stopped');
    }
  }

  /**
   * Update seek section without full re-render
   */
  private _updateSeekSection(): void {
    let seekSection = this.element.querySelector('.seek-section');
    
    if (this.isDJ) {
      // Create seek section if it doesn't exist
      if (!seekSection) {
        console.log('🎵 YouTube DJ | Creating seek section for DJ');
        seekSection = document.createElement('div');
        seekSection.className = 'seek-section';
        seekSection.innerHTML = `
          <div class="seek-container">
            <span class="current-time">0:00</span>
            <input 
              type="range" 
              class="seek-bar" 
              min="0" 
              max="100" 
              value="0"
              ${this.playerReady ? '' : 'disabled'}
            >
            <span class="total-time">0:00</span>
          </div>
        `;
        
        // Insert after transport controls
        const transportControls = this.element.querySelector('.transport-controls');
        if (transportControls && transportControls.nextSibling) {
          transportControls.parentNode?.insertBefore(seekSection, transportControls.nextSibling);
        } else if (transportControls) {
          transportControls.parentNode?.appendChild(seekSection);
        }
        
        // Attach event listeners
        const seekBar = seekSection.querySelector('.seek-bar');
        seekBar?.addEventListener('input', this._onSeekBarInput.bind(this));
        seekBar?.addEventListener('change', this._onSeekBarChange.bind(this));
      }
      
      // Update seek bar state
      const seekBar = seekSection.querySelector('.seek-bar') as HTMLInputElement;
      if (seekBar) {
        seekBar.disabled = !this.playerReady;
      }
      
    } else {
      // Remove seek section for non-DJ users
      if (seekSection) {
        console.log('🎵 YouTube DJ | Removing seek section for non-DJ user');
        seekSection.remove();
      }
    }
  }

  /**
   * Update URL input section without full re-render
   */
  private _updateUrlInputSection(): void {
    let urlInputSection = this.element.querySelector('.url-input-section');
    
    if (this.isDJ) {
      // Create URL input section if it doesn't exist
      if (!urlInputSection) {
        console.log('🎵 YouTube DJ | Creating URL input section for DJ');
        urlInputSection = document.createElement('div');
        urlInputSection.className = 'url-input-section';
        urlInputSection.innerHTML = `
          <div class="input-group">
            <input 
              type="text" 
              class="youtube-url-input" 
              placeholder="Paste YouTube URL or video ID..."
              ${this.playerReady ? '' : 'disabled'}
            >
            <button 
              type="button" 
              class="load-video-btn"
              ${this.playerReady ? '' : 'disabled'}
            >
              <i class="fas fa-plus"></i>
              Load Video
            </button>
          </div>
        `;
        
        // Insert before transport controls
        const transportControls = this.element.querySelector('.transport-controls');
        if (transportControls) {
          transportControls.parentNode?.insertBefore(urlInputSection, transportControls);
        }
        
        // Attach event listeners
        const urlInput = urlInputSection.querySelector('.youtube-url-input');
        const loadBtn = urlInputSection.querySelector('.load-video-btn');
        
        urlInput?.addEventListener('keypress', this._onUrlInputKeypress.bind(this));
        loadBtn?.addEventListener('click', this._onLoadVideoClick.bind(this));
      }
      
      // Update input and button state
      const urlInput = urlInputSection.querySelector('.youtube-url-input') as HTMLInputElement;
      const loadBtn = urlInputSection.querySelector('.load-video-btn') as HTMLButtonElement;
      
      if (urlInput) {
        urlInput.disabled = !this.playerReady;
      }
      if (loadBtn) {
        loadBtn.disabled = !this.playerReady;
      }
      
    } else {
      // Remove URL input section for non-DJ users
      if (urlInputSection) {
        console.log('🎵 YouTube DJ | Removing URL input section for non-DJ user');
        urlInputSection.remove();
      }
    }
  }

  /**
   * Update DJ controls without full re-render
   */
  private _updateDJControls(): void {
    const djControlsContainer = this.element.querySelector('.dj-controls');
    if (!djControlsContainer) {
      console.log('🎵 YouTube DJ | DJ controls container not found, skipping update');
      return;
    }
    
    console.log(`🎵 YouTube DJ | Updating DJ controls - isDJ: ${this.isDJ}`);
    
    djControlsContainer.innerHTML = '';
    
    if (this.isDJ) {
      djControlsContainer.innerHTML = `
        <button type="button" class="release-dj-btn">
          <i class="fas fa-crown"></i>
          Release DJ
        </button>
      `;
    } else {
      djControlsContainer.innerHTML = `
        <button type="button" class="claim-dj-btn">
          <i class="fas fa-microphone"></i>
          Become DJ
        </button>
      `;
    }
    
    // Re-attach event listeners
    djControlsContainer.querySelector('.claim-dj-btn')?.addEventListener('click', this._onClaimDJClick.bind(this));
    djControlsContainer.querySelector('.release-dj-btn')?.addEventListener('click', this._onReleaseDJClick.bind(this));
  }

  /**
   * Update DJ status header without full re-render
   */
  private _updateDJStatusHeader(): void {
    const djStatusElement = this.element.querySelector('.dj-status');
    if (!djStatusElement) return;
    
    if (this.isDJ) {
      djStatusElement.innerHTML = `
        <span class="status-dj">
          <i class="fas fa-microphone"></i> You are the DJ
        </span>
      `;
    } else {
      djStatusElement.innerHTML = `
        <span class="status-listener">
          <i class="fas fa-headphones"></i> Listening
        </span>
      `;
    }
  }

  /**
   * Update join session UI without full re-render
   */
  private _updateJoinSessionUI(): void {
    const joinSection = this.element.querySelector('.join-session');
    const sessionMembersSection = this.element.querySelector('.session-members');
    
    if (this.hasJoinedSession) {
      // Hide join section
      if (joinSection) {
        joinSection.style.display = 'none';
      }
      // Show session members section
      if (sessionMembersSection) {
        sessionMembersSection.style.display = 'block';
      }
    } else {
      // Show join section
      if (joinSection) {
        joinSection.style.display = 'block';
      }
      // Hide session members section
      if (sessionMembersSection) {
        sessionMembersSection.style.display = 'none';
      }
    }
  }

  /**
   * Manually create session sections if they don't exist (due to Handlebars conditionals)
   */
  private _ensureSessionSectionsExist(): void {
    // Hide join section if it exists
    const joinSection = this.element.querySelector('.join-session');
    if (joinSection) {
      joinSection.style.display = 'none';
    }

    // Check if session members section exists
    let sessionMembersSection = this.element.querySelector('.session-members');
    if (!sessionMembersSection) {
      console.log('🎵 YouTube DJ | Creating session members section manually');
      
      // Create the session members section
      sessionMembersSection = document.createElement('div');
      sessionMembersSection.className = 'session-members';
      sessionMembersSection.style.display = 'block';
      
      sessionMembersSection.innerHTML = `
        <div class="members-header">
          <i class="fas fa-users"></i>
          <h3>Session Members</h3>
          <div class="dj-controls">
            <!-- DJ controls will be populated by _updateDJControls -->
          </div>
        </div>
        <div class="members-list">
          <!-- Members will be populated by _updateSessionMembersUI -->
        </div>
      `;
      
      // Insert after the join section or at the beginning
      if (joinSection) {
        joinSection.insertAdjacentElement('afterend', sessionMembersSection);
      } else {
        const contentDiv = this.element.querySelector('.youtube-dj-content');
        if (contentDiv) {
          contentDiv.insertBefore(sessionMembersSection, contentDiv.firstChild?.nextSibling || null);
        }
      }
    } else {
      sessionMembersSection.style.display = 'block';
    }
  }

  /**
   * Broadcast message to all clients
   */
  private _broadcastMessage(message: YouTubeDJMessage): void {
    if (this.isConnected) {
      console.log('🎵 YouTube DJ | Broadcasting message:', message);
      console.log(`🎵 YouTube DJ | Socket available: ${!!game.socket}`);
      console.log(`🎵 YouTube DJ | Channel: ${YouTubeDJApp.SOCKET_NAME}`);
      
      // Try both our custom channel AND a fallback method
      const result = game.socket?.emit(YouTubeDJApp.SOCKET_NAME, message);
      console.log(`🎵 YouTube DJ | Emit result:`, result);
      
      // FALLBACK: Use FoundryVTT's system socket as backup
      console.log('🎵 YouTube DJ | Also sending via fallback method...');
      game.socket?.emit('module.bardic-inspiration.fallback', {
        bardic_dj_message: message,
        timestamp: Date.now()
      });
    } else {
      console.warn('🎵 YouTube DJ | Cannot broadcast - not connected');
    }
  }

  /**
   * Static method to open the YouTube DJ window
   */
  static open(): YouTubeDJApp {
    const app = new YouTubeDJApp();
    app.render({ force: true }); // Initial render is OK - no player exists yet
    return app;
  }
}