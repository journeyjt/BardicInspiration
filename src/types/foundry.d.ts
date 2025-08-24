// FoundryVTT augmentations and custom types for Bardic Inspiration module

declare global {
  // FoundryVTT global objects
  const game: any;
  const ui: any;
  const canvas: any;
  const CONFIG: any;
  const CONST: any;
  namespace Hooks {
    // Custom hook types for Bardic Inspiration module
    interface StaticCallbacks {
      'youtubeDJ.stateChanged': (event: { changes: Partial<YouTubeDJState> }) => void;
      'youtubeDJ.playerCommand': (data: { command: string; args?: any[] }) => void;
      'youtubeDJ.localPlayerCommand': (data: { command: string; args?: any[] }) => void;
      'youtubeDJ.getCurrentTimeRequest': (data: { requestId: string }) => void;
      'youtubeDJ.currentTimeResponse': (data: { requestId: string; currentTime: number; duration: number }) => void;
      'youtubeDJ.queueNext': (data: { nextIndex: number; videoItem: QueueItem; timestamp: number }) => void;
      'youtubeDJ.loadVideo': (data: { videoId: string; startSeconds?: number }) => void;
      'devModeReady': () => void;
    }
  }

  // Module API interface
  interface ModuleAPI {
    openYoutubeDJ(): void;
    getLibWrapperUtils(): any;
  }

  // Import.meta extensions for Vite
  interface ImportMeta {
    env: {
      VITE_NODE_ENV?: string;
      [key: string]: any;
    };
    hot?: {
      accept(): void;
      dispose(callback: () => void): void;
    };
  }

  // YouTube DJ specific types
  interface YouTubeDJState {
    session: {
      hasJoinedSession: boolean;
      djUserId: string | null;
      members: SessionMember[];
      activeRequests: DJRequest[];
    };
    queue: {
      items: QueueItem[];
      currentIndex: number;
    };
    player: {
      isReady: boolean;
      currentVideo: QueueItem | null;
      playbackState: string;
      currentTime: number;
      duration: number;
    };
  }

  interface SessionMember {
    userId: string;
    name: string;
    isDJ: boolean;
    isActive: boolean;
    lastActivity: number;
  }

  interface DJRequest {
    userId: string;
    userName: string;
    timestamp: number;
  }

  interface QueueItem {
    id: string;
    title: string;
    duration: number;
    thumbnail?: string;
    addedBy: string;
  }

  // YouTube DJ app data interface
  interface YouTubeDJData {
    hasJoinedSession: boolean;
    sessionMembers: SessionMember[];
    queueLength: number;
    isDJ: boolean;
    [key: string]: any; // Index signature for template compatibility
  }
}