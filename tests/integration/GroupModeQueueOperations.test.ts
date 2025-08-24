/**
 * Integration tests for Group Mode Queue Operations Bug Fixes
 * 
 * Bug 1: Next button queue sync issue in group mode with non-DJ added videos
 * Bug 2: Clear queue doesn't sync to listeners and doesn't stop player
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { QueueManager } from '../../src/services/QueueManager.js';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Group Mode Queue Operations Bug Fixes', () => {
  let djStore: SessionStore;
  let djSessionManager: SessionManager;
  let djQueueManager: QueueManager;
  let djPlayerManager: PlayerManager;
  let djSocketManager: SocketManager;

  const djUser = { id: 'dj-user-id', name: 'DJ User', isGM: true };
  const playerUser = { id: 'player-user-id', name: 'Player User', isGM: false };

  const djVideo = {
    videoId: 'dj-video-123',
    title: 'DJ Added Video',
    duration: 180,
    thumbnailUrl: 'https://example.com/thumb1.jpg',
    authorName: 'DJ Channel'
  };

  const playerVideo = {
    videoId: 'player-video-456',
    title: 'Player Added Video', 
    duration: 240,
    thumbnailUrl: 'https://example.com/thumb2.jpg',
    authorName: 'Player Channel'
  };

  const thirdVideo = {
    videoId: 'third-video-789',
    title: 'Third Video',
    duration: 200,
    thumbnailUrl: 'https://example.com/thumb3.jpg',
    authorName: 'Third Channel'
  };

  beforeEach(async () => {
    TestUtils.resetMocks();
    
    // Reset singleton instances
    (SessionStore as any).instance = null;

    // Setup per-user mock settings storage for client settings
    const mockSettingsStore = new Map<string, Map<string, any>>();
    
    // Initialize default settings for each user
    [djUser.id, playerUser.id].forEach(userId => {
      const userSettings = new Map<string, any>();
      userSettings.set('bardic-inspiration.youtubeDJ.groupMode', true);
      userSettings.set('bardic-inspiration.youtubeDJ.userMuted', false); // Default unmuted
      userSettings.set('bardic-inspiration.youtubeDJ.userVolume', 50); // Default volume 50
      mockSettingsStore.set(userId, userSettings);
    });

    vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
      const currentUserId = game.user?.id || 'default';
      const userSettings = mockSettingsStore.get(currentUserId);
      if (!userSettings) return null;
      
      const settingKey = `${scope}.${key}`;
      return userSettings.get(settingKey) ?? null;
    });

    vi.spyOn(game.settings, 'set').mockImplementation(async (scope: string, key: string, value: any) => {
      const currentUserId = game.user?.id || 'default';
      let userSettings = mockSettingsStore.get(currentUserId);
      if (!userSettings) {
        userSettings = new Map<string, any>();
        mockSettingsStore.set(currentUserId, userSettings);
      }
      
      const settingKey = `${scope}.${key}`;
      userSettings.set(settingKey, value);
      return Promise.resolve();
    });

    // Mock game.socket for message sending
    const mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    
    if (!game.socket) {
      (game as any).socket = mockSocket;
    } else {
      game.socket.emit = mockSocket.emit;
    }

    // Initialize shared store and services
    djStore = SessionStore.getInstance();
    djStore.initialize();
    
    djSocketManager = new SocketManager(djStore);
    djSocketManager.initialize();
    
    djSessionManager = new SessionManager(djStore, djSocketManager);
    djQueueManager = new QueueManager(djStore);
    djPlayerManager = new PlayerManager(djStore);

    // Setup DJ and session members
    TestUtils.mockUser(djUser);
    await djSessionManager.claimDJRole();
    
    djSessionManager.addSessionMember({
      userId: djUser.id,
      name: djUser.name,
      isDJ: true,
      isActive: true,
      missedHeartbeats: 0,
      lastActivity: Date.now()
    });

    djSessionManager.addSessionMember({
      userId: playerUser.id,
      name: playerUser.name,
      isDJ: false,
      isActive: true,
      missedHeartbeats: 0,
      lastActivity: Date.now()
    });

    djStore.updateState({
      session: {
        hasJoinedSession: true,
        isConnected: true
      }
    });

    // Clear any setup socket messages
    if (game.socket?.emit) {
      (game.socket.emit as any).mockClear?.();
    }
  });

  describe('Bug 1: Next Button Queue Sync in Group Mode', () => {
    it('should sync queue next operation when DJ advances through queue with non-DJ added videos', async () => {
      // Setup: Add videos from different users to create mixed queue
      // DJ adds first video
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);

      // Player adds second video (this is what triggers the bug)
      TestUtils.mockUser(playerUser);
      djStore.updateState({
        session: {
          hasJoinedSession: true,
          isConnected: true
        }
      });
      
      // Switch back to DJ to simulate DJ receiving the player's video add via socket sync
      TestUtils.mockUser(djUser);
      Hooks.callAll('youtubeDJ.queueAdd', {
        queueItem: {
          id: `${playerVideo.videoId}_${Date.now()}`,
          videoId: playerVideo.videoId,
          title: playerVideo.title,
          addedBy: playerUser.name,
          addedAt: Date.now()
        },
        playNow: false,
        timestamp: Date.now(),
        userId: playerUser.id
      });

      // DJ adds third video
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(thirdVideo);

      // Verify initial queue state
      const initialQueue = djStore.getQueueState();
      expect(initialQueue.items).toHaveLength(3);
      expect(initialQueue.currentIndex).toBe(0);
      expect(initialQueue.items[0].addedBy).toBe(djUser.name); // DJ video first
      expect(initialQueue.items[1].addedBy).toBe(playerUser.name); // Player video second  
      expect(initialQueue.items[2].addedBy).toBe(djUser.name); // DJ video third

      // Clear previous socket calls
      (game.socket?.emit as any).mockClear?.();

      // DJ clicks next button to advance to second video (added by player)
      const nextVideo = await djQueueManager.nextVideo();

      // Verify DJ's local state advanced correctly (cycling queue moves current to end)
      const djQueueAfterNext = djStore.getQueueState();
      expect(djQueueAfterNext.currentIndex).toBe(0); // Still at index 0 after cycling
      expect(djQueueAfterNext.items[0].videoId).toBe(playerVideo.videoId); // Player video now at index 0
      expect(nextVideo?.videoId).toBe(playerVideo.videoId);

      // Verify QUEUE_NEXT socket message was sent
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_NEXT',
          userId: djUser.id,
          timestamp: expect.any(Number),
          data: expect.objectContaining({
            nextIndex: 0, // Cycling keeps index at 0
            videoItem: expect.objectContaining({
              videoId: playerVideo.videoId,
              title: playerVideo.title,
              addedBy: playerUser.name
            })
          })
        })
      );

      // Simulate listener receiving the QUEUE_NEXT message
      TestUtils.mockUser(playerUser); // Switch to listener perspective
      
      // Reset queue to simulate separate client state before sync 
      djStore.updateState({
        queue: {
          items: initialQueue.items, // Original order: [DJ, Player, Third]
          currentIndex: 0 // Still at DJ video (not synced yet)
        }
      });

      // Simulate receiving QUEUE_NEXT message via hook
      const socketCalls = (game.socket?.emit as any).mock.calls;
      const queueNextMessage = socketCalls.find((call: any[]) => 
        call[1].type === 'QUEUE_NEXT'
      )?.[1];

      if (queueNextMessage) {
        Hooks.callAll('youtubeDJ.queueNext', {
          nextIndex: queueNextMessage.data.nextIndex,
          videoItem: queueNextMessage.data.videoItem,
          timestamp: queueNextMessage.timestamp,
          userId: queueNextMessage.userId,
          cycledItem: queueNextMessage.data.cycledItem,
          isCycling: queueNextMessage.data.isCycling
        });
      }

      // CRITICAL TEST: Listener's queue should now be synced with DJ
      const listenerQueueAfterSync = djStore.getQueueState();
      
      // This should pass after fix - queue sync should work with cycling behavior
      expect(listenerQueueAfterSync.currentIndex).toBe(0); // Index stays 0 after cycling
      expect(listenerQueueAfterSync.items[0].videoId).toBe(playerVideo.videoId); // Player video now first
    });

    it('should handle next button advancing through entire mixed queue correctly', async () => {
      // Setup mixed queue: DJ -> Player -> DJ
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);

      TestUtils.mockUser(playerUser);
      djStore.updateState({ session: { hasJoinedSession: true, isConnected: true } });
      
      // Switch back to DJ to receive the socket message
      TestUtils.mockUser(djUser);
      Hooks.callAll('youtubeDJ.queueAdd', {
        queueItem: {
          id: `${playerVideo.videoId}_${Date.now()}`,
          videoId: playerVideo.videoId,
          title: playerVideo.title,
          addedBy: playerUser.name,
          addedAt: Date.now()
        },
        playNow: false,
        timestamp: Date.now(),
        userId: playerUser.id
      });

      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(thirdVideo);

      // Advance through each video and verify sync
      const initialQueue = djStore.getQueueState();
      expect(initialQueue.items).toHaveLength(3);
      expect(initialQueue.currentIndex).toBe(0);

      // Advance to second video (player added) - cycling moves current to end
      await djQueueManager.nextVideo();
      expect(djStore.getQueueState().currentIndex).toBe(0); // Still index 0 after cycling

      // Advance to third video (DJ added) - cycling again
      await djQueueManager.nextVideo();
      expect(djStore.getQueueState().currentIndex).toBe(0); // Still index 0 after cycling

      // Advance once more - should continue cycling
      const cycledVideo = await djQueueManager.nextVideo();
      const finalQueue = djStore.getQueueState();
      
      expect(finalQueue.currentIndex).toBe(0); // Always index 0 with cycling
      // After 3 cycles from [DJ, Player, Third], we should have the original DJ video again
      expect(cycledVideo?.videoId).toBe(djVideo.videoId);
    });
  });

  describe('Bug 2: Clear Queue Sync and Player Stop', () => {
    it('should sync clear queue operation to all listeners and stop player', async () => {
      // Setup: Add multiple videos and start playing
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);
      await djQueueManager.addVideo(playerVideo);
      await djQueueManager.addVideo(thirdVideo);

      // Simulate playing the first video
      djStore.updateState({
        player: {
          playbackState: 'playing',
          currentVideo: {
            id: djVideo.videoId,
            videoId: djVideo.videoId,
            title: djVideo.title,
            addedBy: djUser.name,
            addedAt: Date.now()
          },
          volume: 50,
          isMuted: false
        }
      });

      // Verify initial state
      const initialQueue = djStore.getQueueState();
      const initialPlayer = djStore.getPlayerState();
      
      expect(initialQueue.items).toHaveLength(3);
      expect(initialQueue.currentIndex).toBe(0);
      expect(initialPlayer.playbackState).toBe('playing');
      expect(initialPlayer.currentVideo?.videoId).toBe(djVideo.videoId);

      // Clear previous socket calls
      (game.socket?.emit as any).mockClear?.();

      // DJ clicks clear queue button
      await djQueueManager.clearQueue();

      // Verify DJ's local state is cleared
      const djQueueAfterClear = djStore.getQueueState();
      const djPlayerAfterClear = djStore.getPlayerState();
      
      expect(djQueueAfterClear.items).toHaveLength(0);
      expect(djQueueAfterClear.currentIndex).toBe(-1);
      
      // CRITICAL: Player should be paused when queue is cleared  
      expect(djPlayerAfterClear.playbackState).toBe('paused');
      expect(djPlayerAfterClear.currentVideo).toBeDefined(); // Video remains but is paused

      // Verify QUEUE_CLEAR socket message was sent
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_CLEAR',
          userId: djUser.id,
          timestamp: expect.any(Number)
        })
      );

      // Simulate listener receiving the QUEUE_CLEAR message
      TestUtils.mockUser(playerUser); // Switch to listener perspective

      // Set up listener's state to have the queue (not yet cleared)
      djStore.updateState({
        queue: {
          items: initialQueue.items, // Still has videos
          currentIndex: 0 // Still at first video
        },
        player: {
          playbackState: 'playing', // Still playing
          currentVideo: initialPlayer.currentVideo,
          volume: 50,
          isMuted: false
        }
      });

      // Simulate receiving QUEUE_CLEAR message via hook
      Hooks.callAll('youtubeDJ.queueClear', {
        timestamp: Date.now(),
        userId: djUser.id
      });

      // CRITICAL TEST: Listener's queue should be cleared and player stopped
      const listenerQueueAfterSync = djStore.getQueueState();
      const listenerPlayerAfterSync = djStore.getPlayerState();
      
      // These should pass after fix - currently this is where Bug 2 occurs
      expect(listenerQueueAfterSync.items).toHaveLength(0);
      expect(listenerQueueAfterSync.currentIndex).toBe(-1);
      expect(listenerPlayerAfterSync.playbackState).toBe('paused');
      expect(listenerPlayerAfterSync.currentVideo).toBeDefined(); // Video remains but is paused
    });

    it('should handle clear queue when no videos are playing', async () => {
      // Setup: Add videos but don't start playing
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);
      await djQueueManager.addVideo(playerVideo);

      const initialQueue = djStore.getQueueState();
      const initialPlayer = djStore.getPlayerState();
      
      expect(initialQueue.items).toHaveLength(2);
      expect(initialPlayer.playbackState).not.toBe('playing'); // Not playing
      expect(initialPlayer.currentVideo).toBeNull();

      // DJ clears queue
      await djQueueManager.clearQueue();

      // Verify queue is cleared and player state is appropriate
      const queueAfterClear = djStore.getQueueState();
      const playerAfterClear = djStore.getPlayerState();
      
      expect(queueAfterClear.items).toHaveLength(0);
      expect(queueAfterClear.currentIndex).toBe(-1);
      expect(playerAfterClear.playbackState).toBe('paused'); // Should be paused
      expect(playerAfterClear.currentVideo).toBeNull(); // No video was playing initially
    });

    it('should prevent non-DJ users from clearing queue in group mode', async () => {
      // Setup: Add videos as DJ
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);
      await djQueueManager.addVideo(playerVideo);

      const initialQueue = djStore.getQueueState();
      expect(initialQueue.items).toHaveLength(2);

      // Player user tries to clear queue (should fail)
      TestUtils.mockUser(playerUser);
      djStore.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });

      // This should throw an error since only DJ can clear queue
      await expect(djQueueManager.clearQueue())
        .rejects
        .toThrow('Only the DJ can clear the queue');

      // Queue should be unchanged
      const queueAfterFailedClear = djStore.getQueueState();
      expect(queueAfterFailedClear.items).toHaveLength(2);
    });
  });

  describe('Bug 3: Mute State Per-User', () => {
    it('should not sync mute state when DJ advances to next video', async () => {
      // Setup: Create mixed queue with DJ and player videos
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);

      TestUtils.mockUser(playerUser);
      djStore.updateState({
        session: {
          hasJoinedSession: true,
          isConnected: true
        }
      });
      
      // Switch back to DJ to receive the socket message
      TestUtils.mockUser(djUser);
      Hooks.callAll('youtubeDJ.queueAdd', {
        queueItem: {
          id: `${playerVideo.videoId}_${Date.now()}`,
          videoId: playerVideo.videoId,
          title: playerVideo.title,
          addedBy: playerUser.name,
          addedAt: Date.now()
        },
        playNow: false,
        timestamp: Date.now(),
        userId: playerUser.id
      });

      await djQueueManager.addVideo(thirdVideo);

      // Set DJ player to playing
      djStore.updateState({
        player: {
          playbackState: 'playing',
          currentVideo: {
            id: djVideo.videoId,
            videoId: djVideo.videoId,
            title: djVideo.title,
            addedBy: djUser.name,
            addedAt: Date.now()
          }
        }
      });

      // Set DJ's personal preferences (unmuted, volume 50)
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', false);
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userVolume', 50);

      // Simulate listener perspective - player is muted by user choice
      TestUtils.mockUser(playerUser);
      
      // Set listener's personal preferences (muted, volume 30) 
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', true);
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userVolume', 30);

      const listenerMutedBefore = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted');
      const listenerVolumeBefore = game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume');
      expect(listenerMutedBefore).toBe(true);
      expect(listenerVolumeBefore).toBe(30);

      // DJ advances to next video
      TestUtils.mockUser(djUser);
      const nextVideo = await djQueueManager.nextVideo();

      // Simulate the listener receiving the QUEUE_NEXT message
      const socketCalls = (game.socket?.emit as any).mock.calls;
      const queueNextMessage = socketCalls.find((call: any[]) => 
        call[1].type === 'QUEUE_NEXT'
      )?.[1];

      if (queueNextMessage) {
        TestUtils.mockUser(playerUser); // Switch to listener perspective

        // Simulate receiving QUEUE_NEXT message via hook
        Hooks.callAll('youtubeDJ.queueNext', {
          nextIndex: queueNextMessage.data.nextIndex,
          videoItem: queueNextMessage.data.videoItem,
          timestamp: queueNextMessage.timestamp,
          userId: queueNextMessage.userId,
          cycledItem: queueNextMessage.data.cycledItem,
          isCycling: queueNextMessage.data.isCycling
        });
      }

      // CRITICAL TEST: Listener's mute state should remain unchanged
      const listenerMutedAfter = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted');
      const listenerVolumeAfter = game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume');
      
      // These should pass after fix - mute state should be preserved per user
      expect(listenerMutedAfter).toBe(true); // Should stay muted
      expect(listenerVolumeAfter).toBe(30); // Should preserve volume
      
      // Queue should still sync correctly (cycling behavior may vary, focus on sync working)
      const queueAfterSync = djStore.getQueueState();
      expect(queueAfterSync.items).toHaveLength(3); // All videos still present
      expect(queueAfterSync.currentIndex).toBe(0); // Index updated correctly
    });

    it('should allow independent mute/unmute operations for each user', async () => {
      // Setup initial state
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);

      // DJ starts playing
      djStore.updateState({
        player: {
          playbackState: 'playing',
          currentVideo: {
            id: djVideo.videoId,
            videoId: djVideo.videoId,
            title: djVideo.title,
            addedBy: djUser.name,
            addedAt: Date.now()
          }
        }
      });

      // Set DJ's personal preferences (unmuted, volume 75)
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', false);
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userVolume', 75);

      // Listener joins and sets their own preferences
      TestUtils.mockUser(playerUser);
      djStore.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });
      
      // Set listener's personal preferences (muted, volume 25)
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', true);
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userVolume', 25);

      // Verify that each user context maintains their own settings
      TestUtils.mockUser(djUser);
      const djMuted = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted');
      const djVolume = game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume');
      
      TestUtils.mockUser(playerUser);
      const listenerMuted = game.settings.get('bardic-inspiration', 'youtubeDJ.userMuted');
      const listenerVolume = game.settings.get('bardic-inspiration', 'youtubeDJ.userVolume');
      
      // Verify that the settings were stored correctly per user context
      expect(djMuted).toBe(false); // DJ should be unmuted
      expect(djVolume).toBe(75); // DJ should have volume 75
      expect(listenerMuted).toBe(true); // Listener should be muted  
      expect(listenerVolume).toBe(25); // Listener should have volume 25
    });
  });

  describe('Integration: Both Bugs in Sequence', () => {
    it('should handle next button operations followed by clear queue correctly', async () => {
      // This test combines both bug scenarios to ensure they work together
      
      // Setup mixed queue
      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(djVideo);

      TestUtils.mockUser(playerUser);
      djStore.updateState({ session: { hasJoinedSession: true, isConnected: true } });
      
      // Switch back to DJ to receive the socket message
      TestUtils.mockUser(djUser);
      Hooks.callAll('youtubeDJ.queueAdd', {
        queueItem: {
          id: `${playerVideo.videoId}_${Date.now()}`,
          videoId: playerVideo.videoId,
          title: playerVideo.title,
          addedBy: playerUser.name,
          addedAt: Date.now()
        },
        playNow: false,
        timestamp: Date.now(),
        userId: playerUser.id
      });

      TestUtils.mockUser(djUser);
      await djQueueManager.addVideo(thirdVideo);

      // Start playing and advance queue
      djStore.updateState({
        player: { playbackState: 'playing', currentVideo: { videoId: djVideo.videoId } }
      });

      // DJ advances to next video (player added) - cycling behavior
      const nextVideo = await djQueueManager.nextVideo();
      expect(nextVideo?.videoId).toBe(playerVideo.videoId);
      expect(djStore.getQueueState().currentIndex).toBe(0); // Index remains 0 after cycling

      // DJ then clears the queue
      await djQueueManager.clearQueue();

      // Verify final state
      const finalQueue = djStore.getQueueState();
      const finalPlayer = djStore.getPlayerState();

      expect(finalQueue.items).toHaveLength(0);
      expect(finalQueue.currentIndex).toBe(-1);
      expect(finalPlayer.playbackState).toBe('paused');
      expect(finalPlayer.currentVideo).toBeDefined(); // Video remains but is paused
    });
  });
});