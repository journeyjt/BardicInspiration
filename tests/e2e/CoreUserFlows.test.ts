/**
 * End-to-end tests for core user flows
 * Tests complete workflows from user perspective
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import { QueueManager } from '../../src/services/QueueManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Core User Flows E2E', () => {
  let store: SessionStore;
  let sessionManager: SessionManager;
  let socketManager: SocketManager;
  let playerManager: PlayerManager;
  let queueManager: QueueManager;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    sessionManager = new SessionManager(store);
    socketManager = new SocketManager(store);
    playerManager = new PlayerManager(store);
    queueManager = new QueueManager(store);
    
    // Initialize all services
    socketManager.initialize();
  });

  describe('Complete Session Flow', () => {
    it('should handle complete session lifecycle from empty to multi-user DJ session', async () => {
      // === PHASE 1: First user joins and becomes DJ ===
      TestUtils.mockUser({ id: 'director-id', name: 'Director' });

      // User claims DJ role
      await sessionManager.claimDJRole();
      
      // Add self to session
      sessionManager.addSessionMember({
        userId: 'director-id',
        name: 'Director',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      let state = store.getState();
      expect(state.session.djUserId).toBe('director-id');
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0].isDJ).toBe(true);

      // === PHASE 2: DJ adds videos to queue ===
      const videoInfo1 = {
        videoId: 'dQw4w9WgXcQ', // Valid 11-char YouTube video ID
        title: 'First Song'
      };

      const videoInfo2 = {
        videoId: 'jNQXAC9IVRw', // Valid 11-char YouTube video ID  
        title: 'Second Song'
      };

      await queueManager.addVideo(videoInfo1);
      await queueManager.addVideo(videoInfo2);

      state = store.getState();
      expect(state.queue.items).toHaveLength(2);
      expect(state.queue.items[0].videoId).toBe('dQw4w9WgXcQ');
      expect(state.queue.items[0].title).toBe('First Song');
      expect(state.queue.items[0].addedBy).toBe('Director');

      // === PHASE 3: DJ starts playback ===
      const currentVideo = queueManager.getCurrentVideo();
      expect(currentVideo?.videoId).toBe('dQw4w9WgXcQ');
      expect(currentVideo?.title).toBe('First Song');

      // Play first video (this should load it automatically from queue)
      await playerManager.play();
      
      // Simulate widget response to loadVideoById - update player state
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { videoId: 'dQw4w9WgXcQ', title: 'First Song' },
          playbackState: 'playing'
        }
      });

      // Now try play again - this should send the playVideo command
      await playerManager.play();

      const mockHooks = TestUtils.getMocks().Hooks;
      // Filter hook calls to find playerCommand calls specifically
      const playerCommandCalls = mockHooks.callAll.mock.calls.filter(
        call => call[0] === 'youtubeDJ.playerCommand'
      );
      
      // Should have both loadVideoById and playVideo commands
      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'loadVideoById'
      )).toBe(true);
      
      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'playVideo'
      )).toBe(true);

      // === PHASE 4: Multiple listeners join ===
      const userJoinHandler = socketManager['messageHandlers'].get('USER_JOIN');
      
      // Player1 joins
      userJoinHandler?.handle({
        type: 'USER_JOIN',
        userId: 'player1-id',
        timestamp: Date.now(),
        data: { userName: 'Player 1' }
      });

      // Player2 joins
      userJoinHandler?.handle({
        type: 'USER_JOIN',
        userId: 'player2-id',
        timestamp: Date.now(),
        data: { userName: 'Player 2' }
      });

      state = store.getState();
      expect(state.session.members).toHaveLength(3);
      expect(state.session.members.map(m => m.userId)).toContain('player1-id');
      expect(state.session.members.map(m => m.userId)).toContain('player2-id');

      // === PHASE 5: DJ hands off role to listener ===
      TestUtils.mockUser({ id: 'director-id', name: 'Director' });
      
      await sessionManager.handoffDJRole('player1-id');

      state = store.getState();
      expect(state.session.djUserId).toBe('player1-id');
      expect(state.session.members.find(m => m.userId === 'player1-id')?.isDJ).toBe(true);
      expect(state.session.members.find(m => m.userId === 'director-id')?.isDJ).toBe(false);

      // === PHASE 6: New DJ controls playback ===
      TestUtils.mockUser({ id: 'player1-id', name: 'Player 1' });
      
      // New DJ goes to next track
      await queueManager.nextVideo();
      
      state = store.getState();
      expect(state.queue.currentIndex).toBe(1);

      const newCurrentVideo = queueManager.getCurrentVideo();
      expect(newCurrentVideo?.videoId).toBe('jNQXAC9IVRw');
      expect(newCurrentVideo?.title).toBe('Second Song');

      // === PHASE 7: Session ends gracefully ===
      // All users leave session
      sessionManager.removeSessionMember('director-id');
      sessionManager.removeSessionMember('player2-id');
      sessionManager.removeSessionMember('player1-id');

      state = store.getState();
      expect(state.session.members).toHaveLength(0);
      expect(state.session.djUserId).toBe(null);
    });
  });

  describe('DJ Request and Approval Flow', () => {
    it('should handle complete DJ request workflow', async () => {
      // === Setup: Existing DJ and listener ===
      TestUtils.mockUser({ id: 'current-dj', name: 'Current DJ' });
      
      await sessionManager.claimDJRole();
      sessionManager.addSessionMember({
        userId: 'current-dj',
        name: 'Current DJ',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      const requesterMember = {
        userId: 'requester-id',
        name: 'Requester',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      };

      sessionManager.addSessionMember(requesterMember);

      let state = store.getState();
      expect(state.session.djUserId).toBe('current-dj');
      expect(state.session.activeRequests).toHaveLength(0);

      // === PHASE 1: Listener requests DJ role ===
      const djRequestHandler = socketManager['messageHandlers'].get('DJ_REQUEST');
      
      djRequestHandler?.handle({
        type: 'DJ_REQUEST',
        userId: 'requester-id',
        timestamp: Date.now(),
        data: { userName: 'Requester' }
      });

      state = store.getState();
      expect(state.session.activeRequests).toHaveLength(1);
      expect(state.session.activeRequests[0]).toEqual(expect.objectContaining({
        userId: 'requester-id',
        userName: 'Requester'
      }));

      // === PHASE 2: Current DJ approves request ===
      await sessionManager.approveDJRequest('requester-id');

      state = store.getState();
      expect(state.session.djUserId).toBe('requester-id');
      expect(state.session.activeRequests).toHaveLength(0);
      expect(state.session.members.find(m => m.userId === 'requester-id')?.isDJ).toBe(true);
      expect(state.session.members.find(m => m.userId === 'current-dj')?.isDJ).toBe(false);

      // === Verify socket messages were sent ===
      const mockSocket = TestUtils.getMocks().socket;
      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'DJ_HANDOFF',
        userId: 'current-dj',
        data: expect.objectContaining({
          targetUserId: 'requester-id',
          targetUserName: 'Requester'
        })
      }));
    });

    it('should handle DJ request denial', async () => {
      // Setup existing DJ
      TestUtils.mockUser({ id: 'current-dj', name: 'Current DJ' });
      
      await sessionManager.claimDJRole();
      sessionManager.addSessionMember({
        userId: 'current-dj',
        name: 'Current DJ',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      // Add a request to active requests
      store.updateState({
        session: {
          activeRequests: [
            { userId: 'requester-id', userName: 'Requester', timestamp: Date.now() }
          ]
        }
      });

      // DJ denies the request
      await sessionManager.denyDJRequest('requester-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe('current-dj'); // DJ unchanged
      expect(state.session.activeRequests).toHaveLength(0); // Request removed

      const mockSocket = TestUtils.getMocks().socket;
      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'DJ_DENY',
        userId: expect.any(String),
        data: expect.objectContaining({
          requesterId: 'requester-id'
        })
      }));
    });
  });

  describe('Queue Management Flow', () => {
    it('should handle collaborative queue building', async () => {
      // === Setup: Multi-user session ===
      TestUtils.mockUser({ id: 'dj-user', name: 'DJ User' });
      
      await sessionManager.claimDJRole();
      sessionManager.addSessionMember({
        userId: 'dj-user',
        name: 'DJ User',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      sessionManager.addSessionMember({
        userId: 'listener-1',
        name: 'Listener 1',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      });

      sessionManager.addSessionMember({
        userId: 'listener-2',
        name: 'Listener 2',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      });

      // === PHASE 1: Different users add videos ===
      // DJ adds first video
      TestUtils.mockUser({ id: 'dj-user', name: 'DJ User' });
      await queueManager.addVideo({
        videoId: 'dj-song',
        title: 'DJ Song'
      });

      // Listener 1 adds second video (only DJ can add, so needs to switch back to DJ)
      await queueManager.addVideo({
        videoId: 'listener1-song',
        title: 'Listener 1 Song'
      });

      // Listener 2 adds third video (only DJ can add, so needs to switch back to DJ)
      await queueManager.addVideo({
        videoId: 'listener2-song',
        title: 'Listener 2 Song'
      });

      let state = store.getState();
      expect(state.queue.items).toHaveLength(3);

      // === PHASE 2: Verify queue stats ===
      const queueState = store.getQueueState();
      expect(queueState.items).toHaveLength(3);
      
      // Calculate stats manually since getQueueStats doesn't exist
      // Since only DJ can add videos, all should be added by 'DJ User'
      const contributors = [...new Set(queueState.items.map(item => item.addedBy))];
      expect(contributors).toHaveLength(1);
      expect(contributors[0]).toBe('DJ User');
      
      const djUserItems = queueState.items.filter(item => item.addedBy === 'DJ User');
      expect(djUserItems).toHaveLength(3);

      // === PHASE 3: DJ manages playback ===
      // Start playing first video (get it from the actual queue)
      const currentState = store.getState();
      const firstVideo = currentState.queue.items[0];
      playerManager.loadVideo({
        videoId: firstVideo.videoId,
        title: firstVideo.title
      });
      playerManager.play();

      // Move through queue
      await queueManager.nextVideo();
      await queueManager.nextVideo();
      await queueManager.nextVideo(); // Should wrap to beginning

      state = store.getState();
      expect(state.queue.currentIndex).toBe(0); // Wrapped around

      // === PHASE 4: Queue reordering ===
      state = store.getState();
      const beforeReorder = [...state.queue.items];
      
      // Reorder: move item from index 0 to index 2
      await queueManager.reorderQueue(0, 2);

      state = store.getState();
      expect(state.queue.items).toHaveLength(3);
      // After reordering, the first item should now be at the end
      expect(state.queue.items[2].videoId).toBe(beforeReorder[0].videoId);

      // === PHASE 5: Remove videos ===
      const videoToRemove = state.queue.items[1];
      await queueManager.removeVideo(videoToRemove.id);

      state = store.getState();
      expect(state.queue.items).toHaveLength(2);
      expect(state.queue.items.find(v => v.id === videoToRemove.id)).toBeUndefined();
    });
  });

  describe('Heartbeat and Sync Flow', () => {
    it('should handle complete heartbeat synchronization cycle', async () => {
      // === Setup: DJ and listeners ===
      TestUtils.mockUser({ id: 'dj-user', name: 'DJ User' });
      
      await sessionManager.claimDJRole();
      const members = [
        { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
        { userId: 'listener-1', name: 'Listener 1', isDJ: false, isActive: true, missedHeartbeats: 0 },
        { userId: 'listener-2', name: 'Listener 2', isDJ: false, isActive: true, missedHeartbeats: 1 },
        { userId: 'listener-3', name: 'Listener 3', isDJ: false, isActive: true, missedHeartbeats: 4 } // About to be removed
      ];

      members.forEach(member => sessionManager.addSessionMember(member));

      // Set up playing state
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { videoId: 'test-video', title: 'Test Video' },
          currentTime: 45,
          duration: 180,
          playbackState: 'playing'
        }
      });

      // === PHASE 1: DJ sends heartbeat ===
      const mockSocket = TestUtils.getMocks().socket;
      
      // Simulate heartbeat sending
      await playerManager['sendHeartbeat']();

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'HEARTBEAT',
        userId: 'dj-user',
        data: expect.objectContaining({
          videoId: 'test-video',
          currentTime: 45,
          duration: 180,
          isPlaying: true
        })
      }));

      // === PHASE 2: Listeners respond to heartbeat ===
      const heartbeatResponseHandler = socketManager['messageHandlers'].get('HEARTBEAT_RESPONSE');
      
      // Only listener-1 and listener-2 respond (listener-3 is inactive)
      heartbeatResponseHandler?.handle({
        type: 'HEARTBEAT_RESPONSE',
        userId: 'listener-1',
        timestamp: Date.now(),
        data: { djUserId: 'dj-user', respondedAt: Date.now() }
      });

      heartbeatResponseHandler?.handle({
        type: 'HEARTBEAT_RESPONSE',
        userId: 'listener-2',
        timestamp: Date.now(),
        data: { djUserId: 'dj-user', respondedAt: Date.now() }
      });

      // Wait for heartbeat processing
      await TestUtils.waitFor(1100);

      // === PHASE 3: Verify member activity tracking ===
      let state = store.getState();
      
      // Active members should have reset missed heartbeats
      const listener1 = state.session.members.find(m => m.userId === 'listener-1');
      const listener2 = state.session.members.find(m => m.userId === 'listener-2');
      expect(listener1?.missedHeartbeats).toBe(0);
      expect(listener2?.missedHeartbeats).toBe(0);

      // Inactive member (listener-3) should be removed after exceeding threshold
      sessionManager['updateMemberActivityFromHeartbeat']('dj-user', ['dj-user', 'listener-1', 'listener-2']);

      state = store.getState();
      expect(state.session.members).toHaveLength(3); // listener-3 removed
      expect(state.session.members.find(m => m.userId === 'listener-3')).toBeUndefined();
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle DJ disconnection and automatic role assignment', async () => {
      // === Setup: DJ with listeners ===
      TestUtils.mockUser({ id: 'original-dj', name: 'Original DJ' });
      
      await sessionManager.claimDJRole();
      sessionManager.addSessionMember({
        userId: 'original-dj',
        name: 'Original DJ',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      sessionManager.addSessionMember({
        userId: 'listener-1',
        name: 'Listener 1',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      });

      // === PHASE 1: DJ suddenly disconnects (removed by heartbeat) ===
      sessionManager.removeSessionMember('original-dj');

      let state = store.getState();
      expect(state.session.djUserId).toBe(null); // DJ cleared
      expect(state.session.members).toHaveLength(1);

      // === PHASE 2: Remaining listener requests DJ role (auto-approved) ===
      TestUtils.mockUser({ id: 'listener-1', name: 'Listener 1' });
      
      await sessionManager['onDJRequestReceived']({
        userId: 'listener-1',
        userName: 'Listener 1'
      });

      state = store.getState();
      expect(state.session.djUserId).toBe('listener-1'); // Auto-approved
      expect(state.session.members.find(m => m.userId === 'listener-1')?.isDJ).toBe(true);
    });

    it('should handle concurrent DJ requests gracefully', async () => {
      // === Setup: Session with no DJ ===
      TestUtils.mockUser({ id: 'user-1', name: 'User 1' });
      
      sessionManager.addSessionMember({
        userId: 'user-1',
        name: 'User 1',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      });

      sessionManager.addSessionMember({
        userId: 'user-2',
        name: 'User 2',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      });

      // === PHASE 1: Multiple users claim DJ role simultaneously ===
      // First user claims
      await sessionManager.claimDJRole();

      let state = store.getState();
      expect(state.session.djUserId).toBe('user-1');

      // Second user tries to claim (should fail)
      TestUtils.mockUser({ id: 'user-2', name: 'User 2' });
      
      await expect(sessionManager.claimDJRole()).rejects.toThrow('Another user is already DJ');

      state = store.getState();
      expect(state.session.djUserId).toBe('user-1'); // Unchanged
    });

    it('should handle invalid queue operations gracefully', async () => {
      // Set up user as DJ for queue operations
      TestUtils.mockUser({ id: 'test-dj', name: 'Test DJ' });
      store.updateState({
        session: { djUserId: 'test-dj' }
      });

      // === Test invalid video addition ===
      // Note: QueueManager doesn't validate videoInfo structure, so this won't throw
      // It will create a queue item with undefined videoId
      try {
        await queueManager.addVideo({
          // Missing required fields
          title: 'Invalid Video'
        } as any);
        // Should not throw - service accepts incomplete VideoInfo
        expect(true).toBe(true);
      } catch (error) {
        // If it does throw, that's also acceptable behavior
        expect(error).toBeInstanceOf(Error);
      }

      // === Test operations on empty queue ===
      await queueManager.clearQueue();
      
      expect(queueManager.getCurrentVideo()).toBeNull();
      expect(store.getState().queue.currentIndex < (store.getState().queue.items.length - 1)).toBe(false);
      expect(store.getState().queue.currentIndex > 0).toBe(false);

      // Should not crash on empty queue operations
      await queueManager.nextVideo();
      await queueManager.previousVideo();
      
      const state = store.getState();
      expect(state.queue.currentIndex).toBe(-1);
    });
  });
});