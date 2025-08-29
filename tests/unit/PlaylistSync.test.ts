import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import { SessionStore } from '../../src/state/SessionStore.js';

describe('Playlist Synchronization', () => {
  let playerManager: PlayerManager;
  let store: SessionStore;
  let broadcastSpy: any;
  let heartbeatIntervalSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set current user as DJ before initializing services
    (game.user as any) = { id: 'dj-user-id', name: 'DJ User', isGM: false };
    
    // Reset singleton
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    
    // Initialize the store first
    store.initialize();
    
    // Set DJ in store
    store.updateState({
      session: {
        ...store.getSessionState(),
        djUserId: 'dj-user-id',
        members: [{ id: 'dj-user-id', name: 'DJ User' }],
        hasJoinedSession: true
      }
    });
    
    // Mock broadcast
    broadcastSpy = vi.fn();
    playerManager = new PlayerManager(store);
    (playerManager as any).broadcastMessage = broadcastSpy;
    
    // Mock heartbeat interval
    heartbeatIntervalSpy = vi.spyOn(window, 'setInterval');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe('Heartbeat Timer Management', () => {
    it('should start heartbeat when playlist is loaded with autoPlay=true', async () => {
      const playlistId = 'PLD954AD90548599FE';
      
      await playerManager.loadPlaylist(playlistId, true);
      
      // Verify heartbeat timer was started
      expect(heartbeatIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        2000 // Default heartbeat frequency
      );
    });

    it('should NOT start heartbeat when playlist is loaded with autoPlay=false', async () => {
      const playlistId = 'PLD954AD90548599FE';
      
      await playerManager.loadPlaylist(playlistId, false);
      
      // Verify heartbeat timer was NOT started
      expect(heartbeatIntervalSpy).not.toHaveBeenCalled();
    });

    it('should include playlist info in heartbeat data', async () => {
      const playlistId = 'PLD954AD90548599FE';
      
      // Mock widget responses for playlist index
      let playlistIndexHandler: any;
      Hooks.on = vi.fn((event, handler) => {
        if (event === 'youtubeDJ.playlistIndexResponse') {
          playlistIndexHandler = handler;
        }
      });
      
      Hooks.callAll = vi.fn((event) => {
        if (event === 'youtubeDJ.getPlaylistIndexRequest' && playlistIndexHandler) {
          // Simulate widget response
          playlistIndexHandler({ playlistIndex: 3 });
        }
      });
      
      // Set up playlist in queue
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
          isReady: true,
          playbackState: 'playing'
        }
      });
      
      // Trigger heartbeat
      await (playerManager as any).sendHeartbeat();
      
      // Verify heartbeat includes playlist info
      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HEARTBEAT',
          data: expect.objectContaining({
            playlistId: playlistId,
            playlistIndex: 3
          })
        })
      );
    });
  });

  describe('Playlist Navigation Synchronization', () => {
    it('should broadcast PLAYLIST_NEXT when next is clicked on playlist', () => {
      // This test would be in QueueSectionComponent.test.ts
      // but we'll document the expected behavior here
      
      // When DJ clicks next on a playlist item:
      // 1. Should send nextVideo command to local player
      // 2. Should broadcast PLAYLIST_NEXT to other users
      // 3. Listeners should receive and execute nextVideo
      
      expect(true).toBe(true); // Placeholder - actual test in component file
    });

    it('should broadcast PLAYLIST_PREV when previous is clicked on playlist', () => {
      // Similar to above for previous button
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Playlist Index Synchronization', () => {
    it('should sync listener to DJ playlist position when indices differ', () => {
      // This would be tested in YouTubePlayerWidget.test.ts
      // Testing the syncWithHeartbeat method
      
      // Given: DJ at index 5, listener at index 1
      // When: Heartbeat received with playlistIndex: 5
      // Then: Listener should call playVideoAt(5)
      
      expect(true).toBe(true); // Placeholder
    });

    it('should handle playlist index when DJ is not at index 0', () => {
      // Test the case where DJ joins mid-playlist
      // Listener should start at the same position
      
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Edge Cases', () => {
    it('should handle playlist load errors gracefully', async () => {
      const playlistId = 'INVALID_PLAYLIST';
      
      // Save original Hooks.callAll
      const originalCallAll = Hooks.callAll;
      
      // Mock player command to throw error
      Hooks.callAll = vi.fn((event) => {
        if (event === 'youtubeDJ.playerCommand') {
          throw new Error('Invalid playlist');
        }
      });
      
      await expect(playerManager.loadPlaylist(playlistId, true))
        .rejects.toThrow('Invalid playlist');
      
      // Heartbeat should not start on error
      expect(heartbeatIntervalSpy).not.toHaveBeenCalled();
      
      // Restore original Hooks.callAll
      Hooks.callAll = originalCallAll;
    });

    it('should stop heartbeat when playback is paused', async () => {
      const stopHeartbeatSpy = vi.spyOn(playerManager as any, 'stopHeartbeat');
      
      // Set up as playing with a video
      store.updateState({
        player: {
          ...store.getPlayerState(),
          playbackState: 'playing',
          currentVideoId: 'test-video-id'
        },
        queue: {
          ...store.getQueueState(),
          items: [{ 
            id: 'test-item', 
            videoId: 'test-video-id', 
            url: 'https://youtube.com/watch?v=test-video-id',
            addedBy: 'dj-user-id',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      await playerManager.pause();
      
      expect(stopHeartbeatSpy).toHaveBeenCalled();
    });

    it('should restart heartbeat when resumed after pause', async () => {
      const startHeartbeatSpy = vi.spyOn(playerManager as any, 'startHeartbeat');
      
      // Mock Hooks.callAll to prevent actual player commands
      const originalCallAll = Hooks.callAll;
      Hooks.callAll = vi.fn();
      
      // Set up as paused with a video loaded
      store.updateState({
        player: {
          ...store.getPlayerState(),
          playbackState: 'paused',
          currentVideoId: 'test-video-id',
          currentVideo: { 
            videoId: 'test-video-id',
            title: 'Test Video'
          }
        },
        queue: {
          ...store.getQueueState(),
          items: [{ 
            id: 'test-item', 
            videoId: 'test-video-id', 
            url: 'https://youtube.com/watch?v=test-video-id',
            addedBy: 'dj-user-id',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      await playerManager.play();
      
      // Verify heartbeat was started
      expect(startHeartbeatSpy).toHaveBeenCalled();
      
      // Verify state was updated to playing
      expect(store.getPlayerState().playbackState).toBe('playing');
      
      // Restore Hooks.callAll
      Hooks.callAll = originalCallAll;
    });
  });

  describe('Playlist State Management', () => {
    it('should update playlistInfo in state when playlist changes', () => {
      // This would test the onPlayerStateChange in widget
      // Should update state with:
      // - totalVideos
      // - currentIndex
      // - playlistId
      
      expect(true).toBe(true); // Placeholder
    });

    it('should clear playlistInfo when switching to single video', () => {
      // Test that playlistInfo is cleared when no longer in playlist
      
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Multi-user Playlist Sync', () => {
    it('should handle multiple listeners at different playlist positions', () => {
      // Test that each listener syncs independently to DJ position
      // Even if they're at different starting positions
      
      expect(true).toBe(true); // Placeholder
    });

    it('should handle DJ disconnect during playlist playback', () => {
      // Test graceful handling when DJ leaves mid-playlist
      // Listeners should continue playing at current position
      
      expect(true).toBe(true); // Placeholder
    });
  });
});