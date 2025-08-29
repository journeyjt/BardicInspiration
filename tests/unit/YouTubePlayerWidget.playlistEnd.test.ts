/**
 * Unit tests for YouTubePlayerWidget - Playlist End Detection
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { YouTubePlayerWidget } from '../../src/ui/YouTubePlayerWidget';
import { SessionStore } from '../../src/state/SessionStore';

// Mock YouTube Player API
const mockPlayer = {
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  getPlaylist: vi.fn(),
  getPlaylistIndex: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  getDuration: vi.fn(() => 0),
  getPlayerState: vi.fn(() => -1),
  getVolume: vi.fn(() => 50),
  isMuted: vi.fn(() => false),
  destroy: vi.fn()
};

// Mock Hooks
(global as any).Hooks = {
  callAll: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  events: {
    'youtubeDJ.stateChanged': []
  }
};

// Mock YT namespace
(global as any).YT = {
  Player: vi.fn(() => mockPlayer),
  PlayerState: {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
  }
};

describe('YouTubePlayerWidget - Playlist End Detection', () => {
  let widget: YouTubePlayerWidget;
  let store: SessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock requestAnimationFrame to execute immediately
    (global as any).requestAnimationFrame = vi.fn((cb) => {
      cb();
      return 0;
    });
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Set up initial state
    store.updateState({
      session: {
        djUserId: 'test-dj',
        djRequestQueue: [],
        members: [],
        hasJoinedSession: true,
        isConnected: true,
        connectionStatus: 'connected'
      },
      player: {
        isReady: true,
        isInitializing: false,
        currentVideo: null,
        playbackState: 'stopped',
        currentTime: 0,
        duration: 0,
        volume: 50,
        isMuted: false,
        driftTolerance: 2
      }
    });
    
    // Mock game global
    (global as any).game = {
      user: { id: 'test-dj', name: 'Test DJ' },
      settings: {
        get: vi.fn().mockReturnValue(false),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        on: vi.fn(),
        emit: vi.fn(),
        off: vi.fn()
      }
    };
    
    // Mock UI
    (global as any).ui = {
      notifications: {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    };
    
    // Mock DOM
    document.body.innerHTML = '<div id="players"></div>';
    
    // Mock window
    (global as any).window = {
      location: {
        origin: 'http://localhost',
        protocol: 'http:',
        hostname: 'localhost'
      },
      YT: (global as any).YT
    };
    
    // Create widget instance
    widget = YouTubePlayerWidget.getInstance();
    widget.initialize();
    
    // Set player on widget
    (widget as any).player = mockPlayer;
    (widget as any).isPlayerReady = true;
  });

  afterEach(() => {
    // Clean up widget and its timers
    if (widget) {
      widget.destroy();
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    // Reset requestAnimationFrame
    delete (global as any).requestAnimationFrame;
  });

  describe('Playlist End Detection', () => {
    it('should detect when last video in playlist ends', () => {
      // Mock playlist with 3 videos, currently on last one
      mockPlayer.getPlaylist.mockReturnValue(['video1video', 'video2video', 'video3video']);
      mockPlayer.getPlaylistIndex.mockReturnValue(2); // Index 2 = last video
      
      // Set current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: { videoId: 'video3video', title: 'Video 3' }
        }
      });
      
      // Clear previous calls
      vi.clearAllMocks();
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should emit videoEnded with isPlaylistEnd: true
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.videoEnded', {
        videoId: 'video3video',
        isPlaylistEnd: true
      });
    });

    it('should detect when middle video in playlist ends', () => {
      // Mock playlist with 3 videos, currently on middle one
      mockPlayer.getPlaylist.mockReturnValue(['video1video', 'video2video', 'video3video']);
      mockPlayer.getPlaylistIndex.mockReturnValue(1); // Index 1 = middle video
      
      // Set current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: { videoId: 'video2video', title: 'Video 2' }
        }
      });
      
      // Clear previous calls
      vi.clearAllMocks();
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should emit videoEnded with isPlaylistEnd: false
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.videoEnded', {
        videoId: 'video2video',
        isPlaylistEnd: false
      });
    });

    it('should handle regular video end (no playlist)', () => {
      // Mock no playlist
      mockPlayer.getPlaylist.mockReturnValue(null);
      mockPlayer.getPlaylistIndex.mockReturnValue(-1);
      
      // Set current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: { videoId: 'dQw4w9WgXcQ', title: 'Regular Video' }
        }
      });
      
      // Clear previous calls
      vi.clearAllMocks();
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should emit videoEnded with isPlaylistEnd: false (calculated as no playlist)
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.videoEnded', {
        videoId: 'dQw4w9WgXcQ',
        isPlaylistEnd: false
      });
    });

    it('should handle empty playlist', () => {
      // Mock empty playlist
      mockPlayer.getPlaylist.mockReturnValue([]);
      mockPlayer.getPlaylistIndex.mockReturnValue(-1);
      
      // Set current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: { videoId: 'someVideoXX', title: 'Some Video' }
        }
      });
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should emit videoEnded without isPlaylistEnd
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.videoEnded', {
        videoId: 'someVideoXX',
        isPlaylistEnd: false
      });
    });

    it('should handle single video playlist', () => {
      // Mock playlist with single video
      mockPlayer.getPlaylist.mockReturnValue(['onlyVideoXX']);
      mockPlayer.getPlaylistIndex.mockReturnValue(0);
      
      // Set current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: { videoId: 'onlyVideoXX', title: 'Only Video' }
        }
      });
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should detect as playlist end (last and only video)
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.videoEnded', {
        videoId: 'onlyVideoXX',
        isPlaylistEnd: true
      });
    });

    it('should not emit videoEnded if no current video', () => {
      // No current video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          currentVideo: null
        }
      });
      
      // Trigger video ended state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      // Should not emit videoEnded
      expect(Hooks.callAll).not.toHaveBeenCalledWith(
        'youtubeDJ.videoEnded',
        expect.any(Object)
      );
    });
  });

  describe('Playlist State Logging', () => {
    it('should log playlist state on any state change when in playlist', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Mock playlist state
      mockPlayer.getPlaylist.mockReturnValue(['video1video', 'video2video', 'video3video']);
      mockPlayer.getPlaylistIndex.mockReturnValue(1);
      
      // Trigger playing state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PLAYING });
      
      // Should log playlist info
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Playlist state:'),
        expect.objectContaining({
          totalVideos: 3,
          currentIndex: 1,
          currentVideoId: 'video2video'
        })
      );
      
      logSpy.mockRestore();
    });

    it('should not log playlist state for regular videos', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // Mock no playlist
      mockPlayer.getPlaylist.mockReturnValue(null);
      
      // Trigger playing state
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PLAYING });
      
      // Should not log playlist info
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Playlist state:'),
        expect.any(Object)
      );
      
      logSpy.mockRestore();
    });
  });

  describe('State Change Updates', () => {
    it('should update playback state on PLAYING', () => {
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PLAYING });
      
      expect(store.getPlayerState().playbackState).toBe('playing');
    });

    it('should update playback state on PAUSED', () => {
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PAUSED });
      
      expect(store.getPlayerState().playbackState).toBe('paused');
    });

    it('should update playback state on ENDED', () => {
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.ENDED });
      
      expect(store.getPlayerState().playbackState).toBe('stopped');
    });
  });
});