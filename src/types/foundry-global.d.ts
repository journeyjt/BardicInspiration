/**
 * Global type declarations for FoundryVTT integration
 */

declare global {
  // FoundryVTT globals - simplified declarations
  const game: {
    user?: {
      id: string;
      name: string;
      isGM: boolean;
    };
    users?: Map<string, any>;
    socket?: {
      connected: boolean;
      emit(event: string, ...args: any[]): void;
      on(event: string, callback: Function): void;
      off(event: string, callback?: Function): void;
    };
    settings?: {
      get(scope: string, key: string): any;
      set(scope: string, key: string, value: any): Promise<void>;
      register(scope: string, key: string, options: any): void;
    };
    modules?: {
      get(id: string): {
        active: boolean;
        api?: ModuleAPI;
      } | undefined;
    };
  };

  const ui: {
    notifications?: {
      info(message: string, options?: { duration?: number }): void;
      warn(message: string, options?: { duration?: number }): void;
      error(message: string, options?: { duration?: number }): void;
      success(message: string, options?: { duration?: number }): void;
    };
    windows?: Map<number, any>;
  };

  // Handlebars globals
  const renderTemplate: (templatePath: string, data?: any) => Promise<string>;

  // FoundryVTT v2 Dialog system
  const foundry: {
    applications: {
      api: {
        DialogV2: {
          wait(config: any): Promise<any>;
        };
        ApplicationV2: {
          new (options?: any): ApplicationV2;
          DEFAULT_OPTIONS: any;
        };
        HandlebarsApplicationMixin: (baseClass: any) => any;
      };
      handlebars: {
        renderTemplate(templatePath: string, data?: any): Promise<string>;
      };
    };
    utils?: {
      handlebars: {
        renderTemplate(templatePath: string, data?: any): Promise<string>;
      };
    };
  };

  // ApplicationV2 interface
  interface ApplicationV2 {
    element: HTMLElement;
    options: any;
    render(force?: boolean): Promise<this>;
    close(): Promise<this>;
    bringToTop(): void;
    template: string;
    _prepareContext(): Promise<any>;
    _onRender?(context: any, options: any): void;
  }

  // Module API interface (required for module registration)
  interface ModuleAPI {
    openYoutubeDJ(): void;
    openYoutubeDJWidget?(): void;
    getLibWrapperUtils?(): any;
  }

  // Import.meta extensions
  interface ImportMeta {
    env?: {
      NODE_ENV?: string;
      DEV?: boolean;
      PROD?: boolean;
      [key: string]: any;
    };
    hot?: {
      accept(): void;
      dispose(callback: () => void): void;
      [key: string]: any;
    };
  }

  // SessionMember interface for type safety
  interface SessionMember {
    userId: string;
    id: string; // alias for userId
    name: string;
    isDJ: boolean;
    isActive: boolean;
    missedHeartbeats: number;
    lastActivity?: number;
  }

  // Player state extensions
  interface Player {
    h?: number;
  }

  // Element style property extension
  interface Element {
    style: CSSStyleDeclaration;
  }

  // YouTube Player API
  namespace YT {
    class Player {
      constructor(elementId: string, options: any);
      playVideo(): void;
      pauseVideo(): void;
      seekTo(seconds: number, allowSeekAhead?: boolean): void;
      loadVideoById(videoId: string, startSeconds?: number): void;
      cueVideoById(videoId: string, startSeconds?: number): void;
      mute(): void;
      unMute(): void;
      isMuted(): boolean;
      getVolume(): number;
      setVolume(volume: number): void;
      getCurrentTime(): number;
      getDuration(): number;
      getPlayerState(): PlayerState;
      getVideoUrl(): string;
      destroy(): void;
      addEventListener(event: string, listener: (event: any) => void): void;
      removeEventListener(event: string, listener: (event: any) => void): void;
    }

    enum PlayerState {
      UNSTARTED = -1,
      ENDED = 0,
      PLAYING = 1,
      PAUSED = 2,
      BUFFERING = 3,
      CUED = 5
    }
  }

  // Window YouTube API ready callback
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: typeof YT;
    youtubeDJWidget?: any;
  }

  // Hooks system
  const Hooks: {
    on(event: string, callback: Function): void;
    off(event: string, callback?: Function): void;
    once(event: string, callback: Function): void;
    callAll(event: string, ...args: any[]): void;
    call(event: string, ...args: any[]): any;
    events: Record<string, Function[]>;
  };
}

export {};