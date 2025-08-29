import { YouTubePlayerManager, type YouTubePlayerManagerConfig } from './YouTubePlayerManager.js';
import type { SessionStore } from '../../services/SessionStore.js';
import type { ExtendedPlayerState } from './PlayerStateManager.js';
import { logger } from '../../lib/logger.js';

/**
 * Adapter class to integrate the new component-based player architecture
 * with the existing YouTubePlayerWidget. This allows gradual migration
 * from the monolithic widget to the new component system.
 */
export class YouTubeWidgetAdapter {
  private manager: YouTubePlayerManager | null = null;
  private store: SessionStore;
  private containerId: string;
  private isInitialized = false;
  private debugMode = false;
  
  // Hook subscriptions
  private hookSubscriptions: string[] = [];
  
  // Event subscriptions from manager
  private managerSubscriptions: string[] = [];
  

  constructor(containerId: string, store: SessionStore, debugMode = false) {
    this.containerId = containerId;
    this.store = store;
    this.debugMode = debugMode;
  }

  /**
   * Initialize the adapter and player manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('YouTubeWidgetAdapter already initialized');
      return;
    }

    try {
      // Create manager configuration
      const config: YouTubePlayerManagerConfig = {
        containerId: this.containerId,
        playerConfig: {
          width: '100%',
          height: '100%',
          playerVars: {
            controls: 1,
            autoplay: 0,
            rel: 0,
            modestbranding: 1,
            fs: 0,
            cc_load_policy: 0,
            iv_load_policy: 3,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin
          }
        },
        uiConfig: {
          // Use the actual widget element ID that exists in the DOM
          containerSelector: `#youtube-dj-widget`,
          playerContainerSelector: `#${this.containerId}`,
          controlsContainerSelector: `#youtube-dj-widget .widget-controls`,
          debugMode: this.debugMode
        },
        debugMode: this.debugMode
      };

      // Create and initialize manager
      this.manager = new YouTubePlayerManager(config);
      await this.manager.initialize();

      // Setup event bridges
      this.setupEventBridges();
      
      // Setup hook listeners
      this.setupHookListeners();

      // Mark player as ready in store
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          isReady: true
        }
      });

      // Sync existing state from store
      await this.syncExistingState();

      this.isInitialized = true;
      
      if (this.debugMode) {
        console.log('YouTubeWidgetAdapter initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize YouTubeWidgetAdapter:', error);
      throw error;
    }
  }

  /**
   * Sync existing state from store to the new manager
   */
  private async syncExistingState(): Promise<void> {
    if (!this.manager) return;

    const state = this.store.getState();
    const playerState = state.player;
    
    if (this.debugMode) {
      console.log('YouTubeWidgetAdapter: Initial state sync:', {
        hasCurrentVideo: !!playerState?.currentVideo?.videoId,
        videoId: playerState?.currentVideo?.videoId,
        playbackState: playerState?.playbackState,
        currentTime: playerState?.currentTime
      });
    }
    
    // If there's a current video, load it into the player
    if (playerState?.currentVideo?.videoId) {
      if (this.debugMode) {
        console.log('YouTubeWidgetAdapter: Syncing existing video state:', playerState.currentVideo);
      }
      
      // Load the video - use cueVideo to avoid autoplay
      await this.manager.cueVideo(
        playerState.currentVideo.videoId, 
        playerState.currentTime || 0
      );
      
      // Update the store with the video info to ensure it's properly set
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: playerState.currentVideo,
          duration: playerState.currentVideo?.duration || 0
        }
      });
      
      // Give the player a moment to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // If the video was playing, resume playback
      if (playerState.playbackState === 'playing') {
        await this.manager.play();
      }
    } else if (this.debugMode) {
      console.log('YouTubeWidgetAdapter: No existing video to sync');
    }
    
    // Sync user's personal volume and mute settings (not shared state)
    try {
      const userVolume = game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume') as number || 50;
      await this.manager.setVolume(userVolume);
      
      const userMuted = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted') as boolean || false;
      if (userMuted) {
        await this.manager.mute();
      }
    } catch (error) {
      if (this.debugMode) {
        console.log('YouTubeWidgetAdapter: Failed to sync user audio settings:', error);
      }
    }
  }

  /**
   * Setup event bridges between manager and existing system
   */
  private setupEventBridges(): void {
    if (!this.manager) return;

    // Bridge player ready event
    const readySub = this.manager.onPlayerReady(() => {
      // Update store to mark player as ready
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          isReady: true
        }
      });
      
      Hooks.callAll('youtubeDJ.playerReady', { 
        containerId: this.containerId 
      });
    });
    this.managerSubscriptions.push(readySub);

    // Bridge state change events - NO auto-updating SessionStore to prevent sync loops
    const stateSub = this.manager.onStateChange((state: number) => {
      const playerState = this.translatePlayerState(state);
      
      if (this.debugMode) {
        let playbackState = 'stopped';
        switch (state) {
          case 1: playbackState = 'playing'; break;
          case 2: playbackState = 'paused'; break;
          case 3: playbackState = 'buffering'; break;
          case 5: playbackState = 'loading'; break;
        }
        
        console.log('YouTubeWidgetAdapter: YouTube player state changed:', {
          state,
          playbackState,
          currentTime: this.manager?.getCurrentTime() || 0
        });
      }
      
      // Only emit hooks - do NOT update SessionStore to prevent feedback loops
      Hooks.callAll('youtubeDJ.playerStateChange', {
        state: playerState,
        containerId: this.containerId
      });
    });
    this.managerSubscriptions.push(stateSub);

    // Bridge error events
    const errorSub = this.manager.onError((error: any) => {
      console.error('YouTube player error:', error);
      Hooks.callAll('youtubeDJ.playerError', {
        error,
        containerId: this.containerId
      });
    });
    this.managerSubscriptions.push(errorSub);

    // Bridge video load events and update store
    const loadSub = this.manager.onVideoLoad((videoId: string) => {
      // Update the store with the loaded video
      const state = this.manager.getCurrentState();
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: state.videoInfo ? {
            videoId: videoId,
            title: state.videoInfo.title || '',
            duration: state.duration || 0,
            thumbnailUrl: state.videoInfo.thumbnailUrl || ''
          } : undefined,
          duration: state.duration || 0
        }
      });
      
      Hooks.callAll('youtubeDJ.videoLoaded', {
        videoId,
        containerId: this.containerId
      });
    });
    this.managerSubscriptions.push(loadSub);
  }

  /**
   * Setup hook listeners for external commands
   */
  private setupHookListeners(): void {
    // Listen for player commands
    Hooks.on('youtubeDJ.playerCommand', this.handlePlayerCommand.bind(this));
    
    // Listen for load video commands
    Hooks.on('youtubeDJ.loadVideo', this.handleLoadVideo.bind(this));
    
    // Listen for queue navigation
    Hooks.on('youtubeDJ.queueNext', this.handleQueueNext.bind(this));
    
    // Listen for state sync requests
    Hooks.on('youtubeDJ.requestSync', this.handleSyncRequest.bind(this));
    
    // Listen for playback state requests (for heartbeat)
    Hooks.on('youtubeDJ.getPlaybackStateRequest', this.handlePlaybackStateRequest.bind(this));
    Hooks.on('youtubeDJ.getCurrentTimeRequest', this.handleCurrentTimeRequest.bind(this));
  }

  /**
   * Handle player command from hooks
   */
  private async handlePlayerCommand(data: any): Promise<void> {
    if (!this.manager || !this.isInitialized) return;
    
    const { command, ...params } = data;
    
    switch (command) {
      case 'play':
      case 'playVideo':
        await this.manager.play();
        break;
      case 'pause':
      case 'pauseVideo':
        await this.manager.pause();
        break;
      case 'seek':
      case 'seekTo':
        await this.manager.seekTo(params.time || 0);
        break;
      case 'setVolume':
        await this.manager.setVolume(params.volume || 50);
        break;
      case 'mute':
        await this.manager.mute();
        break;
      case 'unmute':
        await this.manager.unMute();
        break;
      case 'stop':
      case 'stopVideo':
        await this.manager.stop();
        break;
      case 'loadVideoById':
        // Handle both formats: params.videoId and params.args[0]
        const loadVideoId = params.videoId || (params.args && params.args[0]);
        const loadStartTime = params.startTime || (params.args && params.args[1]) || 0;
        if (loadVideoId) {
          await this.manager.loadVideo(loadVideoId, loadStartTime, true);
        }
        break;
      case 'cueVideoById':
        // Handle both formats: params.videoId and params.args[0]
        const cueVideoId = params.videoId || (params.args && params.args[0]);
        const cueStartTime = params.startTime || (params.args && params.args[1]) || 0;
        if (cueVideoId) {
          await this.manager.cueVideo(cueVideoId, cueStartTime);
        }
        break;
      default:
        if (this.debugMode) {
          console.warn(`Unknown player command: ${command}`);
        }
    }
  }

  /**
   * Handle load video command
   */
  private async handleLoadVideo(data: any): Promise<void> {
    if (!this.manager || !this.isInitialized) return;
    
    const { videoId, startTime = 0, autoPlay = true } = data;
    
    if (autoPlay) {
      await this.manager.loadVideo(videoId, startTime, true);
    } else {
      await this.manager.cueVideo(videoId, startTime);
    }
  }

  /**
   * Handle queue next command
   */
  private async handleQueueNext(data: any): Promise<void> {
    if (!this.manager || !this.isInitialized) return;
    
    const { videoId, startTime = 0 } = data;
    
    // Load the next video
    await this.manager.loadVideo(videoId, startTime, true);
  }

  /**
   * Handle sync request
   */
  private async handleSyncRequest(data: any): Promise<void> {
    if (!this.manager || !this.isInitialized) return;
    
    const state = this.manager.getCurrentState();
    
    // Emit sync response
    Hooks.callAll('youtubeDJ.syncResponse', {
      videoId: state.videoId,
      currentTime: state.currentTime,
      playerState: state.state,
      volume: state.volume,
      isMuted: state.isMuted,
      duration: state.duration,
      timestamp: Date.now(),
      containerId: this.containerId
    });
  }

  /**
   * Handle playback state request for heartbeat
   */
  private handlePlaybackStateRequest(): void {
    if (!this.manager || !this.isInitialized) {
      logger.debug('🎵 YouTube DJ | Adapter received playback state request but not ready');
      return;
    }
    
    const isPlaying = this.manager.isPlaying();
    logger.debug('🎵 YouTube DJ | Adapter responding to playback state request:', isPlaying);
    
    // Respond immediately
    Hooks.callAll('youtubeDJ.playbackStateResponse', {
      isPlaying: isPlaying
    });
  }

  /**
   * Handle current time request for heartbeat
   */
  private async handleCurrentTimeRequest(): Promise<void> {
    if (!this.manager || !this.isInitialized) {
      logger.debug('🎵 YouTube DJ | Adapter received current time request but not ready');
      return;
    }
    
    // Get live current time directly from YouTube player core instead of cached state
    try {
      const core = (this.manager as any).core; // Access the core directly
      const currentTime = await core.getCurrentTime();
      logger.debug('🎵 YouTube DJ | Adapter responding to current time request (live from YouTube):', currentTime);
      
      // Respond with live data
      Hooks.callAll('youtubeDJ.currentTimeResponse', {
        currentTime: currentTime
      });
    } catch (error) {
      // Fallback to cached state if core access fails
      const currentTime = this.manager.getCurrentTime();
      logger.debug('🎵 YouTube DJ | Adapter fallback to cached time due to error:', error, 'cached time:', currentTime);
      
      Hooks.callAll('youtubeDJ.currentTimeResponse', {
        currentTime: currentTime
      });
    }
  }

  /**
   * Translate YouTube player state to our system
   */
  private translatePlayerState(state: number): string {
    switch (state) {
      case -1: return 'unstarted';
      case 0: return 'ended';
      case 1: return 'playing';
      case 2: return 'paused';
      case 3: return 'buffering';
      case 5: return 'cued';
      default: return 'unknown';
    }
  }

  /**
   * Public API Methods - Matching existing widget interface
   */

  async play(): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.play();
  }

  async pause(): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.pause();
  }

  async seekTo(seconds: number, allowSeekAhead = true): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.seekTo(seconds, allowSeekAhead);
  }

  async loadVideoById(videoId: string, startSeconds = 0): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.loadVideo(videoId, startSeconds, true);
  }

  async cueVideoById(videoId: string, startSeconds = 0): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.cueVideo(videoId, startSeconds);
  }

  async setVolume(volume: number): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.setVolume(volume);
  }

  async mute(): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.mute();
  }

  async unMute(): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.unMute();
  }

  async stopVideo(): Promise<void> {
    if (!this.manager) throw new Error('Manager not initialized');
    await this.manager.stop();
  }

  /**
   * State getters - Matching existing widget interface
   */

  isReady(): boolean {
    return this.manager?.isReady() || false;
  }

  getCurrentTime(): number {
    return this.manager?.getCurrentTime() || 0;
  }

  getDuration(): number {
    return this.manager?.getDuration() || 0;
  }

  getVolume(): number {
    return this.manager?.getVolume() || 0;
  }

  isMuted(): boolean {
    return this.manager?.isMuted() || false;
  }

  getPlayerState(): number {
    return this.manager?.getCurrentState().state || -1;
  }

  getVideoData(): any {
    if (!this.manager) return null;
    
    const state = this.manager.getCurrentState();
    return {
      video_id: state.videoId,
      title: state.videoInfo?.title,
      author: '',
      duration: state.duration
    };
  }

  /**
   * UI Control Methods
   */

  showPlayer(): void {
    this.manager?.showPlayer();
  }

  hidePlayer(): void {
    this.manager?.hidePlayer();
  }

  updateUI(context?: any): void {
    this.manager?.updateUI(context);
  }

  /**
   * Queue command for execution
   */
  queueCommand(type: string, data?: any, priority = 0): string | null {
    if (!this.manager) return null;
    return this.manager.queueCommand(type as any, data, priority);
  }

  /**
   * Get current sync data
   */
  getSyncData(): any {
    if (!this.manager) return null;
    
    const state = this.manager.getCurrentState();
    return {
      videoId: state.videoId,
      currentTime: state.currentTime,
      state: state.state,
      volume: state.volume,
      isMuted: state.isMuted,
      timestamp: Date.now()
    };
  }

  /**
   * Apply sync data from another player
   */
  applySyncData(syncData: any): void {
    if (!this.manager || !syncData) return;
    
    const { videoId, currentTime, state, volume, isMuted } = syncData;
    
    // Queue sync commands with high priority
    if (videoId && videoId !== this.manager.getVideoId()) {
      this.manager.queueCommand('load', { 
        videoId, 
        startTime: currentTime,
        autoPlay: state === 1 
      }, 10);
    } else if (Math.abs(currentTime - this.manager.getCurrentTime()) > 1) {
      // Only sync if more than 1 second off
      this.manager.queueCommand('seek', { time: currentTime }, 9);
    }
    
    if (state === 1 && !this.manager.isPlaying()) {
      this.manager.queueCommand('play', {}, 8);
    } else if (state === 2 && !this.manager.isPaused()) {
      this.manager.queueCommand('pause', {}, 8);
    }
    
    if (volume !== this.manager.getVolume()) {
      this.manager.queueCommand('volume', { volume }, 3);
    }
    
    if (isMuted !== this.manager.isMuted()) {
      this.manager.queueCommand(isMuted ? 'mute' : 'unmute', {}, 3);
    }
  }

  /**
   * Get diagnostic statistics
   */
  getStats(): any {
    return this.manager?.getStats() || null;
  }

  /**
   * Clean up and destroy
   */
  async destroy(): Promise<void> {
    if (this.debugMode) {
      console.log('Destroying YouTubeWidgetAdapter');
    }

    // Remove hook listeners
    Hooks.off('youtubeDJ.playerCommand', this.handlePlayerCommand.bind(this));
    Hooks.off('youtubeDJ.loadVideo', this.handleLoadVideo.bind(this));
    Hooks.off('youtubeDJ.queueNext', this.handleQueueNext.bind(this));
    Hooks.off('youtubeDJ.requestSync', this.handleSyncRequest.bind(this));
    Hooks.off('youtubeDJ.getPlaybackStateRequest', this.handlePlaybackStateRequest.bind(this));
    Hooks.off('youtubeDJ.getCurrentTimeRequest', this.handleCurrentTimeRequest.bind(this));

    // Unsubscribe from manager events
    if (this.manager) {
      this.managerSubscriptions.forEach(sub => this.manager!.off(sub));
      this.managerSubscriptions = [];
    }

    // Destroy manager
    if (this.manager) {
      await this.manager.destroy();
      this.manager = null;
    }

    this.isInitialized = false;
  }
}