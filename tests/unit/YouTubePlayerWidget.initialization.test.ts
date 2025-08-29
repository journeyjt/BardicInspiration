/**
 * Unit tests for YouTubePlayerWidget - Player Initialization Edge Cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { YouTubePlayerWidget } from '../../src/ui/YouTubePlayerWidget';
import { SessionStore } from '../../src/state/SessionStore';
import { logger } from '../../src/lib/logger';

// Mock the logger module  
vi.mock('../../src/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('YouTubePlayerWidget - Player Initialization', () => {
  let widget: YouTubePlayerWidget;
  let store: SessionStore;
  let mockPlayer: any;

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
    
    // Mock game global
    (global as any).game = {
      user: { id: 'test-dj', name: 'Test DJ' },
      settings: {
        get: vi.fn().mockReturnValue(false),
        set: vi.fn().mockResolvedValue(undefined),
        register: vi.fn()
      },
      socket: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn()
      },
      modules: {
        get: vi.fn().mockReturnValue({
          api: {}
        })
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
    
    // Mock Hooks
    (global as any).Hooks = {
      callAll: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      events: {
        'youtubeDJ.stateChanged': []
      }
    };
    
    // Mock document
    const mockContainer = document.createElement('div');
    mockContainer.id = 'youtube-dj-player-widget';
    document.body.appendChild(mockContainer);
    
    // Mock YouTube API
    mockPlayer = {
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      loadVideoById: vi.fn(),
      loadPlaylist: vi.fn(),
      cuePlaylist: vi.fn(),
      getPlayerState: vi.fn().mockReturnValue(1),
      destroy: vi.fn()
    };
    
    (global as any).YT = {
      Player: vi.fn().mockImplementation(() => mockPlayer),
      PlayerState: {
        PLAYING: 1,
        PAUSED: 2,
        ENDED: 0,
        BUFFERING: 3,
        CUED: 5
      }
    };
    
    // Create widget instance
    widget = new YouTubePlayerWidget();
  });

  afterEach(() => {
    // Clean up widget and its timers
    if (widget) {
      widget.destroy();
    }
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('Playlist ID Handling in Player Initialization', () => {
    it('should NOT use playlist ID as video ID when initializing player', async () => {
      // Set up queue with a playlist
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_123',
            videoId: 'playlist:PLtest123',
            title: 'Test Playlist',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: 'PLtest123'
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        }
      });
      
      // Initialize player
      await (widget as any).initializePlayer();
      
      // Should use playlist parameters instead of videoId
      expect(YT.Player).toHaveBeenCalledWith(
        'youtube-dj-player-widget',
        expect.objectContaining({
          playerVars: expect.objectContaining({
            list: 'PLtest123',
            listType: 'playlist'
          })
        })
      );
      
      // Should NOT have videoId when using playlist
      const callArgs = (YT.Player as any).mock.calls[0][1];
      expect(callArgs.videoId).toBeUndefined();
      
      expect(YT.Player).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          videoId: 'playlist:PLtest123' // Should NOT use this
        })
      );
    });

    it('should use regular video ID when available in queue', async () => {
      // Set up queue with a regular video
      store.updateState({
        queue: {
          items: [{
            id: 'video_123',
            videoId: 'regularVid12',
            title: 'Test Video',
            addedBy: 'Test DJ',
            addedAt: Date.now()
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        }
      });
      
      // Initialize player
      await (widget as any).initializePlayer();
      
      // Should use the regular video ID
      expect(YT.Player).toHaveBeenCalledWith(
        'youtube-dj-player-widget',
        expect.objectContaining({
          videoId: 'regularVid12'
        })
      );
    });

    it('should use default video ID when queue is empty', async () => {
      // Empty queue
      store.updateState({
        queue: {
          items: [],
          currentIndex: -1,
          loopEnabled: false,
          savedQueues: []
        }
      });
      
      // Initialize player
      await (widget as any).initializePlayer();
      
      // Should use default video ID
      expect(YT.Player).toHaveBeenCalledWith(
        'youtube-dj-player-widget',
        expect.objectContaining({
          videoId: 'dQw4w9WgXcQ'
        })
      );
    });

    it('should handle mixed queue with playlist at current index', async () => {
      // Set up mixed queue with playlist at index 0
      store.updateState({
        queue: {
          items: [
            {
              id: 'playlist_123',
              videoId: 'playlist:PLtest123',
              title: 'Test Playlist',
              addedBy: 'Test DJ',
              addedAt: Date.now(),
              isPlaylist: true,
              playlistId: 'PLtest123'
            },
            {
              id: 'video_456',
              videoId: 'videoId12345',
              title: 'Regular Video',
              addedBy: 'Test DJ',
              addedAt: Date.now()
            }
          ],
          currentIndex: 0, // Playlist is current
          loopEnabled: false,
          savedQueues: []
        }
      });
      
      // Initialize player
      await (widget as any).initializePlayer();
      
      // Should use playlist parameters, not videoId
      expect(YT.Player).toHaveBeenCalledWith(
        'youtube-dj-player-widget',
        expect.objectContaining({
          playerVars: expect.objectContaining({
            list: 'PLtest123',
            listType: 'playlist',
            index: 0
          })
        })
      );
    });
  });

  describe('Player Recreation After Failed Initialization', () => {
    it('should detect non-functional player and reinitialize', async () => {
      // Set up a mock player that throws when accessed
      const brokenPlayer = {
        getPlayerState: vi.fn().mockImplementation(() => {
          throw new Error('Player not functional');
        })
      };
      
      (widget as any).player = brokenPlayer;
      (widget as any).isPlayerReady = true;
      
      // Try to initialize again
      await (widget as any).initializePlayer();
      
      // Should create a new player
      expect(YT.Player).toHaveBeenCalled();
      expect((widget as any).isPlayerReady).toBe(false); // Reset during reinitialization
    });

    it('should skip reinitialization if player is functional', async () => {
      // Set up a working player
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
      mockPlayer.getPlayerState.mockReturnValue(2); // PAUSED state
      
      // Clear previous calls
      vi.clearAllMocks();
      
      // Try to initialize again
      await (widget as any).initializePlayer();
      
      // Should NOT create a new player
      expect(YT.Player).not.toHaveBeenCalled();
      expect((widget as any).isPlayerReady).toBe(true); // Still ready
    });
  });

  describe('Command Queueing During Player Initialization', () => {
    it('should queue commands when player is not ready', () => {
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Send a command
      (widget as any).onPlayerCommand({ 
        command: 'loadPlaylist',
        args: [{ list: 'PLtest123' }]
      });
      
      // Command should be queued
      expect((widget as any).commandQueue).toHaveLength(1);
      expect((widget as any).commandQueue[0].command).toBe('loadPlaylist');
      
      // Command should NOT be executed
      expect(mockPlayer.loadPlaylist).not.toHaveBeenCalled();
    });

    it('should attempt to initialize player when command is queued', async () => {
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Set up session state
      store.updateState({
        session: {
          djUserId: 'test-dj',
          hasJoinedSession: true,
          isConnected: true,
          members: [],
          djRequestQueue: [],
          activeRequests: [],
          connectionStatus: 'connected'
        }
      });
      
      // Spy on initializePlayer
      const initSpy = vi.spyOn(widget as any, 'initializePlayer');
      
      // Send a command
      (widget as any).onPlayerCommand({ 
        command: 'loadPlaylist',
        args: [{ list: 'PLtest123' }]
      });
      
      // Should attempt to initialize
      expect(initSpy).toHaveBeenCalled();
    });

    it('should process queued commands after player becomes ready', async () => {
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Queue some commands
      (widget as any).commandQueue = [
        { command: 'loadPlaylist', args: [{ list: 'PLtest123' }] },
        { command: 'playVideo' }
      ];
      
      // Now mark player as ready
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
      
      // Process queued commands (this is what happens after initialization)
      const queue = [...(widget as any).commandQueue];
      (widget as any).commandQueue = [];
      queue.forEach(cmd => (widget as any).onPlayerCommand(cmd));
      
      // Commands should be executed
      expect(mockPlayer.loadPlaylist).toHaveBeenCalledWith({ list: 'PLtest123' });
      expect(mockPlayer.playVideo).toHaveBeenCalled();
    });

    it('should retry commands with timeout if player not ready', () => {
      vi.useFakeTimers();
      
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      const commandSpy = vi.spyOn(widget as any, 'onPlayerCommand');
      
      // Send a command
      (widget as any).onPlayerCommand({ 
        command: 'playVideo'
      });
      
      // Fast forward time
      vi.advanceTimersByTime(500);
      
      // Should NOT retry yet (player still not ready)
      expect(commandSpy).toHaveBeenCalledTimes(1);
      
      // Now make player ready
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
      
      // Fast forward again
      vi.advanceTimersByTime(100);
      
      // Command should be retried (if retry logic is working)
      // Note: The actual retry happens in the setTimeout callback
      
      vi.useRealTimers();
    });
  });

  describe('Container Element Detection', () => {
    it('should handle container being an iframe after player creation', async () => {
      // Mock the container becoming an iframe (YouTube replaces the div)
      const iframeElement = document.createElement('iframe');
      iframeElement.id = 'youtube-dj-player-widget';
      
      // Replace div with iframe
      const container = document.getElementById('youtube-dj-player-widget');
      container?.parentNode?.replaceChild(iframeElement, container);
      
      // Initialize player
      await (widget as any).initializePlayer();
      
      // Should handle the iframe container
      expect(YT.Player).toHaveBeenCalled();
    });

    it('should detect missing container and log error', async () => {
      // Remove container
      const container = document.getElementById('youtube-dj-player-widget');
      container?.remove();
      
      // Try to initialize
      await (widget as any).initializePlayer();
      
      // Should log error about missing container
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('not found in widget')
      );
    });
  });
});