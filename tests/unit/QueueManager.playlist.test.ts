/**
 * Unit tests for QueueManager - Playlist Detection and Handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueueManager } from '../../src/services/QueueManager';
import { SessionStore } from '../../src/state/SessionStore';

describe('QueueManager - Playlist Detection', () => {
  let queueManager: QueueManager;
  let store: SessionStore;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Clear queue state
    store.updateState({
      queue: {
        items: [],
        currentIndex: -1,
        loopEnabled: true,
        savedQueues: []
      }
    });
    
    // Create QueueManager instance
    queueManager = new QueueManager(store);
    
    // Mock game global
    (global as any).game = {
      user: { id: 'test-user', name: 'Test User', isGM: false },
      settings: {
        get: vi.fn((scope, key) => {
          if (key === 'youtubeDJ.groupMode') return false;
          return undefined;
        }),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn()
      }
    };
    
    // Mock UI notifications
    (global as any).ui = {
      notifications: {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    };
    
    // Set user as DJ for testing
    store.updateState({
      session: {
        ...store.getSessionState(),
        djUserId: 'test-user'
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Playlist URL Detection', () => {
    it('should detect standard playlist URL', () => {
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(queueManager.isPlaylistUrl(url)).toBe(true);
    });

    it('should detect playlist in watch URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(queueManager.isPlaylistUrl(url)).toBe(true);
    });

    it('should detect playlist with index parameter', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=2';
      expect(queueManager.isPlaylistUrl(url)).toBe(true);
    });

    it('should not detect regular video URL as playlist', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(queueManager.isPlaylistUrl(url)).toBe(false);
    });

    it('should not detect youtu.be URL without playlist', () => {
      const url = 'https://youtu.be/dQw4w9WgXcQ';
      expect(queueManager.isPlaylistUrl(url)).toBe(false);
    });
  });

  describe('Playlist ID Extraction', () => {
    it('should extract playlist ID from standard URL', () => {
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(queueManager.extractPlaylistId(url)).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should extract playlist ID from watch URL with playlist', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      expect(queueManager.extractPlaylistId(url)).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
    });

    it('should extract playlist ID with special characters', () => {
      const url = 'https://www.youtube.com/watch?v=abc&list=PL-test_123-ABC';
      expect(queueManager.extractPlaylistId(url)).toBe('PL-test_123-ABC');
    });

    it('should return null for URL without playlist', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      expect(queueManager.extractPlaylistId(url)).toBeNull();
    });

    it('should handle malformed URLs gracefully', () => {
      const url = 'not-a-valid-url';
      expect(queueManager.extractPlaylistId(url)).toBeNull();
    });
  });

  describe('Video Input Validation with Playlists', () => {
    it('should validate playlist URL correctly', () => {
      const url = 'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const result = queueManager.validateVideoInput(url);
      
      expect(result.isValid).toBe(true);
      expect(result.isPlaylist).toBe(true);
      expect(result.playlistId).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(result.videoId).toBeNull();
    });

    it('should validate video URL with playlist', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const result = queueManager.validateVideoInput(url);
      
      expect(result.isValid).toBe(true);
      expect(result.isPlaylist).toBe(true);
      expect(result.playlistId).toBe('PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf');
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should validate regular video URL', () => {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const result = queueManager.validateVideoInput(url);
      
      expect(result.isValid).toBe(true);
      expect(result.isPlaylist).toBe(undefined);
      expect(result.playlistId).toBe(undefined);
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should validate direct video ID', () => {
      const videoId = 'dQw4w9WgXcQ';
      const result = queueManager.validateVideoInput(videoId);
      
      expect(result.isValid).toBe(true);
      expect(result.isPlaylist).toBe(undefined);
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should reject empty input', () => {
      const result = queueManager.validateVideoInput('');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Please enter a YouTube URL or video ID');
    });

    it('should reject invalid video ID length', () => {
      const result = queueManager.validateVideoInput('abc123'); // Too short
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid YouTube URL or video ID format');
    });
  });

  describe('Adding Playlists to Queue', () => {
    it('should add playlist to queue with correct format', async () => {
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
      
      await queueManager.addPlaylist(playlistId, playlistUrl);
      
      const queueState = store.getQueueState();
      expect(queueState.items).toHaveLength(1);
      
      const item = queueState.items[0];
      expect(item.isPlaylist).toBe(true);
      expect(item.playlistId).toBe(playlistId);
      expect(item.playlistUrl).toBe(playlistUrl);
      expect(item.videoId).toBe(`playlist:${playlistId}`);
      expect(item.title).toBe('🎵 YouTube Playlist');
    });

    it('should broadcast QUEUE_ADD when adding playlist', async () => {
      const socketSpy = vi.spyOn(game.socket, 'emit');
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      expect(socketSpy).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_ADD',
          userId: 'test-user'
        })
      );
    });

    it('should set playlist as current if queue was empty', async () => {
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      const queueState = store.getQueueState();
      expect(queueState.currentIndex).toBe(0);
    });

    it('should not change current index if queue had items', async () => {
      // Add a regular video first
      await queueManager.addVideo({
        videoId: 'test123',
        title: 'Test Video'
      });
      
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      const queueState = store.getQueueState();
      expect(queueState.currentIndex).toBe(0); // Still pointing to first video
      expect(queueState.items).toHaveLength(2);
    });

    it('should reject adding playlist when not DJ', async () => {
      // Remove DJ status
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });
      
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      await expect(
        queueManager.addPlaylist(playlistId, 'https://example.com')
      ).rejects.toThrow('Only the DJ can add playlists to the queue');
    });

    it('should allow adding playlist in group mode when in session', async () => {
      // Enable group mode
      (game.settings.get as any).mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.groupMode') return true;
        return undefined;
      });
      
      // Add user to session but not as DJ
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user',
          hasJoinedSession: true,
          members: [{
            userId: 'test-user',
            name: 'Test User',
            isDJ: false,
            isActive: true,
            missedHeartbeats: 0
          }]
        }
      });
      
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      
      // Should not throw
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      const queueState = store.getQueueState();
      expect(queueState.items).toHaveLength(1);
    });
  });

  describe('Playing Playlist Items', () => {
    it('should emit loadPlaylist hook when playing playlist item', async () => {
      const hookSpy = vi.spyOn(Hooks, 'callAll');
      
      // Add playlist to queue
      const playlistId = 'PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf';
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      // Play the playlist
      await queueManager.nextVideo();
      
      expect(hookSpy).toHaveBeenCalledWith(
        'youtubeDJ.loadPlaylist',
        expect.objectContaining({
          playlistId: playlistId,
          playlistInfo: expect.objectContaining({
            playlistId: playlistId,
            title: '🎵 YouTube Playlist'
          })
        })
      );
    });

    it('should not validate playlist IDs like video IDs', async () => {
      const hookSpy = vi.spyOn(Hooks, 'callAll');
      
      // Add playlist with non-standard ID format
      const playlistId = 'RDEMabcdef'; // YouTube Mix playlist format
      await queueManager.addPlaylist(playlistId, 'https://example.com');
      
      // Should play without validation error
      await queueManager.nextVideo();
      
      expect(hookSpy).toHaveBeenCalledWith(
        'youtubeDJ.loadPlaylist',
        expect.any(Object)
      );
      
      // Should not show error notification
      expect(ui.notifications?.error).not.toHaveBeenCalled();
    });
  });
});