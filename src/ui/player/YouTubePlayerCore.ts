export interface YouTubePlayerConfig {
  containerId: string;
  width: string;
  height: string;
  playerVars: {
    controls: number;
    autoplay: number;
    rel: number;
    modestbranding: number;
    fs: number;
    cc_load_policy: number;
    iv_load_policy: number;
    playsinline: number;
    enablejsapi: number;
    origin: string;
  };
}

export interface VideoInfo {
  videoId: string;
  title?: string;
  duration?: number;
  thumbnailUrl?: string;
}

export interface PlayerState {
  state: number;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  videoId?: string;
  quality?: string;
  playbackRate: number;
}

export class YouTubePlayerCore {
  private player: any = null;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private config: YouTubePlayerConfig;
  
  private onReadyCallback?: () => void;
  private onStateChangeCallback?: (state: number) => void;
  private onErrorCallback?: (error: any) => void;
  private onPlaybackQualityChangeCallback?: (quality: string) => void;
  private onPlaybackRateChangeCallback?: (rate: number) => void;

  constructor(config: YouTubePlayerConfig) {
    this.config = config;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  async initialize(): Promise<void> {
    if (!window.YT) {
      throw new Error('YouTube API not loaded');
    }

    this.player = new window.YT.Player(this.config.containerId, {
      width: this.config.width,
      height: this.config.height,
      playerVars: this.config.playerVars,
      events: {
        onReady: this.onPlayerReady.bind(this),
        onStateChange: this.onPlayerStateChange.bind(this),
        onError: this.onPlayerError.bind(this),
        onPlaybackQualityChange: this.onPlayerPlaybackQualityChange.bind(this),
        onPlaybackRateChange: this.onPlayerPlaybackRateChange.bind(this)
      }
    });

    return this.readyPromise;
  }

  private onPlayerReady(): void {
    this.isReady = true;
    if (this.readyResolve) {
      this.readyResolve();
    }
    if (this.onReadyCallback) {
      this.onReadyCallback();
    }
  }

  private onPlayerStateChange(event: any): void {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(event.data);
    }
  }

  private onPlayerError(event: any): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(event.data);
    }
  }

  private onPlayerPlaybackQualityChange(event: any): void {
    if (this.onPlaybackQualityChangeCallback) {
      this.onPlaybackQualityChangeCallback(event.data);
    }
  }

  private onPlayerPlaybackRateChange(event: any): void {
    if (this.onPlaybackRateChangeCallback) {
      this.onPlaybackRateChangeCallback(event.data);
    }
  }

  // Event handler registration
  onReady(callback: () => void): void {
    this.onReadyCallback = callback;
  }

  onStateChange(callback: (state: number) => void): void {
    this.onStateChangeCallback = callback;
  }

  onError(callback: (error: any) => void): void {
    this.onErrorCallback = callback;
  }

  onPlaybackQualityChange(callback: (quality: string) => void): void {
    this.onPlaybackQualityChangeCallback = callback;
  }

  onPlaybackRateChange(callback: (rate: number) => void): void {
    this.onPlaybackRateChangeCallback = callback;
  }

  // Player control methods
  async loadVideoById(videoId: string, startSeconds?: number): Promise<void> {
    await this.ensureReady();
    this.player.loadVideoById(videoId, startSeconds || 0);
  }

  async cueVideoById(videoId: string, startSeconds?: number): Promise<void> {
    await this.ensureReady();
    this.player.cueVideoById(videoId, startSeconds || 0);
  }

  async play(): Promise<void> {
    await this.ensureReady();
    this.player.playVideo();
  }

  async pause(): Promise<void> {
    await this.ensureReady();
    this.player.pauseVideo();
  }

  async stop(): Promise<void> {
    await this.ensureReady();
    this.player.stopVideo();
  }

  async seekTo(seconds: number, allowSeekAhead: boolean = true): Promise<void> {
    await this.ensureReady();
    this.player.seekTo(seconds, allowSeekAhead);
  }

  async setVolume(volume: number): Promise<void> {
    await this.ensureReady();
    this.player.setVolume(Math.max(0, Math.min(100, volume)));
  }

  async mute(): Promise<void> {
    await this.ensureReady();
    this.player.mute();
  }

  async unMute(): Promise<void> {
    await this.ensureReady();
    this.player.unMute();
  }

  async setPlaybackRate(rate: number): Promise<void> {
    await this.ensureReady();
    this.player.setPlaybackRate(rate);
  }

  async setPlaybackQuality(quality: string): Promise<void> {
    await this.ensureReady();
    this.player.setPlaybackQuality(quality);
  }

  // Player state getters
  async getPlayerState(): Promise<PlayerState | null> {
    if (!this.isReady) return null;

    try {
      return {
        state: this.player.getPlayerState(),
        currentTime: this.player.getCurrentTime() || 0,
        duration: this.player.getDuration() || 0,
        volume: this.player.getVolume() || 0,
        isMuted: this.player.isMuted() || false,
        videoId: this.player.getVideoData()?.video_id,
        quality: this.player.getPlaybackQuality(),
        playbackRate: this.player.getPlaybackRate() || 1
      };
    } catch (error) {
      console.error('Error getting player state:', error);
      return null;
    }
  }

  async getCurrentTime(): Promise<number> {
    await this.ensureReady();
    return this.player.getCurrentTime() || 0;
  }

  async getDuration(): Promise<number> {
    await this.ensureReady();
    return this.player.getDuration() || 0;
  }

  async getVolume(): Promise<number> {
    await this.ensureReady();
    return this.player.getVolume() || 0;
  }

  async isMuted(): Promise<boolean> {
    await this.ensureReady();
    return this.player.isMuted() || false;
  }

  async getVideoData(): Promise<VideoInfo | null> {
    await this.ensureReady();
    try {
      const data = this.player.getVideoData();
      if (!data || !data.video_id) return null;

      return {
        videoId: data.video_id,
        title: data.title,
        duration: this.player.getDuration(),
        thumbnailUrl: `https://img.youtube.com/vi/${data.video_id}/mqdefault.jpg`
      };
    } catch (error) {
      console.error('Error getting video data:', error);
      return null;
    }
  }

  async getPlaybackQuality(): Promise<string | null> {
    await this.ensureReady();
    return this.player.getPlaybackQuality() || null;
  }

  async getAvailableQualityLevels(): Promise<string[]> {
    await this.ensureReady();
    return this.player.getAvailableQualityLevels() || [];
  }

  async getPlaybackRate(): Promise<number> {
    await this.ensureReady();
    return this.player.getPlaybackRate() || 1;
  }

  async getAvailablePlaybackRates(): Promise<number[]> {
    await this.ensureReady();
    return this.player.getAvailablePlaybackRates() || [1];
  }

  // Utility methods
  async ensureReady(): Promise<void> {
    if (!this.isReady) {
      await this.readyPromise;
    }
  }

  isPlayerReady(): boolean {
    return this.isReady;
  }

  getPlayer(): any {
    return this.player;
  }

  destroy(): void {
    if (this.player && typeof this.player.destroy === 'function') {
      this.player.destroy();
    }
    this.player = null;
    this.isReady = false;
    this.onReadyCallback = undefined;
    this.onStateChangeCallback = undefined;
    this.onErrorCallback = undefined;
    this.onPlaybackQualityChangeCallback = undefined;
    this.onPlaybackRateChangeCallback = undefined;
  }
}