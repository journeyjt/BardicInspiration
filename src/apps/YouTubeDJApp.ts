/**
 * YouTube DJ Application - Synced YouTube Player for FoundryVTT
 * MVP-U6: DJ Management & Permissions
 */

import { logger } from '../lib/logger.js';

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
  // MVP-U4: Queue data
  queue: VideoItem[];
  currentQueueIndex: number;
  hasQueue: boolean;
  // MVP-U6: DJ Management & Permissions
  isGM: boolean;
  djRequests: Array<{userId: string, userName: string, timestamp: number}>;
  hasDJRequests: boolean;
  isPlayerMuted: boolean;
  canHandoffDJ: boolean;
}

interface YouTubeDJMessage {
  type: 'PLAY' | 'PAUSE' | 'SEEK' | 'LOAD' | 'DJ_CLAIM' | 'DJ_RELEASE' | 'DJ_REQUEST' | 'DJ_HANDOFF' | 'GM_OVERRIDE' | 'USER_JOIN' | 'USER_LEAVE' | 'STATE_REQUEST' | 'STATE_RESPONSE' | 'STATE_SAVE_REQUEST' | 'HEARTBEAT' | 'QUEUE_ADD' | 'QUEUE_REMOVE' | 'QUEUE_NEXT' | 'QUEUE_UPDATE';
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

// MVP-U4: Queue Data Structures
interface VideoItem {
  id: string;
  videoId: string;
  title?: string;
  thumbnail?: string;
  addedBy: string;
  addedAt: number;
}

interface QueueState {
  items: VideoItem[];
  currentIndex: number;
  mode: 'single-dj' | 'group-dj';
  djUserId: string | null;
}

export class YouTubeDJApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  
  private youtubePlayer: any = null;
  private autoplayConsent: boolean = false;
  private playerReady: boolean = false;
  private isRecreating: boolean = false;
  private containerObserver: MutationObserver | null = null;
  private seekUpdateInterval: number | null = null;
  private pendingOperations: Array<() => void> = [];
  private playerInitializing: boolean = false;
  
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
  private static readonly WORLD_QUEUE_SETTING = 'youtubeDJ.queueState';
  
  // MVP-U6: DJ Management & Permissions
  private djRequests: Array<{userId: string, userName: string, timestamp: number}> = [];
  private isPlayerMuted: boolean = false;
  
  // MVP-U4: Queue state
  private queueState: QueueState = {
    items: [],
    currentIndex: -1,
    mode: 'single-dj',
    djUserId: null
  };
  
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
        title: 'Bardic Inspiration - YouTube DJ',
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

  get title() {
    if (this.currentVideoTitle && this.currentVideoTitle !== 'No video loaded') {
      return `Bardic Inspiration - ${this.currentVideoTitle}`;
    }
    return 'Bardic Inspiration - YouTube DJ';
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
    const context = {
      currentVideoId: null,
      currentVideoTitle: this.queueState.items.length > 0 && this.queueState.currentIndex >= 0 
        ? this.queueState.items[this.queueState.currentIndex]?.title || 'No title'
        : 'No video loaded',
      isPlayerReady: this.playerReady,
      hasAutoplayConsent: this.autoplayConsent,
      isDJ: this.isDJ,
      playerState: this.playerReady ? 'Ready' : 'Initializing...',
      djUser: this.djUserId ? game.users?.get(this.djUserId)?.name || 'Unknown' : null,
      isConnected: this.isConnected,
      hasJoinedSession: this.hasJoinedSession,
      sessionMembers: this.sessionMembers,
      // MVP-U4: Queue data
      queue: this.queueState.items,
      currentQueueIndex: this.queueState.currentIndex,
      hasQueue: this.queueState.items.length > 0,
      // MVP-U6: DJ Management & Permissions
      isGM: game.user?.isGM || false,
      djRequests: this.djRequests,
      hasDJRequests: this.djRequests.length > 0,
      isPlayerMuted: this.isPlayerMuted,
      canHandoffDJ: this.isDJ && this.sessionMembers.length > 1
    };
    
    // Debug logging
    logger.debug('🎵 YouTube DJ | Template context:', {
      hasJoinedSession: context.hasJoinedSession,
      isDJ: context.isDJ,
      queueLength: context.queue.length,
      hasQueue: context.hasQueue
    });
    
    return context;
  }
  
  /** @override */
  async render(options: any = {}): Promise<this> {
    // Prevent unnecessary re-renders if player is working, unless forced
    if (this.youtubePlayer && this.playerReady && !options.force) {
      logger.debug('🎵 YouTube DJ | Skipping render to preserve player');
      return this;
    }
    
    logger.debug('🎵 YouTube DJ | Allowing render', { 
      hasPlayer: !!this.youtubePlayer, 
      isReady: this.playerReady, 
      force: options.force 
    });
    
    return super.render(options);
  }

  /** @override */
  _onRender(context: YouTubeDJData, options: any): void {
    const html = this.element;
    
    logger.debug('🎵 YouTube DJ | _onRender called, checking for existing player...');
    
    // Check if we have an existing player that needs protection
    const existingContainer = html.querySelector('#youtube-player-container');
    let existingIframe = existingContainer?.querySelector('#youtube-player') as HTMLIFrameElement;
    
    if (existingIframe && this.youtubePlayer) {
      logger.debug('🎵 YouTube DJ | Found existing iframe, protecting from re-render');
      
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
          logger.debug('🎵 YouTube DJ | Successfully restored existing iframe after re-render');
        } else {
          logger.error('🎵 YouTube DJ | Container disappeared during re-render!');
        }
      }, 0);
    }
    
    // Player initialization happens only when user clicks "Join Session"
    // No automatic initialization to respect user consent
    
    // Event listeners
    html.querySelector('.youtube-url-input')?.addEventListener('keypress', this._onUrlInputKeypress.bind(this));
    html.querySelector('.load-video-btn')?.addEventListener('click', this._onLoadVideoClick.bind(this));
    html.querySelector('.add-to-queue-btn')?.addEventListener('click', this._onAddToQueueClick.bind(this));
    html.querySelector('.next-btn')?.addEventListener('click', this._onNextClick.bind(this));
    html.querySelector('.play-btn')?.addEventListener('click', this._onPlayClick.bind(this));
    html.querySelector('.pause-btn')?.addEventListener('click', this._onPauseClick.bind(this));
    html.querySelector('.join-session-btn')?.addEventListener('click', this._onJoinSessionClick.bind(this));
    html.querySelector('.recreate-player-btn')?.addEventListener('click', this._onJoinSessionClick.bind(this));
    html.querySelector('.claim-dj-btn')?.addEventListener('click', this._onClaimDJClick.bind(this));
    html.querySelector('.release-dj-btn')?.addEventListener('click', this._onReleaseDJClick.bind(this));
    html.querySelector('.close-btn')?.addEventListener('click', this._onCloseClick.bind(this));
    
    // MVP-U6: DJ Management & Permissions event listeners
    html.querySelector('.request-dj-btn')?.addEventListener('click', this._onRequestDJClick.bind(this));
    html.querySelector('.handoff-dj-btn')?.addEventListener('click', this._onHandoffDJClick.bind(this));
    html.querySelector('.mute-player-btn')?.addEventListener('click', this._onMutePlayerClick.bind(this));
    html.querySelector('.gm-override-btn')?.addEventListener('click', this._onGMOverrideClick.bind(this));
    
    // DJ request approval/deny buttons
    html.querySelectorAll('.approve-dj-request-btn').forEach(btn => {
      btn.addEventListener('click', this._onApproveDJRequestClick.bind(this));
    });
    html.querySelectorAll('.deny-dj-request-btn').forEach(btn => {
      btn.addEventListener('click', this._onDenyDJRequestClick.bind(this));
    });
    html.querySelector('.seek-bar')?.addEventListener('input', this._onSeekBarInput.bind(this));
    html.querySelector('.seek-bar')?.addEventListener('change', this._onSeekBarChange.bind(this));
    
    // MVP-U4: Queue management event listeners
    html.querySelectorAll('.remove-queue-btn').forEach(btn => {
      btn.addEventListener('click', this._onRemoveQueueClick.bind(this));
    });
    
    // Queue reordering with up/down buttons
    html.querySelectorAll('.move-up-btn').forEach(btn => {
      btn.addEventListener('click', this._onMoveUpClick.bind(this));
    });
    html.querySelectorAll('.move-down-btn').forEach(btn => {
      btn.addEventListener('click', this._onMoveDownClick.bind(this));
    });
    
    // Initialize socket communication
    this._initializeSocket();
  }

  /**
   * Ensure YouTube player is initialized (synchronous with callback queue)
   */
  private _ensurePlayerInitialized(callback?: () => void): void {
    if (this.playerReady && this.youtubePlayer) {
      // Player is ready, execute callback immediately
      if (callback) callback();
      return;
    }

    if (!this.hasJoinedSession) {
      ui.notifications?.warn('Please join the session first');
      return;
    }

    // Queue the callback for when player is ready
    if (callback) {
      this.pendingOperations.push(callback);
    }

    // If player initialization is already in progress, don't start another
    if (this.playerInitializing) {
      return;
    }

    logger.debug('🎵 YouTube DJ | Lazy loading YouTube player...');
    this.playerInitializing = true;
    this._initializeYouTubePlayer();
  }

  /**
   * Execute all pending operations when player becomes ready
   */
  private _executePendingOperations(): void {
    if (this.pendingOperations.length > 0) {
      logger.debug(`🎵 YouTube DJ | Executing ${this.pendingOperations.length} pending operations`);
      const operations = [...this.pendingOperations];
      this.pendingOperations = [];
      
      operations.forEach(operation => {
        try {
          operation();
        } catch (error) {
          logger.error('🎵 YouTube DJ | Error executing pending operation:', error);
        }
      });
    }
  }

  /**
   * Initialize YouTube Player using IFrame API
   */
  private _initializeYouTubePlayer(): void {
    // Load YouTube IFrame Player API if not already loaded
    if (typeof YT === 'undefined' || typeof YT.Player === 'undefined') {
      logger.debug('🎵 YouTube DJ | Loading YouTube API for full programmatic control');
      this._loadYouTubeAPI();
      return;
    }

    logger.debug('🎵 YouTube DJ | Using YouTube API with render protection');
    
    let playerContainer = this.element.querySelector('#youtube-player-container');
    if (!playerContainer) {
      logger.warn('YouTube player container not found, creating dynamically...');
      
      // Create player section dynamically if it doesn't exist
      const playerSection = document.createElement('div');
      playerSection.className = 'player-section';
      playerSection.innerHTML = `
        <div class="player-info">
          <h3>No video loaded</h3>
          <div class="player-status-container">
            Status: <span class="player-status">${this.playerState}</span>
          </div>
        </div>
        <div id="youtube-player-container">
          <!-- YouTube player will be inserted here -->
        </div>
      `;
      
      // Insert after join session section or at the beginning of content
      const content = this.element.querySelector('.youtube-dj-content');
      const joinSection = this.element.querySelector('.join-session');
      if (content) {
        if (joinSection && joinSection.nextSibling) {
          content.insertBefore(playerSection, joinSection.nextSibling);
        } else {
          content.appendChild(playerSection);
        }
      }
      
      playerContainer = this.element.querySelector('#youtube-player-container');
      if (!playerContainer) {
        logger.error('Failed to create YouTube player container');
        return;
      }
    }

    // Clean up any existing player first
    if (this.youtubePlayer) {
      try {
        this.youtubePlayer.destroy();
      } catch (e) {
        logger.debug('🎵 YouTube DJ | Old player cleanup (expected)');
      }
      this.youtubePlayer = null;
    }

    // Clear container and create fresh player div
    playerContainer.innerHTML = '';
    const playerDiv = document.createElement('div');
    playerDiv.id = 'youtube-player';
    playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; background: #333; border: 1px solid #666;';
    playerContainer.appendChild(playerDiv);
    
    logger.debug('🎵 YouTube DJ | Player div created for YouTube API');

    // Wait a moment for DOM to settle before creating player
    setTimeout(() => {
      const finalPlayerDiv = this.element.querySelector('#youtube-player');
      if (!finalPlayerDiv) {
        logger.error('🎵 YouTube DJ | Player div disappeared before initialization');
        return;
      }

      // Initialize the YouTube player with proper API
      // For development, let YouTube handle protocol automatically
      logger.debug(`🎵 YouTube DJ | Creating YouTube API player - Origin: ${window.location.origin}`);
      
      // Use current video from queue based on currentIndex, otherwise no default video
      const currentItem = this.queueState.items.length > 0 && this.queueState.currentIndex >= 0 && this.queueState.currentIndex < this.queueState.items.length
        ? this.queueState.items[this.queueState.currentIndex]
        : (this.queueState.items.length > 0 ? this.queueState.items[0] : null);
      
      const initialVideoId = currentItem?.videoId;
      
      // Initialize with current video if available
      if (currentItem) {
        logger.debug(`🎵 YouTube DJ | Initializing with current video: ${currentItem.title || currentItem.videoId} (index: ${this.queueState.currentIndex})`);
      }
      
      this.youtubePlayer = new YT.Player('youtube-player', {
        height: '315',
        width: '560',
        ...(initialVideoId && { videoId: initialVideoId }),
        playerVars: {
          'playsinline': 1,
          'controls': 1,
          'rel': 0,
          'modestbranding': 1,
          'autoplay': 0,
          'mute': 0,
          'enablejsapi': 1
          // Don't set origin parameter to avoid protocol mismatch
        },
        events: {
          'onReady': this._onPlayerReady.bind(this),
          'onStateChange': this._onPlayerStateChange.bind(this),
          'onError': this._onPlayerError.bind(this)
        }
      });

      logger.debug('🎵 YouTube DJ | YouTube API player initialized');
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

    logger.debug(`🎵 YouTube DJ | Loading YouTube API from: ${apiUrl} (${this.isDevelopment ? 'DEV' : 'PROD'} mode)`);

    // Set up the callback for when API loads
    (window as any).onYouTubeIframeAPIReady = () => {
      logger.debug('🎵 YouTube DJ | YouTube API loaded');
      this._initializeYouTubePlayer();
      (window as any).youtubeAPILoading = false;
    };

    script.onerror = () => {
      logger.error(`🎵 YouTube DJ | Failed to load YouTube API from ${apiUrl}`);
      // In development, if HTTP fails, try HTTPS fallback
      if (this.isDevelopment && script.src.startsWith('http://')) {
        logger.warn('🎵 YouTube DJ | HTTP API failed in dev mode, falling back to HTTPS');
        const httpsScript = document.createElement('script');
        httpsScript.src = 'https://www.youtube.com/iframe_api';
        httpsScript.async = true;
        httpsScript.onload = (window as any).onYouTubeIframeAPIReady;
        httpsScript.onerror = () => {
          logger.error('🎵 YouTube DJ | Both HTTP and HTTPS API loading failed');
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
    logger.debug('🎵 YouTube DJ | YouTube API player ready');
    logger.debug('🎵 YouTube DJ | Player element exists:', !!this.element.querySelector('#youtube-player'));
    
    // Check if iframe was created this time
    const iframe = this.element.querySelector('#youtube-player iframe');
    logger.debug('🎵 YouTube DJ | Player iframe exists:', !!iframe);
    
    if (iframe) {
      logger.debug('🎵 YouTube DJ | SUCCESS! YouTube API created persistent iframe');
    } else {
      logger.warn('🎵 YouTube DJ | YouTube API ready but no iframe detected');
    }
    
    this.playerReady = true;
    this.playerInitializing = false;
    logger.debug('🎵 YouTube DJ | Player marked as ready with full API control');
    
    // Set default volume to 20%
    if (this.youtubePlayer) {
      this.youtubePlayer.setVolume(20);
      logger.debug('🎵 YouTube DJ | Set default volume to 20%');
    }
    
    // Execute any pending operations now that player is ready
    this._executePendingOperations();
    
    // Update UI elements without full re-render to preserve player
    this._updatePlayerStatusUI();
    this._updateTransportControls();
    this._updateQueueUI(); // Ensure current video is highlighted
    
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
      logger.error('🎵 YouTube DJ | No player div found during iframe debug');
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Starting iframe lifecycle debugging...');
    
    // Check current state
    const currentIframes = playerDiv.querySelectorAll('iframe');
    logger.debug(`🎵 YouTube DJ | Current iframes in player div: ${currentIframes.length}`);
    currentIframes.forEach((iframe, index) => {
      logger.debug(`🎵 YouTube DJ | Iframe ${index}:`, {
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
        logger.debug(`🎵 YouTube DJ | [${checkCount * 100}ms] Iframe count changed: ${currentIframes.length} -> ${newIframes.length}`);
        
        if (newIframes.length === 0) {
          logger.error('🎵 YouTube DJ | ALL IFRAMES DISAPPEARED!');
          logger.error('🎵 YouTube DJ | Player div content:', playerDiv.innerHTML);
          logger.debug('🎵 YouTube DJ | Iframe disappearance stack trace');
        }
      }
      
      // Check if iframes are visible
      newIframes.forEach((iframe, index) => {
        const rect = iframe.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;
        if (!isVisible && checkCount % 10 === 0) { // Log every second
          logger.warn(`🎵 YouTube DJ | [${checkCount * 100}ms] Iframe ${index} not visible:`, {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            display: getComputedStyle(iframe).display,
            visibility: getComputedStyle(iframe).visibility
          });
        }
      });
      
      if (checkCount >= maxChecks) {
        logger.debug('🎵 YouTube DJ | Iframe lifecycle monitoring complete');
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
                logger.error('🎵 YouTube DJ | YouTube player was REMOVED from DOM!');
                logger.error('🎵 YouTube DJ | Removed by:', mutation.target);
                logger.debug('🎵 YouTube DJ | Removal stack trace');
                
                // Immediately restore
                this._emergencyRestorePlayer(container);
              }
            }
          });
          
          // Also check if player just disappeared
          const hasPlayer = container.querySelector('#youtube-player');
          const hasIframe = container.querySelector('#youtube-player iframe');
          
          if (!hasPlayer && this.youtubePlayer && this.playerReady) {
            logger.warn('🎵 YouTube DJ | Player disappeared, emergency restore...');
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
    
    logger.debug('🎵 YouTube DJ | Aggressive container protection enabled');
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
            logger.debug('🎵 YouTube DJ | Allowing innerHTML change:', value.substring(0, 50) + '...');
            originalInnerHTML.set?.call(this, value);
          } else {
            logger.warn('🎵 YouTube DJ | BLOCKED innerHTML change that would remove player:', value.substring(0, 50) + '...');
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
          logger.error('🎵 YouTube DJ | BLOCKED attempt to remove YouTube player!');
          logger.debug('🎵 YouTube DJ | Removal attempt stack trace');
          return child; // Pretend we removed it but don't actually do it
        }
      }
      return originalRemoveChild.call(this, child);
    };
    
    logger.debug('🎵 YouTube DJ | Container DOM locked against modifications');
  }
  
  /**
   * Emergency restore of player when it disappears
   */
  private _emergencyRestorePlayer(container: Element): void {
    if (this.isRecreating) return;
    
    logger.debug('🎵 YouTube DJ | Emergency restore in progress...');
    
    // Find or create player div
    let playerDiv = container.querySelector('#youtube-player');
    if (!playerDiv) {
      playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-player';
      playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; position: relative; z-index: 1; background: black; border: 2px solid red;';
      container.appendChild(playerDiv);
      logger.debug('🎵 YouTube DJ | Created emergency player div');
    }
    
    // Try to restore YouTube functionality
    if (this.youtubePlayer) {
      try {
        const state = this.youtubePlayer.getPlayerState();
        logger.debug(`🎵 YouTube DJ | Player object still exists, state: ${state}`);
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Player object lost, flagging for recreation');
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
      logger.debug('🎵 YouTube DJ | Recreating player div after external removal');
      playerDiv = document.createElement('div');
      playerDiv.id = 'youtube-player';
      playerDiv.style.cssText = 'width: 560px; height: 315px; max-width: 100%; position: relative; z-index: 1;';
      container.appendChild(playerDiv);
      
      // The YouTube player object might still be valid, so we may not need to recreate it
      try {
        const state = this.youtubePlayer.getPlayerState();
        logger.debug(`🎵 YouTube DJ | Existing player still functional, state: ${state}`);
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Player object lost, will need recreation');
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
      logger.debug('🎵 YouTube DJ | Already recreating, skipping monitor');
      return;
    }
    
    let consecutiveFailures = 0;
    const maxFailures = 3;
    
    const monitor = setInterval(() => {
      // Only check if player element exists - iframe might load asynchronously
      const playerElement = this.element.querySelector('#youtube-player');
      
      if (!playerElement) {
        consecutiveFailures++;
        logger.warn(`🎵 YouTube DJ | Player element missing (${consecutiveFailures}/${maxFailures})`);
        
        if (consecutiveFailures >= maxFailures) {
          logger.error('🎵 YouTube DJ | Player element disappeared persistently!');
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
      logger.debug('🎵 YouTube DJ | Already recreating, ignoring duplicate request');
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Attempting to recreate player...');
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
        logger.warn('🎵 YouTube DJ | No player object');
        return false;
      }
      
      // Primary check: can we call the YouTube API?
      const state = this.youtubePlayer.getPlayerState();
      logger.debug(`🎵 YouTube DJ | Player API working, state: ${state}`);
      
      // If API works, player is functional - ignore DOM warnings
      return true;
    } catch (error) {
      logger.warn('🎵 YouTube DJ | Player API failed:', error);
      return false;
    }
  }

  /**
   * YouTube player state change callback
   */
  private _onPlayerStateChange(event: any): void {
    const states = ['ended', 'playing', 'paused', 'buffering', 'cued'];
    const stateName = states[event.data + 1] || 'unknown';
    logger.debug(`🎵 YouTube DJ | Player state: ${stateName}`);
    
    // MVP-U4: Auto-advance queue when video ends
    if (event.data === 0 && this.isDJ) { // 0 = ended
      logger.debug('🎵 YouTube DJ | Video ended, checking for auto-advance...');
      setTimeout(() => {
        this._autoAdvanceQueue();
      }, 1000); // Small delay to ensure state is stable
    }
    
    // Update UI if needed
    this._updatePlayerStatus();
  }

  /**
   * MVP-U4: Auto-advance to next video in queue when current video ends
   */
  private _autoAdvanceQueue(): void {
    if (!this.isDJ || this.queueState.items.length === 0) {
      return;
    }
    
    // Check if there's a next video in the queue
    const nextIndex = this.queueState.currentIndex + 1;
    if (nextIndex < this.queueState.items.length) {
      logger.debug('🎵 YouTube DJ | Auto-advancing to next video in queue');
      this._playNextInQueue();
    } else {
      logger.debug('🎵 YouTube DJ | Reached end of queue, no auto-advance');
      ui.notifications?.info('Queue finished - add more videos or manually restart');
    }
  }

  /**
   * YouTube player error callback
   */
  private _onPlayerError(event: any): void {
    logger.error('🎵 YouTube DJ | Player error event:', event);
    
    // Get current video ID if available
    let currentVideoId = null;
    try {
      if (this.youtubePlayer) {
        const videoData = this.youtubePlayer.getVideoData();
        currentVideoId = videoData?.video_id;
      }
    } catch (e) {
      // Ignore errors getting video data
    }
    
    // Use enhanced error handling
    this._handleYouTubeAPIError(event, currentVideoId);
  }

  /**
   * Extract YouTube video ID from URL
   */
  /**
   * Extract YouTube video ID from various URL formats with enhanced validation
   */
  private _extractVideoId(input: string): string | null {
    try {
      // Remove whitespace
      input = input.trim();
      
      // If it's already just an ID (11 characters)
      if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
        return input;
      }
      
      // Handle various YouTube URL formats including mobile and international
      const patterns = [
        // Standard YouTube URLs
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        // Mobile YouTube URLs
        /m\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
        // YouTube shorts
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        // International YouTube domains
        /youtube\.[a-z]{2,3}\/watch\?v=([a-zA-Z0-9_-]{11})/,
        // YouTube with additional parameters
        /youtube\.com\/watch\?.*[&?]v=([a-zA-Z0-9_-]{11})/
      ];
      
      for (const pattern of patterns) {
        const match = input.match(pattern);
        if (match && match[1]) {
          // Validate the extracted ID
          const videoId = match[1];
          if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            return videoId;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error extracting video ID:', error);
      return null;
    }
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

    // Ensure player is initialized before loading video
    this._ensurePlayerInitialized(() => {
      // Verify player is actually ready before loading
      if (!this._verifyPlayerAttachment()) {
        ui.notifications?.error('YouTube player not properly attached. Please wait and try again.');
        return;
      }

      logger.debug(`🎵 YouTube DJ | Loading video: ${videoId}`);
      
      // Add a small delay before the API call to let any pending operations finish
      setTimeout(() => {
        this._attemptVideoLoad(videoId, input, 0);
      }, 100);
    });
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
          logger.debug(`🎵 YouTube DJ | Player not ready, retry ${retryCount + 1}/${maxRetries}`);
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
      logger.debug(`🎵 YouTube DJ | Successfully loaded video via API: ${videoId}`);
      
      // Update title after a short delay to let YouTube load
      setTimeout(() => {
        this._updatePlayerStatusUI();
      }, 1000);
      
      // Broadcast LOAD message to sync with other clients
      if (this.isDJ) {
        logger.debug(`🎵 YouTube DJ | Broadcasting LOAD message to sync video: ${videoId}`);
        this._broadcastMessage({
          type: 'LOAD',
          data: { videoId },
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      }
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error loading video:', error);
      
      if (retryCount < maxRetries) {
        logger.debug(`🎵 YouTube DJ | Load failed, retry ${retryCount + 1}/${maxRetries}`);
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
    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can control playback');
      return;
    }

    // Ensure player is initialized before playing
    this._ensurePlayerInitialized(() => {
      try {
        this.youtubePlayer.playVideo();
        logger.debug('🎵 YouTube DJ | Play command sent via API');
        
        // Broadcast play command to other clients
        this._broadcastMessage({
          type: 'PLAY',
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error('🎵 YouTube DJ | Error playing video:', error);
        ui.notifications?.error('Failed to play video. Try again in a moment.');
      }
    });
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
      logger.debug('🎵 YouTube DJ | Pause command sent via API');
      
      // Broadcast pause command to other clients
      this._broadcastMessage({
        type: 'PAUSE',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error pausing video:', error);
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
      logger.warn('🎵 YouTube DJ | Error getting duration for seek preview:', error);
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
        logger.debug(`🎵 YouTube DJ | Seeking to ${seekTime.toFixed(1)}s (${percentage.toFixed(1)}%)`);
        
        // Broadcast seek command to other clients
        this._broadcastMessage({
          type: 'SEEK',
          data: { time: seekTime },
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
        
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error seeking video:', error);
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
      logger.warn('🎵 YouTube DJ | Error updating seek bar:', error);
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
      logger.debug('🎵 YouTube DJ | Player already exists, recreating...');
      // If player exists, recreate it
      this._recreatePlayer();
      return;
    }

    logger.debug('🎵 YouTube DJ | User joining session with consent...');
    
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
      
      // Re-render to show YouTube player container with hasJoinedSession: true
      this.render(true);
      
      // Initialize the YouTube player with user consent after render
      setTimeout(() => {
        this._initializeYouTubePlayer();
      }, 100);
      
      // Create session sections manually if they don't exist
      this._ensureSessionSectionsExist();
      
      // Update UI elements
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
      
      // MVP-U4: Create queue section dynamically after joining session
      this._ensureQueueSectionExists();
      
      // MVP-U6: Initialize MVP-U6 UI elements
      this._updateDJRequestsUI();
      
      ui.notifications?.info('Joining session... YouTube player will load momentarily.');
      logger.debug('🎵 YouTube DJ | Session joined with user consent');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to join session:', error);
      ui.notifications?.error('Failed to join session. Please try again.');
    }
  }


  /**
   * Handle claim DJ button click
   */
  private _onClaimDJClick(): void {
    logger.debug(`🎵 YouTube DJ | Claim DJ clicked - hasJoinedSession: ${this.hasJoinedSession}, isDJ: ${this.isDJ}, djUserId: ${this.djUserId}`);
    
    if (!this.hasJoinedSession) {
      ui.notifications?.warn('Please join the session first');
      return;
    }
    
    if (this.isDJ) {
      ui.notifications?.info('You are already the DJ');
      return;
    }
    
    if (this.djUserId && this.djUserId !== game.user?.id) {
      logger.debug(`🎵 YouTube DJ | Cannot claim DJ - current DJ is ${this.djUserId}, user is ${game.user?.id}`);
      ui.notifications?.warn('Someone else is already the DJ. They need to release the role first.');
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Attempting to claim DJ role manually...');
    this.isDJ = true;
    this.djUserId = game.user?.id || '';
    
    // Save to world state
    this._saveWorldState();
    
    this._broadcastMessage({
      type: 'DJ_CLAIM',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    logger.debug('🎵 YouTube DJ | Claimed DJ role manually');
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
    
    logger.debug('🎵 YouTube DJ | Releasing DJ role...');
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
   * MVP-U4: Handle add to queue button click
   */
  private _onAddToQueueClick(): void {
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

    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can add videos to the queue');
      return;
    }

    this._addToQueue(videoId, input.value.trim());
    input.value = ''; // Clear input
  }

  /**
   * MVP-U4: Handle next button click
   */
  private _onNextClick(): void {
    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can control the queue');
      return;
    }

    this._playNextInQueue();
  }

  /**
   * MVP-U4: Handle remove from queue button click
   */
  private _onRemoveQueueClick(event: Event): void {
    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can remove videos from the queue');
      return;
    }

    const button = event.target as HTMLButtonElement;
    const queueId = button.dataset.queueId;
    if (queueId) {
      this._removeFromQueue(queueId);
    }
  }

  /**
   * Handle close button click
   */
  private _onCloseClick(): void {
    this.close();
  }


  
  
  /**
   * MVP-U6: Handle request DJ button click
   */
  private _onRequestDJClick(): void {
    if (!this.hasJoinedSession) {
      ui.notifications?.warn('Please join the session first');
      return;
    }
    
    if (this.isDJ) {
      ui.notifications?.info('You are already the DJ');
      return;
    }
    
    if (!this.djUserId) {
      // No DJ exists, claim directly
      this._onClaimDJClick();
      return;
    }
    
    // Send DJ request to current DJ
    logger.debug('🎵 YouTube DJ | Requesting DJ role...');
    
    this._broadcastMessage({
      type: 'DJ_REQUEST',
      data: { 
        requesterId: game.user?.id,
        requesterName: game.user?.name 
      },
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    ui.notifications?.info('DJ role requested. Waiting for current DJ to respond...');
  }
  
  /**
   * MVP-U6: Handle handoff DJ button click
   */
  private _onHandoffDJClick(): void {
    if (!this.isDJ) {
      ui.notifications?.warn('Only the DJ can hand off the role');
      return;
    }
    
    if (this.sessionMembers.length < 2) {
      ui.notifications?.warn('No other users available to hand off DJ role');
      return;
    }
    
    // Show dialog to select who to hand off to
    this._showHandoffDialog();
  }
  
  /**
   * MVP-U6: Handle mute player button click
   */
  private _onMutePlayerClick(): void {
    this.isPlayerMuted = !this.isPlayerMuted;
    
    if (this.youtubePlayer) {
      if (this.isPlayerMuted) {
        this.youtubePlayer.mute();
        ui.notifications?.info('Player muted');
      } else {
        this.youtubePlayer.unMute();
        ui.notifications?.info('Player unmuted');
      }
    }
    
    // Update all mute buttons (in case there are multiple)
    const muteBtns = this.element.querySelectorAll('.mute-player-btn');
    muteBtns.forEach(muteBtn => {
      const icon = muteBtn.querySelector('i');
      if (icon) {
        icon.className = this.isPlayerMuted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
      }
      muteBtn.setAttribute('title', this.isPlayerMuted ? 'Unmute Player' : 'Mute Player');
      
      // Update button icon only (no text labels)
      muteBtn.innerHTML = `
        <i class="fas ${this.isPlayerMuted ? 'fa-volume-mute' : 'fa-volume-up'}"></i>
      `;
    });
  }
  
  /**
   * MVP-U6: Handle GM override button click
   */
  private _onGMOverrideClick(): void {
    if (!game.user?.isGM) {
      ui.notifications?.error('Only GMs can override DJ control');
      return;
    }
    
    logger.debug('🎵 YouTube DJ | GM override - taking DJ control');
    
    // Force claim DJ role
    const previousDJ = this.djUserId;
    this.isDJ = true;
    this.djUserId = game.user?.id || '';
    
    // Save to world state
    this._saveWorldState();
    
    this._broadcastMessage({
      type: 'GM_OVERRIDE',
      data: { 
        previousDJ,
        newDJ: this.djUserId 
      },
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    // Update UI
    this._updateDJControls();
    this._updateDJStatusHeader();
    this._updateTransportControls();
    this._updateSessionMembersUI();
    
    ui.notifications?.success('GM override: DJ control taken');
  }
  
  /**
   * MVP-U6: Handle approve DJ request button click
   */
  private _onApproveDJRequestClick(event: Event): void {
    const button = event.target as HTMLButtonElement;
    const requesterId = button.dataset.requesterId;
    
    if (!requesterId) {
      logger.error('🎵 YouTube DJ | No requester ID found on approve button');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Approving DJ request from ${requesterId}`);
    
    // Hand off DJ role
    this._handoffDJToUser(requesterId);
    
    // Remove the request
    this._removeDJRequest(requesterId);
  }
  
  /**
   * MVP-U6: Handle deny DJ request button click
   */
  private _onDenyDJRequestClick(event: Event): void {
    const button = event.target as HTMLButtonElement;
    const requesterId = button.dataset.requesterId;
    
    if (!requesterId) {
      logger.error('🎵 YouTube DJ | No requester ID found on deny button');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Denying DJ request from ${requesterId}`);
    
    // Remove the request
    this._removeDJRequest(requesterId);
    
    // Notify the requester
    // Note: In a full implementation, you'd send a denial message
    ui.notifications?.info('DJ request denied');
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
      logger.debug('🎵 YouTube DJ | Container protection disabled');
    }
    
    // Clean up YouTube player
    if (this.youtubePlayer) {
      try {
        this.youtubePlayer.destroy();
        logger.debug('🎵 YouTube DJ | YouTube player destroyed');
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Player cleanup error (expected)');
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
    const videoTitleElement = this.element.querySelector('.player-info h3');
    if (videoTitleElement && this.youtubePlayer && this.playerReady) {
      try {
        // Try to get video data, but don't fail if it's not available
        const videoData = this.youtubePlayer.getVideoData();
        if (videoData && videoData.title) {
          videoTitleElement.textContent = videoData.title;
        }
      } catch (error) {
        // Video data might not be available yet, that's OK
        logger.debug('🎵 YouTube DJ | Video data not yet available');
      }
    }
    
    // Also update from queue state if available
    if (!videoTitleElement?.textContent || videoTitleElement.textContent === 'No video loaded') {
      const currentVideo = this.queueState.items[this.queueState.currentIndex];
      if (currentVideo && videoTitleElement) {
        const videoTitle = currentVideo.title || currentVideo.videoId;
        videoTitleElement.textContent = videoTitle;
      }
    }
    
    logger.debug('🎵 YouTube DJ | UI status updated without re-render');
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
    logger.debug('🎵 YouTube DJ | Initializing socket communication...');
    logger.debug(`🎵 YouTube DJ | Socket channel: ${YouTubeDJApp.SOCKET_NAME}`);
    logger.debug(`🎵 YouTube DJ | Current user: ${game.user?.name} (${game.user?.id})`);
    logger.debug(`🎵 YouTube DJ | Socket instance:`, game.socket);
    logger.debug(`🎵 YouTube DJ | Socket connected:`, game.socket?.connected);
    logger.debug(`🎵 YouTube DJ | All users in world:`, Array.from(game.users?.values() || []).map(u => ({id: u.id, name: u.name, active: u.active})));
    logger.debug(`🎵 YouTube DJ | World ID:`, game.world?.id);
    logger.debug(`🎵 YouTube DJ | Game session:`, game.sessionId);
    logger.debug(`🎵 YouTube DJ | Socket ID:`, game.socket?.id);
    
    // Set up socket listener
    game.socket?.on(YouTubeDJApp.SOCKET_NAME, this._onSocketMessage.bind(this));
    
    // Also listen to system socket for testing
    game.socket?.on('system', (data: any) => {
      if (data.type === 'test' && data.data?.userId !== game.user?.id) {
        logger.debug('🎵 YouTube DJ | Received basic socket test from:', data.data);
      }
    });
    
    // Listen to fallback channel
    game.socket?.on('module.bardic-inspiration.fallback', (data: any) => {
      logger.debug('🎵 YouTube DJ | Received FALLBACK message:', data);
      if (data.bardic_dj_message && data.bardic_dj_message.userId !== game.user?.id) {
        logger.debug('🎵 YouTube DJ | Processing fallback message...');
        this._onSocketMessage(data.bardic_dj_message);
      }
    });
    
    // MVP-U5: Set up connection monitoring and recovery
    this._setupConnectionMonitoring();
    
    this.isConnected = true;
    
    // Test basic socket functionality
    logger.debug('🎵 YouTube DJ | Testing socket with ping message...');
    setTimeout(() => {
      // First test with our custom channel
      this._broadcastMessage({
        type: 'PING' as any,
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      // Also test with a direct socket emit to see if basic socket works
      logger.debug('🎵 YouTube DJ | Testing basic socket.emit...');
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
    
    logger.debug('🎵 YouTube DJ | Socket communication initialized');
  }

  /**
   * Load world-level state
   */
  private _loadWorldState(): void {
    logger.debug('🎵 YouTube DJ | Loading world state...');
    
    try {
      // Load DJ state from world settings
      const worldDJ = game.settings.get('core', YouTubeDJApp.WORLD_DJ_SETTING) as string | null;
      const worldMembers = game.settings.get('core', YouTubeDJApp.WORLD_MEMBERS_SETTING) as Array<{id: string, name: string, isDJ: boolean}> | null;
      
      if (worldDJ) {
        const djUser = game.users?.get(worldDJ);
        const djActive = djUser?.active;
        logger.debug(`🎵 YouTube DJ | Found existing DJ in world: ${worldDJ} (${djUser?.name}), active: ${djActive}`);
        
        if (djActive) {
          this.djUserId = worldDJ;
          this.isDJ = worldDJ === game.user?.id;
          logger.debug(`🎵 YouTube DJ | Loaded DJ state - Current user is DJ: ${this.isDJ}`);
        } else {
          logger.debug(`🎵 YouTube DJ | Previous DJ ${worldDJ} is inactive, clearing DJ state`);
          this.djUserId = null;
          this.isDJ = false;
        }
      }
      
      if (worldMembers && Array.isArray(worldMembers)) {
        logger.debug(`🎵 YouTube DJ | Found existing session members:`, worldMembers);
        this.sessionMembers = worldMembers;
      }
      
      // MVP-U5: Load queue state with validation
      const worldQueue = game.settings.get('core', YouTubeDJApp.WORLD_QUEUE_SETTING) as QueueState | null;
      if (worldQueue && this._validateQueueState(worldQueue)) {
        logger.debug(`🎵 YouTube DJ | Found existing queue:`, worldQueue);
        this.queueState = worldQueue;
      } else if (worldQueue) {
        logger.warn('🎵 YouTube DJ | Invalid queue state found, resetting to default');
        this._resetQueueState();
      }
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error loading world state:', error);
      ui.notifications?.warn('Failed to load some session data - using defaults');
      this._resetQueueState();
    }
  }

  /**
   * MVP-U5: Validate queue state structure
   */
  private _validateQueueState(queueState: any): boolean {
    if (!queueState || typeof queueState !== 'object') {
      return false;
    }
    
    if (!Array.isArray(queueState.items)) {
      return false;
    }
    
    if (typeof queueState.currentIndex !== 'number') {
      return false;
    }
    
    if (typeof queueState.mode !== 'string') {
      return false;
    }
    
    // Validate each queue item
    for (const item of queueState.items) {
      if (!item.id || !item.videoId || !item.addedBy || typeof item.addedAt !== 'number') {
        return false;
      }
    }
    
    return true;
  }

  /**
   * MVP-U5: Reset queue state to default
   */
  private _resetQueueState(): void {
    this.queueState = {
      items: [],
      currentIndex: -1,
      mode: 'single-dj',
      djUserId: this.djUserId
    };
    logger.debug('🎵 YouTube DJ | Queue state reset to default');
  }

  /**
   * Save current state to world settings (with GM fallback handling)
   */
  private _saveWorldState(): void {
    logger.debug('🎵 YouTube DJ | Saving world state...');
    
    // Try to save directly if user is GM
    if (game.user?.isGM) {
      try {
        game.settings.set('core', YouTubeDJApp.WORLD_DJ_SETTING, this.djUserId);
        game.settings.set('core', YouTubeDJApp.WORLD_MEMBERS_SETTING, this.sessionMembers);
        game.settings.set('core', YouTubeDJApp.WORLD_QUEUE_SETTING, this.queueState);
        logger.debug('🎵 YouTube DJ | World state saved by GM');
        return;
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to save world state as GM:', error);
      }
    }
    
    // MVP-U6: Fallback - request any active GM to save state
    const activeGMs = Array.from(game.users?.values() || []).filter(user => user.isGM && user.active);
    
    if (activeGMs.length > 0) {
      logger.debug(`🎵 YouTube DJ | Non-GM user, requesting GM to save state (${activeGMs.length} active GMs)`);
      
      // Broadcast state save request to GMs
      this._broadcastMessage({
        type: 'STATE_SAVE_REQUEST' as any,
        data: {
          djUserId: this.djUserId,
          sessionMembers: this.sessionMembers,
          queueState: this.queueState
        },
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
    } else {
      logger.debug('🎵 YouTube DJ | No active GMs available, state changes will be temporary');
      // Note: In a production system, you might want to queue state changes
      // and save them when a GM becomes available
    }
  }

  /**
   * Request current session state from other users
   */
  private _requestSessionState(): void {
    logger.debug('🎵 YouTube DJ | Requesting session state from other users...');
    
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
    logger.debug('🎵 YouTube DJ | Requesting sync state as late joiner...');
    
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
        logger.debug(`🎵 YouTube DJ | Current DJ ${this.djUserId} is inactive, claiming role...`);
      } else {
        logger.debug('🎵 YouTube DJ | No DJ found, attempting to claim DJ role...');
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
      
      logger.debug('🎵 YouTube DJ | Claimed DJ role');
      
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
      logger.debug(`🎵 YouTube DJ | DJ role not claimed - isDJ: ${this.isDJ}, djUserId: ${this.djUserId}, currentDJActive: ${currentDJActive}`);
    }
  }

  /**
   * Handle incoming socket messages
   */
  private _onSocketMessage(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Received socket message:', message);
    logger.debug(`🎵 YouTube DJ | Message from: ${message.userId}, Current user: ${game.user?.id}`);
    logger.debug(`🎵 YouTube DJ | All connected users:`, Array.from(game.users?.values() || []).map(u => ({id: u.id, name: u.name, active: u.active})));
    
    // Ignore messages from self
    if (message.userId === game.user?.id) {
      logger.debug('🎵 YouTube DJ | Ignoring message from self');
      return;
    }

    logger.debug(`🎵 YouTube DJ | Processing message type: ${message.type}`);

    switch (message.type) {
      case 'STATE_REQUEST':
        this._handleStateRequest(message);
        break;
      case 'STATE_RESPONSE':
        this._handleStateResponse(message);
        break;
      case 'STATE_SAVE_REQUEST':
        this._handleStateSaveRequest(message);
        break;
      case 'DJ_CLAIM':
        this._handleDJClaim(message);
        break;
      case 'DJ_RELEASE':
        this._handleDJRelease(message);
        break;
      case 'DJ_REQUEST':
        this._handleDJRequest(message);
        break;
      case 'DJ_HANDOFF':
        this._handleDJHandoff(message);
        break;
      case 'GM_OVERRIDE':
        this._handleGMOverride(message);
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
      case 'QUEUE_ADD':
        this._handleQueueAdd(message);
        break;
      case 'QUEUE_REMOVE':
        this._handleQueueRemove(message);
        break;
      case 'QUEUE_NEXT':
        this._handleQueueNext(message);
        break;
      case 'QUEUE_UPDATE':
        this._handleQueueUpdate(message);
        break;
      case 'PING':
        logger.debug(`🎵 YouTube DJ | PING received from ${message.userId}!`);
        break;
      default:
        logger.debug(`🎵 YouTube DJ | Unknown message type: ${message.type}`);
        break;
    }
  }

  /**
   * Handle state request message
   */
  private _handleStateRequest(message: YouTubeDJMessage): void {
    logger.debug(`🎵 YouTube DJ | Sending state response to ${message.userId}`);
    
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
        
        logger.debug(`🎵 YouTube DJ | Including playback state in response: ${isPlaying ? 'PLAYING' : 'PAUSED'} at ${currentTime.toFixed(1)}s`);
      } catch (error) {
        logger.warn('🎵 YouTube DJ | Error getting playback state for response:', error);
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
    logger.debug(`🎵 YouTube DJ | Received state response:`, message.data);
    
    if (message.data) {
      // Update local state with received state
      if (message.data.djUserId && !this.djUserId) {
        this.djUserId = message.data.djUserId;
        this.isDJ = this.djUserId === game.user?.id;
        logger.debug(`🎵 YouTube DJ | Updated DJ from state response: ${this.djUserId}`);
      }
      
      if (message.data.sessionMembers && Array.isArray(message.data.sessionMembers)) {
        // Merge session members, avoiding duplicates
        message.data.sessionMembers.forEach((member: any) => {
          const existingIndex = this.sessionMembers.findIndex(m => m.id === member.id);
          if (existingIndex === -1) {
            this.sessionMembers.push(member);
          }
        });
        logger.debug(`🎵 YouTube DJ | Updated session members from state response`);
      }
      
      // MVP-U5: Handle queue state recovery
      if (message.data.queueState && this._validateQueueState(message.data.queueState)) {
        logger.debug('🎵 YouTube DJ | Recovering queue state from peer');
        this.queueState = message.data.queueState;
        this._updateQueueUI();
      }
      
      // MVP-U3: Handle late joiner sync with current playback state
      if (message.data.currentPlayback && !this.isDJ && this.playerReady && this.youtubePlayer) {
        const playback = message.data.currentPlayback;
        logger.debug(`🎵 YouTube DJ | Late joiner sync - Loading ${playback.videoId} at ${playback.currentTime.toFixed(1)}s`);
        
        try {
          // Load the video and seek to current position
          if (playback.videoId) {
            this.youtubePlayer.loadVideoById(playback.videoId, playback.currentTime);
            
            // Set playing state after load
            setTimeout(() => {
              if (playback.isPlaying) {
                this.youtubePlayer.playVideo();
                logger.debug('🎵 YouTube DJ | Late joiner sync - Started playback');
              } else {
                this.youtubePlayer.pauseVideo();
                logger.debug('🎵 YouTube DJ | Late joiner sync - Paused');
              }
            }, 500);
            
            ui.notifications?.info('Synced with ongoing session!');
          }
        } catch (error) {
          logger.error('🎵 YouTube DJ | Error during late joiner sync:', error);
          ui.notifications?.warn('Failed to sync video playback');
        }
      }
      
      // Save updated state and refresh UI
      try {
        this._saveWorldState();
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to save recovered state:', error);
      }
      
      this._updateSessionMembersUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
    }
  }

  /**
   * MVP-U6: Handle state save request from non-GM users
   */
  private _handleStateSaveRequest(message: YouTubeDJMessage): void {
    // Only GMs should handle state save requests
    if (!game.user?.isGM) {
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Received state save request from ${message.userId}`);
    
    if (message.data) {
      try {
        // Save the provided state to world settings
        if (message.data.djUserId !== undefined) {
          game.settings.set('core', YouTubeDJApp.WORLD_DJ_SETTING, message.data.djUserId);
        }
        if (message.data.sessionMembers) {
          game.settings.set('core', YouTubeDJApp.WORLD_MEMBERS_SETTING, message.data.sessionMembers);
        }
        if (message.data.queueState) {
          game.settings.set('core', YouTubeDJApp.WORLD_QUEUE_SETTING, message.data.queueState);
        }
        
        logger.debug(`🎵 YouTube DJ | GM saved state on behalf of ${game.users?.get(message.userId)?.name}`);
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to save state on behalf of non-GM:', error);
      }
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
      logger.debug(`🎵 YouTube DJ | DJ role claimed by: ${game.users?.get(message.userId)?.name}`);
      
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
    logger.debug(`🎵 YouTube DJ | Received DJ_RELEASE from ${message.userId}, current DJ: ${this.djUserId}`);
    
    if (this.djUserId === message.userId) {
      this.djUserId = null;
      this.isDJ = false;
      logger.debug('🎵 YouTube DJ | DJ role released, updating local state');
      
      // Save to world state
      this._saveWorldState();
      
      // Stop heartbeat if this user lost DJ role
      this._stopHeartbeat();
      
      this._updatePlayerStatusUI();
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateSessionMembersUI();
    } else {
      logger.debug(`🎵 YouTube DJ | DJ_RELEASE ignored - not from current DJ (${this.djUserId} vs ${message.userId})`);
    }
  }

  /**
   * MVP-U6: Handle DJ request message
   */
  private _handleDJRequest(message: YouTubeDJMessage): void {
    // Only the current DJ should handle DJ requests
    if (!this.isDJ) {
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Received DJ request from ${message.userId}`);
    
    const requesterUser = game.users?.get(message.userId);
    if (!requesterUser) {
      logger.warn('🎵 YouTube DJ | DJ request from unknown user');
      return;
    }
    
    // Add to requests list if not already present
    const existingRequest = this.djRequests.find(req => req.userId === message.userId);
    if (!existingRequest) {
      this.djRequests.push({
        userId: message.userId,
        userName: requesterUser.name || 'Unknown',
        timestamp: Date.now()
      });
      
      // Update UI to show the request
      this._updateDJRequestsUI();
      
      // Notify current DJ
      ui.notifications?.info(`${requesterUser.name} is requesting DJ role`);
    }
  }

  /**
   * MVP-U6: Handle DJ handoff message
   */
  private _handleDJHandoff(message: YouTubeDJMessage): void {
    logger.debug(`🎵 YouTube DJ | Received DJ handoff from ${message.userId} to ${message.data?.newDJ}`);
    
    if (message.data?.newDJ === game.user?.id) {
      // This user is receiving DJ role
      this.isDJ = true;
      this.djUserId = game.user?.id || '';
      
      // Start heartbeat if we have a ready player
      if (this.playerReady) {
        this._startHeartbeat();
      }
      
      // Update UI
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
      
      const previousDJUser = game.users?.get(message.userId);
      ui.notifications?.success(`You are now the DJ (handed off by ${previousDJUser?.name || 'Unknown'})`);
    } else {
      // Update state for other users
      this.djUserId = message.data?.newDJ || null;
      this.isDJ = false;
      
      // Update UI
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
    }
  }

  /**
   * MVP-U6: Handle GM override message
   */
  private _handleGMOverride(message: YouTubeDJMessage): void {
    logger.debug(`🎵 YouTube DJ | Received GM override from ${message.userId}`);
    
    // Verify sender is actually a GM
    const gmUser = game.users?.get(message.userId);
    if (!gmUser?.isGM) {
      logger.warn('🎵 YouTube DJ | Non-GM user attempted override - ignoring');
      return;
    }
    
    // Update DJ state
    const newDJ = message.data?.newDJ;
    if (newDJ) {
      this.djUserId = newDJ;
      this.isDJ = (newDJ === game.user?.id);
      
      // Start or stop heartbeat based on new role
      if (this.isDJ && this.playerReady) {
        this._startHeartbeat();
      } else {
        this._stopHeartbeat();
      }
      
      // Update UI
      this._updateDJControls();
      this._updateDJStatusHeader();
      this._updateTransportControls();
      this._updateSessionMembersUI();
      
      const gmName = gmUser.name || 'GM';
      if (this.isDJ) {
        ui.notifications?.success(`GM ${gmName} has made you the DJ`);
      } else {
        const newDJUser = game.users?.get(newDJ);
        ui.notifications?.info(`GM ${gmName} has made ${newDJUser?.name || 'Unknown'} the DJ`);
      }
    }
  }

  /**
   * Handle remote play command
   */
  private _handleRemotePlay(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady) {
      logger.debug('🎵 YouTube DJ | Executing remote PLAY command');
      this.youtubePlayer.playVideo();
    }
  }

  /**
   * Handle remote pause command
   */
  private _handleRemotePause(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady) {
      logger.debug('🎵 YouTube DJ | Executing remote PAUSE command');
      this.youtubePlayer.pauseVideo();
    }
  }

  /**
   * Handle remote seek command
   */
  private _handleRemoteSeek(message: YouTubeDJMessage): void {
    if (!this.isDJ && this.youtubePlayer && this.playerReady && message.data?.time) {
      logger.debug('🎵 YouTube DJ | Executing remote SEEK command to:', message.data.time);
      this.youtubePlayer.seekTo(message.data.time, true);
    }
  }

  /**
   * Handle remote load command
   */
  private _handleRemoteLoad(message: YouTubeDJMessage): void {
    if (!this.isDJ && message.data?.videoId) {
      logger.debug('🎵 YouTube DJ | Executing remote LOAD command for:', message.data.videoId);
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
        logger.debug(`🎵 YouTube DJ | User joined session: ${user.name}`);
        
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
      logger.debug(`🎵 YouTube DJ | User left session: ${member.name}`);
      
      // MVP-U6: Handle DJ leaving without handoff
      if (this.djUserId === message.userId) {
        logger.debug('🎵 YouTube DJ | DJ left without handoff - initiating auto-recovery');
        
        // Clear DJ state
        this.djUserId = null;
        this.isDJ = false;
        
        // Stop heartbeat if this was the local DJ
        this._stopHeartbeat();
        
        // Find next available user to become DJ
        this._initiateAutoRecovery();
        
        ui.notifications?.warn('DJ left the session. Auto-recovery in progress...');
      }
      
      this._updateSessionMembersUI();
    }
  }
  
  /**
   * MVP-U6: Initiate auto-recovery when DJ leaves without handoff
   */
  private _initiateAutoRecovery(): void {
    logger.debug('🎵 YouTube DJ | Initiating DJ auto-recovery...');
    
    // Wait a moment to see if anyone else claims DJ role
    setTimeout(() => {
      if (!this.djUserId && this.sessionMembers.length > 0) {
        // Try to claim DJ role if we're still in session
        if (this.hasJoinedSession) {
          logger.debug('🎵 YouTube DJ | Auto-claiming DJ role after previous DJ left');
          
          this.isDJ = true;
          this.djUserId = game.user?.id || '';
          
          // Save to world state
          this._saveWorldState();
          
          this._broadcastMessage({
            type: 'DJ_CLAIM',
            userId: game.user?.id || '',
            timestamp: Date.now()
          });
          
          // Update UI
          this._updateDJControls();
          this._updateDJStatusHeader();
          this._updateTransportControls();
          this._updateSessionMembersUI();
          
          // Start heartbeat if player is ready
          if (this.playerReady) {
            this._startHeartbeat();
          }
          
          ui.notifications?.success('You are now the DJ (auto-recovery)');
        }
      }
    }, 2000); // 2 second delay to allow for race conditions
  }

  /**
   * MVP-U3: Start heartbeat system for DJ
   */
  private _startHeartbeat(): void {
    // Clear any existing heartbeat
    this._stopHeartbeat();
    
    if (!this.isDJ) {
      logger.debug('🎵 YouTube DJ | Not DJ, skipping heartbeat start');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Starting heartbeat system (${this.heartbeatFrequency}ms interval)`);
    
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
      logger.debug('🎵 YouTube DJ | Heartbeat stopped');
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
      
      logger.debug(`🎵 YouTube DJ | Heartbeat sent - ${isPlaying ? 'PLAYING' : 'PAUSED'} at ${currentTime.toFixed(1)}s`);
      
    } catch (error) {
      logger.warn('🎵 YouTube DJ | Error sending heartbeat:', error);
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
      logger.warn('🎵 YouTube DJ | Invalid heartbeat data received');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Heartbeat received - ${heartbeat.isPlaying ? 'PLAYING' : 'PAUSED'} at ${heartbeat.currentTime.toFixed(1)}s`);
    
    try {
      // Check if we need to sync video
      const currentVideoData = this.youtubePlayer.getVideoData();
      if (currentVideoData?.video_id !== heartbeat.videoId && heartbeat.videoId) {
        logger.debug(`🎵 YouTube DJ | Video sync needed: ${currentVideoData?.video_id} -> ${heartbeat.videoId}`);
        this.youtubePlayer.loadVideoById(heartbeat.videoId, heartbeat.currentTime);
        return;
      }
      
      // Get current local state
      const localTime = this.youtubePlayer.getCurrentTime();
      const localState = this.youtubePlayer.getPlayerState();
      const localIsPlaying = localState === 1;
      
      // Calculate drift
      const timeDrift = Math.abs(localTime - heartbeat.currentTime);
      
      logger.debug(`🎵 YouTube DJ | Sync check - Local: ${localTime.toFixed(1)}s, Remote: ${heartbeat.currentTime.toFixed(1)}s, Drift: ${timeDrift.toFixed(1)}s`);
      
      // Sync playback state if different
      if (localIsPlaying !== heartbeat.isPlaying) {
        logger.debug(`🎵 YouTube DJ | Playback state sync: ${localIsPlaying ? 'PLAYING' : 'PAUSED'} -> ${heartbeat.isPlaying ? 'PLAYING' : 'PAUSED'}`);
        if (heartbeat.isPlaying) {
          this.youtubePlayer.playVideo();
        } else {
          this.youtubePlayer.pauseVideo();
        }
      }
      
      // Drift correction - seek if out of tolerance
      if (timeDrift > this.driftTolerance) {
        logger.debug(`🎵 YouTube DJ | Drift correction: seeking from ${localTime.toFixed(1)}s to ${heartbeat.currentTime.toFixed(1)}s (drift: ${timeDrift.toFixed(1)}s)`);
        this.youtubePlayer.seekTo(heartbeat.currentTime, true);
      }
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error processing heartbeat:', error);
    }
  }

  /**
   * MVP-U4: Add video to queue
   */
  private _addToQueue(videoId: string, originalUrl: string): void {
    try {
      // MVP-U5: Enhanced input validation
      if (!videoId || videoId.trim() === '') {
        throw new Error('Invalid video ID');
      }
      
      // Validate video ID format (YouTube video IDs are 11 characters)
      const cleanVideoId = videoId.trim();
      if (!/^[a-zA-Z0-9_-]{11}$/.test(cleanVideoId)) {
        throw new Error('Invalid YouTube video ID format');
      }
      
      // Check for duplicates
      const existingItem = this.queueState.items.find(item => item.videoId === cleanVideoId);
      if (existingItem) {
        ui.notifications?.warn(`Video already in queue: ${cleanVideoId}`);
        return;
      }
      
      // Check queue size limit
      const MAX_QUEUE_SIZE = 50;
      if (this.queueState.items.length >= MAX_QUEUE_SIZE) {
        ui.notifications?.error(`Queue is full (max ${MAX_QUEUE_SIZE} videos)`);
        return;
      }
      
      // Check estimated queue duration (assuming average 4 minutes per video)
      const estimatedDuration = this.queueState.items.length * 4; // minutes
      const MAX_QUEUE_DURATION = 240; // 4 hours
      if (estimatedDuration >= MAX_QUEUE_DURATION) {
        ui.notifications?.warn(`Queue duration limit reached (${MAX_QUEUE_DURATION/60} hours max)`);
        return;
      }
      
      const videoItem: VideoItem = {
        id: foundry.utils.randomID(),
        videoId: cleanVideoId,
        title: undefined, // Will be fetched later if needed
        thumbnail: `https://img.youtube.com/vi/${cleanVideoId}/default.jpg`,
        addedBy: game.user?.name || 'Unknown',
        addedAt: Date.now()
      };
      
      // Attempt to fetch video title asynchronously
      this._fetchVideoTitle(cleanVideoId, videoItem.id);
      
      this.queueState.items.push(videoItem);
      logger.debug(`🎵 YouTube DJ | Added to queue: ${videoId}`);
      
      // Save to world state with error handling
      try {
        this._saveWorldState();
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to save queue state:', error);
        ui.notifications?.warn('Queue saved locally but may not sync to other clients');
      }
      
      // Broadcast queue update with retry
      this._broadcastMessageWithRetry({
        type: 'QUEUE_ADD',
        data: { videoItem },
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      // Update UI
      this._updateQueueUI();
      
      ui.notifications?.success(`Added to queue: ${cleanVideoId}`);
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error adding to queue:', error);
      
      // Provide user-friendly error messages
      let userMessage = 'Failed to add video to queue';
      if (error.message.includes('Invalid')) {
        userMessage = 'Please enter a valid YouTube URL or video ID';
      } else if (error.message.includes('Queue is full')) {
        userMessage = error.message;
      } else if (error.message.includes('duration limit')) {
        userMessage = error.message;
      }
      
      ui.notifications?.error(userMessage);
    }
  }

  /**
   * MVP-U4: Remove video from queue
   */
  private _removeFromQueue(queueId: string): void {
    try {
      const index = this.queueState.items.findIndex(item => item.id === queueId);
      if (index === -1) {
        logger.warn(`🎵 YouTube DJ | Queue item not found: ${queueId}`);
        ui.notifications?.warn('Video not found in queue');
        return;
      }
      
      const removedItem = this.queueState.items.splice(index, 1)[0];
      
      // Adjust current index if needed
      if (index <= this.queueState.currentIndex) {
        if (this.queueState.currentIndex > 0) {
          this.queueState.currentIndex--;
        } else if (index === this.queueState.currentIndex) {
          // If we removed the current video, reset index
          this.queueState.currentIndex = -1;
        }
      }
      
      logger.debug(`🎵 YouTube DJ | Removed from queue: ${removedItem.videoId}`);
      
      // Save to world state with error handling
      try {
        this._saveWorldState();
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to save queue state:', error);
        ui.notifications?.warn('Queue updated locally but may not sync to other clients');
      }
      
      // Broadcast queue update with retry
      this._broadcastMessageWithRetry({
        type: 'QUEUE_REMOVE',
        data: { queueId, index },
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      // Update UI
      this._updateQueueUI();
      
      ui.notifications?.success(`Removed from queue: ${removedItem.videoId}`);
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error removing from queue:', error);
      ui.notifications?.error(`Failed to remove video from queue: ${error.message}`);
    }
  }

  /**
   * MVP-U4: Play next video in queue
   */
  private _playNextInQueue(): void {
    if (this.queueState.items.length === 0) {
      ui.notifications?.warn('Queue is empty');
      return;
    }
    
    // Move to next video
    this.queueState.currentIndex++;
    
    // Check if we've reached the end - loop back to beginning
    if (this.queueState.currentIndex >= this.queueState.items.length) {
      this.queueState.currentIndex = 0;
      ui.notifications?.info('Queue reached end - restarting from beginning');
      logger.debug('🎵 YouTube DJ | Queue looped back to beginning');
    }
    
    const currentVideo = this.queueState.items[this.queueState.currentIndex];
    logger.debug(`🎵 YouTube DJ | Playing next in queue: ${currentVideo.videoId}`);
    
    // Load and play the video (ensure player is initialized first)
    this._ensurePlayerInitialized(() => {
      if (this.youtubePlayer && this.playerReady) {
        this.youtubePlayer.loadVideoById(currentVideo.videoId);
        
        // Update UI after load
        setTimeout(() => {
          this._updatePlayerStatusUI();
        }, 1000);
        
        // Also broadcast load to sync video
        this._broadcastMessage({
          type: 'LOAD',
          data: { videoId: currentVideo.videoId },
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      }
    });
    
    // Save to world state
    this._saveWorldState();
    
    // Broadcast queue next
    this._broadcastMessage({
      type: 'QUEUE_NEXT',
      data: { currentIndex: this.queueState.currentIndex },
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    // Update UI
    this._updateQueueUI();
    
    ui.notifications?.info(`Now playing: ${currentVideo.title || currentVideo.videoId}`);
  }

  /**
   * MVP-U4: Handle queue add message
   */
  private _handleQueueAdd(message: YouTubeDJMessage): void {
    if (message.data?.videoItem) {
      this.queueState.items.push(message.data.videoItem);
      logger.debug(`🎵 YouTube DJ | Queue item added by ${message.userId}`);
      this._updateQueueUI();
    }
  }

  /**
   * MVP-U4: Handle queue remove message
   */
  private _handleQueueRemove(message: YouTubeDJMessage): void {
    if (message.data?.index !== undefined) {
      const index = message.data.index;
      if (index >= 0 && index < this.queueState.items.length) {
        this.queueState.items.splice(index, 1);
        
        // Adjust current index if needed
        if (index <= this.queueState.currentIndex && this.queueState.currentIndex > 0) {
          this.queueState.currentIndex--;
        }
        
        logger.debug(`🎵 YouTube DJ | Queue item removed by ${message.userId}`);
        this._updateQueueUI();
      }
    }
  }

  /**
   * MVP-U4: Handle queue next message
   */
  private _handleQueueNext(message: YouTubeDJMessage): void {
    if (message.data?.currentIndex !== undefined) {
      this.queueState.currentIndex = message.data.currentIndex;
      logger.debug(`🎵 YouTube DJ | Queue advanced by ${message.userId}`);
      this._updateQueueUI();
    }
  }

  /**
   * MVP-U4: Handle queue update message
   */
  private _handleQueueUpdate(message: YouTubeDJMessage): void {
    if (message.data?.queueState) {
      this.queueState = message.data.queueState;
      logger.debug(`🎵 YouTube DJ | Queue updated by ${message.userId}`);
      this._updateQueueUI();
    }
  }

  /**
   * MVP-U4: Update queue UI without full re-render
   */
  private _updateQueueUI(): void {
    const queueSection = this.element.querySelector('.queue-section');
    if (!queueSection) {
      logger.debug('🎵 YouTube DJ | Queue section not found, creating it');
      this._ensureQueueSectionExists();
      return;
    }
    
    // Update queue header count
    const queueHeader = queueSection.querySelector('.queue-header h3');
    if (queueHeader) {
      queueHeader.innerHTML = `
        <i class="fas fa-list"></i>
        Queue (${this.queueState.items.length} videos)
      `;
    }
    
    // Update queue list
    const queueList = queueSection.querySelector('.queue-list');
    if (queueList) {
      if (this.queueState.items.length === 0) {
        queueList.innerHTML = `
          <div class="queue-empty">
            <i class="fas fa-music"></i>
            <p>No videos in queue</p>
            ${this.isDJ ? '<p>Add videos using the input below</p>' : ''}
          </div>
        `;
      } else {
        queueList.innerHTML = this.queueState.items.map((item, index) => `
          <div class="queue-item ${index === this.queueState.currentIndex ? 'current-video' : ''}" data-index="${index}" data-queue-id="${item.id}">
            <div class="queue-item-info">
              <span class="queue-item-title">${item.title || item.videoId}</span>
              <span class="queue-item-meta">Added by ${item.addedBy}</span>
            </div>
            ${this.isDJ ? `
            <div class="queue-item-controls">
              <button type="button" class="move-up-btn" data-index="${index}" title="Move up" ${index === 0 ? 'disabled' : ''}>
                <i class="fas fa-chevron-up"></i>
              </button>
              <button type="button" class="move-down-btn" data-index="${index}" title="Move down" ${index === this.queueState.items.length - 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-down"></i>
              </button>
              <button type="button" class="remove-queue-btn" data-queue-id="${item.id}" title="Remove">
                <i class="fas fa-times"></i>
              </button>
            </div>
            ` : ''}
          </div>
        `).join('');
        
        // Re-attach event listeners for queue control buttons
        if (this.isDJ) {
          queueList.querySelectorAll('.remove-queue-btn').forEach(btn => {
            btn.addEventListener('click', this._onRemoveQueueClick.bind(this));
          });
          queueList.querySelectorAll('.move-up-btn').forEach(btn => {
            btn.addEventListener('click', this._onMoveUpClick.bind(this));
          });
          queueList.querySelectorAll('.move-down-btn').forEach(btn => {
            btn.addEventListener('click', this._onMoveDownClick.bind(this));
          });
        }
      }
    }
    
    // Update next button state
    const nextBtn = queueSection.querySelector('.next-btn');
    if (nextBtn && this.isDJ) {
      nextBtn.disabled = this.queueState.items.length === 0;
    }
    
    logger.debug('🎵 YouTube DJ | Queue UI updated');
  }

  /**
   * Update session members UI without full re-render
   */
  private _updateSessionMembersUI(): void {
    // Update only the session members section without destroying player
    const membersContainer = this.element.querySelector('.members-list');
    if (!membersContainer) {
      logger.debug('🎵 YouTube DJ | Members list container not found, skipping update');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Updating session members - count: ${this.sessionMembers.length}`);
    
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
      logger.debug('🎵 YouTube DJ | Transport controls container not found, skipping update');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Updating transport controls - isDJ: ${this.isDJ}, playerReady: ${this.playerReady}`);
    
    // Update transport buttons container content based on DJ status
    const transportButtons = transportContainer.querySelector('.transport-buttons');
    if (!transportButtons) {
      logger.debug('🎵 YouTube DJ | Transport buttons container not found, skipping update');
      return;
    }
    
    if (this.isDJ) {
      // Show DJ controls (play/pause/next buttons)
      const disabledAttr = this.playerReady ? '' : 'disabled';
      const nextDisabledAttr = this.queueState.items.length > 0 ? '' : 'disabled';
      transportButtons.innerHTML = `
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
        <button 
          type="button" 
          class="next-btn transport-btn"
          ${nextDisabledAttr}
        >
          <i class="fas fa-step-forward"></i>
          Next
        </button>
      `;
    } else {
      // Show listener info 
      transportButtons.innerHTML = `
        <div class="listener-info">
          <i class="fas fa-info-circle"></i>
          <p>Playback is controlled by the DJ</p>
        </div>
      `;
    }
    
    // Update mute control (always present)
    const muteControl = transportContainer.querySelector('.mute-control');
    if (muteControl) {
      muteControl.innerHTML = `
        <button type="button" class="mute-player-btn" title="${this.isPlayerMuted ? 'Unmute Player' : 'Mute Player'}">
          <i class="fas ${this.isPlayerMuted ? 'fa-volume-mute' : 'fa-volume-up'}"></i>
        </button>
      `;
    }
    
    // Re-attach event listeners
    if (this.isDJ) {
      const playBtn = transportContainer.querySelector('.play-btn');
      const pauseBtn = transportContainer.querySelector('.pause-btn');
      const nextBtn = transportContainer.querySelector('.next-btn');
      
      playBtn?.addEventListener('click', this._onPlayClick.bind(this));
      pauseBtn?.addEventListener('click', this._onPauseClick.bind(this));
      nextBtn?.addEventListener('click', this._onNextClick.bind(this));
    }
    
    // Mute button for both DJ and listeners
    const muteBtn = transportContainer.querySelector('.mute-player-btn');
    muteBtn?.addEventListener('click', this._onMutePlayerClick.bind(this));
    
    // Update seek section for DJ
    this._updateSeekSection();
    
    // Update URL input section for DJ
    this._updateUrlInputSection();
    
    logger.debug(`🎵 YouTube DJ | Transport controls updated - isDJ: ${this.isDJ}, playerReady: ${this.playerReady}`);
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
    
    logger.debug('🎵 YouTube DJ | Seek bar updates started');
  }

  /**
   * Stop periodic seek bar updates
   */
  private _stopSeekBarUpdates(): void {
    if (this.seekUpdateInterval) {
      clearInterval(this.seekUpdateInterval);
      this.seekUpdateInterval = null;
      logger.debug('🎵 YouTube DJ | Seek bar updates stopped');
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
        logger.debug('🎵 YouTube DJ | Creating seek section for DJ');
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
        logger.debug('🎵 YouTube DJ | Removing seek section for non-DJ user');
        seekSection.remove();
      }
    }
  }

  /**
   * Update URL input section without full re-render
   */
  private _updateUrlInputSection(): void {
    const urlInputSection = this.element.querySelector('.url-input-section');
    if (!urlInputSection) {
      logger.debug('🎵 YouTube DJ | URL input section not found, skipping update');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Updating URL input section - isDJ: ${this.isDJ}, playerReady: ${this.playerReady}`);
    
    // Update section state based on DJ status
    if (this.isDJ) {
      urlInputSection.classList.remove('non-dj-disabled');
    } else {
      urlInputSection.classList.add('non-dj-disabled');
    }
    
    // Update input and button state
    const urlInput = urlInputSection.querySelector('.youtube-url-input') as HTMLInputElement;
    const addToQueueBtn = urlInputSection.querySelector('.add-to-queue-btn') as HTMLButtonElement;
    const loadBtn = urlInputSection.querySelector('.load-video-btn') as HTMLButtonElement;
    
    if (urlInput) {
      urlInput.disabled = !this.isDJ || !this.playerReady;
      urlInput.placeholder = this.isDJ 
        ? 'Paste YouTube URL or video ID...' 
        : 'Only the DJ can add videos';
    }
    
    if (addToQueueBtn) {
      addToQueueBtn.disabled = !this.isDJ || !this.playerReady;
    }
    
    if (loadBtn) {
      loadBtn.disabled = !this.isDJ || !this.playerReady;
    }
    
    // Ensure event listeners are attached
    if (this.isDJ) {
      const urlInput = urlInputSection.querySelector('.youtube-url-input');
      const addToQueueBtn = urlInputSection.querySelector('.add-to-queue-btn');
      const loadBtn = urlInputSection.querySelector('.load-video-btn');
      
      // Remove existing listeners to avoid duplicates
      urlInput?.removeEventListener('keypress', this._onUrlInputKeypress.bind(this));
      addToQueueBtn?.removeEventListener('click', this._onAddToQueueClick.bind(this));
      loadBtn?.removeEventListener('click', this._onLoadVideoClick.bind(this));
      
      // Add fresh listeners
      urlInput?.addEventListener('keypress', this._onUrlInputKeypress.bind(this));
      addToQueueBtn?.addEventListener('click', this._onAddToQueueClick.bind(this));
      loadBtn?.addEventListener('click', this._onLoadVideoClick.bind(this));
    }
  }

  /**
   * Update DJ controls without full re-render
   */
  private _updateDJControls(): void {
    const djControlsContainer = this.element.querySelector('.dj-controls');
    if (!djControlsContainer) {
      logger.debug('🎵 YouTube DJ | DJ controls container not found, skipping update');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Updating DJ controls - isDJ: ${this.isDJ}`);
    
    djControlsContainer.innerHTML = '';
    
    if (this.isDJ) {
      // Create DJ controls with handoff option
      const canHandoffDJ = this.sessionMembers.length > 1;
      djControlsContainer.innerHTML = `
        <button type="button" class="release-dj-btn">
          <i class="fas fa-crown"></i>
          Release DJ
        </button>
        ${canHandoffDJ ? `
        <button type="button" class="handoff-dj-btn">
          <i class="fas fa-exchange-alt"></i>
          Hand Off
        </button>
        ` : ''}
      `;
    } else {
      djControlsContainer.innerHTML = `
        <button type="button" class="claim-dj-btn">
          <i class="fas fa-microphone"></i>
          Become DJ
        </button>
        <button type="button" class="request-dj-btn">
          <i class="fas fa-hand-paper"></i>
          Request DJ
        </button>
      `;
    }
    
    // Add GM Override button if user is GM
    if (game.user?.isGM) {
      djControlsContainer.innerHTML += `
        <button type="button" class="gm-override-btn">
          <i class="fas fa-gavel"></i>
          GM Override
        </button>
      `;
    }
    
    // Re-attach event listeners for all buttons
    djControlsContainer.querySelector('.claim-dj-btn')?.addEventListener('click', this._onClaimDJClick.bind(this));
    djControlsContainer.querySelector('.release-dj-btn')?.addEventListener('click', this._onReleaseDJClick.bind(this));
    djControlsContainer.querySelector('.handoff-dj-btn')?.addEventListener('click', this._onHandoffDJClick.bind(this));
    djControlsContainer.querySelector('.request-dj-btn')?.addEventListener('click', this._onRequestDJClick.bind(this));
    djControlsContainer.querySelector('.gm-override-btn')?.addEventListener('click', this._onGMOverrideClick.bind(this));
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
   * MVP-U4: Ensure queue section exists after joining session
   */
  private _ensureQueueSectionExists(): void {
    // Check if queue section already exists
    let queueSection = this.element.querySelector('.queue-section');
    if (queueSection) {
      logger.debug('🎵 YouTube DJ | Queue section already exists');
      this._updateQueueUI();
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Creating queue section dynamically');
    
    // Create the queue section
    queueSection = document.createElement('div');
    queueSection.className = 'queue-section';
    
    queueSection.innerHTML = `
      <div class="queue-header">
        <h3>
          <i class="fas fa-list"></i>
          Queue (${this.queueState.items.length} videos)
        </h3>
        ${this.isDJ ? `
        <div class="queue-controls">
          <button type="button" class="next-btn queue-btn" ${this.queueState.items.length === 0 ? 'disabled' : ''}>
            <i class="fas fa-step-forward"></i>
            Next
          </button>
        </div>
        ` : ''}
      </div>
      
      <div class="queue-list">
        ${this.queueState.items.length === 0 ? `
        <div class="queue-empty">
          <i class="fas fa-music"></i>
          <p>No videos in queue</p>
          ${this.isDJ ? '<p>Add videos using the input below</p>' : ''}
        </div>
        ` : this.queueState.items.map((item, index) => `
        <div class="queue-item ${index === this.queueState.currentIndex ? 'current-video' : ''}" data-index="${index}">
          <div class="queue-item-info">
            <span class="queue-item-title">${item.title || item.videoId}</span>
            <span class="queue-item-meta">Added by ${item.addedBy}</span>
          </div>
          ${this.isDJ ? `<button type="button" class="remove-queue-btn" data-queue-id="${item.id}"><i class="fas fa-times"></i></button>` : ''}
        </div>
        `).join('')}
      </div>
    `;
    
    // Insert after player section
    const playerSection = this.element.querySelector('.player-section');
    if (playerSection) {
      playerSection.insertAdjacentElement('afterend', queueSection);
    } else {
      // Fallback: insert at beginning of content
      const contentDiv = this.element.querySelector('.youtube-dj-content');
      if (contentDiv) {
        contentDiv.appendChild(queueSection);
      }
    }
    
    // Attach event listeners
    if (this.isDJ) {
      const nextBtn = queueSection.querySelector('.next-btn');
      nextBtn?.addEventListener('click', this._onNextClick.bind(this));
      
      queueSection.querySelectorAll('.remove-queue-btn').forEach(btn => {
        btn.addEventListener('click', this._onRemoveQueueClick.bind(this));
      });
    }
    
    logger.debug('🎵 YouTube DJ | Queue section created and attached');
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
      logger.debug('🎵 YouTube DJ | Creating session members section manually');
      
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
      logger.debug('🎵 YouTube DJ | Broadcasting message:', message);
      logger.debug(`🎵 YouTube DJ | Socket available: ${!!game.socket}`);
      logger.debug(`🎵 YouTube DJ | Channel: ${YouTubeDJApp.SOCKET_NAME}`);
      
      // Try both our custom channel AND a fallback method
      const result = game.socket?.emit(YouTubeDJApp.SOCKET_NAME, message);
      logger.debug(`🎵 YouTube DJ | Emit result:`, result);
      
      // FALLBACK: Use FoundryVTT's system socket as backup
      logger.debug('🎵 YouTube DJ | Also sending via fallback method...');
      game.socket?.emit('module.bardic-inspiration.fallback', {
        bardic_dj_message: message,
        timestamp: Date.now()
      });
    } else {
      logger.warn('🎵 YouTube DJ | Cannot broadcast - not connected');
    }
  }

  /**
   * MVP-U5: Broadcast message with retry mechanism
   */
  private _broadcastMessageWithRetry(message: YouTubeDJMessage, maxRetries: number = 3): void {
    let attempts = 0;
    
    const attemptBroadcast = () => {
      attempts++;
      
      if (!this.isConnected) {
        if (attempts < maxRetries) {
          logger.debug(`🎵 YouTube DJ | Not connected, retry ${attempts}/${maxRetries} in 1s`);
          setTimeout(attemptBroadcast, 1000);
          return;
        } else {
          logger.error('🎵 YouTube DJ | Failed to broadcast after retries - not connected');
          ui.notifications?.warn('Message may not have reached other clients (connection issue)');
          return;
        }
      }
      
      try {
        this._broadcastMessage(message);
        logger.debug(`🎵 YouTube DJ | Message broadcast successful on attempt ${attempts}`);
      } catch (error) {
        logger.error(`🎵 YouTube DJ | Broadcast attempt ${attempts} failed:`, error);
        
        if (attempts < maxRetries) {
          logger.debug(`🎵 YouTube DJ | Retrying broadcast in 1s...`);
          setTimeout(attemptBroadcast, 1000);
        } else {
          logger.error('🎵 YouTube DJ | All broadcast attempts failed');
          ui.notifications?.warn('Message may not have reached other clients');
        }
      }
    };
    
    attemptBroadcast();
  }

  /**
   * MVP-U5: Setup connection monitoring and recovery
   */
  private _setupConnectionMonitoring(): void {
    // Monitor socket connection status
    const checkConnection = () => {
      const wasConnected = this.isConnected;
      this.isConnected = game.socket?.connected || false;
      
      if (wasConnected && !this.isConnected) {
        logger.warn('🎵 YouTube DJ | Connection lost');
        ui.notifications?.warn('Connection lost - attempting to reconnect...');
        this._onConnectionLost();
      } else if (!wasConnected && this.isConnected) {
        logger.debug('🎵 YouTube DJ | Connection restored');
        ui.notifications?.info('Connection restored');
        this._onConnectionRestored();
      }
    };
    
    // Check connection every 5 seconds
    setInterval(checkConnection, 5000);
    
    // Also listen to FoundryVTT socket events if available
    if (game.socket) {
      game.socket.on('connect', () => {
        logger.debug('🎵 YouTube DJ | Socket connected');
        this.isConnected = true;
        this._onConnectionRestored();
      });
      
      game.socket.on('disconnect', () => {
        logger.debug('🎵 YouTube DJ | Socket disconnected');
        this.isConnected = false;
        this._onConnectionLost();
      });
    }
  }

  /**
   * MVP-U5: Handle connection loss
   */
  private _onConnectionLost(): void {
    // Stop heartbeat to avoid errors
    this._stopHeartbeat();
    
    // Mark as disconnected
    this.isConnected = false;
    
    // Update UI to show disconnected state
    const statusElements = this.element.querySelectorAll('.connection-status');
    statusElements.forEach(el => {
      el.textContent = 'Disconnected';
      el.className = 'connection-status status-inactive';
    });
  }

  /**
   * MVP-U5: Handle connection restoration
   */
  private _onConnectionRestored(): void {
    this.isConnected = true;
    
    // Restart heartbeat if we're the DJ
    if (this.isDJ && this.playerReady) {
      this._startHeartbeat();
    }
    
    // Request state sync to catch up on any missed updates
    setTimeout(() => {
      logger.debug('🎵 YouTube DJ | Requesting state sync after reconnection');
      this._requestSessionState();
    }, 1000);
    
    // Update UI to show connected state
    const statusElements = this.element.querySelectorAll('.connection-status');
    statusElements.forEach(el => {
      el.textContent = 'Connected';
      el.className = 'connection-status status-active';
    });
  }

  /**
   * MVP-U5: Fetch video title asynchronously and update queue item
   */
  private async _fetchVideoTitle(videoId: string, queueItemId: string): Promise<void> {
    try {
      // This is a basic implementation - in a real application you would use YouTube API
      // For now, we'll use the YouTube oEmbed API which doesn't require authentication
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      
      const response = await fetch(oembedUrl);
      if (response.ok) {
        const data = await response.json();
        if (data.title) {
          // Find the queue item and update its title
          const queueItem = this.queueState.items.find(item => item.id === queueItemId);
          if (queueItem) {
            queueItem.title = data.title;
            
            // Save the updated state
            this._saveWorldState();
            
            // Update UI
            this._updateQueueUI();
            
            logger.debug(`🎵 YouTube DJ | Fetched title for ${videoId}: ${data.title}`);
          }
        }
      }
    } catch (error) {
      logger.warn(`🎵 YouTube DJ | Failed to fetch title for ${videoId}:`, error);
      // Don't show error to user - this is optional enhancement
    }
  }

  /**
   * MVP-U5: Validate YouTube video availability
   */
  private async _validateVideoAvailability(videoId: string): Promise<boolean> {
    try {
      // Check if video exists using oEmbed API
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      
      const response = await fetch(oembedUrl);
      return response.ok;
    } catch (error) {
      logger.warn(`🎵 YouTube DJ | Failed to validate video ${videoId}:`, error);
      return false; // Assume invalid if we can't check
    }
  }

  /**
   * MVP-U5: Handle YouTube API errors gracefully
   */
  private _handleYouTubeAPIError(error: any, videoId?: string): void {
    logger.error('🎵 YouTube DJ | YouTube API Error:', error);
    
    let userMessage = 'YouTube player error occurred';
    
    // Handle specific YouTube API error codes
    if (error.data) {
      switch (error.data) {
        case 2:
          userMessage = 'Invalid video ID format';
          break;
        case 5:
          userMessage = 'Video cannot be played in embedded players';
          break;
        case 100:
          userMessage = 'Video not found or private';
          break;
        case 101:
        case 150:
          userMessage = 'Video not available for embedded playback';
          break;
        default:
          userMessage = `YouTube error (code ${error.data})`;
      }
    }
    
    if (videoId) {
      userMessage += ` for video: ${videoId}`;
    }
    
    ui.notifications?.error(userMessage);
    
    // If this was a queue video, try to skip to next
    if (this.isDJ && this.queueState.items.length > 0) {
      logger.debug('🎵 YouTube DJ | Attempting to skip to next video due to error');
      setTimeout(() => {
        this._playNextInQueue();
      }, 2000);
    }
  }

  /**
   * MVP-U5: Enhanced queue UI updates with loading states
   */
  private _updateQueueUIWithLoadingState(isLoading: boolean = false): void {
    const queueSection = this.element.querySelector('.queue-section');
    if (!queueSection) return;
    
    if (isLoading) {
      // Add loading indicator
      let loadingIndicator = queueSection.querySelector('.queue-loading');
      if (!loadingIndicator) {
        loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'queue-loading';
        loadingIndicator.innerHTML = `
          <i class="fas fa-spinner fa-spin"></i>
          <span>Loading...</span>
        `;
        queueSection.appendChild(loadingIndicator);
      }
    } else {
      // Remove loading indicator
      const loadingIndicator = queueSection.querySelector('.queue-loading');
      if (loadingIndicator) {
        loadingIndicator.remove();
      }
    }
    
    // Update the regular queue UI
    this._updateQueueUI();
  }

  /**
   * MVP-U6: Show handoff dialog
   */
  private _showHandoffDialog(): void {
    const users = this.sessionMembers.filter(member => member.id !== game.user?.id);
    
    if (users.length === 0) {
      ui.notifications?.warn('No other users available to hand off DJ role');
      return;
    }
    
    // Create simple dialog with user list
    const content = `
      <div class="handoff-dialog">
        <h3>Hand off DJ role to:</h3>
        <div class="user-list">
          ${users.map(user => `
            <button class="handoff-user-btn" data-user-id="${user.id}">
              <i class="fas fa-user"></i>
              ${user.name}
            </button>
          `).join('')}
        </div>
      </div>
    `;
    
    new Dialog({
      title: 'Hand off DJ Role',
      content: content,
      buttons: {
        cancel: {
          label: 'Cancel',
          callback: () => {}
        }
      },
      render: (html) => {
        html.find('.handoff-user-btn').click((event) => {
          const userId = event.currentTarget.dataset.userId;
          if (userId) {
            this._handoffDJToUser(userId);
          }
        });
      }
    }).render(true);
  }
  
  /**
   * MVP-U6: Hand off DJ role to specific user
   */
  private _handoffDJToUser(userId: string): void {
    const targetUser = game.users?.get(userId);
    if (!targetUser) {
      ui.notifications?.error('Target user not found');
      return;
    }
    
    logger.debug(`🎵 YouTube DJ | Handing off DJ role to ${targetUser.name}`);
    
    // Update local state
    this.isDJ = false;
    this.djUserId = userId;
    
    // Save to world state
    this._saveWorldState();
    
    // Broadcast handoff message
    this._broadcastMessage({
      type: 'DJ_HANDOFF',
      data: { 
        newDJ: userId,
        previousDJ: game.user?.id 
      },
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
    
    // Update UI
    this._updateDJControls();
    this._updateDJStatusHeader();
    this._updateTransportControls();
    this._updateSessionMembersUI();
    
    ui.notifications?.success(`DJ role handed off to ${targetUser.name}`);
  }
  
  /**
   * MVP-U6: Remove DJ request from list
   */
  private _removeDJRequest(userId: string): void {
    this.djRequests = this.djRequests.filter(req => req.userId !== userId);
    this._updateDJRequestsUI();
  }
  
  
  /**
   * MVP-U6: Update DJ requests UI
   */
  private _updateDJRequestsUI(): void {
    // Only show requests to the current DJ
    if (!this.isDJ) {
      // Remove requests container if user is not DJ
      const requestsContainer = this.element.querySelector('.dj-requests');
      if (requestsContainer) {
        requestsContainer.remove();
      }
      return;
    }
    
    // Find or create requests container
    let requestsContainer = this.element.querySelector('.dj-requests');
    
    if (this.djRequests.length === 0) {
      if (requestsContainer) {
        requestsContainer.style.display = 'none';
      }
      return;
    }
    
    // Create requests container if it doesn't exist
    if (!requestsContainer) {
      requestsContainer = document.createElement('div');
      requestsContainer.className = 'dj-requests';
      requestsContainer.innerHTML = `
        <div class="requests-header">
          <h3>
            <i class="fas fa-hand-paper"></i>
            DJ Requests (${this.djRequests.length})
          </h3>
        </div>
        <div class="dj-requests-list"></div>
      `;
      
      // Insert after session members section
      const sessionMembers = this.element.querySelector('.session-members');
      if (sessionMembers) {
        sessionMembers.insertAdjacentElement('afterend', requestsContainer);
      }
    }
    
    requestsContainer.style.display = 'block';
    
    // Update the header count
    const headerH3 = requestsContainer.querySelector('.requests-header h3');
    if (headerH3) {
      headerH3.innerHTML = `
        <i class="fas fa-hand-paper"></i>
        DJ Requests (${this.djRequests.length})
      `;
    }
    
    // Update the requests list
    const requestsList = requestsContainer.querySelector('.dj-requests-list');
    if (requestsList) {
      requestsList.innerHTML = this.djRequests.map(request => `
        <div class="dj-request-item">
          <span class="requester-name">${request.userName}</span>
          <div class="request-actions">
            <button class="approve-dj-request-btn" data-requester-id="${request.userId}">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="deny-dj-request-btn" data-requester-id="${request.userId}">
              <i class="fas fa-times"></i> Deny
            </button>
          </div>
        </div>
      `).join('');
      
      // Re-attach event listeners
      requestsList.querySelectorAll('.approve-dj-request-btn').forEach(btn => {
        btn.addEventListener('click', this._onApproveDJRequestClick.bind(this));
      });
      requestsList.querySelectorAll('.deny-dj-request-btn').forEach(btn => {
        btn.addEventListener('click', this._onDenyDJRequestClick.bind(this));
      });
    }
  }
  
  /**
   * Move queue item up one position
   */
  private _moveQueueItemUp(index: number): void {
    if (index <= 0 || index >= this.queueState.items.length) return;
    
    logger.debug(`🎵 YouTube DJ | Moving queue item up: ${index} -> ${index - 1}`);
    
    // Create a copy of the queue
    const newQueue = [...this.queueState.items];
    
    // Swap with previous item
    [newQueue[index - 1], newQueue[index]] = [newQueue[index], newQueue[index - 1]];
    
    // Update currentIndex if it's affected by the move
    if (this.queueState.currentIndex === index) {
      // Moving the current video up
      this.queueState.currentIndex = index - 1;
      logger.debug(`🎵 YouTube DJ | Updated currentIndex to ${this.queueState.currentIndex} (moved current video up)`);
    } else if (this.queueState.currentIndex === index - 1) {
      // Moving something up that displaces the current video down
      this.queueState.currentIndex = index;
      logger.debug(`🎵 YouTube DJ | Updated currentIndex to ${this.queueState.currentIndex} (current video displaced down)`);
    }
    
    // Update the queue state
    this.queueState.items = newQueue;
    
    // Save and broadcast
    this._saveWorldState();
    this._broadcastMessage({
      type: 'QUEUE_UPDATE',
      data: {
        queue: this.queueState
      },
      userId: game.user?.id || 'unknown',
      timestamp: Date.now()
    });
    
    // Update the UI
    this._updateQueueUI();
    
    ui.notifications?.info('Queue item moved up');
  }

  /**
   * Move queue item down one position
   */
  private _moveQueueItemDown(index: number): void {
    if (index < 0 || index >= this.queueState.items.length - 1) return;
    
    logger.debug(`🎵 YouTube DJ | Moving queue item down: ${index} -> ${index + 1}`);
    
    // Create a copy of the queue
    const newQueue = [...this.queueState.items];
    
    // Swap with next item
    [newQueue[index], newQueue[index + 1]] = [newQueue[index + 1], newQueue[index]];
    
    // Update currentIndex if it's affected by the move
    if (this.queueState.currentIndex === index) {
      // Moving the current video down
      this.queueState.currentIndex = index + 1;
      logger.debug(`🎵 YouTube DJ | Updated currentIndex to ${this.queueState.currentIndex} (moved current video down)`);
    } else if (this.queueState.currentIndex === index + 1) {
      // Moving something down that displaces the current video up
      this.queueState.currentIndex = index;
      logger.debug(`🎵 YouTube DJ | Updated currentIndex to ${this.queueState.currentIndex} (current video displaced up)`);
    }
    
    // Update the queue state
    this.queueState.items = newQueue;
    
    // Save and broadcast
    this._saveWorldState();
    this._broadcastMessage({
      type: 'QUEUE_UPDATE',
      data: {
        queue: this.queueState
      },
      userId: game.user?.id || 'unknown',
      timestamp: Date.now()
    });
    
    // Update the UI
    this._updateQueueUI();
    
    ui.notifications?.info('Queue item moved down');
  }

  /**
   * Handle move up button click
   */
  private _onMoveUpClick(event: Event): void {
    const button = event.target as HTMLElement;
    const index = parseInt(button.dataset.index || '-1');
    if (index !== -1) {
      this._moveQueueItemUp(index);
    }
  }

  /**
   * Handle move down button click
   */
  private _onMoveDownClick(event: Event): void {
    const button = event.target as HTMLElement;
    const index = parseInt(button.dataset.index || '-1');
    if (index !== -1) {
      this._moveQueueItemDown(index);
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