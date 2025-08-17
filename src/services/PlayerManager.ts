/**
 * Player Manager - Handles YouTube player operations and synchronization
 * Part of Phase 2: Service Layer Extraction
 */

import { SessionStore } from '../state/SessionStore.js';
import { VideoInfo, HeartbeatData, StateChangeEvent } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

export interface YouTubeDJMessage {
  type: string;
  userId: string;
  timestamp: number;
  data?: any;
}

export class PlayerManager {
  private store: SessionStore;
  private heartbeatInterval: number | null = null;

  constructor(store: SessionStore) {
    this.store = store;
    
    // Listen to state changes for player management
    Hooks.on('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    
    // Listen for video load requests from QueueManager
    Hooks.on('youtubeDJ.loadVideo', this.onLoadVideoRequest.bind(this));
    
    // Listen for heartbeat synchronization
    Hooks.on('youtubeDJ.heartbeat', this.onHeartbeatReceived.bind(this));
    
    // Listen for player commands from other users
    Hooks.on('youtubeDJ.playCommand', this.onPlayCommand.bind(this));
    Hooks.on('youtubeDJ.pauseCommand', this.onPauseCommand.bind(this));
    Hooks.on('youtubeDJ.seekCommand', this.onSeekCommand.bind(this));
    Hooks.on('youtubeDJ.loadCommand', this.onLoadCommand.bind(this));
  }

  // Legacy initializePlayer removed - widget handles player initialization

  // Legacy destroyPlayer removed - widget handles player lifecycle

  /**
   * Play current video
   */
  async play(): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control playback');
    }
    
    // Check if there's a valid video to play
    const playerState = this.store.getPlayerState();
    const hasValidVideo = playerState.currentVideo?.videoId && 
                          playerState.currentVideo.videoId.length === 11;
    
    if (!hasValidVideo) {
      // No video loaded - try to play from queue if available
      const queueState = this.store.getQueueState();
      if (queueState.items.length > 0 && queueState.currentIndex >= 0) {
        const currentItem = queueState.items[queueState.currentIndex];
        if (currentItem?.videoId) {
          logger.debug('🎵 YouTube DJ | Loading video from queue:', currentItem.title);
          await this.loadVideo(currentItem.videoId);
          return; // loadVideo will handle playing
        }
      }
      throw new Error('No video loaded. Please add videos to the queue first.');
    }

    logger.debug('🎵 YouTube DJ | Playing video...', { 
      videoId: playerState.currentVideo.videoId,
      title: playerState.currentVideo.title 
    });

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'playVideo' });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          playbackState: 'playing'
        }
      });

      // Start heartbeat for synchronization
      this.startHeartbeat();

      // Broadcast play command
      this.broadcastMessage({
        type: 'PLAY',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to play video:', error);
      throw error;
    }
  }

  /**
   * Pause current video
   */
  async pause(): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control playback');
    }

    logger.debug('🎵 YouTube DJ | Pausing video...');

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'pauseVideo' });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          playbackState: 'paused'
        }
      });

      // Stop heartbeat when paused
      this.stopHeartbeat();

      // Broadcast pause command
      this.broadcastMessage({
        type: 'PAUSE',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to pause video:', error);
      throw error;
    }
  }

  /**
   * Seek to specific time
   */
  async seekTo(time: number): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control playback');
    }

    logger.debug('🎵 YouTube DJ | Seeking to time:', time);

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'seekTo', args: [time, true] });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentTime: time
        }
      });

      // Broadcast seek command
      this.broadcastMessage({
        type: 'SEEK',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { time }
      });

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to seek:', error);
      throw error;
    }
  }

  /**
   * Load and play video
   * @param autoPlay - Whether to auto-play after loading (default true)
   */
  async loadVideo(videoId: string, startTime: number = 0, autoPlay: boolean = true): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can load videos');
    }

    logger.debug('🎵 YouTube DJ | Loading video:', videoId);

    try {
      // Get video info
      const videoInfo = await this.getVideoInfo(videoId);
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: videoInfo,
          playbackState: 'loading'
        }
      });

      // Send command to widget player
      if (autoPlay) {
        Hooks.callAll('youtubeDJ.playerCommand', { command: 'loadVideoById', args: [videoId, startTime] });
      } else {
        Hooks.callAll('youtubeDJ.playerCommand', { command: 'cueVideoById', args: [videoId, startTime] });
      }

      // Broadcast load command
      this.broadcastMessage({
        type: 'LOAD',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { videoId, startTime, videoInfo }
      });

      logger.info('🎵 YouTube DJ | Video loaded successfully:', videoInfo.title);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load video:', error);
      throw error;
    }
  }

  /**
   * Mute the player
   */
  async mute(): Promise<void> {
    if (!this.store.getPlayerState().isReady) {
      throw new Error('Player not ready');
    }

    try {
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'mute' });

      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          isMuted: true
        }
      });

      logger.debug('🎵 YouTube DJ | Player muted');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to mute:', error);
      throw error;
    }
  }

  /**
   * Unmute the player
   */
  async unmute(): Promise<void> {
    if (!this.store.getPlayerState().isReady) {
      throw new Error('Player not ready');
    }

    try {
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'unMute' });

      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          isMuted: false
        }
      });

      logger.debug('🎵 YouTube DJ | Player unmuted');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to unmute:', error);
      throw error;
    }
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<void> {
    const currentlyMuted = this.store.getPlayerState().isMuted;
    
    if (currentlyMuted) {
      await this.unmute();
    } else {
      await this.mute();
    }
  }

  /**
   * Start heartbeat for synchronization
   */
  startHeartbeat(): void {
    if (!this.store.isDJ()) {
      logger.debug('🎵 YouTube DJ | Not DJ, skipping heartbeat start');
      return;
    }

    this.stopHeartbeat();

    this.heartbeatInterval = window.setInterval(() => {
      this.sendHeartbeat();
    }, this.store.getPlayerState().heartbeatFrequency);

    logger.debug('🎵 YouTube DJ | Heartbeat started');
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logger.debug('🎵 YouTube DJ | Heartbeat stopped');
    }
  }

  // Legacy syncWithHeartbeat removed - widget handles synchronization

  // Legacy getCurrentTime and getDuration removed - widget handles player queries

  /**
   * Enable autoplay consent
   */
  enableAutoplayConsent(): void {
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        autoplayConsent: true
      }
    });

    logger.debug('🎵 YouTube DJ | Autoplay consent enabled');
  }

  // Legacy onPlayerReady removed - widget handles player events

  // Legacy onPlayerStateChange removed - widget handles player events

  // Legacy onPlayerError removed - widget handles player events

  /**
   * Send heartbeat to other players
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.store.getPlayerState().isReady || !this.store.isDJ()) {
      return;
    }

    try {
      const playerState = this.store.getPlayerState();
      const currentVideo = playerState.currentVideo;
      const isPlaying = playerState.playbackState === 'playing';

      // Request current time from widget player
      let currentTime = playerState.currentTime || 0;
      try {
        // Emit request for current time and wait for response
        const timeRequest = new Promise<number>((resolve) => {
          const timeout = setTimeout(() => resolve(currentTime), 100); // 100ms timeout, fallback to stored time
          
          const timeHandler = (data: { currentTime: number }) => {
            clearTimeout(timeout);
            Hooks.off('youtubeDJ.currentTimeResponse', timeHandler);
            resolve(data.currentTime);
          };
          
          Hooks.on('youtubeDJ.currentTimeResponse', timeHandler);
          Hooks.callAll('youtubeDJ.getCurrentTimeRequest');
        });
        
        currentTime = await timeRequest;
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Failed to get current time from widget, using stored time:', currentTime);
      }

      const heartbeat: HeartbeatData = {
        videoId: currentVideo?.videoId || '',
        currentTime,
        duration: playerState.duration || 0,
        isPlaying,
        timestamp: Date.now(),
        serverTime: Date.now()
      };

      // Update stored current time
      this.store.updateState({
        player: {
          ...playerState,
          currentTime,
          lastHeartbeat: heartbeat
        }
      });

      // Broadcast heartbeat
      this.broadcastMessage({
        type: 'HEARTBEAT',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: heartbeat
      });
      
      // Activity tracking is now handled by HeartbeatResponseHandler in SocketManager

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to send heartbeat:', error);
    }
  }

  // Activity tracking is now handled by HeartbeatResponseHandler in SocketManager

  // Seek updates are now handled by the widget player
  // These methods are no longer needed as the widget manages player state directly

  // Pending operations are no longer needed with widget architecture

  /**
   * Handle video ended event
   */
  private handleVideoEnded(): void {
    // This will be handled by QueueManager in next step
    // For now, emit a hook for the queue to handle
    Hooks.callAll('youtubeDJ.videoEnded', {
      videoId: this.store.getPlayerState().currentVideo?.videoId
    });
  }

  // Legacy ensureYouTubeAPI removed - widget handles YouTube API

  /**
   * Get video information from YouTube (public method)
   */
  async fetchVideoInfo(videoId: string): Promise<VideoInfo> {
    return this.getVideoInfo(videoId);
  }

  /**
   * Get video information from YouTube
   */
  private async getVideoInfo(videoId: string): Promise<VideoInfo> {
    try {
      // Use YouTube oEmbed API to fetch video metadata
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      return {
        videoId,
        title: data.title || `Video ${videoId}`,
        duration: 0, // oEmbed doesn't provide duration, would need YouTube Data API for that
        thumbnailUrl: data.thumbnail_url
      };
    } catch (error) {
      logger.warn('🎵 YouTube DJ | Failed to fetch video metadata, using fallback:', error);
      
      // Fallback to basic info if API call fails
      return {
        videoId,
        title: `Video ${videoId}`,
        duration: 0
      };
    }
  }

  /**
   * Broadcast message via socket
   */
  private broadcastMessage(message: YouTubeDJMessage): void {
    // This will be handled by SocketManager in next step
    // For now, use direct socket communication
    game.socket?.emit('module.bardic-inspiration', message);
  }

  /**
   * Handle state changes for player management
   */
  private onStateChanged(event: StateChangeEvent): void {
    // React to specific state changes for player management
    if (event.changes.session?.djUserId !== undefined) {
      this.handleDJChange(event.previous.session.djUserId, event.current.session.djUserId);
    }
  }

  /**
   * Handle load video requests from QueueManager
   */
  private async onLoadVideoRequest(data: { videoId: string; videoInfo: VideoInfo }): Promise<void> {
    if (!this.store.isDJ()) {
      logger.debug('🎵 YouTube DJ | Ignoring load request - not DJ');
      return;
    }

    logger.debug('🎵 YouTube DJ | Loading video from queue request:', data.videoInfo.title);
    
    try {
      await this.loadVideo(data.videoId);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load video from queue:', error);
    }
  }

  /**
   * Handle heartbeat received from DJ
   */
  private async onHeartbeatReceived(data: { heartbeat: HeartbeatData; timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't sync to their own heartbeat
      return;
    }

    this.syncWithHeartbeat(data.heartbeat).catch(error => {
      logger.error('🎵 YouTube DJ | Failed to sync with heartbeat:', error);
    });
  }

  /**
   * Sync with heartbeat data from DJ (for non-DJ users)
   */
  private async syncWithHeartbeat(heartbeat: HeartbeatData): Promise<void> {
    if (this.store.isDJ()) {
      return; // DJ doesn't sync to their own heartbeat
    }

    // Only sync if we have a different video or significant time difference
    const currentVideo = this.store.getPlayerState().currentVideo;
    
    // Check if video changed
    if (currentVideo?.videoId !== heartbeat.videoId) {
      logger.debug('🎵 YouTube DJ | Syncing to new video from heartbeat:', heartbeat.videoId);
      // Send load command to widget
      Hooks.callAll('youtubeDJ.playerCommand', { 
        command: 'loadVideoById', 
        args: [heartbeat.videoId, heartbeat.currentTime] 
      });
      return;
    }

    // Get real current time from widget for accurate drift calculation
    let localCurrentTime = this.store.getPlayerState().currentTime || 0;
    try {
      const timeRequest = new Promise<number>((resolve) => {
        const timeout = setTimeout(() => resolve(localCurrentTime), 50); // 50ms timeout for sync operation
        
        const timeHandler = (data: { currentTime: number }) => {
          clearTimeout(timeout);
          Hooks.off('youtubeDJ.currentTimeResponse', timeHandler);
          resolve(data.currentTime);
        };
        
        Hooks.on('youtubeDJ.currentTimeResponse', timeHandler);
        Hooks.callAll('youtubeDJ.getCurrentTimeRequest');
      });
      
      localCurrentTime = await timeRequest;
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get current time for sync, using stored time');
    }

    // Use drift tolerance from player state (default 1.0 seconds)
    const driftTolerance = this.store.getPlayerState().driftTolerance;
    const timeDrift = Math.abs(localCurrentTime - heartbeat.currentTime);
    
    if (timeDrift > driftTolerance) {
      logger.debug('🎵 YouTube DJ | Syncing time drift:', { 
        local: localCurrentTime, 
        remote: heartbeat.currentTime, 
        drift: timeDrift,
        tolerance: driftTolerance
      });
      // Send seek command to widget
      Hooks.callAll('youtubeDJ.playerCommand', { 
        command: 'seekTo', 
        args: [heartbeat.currentTime, true] 
      });
    }

    // Sync play/pause state
    const localPlaying = this.store.getPlayerState().playbackState === 'playing';
    if (localPlaying !== heartbeat.isPlaying) {
      logger.debug('🎵 YouTube DJ | Syncing play state:', { local: localPlaying, remote: heartbeat.isPlaying });
      if (heartbeat.isPlaying) {
        Hooks.callAll('youtubeDJ.playerCommand', { command: 'playVideo' });
      } else {
        Hooks.callAll('youtubeDJ.playerCommand', { command: 'pauseVideo' });
      }
    }

    // Update local state with heartbeat data
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        currentTime: heartbeat.currentTime,
        duration: heartbeat.duration,
        playbackState: heartbeat.isPlaying ? 'playing' : 'paused'
      }
    });
  }

  /**
   * Handle play command from DJ
   */
  private async onPlayCommand(data: { timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't need to respond to their own commands
      return;
    }

    if (!this.store.getPlayerState().isReady) {
      logger.debug('🎵 YouTube DJ | Cannot sync play - player not ready');
      return;
    }

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'playVideo' });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          playbackState: 'playing'
        }
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync play command:', error);
    }
  }

  /**
   * Handle pause command from DJ
   */
  private async onPauseCommand(data: { timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't need to respond to their own commands
      return;
    }

    if (!this.store.getPlayerState().isReady) {
      logger.debug('🎵 YouTube DJ | Cannot sync pause - player not ready');
      return;
    }

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'pauseVideo' });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          playbackState: 'paused'
        }
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync pause command:', error);
    }
  }

  /**
   * Handle seek command from DJ
   */
  private async onSeekCommand(data: { time: number; timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't need to respond to their own commands
      return;
    }

    if (!this.store.getPlayerState().isReady) {
      logger.debug('🎵 YouTube DJ | Cannot sync seek - player not ready');
      return;
    }

    try {
      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { command: 'seekTo', args: [data.time, true] });
      
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentTime: data.time
        }
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync seek command:', error);
    }
  }

  /**
   * Handle load command from DJ
   */
  private async onLoadCommand(data: { videoId: string; startTime: number; videoInfo: any; timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't need to respond to their own commands
      return;
    }

    if (!this.store.getPlayerState().isReady) {
      logger.debug('🎵 YouTube DJ | Cannot sync load - player not ready');
      return;
    }

    try {
      // Update state with new video info
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: data.videoInfo,
          playbackState: 'loading'
        }
      });

      // Send command to widget player
      Hooks.callAll('youtubeDJ.playerCommand', { 
        command: 'loadVideoById', 
        args: [data.videoId, data.startTime || 0] 
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync load command:', error);
    }
  }

  /**
   * Handle DJ role changes for player management
   */
  private handleDJChange(previousDJ: string | null, currentDJ: string | null): void {
    const currentUserId = game.user?.id;

    if (currentDJ === currentUserId && previousDJ !== currentUserId) {
      // User became DJ - start heartbeat if playing
      if (this.store.getPlayerState().playbackState === 'playing') {
        this.startHeartbeat();
      }
    } else if (previousDJ === currentUserId && currentDJ !== currentUserId) {
      // User lost DJ role - stop heartbeat
      this.stopHeartbeat();
    }
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    this.stopHeartbeat();
    Hooks.off('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.off('youtubeDJ.loadVideo', this.onLoadVideoRequest.bind(this));
    Hooks.off('youtubeDJ.heartbeat', this.onHeartbeatReceived.bind(this));
    Hooks.off('youtubeDJ.playCommand', this.onPlayCommand.bind(this));
    Hooks.off('youtubeDJ.pauseCommand', this.onPauseCommand.bind(this));
    Hooks.off('youtubeDJ.seekCommand', this.onSeekCommand.bind(this));
    Hooks.off('youtubeDJ.loadCommand', this.onLoadCommand.bind(this));
    logger.debug('🎵 YouTube DJ | PlayerManager destroyed');
  }
}