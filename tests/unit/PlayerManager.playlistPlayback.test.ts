/**
 * Unit tests for PlayerManager - Playlist Playback Edge Cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PlayerManager } from '../../src/services/PlayerManager';
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

describe('PlayerManager - Playlist Playback', () => {
  let playerManager: PlayerManager;
  let store: SessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Set initial state as DJ
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
        isReady: true,
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
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn()
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
    
    // Create PlayerManager instance
    playerManager = new PlayerManager(store);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Play Button Behavior with Playlists', () => {
    it('should NOT reload playlist if already loaded', async () => {
      const playlistId = 'PLtest123';
      
      // Set up queue with playlist and mark it as already loaded in player
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_123',
            videoId: `playlist:${playlistId}`,
            title: 'Test Playlist',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: playlistId
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: `playlist:${playlistId}`,
            title: 'Test Playlist',
            duration: 0
          },
          playbackState: 'paused'
        }
      });
      
      // Click play
      await playerManager.play();
      
      // Should send playVideo command, NOT loadPlaylist
      expect(Hooks.callAll).toHaveBeenCalledWith(
        'youtubeDJ.playerCommand',
        { command: 'playVideo' }
      );
      
      // Should NOT call loadPlaylist
      expect(Hooks.callAll).not.toHaveBeenCalledWith(
        'youtubeDJ.playerCommand',
        expect.objectContaining({
          command: 'loadPlaylist'
        })
      );
      
      // Should broadcast PLAY message
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'PLAY'
        })
      );
    });

    it('should load playlist if not already loaded', async () => {
      const playlistId = 'PLtest123';
      
      // Set up queue with playlist but player has different content
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_123',
            videoId: `playlist:${playlistId}`,
            title: 'Test Playlist',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: playlistId
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: 'someOtherVideo',
            title: 'Different Video',
            duration: 0
          },
          playbackState: 'paused'
        }
      });
      
      // Mock loadPlaylist
      const loadPlaylistSpy = vi.spyOn(playerManager, 'loadPlaylist');
      
      // Click play
      await playerManager.play();
      
      // Should load the playlist
      expect(loadPlaylistSpy).toHaveBeenCalledWith(playlistId, true);
    });

    it('should handle regular video after playlist correctly', async () => {
      // Set up queue with regular video
      store.updateState({
        queue: {
          items: [{
            id: 'video_123',
            videoId: 'regularVid12',
            title: 'Regular Video',
            addedBy: 'Test DJ',
            addedAt: Date.now()
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: 'playlist:PLoldPlaylist',
            title: 'Old Playlist',
            duration: 0
          },
          playbackState: 'paused'
        }
      });
      
      // Mock loadVideo
      const loadVideoSpy = vi.spyOn(playerManager, 'loadVideo');
      
      // Click play
      await playerManager.play();
      
      // Should load the regular video
      expect(loadVideoSpy).toHaveBeenCalledWith('regularVid12');
    });
  });

  describe('Playlist Loading with Auto-play', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should send play command after loading playlist with autoPlay=true', async () => {
      const playlistId = 'PLtest123';
      
      // Load playlist with autoPlay
      await playerManager.loadPlaylist(playlistId, true);
      
      // Should send loadPlaylist command (state change hook is called first, so check for the player command)
      const playerCommandCall = (Hooks.callAll as any).mock.calls.find((call: any[]) => 
        call[0] === 'youtubeDJ.playerCommand' && call[1]?.command === 'loadPlaylist'
      );
      expect(playerCommandCall).toBeDefined();
      expect(playerCommandCall[1]).toEqual(
        expect.objectContaining({
          command: 'loadPlaylist',
          args: [{
            list: playlistId,
            listType: 'playlist',
            index: 0
          }]
        })
      );
      
      // Should broadcast LOAD_PLAYLIST message
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'LOAD_PLAYLIST',
          data: { playlistId, autoPlay: true }
        })
      );
    });

    it('should NOT send play command when loading with autoPlay=false', async () => {
      const playlistId = 'PLtest123';
      
      // Load playlist without autoPlay
      await playerManager.loadPlaylist(playlistId, false);
      
      // Should send cuePlaylist command instead
      expect(Hooks.callAll).toHaveBeenCalledWith(
        'youtubeDJ.playerCommand',
        expect.objectContaining({
          command: 'cuePlaylist',
          args: [{
            list: playlistId,
            listType: 'playlist',
            index: 0
          }]
        })
      );
      
      // Advance timers
      vi.advanceTimersByTime(1000);
      
      // Should NOT send playVideo command
      expect(Hooks.callAll).not.toHaveBeenCalledWith(
        'youtubeDJ.playerCommand',
        { command: 'playVideo' }
      );
    });
  });

  describe('Mixed Queue Playback', () => {
    it('should handle switching from playlist to video', async () => {
      // Start with playlist loaded
      store.updateState({
        queue: {
          items: [{
            id: 'video_123',
            videoId: 'regularVid12',
            title: 'Regular Video',
            addedBy: 'Test DJ',
            addedAt: Date.now()
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: 'playlist:PLtest123',
            title: 'Previous Playlist',
            duration: 0
          }
        }
      });
      
      const loadVideoSpy = vi.spyOn(playerManager, 'loadVideo');
      
      await playerManager.play();
      
      // Should load the regular video
      expect(loadVideoSpy).toHaveBeenCalledWith('regularVid12');
    });

    it('should handle switching from video to playlist', async () => {
      const playlistId = 'PLtest456';
      
      // Start with video loaded
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_456',
            videoId: `playlist:${playlistId}`,
            title: 'New Playlist',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: playlistId
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: 'regularVid12',
            title: 'Previous Video',
            duration: 180
          }
        }
      });
      
      const loadPlaylistSpy = vi.spyOn(playerManager, 'loadPlaylist');
      
      await playerManager.play();
      
      // Should load the playlist
      expect(loadPlaylistSpy).toHaveBeenCalledWith(playlistId, true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when non-DJ tries to play', async () => {
      // Change to non-DJ user
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });
      
      await expect(playerManager.play()).rejects.toThrow('Only DJ can control playback');
    });

    it('should throw error when no video in queue and no fallback', async () => {
      // Empty queue and no loaded video
      store.updateState({
        queue: {
          items: [],
          currentIndex: -1,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: null
        }
      });
      
      await expect(playerManager.play()).rejects.toThrow('No video loaded. Please add videos to the queue first.');
    });

    it('should handle non-embeddable playlist IDs', async () => {
      const nonEmbeddableId = 'LL'; // Liked videos playlist
      
      // This should be caught at the queue level, but test PlayerManager handles it
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_ll',
            videoId: `playlist:${nonEmbeddableId}`,
            title: 'Liked Videos',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: nonEmbeddableId
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        }
      });
      
      // Should still attempt to load (validation happens in QueueManager)
      await playerManager.play();
      
      // loadPlaylist should be called (validation is QueueManager's responsibility)
      expect(Hooks.callAll).toHaveBeenCalledWith(
        'youtubeDJ.playerCommand',
        expect.objectContaining({
          command: 'loadPlaylist'
        })
      );
    });
  });

  describe('State Updates', () => {
    it('should update playback state to playing when play succeeds', async () => {
      // Set up with loaded playlist
      const playlistId = 'PLtest123';
      store.updateState({
        queue: {
          items: [{
            id: 'playlist_123',
            videoId: `playlist:${playlistId}`,
            title: 'Test Playlist',
            addedBy: 'Test DJ',
            addedAt: Date.now(),
            isPlaylist: true,
            playlistId: playlistId
          }],
          currentIndex: 0,
          loopEnabled: false,
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: `playlist:${playlistId}`,
            title: 'Test Playlist',
            duration: 0
          },
          playbackState: 'paused'
        }
      });
      
      await playerManager.play();
      
      // Should update state to playing
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).toBe('playing');
    });

    it('should update current video when loading playlist', async () => {
      const playlistId = 'PLnewList';
      
      await playerManager.loadPlaylist(playlistId, false);
      
      const playerState = store.getPlayerState();
      expect(playerState.currentVideo?.videoId).toBe(`playlist:${playlistId}`);
      expect(playerState.currentVideo?.title).toBe('🎵 YouTube Playlist');
    });
  });
});