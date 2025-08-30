/**
 * YouTube Player Widget - Injected above player list (inspired by TheRipper93's approach)
 * Handles only the YouTube iframe player, isolated from other UI updates
 */

import { logger } from '../lib/logger.js';
import { SessionStore } from '../state/SessionStore.js';
import { StateChangeEvent, VideoInfo } from '../state/StateTypes.js';

export class YouTubePlayerWidget {
  private static instance: YouTubePlayerWidget | null = null;
  private store: SessionStore;
  private player: YT.Player | null = null;
  private isPlayerReady: boolean = false;
  private widgetElement: HTMLElement | null = null;
  private containerId: string = 'youtube-dj-player-widget';
  private lastSeekTime: number = 0;
  private seekThrottleMs: number = 1000; // 1 second between seeks
  private isJoiningSession: boolean = false; // Flag to prevent re-renders during join
  private commandQueue: Array<{ command: string; args?: any[] }> = []; // Queue for commands during player recreation
  private isDestroyed: boolean = false;
  private activeTimers: Set<NodeJS.Timeout> = new Set();
  private lastQueuedLoadCommand: { videoId: string; timestamp: number } | null = null; // Track last queued load to prevent duplicates

  constructor() {
    this.store = SessionStore.getInstance();
    
    // Subscribe to state changes for player-specific updates only
    Hooks.on('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.on('youtubeDJ.playerCommand', this.onPlayerCommand.bind(this));
    Hooks.on('youtubeDJ.localPlayerCommand', this.onPlayerCommand.bind(this)); // Handle local-only commands
    Hooks.on('youtubeDJ.getCurrentTimeRequest', this.onGetCurrentTimeRequest.bind(this));
    Hooks.on('youtubeDJ.getPlaylistIndexRequest', this.onGetPlaylistIndexRequest.bind(this));
    
    // Subscribe to session state for handoff request notifications
    this.subscribeToNotifications();
    
    // Listen for socket messages for multi-user synchronization
    game.socket?.on('module.bardic-inspiration', this.onSocketMessage.bind(this));
  }

  static getInstance(): YouTubePlayerWidget {
    if (!YouTubePlayerWidget.instance) {
      YouTubePlayerWidget.instance = new YouTubePlayerWidget();
    }
    return YouTubePlayerWidget.instance;
  }

  /**
   * Initialize and inject the widget above the player list
   */
  async initialize(): Promise<void> {
    if (this.widgetElement) {
      logger.debug('🎵 YouTube DJ | Widget already initialized');
      return;
    }

    logger.debug('🎵 YouTube DJ | Initializing YouTube player widget...');

    try {
      // Find the player list container
      const playerList = document.querySelector('#players');
      logger.debug('🎵 YouTube DJ | Player list found:', !!playerList);
      
      if (!playerList) {
        logger.warn('🎵 YouTube DJ | Player list not found, trying alternative selectors...');
        
        // Try alternative selectors
        const alternatives = [
          'ol#players',
          '.players',
          '#sidebar #players',
          '[data-tab="players"]'
        ];
        
        for (const selector of alternatives) {
          const alt = document.querySelector(selector);
          logger.debug(`🎵 YouTube DJ | Trying selector "${selector}":`, !!alt);
          if (alt) {
            logger.info('🎵 YouTube DJ | Found player list with alternative selector:', selector);
            break;
          }
        }
        
        // If still not found, just attach to sidebar or body
        const sidebar = document.querySelector('#sidebar');
        if (sidebar) {
          logger.info('🎵 YouTube DJ | Attaching to sidebar instead');
          // Create our widget container
          this.widgetElement = document.createElement('div');
          this.widgetElement.id = 'youtube-dj-widget';
          this.widgetElement.className = 'youtube-dj-widget';
          
          // Insert at the bottom of sidebar
          sidebar.appendChild(this.widgetElement);
          
          // Render the widget content
          this.render();
          
          logger.info('🎵 YouTube DJ | YouTube player widget initialized (attached to sidebar)');
          return;
        }
        
        throw new Error('Could not find suitable container for widget');
      }

      // Create our widget container
      this.widgetElement = document.createElement('div');
      this.widgetElement.id = 'youtube-dj-widget';
      this.widgetElement.className = 'youtube-dj-widget';
      
      // Ensure proper click handling
      this.widgetElement.style.pointerEvents = 'auto';
      this.widgetElement.style.position = 'relative';
      this.widgetElement.style.zIndex = '9999';
      
      // Add debug click handler
      this.widgetElement.addEventListener('click', (e) => {
        logger.debug('🎵 YouTube DJ | Widget clicked!', e.target);
        e.stopPropagation();
      });
      
      // Insert above the player list
      const parent = playerList.parentNode;
      logger.debug('🎵 YouTube DJ | Player list parent:', !!parent);
      
      if (parent) {
        parent.insertBefore(this.widgetElement, playerList);
        logger.debug('🎵 YouTube DJ | Widget inserted above player list');
      } else {
        // Fallback - append to body
        document.body.appendChild(this.widgetElement);
        logger.warn('🎵 YouTube DJ | Fallback: Widget appended to body');
      }

      // Render the widget content
      this.render();

      // Verify DOM attachment
      const attached = document.getElementById('youtube-dj-widget');
      logger.debug('🎵 YouTube DJ | Widget DOM verification:', !!attached);

      logger.info('🎵 YouTube DJ | YouTube player widget initialized');

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to initialize widget:', error);
    }
  }

  /**
   * Subscribe to notification-related state changes
   */
  private subscribeToNotifications(): void {
    // Listen for changes to activeRequests that affect current user
    Hooks.on('youtubeDJ.stateChanged', (event: StateChangeEvent) => {
      if (event.changes.session?.activeRequests !== undefined) {
        this.updateHandoffNotifications();
      }
    });
  }

  /**
   * Perform selective updates to the widget without destroying the iframe
   */
  private updateWidgetSelectively(state: any): void {
    if (!this.widgetElement) return;
    
    const hasJoinedSession = state.session.hasJoinedSession;
    const currentVideo = state.player.currentVideo;
    const isPlaying = state.player.playbackState === 'playing';
    
    // Update header controls based on session state
    const widgetControls = this.widgetElement.querySelector('.widget-controls');
    if (widgetControls) {
      const isDJ = state.session.djUserId === game.user?.id;
      widgetControls.innerHTML = hasJoinedSession ? `
        ${isDJ ? `
          <button class="widget-btn playback-control" onclick="window.youtubeDJWidget?.togglePlayPause()" title="${isPlaying ? 'Pause' : 'Play'}">
            <i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i>
          </button>
        ` : ''}
        <button class="widget-btn" onclick="game.modules.get('bardic-inspiration').api.openYoutubeDJ()" title="Open DJ Controls">
          <i class="fas fa-sliders-h"></i>
        </button>
        <button class="widget-btn danger" onclick="window.youtubeDJWidget?.leaveSession()" title="Leave Session">
          <i class="fas fa-sign-out-alt"></i>
        </button>
      ` : `
        <button class="widget-btn" onclick="window.youtubeDJWidget?.joinSession()" title="Join Session">
          <i class="fas fa-play-circle"></i>
        </button>
      `;
      
      // Re-add minimize button
      widgetControls.innerHTML += `
        <button class="widget-btn secondary" onclick="window.youtubeDJWidget?.toggleMinimize()" title="${this.isMinimized() ? 'Maximize Player' : 'Minimize Player'}">
          <i class="fas fa-${this.isMinimized() ? 'chevron-down' : 'chevron-up'}"></i>
        </button>
      `;
    }
    
    // Update handoff notifications if session state changed
    this.updateHandoffNotifications();
    
    // Update title with status
    const widgetTitle = this.widgetElement.querySelector('.widget-title');
    if (widgetTitle) {
      widgetTitle.innerHTML = `
        <i class="fas fa-music"></i>
        ${hasJoinedSession && this.isMinimized() && currentVideo ? `
          <span class="compact-status">
            <i class="fas fa-${isPlaying ? 'play' : 'pause'}" style="color: ${isPlaying ? '#28a745' : '#ffc107'}; margin-left: 5px;"></i>
          </span>
        ` : ''}
      `;
    }
    
    // Update player container visibility and volume control
    const playerContainer = this.widgetElement.querySelector('.player-container');
    if (playerContainer) {
      if (hasJoinedSession && !this.isMinimized()) {
        playerContainer.classList.add('active');
        
        // Volume control is now handled separately below the player container
      } else {
        playerContainer.classList.remove('active');
      }
    }
    
    // Update volume control section visibility and content
    let volumeControlSection = this.widgetElement.querySelector('.volume-control-section');
    if (hasJoinedSession) {
      if (!volumeControlSection) {
        // Create volume control section if it doesn't exist
        const currentVolume = this.getUserVolume();
        const volumeHTML = `
          <div class="volume-control-section">
            <div class="volume-control-horizontal">
              <button class="widget-btn mute-volume-btn" onclick="window.youtubeDJWidget?.toggleMute()" title="${this.getUserMuteState() ? 'Unmute' : 'Mute'}">
                <i class="fas fa-${this.getUserMuteState() ? 'volume-mute' : 'volume-up'}"></i>
              </button>
              <input type="range" class="volume-slider" min="0" max="100" value="${currentVolume}" step="1" title="Volume: ${currentVolume}%">
            </div>
          </div>
        `;
        
        // Insert after player container
        const playerContainer = this.widgetElement.querySelector('.player-container');
        if (playerContainer) {
          playerContainer.insertAdjacentHTML('afterend', volumeHTML);
          logger.debug('🎵 YouTube DJ | Volume control section added');
          
          // Attach event listeners to the newly created volume slider
          this.attachVolumeSliderListeners();
        }
      } else {
        // Update existing volume control values
        const volumeSlider = volumeControlSection.querySelector('.volume-slider') as HTMLInputElement;
        const volumeMuteButton = volumeControlSection.querySelector('.mute-volume-btn');
        const volumeIcon = volumeMuteButton?.querySelector('i');
        const currentVolume = this.getUserVolume();
        
        if (volumeSlider) {
          volumeSlider.value = currentVolume.toString();
          volumeSlider.setAttribute('title', `Volume: ${currentVolume}%`);
        }
        
        // Update mute button state
        if (volumeMuteButton && volumeIcon) {
          volumeIcon.className = `fas fa-${this.getUserMuteState() ? 'volume-mute' : 'volume-up'}`;
          volumeMuteButton.setAttribute('title', this.getUserMuteState() ? 'Unmute' : 'Mute');
        }
      }
    } else if (volumeControlSection) {
      // Remove volume control if not in session
      volumeControlSection.remove();
    }

    // Remove info message if user has joined session
    if (hasJoinedSession) {
      const infoDiv = this.widgetElement.querySelector('.widget-info');
      if (infoDiv) {
        infoDiv.remove();
        logger.debug('🎵 YouTube DJ | Info text removed - user joined session');
      }
    }

    // Update status displays
    const sessionStatus = this.widgetElement.querySelector('.widget-status');
    if (sessionStatus) {
      sessionStatus.textContent = hasJoinedSession ? `Connected (${state.session.members.length} users)` : 'Not in session';
    }
    
    // Update compact info when minimized
    const compactInfo = this.widgetElement.querySelector('.compact-info');
    if (compactInfo && hasJoinedSession && this.isMinimized() && currentVideo) {
      compactInfo.innerHTML = `
        <div class="compact-track-info" title="${currentVideo.title}">
          ${currentVideo.title}
        </div>
      `;
    }
    
    // Always update handoff notifications after selective update
    this.updateHandoffNotifications();
    
    logger.debug('🎵 YouTube DJ | Widget selectively updated, iframe preserved');
  }

  /**
   * Render the widget content
   */
  private render(): void {
    if (!this.widgetElement) return;

    const state = this.store.getState();
    const hasJoinedSession = state.session.hasJoinedSession;
    const currentVideo = state.player.currentVideo;
    const isPlaying = state.player.playbackState === 'playing';
    const currentVolume = this.getUserVolume();

    // CRITICAL: Check if player iframe exists - if it does, do selective updates instead of full re-render
    const existingIframe = document.getElementById(this.containerId);
    const isIframe = existingIframe?.tagName === 'IFRAME';
    
    // If we have an active iframe player, perform selective updates instead of full re-render
    if (isIframe && this.player && this.isPlayerReady) {
      logger.debug('🎵 YouTube DJ | Performing selective update to preserve iframe');
      this.updateWidgetSelectively(state);
      return;
    }

    this.widgetElement.innerHTML = `
      <style>
        .youtube-dj-widget {
          background: rgba(0, 0, 0, 0.8);
          border: 1px solid #444;
          border-radius: 5px;
          margin-bottom: 5px;
          padding: 8px;
          width: 200px;
          min-height: 40px;
          transition: all 0.3s ease;
          position: relative;
          z-index: 9999;
          pointer-events: auto;
        }
        
        .handoff-notification {
          background: rgba(255, 193, 7, 0.9);
          border: 1px solid #ffc107;
          border-radius: 4px;
          padding: 8px;
          margin-bottom: 8px;
          color: #212529;
          font-size: 11px;
          animation: slideIn 0.3s ease;
        }
        
        .handoff-notification-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 6px;
          font-weight: bold;
        }
        
        .handoff-notification-title {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .handoff-notification-actions {
          display: flex;
          gap: 4px;
          margin-top: 6px;
        }
        
        .handoff-action-btn {
          background: #28a745;
          border: none;
          color: white;
          padding: 2px 6px;
          border-radius: 2px;
          font-size: 10px;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .handoff-action-btn.deny {
          background: #dc3545;
        }
        
        .handoff-action-btn:hover {
          opacity: 0.8;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .youtube-dj-widget.maximized {
          min-height: 180px;
        }
        
        .youtube-dj-widget.minimized {
          min-height: 40px;
        }
        
        .widget-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 5px;
          color: #f0f0f0;
          font-size: 12px;
          font-weight: bold;
        }
        
        .widget-title {
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 1;
          min-width: 0;
        }
        
        .widget-title i.fa-music {
          color: #06b6d4;
          font-size: 14px;
        }
        
        .compact-status {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        
        .compact-track-info {
          font-size: 11px;
          color: #ccc;
          font-weight: normal;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 150px;
        }
        
        .session-indicator {
          font-size: 11px;
          color: #28a745;
          font-weight: 500;
          margin-left: 4px;
        }
        
        .join-prompt {
          font-size: 11px;
          color: #ffc107;
          font-weight: 500;
          margin-left: 4px;
        }
        
        .widget-status {
          font-size: 10px;
          color: #888;
        }
        
        .player-container {
          display: none;
          width: 100%;
          height: 140px;
          margin-top: 5px;
          overflow: hidden;
          transition: all 0.3s ease;
        }
        
        .player-container.active {
          display: block;
        }
        
        .youtube-dj-widget.minimized .player-container {
          display: none !important;
        }
        
        .widget-info {
          color: #ccc;
          font-size: 11px;
          text-align: center;
          padding: 10px 0;
        }
        
        .widget-controls {
          display: flex;
          gap: 5px;
          margin-top: 5px;
          pointer-events: auto;
          z-index: 10000;
          position: relative;
        }
        
        .widget-btn {
          background: #007bff;
          border: none;
          color: white;
          padding: 4px 8px;
          border-radius: 3px;
          font-size: 10px;
          cursor: pointer;
          transition: background 0.2s;
          pointer-events: auto;
          position: relative;
          z-index: 10001;
        }
        
        .widget-btn:hover {
          background: #0056b3;
        }
        
        .widget-btn.secondary {
          background: #6c757d;
        }
        
        .widget-btn.secondary:hover {
          background: #545b62;
        }
        
        .widget-btn.danger {
          background: #dc3545;
        }
        
        .widget-btn.danger:hover {
          background: #c82333;
        }
        
        .widget-btn.playback-control {
          background: #28a745;
          min-width: 28px;
        }
        
        .widget-btn.playback-control:hover {
          background: #218838;
        }
        
        .current-video {
          font-size: 10px;
          color: #bbb;
          margin-top: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .player-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex;
        }
        
        .volume-control-section {
          margin-top: 8px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 4px;
          border: 1px solid #555;
        }
        
        .volume-control-horizontal {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
        }
        
        .mute-volume-btn {
          min-width: 28px;
          height: 24px;
          padding: 2px 6px;
          margin-right: 8px;
          font-size: 11px;
        }
        
        .volume-slider {
          flex: 1;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: #444;
          outline: none;
          border-radius: 2px;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .volume-slider:hover {
          background: #555;
        }
        
        .volume-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #007bff;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          transition: background 0.2s, transform 0.1s;
        }
        
        .volume-slider::-webkit-slider-thumb:hover {
          background: #0056b3;
          transform: scale(1.1);
        }
        
        .volume-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #007bff;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          transition: background 0.2s, transform 0.1s;
        }
        
        .volume-slider::-moz-range-thumb:hover {
          background: #0056b3;
          transform: scale(1.1);
        }
        
        .volume-slider::-moz-range-track {
          background: #444;
          height: 4px;
          border-radius: 2px;
          border: none;
        }
        
      </style>
      
      <!-- Handoff Request Notifications -->
      <div class="handoff-notifications"></div>
      
      <div class="widget-header">
        <div class="widget-title">
          <i class="fas fa-music"></i>
          ${hasJoinedSession && this.isMinimized() && currentVideo ? `
            <span class="compact-status">
              <i class="fas fa-${isPlaying ? 'play' : 'pause'}" style="color: ${isPlaying ? '#28a745' : '#ffc107'}; margin-left: 8px;"></i>
              <span class="compact-track-info">${currentVideo.title || 'Unknown'}</span>
            </span>
          ` : hasJoinedSession ? `
            <span class="session-indicator">In Session</span>
          ` : `
            <span class="join-prompt">Join to Listen</span>
          `}
        </div>
        <div class="widget-controls">
          ${hasJoinedSession ? `
            ${state.session.djUserId === game.user?.id ? `
              <button class="widget-btn playback-control" onclick="window.youtubeDJWidget?.togglePlayPause()" title="${isPlaying ? 'Pause' : 'Play'}">
                <i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i>
              </button>
            ` : ''}
            <button class="widget-btn" onclick="game.modules.get('bardic-inspiration').api.openYoutubeDJ()" title="Open DJ Controls">
              <i class="fas fa-sliders-h"></i>
            </button>
            <button class="widget-btn danger" onclick="window.youtubeDJWidget?.leaveSession()" title="Leave Session">
              <i class="fas fa-sign-out-alt"></i>
            </button>
          ` : `
            <button class="widget-btn" onclick="window.youtubeDJWidget?.joinSession()" title="Join Session">
              <i class="fas fa-play-circle"></i>
            </button>
          `}
          <button class="widget-btn secondary" onclick="window.youtubeDJWidget?.toggleMinimize()" title="${this.isMinimized() ? 'Maximize Player' : 'Minimize Player'}">
            <i class="fas fa-${this.isMinimized() ? 'chevron-down' : 'chevron-up'}"></i>
          </button>
        </div>
      </div>
      
      <!-- Player container - only visible when maximized and joined -->
      <div class="player-container ${hasJoinedSession && !this.isMinimized() ? 'active' : ''}" style="width: 100%; height: 140px;">
        <div class="player-wrapper">
          <div id="${this.containerId}" style="width: 100%; height: 100%;"></div>
        </div>
      </div>
      
      <!-- Volume control - always visible when joined, even when minimized -->
      ${hasJoinedSession ? `
        <div class="volume-control-section">
          <div class="volume-control-horizontal">
            <button class="widget-btn mute-volume-btn" onclick="window.youtubeDJWidget?.toggleMute()" title="${this.getUserMuteState() ? 'Unmute' : 'Mute'}">
              <i class="fas fa-${this.getUserMuteState() ? 'volume-mute' : 'volume-up'}"></i>
            </button>
            <input type="range" class="volume-slider" min="0" max="100" value="${currentVolume}" step="1" title="Volume: ${currentVolume}%">
          </div>
        </div>
      ` : ''}
      
      ${!hasJoinedSession && !this.isMinimized() ? `
        <div class="widget-info">
          <i class="fas fa-info-circle"></i>
          Click "Join Session" to start listening to music
        </div>
      ` : ''}
      
      ${hasJoinedSession && currentVideo && !this.isMinimized() ? `
        <div class="current-video">
          <i class="fas fa-${isPlaying ? 'play' : 'pause'}"></i>
          Now: ${currentVideo.title || currentVideo.videoId}
          ${playerState.playlistInfo ? `
            <span class="playlist-progress" style="margin-left: 8px; color: var(--bardic-inspiration-accent); font-weight: bold;">
              [${playerState.playlistInfo.currentIndex + 1} / ${playerState.playlistInfo.totalVideos}]
            </span>
          ` : ''}
        </div>
      ` : ''}
    `;

    // Verify the container was created
    const containerCheck = document.getElementById(this.containerId);
    logger.debug('🎵 YouTube DJ | Player container after render:', !!containerCheck);

    // Initialize player if session is active and player isn't ready
    // Player initialization doesn't depend on minimized state
    if (hasJoinedSession && !this.isPlayerReady && !this.player) {
      logger.debug('🎵 YouTube DJ | Scheduling player initialization...');
      // Force DOM update by using requestAnimationFrame, then setTimeout
      requestAnimationFrame(() => {
        if (this.isDestroyed) return;
        const timer = setTimeout(() => {
          if (this.isDestroyed) return;
          const container = document.getElementById(this.containerId);
          logger.debug('🎵 YouTube DJ | Pre-init container check:', {
            exists: !!container,
            id: container?.id,
            parent: container?.parentElement?.tagName,
            visible: container?.offsetParent !== null
          });
          this.initializePlayer();
          this.activeTimers.delete(timer);
        }, 500);
        this.activeTimers.add(timer);
      });
    }

    // Set initial state to maximized if not already set
    if (hasJoinedSession && this.widgetElement && !this.widgetElement.classList.contains('minimized') && !this.widgetElement.classList.contains('maximized')) {
      this.widgetElement.classList.add('maximized');
    }

    // Add volume slider event listeners after DOM is updated
    if (hasJoinedSession) {
      this.attachVolumeSliderListeners();
    }
    
    // Update handoff notifications after full render
    this.updateHandoffNotifications();
  }

  /**
   * Initialize YouTube player in the widget
   */
  private async initializePlayer(): Promise<void> {
    // If player is ready and working, don't reinitialize
    if (this.isPlayerReady && this.player) {
      // Check if player is actually functional
      try {
        if (typeof this.player.getPlayerState === 'function') {
          this.player.getPlayerState();
          logger.debug('🎵 YouTube DJ | Player already initialized and functional');
          return;
        }
      } catch (error) {
        logger.warn('🎵 YouTube DJ | Player exists but not functional, reinitializing');
        this.isPlayerReady = false;
        this.player = null;
      }
    }

    logger.debug('🎵 YouTube DJ | Initializing player in widget...');

    try {
      // Ensure YouTube API is loaded
      await this.ensureYouTubeAPI();

      // Find player container
      const container = document.getElementById(this.containerId);
      logger.debug('🎵 YouTube DJ | Looking for container:', this.containerId);
      logger.debug('🎵 YouTube DJ | Container found:', !!container);
      
      if (!container) {
        // Log all elements with our widget ID for debugging
        const widget = document.getElementById('youtube-dj-widget');
        logger.debug('🎵 YouTube DJ | Widget element found:', !!widget);
        if (widget) {
          logger.debug('🎵 YouTube DJ | Widget innerHTML length:', widget.innerHTML.length);
          logger.debug('🎵 YouTube DJ | Widget innerHTML preview:', widget.innerHTML.substring(0, 200));
        }
        logger.error(`🎵 YouTube DJ | Player container '${this.containerId}' not found in widget`);
        throw new Error(`Player container '${this.containerId}' not found in widget`);
      }

      // Log container details
      logger.debug('🎵 YouTube DJ | Container details:', {
        id: container.id,
        tagName: container.tagName,
        className: container.className,
        hasContent: container.innerHTML.length > 0,
        innerHTML: container.innerHTML
      });

      // Get current queue item to determine if we should load a video or playlist
      const queueState = this.store.getQueueState();
      const currentItem = queueState.items[queueState.currentIndex];
      
      // Determine if we're in a production HTTPS environment
      const isHTTPS = window.location.protocol === 'https:';
      const isProduction = window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');
      
      // Create base player config
      const playerVars: any = {
        autoplay: 0,
        controls: 1,
        enablejsapi: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        // In production HTTPS, be more specific about origin
        ...(isHTTPS && isProduction ? {
          origin: window.location.origin,
          widget_referrer: window.location.origin
        } : {
          origin: window.location.origin
        })
      };
      
      // Build player config based on current item
      let playerConfig: any = {
        height: '140',
        width: '100%',
        playerVars,
        events: {
          onReady: this.onPlayerReady.bind(this),
          onStateChange: this.onPlayerStateChange.bind(this),
          onError: this.onPlayerError.bind(this)
        }
      };
      
      // Check if current item is a playlist
      if (currentItem && currentItem.isPlaylist && currentItem.videoId) {
        // Extract playlist ID (remove 'playlist:' prefix if present)
        const playlistId = currentItem.videoId.startsWith('playlist:') 
          ? currentItem.videoId.substring('playlist:'.length) 
          : currentItem.videoId;
        
        logger.debug('🎵 YouTube DJ | Initializing player with playlist:', playlistId);
        
        // Add playlist parameters to playerVars
        playerVars.list = playlistId;
        playerVars.listType = 'playlist';
        playerVars.index = 0;
      } else if (currentItem && !currentItem.isPlaylist && currentItem.videoId && !currentItem.videoId.startsWith('playlist:')) {
        // Regular video
        playerConfig.videoId = currentItem.videoId;
      } else {
        // No current item or invalid item - use default video
        playerConfig.videoId = 'dQw4w9WgXcQ'; // Default test video
      }
      
      // Debug: Log all relevant environment info
      logger.debug('🎵 YouTube DJ | Player creation environment:', {
        containerId: this.containerId,
        videoId: playerConfig.videoId,
        playlistId: playerVars.list,
        origin: window.location.origin,
        protocol: window.location.protocol,
        hostname: window.location.hostname,
        isHTTPS: isHTTPS,
        isProduction: isProduction,
        containerExists: !!container,
        containerVisible: container?.offsetParent !== null,
        containerDisplay: window.getComputedStyle(container || document.body).display,
        ytAPIReady: !!(window.YT && window.YT.Player),
        playerVars: playerConfig.playerVars
      });
      
      logger.debug('🎵 YouTube DJ | Creating YT.Player with config:', {
        containerId: this.containerId,
        videoId: playerConfig.videoId,
        playlistId: playerVars.list,
        playerVars: playerConfig.playerVars
      });

      // Create player with minimal parameters and immediate video load
      this.player = new YT.Player(this.containerId, playerConfig);

      // Debug: Log player object creation
      logger.debug('🎵 YouTube DJ | Player object created:', {
        playerExists: !!this.player,
        playerType: typeof this.player,
        playerConstructor: this.player?.constructor?.name
      });

      logger.info('🎵 YouTube DJ | Widget player created successfully');

      // Check if iframe was created immediately
      const timer1 = setTimeout(() => {
        if (this.isDestroyed) return;
        const containerAfterCreation = document.getElementById(this.containerId);
        const iframe = containerAfterCreation?.querySelector('iframe');
        this.activeTimers.delete(timer1);
        
        
        logger.debug('🎵 YouTube DJ | Post-creation check (100ms):', {
          containerStillExists: !!containerAfterCreation,
          iframeCreated: !!iframe,
          containerContent: containerAfterCreation?.innerHTML || 'no content',
          containerChildren: containerAfterCreation?.children.length || 0
        });
        
        // If no iframe after 100ms, check again after 1 second
        if (!iframe) {
          const timer2 = setTimeout(() => {
            if (this.isDestroyed) return;
            const laterContainer = document.getElementById(this.containerId);
            const laterIframe = laterContainer?.querySelector('iframe');
            this.activeTimers.delete(timer2);
            
            
            logger.debug('🎵 YouTube DJ | Post-creation check (1000ms):', {
              containerExists: !!laterContainer,
              iframeCreated: !!laterIframe,
              containerHTML: laterContainer?.innerHTML || 'no content'
            });
          }, 900);
          this.activeTimers.add(timer2);
        }
      }, 100);
      this.activeTimers.add(timer1);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to initialize widget player:', error);
    }
  }

  /**
   * Player ready event handler
   */
  private onPlayerReady(event: YT.PlayerEvent): void {
    
    // CRITICAL: Check if iframe was actually created despite "ready" event
    const timer = setTimeout(() => {
      if (this.isDestroyed) return;
      this.activeTimers.delete(timer);
      // YouTube replaces the container div WITH an iframe, not putting an iframe inside it
      const container = document.getElementById(this.containerId);
      const isIframe = container?.tagName === 'IFRAME';
      const hasIframeChild = !!container?.querySelector('iframe');
      
      if (!isIframe && !hasIframeChild) {
        logger.debug('🎵 YouTube DJ | Player ready but no iframe - attempting recreation with different config');
        this.handleFailedIframeCreation();
        return;
      }
      
      logger.info('🎵 YouTube DJ | Widget player ready with working iframe');
      
      // The player is ready, mark it immediately
      this.isPlayerReady = true;
      this.continuePlayerReady();
    }, 250); // Give iframe time to appear
    this.activeTimers.add(timer);
  }
  
  /**
   * Continue player ready process after iframe verification
   */
  private continuePlayerReady(): void {
    // Clear the joining flag now that player is actually ready
    if (this.isJoiningSession) {
      logger.debug('🎵  Clearing isJoiningSession flag - player is ready');
      this.isJoiningSession = false;
    }
    
    // Sync initial mute state and volume from player
    const initialMuteState = this.player?.isMuted?.() || false;
    const initialVolume = this.player?.getVolume?.() || 50;
    
    // Get currently loaded video information from the YouTube player
    let loadedVideoInfo: VideoInfo | null = null;
    try {
      // Get the video URL from the YouTube player
      const videoUrl = this.player?.getVideoUrl();
      if (videoUrl) {
        // Extract video ID from URL (e.g., "https://www.youtube.com/watch?v=dQw4w9WgXcQ" -> "dQw4w9WgXcQ")
        const urlMatch = videoUrl.match(/[?&]v=([^&]+)/);
        const videoId = urlMatch?.[1];
        if (videoId) {
          // Create video info object for the loaded video
          loadedVideoInfo = {
            videoId: videoId,
            title: `Video ${videoId}`, // Placeholder title - will be updated when actual video info is fetched
            duration: this.player?.getDuration() || 0
          };
          
          logger.debug('🎵 YouTube DJ | Widget detected loaded video on player ready:', {
            videoId: loadedVideoInfo.videoId,
            duration: loadedVideoInfo.duration,
            source: 'widget initialization'
          });
        }
      }
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Could not get initial video info from player:', error);
      // Fallback: If we can't get it from the player, assume default video is loaded
      const queueState = this.store.getQueueState();
      const hasQueueVideo = queueState.items.length > 0 && queueState.currentIndex >= 0;
      if (!hasQueueVideo) {
        // Default video was loaded during initialization
        loadedVideoInfo = {
          videoId: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          duration: 213
        };
        logger.debug('🎵 YouTube DJ | Using fallback default video info on player ready');
      }
    }
    
    // Check if we expected to load a playlist but got default video instead
    const currentQueue = this.store.getQueueState();
    const currentItem = currentQueue.items[currentQueue.currentIndex];
    const DEFAULT_VIDEO_ID = 'dQw4w9WgXcQ';
    
    if (currentItem?.isPlaylist && loadedVideoInfo?.videoId === DEFAULT_VIDEO_ID) {
      logger.warn('🎵 YouTube DJ | Player initialized with default video despite playlist being current item');
      
      // Extract playlist ID
      const playlistId = currentItem.playlistId || 
                        (currentItem.videoId.startsWith('playlist:') 
                          ? currentItem.videoId.substring('playlist:'.length) 
                          : currentItem.videoId);
      
      // Set up validation to check if playlist will load
      this.validatePlaylistLoad(playlistId);
    }
    
    // Update state without triggering re-render
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        isReady: true,
        isInitializing: false,
        // isMuted and volume are now stored in client settings
        currentVideo: loadedVideoInfo
      }
    });

    // Process any queued commands
    if (this.commandQueue.length > 0) {
      logger.debug('🎵 YouTube DJ | Processing queued commands:', this.commandQueue.length);
      const queue = [...this.commandQueue];
      this.commandQueue = [];
      this.lastQueuedLoadCommand = null; // Clear the duplicate tracking
      
      // Process each queued command
      const timer = setTimeout(() => {
        if (this.isDestroyed) return;
        this.activeTimers.delete(timer);
        logger.debug('🎵 YouTube DJ | Processing queued commands after player ready');
        queue.forEach(cmd => {
          logger.debug('🎵 YouTube DJ | Processing queued command:', cmd.command);
          this.onPlayerCommand(cmd);
        });
      }, 100); // Small delay to ensure player is fully ready
      this.activeTimers.add(timer);
    }

    // Don't re-render here - it destroys the iframe!

    // Verify iframe after a delay (it may not exist immediately)
    const verifyTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      this.activeTimers.delete(verifyTimer);
      const widget = document.getElementById('youtube-dj-widget');
      const container = document.getElementById(this.containerId);
      const iframe = container?.querySelector('iframe');
      
      logger.debug('🎵 YouTube DJ | Post-ready iframe verification:', {
        widget: !!widget,
        container: !!container,
        iframe: !!iframe,
        iframeSrc: iframe?.src || 'no src',
        widgetVisible: widget?.offsetParent !== null
      });
    }, 500);
    this.activeTimers.add(verifyTimer);

    // Sync UI controls with actual player state
    const syncTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      this.syncUIWithPlayerState();
      this.activeTimers.delete(syncTimer);
    }, 100); // Small delay to ensure player is fully ready
    this.activeTimers.add(syncTimer);

    logger.info('🎵 YouTube DJ | Player is now ready for commands!');
  }

  /**
   * Process queued commands
   */
  private processCommandQueue(): void {
    if (this.commandQueue.length === 0) {
      return;
    }
    
    const queue = [...this.commandQueue];
    this.commandQueue = [];
    this.lastQueuedLoadCommand = null; // Clear the duplicate tracking
    
    queue.forEach(cmd => {
      logger.debug('🎵 YouTube DJ | Processing queued command:', cmd.command);
      this.onPlayerCommand(cmd);
    });
  }

  /**
   * Queue a command if it's not a duplicate of a recently queued load command
   */
  private queueCommandIfUnique(data: { command: string; args?: any[] }): void {
    // For loadVideoById commands, check if we already have the same video queued recently
    if (data.command === 'loadVideoById' && data.args && data.args[0]) {
      const videoId = data.args[0];
      const now = Date.now();
      
      // Check if we've queued this same video in the last 3 seconds
      if (this.lastQueuedLoadCommand && 
          this.lastQueuedLoadCommand.videoId === videoId && 
          (now - this.lastQueuedLoadCommand.timestamp) < 3000) {
        logger.debug('🎵 YouTube DJ | Skipping duplicate loadVideoById command for:', videoId);
        return;
      }
      
      // Update last queued load command
      this.lastQueuedLoadCommand = { videoId, timestamp: now };
    }
    
    // Check if this exact command is already in the queue
    const isDuplicate = this.commandQueue.some(cmd => 
      cmd.command === data.command && 
      JSON.stringify(cmd.args) === JSON.stringify(data.args)
    );
    
    if (isDuplicate) {
      logger.debug('🎵 YouTube DJ | Skipping duplicate command in queue:', data.command);
      return;
    }
    
    this.commandQueue.push(data);
  }

  /**
   * Get user's personal mute state from client settings
   */
  private getUserMuteState(): boolean {
    try {
      return (game as any).settings.get('bardic-inspiration', 'youtubeDJ.userMuted') || false;
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get user mute state, defaulting to false:', error);
      return false;
    }
  }

  /**
   * Get user's personal volume from client settings
   */
  private getUserVolume(): number {
    try {
      return (game as any).settings.get('bardic-inspiration', 'youtubeDJ.userVolume') || 50;
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get user volume, defaulting to 50:', error);
      return 50;
    }
  }

  /**
   * Set user's personal volume in client settings
   */
  private async setUserVolume(volume: number): Promise<void> {
    try {
      await (game as any).settings.set('bardic-inspiration', 'youtubeDJ.userVolume', volume);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to set user volume:', error);
    }
  }
  
  /**
   * Handle failed iframe creation (HTTPS origin issues)
   */
  private async handleFailedIframeCreation(): Promise<void> {
    logger.debug('🎵  Handling failed iframe creation - attempting workaround');
    
    // Reset player state
    this.player = null;
    this.isPlayerReady = false;
    
    // Try creating player with modified configuration for HTTPS
    try {
      const container = document.getElementById(this.containerId);
      if (!container) {
        throw new Error('Container not found for iframe recreation');
      }
      
      // Clear container
      container.innerHTML = '';
      
      // Get current video
      const queueState = this.store.getQueueState();
      const currentItem = queueState.items[queueState.currentIndex];
      
      // Don't use playlist IDs as video IDs - they're not valid for player initialization
      let videoId = 'dQw4w9WgXcQ'; // Default test video
      if (currentItem && !currentItem.isPlaylist && currentItem.videoId && !currentItem.videoId.startsWith('playlist:')) {
        videoId = currentItem.videoId;
      }
      
      // Modified config for HTTPS production environment
      const httpsConfig = {
        height: '140',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          enablejsapi: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
          // Additional HTTPS-specific parameters
          widget_referrer: window.location.origin,
          host: window.location.hostname
        },
        events: {
          onReady: this.onPlayerReady.bind(this),
          onStateChange: this.onPlayerStateChange.bind(this),
          onError: this.onPlayerError.bind(this)
        }
      };
      
      logger.debug('🎵  Recreating player with HTTPS config:', httpsConfig.playerVars);
      
      // Create new player with HTTPS-optimized config
      this.player = new YT.Player(this.containerId, httpsConfig);
      
      logger.debug('🎵  Player recreated, checking for iframe in 500ms');
      
    } catch (error) {
      logger.debug('🎵  Failed to recreate player:', error);
      logger.error('🎵 YouTube DJ | Failed to handle iframe creation failure:', error);
    }
  }

  /**
   * Player state change handler
   */
  private onPlayerStateChange(event: YT.OnStateChangeEvent): void {
    logger.debug('🎵 YouTube DJ | Widget player state changed:', event.data);
    
    // Check if we're in a playlist
    const playlist = this.player?.getPlaylist?.();
    const playlistIndex = this.player?.getPlaylistIndex?.();
    if (playlist && playlist.length > 0) {
      logger.debug('🎵 YouTube DJ | Playlist state:', {
        totalVideos: playlist.length,
        currentIndex: playlistIndex,
        currentVideoId: playlist[playlistIndex] || 'unknown'
      });
      
      // Update playlist info in state
      const currentQueue = this.store.getQueueState();
      const currentItem = currentQueue.items[currentQueue.currentIndex];
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          playlistInfo: {
            totalVideos: playlist.length,
            currentIndex: playlistIndex || 0,
            playlistId: currentItem?.playlistId
          }
        }
      });
    } else {
      // Clear playlist info if not in a playlist
      if (this.store.getPlayerState().playlistInfo) {
        this.store.updateState({
          player: {
            ...this.store.getPlayerState(),
            playlistInfo: undefined
          }
        });
      }
    }
    
    // Update playback state
    let playbackState: string;
    switch (event.data) {
      case YT.PlayerState.PLAYING:
        playbackState = 'playing';
        break;
      case YT.PlayerState.PAUSED:
        playbackState = 'paused';
        break;
      case YT.PlayerState.ENDED:
        playbackState = 'stopped';
        // Check if we're in a playlist and if this is the last video
        const endedPlaylist = this.player?.getPlaylist?.();
        const endedPlaylistIndex = this.player?.getPlaylistIndex?.();
        const isPlaylistEnd = !!(endedPlaylist && endedPlaylist.length > 0 && 
                              endedPlaylistIndex === endedPlaylist.length - 1);
        
        // Emit video ended hook for PlayerManager/QueueManager to handle auto-advance
        const currentVideo = this.store.getPlayerState().currentVideo;
        if (currentVideo?.videoId) {
          logger.debug('🎵 YouTube DJ | Video ended, emitting hook for auto-advance:', {
            videoId: currentVideo.videoId,
            isPlaylistEnd
          });
          Hooks.callAll('youtubeDJ.videoEnded', {
            videoId: currentVideo.videoId,
            isPlaylistEnd
          });
        }
        break;
      default:
        playbackState = 'stopped';
    }

    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        playbackState: playbackState as any
      }
    });

    // Don't re-render here - it destroys the iframe!
  }

  /**
   * Player error handler
   */
  private onPlayerError(event: YT.OnErrorEvent): void {
    logger.error('🎵 YouTube DJ | Widget player error:', event.data);
    
    const currentQueue = this.store.getQueueState();
    const currentItem = currentQueue.items[currentQueue.currentIndex];
    
    // Error 150 = The owner of the requested video does not allow it to be played in embedded players
    // Error 101 = The owner of the requested video does not allow it to be played in embedded players
    // Error 100 = The video requested was not found
    if (event.data === 150 || event.data === 101 || event.data === 100) {
      if (currentItem?.isPlaylist) {
        // This is a playlist that cannot be embedded
        logger.error('🎵 YouTube DJ | Playlist cannot be embedded:', currentItem.playlistId);
        ui.notifications?.error('This playlist has embedding disabled by its owner and cannot be played here. Please try a different playlist.');
        
        // Emit event to handle the failed playlist
        Hooks.callAll('youtubeDJ.playlistEmbedError', {
          playlistId: currentItem.playlistId,
          queueItemId: currentItem.id,
          error: event.data === 100 ? 'not_found' : 'embedding_disabled'
        });
        
        // Try to advance to next item in queue
        if (currentQueue.items.length > currentQueue.currentIndex + 1) {
          logger.info('🎵 YouTube DJ | Advancing to next queue item after playlist embed error');
          setTimeout(() => {
            Hooks.callAll('youtubeDJ.skipToNext', {
              reason: 'playlist_embed_error'
            });
          }, 1000); // Small delay to let user see the error
        }
      } else {
        // Check if we're playing a playlist
        const playlist = this.player?.getPlaylist?.();
        const playlistIndex = this.player?.getPlaylistIndex?.();
        
        if (playlist && playlist.length > 0) {
          logger.warn('🎵 YouTube DJ | Video in playlist cannot be embedded, attempting to skip to next video');
          ui.notifications?.warn('This video cannot be played in embedded mode, skipping to next...');
          
          // Try to skip to the next video in the playlist
          if (typeof playlistIndex === 'number' && playlistIndex < playlist.length - 1) {
            this.player?.nextVideo?.();
          } else {
            // If we're at the end or can't determine position, try playing from start
            this.player?.playVideoAt?.(0);
          }
        } else {
          // Single video error
          const errorMessage = event.data === 100 
            ? 'This video was not found or may have been deleted'
            : 'This video has embedding disabled and cannot be played here';
          ui.notifications?.error(errorMessage);
          
          // Try to skip to next item if available
          if (currentQueue.items.length > currentQueue.currentIndex + 1) {
            setTimeout(() => {
              Hooks.callAll('youtubeDJ.skipToNext', {
                reason: 'video_embed_error'
              });
            }, 1000);
          }
        }
      }
    } else if (event.data === 2) {
      // Error 2 = Invalid parameter
      if (currentItem?.isPlaylist) {
        const playlistId = currentItem.playlistId || 'unknown';
        
        // Check if playlist actually loaded despite the error
        const playlist = this.player?.getPlaylist?.();
        if (playlist && playlist.length > 0) {
          logger.warn('🎵 YouTube DJ | Error 2 but playlist loaded with', playlist.length, 'videos - likely a false positive');
          // Don't skip to next, the playlist is actually working
          return;
        }
        
        logger.error('🎵 YouTube DJ | Invalid playlist parameter:', playlistId);
        ui.notifications?.error(`Invalid playlist ID (${playlistId}) or the playlist may be private. Please check the playlist URL.`);
        
        // Emit event to handle the invalid playlist
        Hooks.callAll('youtubeDJ.playlistEmbedError', {
          playlistId: playlistId,
          queueItemId: currentItem.id,
          error: 'invalid_parameter'
        });
        
        // Try to advance to next item
        if (currentQueue.items.length > currentQueue.currentIndex + 1) {
          setTimeout(() => {
            Hooks.callAll('youtubeDJ.skipToNext', {
              reason: 'invalid_playlist_parameter'
            });
          }, 1000);
        }
      } else {
        ui.notifications?.error('Invalid video ID or the video may be private');
      }
    } else if (event.data === 5) {
      // Error 5 = HTML5 player error
      ui.notifications?.error('HTML5 player error - the content may not be supported in your browser');
    } else {
      // Generic error
      ui.notifications?.error(`YouTube Player Error: ${event.data}`);
    }
  }

  /**
   * Monitor playlist loading and ensure playback for listeners
   */
  private monitorPlaylistReady(playlistArgs: any): void {
    let checkCount = 0;
    const maxChecks = 10;
    
    const checkInterval = setInterval(() => {
      if (this.isDestroyed) {
        clearInterval(checkInterval);
        return;
      }
      
      checkCount++;
      
      try {
        const playlist = this.player?.getPlaylist?.();
        const playerState = this.player?.getPlayerState?.();
        
        logger.debug('🎵 YouTube DJ | Monitoring playlist ready for listener:', {
          checkCount,
          hasPlaylist: !!(playlist && playlist.length > 0),
          playlistLength: playlist?.length || 0,
          playerState
        });
        
        // Check if playlist is loaded and ready
        if (playlist && playlist.length > 0) {
          clearInterval(checkInterval);
          
          // If player is not playing, start playback
          if (playerState !== YT.PlayerState.PLAYING && playerState !== YT.PlayerState.BUFFERING) {
            logger.info('🎵 YouTube DJ | Playlist ready for listener, starting playback');
            
            // Get the index from the playlist args or default to 0
            const targetIndex = playlistArgs.index || 0;
            
            // Use playVideoAt with the correct index
            if (typeof this.player.playVideoAt === 'function') {
              this.player.playVideoAt(targetIndex);
              logger.debug('🎵 YouTube DJ | Using playVideoAt(' + targetIndex + ') to start playlist at correct position');
            } else {
              this.player.playVideo();
              logger.debug('🎵 YouTube DJ | Using playVideo to start playlist');
            }
            
            // After starting, we'll sync to the exact position via heartbeat
          } else {
            logger.debug('🎵 YouTube DJ | Playlist already playing for listener');
          }
        } else if (checkCount >= maxChecks) {
          clearInterval(checkInterval);
          logger.warn('🎵 YouTube DJ | Playlist not ready after max checks for listener');
        }
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Error checking playlist ready:', error);
        clearInterval(checkInterval);
      }
    }, 300); // Check every 300ms
    
    // Track the interval for cleanup
    this.activeTimers.add(checkInterval as any);
  }

  /**
   * Validate that a playlist actually loaded
   */
  private validatePlaylistLoad(expectedPlaylistId: string): void {
    // Default video ID that indicates playlist didn't load
    const DEFAULT_VIDEO_ID = 'dQw4w9WgXcQ';
    
    // Set up a timer to check if playlist loaded after a delay
    const validationTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      
      try {
        // Check what's currently loaded in the player
        const videoData = this.player?.getVideoData?.();
        const currentVideoId = videoData?.video_id;
        const playlist = this.player?.getPlaylist?.();
        
        logger.debug('🎵 YouTube DJ | Validating playlist load:', {
          expectedPlaylistId,
          currentVideoId,
          hasPlaylist: !!(playlist && playlist.length > 0),
          playlistLength: playlist?.length || 0
        });
        
        // Check if default video is still playing and no playlist loaded
        if (currentVideoId === DEFAULT_VIDEO_ID && (!playlist || playlist.length === 0)) {
          logger.error('🎵 YouTube DJ | Playlist failed to load, default video still playing:', expectedPlaylistId);
          
          // Get current queue to find the playlist item
          const currentQueue = this.store.getQueueState();
          const currentItem = currentQueue.items[currentQueue.currentIndex];
          
          if (currentItem?.isPlaylist && currentItem.playlistId === expectedPlaylistId) {
            // Notify user that playlist didn't load
            ui.notifications?.error(`Playlist ${expectedPlaylistId} could not be loaded. It may be private, deleted, or have embedding disabled.`);
            
            // Emit event to handle the failed playlist
            Hooks.callAll('youtubeDJ.playlistEmbedError', {
              playlistId: expectedPlaylistId,
              queueItemId: currentItem.id,
              error: 'load_failed'
            });
            
            // Try to advance to next item
            if (currentQueue.items.length > currentQueue.currentIndex + 1) {
              logger.info('🎵 YouTube DJ | Advancing to next queue item after playlist load failure');
              setTimeout(() => {
                Hooks.callAll('youtubeDJ.skipToNext', {
                  reason: 'playlist_load_failed'
                });
              }, 1000);
            }
          }
        } else if (playlist && playlist.length > 0) {
          logger.info('🎵 YouTube DJ | Playlist loaded successfully:', {
            playlistId: expectedPlaylistId,
            videoCount: playlist.length,
            firstVideoId: playlist[0]
          });
        }
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Could not validate playlist load:', error);
      }
    }, 3000); // Wait 3 seconds for playlist to load
    
    // Track the timer for cleanup
    this.activeTimers.add(validationTimer);
  }

  /**
   * Handle request for current playback time
   */
  private onGetCurrentTimeRequest(): void {
    if (!this.player || !this.isPlayerReady) {
      // Return stored time if player not ready
      const storedTime = this.store.getPlayerState().currentTime || 0;
      Hooks.callAll('youtubeDJ.currentTimeResponse', { currentTime: storedTime });
      return;
    }

    try {
      // Get current time from YouTube player
      const currentTime = this.player.getCurrentTime() || 0;
      Hooks.callAll('youtubeDJ.currentTimeResponse', { currentTime });
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get current time from player, using stored time');
      const storedTime = this.store.getPlayerState().currentTime || 0;
      Hooks.callAll('youtubeDJ.currentTimeResponse', { currentTime: storedTime });
    }
  }

  /**
   * Handle playlist index request for heartbeat
   */
  private onGetPlaylistIndexRequest(): void {
    if (!this.player || !this.isPlayerReady) {
      // No playlist index if player not ready
      Hooks.callAll('youtubeDJ.playlistIndexResponse', { playlistIndex: undefined });
      return;
    }

    try {
      // Get playlist index from YouTube player
      const playlistIndex = this.player.getPlaylistIndex?.();
      logger.debug('🎵 YouTube DJ | Responding with playlist index:', playlistIndex);
      Hooks.callAll('youtubeDJ.playlistIndexResponse', { playlistIndex });
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get playlist index from player');
      Hooks.callAll('youtubeDJ.playlistIndexResponse', { playlistIndex: undefined });
    }
  }

  /**
   * Handle player commands from other components
   */
  private async onPlayerCommand(data: { command: string; args?: any[] }): Promise<void> {
    logger.debug('🎵 YouTube DJ | Received player command:', data.command);
    
    // If player is initializing, queue the command
    if (this.store.getPlayerState().isInitializing) {
      logger.debug('🎵 YouTube DJ | Player is initializing, queueing command:', data.command);
      this.queueCommandIfUnique(data);
      return;
    }
    
    if (!this.player || !this.isPlayerReady) {
      logger.warn('🎵 YouTube DJ | Widget player not ready for command:', data.command);
      // Queue the command if it's not a duplicate
      this.queueCommandIfUnique(data);
      
      // Try to initialize the player if it's not ready and we're in a session
      const sessionState = this.store.getSessionState();
      if (sessionState.hasJoinedSession && !this.store.getPlayerState().isInitializing) {
        logger.debug('🎵 YouTube DJ | Attempting to initialize player for queued command');
        this.initializePlayer().then(() => {
          // Player ready handler will process queued commands
          logger.debug('🎵 YouTube DJ | Player initialization complete');
        }).catch(error => {
          logger.error('🎵 YouTube DJ | Failed to initialize player:', error);
        });
      }
      
      return;
    }

    try {
      logger.debug('🎵 YouTube DJ | Executing player command:', data.command);
      
      switch (data.command) {
        case 'playVideo':
          if (typeof this.player.playVideo === 'function') {
            this.player.playVideo();
            logger.debug('🎵 YouTube DJ | Play command sent to player');
          }
          break;
        case 'pauseVideo':
          if (typeof this.player.pauseVideo === 'function') {
            this.player.pauseVideo();
            logger.debug('🎵 YouTube DJ | Pause command sent to player');
          }
          break;
        case 'stopVideo':
          if (typeof this.player.stopVideo === 'function') {
            this.player.stopVideo();
            logger.debug('🎵 YouTube DJ | Stop command sent to player');
          }
          break;
        case 'seekTo':
          if (typeof this.player.seekTo === 'function') {
            // Throttle seek operations to prevent loops
            const now = Date.now();
            if (now - this.lastSeekTime > this.seekThrottleMs) {
              this.player.seekTo(data.args?.[0] || 0, data.args?.[1] || true);
              this.lastSeekTime = now;
              logger.debug('🎵 YouTube DJ | Seek command sent to player:', data.args?.[0]);
            } else {
              logger.debug('🎵 YouTube DJ | Seek command throttled:', data.args?.[0]);
            }
          }
          break;
        case 'loadVideoById':
          if (typeof this.player.loadVideoById === 'function') {
            const videoId = data.args?.[0];
            const startTime = data.args?.[1] || 0;
            this.player.loadVideoById(videoId, startTime);
            logger.debug('🎵 YouTube DJ | Load video command sent to player:', videoId);
            
            // Update the player state with the new video
            if (videoId) {
              this.store.updateState({
                player: {
                  ...this.store.getPlayerState(),
                  currentVideo: {
                    videoId: videoId,
                    title: '', // Will be updated when video loads
                    duration: 0,
                    currentTime: startTime
                  },
                  currentTime: startTime
                }
              });
            }
          }
          break;
        case 'cueVideoById':
          if (typeof this.player.cueVideoById === 'function') {
            this.player.cueVideoById(data.args?.[0], data.args?.[1] || 0);
            logger.debug('🎵 YouTube DJ | Cue video command sent to player:', data.args?.[0]);
          }
          break;
        case 'loadPlaylist':
          if (typeof this.player.loadPlaylist === 'function') {
            const playlistArgs = data.args?.[0];
            if (typeof playlistArgs === 'object' && playlistArgs.list) {
              // Check if we need to clear current video first
              const videoData = this.player?.getVideoData?.();
              const currentVideoId = videoData?.video_id;
              const DEFAULT_VIDEO_ID = 'dQw4w9WgXcQ';
              
              if (currentVideoId === DEFAULT_VIDEO_ID) {
                // Stop the default video first to ensure clean playlist load
                logger.debug('🎵 YouTube DJ | Stopping default video before loading playlist');
                this.player.stopVideo?.();
                
                // Small delay to ensure video is stopped
                setTimeout(() => {
                  if (this.isDestroyed) return;
                  this.player.loadPlaylist(playlistArgs);
                  logger.debug('🎵 YouTube DJ | Load playlist command sent after stopping default video:', playlistArgs.list);
                  
                  // For listeners, monitor when playlist is ready and start playback
                  if (!this.store.isDJ()) {
                    logger.debug('🎵 YouTube DJ | Listener detected, will monitor playlist loading');
                    this.monitorPlaylistReady(playlistArgs);
                  } else {
                    logger.debug('🎵 YouTube DJ | DJ detected, not monitoring playlist (auto-plays)');
                  }
                }, 100);
              } else {
                // No default video, load playlist directly
                this.player.loadPlaylist(playlistArgs);
                logger.debug('🎵 YouTube DJ | Load playlist command sent to player:', playlistArgs.list);
                
                // For listeners, monitor when playlist is ready and start playback
                if (!this.store.isDJ()) {
                  logger.debug('🎵 YouTube DJ | Listener detected, will monitor playlist loading');
                  this.monitorPlaylistReady(playlistArgs);
                } else {
                  logger.debug('🎵 YouTube DJ | DJ detected, not monitoring playlist (auto-plays)');
                }
              }
              
              // Set up validation to check if playlist actually loaded
              this.validatePlaylistLoad(playlistArgs.list);
            }
          }
          break;
        case 'cuePlaylist':
          if (typeof this.player.cuePlaylist === 'function') {
            const playlistArgs = data.args?.[0];
            if (typeof playlistArgs === 'object' && playlistArgs.list) {
              this.player.cuePlaylist(playlistArgs);
              logger.debug('🎵 YouTube DJ | Cue playlist command sent to player:', playlistArgs.list);
              
              // Also validate cued playlists
              this.validatePlaylistLoad(playlistArgs.list);
            }
          }
          break;
        case 'nextVideo':
          if (typeof this.player.nextVideo === 'function') {
            this.player.nextVideo();
            logger.debug('🎵 YouTube DJ | Next video command sent to player');
          }
          break;
        case 'previousVideo':
          if (typeof this.player.previousVideo === 'function') {
            this.player.previousVideo();
            logger.debug('🎵 YouTube DJ | Previous video command sent to player');
          }
          break;
        case 'playVideoAt':
          if (typeof this.player.playVideoAt === 'function' && data.args?.[0] !== undefined) {
            this.player.playVideoAt(data.args[0]);
            logger.debug('🎵 YouTube DJ | Play video at index command sent to player:', data.args[0]);
          }
          break;
        case 'mute':
          if (typeof this.player.mute === 'function') {
            this.player.mute();
            logger.debug('🎵 YouTube DJ | Mute command sent to player');
            // Update mute button visual state after muting (small delay to let player update)
            setTimeout(() => this.updateMuteButton(), 10);
          }
          break;
        case 'unMute':
          if (typeof this.player.unMute === 'function') {
            this.player.unMute();
            logger.debug('🎵 YouTube DJ | Unmute command sent to player');
            // Update mute button visual state after unmuting (small delay to let player update)
            setTimeout(() => this.updateMuteButton(), 10);
          }
          break;
        default:
          logger.warn('🎵 YouTube DJ | Unhandled player command:', data.command);
          break;
      }
      
      logger.debug('🎵 YouTube DJ | Player command completed:', data.command);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to execute player command:', error);
    }
  }

  /**
   * Handle state changes from SessionStore
   */
  private onStateChanged(event: StateChangeEvent): void {
    
    // Skip renders while joining session to prevent iframe destruction
    if (this.isJoiningSession) {
      logger.debug('🎵  Skipping render during join session process');
      logger.debug('🎵 YouTube DJ | Skipping render during join session process');
      return;
    }
    
    // Check if we're already initializing the player to avoid re-render during restoration
    const isInitializing = this.store.getPlayerState().isInitializing;
    
    // Only re-render for this user's session join - NOT for session leave or other changes
    const needsFullRender = !!(
      event.changes.session?.hasJoinedSession === true &&
      event.previous?.session?.hasJoinedSession === false &&
      !isInitializing  // Don't re-render if we're already initializing
    );

    if (needsFullRender) {
      logger.debug('🎵  FULL RENDER TRIGGERED - This will destroy iframe!', {
        reason: 'User session join',
        previous: event.previous?.session?.hasJoinedSession,
        current: event.changes.session.hasJoinedSession,
        isInitializing: isInitializing,
        iframeBeforeRender: !!document.querySelector(`#${this.containerId} iframe`)
      });
      
      logger.debug('🎵 YouTube DJ | Widget re-rendering for USER session JOIN:', {
        previous: event.previous?.session?.hasJoinedSession,
        current: event.changes.session.hasJoinedSession
      });
      
      this.render();
      
      // Check iframe after render
      setTimeout(() => {
        logger.debug('🎵  After full render:', {
          iframeAfterRender: !!document.querySelector(`#${this.containerId} iframe`),
          containerHTML: document.getElementById(this.containerId)?.innerHTML
        });
      }, 100);
    } else if (
      event.changes.session?.hasJoinedSession === true &&
      event.previous?.session?.hasJoinedSession === false &&
      isInitializing
    ) {
      // We're joining but already initializing player, just update UI without re-render
      logger.debug('🎵 YouTube DJ | Widget updating UI for session join (player initializing)');
      this.updateSessionJoinWithoutRender();
    } else if (
      event.changes.session?.hasJoinedSession === false &&
      event.previous?.session?.hasJoinedSession === true
    ) {
      // Handle session leave without full re-render
      logger.debug('🎵 YouTube DJ | Widget handling session LEAVE without re-render');
      this.updateSessionLeaveWithoutRender();
    } else {
      logger.debug('🎵  Selective update path taken:', {
        // Mute and volume changes are now handled via client settings
        isMutedChange: false, // Legacy compatibility
        volumeChange: false, // Legacy compatibility
        membersChange: event.changes.session?.members !== undefined,
        djChange: event.changes.session?.djUserId !== undefined,
        otherChanges: Object.keys(event.changes || {}).filter(k => !['player', 'session'].includes(k))
      });
      
      // Handle specific player state changes without re-rendering
      // Mute and volume changes are now handled via client settings, not state changes
      // Legacy mute/volume change handling removed
      
      // For other player state changes, update specific elements without re-rendering
      this.updateCompactStatus(event);
      
      // Also update member-related displays without re-rendering
      if (event.changes.session?.members !== undefined || event.changes.session?.djUserId !== undefined) {
        logger.debug('🎵  Updating member/DJ status (no re-render)');
        logger.debug('🎵 YouTube DJ | Widget updating for member/DJ changes without re-render');
        
        // Update controls when DJ status changes
        if (event.changes.session?.djUserId !== undefined) {
          this.updateWidgetSelectively(this.store.getState());
        }
      } else {
        logger.debug('🎵  Updating other elements (no re-render)');
        logger.debug('🎵 YouTube DJ | Widget updating specific elements for player state change');
      }
    }
  }

  /**
   * Update compact status display without re-rendering
   */
  private updateCompactStatus(event: StateChangeEvent): void {
    const state = this.store.getState();
    const isPlaying = state.player.playbackState === 'playing';
    const isDJ = state.session.djUserId === game.user?.id;
    const currentVideo = state.player.currentVideo;
    
    // Update compact status when minimized
    if (this.isMinimized()) {
      // Update play/pause icon
      const compactStatusIcon = this.widgetElement?.querySelector('.compact-status i');
      if (compactStatusIcon && event.changes.player?.playbackState !== undefined) {
        compactStatusIcon.className = `fas fa-${isPlaying ? 'play' : 'pause'}`;
        compactStatusIcon.style.color = isPlaying ? '#28a745' : '#ffc107';
      }
      
      // Update track info
      const trackInfo = this.widgetElement?.querySelector('.compact-track-info');
      if (trackInfo && event.changes.player?.currentVideo !== undefined) {
        trackInfo.textContent = currentVideo?.title || 'Unknown';
      }
    }
    
    // Update play/pause button for DJ regardless of minimized state
    if (isDJ && event.changes.player?.playbackState !== undefined) {
      const playPauseBtn = this.widgetElement?.querySelector('.widget-btn.playback-control');
      if (playPauseBtn) {
        const icon = playPauseBtn.querySelector('i');
        if (icon) {
          icon.className = `fas fa-${isPlaying ? 'pause' : 'play'}`;
        }
        playPauseBtn.setAttribute('title', isPlaying ? 'Pause' : 'Play');
      }
    }
  }

  /**
   * Update widget for session join without re-rendering
   */
  private updateSessionJoinWithoutRender(): void {
    // Update controls section to show DJ controls and leave button
    const controlsSection = this.widgetElement?.querySelector('.widget-controls');
    if (controlsSection) {
      const state = this.store.getState();
      const isDJ = state.session.djUserId === game.user?.id;
      const isPlaying = state.player.playbackState === 'playing';
      
      controlsSection.innerHTML = `
        ${isDJ ? `
          <button class="widget-btn playback-control" onclick="window.youtubeDJWidget?.togglePlayPause()" title="${isPlaying ? 'Pause' : 'Play'}">
            <i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i>
          </button>
        ` : ''}
        <button class="widget-btn" onclick="game.modules.get('bardic-inspiration').api.openYoutubeDJ()" title="Open DJ Controls">
          <i class="fas fa-sliders-h"></i>
        </button>
        <button class="widget-btn danger" onclick="window.youtubeDJWidget?.leaveSession()" title="Leave Session">
          <i class="fas fa-sign-out-alt"></i>
        </button>
        <button class="widget-btn secondary" onclick="window.youtubeDJWidget?.toggleMinimize()" title="${this.isMinimized() ? 'Maximize Player' : 'Minimize Player'}">
          <i class="fas fa-${this.isMinimized() ? 'chevron-down' : 'chevron-up'}"></i>
        </button>
      `;
    }

    // Remove info message if present
    const infoDiv = this.widgetElement?.querySelector('.widget-info');
    if (infoDiv) {
      infoDiv.remove();
    }

    // Ensure player container is visible
    const playerContainer = this.widgetElement?.querySelector('.player-container');
    if (playerContainer && !this.isMinimized()) {
      playerContainer.classList.add('active');
    }

    logger.debug('🎵 YouTube DJ | Widget updated for session join without re-render');
  }

  /**
   * Update widget for session leave without re-rendering
   */
  private updateSessionLeaveWithoutRender(): void {
    // Update controls section to show join button instead of leave button
    const controlsSection = this.widgetElement?.querySelector('.widget-controls');
    if (controlsSection) {
      controlsSection.innerHTML = `
        <button class="widget-btn" onclick="window.youtubeDJWidget?.joinSession()" title="Join Session">
          <i class="fas fa-play-circle"></i>
        </button>
        <button class="widget-btn secondary" onclick="window.youtubeDJWidget?.toggleMinimize()" title="${this.isMinimized() ? 'Maximize Player' : 'Minimize Player'}">
          <i class="fas fa-${this.isMinimized() ? 'chevron-down' : 'chevron-up'}"></i>
        </button>
      `;
    }

    // Hide player container when leaving session
    const playerContainer = this.widgetElement?.querySelector('.player-container');
    if (playerContainer) {
      playerContainer.classList.remove('active');
      
      // Pause the player if it's playing
      if (this.player && typeof this.player.pauseVideo === 'function') {
        this.player.pauseVideo();
        logger.debug('🎵 YouTube DJ | Paused player on session leave');
      }
    }

    // Update widget title to remove compact status
    const widgetTitle = this.widgetElement?.querySelector('.widget-title');
    if (widgetTitle) {
      widgetTitle.innerHTML = `
        <i class="fas fa-music"></i>
        YouTube DJ
      `;
    }

    // Add info message below header without affecting player container
    const header = this.widgetElement?.querySelector('.widget-header');
    let infoDiv = this.widgetElement?.querySelector('.widget-info');
    
    if (header && !infoDiv && !this.isMinimized()) {
      infoDiv = document.createElement('div');
      infoDiv.className = 'widget-info';
      infoDiv.innerHTML = `
        <i class="fas fa-info-circle"></i>
        Click "Join Session" to start listening to music
      `;
      header.insertAdjacentElement('afterend', infoDiv);
    }

    logger.debug('🎵 YouTube DJ | Widget updated for session leave');
  }

  /**
   * Toggle widget minimized/maximized state
   */
  toggleMinimize(): void {
    if (!this.widgetElement) return;
    
    // Toggle classes without re-rendering to preserve iframe
    this.widgetElement.classList.toggle('minimized');
    this.widgetElement.classList.toggle('maximized');
    
    // Update button icon and tooltip without full re-render
    this.updateMinimizeButton();
    
    // Show/hide player container with CSS only
    this.updatePlayerContainerVisibility();
    
    logger.debug('🎵 YouTube DJ | Widget toggled:', {
      minimized: this.isMinimized(),
      maximized: this.widgetElement.classList.contains('maximized')
    });
  }

  /**
   * Toggle mute state of the player
   */
  toggleMute(): void {
    // Check if user has joined session first
    const hasJoinedSession = this.store.getSessionState().hasJoinedSession;
    if (!hasJoinedSession) {
      logger.warn('🎵 YouTube DJ | Cannot toggle mute - not in session');
      return;
    }

    if (!this.player || !this.isPlayerReady) {
      logger.warn('🎵 YouTube DJ | Cannot toggle mute - player not ready');
      return;
    }

    try {
      // Get current mute state directly from player
      const currentlyMuted = this.player.isMuted();
      
      if (currentlyMuted) {
        this.player.unMute();
        logger.debug('🎵 YouTube DJ | Player unmuted via widget');
      } else {
        this.player.mute();
        logger.debug('🎵 YouTube DJ | Player muted via widget');
      }

      // Get the actual mute state after the change to ensure sync
      const actualMuteState = this.player.isMuted();

      // Update local state with actual player state
      // Mute state is now stored in client settings, no state update needed
      // Legacy state update removed

      // Update the mute button icon without full re-render (small delay to let player update)
      setTimeout(() => this.updateMuteButton(), 10);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to toggle mute:', error);
    }
  }

  /**
   * Update only the minimize button without re-rendering
   */
  private updateMinimizeButton(): void {
    // Get the minimize button (last button in the controls)
    const buttons = this.widgetElement?.querySelectorAll('.widget-controls button');
    const minimizeButton = buttons?.[buttons.length - 1]; // Last button is always minimize/maximize
    const icon = minimizeButton?.querySelector('i');
    
    if (minimizeButton && icon) {
      const isMinimized = this.isMinimized();
      icon.className = `fas fa-${isMinimized ? 'chevron-down' : 'chevron-up'}`;
      minimizeButton.setAttribute('title', isMinimized ? 'Maximize Player' : 'Minimize Player');
    }
  }

  /**
   * Update volume control mute button without re-rendering
   */
  private updateMuteButton(): void {
    // Only update mute button if user has joined session
    const hasJoinedSession = this.store.getSessionState().hasJoinedSession;
    if (!hasJoinedSession) {
      return;
    }
    
    // Query the actual YouTube player state instead of relying on stored state
    let actualMuteState = false;
    
    if (this.player && this.isPlayerReady) {
      try {
        actualMuteState = this.player.isMuted();
      } catch (error) {
        // Fallback to client setting if player query fails
        actualMuteState = this.getUserMuteState();
        logger.debug('🎵 YouTube DJ | Failed to query player mute state, using client setting:', error);
      }
    } else {
      // Player not ready, use client setting
      actualMuteState = this.getUserMuteState();
    }
    
    // Update volume control mute button
    const volumeMuteButton = this.widgetElement?.querySelector('.mute-volume-btn');
    const volumeIcon = volumeMuteButton?.querySelector('i');
    
    if (volumeMuteButton && volumeIcon) {
      volumeIcon.className = `fas fa-${actualMuteState ? 'volume-mute' : 'volume-up'}`;
      volumeMuteButton.setAttribute('title', actualMuteState ? 'Unmute' : 'Mute');
    }
    
    // Sync client setting with actual state if they differ
    const storedMuteState = this.getUserMuteState();
    if (actualMuteState !== storedMuteState) {
      logger.debug('🎵 YouTube DJ | Syncing client mute setting with actual player state:', {
        stored: storedMuteState,
        actual: actualMuteState
      });
      
      // Update client setting to match actual player
      (game as any).settings.set('bardic-inspiration', 'youtubeDJ.userMuted', actualMuteState);
    }
  }

  /**
   * Update player container visibility without re-rendering
   */
  private updatePlayerContainerVisibility(): void {
    const playerContainer = this.widgetElement?.querySelector('.player-container');
    const hasJoinedSession = this.store.getSessionState().hasJoinedSession;
    
    if (playerContainer) {
      if (hasJoinedSession && !this.isMinimized()) {
        // Show player when in session and not minimized
        playerContainer.classList.add('active');
      } else {
        // Hide player when not in session or minimized
        playerContainer.classList.remove('active');
      }
    }
  }

  /**
   * Check if widget is currently minimized
   */
  isMinimized(): boolean {
    return this.widgetElement?.classList.contains('minimized') || false;
  }

  /**
   * Join session directly from widget
   * THIS IS THE ONLY INTENDED WAY TO JOIN SESSIONS
   */
  async joinSession(): Promise<void> {
    
    logger.debug('🎵 YouTube DJ | Joining session from widget...');
    
    // Set flag to prevent re-renders during join process
    this.isJoiningSession = true;
    
    try {
      // Check if iframe exists and restore it if needed
      try {
        
        await this.ensurePlayerExists();
        
      } catch (error) {
        logger.debug('🎵 YouTube DJ | ensurePlayerExists failed:', {
          error: error.message,
          playerExists: !!this.player,
          playerReady: this.isPlayerReady,
          containerExists: !!document.getElementById(this.containerId),
          iframe: !!document.querySelector(`#${this.containerId} iframe`)
        });
        
        logger.warn('🎵 YouTube DJ | Could not ensure player exists, continuing with existing player:', error);
        // Continue with session join even if player recreation fails
      }
      
      // Enable autoplay consent first (important for user gesture)
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          autoplayConsent: true
        }
      });
      
      // Update session state to indicate this user has joined
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          hasJoinedSession: true,
          isConnected: true,
          connectionStatus: 'connected'
        }
      });
      
      // Add current user to session members via SessionStore
      const currentUser = game.user;
      if (currentUser) {
        const sessionState = this.store.getSessionState();
        const existingMember = sessionState.members.find(m => m.userId === currentUser.id);
        
        if (!existingMember) {
          const newMember = {
            userId: currentUser.id,
            name: currentUser.name || 'Unknown',
            isDJ: false,
            isActive: true,
            lastActivity: Date.now(),
            missedHeartbeats: 0
          };
          
          this.store.updateState({
            session: {
              ...sessionState,
              members: [...sessionState.members, newMember]
            }
          });
          
          // Only broadcast join message if we actually added the user
          this.broadcastMessage({
            type: 'USER_JOIN',
            userId: game.user?.id || '',
            timestamp: Date.now(),
            data: {
              userName: game.user?.name || 'Unknown',
              userId: game.user?.id || ''
            }
          });
        } else {
          // User already in session, just update their activity
          this.store.updateState({
            session: {
              ...sessionState,
              members: sessionState.members.map(member => 
                member.userId === currentUser.id 
                  ? { ...member, isActive: true, lastActivity: Date.now(), missedHeartbeats: 0 }
                  : member
              )
            }
          });
        }
      } else {
        // No current user context, still broadcast join for state sync
        this.broadcastMessage({
          type: 'USER_JOIN',
          userId: game.user?.id || '',
          timestamp: Date.now(),
          data: {
            userName: game.user?.name || 'Unknown',
            userId: game.user?.id || ''
          }
        });
      }
      
      // Request current state from DJ/other users
      this.broadcastMessage({
        type: 'STATE_REQUEST',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
      
      logger.info('🎵 YouTube DJ | Successfully joined session from widget');
      ui.notifications?.success('Joined YouTube DJ session!');
      
      // CRITICAL: Don't clear the flag yet! Wait for player to be ready
      // The flag will be cleared when the player is actually ready
      // this.isJoiningSession = false; // REMOVED - causes re-render before iframe creation
      
      // Perform selective update without clearing the flag
      this.updateWidgetSelectively(this.store.getState());
      
      // Clear the flag only after player is ready or after timeout
      setTimeout(() => {
        if (this.isJoiningSession) {
          logger.debug('🎵  Clearing isJoiningSession flag after timeout');
          this.isJoiningSession = false;
        }
      }, 5000); // 5 second timeout as safety net
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to join session from widget:', error);
      ui.notifications?.error('Failed to join session. Please try again.');
      
      // Clear the flag even on error
      this.isJoiningSession = false;
    }
  }

  /**
   * Toggle play/pause for the DJ
   */
  async togglePlayPause(): Promise<void> {
    logger.debug('🎵 YouTube DJ | Toggling play/pause from widget...');
    
    try {
      const state = this.store.getState();
      
      // Only DJ can control playback
      if (state.session.djUserId !== game.user?.id) {
        ui.notifications?.warn('Only the DJ can control playback');
        return;
      }
      
      const isPlaying = state.player.playbackState === 'playing';
      
      // Get PlayerManager instance from global
      const playerManager = (globalThis as any).youtubeDJPlayerManager;
      if (!playerManager) {
        logger.error('🎵 YouTube DJ | PlayerManager not available');
        return;
      }
      
      logger.debug('🎵 YouTube DJ | Current playback state:', isPlaying ? 'playing' : 'paused');
      
      // Use PlayerManager's play/pause methods
      try {
        if (isPlaying) {
          logger.debug('🎵 YouTube DJ | Calling pause...');
          await playerManager.pause();
        } else {
          logger.debug('🎵 YouTube DJ | Calling play...');
          await playerManager.play();
        }
      } catch (playError) {
        // If play fails due to no video, show a more helpful message
        if (playError.message?.includes('No video loaded')) {
          ui.notifications?.warn('No video in queue. Add videos to the queue first.');
        } else {
          throw playError;
        }
      }
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to toggle playback:', error);
      ui.notifications?.error(`Failed to toggle playback: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Leave session directly from widget
   * THIS IS THE ONLY INTENDED WAY TO LEAVE SESSIONS
   */
  async leaveSession(): Promise<void> {
    logger.debug('🎵 YouTube DJ | Leaving session from widget...');
    
    try {
      const currentUser = game.user;
      if (currentUser) {
        // Broadcast user leave message before updating local state
        this.broadcastMessage({
          type: 'USER_LEAVE',
          userId: currentUser.id,
          timestamp: Date.now(),
          data: {
            userName: currentUser.name || 'Unknown',
            userId: currentUser.id
          }
        });
        
        // Remove user from session members
        const sessionState = this.store.getSessionState();
        const updatedMembers = sessionState.members.filter(m => m.userId !== currentUser.id);
        
        this.store.updateState({
          session: {
            ...sessionState,
            hasJoinedSession: false,
            isConnected: false,
            connectionStatus: 'disconnected',
            members: updatedMembers,
            // If leaving user was DJ, clear DJ role
            djUserId: sessionState.djUserId === currentUser.id ? null : sessionState.djUserId
          },
          // Reset player state when leaving session
          player: {
            isReady: false,
            isInitializing: false,
            isRecreating: false,
            playbackState: 'paused' as const,
            currentVideo: null,
            currentTime: 0,
            duration: 0,
            // volume and isMuted are now stored in client settings
            autoplayConsent: false,
            lastHeartbeat: null,
            driftTolerance: 1.0,
            heartbeatFrequency: 2000
          }
        });
      }
      
      // Clear command queue when leaving session
      this.commandQueue = [];
      this.lastQueuedLoadCommand = null;
      
      // Reset player ready state when leaving
      this.isPlayerReady = false;
      
      // Heartbeat management is handled by PlayerManager, not widget
      
      logger.info('🎵 YouTube DJ | Successfully left session from widget');
      ui.notifications?.info('Left YouTube DJ session');
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to leave session from widget:', error);
      ui.notifications?.error('Failed to leave session. Please try again.');
    }
  }

  /**
   * Broadcast message via socket to other users
   */
  private broadcastMessage(message: any): void {
    try {
      game.socket?.emit('module.bardic-inspiration', message);
      logger.debug('🎵 YouTube DJ | Widget broadcasted message:', message.type);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to broadcast message:', error);
    }
  }

  /**
   * Ensure player iframe exists and recreate if needed
   */
  private async ensurePlayerExists(): Promise<void> {
    let container = document.getElementById(this.containerId);
    
    // Check if the element is an iframe (YouTube replaced our div)
    const isIframe = container?.tagName === 'IFRAME';
    const hasWorkingPlayer = this.player && this.isPlayerReady;
    
    // If we have a working player and iframe, no need to recreate
    if (hasWorkingPlayer && isIframe) {
      logger.debug('🎵 YouTube DJ | Player and iframe exist and are ready, no recreation needed');
      // Make sure container is visible
      const playerContainerWrapper = this.widgetElement?.querySelector('.player-container');
      if (playerContainerWrapper && !playerContainerWrapper.classList.contains('active')) {
        playerContainerWrapper.classList.add('active');
      }
      return;
    }
    
    // Check if we need recreation
    const needsRecreation = !isIframe || !this.player || !this.isPlayerReady;
    
    if (needsRecreation) {
      logger.info('🎵 YouTube DJ | Player needs recreation:', {
        elementType: container?.tagName,
        isIframe: isIframe,
        hasPlayer: !!this.player,
        isPlayerReady: this.isPlayerReady
      });
      
      // Reset player state
      this.player = null;
      this.isPlayerReady = false;
      
      // If the container is an iframe, we need to replace it with a div
      if (isIframe) {
        const playerContainerWrapper = this.widgetElement?.querySelector('.player-container');
        if (playerContainerWrapper) {
          // Replace iframe with div container
          playerContainerWrapper.innerHTML = `<div id="${this.containerId}" style="width: 100%; height: 100%;"></div>`;
          container = document.getElementById(this.containerId);
          logger.debug('🎵 YouTube DJ | Replaced iframe with div container');
        }
      } else if (!container) {
        // Container doesn't exist, create it
        const playerContainerWrapper = this.widgetElement?.querySelector('.player-container');
        if (playerContainerWrapper) {
          playerContainerWrapper.innerHTML = `<div id="${this.containerId}" style="width: 100%; height: 100%;"></div>`;
          container = document.getElementById(this.containerId);
          logger.debug('🎵 YouTube DJ | Created new player container');
        } else {
          logger.error('🎵 YouTube DJ | Player container wrapper not found');
          throw new Error('Player container wrapper not found');
        }
      } else {
        // Container exists and is a div, just clear it
        container.innerHTML = '';
        logger.debug('🎵 YouTube DJ | Cleared existing container');
      }
      
      // Make sure container is visible (required for YouTube API)
      const playerContainerWrapper = this.widgetElement?.querySelector('.player-container');
      if (playerContainerWrapper && !playerContainerWrapper.classList.contains('active')) {
        playerContainerWrapper.classList.add('active');
        logger.debug('🎵 YouTube DJ | Made player container visible');
      }
      
      // Mark as initializing
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          isInitializing: true,
          isReady: false
        }
      });
      
      // Check API availability and load if needed
      if (!window.YT || !window.YT.Player) {
        logger.debug('🎵 YouTube DJ | YouTube API not available, loading it...');
        try {
          await this.loadYouTubeAPI();
          logger.debug('🎵 YouTube DJ | YouTube API loaded successfully');
        } catch (error) {
          logger.error('🎵 YouTube DJ | Failed to load YouTube API:', error);
          throw new Error('YouTube API could not be loaded');
        }
      }
      
      // Use same initialization timing as initial render
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(async () => {
            logger.debug('🎵 YouTube DJ | Initializing player after DOM settle...');
            await this.initializePlayer();
            resolve();
          }, 500);
        });
      });
      
      logger.info('🎵 YouTube DJ | Player successfully recreated');
    } else {
      logger.debug('🎵 YouTube DJ | Player iframe and player object exist, no recreation needed');
      
      // Ensure container is visible even if player exists
      const playerContainerWrapper = this.widgetElement?.querySelector('.player-container');
      if (playerContainerWrapper && !playerContainerWrapper.classList.contains('active')) {
        playerContainerWrapper.classList.add('active');
        logger.debug('🎵 YouTube DJ | Made existing player container visible');
      }
    }
  }

  /**
   * Load YouTube IFrame API script
   */
  private loadYouTubeAPI(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if API is already loaded
      if (window.YT && window.YT.Player) {
        logger.debug('🎵 YouTube DJ | YouTube API already loaded');
        resolve();
        return;
      }

      // Check if script is already loading/loaded
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (existingScript) {
        logger.debug('🎵 YouTube DJ | YouTube API script already in DOM, waiting for it to load...');
        // Wait for existing script to load
        this.waitForYouTubeAPI().then(resolve).catch(reject);
        return;
      }

      // Load YouTube API script
      logger.debug('🎵 YouTube DJ | Loading YouTube API script...');
      (window as any).onYouTubeIframeAPIReady = () => {
        logger.debug('🎵 YouTube DJ | YouTube API ready callback fired');
        resolve();
      };
      
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        logger.error('🎵 YouTube DJ | Failed to load YouTube API script');
        reject(new Error('Failed to load YouTube API'));
      };
      document.head.appendChild(script);
      
      // Set timeout for loading
      setTimeout(() => {
        if (!window.YT || !window.YT.Player) {
          logger.error('🎵 YouTube DJ | YouTube API load timeout');
          reject(new Error('YouTube API load timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Wait for YouTube API to be available with timeout
   */
  private waitForYouTubeAPI(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = 10000; // 10 second timeout
      const startTime = Date.now();
      
      const checkAPI = () => {
        if (window.YT && window.YT.Player) {
          logger.debug('🎵 YouTube DJ | YouTube API is ready');
          resolve();
        } else if (Date.now() - startTime > timeout) {
          logger.error('🎵 YouTube DJ | YouTube API wait timeout');
          reject(new Error('YouTube API failed to load within timeout'));
        } else {
          setTimeout(checkAPI, 100);
        }
      };
      checkAPI();
    });
  }

  /**
   * Stop any heartbeat intervals (for cleanup)
   */
  private stopHeartbeat(): void {
    // Widget doesn't manage heartbeat directly, but this method is called for consistency
    // The actual heartbeat is managed by PlayerManager
    logger.debug('🎵 YouTube DJ | Widget heartbeat cleanup called');
  }

  /**
   * Handle socket messages for multi-user synchronization
   */
  private onSocketMessage(message: any): void {
    if (!message || !message.type) return;
    
    logger.debug('🎵 YouTube DJ | Widget received socket message:', {
      type: message.type,
      fromUser: message.userId,
      isDJ: this.store.isDJ(),
      currentUser: game.user?.id
    });
    
    try {
      switch (message.type) {
        case 'USER_JOIN':
        case 'USER_LEAVE':
          // These are now handled by SessionManager only to avoid duplicates
          break;
        case 'STATE_REQUEST':
          this.handleStateRequest(message);
          break;
        case 'STATE_RESPONSE':
          this.handleStateResponse(message);
          break;
        case 'HEARTBEAT':
          this.handleHeartbeat(message);
          break;
        case 'PLAY':
        case 'PAUSE':
        case 'SEEK':
        case 'LOAD':
        case 'LOAD_PLAYLIST':
          this.handlePlayerCommand(message);
          break;
        case 'PLAYLIST_NEXT':
        case 'PLAYLIST_PREV':
          this.handlePlaylistNavigation(message);
          break;
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Widget socket message error:', error);
    }
  }

  // User join/leave handlers removed - now handled by SessionManager only to avoid duplicates

  /**
   * Handle state request from other users
   */
  private handleStateRequest(message: any): void {
    if (message.userId === game.user?.id) return; // Ignore own messages
    
    // Only DJ or established users should respond
    if (this.store.isDJ() || this.store.getSessionState().hasJoinedSession) {
      const currentState = this.store.getState();
      
      this.broadcastMessage({
        type: 'STATE_RESPONSE',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: currentState
      });
    }
  }

  /**
   * Handle state response from other users
   */
  private handleStateResponse(message: any): void {
    if (message.userId === game.user?.id) return; // Ignore own messages
    
    const receivedState = message.data;
    if (receivedState) {
      // Merge received state with current state
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          members: receivedState.session?.members || [],
          djUserId: receivedState.session?.djUserId || null
        },
        queue: receivedState.queue || this.store.getQueueState(),
        player: {
          ...this.store.getPlayerState(),
          currentVideo: receivedState.player?.currentVideo || null
        }
      });
      
      logger.info('🎵 YouTube DJ | State synchronized from user:', message.userId);
    }
  }

  /**
   * Handle heartbeat for synchronization
   */
  private handleHeartbeat(message: any): void {
    if (message.userId === game.user?.id) return; // Ignore own heartbeats
    if (this.store.isDJ()) return; // DJ doesn't sync to others
    
    logger.debug('🎵 YouTube DJ | Received heartbeat from DJ:', {
      hasData: !!message.data,
      isPlayerReady: this.isPlayerReady,
      playlistId: message.data?.playlistId,
      playlistIndex: message.data?.playlistIndex
    });
    
    const heartbeat = message.data;
    if (heartbeat && this.isPlayerReady) {
      // Sync with heartbeat data
      this.syncWithHeartbeat(heartbeat);
    } else if (!this.isPlayerReady) {
      logger.debug('🎵 YouTube DJ | Skipping heartbeat sync - player not ready');
    }
  }

  /**
   * Sync widget player with heartbeat data
   */
  private syncWithHeartbeat(heartbeat: any): void {
    logger.debug('🎵 YouTube DJ | Starting heartbeat sync:', {
      heartbeatVideoId: heartbeat.videoId,
      heartbeatPlaylistId: heartbeat.playlistId,
      heartbeatPlaylistIndex: heartbeat.playlistIndex,
      heartbeatIsPlaying: heartbeat.isPlaying
    });
    
    const currentVideo = this.store.getPlayerState().currentVideo;
    
    // Get real current time from YouTube player if available
    let currentTime = this.store.getPlayerState().currentTime || 0;
    if (this.player && this.isPlayerReady) {
      try {
        currentTime = this.player.getCurrentTime() || 0;
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Failed to get current time from player for sync, using stored time');
      }
    }
    
    // Ignore very old heartbeats to prevent sync loops
    const heartbeatAge = Date.now() - heartbeat.timestamp;
    if (heartbeatAge > 5000) { // 5 seconds old
      logger.debug('🎵 YouTube DJ | Ignoring stale heartbeat:', heartbeatAge + 'ms old');
      return;
    }
    
    // Check if video changed (only if heartbeat has a video)
    if (heartbeat.videoId && currentVideo?.videoId !== heartbeat.videoId) {
      logger.debug('🎵 YouTube DJ | Widget syncing to new video:', heartbeat.videoId);
      this.onPlayerCommand({ 
        command: 'loadVideoById', 
        args: [heartbeat.videoId, heartbeat.currentTime] 
      });
      return;
    }

    // Check if we're dealing with a playlist
    const currentQueue = this.store.getQueueState();
    const currentItem = currentQueue.items[currentQueue.currentIndex];
    const isPlaylist = currentItem?.isPlaylist;
    
    // For playlists, check if player is actually ready with content
    if (isPlaylist) {
      const playlist = this.player?.getPlaylist?.();
      const playerState = this.player?.getPlayerState?.();
      
      // Skip sync if playlist is not loaded or player not ready
      if (!playlist || playlist.length === 0 || playerState === YT.PlayerState.UNSTARTED) {
        logger.debug('🎵 YouTube DJ | Skipping heartbeat sync - playlist not ready yet');
        return;
      }
      
      // Check if we're on the correct playlist video
      if (heartbeat.playlistIndex !== undefined) {
        const currentIndex = this.player?.getPlaylistIndex?.();
        logger.debug('🎵 YouTube DJ | Playlist sync check:', {
          djIndex: heartbeat.playlistIndex,
          listenerIndex: currentIndex,
          needsSync: currentIndex !== heartbeat.playlistIndex
        });
        
        if (currentIndex !== undefined && currentIndex !== heartbeat.playlistIndex) {
          logger.info('🎵 YouTube DJ | Syncing to DJ playlist position:', {
            from: currentIndex,
            to: heartbeat.playlistIndex
          });
          
          // Use playVideoAt to jump to the correct video
          if (typeof this.player.playVideoAt === 'function') {
            this.player.playVideoAt(heartbeat.playlistIndex);
            
            // If playing, ensure we sync the time within that video too
            if (heartbeat.isPlaying && heartbeat.currentTime > 0) {
              setTimeout(() => {
                if (!this.isDestroyed && this.player) {
                  this.player.seekTo(heartbeat.currentTime, true);
                }
              }, 500); // Give time for video to load
            }
          }
          return;
        }
      } else if (isPlaylist) {
        // No playlist index in heartbeat but we're playing a playlist
        logger.debug('🎵 YouTube DJ | Warning: No playlist index in heartbeat for playlist playback');
      }
    }
    
    // Only sync if we're playing the same video (or it's a playlist)
    if (currentVideo?.videoId === heartbeat.videoId || isPlaylist) {
      // Check for significant time drift using configured tolerance
      const driftTolerance = this.store.getPlayerState().driftTolerance;
      const timeDrift = Math.abs(currentTime - heartbeat.currentTime);
      const localPlaying = this.store.getPlayerState().playbackState === 'playing';
      
      if (timeDrift > driftTolerance && localPlaying && heartbeat.isPlaying) {
        // Throttle sync seeks to prevent loops
        const now = Date.now();
        if (now - this.lastSeekTime > this.seekThrottleMs) {
          logger.debug('🎵 YouTube DJ | Widget syncing time drift:', {
            drift: timeDrift,
            tolerance: driftTolerance,
            local: currentTime,
            remote: heartbeat.currentTime
          });
          this.onPlayerCommand({ 
            command: 'seekTo', 
            args: [heartbeat.currentTime, true] 
          });
        } else {
          logger.debug('🎵 YouTube DJ | Sync seek throttled to prevent loop');
        }
      }

      // Sync play/pause state only if different
      if (localPlaying !== heartbeat.isPlaying) {
        logger.debug('🎵 YouTube DJ | Widget syncing play state:', heartbeat.isPlaying);
        if (heartbeat.isPlaying) {
          this.onPlayerCommand({ command: 'playVideo' });
        } else {
          this.onPlayerCommand({ command: 'pauseVideo' });
        }
      }
    }
  }

  /**
   * Handle playlist navigation commands from socket
   */
  private handlePlaylistNavigation(message: any): void {
    if (message.userId === game.user?.id) return; // Ignore own messages
    if (this.store.isDJ()) return; // DJ controls their own player
    
    if (!this.isPlayerReady || !this.player) {
      logger.debug('🎵 YouTube DJ | Player not ready for playlist navigation');
      return;
    }
    
    switch (message.type) {
      case 'PLAYLIST_NEXT':
        if (typeof this.player.nextVideo === 'function') {
          this.player.nextVideo();
          logger.debug('🎵 YouTube DJ | Advanced to next video in playlist (from DJ command)');
        }
        break;
      case 'PLAYLIST_PREV':
        if (typeof this.player.previousVideo === 'function') {
          this.player.previousVideo();
          logger.debug('🎵 YouTube DJ | Went to previous video in playlist (from DJ command)');
        }
        break;
    }
  }

  /**
   * Handle player commands from other users
   */
  private handlePlayerCommand(message: any): void {
    if (message.userId === game.user?.id) return; // Ignore own commands
    if (this.store.isDJ()) return; // DJ doesn't respond to others' commands
    
    // Convert socket message to player command
    switch (message.type) {
      case 'PLAY':
        logger.debug('🎵 YouTube DJ | Received PLAY command from DJ');
        
        // Check if we're dealing with a playlist that might still be loading
        const currentQueue = this.store.getQueueState();
        const currentItem = currentQueue.items[currentQueue.currentIndex];
        if (currentItem?.isPlaylist) {
          const playlist = this.player?.getPlaylist?.();
          if (!playlist || playlist.length === 0) {
            logger.debug('🎵 YouTube DJ | Playlist not ready yet, delaying play command');
            // Retry after a short delay
            setTimeout(() => {
              if (!this.isDestroyed) {
                this.onPlayerCommand({ command: 'playVideo' });
              }
            }, 500);
            return;
          }
        }
        
        this.onPlayerCommand({ command: 'playVideo' });
        break;
      case 'PAUSE':
        this.onPlayerCommand({ command: 'pauseVideo' });
        break;
      case 'SEEK':
        this.onPlayerCommand({ command: 'seekTo', args: [message.data?.time, true] });
        break;
      case 'LOAD':
        this.onPlayerCommand({ 
          command: 'loadVideoById', 
          args: [message.data?.videoId, message.data?.startTime || 0] 
        });
        break;
      case 'LOAD_PLAYLIST':
        const command = message.data?.autoPlay !== false ? 'loadPlaylist' : 'cuePlaylist';
        logger.debug('🎵 YouTube DJ | Received LOAD_PLAYLIST message:', {
          playlistId: message.data?.playlistId,
          autoPlay: message.data?.autoPlay,
          command: command
        });
        this.onPlayerCommand({ 
          command: command, 
          args: [{
            list: message.data?.playlistId,
            listType: 'playlist',
            index: 0
          }] 
        });
        
        // For listeners, loadPlaylist might not auto-play, so send explicit play command after a delay
        if (message.data?.autoPlay !== false && !this.store.isDJ()) {
          setTimeout(() => {
            if (!this.isDestroyed && this.isPlayerReady) {
              logger.debug('🎵 YouTube DJ | Sending play command after playlist load');
              this.onPlayerCommand({ command: 'playVideo' });
            }
          }, 1000); // Give playlist time to load
        }
        break;
    }
  }


  /**
   * Ensure YouTube API is loaded
   */
  private async ensureYouTubeAPI(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }

      // Check if script is already loading
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (existingScript) {
        const checkReady = () => {
          if (window.YT && window.YT.Player) {
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
        return;
      }

      // Load YouTube API
      (window as any).onYouTubeIframeAPIReady = () => resolve();
      
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => reject(new Error('Failed to load YouTube API'));
      document.head.appendChild(script);
      
      setTimeout(() => {
        if (!window.YT || !window.YT.Player) {
          reject(new Error('YouTube API load timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.isDestroyed = true;
    
    // Clear all active timers
    this.activeTimers.forEach(timer => clearTimeout(timer));
    this.activeTimers.clear();
    
    if (this.player) {
      if (typeof this.player.destroy === 'function') {
        this.player.destroy();
      }
      this.player = null;
    }
    this.isPlayerReady = false;
    
    if (this.widgetElement) {
      this.widgetElement.remove();
      this.widgetElement = null;
    }
    
    // Remove socket listener
    game.socket?.off('module.bardic-inspiration', this.onSocketMessage.bind(this));
    
    // Remove hook listeners
    Hooks.off('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.off('youtubeDJ.playerCommand', this.onPlayerCommand.bind(this));
    Hooks.off('youtubeDJ.localPlayerCommand', this.onPlayerCommand.bind(this));
    Hooks.off('youtubeDJ.getCurrentTimeRequest', this.onGetCurrentTimeRequest.bind(this));
    Hooks.off('youtubeDJ.getPlaylistIndexRequest', this.onGetPlaylistIndexRequest.bind(this));
    
    // Remove from global reference
    (window as any).youtubeDJWidget = null;
    
    logger.debug('🎵 YouTube DJ | Widget destroyed and cleaned up');
  }

  /**
   * Handle volume slider change
   */
  onVolumeChange(event: Event): void {
    logger.debug('🎵 YouTube DJ | onVolumeChange called', { event: event.type, target: event.target });
    
    const slider = event.target as HTMLInputElement;
    const volume = parseInt(slider.value, 10);
    
    logger.debug('🎵 YouTube DJ | Volume change details:', {
      sliderValue: slider.value,
      parsedVolume: volume,
      playerReady: this.isPlayerReady,
      hasPlayer: !!this.player
    });
    
    if (!this.player || !this.isPlayerReady) {
      logger.warn('🎵 YouTube DJ | Cannot change volume - player not ready', {
        player: !!this.player,
        isReady: this.isPlayerReady
      });
      return;
    }

    try {
      logger.debug(`🎵 YouTube DJ | Calling player.setVolume(${volume})`);
      
      // Update YouTube player volume
      this.player.setVolume(volume);
      
      // Verify the volume was actually set
      const actualVolume = this.player.getVolume();
      logger.debug(`🎵 YouTube DJ | Volume set result - requested: ${volume}, actual: ${actualVolume}`);
      
      // Store volume in client settings
      this.setUserVolume(volume);

      // Update tooltip
      slider.setAttribute('title', `Volume: ${volume}%`);
      
      logger.debug(`🎵 YouTube DJ | Volume change completed successfully: ${volume}%`);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to change volume:', error);
    }
  }

  /**
   * Update volume slider without re-rendering entire widget
   */
  private updateVolumeSlider(): void {
    const volumeSlider = this.widgetElement?.querySelector('.volume-slider') as HTMLInputElement;
    
    if (volumeSlider) {
      // Query actual YouTube player volume if available
      let actualVolume = this.getUserVolume();
      
      if (this.player && this.isPlayerReady) {
        try {
          actualVolume = this.player.getVolume();
          
          // Sync client setting with actual state if they differ
          const storedVolume = this.getUserVolume();
          if (Math.abs(actualVolume - storedVolume) > 1) { // Allow 1% tolerance
            logger.debug('🎵 YouTube DJ | Syncing client setting with actual player volume:', {
              stored: storedVolume,
              actual: actualVolume
            });
            
            // Update client setting to match actual player
            this.setUserVolume(actualVolume);
          }
        } catch (error) {
          logger.debug('🎵 YouTube DJ | Failed to query player volume, using stored:', error);
        }
      }
      
      const roundedVolume = Math.round(actualVolume);
      volumeSlider.value = actualVolume.toString();
      volumeSlider.setAttribute('title', `Volume: ${roundedVolume}%`);
    }
  }

  /**
   * Attach event listeners to volume slider
   */
  private attachVolumeSliderListeners(): void {
    const volumeSlider = this.widgetElement?.querySelector('.volume-slider') as HTMLInputElement;
    if (!volumeSlider) {
      logger.debug('🎵 YouTube DJ | Volume slider not found for event listener attachment');
      return;
    }

    // Remove any existing listeners to prevent duplicates
    volumeSlider.removeEventListener('input', this.onVolumeChange.bind(this));
    volumeSlider.removeEventListener('change', this.onVolumeChange.bind(this));

    // Add event listeners for both input and change events
    volumeSlider.addEventListener('input', this.onVolumeChange.bind(this));
    volumeSlider.addEventListener('change', this.onVolumeChange.bind(this));

    logger.debug('🎵 YouTube DJ | Volume slider event listeners attached');
  }

  /**
   * Update handoff request notifications without affecting the player
   */
  private updateHandoffNotifications(): void {
    if (!this.widgetElement) return;
    
    const sessionState = this.store.getSessionState();
    const currentUserId = game.user?.id;
    const isDJ = this.store.isDJ();
    const hasJoinedSession = sessionState.hasJoinedSession;
    
    // Only show handoff notifications to the current DJ when they have joined session
    if (!isDJ || !hasJoinedSession || !currentUserId) {
      // Clear any existing notifications
      const notificationArea = this.widgetElement.querySelector('.handoff-notifications');
      if (notificationArea) {
        notificationArea.innerHTML = '';
      }
      return;
    }
    
    const activeRequests = sessionState.activeRequests || [];
    const notificationArea = this.widgetElement.querySelector('.handoff-notifications');
    
    if (!notificationArea) {
      logger.warn('🎵 YouTube DJ | Handoff notification area not found');
      return;
    }
    
    if (activeRequests.length === 0) {
      // No requests, clear notifications
      notificationArea.innerHTML = '';
      return;
    }
    
    // Build notifications HTML for each request
    const notificationsHTML = activeRequests.map(request => {
      return `
        <div class="handoff-notification" data-requester-id="${request.userId}">
          <div class="handoff-notification-header">
            <div class="handoff-notification-title">
              <i class="fas fa-hand-paper"></i>
              DJ Handoff Request
            </div>
          </div>
          <div class="handoff-notification-content">
            <strong>${request.userName}</strong> requests DJ role
          </div>
          <div class="handoff-notification-actions">
            <button class="handoff-action-btn approve" onclick="window.youtubeDJWidget?.approveHandoffRequest('${request.userId}')" title="Approve Request">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="handoff-action-btn deny" onclick="window.youtubeDJWidget?.denyHandoffRequest('${request.userId}')" title="Deny Request">
              <i class="fas fa-times"></i> Deny
            </button>
          </div>
        </div>
      `;
    }).join('');
    
    notificationArea.innerHTML = notificationsHTML;
    
    logger.debug(`🎵 YouTube DJ | Updated handoff notifications: ${activeRequests.length} requests`);
  }
  
  /**
   * Approve a handoff request from the widget notification
   */
  async approveHandoffRequest(requesterId: string): Promise<void> {
    logger.debug('🎵 YouTube DJ | Approving handoff request from widget:', requesterId);
    
    try {
      // Get the global SessionManager instance
      const sessionManager = (globalThis as any).youtubeDJSessionManager;
      if (sessionManager && typeof sessionManager.approveDJRequest === 'function') {
        await sessionManager.approveDJRequest(requesterId);
      } else {
        logger.error('🎵 YouTube DJ | SessionManager not available for handoff approval');
        ui.notifications?.error('Could not approve handoff request. Please try from the control window.');
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to approve handoff request:', error);
      ui.notifications?.error('Failed to approve handoff request.');
    }
  }
  
  /**
   * Deny a handoff request from the widget notification
   */
  async denyHandoffRequest(requesterId: string): Promise<void> {
    logger.debug('🎵 YouTube DJ | Denying handoff request from widget:', requesterId);
    
    try {
      // Get the global SessionManager instance
      const sessionManager = (globalThis as any).youtubeDJSessionManager;
      if (sessionManager && typeof sessionManager.denyDJRequest === 'function') {
        await sessionManager.denyDJRequest(requesterId);
      } else {
        logger.error('🎵 YouTube DJ | SessionManager not available for handoff denial');
        ui.notifications?.error('Could not deny handoff request. Please try from the control window.');
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to deny handoff request:', error);
      ui.notifications?.error('Failed to deny handoff request.');
    }
  }

  /**
   * Sync all UI controls with actual YouTube player state
   * Call this when joining session or after player becomes ready
   */
  syncUIWithPlayerState(): void {
    if (!this.player || !this.isPlayerReady) {
      return;
    }

    logger.debug('🎵 YouTube DJ | Syncing UI with actual YouTube player state');

    try {
      // Check if player methods are available
      if (typeof this.player.isMuted !== 'function' || typeof this.player.getVolume !== 'function') {
        logger.warn('🎵 YouTube DJ | Player methods not yet available, skipping UI sync');
        return;
      }

      // Sync mute state with client setting
      const actualMuted = this.player.isMuted();
      const storedMuted = this.getUserMuteState();
      
      // Sync volume state with client setting
      const actualVolume = this.player.getVolume();
      const storedVolume = this.getUserVolume();

      // Update client settings if anything differs
      if (actualMuted !== storedMuted) {
        (game as any).settings.set('bardic-inspiration', 'youtubeDJ.userMuted', actualMuted);
      }
      if (Math.abs(actualVolume - storedVolume) > 1) {
        this.setUserVolume(actualVolume);
      }

      // Update UI controls
      this.updateMuteButton();
      this.updateVolumeSlider();
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync UI with player state:', error);
    }
  }
}

// Global reference for inline onclick handlers
declare global {
  interface Window {
    youtubeDJWidget?: YouTubePlayerWidget;
  }
}