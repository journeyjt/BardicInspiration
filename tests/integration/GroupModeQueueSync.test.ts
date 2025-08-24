/**
 * Integration test for Group Mode Queue Synchronization Bug
 * 
 * This test reproduces the issue where queue additions from non-DJ users
 * in group mode don't sync to other connected clients (specifically the DJ).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { QueueManager } from '../../src/services/QueueManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Group Mode Queue Synchronization', () => {
  let djStore: SessionStore;
  let playerStore: SessionStore;
  let djSessionManager: SessionManager;
  let playerSessionManager: SessionManager;
  let djQueueManager: QueueManager;
  let playerQueueManager: QueueManager;
  let djSocketManager: SocketManager;
  let playerSocketManager: SocketManager;

  const djUser = { id: 'dj-user-id', name: 'DJ User', isGM: true };
  const playerUser = { id: 'player-user-id', name: 'Player User', isGM: false };

  const testVideo = {
    videoId: 'test-video-123',
    title: 'Test Video from Player',
    duration: 180,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    authorName: 'Test Channel'
  };

  beforeEach(async () => {
    TestUtils.resetMocks();
    
    // Reset singleton instances
    (SessionStore as any).instance = null;

    // Enable Group Mode
    vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
      if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
      return null;
    });

    // Mock socket emit to capture messages between clients
    const socketMessages: any[] = [];
    const mockSocket = {
      emit: vi.fn((event: string, data: any) => {
        socketMessages.push({ event, data, from: game.user?.id });
      }),
      on: vi.fn(),
      off: vi.fn()
    };
    
    // Mock game.socket (this is what QueueManager uses)
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

    // Player uses the same store (simulating single-world scenario)
    playerStore = djStore;
    playerSessionManager = djSessionManager;
    playerQueueManager = djQueueManager;
    playerSocketManager = djSocketManager;

    // DJ claims DJ role and joins session
    TestUtils.mockUser(djUser);
    await djSessionManager.claimDJRole();
    
    // Add DJ as session member
    djSessionManager.addSessionMember({
      userId: djUser.id,
      name: djUser.name,
      isDJ: true,
      isActive: true,
      missedHeartbeats: 0,
      lastActivity: Date.now()
    });

    // Add Player as session member
    djSessionManager.addSessionMember({
      userId: playerUser.id,
      name: playerUser.name,
      isDJ: false,
      isActive: true,
      missedHeartbeats: 0,
      lastActivity: Date.now()
    });

    // Update session state to show both users have joined
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
    socketMessages.length = 0;
  });

  it('should sync queue additions from non-DJ users to DJ in group mode', async () => {
    // Verify initial state - queue should be empty
    expect(djStore.getQueueState().items).toHaveLength(0);

    // Set player user as the current user and mark them as having joined session
    TestUtils.mockUser(playerUser);
    djStore.updateState({
      session: {
        hasJoinedSession: true,
        isConnected: true
      }
    });


    // Player (non-DJ) adds video to queue in group mode
    await playerQueueManager.addVideo(testVideo);

    // Verify queue was updated locally
    const queueAfterAdd = djStore.getQueueState();
    expect(queueAfterAdd.items).toHaveLength(1);
    expect(queueAfterAdd.items[0].videoId).toBe(testVideo.videoId);
    expect(queueAfterAdd.items[0].addedBy).toBe(playerUser.name);

    // Check that socket message was sent for other clients
    expect(game.socket?.emit).toHaveBeenCalledWith(
      'module.bardic-inspiration', 
      expect.objectContaining({
        type: 'QUEUE_ADD',
        userId: playerUser.id,
        timestamp: expect.any(Number),
        data: expect.objectContaining({
          queueItem: expect.objectContaining({
            videoId: testVideo.videoId,
            title: testVideo.title,
            addedBy: playerUser.name
          }),
          playNow: false,
          queueLength: 1
        })
      })
    );

    // Now simulate the DJ client receiving the socket message
    // This tests if the queue sync message is properly handled by other clients
    TestUtils.mockUser(djUser);
    
    // Clear the local queue to simulate separate client state
    djStore.updateState({
      queue: {
        items: [],
        currentIndex: -1
      }
    });

    // Simulate DJ receiving the QUEUE_ADD message from the player
    const socketEmitSpy = game.socket?.emit as any;
    const queueAddMessage = socketEmitSpy.mock.calls.find((call: any[]) => 
      call[1].type === 'QUEUE_ADD'
    )?.[1];

    if (queueAddMessage) {
      // Switch to DJ user context for receiving the message
      TestUtils.mockUser(djUser);
      
      // Directly test our fix by calling the queue sync hook
      // This simulates what QueueAddHandler.handle() would do
      Hooks.callAll('youtubeDJ.queueAdd', {
        queueItem: queueAddMessage.data?.queueItem,
        playNow: queueAddMessage.data?.playNow || false,
        timestamp: queueAddMessage.timestamp,
        userId: queueAddMessage.userId  // This should prevent sync since it's from playerUser
      });
    }

    // CRITICAL TEST: DJ's queue should now contain the video added by the player
    const djQueueAfterSync = djStore.getQueueState();
    
    // This is the failing assertion that demonstrates the bug
    expect(djQueueAfterSync.items).toHaveLength(1);
    expect(djQueueAfterSync.items[0].videoId).toBe(testVideo.videoId);
    expect(djQueueAfterSync.items[0].addedBy).toBe(playerUser.name);
    expect(djQueueAfterSync.items[0].title).toBe(testVideo.title);
  });

  it('should allow both DJ and non-DJ users to add videos in group mode', async () => {
    const djVideo = {
      videoId: 'dj-video-456',
      title: 'DJ Added Video',
      duration: 240
    };

    const playerVideo = {
      videoId: 'player-video-789', 
      title: 'Player Added Video',
      duration: 200
    };

    // DJ adds a video first
    TestUtils.mockUser(djUser);
    await djQueueManager.addVideo(djVideo);

    // Player adds a video second  
    TestUtils.mockUser(playerUser);
    await playerQueueManager.addVideo(playerVideo);

    // Simulate cross-client message handling
    const socketEmitSpy = game.socket?.emit as any;
    const socketCalls = socketEmitSpy.mock.calls;

    // Process DJ's message on player client
    const djMessage = socketCalls.find((call: any[]) => 
      call[1].videoInfo?.videoId === djVideo.videoId
    );
    if (djMessage) {
      TestUtils.mockUser(playerUser);
      const handler = playerSocketManager.getHandler('QUEUE_ADD');
      if (handler) {
        await handler.handle({
          ...djMessage[1],
          senderId: djUser.id
        });
      }
    }

    // Process player's message on DJ client
    const playerMessage = socketCalls.find((call: any[]) => 
      call[1].videoInfo?.videoId === playerVideo.videoId
    );
    if (playerMessage) {
      TestUtils.mockUser(djUser);
      const handler = djSocketManager.getHandler('QUEUE_ADD');
      if (handler) {
        await handler.handle({
          ...playerMessage[1],
          senderId: playerUser.id
        });
      }
    }

    // Both clients should have both videos in the same order
    const djQueue = djStore.getQueueState().items;
    const playerQueue = playerStore.getQueueState().items;

    expect(djQueue).toHaveLength(2);
    expect(playerQueue).toHaveLength(2);

    // Check order and content
    expect(djQueue[0].videoId).toBe(djVideo.videoId);
    expect(djQueue[1].videoId).toBe(playerVideo.videoId);
    expect(playerQueue[0].videoId).toBe(djVideo.videoId); 
    expect(playerQueue[1].videoId).toBe(playerVideo.videoId);
  });

  it('should prevent non-session members from adding videos even in group mode', async () => {
    const outsiderUser = { id: 'outsider-id', name: 'Outsider User', isGM: false };
    
    // Create outsider client that hasn't joined the session
    TestUtils.mockUser(outsiderUser);
    const outsiderStore = SessionStore.getInstance();
    const outsiderQueueManager = new QueueManager(outsiderStore);

    // Outsider should not be able to add videos
    await expect(outsiderQueueManager.addVideo(testVideo))
      .rejects
      .toThrow('You must be in the listening session to add videos to the queue');

    // Verify no videos were added
    expect(outsiderStore.getQueueState().items).toHaveLength(0);
  });
});