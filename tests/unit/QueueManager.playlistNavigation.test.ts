/**
 * Unit tests for QueueManager - Playlist Navigation Behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueueManager } from '../../src/services/QueueManager';
import { SessionStore } from '../../src/state/SessionStore';

describe('QueueManager - Playlist Navigation', () => {
  let queueManager: QueueManager;
  let store: SessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Set up initial state
    store.updateState({
      queue: {
        items: [],
        currentIndex: -1,
        loopEnabled: true,
        savedQueues: []
      },
      session: {
        djUserId: 'test-dj',
        djRequestQueue: [],
        members: [],
        hasJoinedSession: true,
        isConnected: true,
        connectionStatus: 'connected'
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
    
    // Create QueueManager instance
    queueManager = new QueueManager(store);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Video End Behavior - Regular Videos', () => {
    it('should auto-advance queue when regular video ends', async () => {
      // Add two regular videos
      await queueManager.addVideo({
        videoId: 'video1video',
        title: 'Video 1'
      });
      
      await queueManager.addVideo({
        videoId: 'video2video',
        title: 'Video 2'
      });
      
      // Start playing first video (video1 plays and cycles to end, video2 is now at index 0)
      await queueManager.nextVideo();
      let state = store.getQueueState();
      expect(state.currentIndex).toBe(0);
      expect(state.items[0].videoId).toBe('video2video'); // video2 is now at index 0 after cycling
      
      // Simulate video ended event for the currently playing video (video2video)
      await (queueManager as any).onVideoEnded({ 
        videoId: 'video2video' 
      });
      
      // Should have advanced to next video with cycling
      state = store.getQueueState();
      expect(state.currentIndex).toBe(0); // Index stays at 0 due to cycling
      expect(state.items[0].videoId).toBe('video1video'); // video1 is back at index 0
      expect(state.items[1].videoId).toBe('video2video'); // video2 cycled to end
    });
  });

  describe('Video End Behavior - Playlists', () => {
    it('should NOT advance queue when video in playlist ends (not last)', async () => {
      // Add a playlist and a regular video
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      
      // Start playing playlist
      await queueManager.nextVideo();
      const initialState = store.getQueueState();
      expect(initialState.currentIndex).toBe(0);
      
      // Simulate video in playlist ended (NOT the last video)
      await (queueManager as any).onVideoEnded({ 
        videoId: 'videoInPlist',
        isPlaylistEnd: false 
      });
      
      // Queue should NOT advance - YouTube handles next video in playlist
      const afterState = store.getQueueState();
      expect(afterState.currentIndex).toBe(0); // Still on playlist
      expect(afterState.items[0].isPlaylist).toBe(true); // Playlist still at index 0
    });

    it('should advance queue when entire playlist ends', async () => {
      // Add a playlist and a regular video
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      
      // Start playing playlist (playlist plays and cycles to end, regular video is now at index 0)
      await queueManager.nextVideo();
      const initialState = store.getQueueState();
      expect(initialState.currentIndex).toBe(0);
      expect(initialState.items[0].videoId).toBe('dQw4w9WgXcQ'); // Regular video at index 0 after cycling
      expect(initialState.items[1].isPlaylist).toBe(true); // Playlist cycled to end
      
      // Simulate regular video ended (not a playlist)
      await (queueManager as any).onVideoEnded({ 
        videoId: 'dQw4w9WgXcQ'
      });
      
      // Queue should advance back to playlist with cycling
      const afterState = store.getQueueState();
      expect(afterState.currentIndex).toBe(0); // Due to cycling
      expect(afterState.items[0].isPlaylist).toBe(true); // Playlist back at index 0
      expect(afterState.items[1].videoId).toBe('dQw4w9WgXcQ'); // Regular video cycled to end
    });
  });

  describe('Skip Button Behavior', () => {
    it('should detect when current item is a playlist', async () => {
      // Add playlist
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.nextVideo();
      
      const currentItem = queueManager.getCurrentVideo();
      expect(currentItem?.isPlaylist).toBe(true);
      expect(currentItem?.playlistId).toBe('PLtest123');
    });

    it('should detect when current item is a regular video', async () => {
      // Add regular video (must be 11 characters)
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      await queueManager.nextVideo();
      
      const currentItem = queueManager.getCurrentVideo();
      expect(currentItem?.isPlaylist).toBeFalsy();
      expect(currentItem?.videoId).toBe('dQw4w9WgXcQ');
    });
  });

  describe('Mixed Queue Behavior', () => {
    it('should handle alternating between playlists and videos', async () => {
      // Create mixed queue
      await queueManager.addVideo({
        videoId: 'video1video',
        title: 'Video 1'
      });
      
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      
      await queueManager.addVideo({
        videoId: 'video2video',
        title: 'Video 2'
      });
      
      // Play first item (video1 plays and cycles to end, playlist is now at index 0)
      await queueManager.nextVideo();
      let current = queueManager.getCurrentVideo();
      expect(current?.videoId).toBe('playlist:PLtest123');
      expect(current?.isPlaylist).toBe(true);
      
      // Simulate playlist ended - should advance to next video
      await (queueManager as any).onVideoEnded({ 
        videoId: 'lastVideoXXX',
        isPlaylistEnd: true 
      });
      
      current = queueManager.getCurrentVideo();
      expect(current?.videoId).toBe('video2video');
      expect(current?.isPlaylist).toBeFalsy();
      
      // Simulate video2 ended - should advance back to video1
      await (queueManager as any).onVideoEnded({ 
        videoId: 'video2video'
      });
      
      current = queueManager.getCurrentVideo();
      expect(current?.videoId).toBe('video1video');
      expect(current?.isPlaylist).toBeFalsy();
    });

    it('should handle multiple playlists in queue', async () => {
      // Add multiple playlists
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.addPlaylist('PLtest456', 'https://example.com');
      
      // Play first playlist (PLtest123 plays and cycles to end, PLtest456 is now at index 0)
      await queueManager.nextVideo();
      let current = queueManager.getCurrentVideo();
      expect(current?.playlistId).toBe('PLtest456');
      
      // Simulate second playlist ended
      await (queueManager as any).onVideoEnded({ 
        videoId: 'lastVideoXX1',
        isPlaylistEnd: true 
      });
      
      // Should be on first playlist now (after cycling)
      current = queueManager.getCurrentVideo();
      expect(current?.playlistId).toBe('PLtest123');
    });
  });

  describe('Edge Cases', () => {
    it('should handle video end event when no current item', async () => {
      // No items in queue
      const result = await (queueManager as any).onVideoEnded({ 
        videoId: 'someVideoXXX' 
      });
      
      // Should handle gracefully
      expect(store.getQueueState().currentIndex).toBe(-1);
    });

    it('should handle playlist end when playlist is only item', async () => {
      // Add only a playlist
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      
      // Play playlist
      await queueManager.nextVideo();
      expect(store.getQueueState().currentIndex).toBe(0);
      
      // Simulate playlist ended
      await (queueManager as any).onVideoEnded({ 
        videoId: 'lastVideoXXX',
        isPlaylistEnd: true 
      });
      
      // With cycling, playlist should still be there but at end
      const state = store.getQueueState();
      expect(state.items).toHaveLength(1);
      expect(state.items[0].isPlaylist).toBe(true);
      expect(state.currentIndex).toBe(0);
    });

    it('should ignore isPlaylistEnd flag for regular videos', async () => {
      // Add regular video
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      
      await queueManager.addVideo({
        videoId: 'anotherVidX',
        title: 'Another Video'
      });
      
      // Play first video (dQw4w9WgXcQ plays and cycles to end, anotherVidX is now at index 0)
      await queueManager.nextVideo();
      
      // Send video ended with isPlaylistEnd: true for the currently playing video (shouldn't matter)
      await (queueManager as any).onVideoEnded({ 
        videoId: 'anotherVidX',
        isPlaylistEnd: true // This should be ignored for non-playlist items
      });
      
      // Should still advance normally (dQw4w9WgXcQ is back at index 0)
      const state = store.getQueueState();
      expect(state.currentIndex).toBe(0);
      expect(state.items[0].videoId).toBe('dQw4w9WgXcQ'); // Cycled correctly
    });
  });
});