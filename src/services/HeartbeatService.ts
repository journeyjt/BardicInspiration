/**
 * Service for managing heartbeat synchronization
 * Extracted from PlayerManager to reduce complexity
 */

import { SessionStore } from '../state/SessionStore.js';
import { HeartbeatData } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

/**
 * Handles requesting and receiving time updates from the player widget
 */
export class TimeRequestService {
  /**
   * Request current playback time from widget with timeout
   */
  static async requestCurrentTime(fallbackTime: number = 0, timeout: number = 100): Promise<number> {
    return new Promise<number>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        logger.debug('🎵 YouTube DJ | Current time request timed out, using fallback:', fallbackTime);
        resolve(fallbackTime);
      }, timeout);
      
      const timeHandler = (data: { currentTime: number }) => {
        clearTimeout(timeoutHandle);
        Hooks.off('youtubeDJ.currentTimeResponse', timeHandler);
        resolve(data.currentTime);
      };
      
      Hooks.on('youtubeDJ.currentTimeResponse', timeHandler);
      Hooks.callAll('youtubeDJ.getCurrentTimeRequest');
    });
  }

  /**
   * Request playlist index from widget with timeout
   */
  static async requestPlaylistIndex(timeout: number = 100): Promise<number | undefined> {
    return new Promise<number | undefined>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        logger.debug('🎵 YouTube DJ | Playlist index request timed out');
        resolve(undefined);
      }, timeout);
      
      const indexHandler = (data: { playlistIndex: number }) => {
        clearTimeout(timeoutHandle);
        Hooks.off('youtubeDJ.playlistIndexResponse', indexHandler);
        resolve(data.playlistIndex);
      };
      
      Hooks.on('youtubeDJ.playlistIndexResponse', indexHandler);
      Hooks.callAll('youtubeDJ.getPlaylistIndexRequest');
    });
  }
}

/**
 * Builds heartbeat data from current state
 */
export class HeartbeatBuilder {
  constructor(private store: SessionStore) {}

  /**
   * Build heartbeat data from current player state
   */
  async build(): Promise<HeartbeatData> {
    const playerState = this.store.getPlayerState();
    const currentVideo = playerState.currentVideo;
    const isPlaying = playerState.playbackState === 'playing';
    
    // Get current time
    let currentTime = await this.getCurrentTime(playerState);
    
    // Get playlist info if applicable
    const playlistInfo = await this.getPlaylistInfo();
    
    const heartbeat: HeartbeatData = {
      videoId: currentVideo?.videoId || '',
      currentTime,
      duration: playerState.duration || 0,
      isPlaying,
      timestamp: Date.now(),
      serverTime: Date.now(),
      ...playlistInfo
    };
    
    // Debug log for playlist heartbeats
    if (playlistInfo.playlistId) {
      logger.debug('🎵 YouTube DJ | Building playlist heartbeat:', {
        ...playlistInfo,
        videoId: currentVideo?.videoId,
        currentTime,
        isPlaying
      });
    }
    
    return heartbeat;
  }

  /**
   * Get current playback time
   */
  private async getCurrentTime(playerState: any): Promise<number> {
    const storedTime = playerState.currentTime || 0;
    
    if (!playerState.isReady) {
      return storedTime;
    }
    
    try {
      return await TimeRequestService.requestCurrentTime(storedTime);
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get current time from widget, using stored time:', storedTime);
      return storedTime;
    }
  }

  /**
   * Get playlist information if playing a playlist
   */
  private async getPlaylistInfo(): Promise<{ playlistId?: string; playlistIndex?: number }> {
    const queueState = this.store.getQueueState();
    const currentItem = queueState.items[queueState.currentIndex];
    
    if (!currentItem?.isPlaylist) {
      return {};
    }
    
    const playlistId = currentItem.playlistId;
    let playlistIndex: number | undefined;
    
    try {
      playlistIndex = await TimeRequestService.requestPlaylistIndex();
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get playlist index');
    }
    
    return { playlistId, playlistIndex };
  }
}

/**
 * Service for sending heartbeat messages
 */
export class HeartbeatSender {
  constructor(
    private store: SessionStore,
    private broadcastMessage: (message: any) => void
  ) {}

  /**
   * Send heartbeat message
   */
  async send(heartbeat: HeartbeatData): Promise<void> {
    // Update stored state
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        currentTime: heartbeat.currentTime,
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
  }
}