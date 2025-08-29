/**
 * Type definitions for all Hook events in the YouTube DJ module
 * Provides type safety for FoundryVTT's Hooks system
 */

import type { VideoItem, SessionState, PlayerState, QueueState, SavedQueue } from '../state/StateTypes.js';
import type { BaseSocketMessage } from './SocketMessages.js';

// State Management Events
export interface StateChangeEvent {
  changes: string[];
  oldState?: Partial<{
    session: SessionState;
    player: PlayerState;
    queue: QueueState;
  }>;
  newState?: Partial<{
    session: SessionState;
    player: PlayerState;
    queue: QueueState;
  }>;
}

// User Activity Events
export interface UserActivityEvent {
  userId: string;
  timestamp: number;
  activityType: string;
}

export interface UserJoinedEvent {
  userId: string;
  userName: string;
  timestamp: number;
}

export interface UserLeftEvent {
  userId: string;
  userName?: string;
  reason?: string;
  timestamp: number;
}

// DJ Management Events
export interface DJClaimReceivedEvent {
  userId: string;
  userName: string;
  force?: boolean;
}

export interface DJReleaseReceivedEvent {
  userId: string;
  reason?: string;
}

export interface DJRequestReceivedEvent {
  requestingUserId: string;
  requestingUserName: string;
  currentDJId?: string;
}

export interface DJHandoffReceivedEvent {
  fromUserId: string;
  toUserId: string;
  toUserName: string;
}

export interface GMOverrideReceivedEvent {
  action: 'claim' | 'release' | 'handoff';
  gmUserId: string;
  targetUserId?: string;
}

// Player Command Events
export interface PlayerCommandEvent {
  action: 'play' | 'pause' | 'stop' | 'seek' | 'load' | 'cueVideo' | 'loadPlaylist';
  data?: any;
  timestamp: number;
  source?: string;
}

export interface LocalPlayerCommandEvent extends PlayerCommandEvent {
  local: true;
}

export interface PlayCommandEvent {
  startTime?: number;
  videoId?: string;
  timestamp: number;
}

export interface PauseCommandEvent {
  currentTime?: number;
  timestamp: number;
}

export interface SeekCommandEvent {
  seekTo: number;
  timestamp: number;
}

export interface LoadCommandEvent {
  videoId: string;
  videoUrl: string;
  title?: string;
  startTime?: number;
  autoPlay?: boolean;
  timestamp: number;
}

export interface LoadPlaylistCommandEvent {
  playlistId: string;
  autoPlay?: boolean;
  timestamp: number;
}

export interface CueVideoEvent {
  videoId: string;
  startTime?: number;
}

export interface LoadVideoEvent {
  videoId: string;
  videoUrl: string;
  title?: string;
  autoPlay?: boolean;
  startTime?: number;
}

export interface LoadPlaylistEvent {
  playlistId: string;
  playlistInfo?: {
    totalVideos: number;
    currentIndex: number;
  };
}

// Playback Events
export interface VideoEndedEvent {
  videoId: string;
  isPlaylistEnd?: boolean;
}

export interface SkipToNextEvent {
  reason: string;
}

export interface PlaylistEmbedErrorEvent {
  playlistId: string;
  queueItemId: string;
  error: string;
}

// Queue Management Events
export interface QueueAddEvent {
  videoUrl: string;
  videoId: string;
  title?: string;
  addedBy: string;
  isPlaylist?: boolean;
  playlistId?: string;
}

export interface QueueRemoveEvent {
  itemId: string;
  removedBy: string;
}

export interface QueueUpdateEvent {
  items: VideoItem[];
  currentIndex: number;
  updateType: 'reorder' | 'add' | 'remove' | 'clear';
}

export interface QueueNextEvent {
  nextIndex: number;
  videoItem: VideoItem;
  timestamp: number;
  autoPlay?: boolean;
}

export interface QueueClearEvent {
  clearedBy?: string;
}

// Saved Queue Events
export interface SaveQueueEvent {
  queueName: string;
  queueItems: VideoItem[];
}

export interface LoadQueueEvent {
  queueId: string;
  queueName: string;
  items: VideoItem[];
  replaceExisting: boolean;
}

export interface DeleteQueueEvent {
  queueId: string;
}

export interface RenameQueueEvent {
  queueId: string;
  newName: string;
}

// Synchronization Events
export interface HeartbeatEvent {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  timestamp: number;
  serverTime: number;
  playlistId?: string;
  playlistIndex?: number;
}

export interface HeartbeatProcessedEvent {
  processed: boolean;
  adjustmentMade?: boolean;
  drift?: number;
}

export interface GetCurrentTimeRequestEvent {
  requestId: string;
}

export interface CurrentTimeResponseEvent {
  requestId: string;
  currentTime: number;
  isPlaying: boolean;
}

export interface GetPlaylistIndexRequestEvent {
  requestId?: string;
}

export interface PlaylistIndexResponseEvent {
  requestId?: string;
  playlistIndex: number;
}

// System Events
export interface MemberCleanupReceivedEvent {
  memberIds: string[];
  reason: string;
}

export interface GroupModeChangedEvent {
  enabled: boolean;
}

// Complete Hook Event Map
export interface HookEventMap {
  // State Management
  'youtubeDJ.stateChanged': StateChangeEvent;
  
  // User Activity
  'youtubeDJ.userActivity': UserActivityEvent;
  'youtubeDJ.userJoined': UserJoinedEvent;
  'youtubeDJ.userLeft': UserLeftEvent;
  
  // DJ Management
  'youtubeDJ.djClaimReceived': DJClaimReceivedEvent;
  'youtubeDJ.djReleaseReceived': DJReleaseReceivedEvent;
  'youtubeDJ.djRequestReceived': DJRequestReceivedEvent;
  'youtubeDJ.djHandoffReceived': DJHandoffReceivedEvent;
  'youtubeDJ.gmOverrideReceived': GMOverrideReceivedEvent;
  
  // Player Commands
  'youtubeDJ.playerCommand': PlayerCommandEvent;
  'youtubeDJ.localPlayerCommand': LocalPlayerCommandEvent;
  'youtubeDJ.playCommand': PlayCommandEvent;
  'youtubeDJ.pauseCommand': PauseCommandEvent;
  'youtubeDJ.seekCommand': SeekCommandEvent;
  'youtubeDJ.loadCommand': LoadCommandEvent;
  'youtubeDJ.loadPlaylistCommand': LoadPlaylistCommandEvent;
  'youtubeDJ.cueVideo': CueVideoEvent;
  'youtubeDJ.loadVideo': LoadVideoEvent;
  'youtubeDJ.loadPlaylist': LoadPlaylistEvent;
  
  // Playback Events
  'youtubeDJ.videoEnded': VideoEndedEvent;
  'youtubeDJ.skipToNext': SkipToNextEvent;
  'youtubeDJ.playlistEmbedError': PlaylistEmbedErrorEvent;
  
  // Queue Management
  'youtubeDJ.queueAdd': QueueAddEvent;
  'youtubeDJ.queueRemove': QueueRemoveEvent;
  'youtubeDJ.queueUpdate': QueueUpdateEvent;
  'youtubeDJ.queueNext': QueueNextEvent;
  'youtubeDJ.queueClear': QueueClearEvent;
  
  // Saved Queues
  'youtubeDJ.saveQueue': SaveQueueEvent;
  'youtubeDJ.loadQueue': LoadQueueEvent;
  'youtubeDJ.deleteQueue': DeleteQueueEvent;
  'youtubeDJ.renameQueue': RenameQueueEvent;
  
  // Synchronization
  'youtubeDJ.heartbeat': HeartbeatEvent;
  'youtubeDJ.heartbeatProcessed': HeartbeatProcessedEvent;
  'youtubeDJ.getCurrentTimeRequest': GetCurrentTimeRequestEvent;
  'youtubeDJ.currentTimeResponse': CurrentTimeResponseEvent;
  'youtubeDJ.getPlaylistIndexRequest': GetPlaylistIndexRequestEvent;
  'youtubeDJ.playlistIndexResponse': PlaylistIndexResponseEvent;
  
  // System Events
  'youtubeDJ.memberCleanupReceived': MemberCleanupReceivedEvent;
  'youtubeDJ.groupModeChanged': GroupModeChangedEvent;
}

/**
 * Type-safe wrapper for FoundryVTT's Hooks system
 * Provides compile-time type checking for hook events
 */
export class TypedHooks {
  /**
   * Emit a typed hook event
   */
  static emit<K extends keyof HookEventMap>(
    event: K,
    data: HookEventMap[K]
  ): void {
    Hooks.callAll(event, data);
  }

  /**
   * Listen for a typed hook event
   */
  static on<K extends keyof HookEventMap>(
    event: K,
    callback: (data: HookEventMap[K]) => void
  ): number {
    return Hooks.on(event, callback);
  }

  /**
   * Listen for a typed hook event once
   */
  static once<K extends keyof HookEventMap>(
    event: K,
    callback: (data: HookEventMap[K]) => void
  ): number {
    return Hooks.once(event, callback);
  }

  /**
   * Remove a hook listener
   */
  static off(event: keyof HookEventMap, id: number): void {
    Hooks.off(event as string, id);
  }

  /**
   * Call a hook and return the result
   */
  static call<K extends keyof HookEventMap>(
    event: K,
    data: HookEventMap[K]
  ): any {
    return Hooks.call(event, data);
  }
}

/**
 * Helper functions for creating hook event data
 */
export class HookEventFactory {
  static createStateChange(
    changes: string[],
    oldState?: any,
    newState?: any
  ): StateChangeEvent {
    return { changes, oldState, newState };
  }

  static createUserJoined(
    userId: string,
    userName: string
  ): UserJoinedEvent {
    return {
      userId,
      userName,
      timestamp: Date.now()
    };
  }

  static createPlayerCommand(
    action: PlayerCommandEvent['action'],
    data?: any
  ): PlayerCommandEvent {
    return {
      action,
      data,
      timestamp: Date.now()
    };
  }

  static createQueueNext(
    nextIndex: number,
    videoItem: VideoItem,
    autoPlay = true
  ): QueueNextEvent {
    return {
      nextIndex,
      videoItem,
      timestamp: Date.now(),
      autoPlay
    };
  }

  static createHeartbeat(
    videoId: string,
    currentTime: number,
    isPlaying: boolean,
    playlistInfo?: { playlistId: string; playlistIndex: number }
  ): HeartbeatEvent {
    return {
      videoId,
      currentTime,
      isPlaying,
      timestamp: Date.now(),
      serverTime: Date.now(),
      ...playlistInfo
    };
  }
}