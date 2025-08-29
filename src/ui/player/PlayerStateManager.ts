import type { PlayerState, VideoInfo } from './YouTubePlayerCore.js';

export interface ExtendedPlayerState extends PlayerState {
  isLoading: boolean;
  hasError: boolean;
  errorMessage?: string;
  lastUpdate: number;
  videoInfo?: VideoInfo;
  playbackHistory: PlaybackEvent[];
}

export interface PlaybackEvent {
  type: 'play' | 'pause' | 'seek' | 'load' | 'error' | 'quality_change' | 'rate_change';
  timestamp: number;
  data?: any;
}

export interface StateSnapshot {
  state: ExtendedPlayerState;
  timestamp: number;
}

export type StateChangeCallback = (state: ExtendedPlayerState, previousState: ExtendedPlayerState) => void;

export class PlayerStateManager {
  private currentState: ExtendedPlayerState;
  private previousState: ExtendedPlayerState | null = null;
  private stateHistory: StateSnapshot[] = [];
  private maxHistorySize = 50;
  private changeCallbacks = new Set<StateChangeCallback>();
  private updateTimer: NodeJS.Timeout | null = null;
  private updateInterval = 1000; // ms
  private debugMode = false;

  constructor(initialState?: Partial<ExtendedPlayerState>) {
    this.currentState = {
      state: -1, // YT.PlayerState.UNSTARTED
      currentTime: 0,
      duration: 0,
      volume: 50,
      isMuted: false,
      playbackRate: 1,
      isLoading: false,
      hasError: false,
      lastUpdate: Date.now(),
      playbackHistory: [],
      ...initialState
    };
  }

  // State management
  updateState(updates: Partial<ExtendedPlayerState>): void {
    this.previousState = { ...this.currentState };
    
    this.currentState = {
      ...this.currentState,
      ...updates,
      lastUpdate: Date.now()
    };

    // Save to history
    this.saveToHistory();

    // Notify callbacks
    this.notifyStateChange();

    if (this.debugMode) {
      console.log('PlayerStateManager: State updated', {
        changes: updates,
        newState: this.currentState
      });
    }
  }

  updatePlayerState(playerState: PlayerState): void {
    this.updateState({
      state: playerState.state,
      currentTime: playerState.currentTime,
      duration: playerState.duration,
      volume: playerState.volume,
      isMuted: playerState.isMuted,
      videoId: playerState.videoId,
      quality: playerState.quality,
      playbackRate: playerState.playbackRate
    });
  }

  updateVideoInfo(videoInfo: VideoInfo): void {
    this.updateState({ videoInfo });
  }

  setLoading(isLoading: boolean): void {
    this.updateState({ isLoading });
  }

  setError(hasError: boolean, errorMessage?: string): void {
    this.updateState({ hasError, errorMessage });
    
    if (hasError) {
      this.addPlaybackEvent('error', { message: errorMessage });
    }
  }

  addPlaybackEvent(type: PlaybackEvent['type'], data?: any): void {
    const event: PlaybackEvent = {
      type,
      timestamp: Date.now(),
      data
    };

    const history = [...this.currentState.playbackHistory, event];
    
    // Limit history size
    while (history.length > 100) {
      history.shift();
    }

    this.updateState({ playbackHistory: history });
  }

  // State getters
  getCurrentState(): ExtendedPlayerState {
    return { ...this.currentState };
  }

  getPreviousState(): ExtendedPlayerState | null {
    return this.previousState ? { ...this.previousState } : null;
  }

  getVideoId(): string | undefined {
    return this.currentState.videoId;
  }

  getCurrentTime(): number {
    return this.currentState.currentTime;
  }

  getDuration(): number {
    return this.currentState.duration;
  }

  getVolume(): number {
    return this.currentState.volume;
  }

  isMuted(): boolean {
    return this.currentState.isMuted;
  }

  isPlaying(): boolean {
    return this.currentState.state === 1; // YT.PlayerState.PLAYING
  }

  isPaused(): boolean {
    return this.currentState.state === 2; // YT.PlayerState.PAUSED
  }

  isBuffering(): boolean {
    return this.currentState.state === 3; // YT.PlayerState.BUFFERING
  }

  hasEnded(): boolean {
    return this.currentState.state === 0; // YT.PlayerState.ENDED
  }

  isLoading(): boolean {
    return this.currentState.isLoading;
  }

  hasError(): boolean {
    return this.currentState.hasError;
  }

  getErrorMessage(): string | undefined {
    return this.currentState.errorMessage;
  }

  getVideoInfo(): VideoInfo | undefined {
    return this.currentState.videoInfo;
  }

  getPlaybackHistory(): PlaybackEvent[] {
    return [...this.currentState.playbackHistory];
  }

  getPlaybackRate(): number {
    return this.currentState.playbackRate;
  }

  getQuality(): string | undefined {
    return this.currentState.quality;
  }

  // State history management
  private saveToHistory(): void {
    const snapshot: StateSnapshot = {
      state: { ...this.currentState },
      timestamp: Date.now()
    };

    this.stateHistory.push(snapshot);

    // Limit history size
    while (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  getStateHistory(): StateSnapshot[] {
    return [...this.stateHistory];
  }

  getStateAt(timestamp: number): ExtendedPlayerState | null {
    const snapshot = this.stateHistory.find(s => 
      Math.abs(s.timestamp - timestamp) < 1000 // Within 1 second
    );
    return snapshot ? { ...snapshot.state } : null;
  }

  clearHistory(): void {
    this.stateHistory = [];
  }

  setMaxHistorySize(size: number): void {
    this.maxHistorySize = Math.max(1, size);
    
    // Trim history if needed
    while (this.stateHistory.length > this.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  // Callbacks
  onStateChange(callback: StateChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  private notifyStateChange(): void {
    if (this.previousState) {
      this.changeCallbacks.forEach(callback => {
        try {
          callback(this.currentState, this.previousState!);
        } catch (error) {
          console.error('PlayerStateManager: Error in state change callback:', error);
        }
      });
    }
  }

  // Periodic updates
  startPeriodicUpdates(interval = 1000): void {
    this.stopPeriodicUpdates();
    this.updateInterval = interval;
    
    this.updateTimer = setInterval(() => {
      // Trigger periodic update callback if registered
      if (this.changeCallbacks.size > 0) {
        this.updateState({ lastUpdate: Date.now() });
      }
    }, this.updateInterval);
  }

  stopPeriodicUpdates(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  // State comparison utilities
  hasStateChanged(field: keyof ExtendedPlayerState): boolean {
    if (!this.previousState) return true;
    return this.currentState[field] !== this.previousState[field];
  }

  getStateChanges(): Partial<ExtendedPlayerState> {
    if (!this.previousState) return { ...this.currentState };

    const changes: Partial<ExtendedPlayerState> = {};
    
    for (const key in this.currentState) {
      const typedKey = key as keyof ExtendedPlayerState;
      if (this.currentState[typedKey] !== this.previousState[typedKey]) {
        (changes as any)[typedKey] = this.currentState[typedKey];
      }
    }

    return changes;
  }

  // Synchronization helpers
  createSyncData(): {
    videoId?: string;
    currentTime: number;
    state: number;
    timestamp: number;
  } {
    return {
      videoId: this.currentState.videoId,
      currentTime: this.currentState.currentTime,
      state: this.currentState.state,
      timestamp: Date.now()
    };
  }

  applySyncData(syncData: {
    videoId?: string;
    currentTime: number;
    state: number;
    timestamp: number;
  }): void {
    const timeDiff = Date.now() - syncData.timestamp;
    const adjustedTime = syncData.currentTime + (timeDiff / 1000);

    this.updateState({
      videoId: syncData.videoId,
      currentTime: adjustedTime,
      state: syncData.state
    });
  }

  // Configuration
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  // Statistics
  getStats(): {
    currentState: ExtendedPlayerState;
    historySize: number;
    maxHistorySize: number;
    callbackCount: number;
    hasPeriodicUpdates: boolean;
    updateInterval: number;
  } {
    return {
      currentState: { ...this.currentState },
      historySize: this.stateHistory.length,
      maxHistorySize: this.maxHistorySize,
      callbackCount: this.changeCallbacks.size,
      hasPeriodicUpdates: this.updateTimer !== null,
      updateInterval: this.updateInterval
    };
  }

  // Cleanup
  destroy(): void {
    this.stopPeriodicUpdates();
    this.changeCallbacks.clear();
    this.clearHistory();
    this.previousState = null;
  }
}