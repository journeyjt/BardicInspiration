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
  static async requestCurrentTime(fallbackTime: number = 0, timeout: number = 500): Promise<number> {
    return new Promise<number>((resolve) => {
      let responseReceived = false;
      
      const timeoutHandle = setTimeout(() => {
        if (!responseReceived) {
          logger.debug('🎵 YouTube DJ | Current time request timed out, using fallback:', fallbackTime);
          resolve(fallbackTime);
        }
      }, timeout);
      
      const timeHandler = (data: { currentTime: number }) => {
        if (responseReceived) return;
        responseReceived = true;
        clearTimeout(timeoutHandle);
        Hooks.off('youtubeDJ.currentTimeResponse', timeHandler);
        logger.debug('🎵 YouTube DJ | TimeRequestService received data:', { 
          hasData: !!data, 
          currentTime: data?.currentTime, 
          dataType: typeof data?.currentTime,
          fullData: data 
        });
        logger.debug('🎵 YouTube DJ | Received live current time from adapter:', data.currentTime);
        resolve(data.currentTime);
      };
      
      logger.debug('🎵 YouTube DJ | Requesting current time from adapter...');
      Hooks.on('youtubeDJ.currentTimeResponse', timeHandler);
      Hooks.callAll('youtubeDJ.getCurrentTimeRequest');
    });
  }

  /**
   * Request playlist index from widget with timeout
   */
  static async requestPlaylistIndex(timeout: number = 500): Promise<number | undefined> {
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
  private isBuilding = false;
  
  constructor(private store: SessionStore) {}

  /**
   * Build heartbeat data from current player state
   */
  async build(): Promise<HeartbeatData> {
    // Prevent concurrent heartbeat building
    if (this.isBuilding) {
      logger.debug('🎵 YouTube DJ | Heartbeat build already in progress, skipping');
      throw new Error('Heartbeat build already in progress');
    }
    
    this.isBuilding = true;
    
    try {
      const playerState = this.store.getPlayerState();
      const currentVideo = playerState.currentVideo;
    
    logger.debug('🎵 YouTube DJ | Building heartbeat for:', currentVideo?.title);
    
    // Get live state from YouTube player - don't rely on stored state to prevent loops
    let isPlaying = playerState.playbackState === 'playing'; // fallback
    let currentTime = await this.getCurrentTime(playerState);
    
    logger.debug('🎵 YouTube DJ | Stored state fallbacks:', {
      isPlaying,
      currentTime,
      storedPlaybackState: playerState.playbackState
    });
    
    // Try to get live playback state from YouTube player
    try {
      const liveState = await this.getLivePlaybackState();
      isPlaying = liveState;
      logger.debug('🎵 YouTube DJ | Using live playback state:', isPlaying);
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Using fallback playback state:', isPlaying);
    }
    
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
    
    logger.debug('🎵 YouTube DJ | Built heartbeat:', {
      videoId: heartbeat.videoId,
      currentTime: heartbeat.currentTime,
      isPlaying: heartbeat.isPlaying,
      duration: heartbeat.duration
    });
    
    return heartbeat;
    } finally {
      this.isBuilding = false;
    }
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
      return await TimeRequestService.requestCurrentTime(storedTime, 500);
    } catch (error) {
      logger.debug('🎵 YouTube DJ | Failed to get current time from widget, using stored time:', storedTime);
      return storedTime;
    }
  }

  /**
   * Get live playback state directly from YouTube player
   */
  private async getLivePlaybackState(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let responseReceived = false;
      
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          logger.debug('🎵 YouTube DJ | Playback state request timed out - adapter may not be ready');
          reject(new Error('Playback state request timed out'));
        }
      }, 500); // Allow adequate time for adapter response
      
      const stateHandler = (data: { isPlaying: boolean }) => {
        if (responseReceived) return; // Prevent double responses
        responseReceived = true;
        clearTimeout(timeout);
        Hooks.off('youtubeDJ.playbackStateResponse', stateHandler);
        logger.debug('🎵 YouTube DJ | Received live playback state from adapter:', data.isPlaying);
        resolve(data.isPlaying);
      };
      
      logger.debug('🎵 YouTube DJ | Requesting live playback state from adapter...');
      Hooks.on('youtubeDJ.playbackStateResponse', stateHandler);
      Hooks.callAll('youtubeDJ.getPlaybackStateRequest');
    });
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