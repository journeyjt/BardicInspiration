/**
 * Unit tests for QueueSectionComponent - Playlist Skip Behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { QueueSectionComponent } from '../../src/ui/components/QueueSectionComponent';
import { SessionStore } from '../../src/state/SessionStore';
import { QueueManager } from '../../src/services/QueueManager';

describe('QueueSectionComponent - Playlist Navigation', () => {
  let component: QueueSectionComponent;
  let store: SessionStore;
  let queueManager: QueueManager;
  let element: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Get fresh store instance and ensure it's not mocked
    store = SessionStore.getInstance();
    
    // If isDJ was mocked in a previous test, restore it
    if (vi.isMockFunction(store.isDJ)) {
      (store.isDJ as any).mockRestore();
    }
    
    store.initialize();
    
    // Set up initial state as DJ (game.user.id is 'test-dj')
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
    
    // Create instances
    queueManager = new QueueManager(store);
    element = document.createElement('div');
    
    // QueueSectionComponent constructor expects: (store, parentElement, queueManager, playerManager)
    component = new QueueSectionComponent(store, element, queueManager, {} as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Skip Button with Playlists', () => {
    it('should send nextVideo command to YouTube player for playlists', async () => {
      // Add a playlist to queue
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.nextVideo(); // Start playing playlist
      
      // Mock getCurrentVideo to return playlist
      vi.spyOn(queueManager, 'getCurrentVideo').mockReturnValue({
        id: 'playlist_PLtest123_123',
        videoId: 'playlist:PLtest123',
        title: '🎵 YouTube Playlist',
        addedBy: 'Test DJ',
        addedAt: Date.now(),
        isPlaylist: true,
        playlistId: 'PLtest123'
      });
      
      // Call skip
      await component.onSkipClick();
      
      // Should call YouTube player command, not queueManager.nextVideo
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'nextVideo'
      });
      
      // Should NOT call queueManager.nextVideo
      const queueSpy = vi.spyOn(queueManager, 'nextVideo');
      expect(queueSpy).not.toHaveBeenCalled();
    });

    it('should use queueManager.nextVideo for regular videos', async () => {
      // Add a regular video
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      await queueManager.nextVideo(); // Start playing
      
      // Mock getCurrentVideo to return regular video
      vi.spyOn(queueManager, 'getCurrentVideo').mockReturnValue({
        id: 'video_123',
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video',
        addedBy: 'Test DJ',
        addedAt: Date.now(),
        isPlaylist: false
      });
      
      // Spy on nextVideo
      const nextVideoSpy = vi.spyOn(queueManager, 'nextVideo');
      
      // Call skip
      await component.onSkipClick();
      
      // Should call queueManager.nextVideo for regular videos
      expect(nextVideoSpy).toHaveBeenCalled();
      
      // Should NOT send playerCommand
      expect(Hooks.callAll).not.toHaveBeenCalledWith('youtubeDJ.playerCommand', 
        expect.objectContaining({ command: 'nextVideo' })
      );
    });

    it('should handle skip when getCurrentVideo returns null', async () => {
      // Mock getCurrentVideo to return null
      vi.spyOn(queueManager, 'getCurrentVideo').mockReturnValue(null);
      
      // Spy on nextVideo
      const nextVideoSpy = vi.spyOn(queueManager, 'nextVideo');
      
      // Call skip
      await component.onSkipClick();
      
      // Should still call nextVideo as fallback
      expect(nextVideoSpy).toHaveBeenCalled();
    });

    it('should show warning when non-DJ tries to skip', async () => {
      // Change to non-DJ user (isDJ will return false because game.user.id is 'test-dj' but djUserId is 'other-user')
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });
      
      // Call skip
      await component.onSkipClick();
      
      // Should show warning
      expect(ui.notifications?.warn).toHaveBeenCalledWith('Only the DJ can skip tracks');
      
      // Should not call any skip methods
      expect(Hooks.callAll).not.toHaveBeenCalledWith('youtubeDJ.playerCommand', 
        expect.any(Object)
      );
    });

    it('should handle errors gracefully', async () => {
      // Mock getCurrentVideo to throw
      vi.spyOn(queueManager, 'getCurrentVideo').mockImplementation(() => {
        throw new Error('Test error');
      });
      
      // Mock console.error to suppress error output
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Call skip
      await component.onSkipClick();
      
      // Should show error notification
      expect(ui.notifications?.error).toHaveBeenCalledWith('Failed to skip track');
      
      errorSpy.mockRestore();
    });
  });

  describe('Mixed Queue Navigation', () => {
    it('should correctly identify playlist vs video when switching', async () => {
      // Add mixed content
      await queueManager.addPlaylist('PLtest123', 'https://example.com');
      await queueManager.addVideo({
        videoId: 'dQw4w9WgXcQ',
        title: 'Regular Video'
      });
      
      // Start playing (playlist plays and cycles to end, regular video is now at index 0)
      await queueManager.nextVideo();
      let current = queueManager.getCurrentVideo();
      expect(current?.isPlaylist).toBeFalsy(); // Regular video is now current
      
      // Skip should use queueManager.nextVideo for regular video
      const nextVideoSpy = vi.spyOn(queueManager, 'nextVideo');
      await component.onSkipClick();
      expect(nextVideoSpy).toHaveBeenCalled();
      
      // After cycling, playlist is back at index 0 after regular video ended
      await (queueManager as any).onVideoEnded({ 
        videoId: 'dQw4w9WgXcQ'
      });
      
      // Now on playlist
      current = queueManager.getCurrentVideo();
      expect(current?.isPlaylist).toBe(true);
      
      // Clear previous calls
      vi.clearAllMocks();
      
      // Skip should use player command for playlist  
      await component.onSkipClick();
      expect(Hooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'nextVideo'
      });
    });
  });
});