/**
 * Player Manager - Handles YouTube player operations and synchronization
 * Part of Phase 2: Service Layer Extraction
 */

import { SessionStore } from '../state/SessionStore.js';
import { VideoInfo, HeartbeatData, StateChangeEvent } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';
import { PlaybackStrategyFactory } from './PlaybackStrategy.js';
import { HeartbeatBuilder, HeartbeatSender } from './HeartbeatService.js';

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
    
    // Listen for playlist load requests from QueueManager
    Hooks.on('youtubeDJ.loadPlaylist', this.onLoadPlaylistRequest.bind(this));
    
    // Listen for video cue requests (load without auto-play)
    Hooks.on('youtubeDJ.cueVideo', this.onCueVideoRequest.bind(this));
    
    // Listen for heartbeat synchronization
    Hooks.on('youtubeDJ.heartbeat', this.onHeartbeatReceived.bind(this));
    
    // Listen for player commands from other users
    Hooks.on('youtubeDJ.playCommand', this.onPlayCommand.bind(this));
    Hooks.on('youtubeDJ.pauseCommand', this.onPauseCommand.bind(this));
    Hooks.on('youtubeDJ.seekCommand', this.onSeekCommand.bind(this));
    Hooks.on('youtubeDJ.loadCommand', this.onLoadCommand.bind(this));
    Hooks.on('youtubeDJ.loadPlaylistCommand', this.onLoadPlaylistCommand.bind(this));
  }

  // Legacy initializePlayer removed - widget handles player initialization

  // Legacy destroyPlayer removed - widget handles player lifecycle

  /**
   * Play current video
   */
  /**
   * Play video using appropriate strategy
   * Refactored to use Strategy pattern for reduced complexity
   */
  async play(): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control playback');
    }

    try {
      // Determine and execute appropriate playback strategy
      const strategy = PlaybackStrategyFactory.createStrategy(this.store, this);
      
      logger.debug(`🎵 YouTube DJ | Executing playback strategy: ${strategy.getDescription()}`);
      
      await strategy.execute();
      
      // Start heartbeat for synchronization (if not already started by strategy)
      if (!this.heartbeatInterval) {
        this.startHeartbeat();
      }
      
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

      // Broadcast load command with autoPlay flag
      this.broadcastMessage({
        type: 'LOAD',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { videoId, startTime, videoInfo, autoPlay }
      });

      logger.info('🎵 YouTube DJ | Video loaded successfully:', videoInfo.title);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load video:', error);
      throw error;
    }
  }

  /**
   * Load a playlist
   * @param playlistId - The YouTube playlist ID
   * @param autoPlay - Whether to auto-play after loading (default true)
   */
  async loadPlaylist(playlistId: string, autoPlay: boolean = true): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can load playlists');
    }

    logger.debug('🎵 YouTube DJ | Loading playlist:', playlistId);

    try {
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: {
            videoId: `playlist:${playlistId}`,
            title: '🎵 YouTube Playlist',
            duration: 0
          },
          playbackState: 'loading'
        }
      });

      // Send command to widget player
      if (autoPlay) {
        logger.debug('🎵 YouTube DJ | Loading playlist with autoplay');
        Hooks.callAll('youtubeDJ.playerCommand', { 
          command: 'loadPlaylist', 
          args: [{
            list: playlistId,
            listType: 'playlist',
            index: 0
          }]
        });
      } else {
        Hooks.callAll('youtubeDJ.playerCommand', { 
          command: 'cuePlaylist', 
          args: [{
            list: playlistId,
            listType: 'playlist',
            index: 0
          }]
        });
      }

      // Broadcast playlist load command
      this.broadcastMessage({
        type: 'LOAD_PLAYLIST',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { playlistId, autoPlay }
      });
      
      // Start heartbeat if autoPlay is true
      if (autoPlay) {
        logger.debug('🎵 YouTube DJ | Starting heartbeat for playlist playback');
        this.startHeartbeat();
      }

      logger.info('🎵 YouTube DJ | Playlist loaded successfully:', playlistId);

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load playlist:', error);
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
      // Send command only to local player (not to all users)
      Hooks.callAll('youtubeDJ.localPlayerCommand', { command: 'mute' });

      // Store mute preference in client settings (per-user)
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', true);

      logger.debug('🎵 YouTube DJ | Player muted (local only)');
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
      // Send command only to local player (not to all users)
      Hooks.callAll('youtubeDJ.localPlayerCommand', { command: 'unMute' });

      // Store mute preference in client settings (per-user)
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', false);

      logger.debug('🎵 YouTube DJ | Player unmuted (local only)');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to unmute:', error);
      throw error;
    }
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<void> {
    // Get mute state from client settings instead of global state
    const currentlyMuted = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted') as boolean;
    
    if (currentlyMuted) {
      await this.unmute();
    } else {
      await this.mute();
    }
  }

  /**
   * Get user's current mute preference
   */
  getUserMuteState(): boolean {
    return game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted') as boolean;
  }

  /**
   * Get user's current volume preference  
   */
  getUserVolume(): number {
    return game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume') as number;
  }

  /**
   * Set user's volume preference
   */
  async setUserVolume(volume: number): Promise<void> {
    if (volume < 0 || volume > 100) {
      throw new Error('Volume must be between 0 and 100');
    }
    
    // Store in client settings
    await game.settings.set('bardic-inspiration', 'youtubeDJ.userVolume', volume);
    
    // Send command only to local player
    Hooks.callAll('youtubeDJ.localPlayerCommand', { command: 'setVolume', args: [volume] });
    
    logger.debug(`🎵 YouTube DJ | User volume set to ${volume} (local only)`);
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
    
    const frequency = this.store.getPlayerState().heartbeatFrequency;
    logger.info('🎵 YouTube DJ | Starting heartbeat timer with frequency:', frequency);

    this.heartbeatInterval = window.setInterval(() => {
      logger.debug('🎵 YouTube DJ | Heartbeat timer tick');
      this.sendHeartbeat();
    }, frequency);

    logger.debug('🎵 YouTube DJ | Heartbeat started for session activity tracking');
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
  /**
   * Send heartbeat for synchronization
   * Refactored to use HeartbeatService for reduced complexity
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.store.isDJ()) {
      return;
    }

    try {
      // Build heartbeat data using service
      const heartbeatBuilder = new HeartbeatBuilder(this.store);
      const heartbeat = await heartbeatBuilder.build();
      
      // Send heartbeat using service
      const heartbeatSender = new HeartbeatSender(
        this.store,
        this.broadcastMessage.bind(this)
      );
      await heartbeatSender.send(heartbeat);
      
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
      
      // Log the full oEmbed response to understand available data
      logger.debug('🎵 YouTube DJ | oEmbed response:', data);
      
      return {
        videoId,
        title: data.title || `Video ${videoId}`,
        duration: 0, // oEmbed doesn't provide duration, would need YouTube Data API for that
        thumbnailUrl: data.thumbnail_url,
        authorName: data.author_name,
        authorUrl: data.author_url
      };
    } catch (error) {
      logger.warn('🎵 YouTube DJ | Failed to fetch video metadata, using fallback:', error);
      
      // Provide more specific error messages for better user experience
      let fallbackTitle = `Video ${videoId}`;
      if (error instanceof Error) {
        if (error.message.includes('404')) {
          fallbackTitle = `Video not found (${videoId})`;
        } else if (error.message.includes('403')) {
          fallbackTitle = `Private video (${videoId})`;
        }
      }
      
      // Fallback to basic info if API call fails
      return {
        videoId,
        title: fallbackTitle,
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
   * Handle cue video request (load without auto-play)
   * This is used when loading saved queues to preserve user's playback/audio state
   */
  private async onCueVideoRequest(data: { videoId: string; videoInfo: VideoInfo; autoPlay?: boolean }): Promise<void> {
    if (!this.store.isDJ()) {
      logger.debug('🎵 YouTube DJ | Ignoring cue request - not DJ');
      return;
    }

    logger.debug('🎵 YouTube DJ | Cueing video from saved queue:', data.videoInfo.title);
    
    try {
      // Load video with autoPlay explicitly set to false
      // This preserves the user's current mute/volume settings
      await this.loadVideo(data.videoId, 0, false);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to cue video from saved queue:', error);
    }
  }

  /**
   * Handle load playlist requests from QueueManager
   */
  private async onLoadPlaylistRequest(data: { playlistId: string; playlistInfo: any }): Promise<void> {
    if (!this.store.isDJ()) {
      logger.debug('🎵 YouTube DJ | Ignoring playlist load request - not DJ');
      return;
    }

    logger.debug('🎵 YouTube DJ | Loading playlist from queue request:', data.playlistId);
    
    try {
      await this.loadPlaylist(data.playlistId);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load playlist from queue:', error);
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
  private async onLoadCommand(data: { videoId: string; startTime: number; videoInfo: any; autoPlay?: boolean; timestamp: number }): Promise<void> {
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

      // Send command to widget player - respect autoPlay flag
      const command = data.autoPlay !== false ? 'loadVideoById' : 'cueVideoById';
      Hooks.callAll('youtubeDJ.playerCommand', { 
        command: command, 
        args: [data.videoId, data.startTime || 0] 
      });
      
      logger.debug('🎵 YouTube DJ | Synced video command:', { 
        command, 
        videoId: data.videoId,
        autoPlay: data.autoPlay 
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync load command:', error);
    }
  }

  /**
   * Handle load playlist command from DJ
   */
  private async onLoadPlaylistCommand(data: { playlistId: string; autoPlay?: boolean; timestamp: number }): Promise<void> {
    if (this.store.isDJ()) {
      // DJ doesn't need to respond to their own commands
      return;
    }

    // If player not ready, wait a bit and retry
    if (!this.store.getPlayerState().isReady) {
      logger.debug('🎵 YouTube DJ | Player not ready for playlist load, will retry in 1 second');
      setTimeout(() => {
        if (this.store.getPlayerState().isReady) {
          this.onLoadPlaylistCommand(data);
        } else {
          logger.warn('🎵 YouTube DJ | Player still not ready after retry, cannot sync playlist');
        }
      }, 1000);
      return;
    }

    try {
      // Update state with playlist info
      this.store.updateState({
        player: {
          ...this.store.getPlayerState(),
          currentVideo: {
            videoId: `playlist:${data.playlistId}`,
            title: '🎵 YouTube Playlist',
            duration: 0
          },
          playbackState: 'loading'
        }
      });

      // Also update queue to reflect the playlist
      const currentQueue = this.store.getQueueState();
      const currentItem = currentQueue.items[currentQueue.currentIndex];
      
      // If no playlist in queue or wrong playlist, sync it
      if (!currentItem || !currentItem.isPlaylist || currentItem.playlistId !== data.playlistId) {
        logger.info('🎵 YouTube DJ | Syncing playlist to queue for listener:', data.playlistId);
        this.store.updateState({
          queue: {
            ...currentQueue,
            items: currentQueue.items.length === 0 ? [{
              id: `playlist_${data.playlistId}_sync`,
              videoId: `playlist:${data.playlistId}`,
              title: '🎵 YouTube Playlist (Synced)',
              addedBy: 'DJ',
              addedAt: Date.now(),
              isPlaylist: true,
              playlistId: data.playlistId
            }] : currentQueue.items,
            currentIndex: 0
          }
        });
      }

      // Send command to widget player
      const command = data.autoPlay !== false ? 'loadPlaylist' : 'cuePlaylist';
      Hooks.callAll('youtubeDJ.playerCommand', { 
        command: command, 
        args: [{
          list: data.playlistId,
          listType: 'playlist',
          index: 0
        }]
      });

      // Widget will handle monitoring and starting playback for listeners
      logger.debug('🎵 YouTube DJ | Synced playlist load from DJ:', data.playlistId);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to sync playlist load command:', error);
    }
  }

  /**
   * Handle DJ role changes for player management
   */
  private handleDJChange(previousDJ: string | null, currentDJ: string | null): void {
    const currentUserId = game.user?.id;

    if (currentDJ === currentUserId && previousDJ !== currentUserId) {
      // User became DJ - start heartbeat immediately for session activity tracking
      logger.debug('🎵 YouTube DJ | User became DJ, starting heartbeat for activity tracking');
      this.startHeartbeat();
    } else if (previousDJ === currentUserId && currentDJ !== currentUserId) {
      // User lost DJ role - stop heartbeat
      logger.debug('🎵 YouTube DJ | User lost DJ role, stopping heartbeat');
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
    Hooks.off('youtubeDJ.cueVideo', this.onCueVideoRequest.bind(this));
    Hooks.off('youtubeDJ.heartbeat', this.onHeartbeatReceived.bind(this));
    Hooks.off('youtubeDJ.playCommand', this.onPlayCommand.bind(this));
    Hooks.off('youtubeDJ.pauseCommand', this.onPauseCommand.bind(this));
    Hooks.off('youtubeDJ.seekCommand', this.onSeekCommand.bind(this));
    Hooks.off('youtubeDJ.loadCommand', this.onLoadCommand.bind(this));
    logger.debug('🎵 YouTube DJ | PlayerManager destroyed');
  }
}