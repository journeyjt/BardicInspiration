/**
 * Type definitions for all socket messages in the YouTube DJ module
 * Provides type safety for socket.io communication
 */

// Base message interface that all messages extend
export interface BaseSocketMessage {
  type: string;
  userId: string;
  timestamp: number;
  data?: any;
}

// Session Management Messages
export interface UserJoinMessage extends BaseSocketMessage {
  type: 'USER_JOIN';
  data: {
    userName: string;
  };
}

export interface UserLeaveMessage extends BaseSocketMessage {
  type: 'USER_LEAVE';
  data?: {
    reason?: string;
  };
}

export interface MemberCleanupMessage extends BaseSocketMessage {
  type: 'MEMBER_CLEANUP';
  data: {
    memberIds: string[];
    reason: string;
  };
}

// DJ Role Management Messages
export interface DJClaimMessage extends BaseSocketMessage {
  type: 'DJ_CLAIM';
  data: {
    userName: string;
    force?: boolean;
  };
}

export interface DJReleaseMessage extends BaseSocketMessage {
  type: 'DJ_RELEASE';
  data?: {
    reason?: string;
  };
}

export interface DJRequestMessage extends BaseSocketMessage {
  type: 'DJ_REQUEST';
  data: {
    userName: string;
    requestMessage?: string;
  };
}

export interface DJApproveMessage extends BaseSocketMessage {
  type: 'DJ_APPROVE';
  data: {
    approvedUserId: string;
    approvedUserName: string;
  };
}

export interface DJDenyMessage extends BaseSocketMessage {
  type: 'DJ_DENY';
  data: {
    deniedUserId: string;
    reason?: string;
  };
}

export interface DJHandoffMessage extends BaseSocketMessage {
  type: 'DJ_HANDOFF';
  data: {
    newDJId: string;
    newDJName: string;
  };
}

export interface GMOverrideMessage extends BaseSocketMessage {
  type: 'GM_OVERRIDE';
  data: {
    action: 'claim' | 'release' | 'handoff';
    targetUserId?: string;
  };
}

// Playback Control Messages
export interface PlayMessage extends BaseSocketMessage {
  type: 'PLAY';
  data?: {
    startTime?: number;
    videoId?: string;
  };
}

export interface PauseMessage extends BaseSocketMessage {
  type: 'PAUSE';
  data?: {
    currentTime?: number;
  };
}

export interface SeekMessage extends BaseSocketMessage {
  type: 'SEEK';
  data: {
    seekTo: number;
  };
}

export interface LoadMessage extends BaseSocketMessage {
  type: 'LOAD';
  data: {
    videoId: string;
    videoUrl: string;
    title?: string;
    startTime?: number;
    autoPlay?: boolean;
  };
}

export interface LoadPlaylistMessage extends BaseSocketMessage {
  type: 'LOAD_PLAYLIST';
  data: {
    playlistId: string;
    autoPlay?: boolean;
    timestamp: number;
  };
}

// Playlist Navigation Messages
export interface PlaylistNextMessage extends BaseSocketMessage {
  type: 'PLAYLIST_NEXT';
  data: {
    playlistId: string;
    nextIndex: number;
  };
}

export interface PlaylistPrevMessage extends BaseSocketMessage {
  type: 'PLAYLIST_PREV';
  data: {
    playlistId: string;
    prevIndex: number;
  };
}

// Queue Management Messages
export interface QueueAddMessage extends BaseSocketMessage {
  type: 'QUEUE_ADD';
  data: {
    videoUrl: string;
    videoId: string;
    title?: string;
    addedBy: string;
    isPlaylist?: boolean;
    playlistId?: string;
  };
}

export interface QueueRemoveMessage extends BaseSocketMessage {
  type: 'QUEUE_REMOVE';
  data: {
    itemId: string;
    removedBy: string;
  };
}

export interface QueueUpdateMessage extends BaseSocketMessage {
  type: 'QUEUE_UPDATE';
  data: {
    items: any[]; // VideoItem[]
    currentIndex: number;
    updateType: 'reorder' | 'add' | 'remove' | 'clear';
  };
}

export interface QueueNextMessage extends BaseSocketMessage {
  type: 'QUEUE_NEXT';
  data: {
    nextIndex: number;
    videoItem: any; // VideoItem
    autoPlay?: boolean;
  };
}

export interface QueueSkipToMessage extends BaseSocketMessage {
  type: 'QUEUE_SKIP_TO';
  data: {
    targetIndex: number;
    videoItem: any; // VideoItem
  };
}

export interface QueueClearMessage extends BaseSocketMessage {
  type: 'QUEUE_CLEAR';
  data?: {
    clearedBy: string;
  };
}

export interface QueueSyncMessage extends BaseSocketMessage {
  type: 'QUEUE_SYNC';
  data: {
    items: any[]; // VideoItem[]
    currentIndex: number;
    mode: 'single-dj' | 'collaborative';
  };
}

// Saved Queue Messages
export interface QueueSavedMessage extends BaseSocketMessage {
  type: 'QUEUE_SAVED';
  data: {
    queueId: string;
    queueName: string;
    savedBy: string;
  };
}

export interface QueueLoadedMessage extends BaseSocketMessage {
  type: 'QUEUE_LOADED';
  data: {
    queueId: string;
    queueName: string;
    items: any[]; // VideoItem[]
    loadedBy: string;
  };
}

export interface QueueDeletedMessage extends BaseSocketMessage {
  type: 'QUEUE_DELETED';
  data: {
    queueId: string;
    deletedBy: string;
  };
}

export interface QueueRenamedMessage extends BaseSocketMessage {
  type: 'QUEUE_RENAMED';
  data: {
    queueId: string;
    oldName: string;
    newName: string;
    renamedBy: string;
  };
}

// Synchronization Messages
export interface HeartbeatMessage extends BaseSocketMessage {
  type: 'HEARTBEAT';
  data: {
    videoId: string;
    currentTime: number;
    isPlaying: boolean;
    serverTime: number;
    playlistId?: string;
    playlistIndex?: number;
  };
}

export interface HeartbeatResponseMessage extends BaseSocketMessage {
  type: 'HEARTBEAT_RESPONSE';
  data: {
    videoId: string;
    currentTime: number;
    isPlaying: boolean;
    serverTime: number;
    clientTime: number;
    playlistId?: string;
    playlistIndex?: number;
  };
}

export interface StateRequestMessage extends BaseSocketMessage {
  type: 'STATE_REQUEST';
  data?: {
    requestingUserId: string;
  };
}

export interface StateResponseMessage extends BaseSocketMessage {
  type: 'STATE_RESPONSE';
  data: {
    sessionState: any; // SessionState
    playerState: any; // PlayerState
    queueState: any; // QueueState
  };
}

// Union type of all message types for type guards
export type YouTubeDJSocketMessage = 
  | UserJoinMessage
  | UserLeaveMessage
  | MemberCleanupMessage
  | DJClaimMessage
  | DJReleaseMessage
  | DJRequestMessage
  | DJApproveMessage
  | DJDenyMessage
  | DJHandoffMessage
  | GMOverrideMessage
  | PlayMessage
  | PauseMessage
  | SeekMessage
  | LoadMessage
  | LoadPlaylistMessage
  | PlaylistNextMessage
  | PlaylistPrevMessage
  | QueueAddMessage
  | QueueRemoveMessage
  | QueueUpdateMessage
  | QueueNextMessage
  | QueueSkipToMessage
  | QueueClearMessage
  | QueueSyncMessage
  | QueueSavedMessage
  | QueueLoadedMessage
  | QueueDeletedMessage
  | QueueRenamedMessage
  | HeartbeatMessage
  | HeartbeatResponseMessage
  | StateRequestMessage
  | StateResponseMessage;

// Type guard functions for runtime type checking
export function isUserJoinMessage(msg: BaseSocketMessage): msg is UserJoinMessage {
  return msg.type === 'USER_JOIN';
}

export function isDJClaimMessage(msg: BaseSocketMessage): msg is DJClaimMessage {
  return msg.type === 'DJ_CLAIM';
}

export function isPlayMessage(msg: BaseSocketMessage): msg is PlayMessage {
  return msg.type === 'PLAY';
}

export function isHeartbeatMessage(msg: BaseSocketMessage): msg is HeartbeatMessage {
  return msg.type === 'HEARTBEAT';
}

export function isQueueAddMessage(msg: BaseSocketMessage): msg is QueueAddMessage {
  return msg.type === 'QUEUE_ADD';
}

// Add more type guards as needed...

// Message factory functions for creating type-safe messages
export class SocketMessageFactory {
  static createUserJoin(userId: string, userName: string): UserJoinMessage {
    return {
      type: 'USER_JOIN',
      userId,
      timestamp: Date.now(),
      data: { userName }
    };
  }

  static createPlay(userId: string, options?: { startTime?: number; videoId?: string }): PlayMessage {
    return {
      type: 'PLAY',
      userId,
      timestamp: Date.now(),
      data: options
    };
  }

  static createPause(userId: string, currentTime?: number): PauseMessage {
    return {
      type: 'PAUSE',
      userId,
      timestamp: Date.now(),
      data: currentTime ? { currentTime } : undefined
    };
  }

  static createHeartbeat(
    userId: string, 
    videoId: string, 
    currentTime: number, 
    isPlaying: boolean,
    playlistInfo?: { playlistId: string; playlistIndex: number }
  ): HeartbeatMessage {
    return {
      type: 'HEARTBEAT',
      userId,
      timestamp: Date.now(),
      data: {
        videoId,
        currentTime,
        isPlaying,
        serverTime: Date.now(),
        ...playlistInfo
      }
    };
  }

  // Add more factory methods as needed...
}