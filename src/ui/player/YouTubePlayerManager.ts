import { YouTubePlayerCore, type YouTubePlayerConfig, type PlayerState, type VideoInfo } from './YouTubePlayerCore.js';
import { PlayerCommandQueue, type PlayerCommand, type CommandResult } from './PlayerCommandQueue.js';
import { PlayerStateManager, type ExtendedPlayerState } from './PlayerStateManager.js';
import { PlayerUIRenderer, type UIConfig } from './PlayerUIRenderer.js';
import { PlayerEventHandler, type PlayerEvent } from './PlayerEventHandler.js';

export interface YouTubePlayerManagerConfig {
  containerId: string;
  playerConfig: Omit<YouTubePlayerConfig, 'containerId'>;
  uiConfig: UIConfig;
  debugMode?: boolean;
}

export interface PlayerManagerState {
  isInitialized: boolean;
  isReady: boolean;
  hasError: boolean;
  errorMessage?: string;
  lastActivity: number;
}

export class YouTubePlayerManager {
  private core: YouTubePlayerCore;
  private commandQueue: PlayerCommandQueue;
  private stateManager: PlayerStateManager;
  private uiRenderer: PlayerUIRenderer;
  private eventHandler: PlayerEventHandler;
  
  private config: YouTubePlayerManagerConfig;
  private managerState: PlayerManagerState;
  private debugMode: boolean;
  
  private syncTimer: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL = 1000; // 1 second

  constructor(config: YouTubePlayerManagerConfig) {
    this.config = config;
    this.debugMode = config.debugMode || false;
    
    this.managerState = {
      isInitialized: false,
      isReady: false,
      hasError: false,
      lastActivity: Date.now()
    };

    // Initialize components
    const playerConfig: YouTubePlayerConfig = {
      containerId: config.containerId,
      ...config.playerConfig
    };

    this.core = new YouTubePlayerCore(playerConfig);
    this.commandQueue = new PlayerCommandQueue();
    this.stateManager = new PlayerStateManager();
    this.uiRenderer = new PlayerUIRenderer(config.uiConfig);
    this.eventHandler = new PlayerEventHandler(this.debugMode);

    // Set up component configurations
    if (this.debugMode) {
      this.commandQueue.setDebugMode(true);
      this.stateManager.setDebugMode(true);
      this.uiRenderer.setDebugMode(true);
      this.eventHandler.setDebugMode(true);
    }
  }

  async initialize(): Promise<void> {
    if (this.managerState.isInitialized) {
      throw new Error('YouTubePlayerManager is already initialized');
    }

    try {
      // Initialize UI renderer first (needs DOM elements)
      await this.uiRenderer.initialize();

      // Set up event handlers before initializing core
      this.setupEventHandlers();
      
      // Set up command handlers
      this.setupCommandHandlers();

      // Initialize YouTube player core
      await this.core.initialize();

      // Start state synchronization
      this.startStateSynchronization();

      this.managerState.isInitialized = true;
      this.managerState.lastActivity = Date.now();

      this.log('YouTubePlayerManager initialized successfully');
      this.eventHandler.emitSystem('manager:initialized', { managerId: this.config.containerId });

    } catch (error) {
      this.managerState.hasError = true;
      this.managerState.errorMessage = error instanceof Error ? error.message : String(error);
      this.log('Failed to initialize YouTubePlayerManager:', error);
      throw error;
    }
  }

  private setupEventHandlers(): void {
    // Core player events
    this.core.onReady(async () => {
      this.managerState.isReady = true;
      this.managerState.lastActivity = Date.now();
      
      // Sync actual player mute state with our state
      try {
        const actualMuted = await this.core.isMuted();
        const actualVolume = await this.core.getVolume();
        this.stateManager.updateState({ 
          isMuted: actualMuted,
          volume: actualVolume 
        });
        this.log(`YouTube player ready - muted: ${actualMuted}, volume: ${actualVolume}`);
      } catch (error) {
        this.log('Failed to sync player audio state:', error);
      }
      
      this.eventHandler.emitPlayerReady();
    });

    this.core.onStateChange((state: number) => {
      this.stateManager.updateState({ state });
      this.eventHandler.emitPlayerStateChange(state);
      this.managerState.lastActivity = Date.now();
    });

    this.core.onError((error: any) => {
      this.stateManager.setError(true, `YouTube player error: ${error}`);
      this.eventHandler.emitPlayerError(error);
      this.log('YouTube player error:', error);
    });

    this.core.onPlaybackQualityChange((quality: string) => {
      this.stateManager.updateState({ quality });
      this.eventHandler.emitQualityChange(quality);
    });

    this.core.onPlaybackRateChange((rate: number) => {
      this.stateManager.updateState({ playbackRate: rate });
      this.eventHandler.emitRateChange(rate);
    });

    // State change events
    this.stateManager.onStateChange((state: ExtendedPlayerState, previousState: ExtendedPlayerState) => {
      // Update UI
      this.uiRenderer.scheduleRender(state);
      
      // Emit manager events for significant changes
      if (state.videoId !== previousState.videoId) {
        this.eventHandler.emitVideoLoad(state.videoId || '', state.videoInfo);
      }
      
      if (state.volume !== previousState.volume || state.isMuted !== previousState.isMuted) {
        this.eventHandler.emitVolumeChange(state.volume, state.isMuted);
      }
    });

    // External command events
    this.eventHandler.on('command:external', (event: PlayerEvent) => {
      const { command, data } = event.data;
      this.queueCommand(command, data, 5); // Medium priority for external commands
    });
  }

  private setupCommandHandlers(): void {
    // Playback commands
    this.commandQueue.registerHandler('play', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        // Check if a video is loaded before playing
        const currentState = this.stateManager.getCurrentState();
        if (!currentState.videoId && !currentState.videoInfo) {
          console.warn('[YouTubePlayerManager] Cannot play: No video loaded');
          return { success: false, error: 'No video loaded' };
        }
        await this.core.play();
        this.stateManager.addPlaybackEvent('play');
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('pause', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        await this.core.pause();
        this.stateManager.addPlaybackEvent('pause');
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('seek', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const { time, allowSeekAhead = true } = command.data;
        await this.core.seekTo(time, allowSeekAhead);
        this.stateManager.addPlaybackEvent('seek', { time });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('load', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const { videoId, startTime = 0, autoPlay = true } = command.data;
        
        this.stateManager.setLoading(true);
        
        if (autoPlay) {
          await this.core.loadVideoById(videoId, startTime);
        } else {
          await this.core.cueVideoById(videoId, startTime);
        }
        
        // Get video info and update state
        const videoInfo = await this.core.getVideoData();
        if (videoInfo) {
          this.stateManager.updateVideoInfo(videoInfo);
        }
        
        // Also update the videoId in the state
        this.stateManager.updateState({ videoId });
        
        this.stateManager.setLoading(false);
        this.stateManager.addPlaybackEvent('load', { videoId, startTime, autoPlay });
        
        return { success: true, data: { videoId, videoInfo } };
      } catch (error) {
        this.stateManager.setLoading(false);
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('volume', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const { volume } = command.data;
        await this.core.setVolume(volume);
        this.stateManager.updateState({ volume });
        this.eventHandler.emitSystem('player:volumechange', { volume, isMuted: this.stateManager.isMuted() });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('mute', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        await this.core.mute();
        this.stateManager.updateState({ isMuted: true });
        this.eventHandler.emitSystem('player:muted', { muted: true });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('unmute', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        await this.core.unMute();
        this.stateManager.updateState({ isMuted: false });
        this.eventHandler.emitSystem('player:muted', { muted: false });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('stop', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        await this.core.stop();
        this.stateManager.addPlaybackEvent('pause'); // Stop is effectively a pause
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('quality', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const { quality } = command.data;
        await this.core.setPlaybackQuality(quality);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('rate', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const { rate } = command.data;
        await this.core.setPlaybackRate(rate);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    // Additional handlers for legacy command names
    this.commandQueue.registerHandler('playVideo', async (command: PlayerCommand): Promise<CommandResult> => {
      return this.handlers.get('play')!(command);
    });

    this.commandQueue.registerHandler('pauseVideo', async (command: PlayerCommand): Promise<CommandResult> => {
      return this.handlers.get('pause')!(command);
    });

    this.commandQueue.registerHandler('loadVideoById', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const videoId = command.data?.[0] || command.data?.videoId;
        const startTime = command.data?.[1] || command.data?.startTime || 0;
        
        this.stateManager.setLoading(true);
        await this.core.loadVideoById(videoId, startTime);
        
        // Get video info and update state
        const videoInfo = await this.core.getVideoData();
        if (videoInfo) {
          this.stateManager.updateVideoInfo(videoInfo);
        }
        
        this.stateManager.setLoading(false);
        this.stateManager.addPlaybackEvent('load', { videoId, startTime });
        
        return { success: true, data: { videoId, videoInfo } };
      } catch (error) {
        this.stateManager.setLoading(false);
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('cueVideoById', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const videoId = command.data?.[0] || command.data?.videoId;
        const startTime = command.data?.[1] || command.data?.startTime || 0;
        
        await this.core.cueVideoById(videoId, startTime);
        
        // Get video info and update state
        const videoInfo = await this.core.getVideoData();
        if (videoInfo) {
          this.stateManager.updateVideoInfo(videoInfo);
        }
        
        this.stateManager.addPlaybackEvent('load', { videoId, startTime, autoPlay: false });
        
        return { success: true, data: { videoId, videoInfo } };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });

    this.commandQueue.registerHandler('stopVideo', async (command: PlayerCommand): Promise<CommandResult> => {
      return this.handlers.get('stop')!(command);
    });

    this.commandQueue.registerHandler('seekTo', async (command: PlayerCommand): Promise<CommandResult> => {
      try {
        const time = command.data?.[0] || command.data?.time || 0;
        const allowSeekAhead = command.data?.[1] !== undefined ? command.data[1] : (command.data?.allowSeekAhead ?? true);
        await this.core.seekTo(time, allowSeekAhead);
        this.stateManager.addPlaybackEvent('seek', { time });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    });
  }

  // Store handlers for reuse
  private handlers = new Map<string, CommandHandler>();

  private registerHandler(name: string, handler: CommandHandler): void {
    this.handlers.set(name, handler);
    this.commandQueue.registerHandler(name, handler);
  }

  private async startStateSynchronization(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(async () => {
      if (!this.core.isPlayerReady()) return;

      try {
        const playerState = await this.core.getPlayerState();
        if (playerState) {
          this.stateManager.updatePlayerState(playerState);
        }
      } catch (error) {
        this.log('Error during state synchronization:', error);
      }
    }, this.SYNC_INTERVAL);
  }

  // Public API methods
  async play(): Promise<void> {
    this.queueCommand('play', {}, 10); // High priority
  }

  async pause(): Promise<void> {
    this.queueCommand('pause', {}, 10); // High priority
  }

  async seekTo(time: number, allowSeekAhead = true): Promise<void> {
    this.queueCommand('seek', { time, allowSeekAhead }, 8);
  }

  async loadVideo(videoId: string, startTime = 0, autoPlay = true): Promise<void> {
    this.queueCommand('load', { videoId, startTime, autoPlay }, 9);
  }

  async cueVideo(videoId: string, startTime = 0): Promise<void> {
    this.queueCommand('load', { videoId, startTime, autoPlay: false }, 9);
  }

  async setVolume(volume: number): Promise<void> {
    this.queueCommand('volume', { volume }, 3);
  }

  async mute(): Promise<void> {
    this.queueCommand('mute', {}, 5);
  }

  async unMute(): Promise<void> {
    this.queueCommand('unmute', {}, 5);
  }

  async stop(): Promise<void> {
    this.queueCommand('stop', {}, 7);
  }

  async setPlaybackQuality(quality: string): Promise<void> {
    this.queueCommand('quality', { quality }, 1);
  }

  async setPlaybackRate(rate: number): Promise<void> {
    this.queueCommand('rate', { rate }, 1);
  }

  // Command queue methods
  queueCommand(type: PlayerCommand['type'], data?: any, priority = 0): string {
    return this.commandQueue.queueCommand(type, data, priority);
  }

  clearCommandQueue(): void {
    this.commandQueue.clearQueue();
  }

  // State access methods
  getCurrentState(): ExtendedPlayerState {
    return this.stateManager.getCurrentState();
  }

  getManagerState(): PlayerManagerState {
    return { ...this.managerState };
  }

  isReady(): boolean {
    return this.managerState.isReady && this.core.isPlayerReady();
  }

  isPlaying(): boolean {
    return this.stateManager.isPlaying();
  }

  isPaused(): boolean {
    return this.stateManager.isPaused();
  }

  getCurrentTime(): number {
    return this.stateManager.getCurrentTime();
  }

  getDuration(): number {
    return this.stateManager.getDuration();
  }

  getVolume(): number {
    return this.stateManager.getVolume();
  }

  isMuted(): boolean {
    return this.stateManager.isMuted();
  }

  getVideoId(): string | undefined {
    return this.stateManager.getVideoId();
  }

  getVideoInfo(): VideoInfo | undefined {
    return this.stateManager.getVideoInfo();
  }

  // Event subscription methods
  onPlayerReady(handler: () => void): string {
    return this.eventHandler.onPlayerReady(handler);
  }

  onStateChange(handler: (state: number) => void): string {
    return this.eventHandler.onPlayerStateChange(handler);
  }

  onError(handler: (error: any) => void): string {
    return this.eventHandler.onPlayerError(handler);
  }

  onVideoLoad(handler: (videoId: string) => void): string {
    return this.eventHandler.onVideoLoad(handler);
  }

  off(subscriptionId: string): boolean {
    return this.eventHandler.off(subscriptionId);
  }

  // External command interface
  executeCommand(command: string, data?: any): void {
    this.eventHandler.emit('command:external', { command, data });
  }

  // UI management
  showPlayer(): void {
    this.uiRenderer.showContainer();
  }

  hidePlayer(): void {
    this.uiRenderer.hideContainer();
  }

  updateUI(context?: any): void {
    const state = this.stateManager.getCurrentState();
    this.uiRenderer.render(state, context);
  }

  // Statistics and diagnostics
  getStats(): {
    manager: PlayerManagerState;
    core: { isReady: boolean };
    commandQueue: ReturnType<PlayerCommandQueue['getStats']>;
    stateManager: ReturnType<PlayerStateManager['getStats']>;
    uiRenderer: ReturnType<PlayerUIRenderer['getStats']>;
    eventHandler: ReturnType<PlayerEventHandler['getStats']>;
  } {
    return {
      manager: this.getManagerState(),
      core: { isReady: this.core.isPlayerReady() },
      commandQueue: this.commandQueue.getStats(),
      stateManager: this.stateManager.getStats(),
      uiRenderer: this.uiRenderer.getStats(),
      eventHandler: this.eventHandler.getStats()
    };
  }

  // Utility methods
  private log(...args: any[]): void {
    if (this.debugMode) {
      console.log(`[YouTubePlayerManager:${this.config.containerId}]`, ...args);
    }
  }

  // Cleanup
  async destroy(): Promise<void> {
    this.log('Destroying YouTubePlayerManager');

    // Stop sync timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    // Flush any pending events
    await this.eventHandler.flush();

    // Destroy all components
    this.core.destroy();
    this.commandQueue.destroy();
    this.stateManager.destroy();
    this.uiRenderer.destroy();
    this.eventHandler.destroy();

    // Reset manager state
    this.managerState = {
      isInitialized: false,
      isReady: false,
      hasError: false,
      lastActivity: Date.now()
    };

    this.log('YouTubePlayerManager destroyed');
  }
}