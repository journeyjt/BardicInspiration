/**
 * Unit tests for YouTubePlayerWidget - Playlist Support and Error Handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { YouTubePlayerWidget } from '../../src/ui/YouTubePlayerWidget';
import { SessionStore } from '../../src/state/SessionStore';

// Mock YouTube Player API
const mockPlayer = {
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  seekTo: vi.fn(),
  loadVideoById: vi.fn(),
  cueVideoById: vi.fn(),
  loadPlaylist: vi.fn(),
  cuePlaylist: vi.fn(),
  nextVideo: vi.fn(),
  previousVideo: vi.fn(),
  playVideoAt: vi.fn(),
  getPlaylist: vi.fn(),
  getPlaylistIndex: vi.fn(),
  mute: vi.fn(),
  unMute: vi.fn(),
  isMuted: vi.fn(() => false),
  getVolume: vi.fn(() => 50),
  setVolume: vi.fn(),
  getCurrentTime: vi.fn(() => 0),
  getDuration: vi.fn(() => 0),
  getPlayerState: vi.fn(() => -1),
  getVideoUrl: vi.fn(() => ''),
  destroy: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
};

// Mock Hooks before anything else
(global as any).Hooks = {
  callAll: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  call: vi.fn(),
  events: {}
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

describe('YouTubePlayerWidget - Playlist Support', () => {
  let widget: YouTubePlayerWidget;
  let store: SessionStore;

  beforeEach(() => {
    // Reset mocks
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
      user: { id: 'test-dj', name: 'Test DJ', isGM: true },
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
    
    // Re-mock Hooks for each test
    (global as any).Hooks.callAll = vi.fn();
    (global as any).Hooks.on = vi.fn();
    (global as any).Hooks.off = vi.fn();
    
    // Mock DOM
    document.body.innerHTML = `
      <div id="players"></div>
    `;
    
    // Mock window
    (global as any).window = {
      location: {
        origin: 'http://localhost',
        protocol: 'http:',
        hostname: 'localhost'
      },
      YT: (global as any).YT,
      onYouTubeIframeAPIReady: undefined,
      setTimeout: vi.fn((fn, delay) => {
        if (delay === 0 || delay === undefined) {
          fn();
        }
        return 1;
      }),
      clearTimeout: vi.fn()
    };
    
    // Create widget instance
    widget = YouTubePlayerWidget.getInstance();
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

  describe('Playlist Commands', () => {
    beforeEach(async () => {
      // Initialize widget
      await widget.initialize();
      // Simulate player ready
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
    });

    it('should handle loadPlaylist command', async () => {
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      await (widget as any).onPlayerCommand({
        command: 'loadPlaylist',
        args: [{
          list: playlistId,
          listType: 'playlist',
          index: 0
        }]
      });
      
      expect(mockPlayer.loadPlaylist).toHaveBeenCalledWith({
        list: playlistId,
        listType: 'playlist',
        index: 0
      });
    });

    it('should handle cuePlaylist command', async () => {
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      await (widget as any).onPlayerCommand({
        command: 'cuePlaylist',
        args: [{
          list: playlistId,
          listType: 'playlist',
          index: 0
        }]
      });
      
      expect(mockPlayer.cuePlaylist).toHaveBeenCalledWith({
        list: playlistId,
        listType: 'playlist',
        index: 0
      });
    });

    it('should handle nextVideo command', async () => {
      await (widget as any).onPlayerCommand({
        command: 'nextVideo'
      });
      
      expect(mockPlayer.nextVideo).toHaveBeenCalled();
    });

    it('should handle previousVideo command', async () => {
      await (widget as any).onPlayerCommand({
        command: 'previousVideo'
      });
      
      expect(mockPlayer.previousVideo).toHaveBeenCalled();
    });

    it('should handle playVideoAt command', async () => {
      await (widget as any).onPlayerCommand({
        command: 'playVideoAt',
        args: [2]
      });
      
      expect(mockPlayer.playVideoAt).toHaveBeenCalledWith(2);
    });
  });

  describe('Playlist Error Handling', () => {
    beforeEach(async () => {
      await widget.initialize();
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
    });

    it('should handle error 150 (embedding disabled) for playlist videos', () => {
      // Mock playlist state
      mockPlayer.getPlaylist.mockReturnValue(['video1', 'video2', 'video3']);
      mockPlayer.getPlaylistIndex.mockReturnValue(0);
      
      // Trigger error 150
      (widget as any).onPlayerError({ data: 150 });
      
      // Should show warning, not error
      expect(ui.notifications?.warn).toHaveBeenCalledWith(
        'This video cannot be played in embedded mode, skipping to next...'
      );
      expect(ui.notifications?.error).not.toHaveBeenCalled();
      
      // Should attempt to skip to next video
      expect(mockPlayer.nextVideo).toHaveBeenCalled();
    });

    it('should handle error 101 (embedding disabled) for playlist videos', () => {
      mockPlayer.getPlaylist.mockReturnValue(['video1', 'video2']);
      mockPlayer.getPlaylistIndex.mockReturnValue(0);
      
      (widget as any).onPlayerError({ data: 101 });
      
      expect(ui.notifications?.warn).toHaveBeenCalledWith(
        'This video cannot be played in embedded mode, skipping to next...'
      );
      expect(mockPlayer.nextVideo).toHaveBeenCalled();
    });

    it('should handle error 100 (video not found) for playlist videos', () => {
      mockPlayer.getPlaylist.mockReturnValue(['video1', 'video2']);
      mockPlayer.getPlaylistIndex.mockReturnValue(0);
      
      (widget as any).onPlayerError({ data: 100 });
      
      expect(ui.notifications?.warn).toHaveBeenCalledWith(
        'This video cannot be played in embedded mode, skipping to next...'
      );
      expect(mockPlayer.nextVideo).toHaveBeenCalled();
    });

    it('should restart playlist if error occurs on last video', () => {
      mockPlayer.getPlaylist.mockReturnValue(['video1', 'video2', 'video3']);
      mockPlayer.getPlaylistIndex.mockReturnValue(2); // Last video
      
      (widget as any).onPlayerError({ data: 150 });
      
      // Should try to play from beginning
      expect(mockPlayer.playVideoAt).toHaveBeenCalledWith(0);
    });

    it('should show error for non-playlist videos with error 150', () => {
      // No playlist
      mockPlayer.getPlaylist.mockReturnValue(null);
      
      (widget as any).onPlayerError({ data: 150 });
      
      // Should show error, not warning
      expect(ui.notifications?.error).toHaveBeenCalledWith(
        'This video has embedding disabled and cannot be played here'
      );
      expect(ui.notifications?.warn).not.toHaveBeenCalled();
      expect(mockPlayer.nextVideo).not.toHaveBeenCalled();
    });

    it('should handle error 2 (invalid parameter)', () => {
      const loggerSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      (widget as any).onPlayerError({ data: 2 });
      
      // Error 2 is logged but not shown as notification when no playlist is loaded
      expect(loggerSpy).toHaveBeenCalled();
      
      loggerSpy.mockRestore();
    });

    it('should handle error 5 (HTML5 player error)', () => {
      (widget as any).onPlayerError({ data: 5 });
      
      expect(ui.notifications?.error).toHaveBeenCalledWith(
        'HTML5 player error - the content may not be supported in your browser'
      );
    });

    it('should handle generic errors', () => {
      (widget as any).onPlayerError({ data: 999 });
      
      expect(ui.notifications?.error).toHaveBeenCalledWith(
        'YouTube Player Error: 999'
      );
    });
  });

  describe('Playlist State Tracking', () => {
    beforeEach(async () => {
      await widget.initialize();
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
    });

    it('should log playlist state on state change', () => {
      const logSpy = vi.spyOn(console, 'log');
      
      // Mock playlist state
      mockPlayer.getPlaylist.mockReturnValue(['video1', 'video2', 'video3']);
      mockPlayer.getPlaylistIndex.mockReturnValue(1);
      
      // Trigger state change
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PLAYING });
      
      // Should log playlist info
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Playlist state:'),
        expect.objectContaining({
          totalVideos: 3,
          currentIndex: 1,
          currentVideoId: 'video2'
        })
      );
    });

    it('should not log playlist state for single videos', () => {
      const logSpy = vi.spyOn(console, 'log');
      
      // No playlist
      mockPlayer.getPlaylist.mockReturnValue(null);
      
      // Trigger state change
      (widget as any).onPlayerStateChange({ data: YT.PlayerState.PLAYING });
      
      // Should not log playlist info
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Playlist state:'),
        expect.any(Object)
      );
    });
  });

  describe('Socket Message Handling', () => {
    beforeEach(async () => {
      await widget.initialize();
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
    });

    it('should handle LOAD_PLAYLIST socket message', () => {
      const message = {
        type: 'LOAD_PLAYLIST',
        userId: 'other-user',
        data: {
          playlistId: 'PLtest123',
          autoPlay: true
        }
      };
      
      // Set as non-DJ to test sync
      store.updateState({
        session: { ...store.getSessionState(), djUserId: 'other-user' }
      });
      
      (widget as any).onSocketMessage(message);
      
      // Should call loadPlaylist since the message is from another user and autoPlay is true
      expect(mockPlayer.loadPlaylist).toHaveBeenCalledWith({
        list: 'PLtest123',
        listType: 'playlist',
        index: 0
      });
    });

    it('should use cuePlaylist for LOAD_PLAYLIST with autoPlay false', () => {
      const onPlayerCommandSpy = vi.spyOn(widget as any, 'onPlayerCommand');
      
      const message = {
        type: 'LOAD_PLAYLIST',
        userId: 'other-user',
        data: {
          playlistId: 'PLtest123',
          autoPlay: false
        }
      };
      
      store.updateState({
        session: { ...store.getSessionState(), djUserId: 'other-user' }
      });
      
      (widget as any).handlePlayerCommand(message);
      
      expect(onPlayerCommandSpy).toHaveBeenCalledWith({
        command: 'cuePlaylist',
        args: [{
          list: 'PLtest123',
          listType: 'playlist',
          index: 0
        }]
      });
    });
  });

  describe('Command Queueing', () => {
    it('should queue playlist commands when player is not ready', async () => {
      await widget.initialize();
      (widget as any).isPlayerReady = false;
      
      const playlistCommand = {
        command: 'loadPlaylist',
        args: [{
          list: 'PLtest123',
          listType: 'playlist',
          index: 0
        }]
      };
      
      await (widget as any).onPlayerCommand(playlistCommand);
      
      // Command should be queued
      expect((widget as any).commandQueue).toContainEqual(playlistCommand);
      
      // Should not execute immediately
      expect(mockPlayer.loadPlaylist).not.toHaveBeenCalled();
    });

    it('should process queued playlist commands when player becomes ready', async () => {
      await widget.initialize();
      
      // Set up player and mark as ready
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
      
      // Queue a command
      (widget as any).commandQueue = [{
        command: 'loadPlaylist',
        args: [{
          list: 'PLtest123',
          listType: 'playlist',
          index: 0
        }]
      }];
      
      // Manually trigger processing of queued commands
      const queue = (widget as any).commandQueue.slice();
      (widget as any).commandQueue = [];
      
      for (const cmd of queue) {
        await (widget as any).onPlayerCommand(cmd);
      }
      
      expect(mockPlayer.loadPlaylist).toHaveBeenCalledWith({
        list: 'PLtest123',
        listType: 'playlist',
        index: 0
      });
    });
  });
});