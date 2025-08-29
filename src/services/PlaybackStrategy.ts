/**
 * Strategy pattern for different playback scenarios
 * Extracted from PlayerManager to reduce complexity
 */

import { SessionStore } from '../state/SessionStore.js';
import { VideoItem } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

/**
 * Base interface for playback strategies
 */
export interface PlaybackStrategy {
  canExecute(): boolean;
  execute(): Promise<void>;
  getDescription(): string;
}

/**
 * Strategy for playing a video from the queue
 */
export class QueuePlaybackStrategy implements PlaybackStrategy {
  constructor(
    private store: SessionStore,
    private queueItem: VideoItem,
    private playerManager: any // Avoid circular dependency
  ) {}

  canExecute(): boolean {
    const queueState = this.store.getQueueState();
    return queueState.items.length > 0 && 
           queueState.currentIndex >= 0 && 
           queueState.currentIndex < queueState.items.length;
  }

  async execute(): Promise<void> {
    const playerState = this.store.getPlayerState();
    
    // Handle playlist items
    if (this.queueItem.isPlaylist && this.queueItem.playlistId) {
      await this.handlePlaylistPlayback(playerState);
      return;
    }
    
    // Handle regular video items
    await this.handleVideoPlayback(playerState);
  }

  private async handlePlaylistPlayback(playerState: any): Promise<void> {
    const expectedPlaylistId = `playlist:${this.queueItem.playlistId}`;
    const currentlyLoadedVideo = playerState.currentVideo?.videoId;
    
    if (currentlyLoadedVideo === expectedPlaylistId) {
      // Playlist already loaded, just play
      logger.debug('🎵 YouTube DJ | Playlist already loaded, sending play command');
      await this.sendPlayCommand();
    } else {
      // Load the playlist first
      logger.debug('🎵 YouTube DJ | Playing playlist from queue:', this.queueItem.playlistId);
      await this.playerManager.loadPlaylist(this.queueItem.playlistId, true);
    }
  }

  private async handleVideoPlayback(playerState: any): Promise<void> {
    logger.debug('🎵 YouTube DJ | Queue has videos, checking if correct video is loaded:', {
      queueVideoId: this.queueItem.videoId,
      playerVideoId: playerState.currentVideo?.videoId,
      queueTitle: this.queueItem.title
    });
    
    if (playerState.currentVideo?.videoId !== this.queueItem.videoId) {
      // Load the correct video
      logger.debug('🎵 YouTube DJ | Loading correct video from queue:', this.queueItem.title);
      await this.playerManager.loadVideo(this.queueItem.videoId);
    } else {
      // Correct video loaded, play it
      logger.debug('🎵 YouTube DJ | Playing current queue video:', this.queueItem.title);
      await this.sendPlayCommand();
    }
  }

  private async sendPlayCommand(): Promise<void> {
    Hooks.callAll('youtubeDJ.playerCommand', { command: 'playVideo' });
    
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        playbackState: 'playing'
      }
    });
    
    // Broadcast play command
    this.playerManager.broadcastMessage({
      type: 'PLAY',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
  }

  getDescription(): string {
    return `Playing ${this.queueItem.title || this.queueItem.videoId} from queue`;
  }
}

/**
 * Strategy for resuming playback of already loaded video
 */
export class ResumePlaybackStrategy implements PlaybackStrategy {
  constructor(
    private store: SessionStore,
    private playerManager: any
  ) {}

  canExecute(): boolean {
    const playerState = this.store.getPlayerState();
    const hasValidVideo = playerState.currentVideo?.videoId && 
                         playerState.currentVideo.videoId.length === 11;
    return !!hasValidVideo;
  }

  async execute(): Promise<void> {
    const playerState = this.store.getPlayerState();
    
    if (!this.canExecute()) {
      throw new Error('No video loaded. Please add videos to the queue first.');
    }
    
    logger.debug('🎵 YouTube DJ | No queue items, playing loaded video:', {
      videoId: playerState.currentVideo.videoId,
      title: playerState.currentVideo.title
    });
    
    // Send play command
    Hooks.callAll('youtubeDJ.playerCommand', { command: 'playVideo' });
    
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        playbackState: 'playing'
      }
    });
    
    // Start heartbeat
    this.playerManager.startHeartbeat();
    
    // Broadcast
    this.playerManager.broadcastMessage({
      type: 'PLAY',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
  }

  getDescription(): string {
    const playerState = this.store.getPlayerState();
    return `Resuming playback of ${playerState.currentVideo?.title || 'current video'}`;
  }
}

/**
 * Factory for creating appropriate playback strategy
 */
export class PlaybackStrategyFactory {
  static createStrategy(store: SessionStore, playerManager: any): PlaybackStrategy {
    const queueState = store.getQueueState();
    
    // Check if there's a queued video to play
    if (queueState.items.length > 0 && 
        queueState.currentIndex >= 0 && 
        queueState.currentIndex < queueState.items.length) {
      const currentQueueItem = queueState.items[queueState.currentIndex];
      return new QueuePlaybackStrategy(store, currentQueueItem, playerManager);
    }
    
    // Fall back to resume strategy
    return new ResumePlaybackStrategy(store, playerManager);
  }
}