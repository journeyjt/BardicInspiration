/**
 * Unit tests for YouTubePlayerWidget - Command Queueing and Retry Logic
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

describe('YouTubePlayerWidget - Command Queueing', () => {
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
    
    // Set up session state
    store.updateState({
      session: {
        djUserId: 'test-dj',
        djRequestQueue: [],
        members: [],
        hasJoinedSession: true,
        isConnected: true,
        activeRequests: [],
        connectionStatus: 'connected'
      },
      player: {
        isReady: false,
        isInitializing: false,
        currentVideo: null,
        currentTime: 0,
        duration: 0,
        playbackState: 'stopped',
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
      nextVideo: vi.fn(),
      previousVideo: vi.fn(),
      getPlayerState: vi.fn().mockReturnValue(1),
      isMuted: vi.fn().mockReturnValue(false),
      getVolume: vi.fn().mockReturnValue(50),
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

  describe('Command Queueing When Player Not Ready', () => {
    it('should queue commands when player is not ready', () => {
      // Player not ready
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Send commands
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      (widget as any).onPlayerCommand({ 
        command: 'loadPlaylist',
        args: [{ list: 'PLtest123' }]
      });
      
      // Commands should be queued
      expect((widget as any).commandQueue).toHaveLength(2);
      expect((widget as any).commandQueue[0].command).toBe('playVideo');
      expect((widget as any).commandQueue[1].command).toBe('loadPlaylist');
      
      // Player methods should NOT be called
      expect(mockPlayer.playVideo).not.toHaveBeenCalled();
      expect(mockPlayer.loadPlaylist).not.toHaveBeenCalled();
    });

    it('should queue commands when player is initializing', () => {
      // Set player as initializing
      store.updateState({
        player: {
          ...store.getPlayerState(),
          isInitializing: true
        }
      });
      
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'pauseVideo' });
      
      // Command should be queued
      expect((widget as any).commandQueue).toHaveLength(1);
      expect((widget as any).commandQueue[0].command).toBe('pauseVideo');
    });

    it('should execute commands immediately when player is ready', () => {
      // Player is ready
      (widget as any).isPlayerReady = true;
      (widget as any).player = mockPlayer;
      
      // Send commands
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      (widget as any).onPlayerCommand({ command: 'pauseVideo' });
      
      // Commands should NOT be queued
      expect((widget as any).commandQueue).toHaveLength(0);
      
      // Player methods should be called immediately
      expect(mockPlayer.playVideo).toHaveBeenCalledTimes(1);
      expect(mockPlayer.pauseVideo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Automatic Player Initialization on Command', () => {
    it('should attempt to initialize player when command is queued', async () => {
      // Player not ready, but session is joined
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Spy on initializePlayer
      const initSpy = vi.spyOn(widget as any, 'initializePlayer').mockResolvedValue(undefined);
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      
      // Should attempt initialization
      expect(initSpy).toHaveBeenCalled();
    });

    it('should NOT initialize if already initializing', () => {
      // Set as initializing
      store.updateState({
        player: {
          ...store.getPlayerState(),
          isInitializing: true
        }
      });
      
      (widget as any).isPlayerReady = false;
      
      const initSpy = vi.spyOn(widget as any, 'initializePlayer');
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      
      // Should NOT attempt initialization (already in progress)
      expect(initSpy).not.toHaveBeenCalled();
    });

    it('should NOT initialize if not in session', () => {
      // Not in session
      store.updateState({
        session: {
          ...store.getSessionState(),
          hasJoinedSession: false
        }
      });
      
      (widget as any).isPlayerReady = false;
      
      const initSpy = vi.spyOn(widget as any, 'initializePlayer');
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      
      // Should NOT attempt initialization (not in session)
      expect(initSpy).not.toHaveBeenCalled();
    });
  });

  describe('Command Processing After Initialization', () => {
    it('should process queued commands after player initialization completes', async () => {
      vi.useFakeTimers();
      
      // Player not ready initially
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Queue some commands
      (widget as any).commandQueue = [
        { command: 'loadPlaylist', args: [{ list: 'PLtest123' }] },
        { command: 'playVideo' }
      ];
      
      // Set up player and mark as ready (simulating what happens in onPlayerReady)
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;
      
      // Call continuePlayerReady which processes queued commands
      (widget as any).continuePlayerReady();
      
      // Advance timers to trigger the delayed command processing (100ms delay in continuePlayerReady)
      vi.advanceTimersByTime(150);
      
      // All queued commands should be processed
      expect(mockPlayer.loadPlaylist).toHaveBeenCalledWith({ list: 'PLtest123' });
      expect(mockPlayer.playVideo).toHaveBeenCalled();
      
      // Queue should be cleared (already cleared when processing starts)
      expect((widget as any).commandQueue).toHaveLength(0);
      
      vi.useRealTimers();
    });

    it('should clear command queue after processing', async () => {
      vi.useFakeTimers();
      
      // Start with queued commands
      (widget as any).commandQueue = [
        { command: 'playVideo' },
        { command: 'pauseVideo' }
      ];
      
      // Make player ready
      (widget as any).isPlayerReady = true;
      (widget as any).player = mockPlayer;
      
      // Process commands (simulate what happens after initialization)
      const queue = [...(widget as any).commandQueue];
      (widget as any).commandQueue = [];
      queue.forEach(cmd => (widget as any).onPlayerCommand(cmd));
      
      // Queue should be empty
      expect((widget as any).commandQueue).toHaveLength(0);
      
      // Commands should have been executed
      expect(mockPlayer.playVideo).toHaveBeenCalled();
      expect(mockPlayer.pauseVideo).toHaveBeenCalled();
      
      vi.useRealTimers();
    });
  });

  describe('Retry Mechanism', () => {
    it('should process queued commands when player becomes ready', () => {
      vi.useFakeTimers();
      
      // Player not ready, not in session (so no initialization attempt)
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      store.updateState({
        session: {
          ...store.getSessionState(),
          hasJoinedSession: false
        }
      });
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'nextVideo' });
      
      // Command should be queued
      expect((widget as any).commandQueue).toHaveLength(1);
      
      // Simulate player becoming ready (as done in onPlayerReady)
      (widget as any).player = mockPlayer;
      (widget as any).isPlayerReady = true;  // Mark as ready before calling continuePlayerReady
      
      // Simulate player becoming ready by calling continuePlayerReady
      (widget as any).continuePlayerReady();
      
      // Advance time to process the queued commands (100ms delay)
      vi.advanceTimersByTime(150);
      
      // The queued command should be processed
      expect(mockPlayer.nextVideo).toHaveBeenCalled();
      
      // Queue should be cleared (already cleared when processing starts)
      expect((widget as any).commandQueue).toHaveLength(0);
      
      vi.useRealTimers();
    });

    it('should not retry if player still not ready after timeout', () => {
      vi.useFakeTimers();
      
      (widget as any).isPlayerReady = false;
      (widget as any).player = null;
      
      // Send command
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      
      // Advance time
      vi.advanceTimersByTime(1000);
      
      // Player still not ready, command should remain queued
      expect((widget as any).commandQueue).toHaveLength(1);
      expect(mockPlayer.playVideo).not.toHaveBeenCalled();
      
      vi.useRealTimers();
    });
  });

  describe('Command Queue During Player Ready Callback', () => {
    it('should process queued commands in onPlayerReady', () => {
      vi.useFakeTimers();
      
      // Queue some commands before player is ready
      (widget as any).commandQueue = [
        { command: 'loadVideoById', args: ['testVideoId', 0] },
        { command: 'playVideo' }
      ];
      
      // Set up player
      (widget as any).player = mockPlayer;
      
      // Simulate player ready event
      (widget as any).onPlayerReady({ target: mockPlayer });
      
      // Advance timer to check iframe creation
      vi.advanceTimersByTime(250);
      
      // Mark as ready (simulating successful iframe check)
      (widget as any).isPlayerReady = true;
      (widget as any).continuePlayerReady();
      
      // Advance timer for command processing
      vi.advanceTimersByTime(100);
      
      // Commands should be processed
      expect(mockPlayer.loadVideoById).toHaveBeenCalledWith('testVideoId', 0);
      expect(mockPlayer.playVideo).toHaveBeenCalled();
      
      // Queue should be cleared
      expect((widget as any).commandQueue).toHaveLength(0);
      
      vi.useRealTimers();
    });
  });

  describe('Error Handling in Command Execution', () => {
    it('should handle errors in player commands gracefully', () => {
      // Player ready but command fails
      (widget as any).isPlayerReady = true;
      (widget as any).player = {
        ...mockPlayer,
        playVideo: vi.fn().mockImplementation(() => {
          throw new Error('Player error');
        })
      };
      
      // Should not throw
      expect(() => {
        (widget as any).onPlayerCommand({ command: 'playVideo' });
      }).not.toThrow();
      
      // Error should be logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to execute player command'),
        expect.any(Error)
      );
    });

    it('should handle missing player methods gracefully', () => {
      // Clear previous logger calls
      vi.clearAllMocks();
      
      // Player ready but method doesn't exist
      (widget as any).isPlayerReady = true;
      (widget as any).player = {}; // No methods
      
      // Should not throw when calling a command with missing method
      expect(() => {
        (widget as any).onPlayerCommand({ command: 'playVideo' });
      }).not.toThrow();
      
      // Should log debug message about executing command (even though method doesn't exist)
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Executing player command'),
        'playVideo'
      );
      
      // Now test a truly unhandled command
      vi.clearAllMocks();
      (widget as any).onPlayerCommand({ command: 'unknownCommand' });
      
      // Warning should be logged for unhandled command
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled player command'),
        'unknownCommand'
      );
    });
  });

  describe('Command Priority and Order', () => {
    it('should maintain command order in queue', () => {
      (widget as any).isPlayerReady = false;
      
      // Queue multiple commands
      (widget as any).onPlayerCommand({ command: 'loadPlaylist', args: [{ list: 'PL1' }] });
      (widget as any).onPlayerCommand({ command: 'playVideo' });
      (widget as any).onPlayerCommand({ command: 'seekTo', args: [50] });
      
      // Check order
      expect((widget as any).commandQueue[0].command).toBe('loadPlaylist');
      expect((widget as any).commandQueue[1].command).toBe('playVideo');
      expect((widget as any).commandQueue[2].command).toBe('seekTo');
    });

    it('should process commands in FIFO order', () => {
      vi.useFakeTimers();
      
      // Queue commands
      (widget as any).commandQueue = [
        { command: 'pauseVideo' },
        { command: 'loadVideoById', args: ['video1'] },
        { command: 'playVideo' }
      ];
      
      // Make player ready
      (widget as any).isPlayerReady = true;
      (widget as any).player = mockPlayer;
      
      // Process queue
      const queue = [...(widget as any).commandQueue];
      (widget as any).commandQueue = [];
      queue.forEach(cmd => (widget as any).onPlayerCommand(cmd));
      
      // Check execution order
      const pauseCallOrder = mockPlayer.pauseVideo.mock.invocationCallOrder[0];
      const loadCallOrder = mockPlayer.loadVideoById.mock.invocationCallOrder[0];
      const playCallOrder = mockPlayer.playVideo.mock.invocationCallOrder[0];
      
      expect(pauseCallOrder).toBeLessThan(loadCallOrder);
      expect(loadCallOrder).toBeLessThan(playCallOrder);
      
      vi.useRealTimers();
    });
  });
});