/**
 * State type definitions for YouTube DJ module
 * Centralized state management interfaces
 */

// ===== Core Data Structures =====

// Inactive user detection configuration
export const HEARTBEAT_ACTIVITY_CONFIG = {
  MAX_MISSED_HEARTBEATS: 5, // Users who miss 5 consecutive heartbeats are removed (10 seconds)
  HEARTBEAT_INTERVAL: 2000, // 2 seconds between heartbeats
  CLEANUP_ON_HEARTBEAT: true // Remove inactive users immediately when detected
} as const;

export interface SessionMember {
  userId: string;
  name: string;
  isDJ: boolean;
  isActive: boolean;
  missedHeartbeats: number;
  lastActivity?: number;
}

export interface VideoItem {
  id: string;
  videoId: string;
  title?: string;
  addedBy: string;
  addedAt: number;
}

export interface VideoInfo {
  videoId: string;
  title?: string;
  duration?: number;
  thumbnailUrl?: string;
  authorName?: string;
  authorUrl?: string;
  publishedAt?: string;
}

export interface DJRequest {
  userId: string;
  userName: string;
  timestamp: number;
}

export interface HeartbeatData {
  videoId: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  timestamp: number;
  serverTime: number;
}

// ===== State Interfaces =====

export interface SessionState {
  id: string;
  members: SessionMember[];
  djUserId: string | null;
  isConnected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  hasJoinedSession: boolean;
  activeRequests: DJRequest[];
}

export interface PlayerState {
  isReady: boolean;
  isInitializing: boolean;
  isRecreating: boolean;
  currentVideo: VideoInfo | null;
  playbackState: 'playing' | 'paused' | 'stopped' | 'loading';
  currentTime: number;
  duration: number;
  // Note: isMuted and volume are now stored as per-user client settings
  // Use game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted') and 'youtubeDJ.userVolume'
  autoplayConsent: boolean;
  lastHeartbeat: HeartbeatData | null;
  driftTolerance: number;
  heartbeatFrequency: number;
}

export interface QueueState {
  items: VideoItem[];
  currentIndex: number;
  mode: 'single-dj' | 'collaborative';
  djUserId: string | null;
}

export interface UIState {
  isVisible: boolean;
  pendingOperations: Array<() => void>;
}

export interface YouTubeDJState {
  session: SessionState;
  player: PlayerState;
  queue: QueueState;
  ui: UIState;
}

// ===== State Change Events =====

export interface StateChangeEvent {
  previous: YouTubeDJState;
  current: YouTubeDJState;
  changes: Partial<YouTubeDJState>;
  timestamp: number;
}

export type StateChangeListener = (event: StateChangeEvent) => void;

// ===== Default State Factories =====

export function createDefaultSessionState(): SessionState {
  return {
    id: '',
    members: [],
    djUserId: null,
    isConnected: false,
    connectionStatus: 'disconnected',
    hasJoinedSession: false,
    activeRequests: []
  };
}

export function createDefaultPlayerState(): PlayerState {
  return {
    isReady: false,
    isInitializing: false,
    isRecreating: false,
    currentVideo: null,
    playbackState: 'stopped',
    currentTime: 0,
    duration: 0,
    // isMuted and volume removed - now stored in client settings
    autoplayConsent: false,
    lastHeartbeat: null,
    driftTolerance: 1.0,
    heartbeatFrequency: 2000
  };
}

export function createDefaultQueueState(): QueueState {
  return {
    items: [],
    currentIndex: -1,
    mode: 'single-dj',
    djUserId: null
  };
}

export function createDefaultUIState(): UIState {
  return {
    isVisible: false,
    pendingOperations: []
  };
}

export function createDefaultYoutubeDJState(): YouTubeDJState {
  return {
    session: createDefaultSessionState(),
    player: createDefaultPlayerState(),
    queue: createDefaultQueueState(),
    ui: createDefaultUIState()
  };
}