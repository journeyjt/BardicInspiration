/**
 * Integration tests for multi-user session scenarios
 * Tests the interaction between SessionStore, SessionManager, and SocketManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Multi-User Session Integration', () => {
  let store: SessionStore;
  let sessionManager: SessionManager;
  let socketManager: SocketManager;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    sessionManager = new SessionManager(store);
    socketManager = new SocketManager(store);
    socketManager.initialize();
  });

  describe('Session Join Flow', () => {
    it('should handle multiple users joining session', async () => {
      // User 1 joins as Director (becomes DJ)
      TestUtils.mockUser({ id: 'director-id', name: 'Director' });
      
      await sessionManager.claimDJRole();
      sessionManager.addSessionMember({
        userId: 'director-id',
        name: 'Director',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      // User 2 joins as Player
      const player1JoinMessage = {
        type: 'USER_JOIN',
        userId: 'player1-id',
        timestamp: Date.now(),
        data: { userName: 'Player 1', userId: 'player1-id' }
      };

      // Simulate receiving USER_JOIN message
      const handler = socketManager['messageHandlers'].get('USER_JOIN');
      handler?.handle(player1JoinMessage);

      // User 3 joins as another Player
      const player2JoinMessage = {
        type: 'USER_JOIN',
        userId: 'player2-id',
        timestamp: Date.now(),
        data: { userName: 'Player 2', userId: 'player2-id' }
      };

      handler?.handle(player2JoinMessage);

      // Verify final state
      const state = store.getState();
      expect(state.session.members).toHaveLength(3);
      expect(state.session.djUserId).toBe('director-id');
      
      const memberIds = state.session.members.map(m => m.userId);
      expect(memberIds).toContain('director-id');
      expect(memberIds).toContain('player1-id');
      expect(memberIds).toContain('player2-id');
    });

    it('should handle DJ handoff between users', async () => {
      // Setup initial state with Director as DJ and Player1 as member
      store.updateState({
        session: {
          djUserId: 'director-id',
          members: [
            { userId: 'director-id', name: 'Director', isDJ: true, isActive: true, missedHeartbeats: 0 },
            { userId: 'player1-id', name: 'Player 1', isDJ: false, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      TestUtils.mockUser({ id: 'director-id', name: 'Director' });

      // Director hands off to Player1
      await sessionManager.handoffDJRole('player1-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe('player1-id');
      expect(state.session.members.find(m => m.userId === 'player1-id')?.isDJ).toBe(true);
      expect(state.session.members.find(m => m.userId === 'director-id')?.isDJ).toBe(false);
    });
  });

  describe('Session Recovery Scenarios', () => {
    it('should handle user reconnection after cleanup', async () => {
      // User was previously in session but got cleaned up
      TestUtils.mockUser({ id: 'reconnecting-user', name: 'Reconnecting User' });
      
      // Mock world settings showing user was removed from persistent state
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [
            { userId: 'active-user', name: 'Active User' }
          ]; // Reconnecting user not in list
        }
        if (key === 'youtubeDJ.currentDJ') {
          return 'active-user';
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'active-user' };
        }
        return null;
      });

      // Set user as if they think they're still in session
      store.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });

      // Load from world should reset their session state
      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(false);
      expect(state.session.isConnected).toBe(false);
      
      // User should now need to rejoin
      expect(state.session.members.some(m => m.userId === 'reconnecting-user')).toBe(false);
    });

    it('should preserve session state for users still in persistent state', async () => {
      TestUtils.mockUser({ id: 'persistent-user', name: 'Persistent User' });
      
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [
            { userId: 'persistent-user', name: 'Persistent User' }
          ]; // User is in persistent state
        }
        if (key === 'youtubeDJ.currentDJ') {
          return null;
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: null };
        }
        return null;
      });

      // Set user as if they're in session
      store.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });

      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(true);
      expect(state.session.isConnected).toBe(true);
      expect(state.session.members.some(m => m.userId === 'persistent-user')).toBe(true);
    });
  });

  describe('Heartbeat and Cleanup', () => {
    it('should process heartbeat responses and track activity', async () => {
      // Setup session with DJ and listeners
      store.updateState({
        session: {
          djUserId: 'dj-user',
          members: [
            { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
            { userId: 'listener-1', name: 'Listener 1', isDJ: false, isActive: true, missedHeartbeats: 2 },
            { userId: 'listener-2', name: 'Listener 2', isDJ: false, isActive: true, missedHeartbeats: 4 }
          ]
        }
      });

      TestUtils.mockUser({ id: 'dj-user' }); // Mock as DJ for collecting responses

      // Simulate heartbeat responses
      const heartbeatHandler = socketManager['messageHandlers'].get('HEARTBEAT_RESPONSE');
      
      // Only listener-1 responds (listener-2 misses this heartbeat)
      await heartbeatHandler?.handle({
        type: 'HEARTBEAT_RESPONSE',
        userId: 'listener-1',
        timestamp: Date.now(),
        data: { djUserId: 'dj-user', respondedAt: Date.now() }
      });

      // Wait for heartbeat processing timeout
      await TestUtils.waitFor(1100);

      // Check that listener-2 missed heartbeat count increased and listener-1 reset
      const mockHooks = TestUtils.getMocks().Hooks;
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.heartbeatProcessed', expect.objectContaining({
        djUserId: 'dj-user',
        respondingUsers: expect.arrayContaining(['listener-1', 'dj-user'])
      }));
    });

    it('should remove inactive members via heartbeat cleanup', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Setup session with members having different activity levels
      store.updateState({
        session: {
          members: [
            { userId: 'active-user', name: 'Active User', isDJ: false, isActive: true, missedHeartbeats: 2 },
            { userId: 'inactive-user', name: 'Inactive User', isDJ: false, isActive: true, missedHeartbeats: 5, lastActivity: Date.now() - 60000 }, // Old activity
          ]
        }
      });

      // Simulate heartbeat processing that removes inactive users
      sessionManager['updateMemberActivityFromHeartbeat']('dj-user', ['active-user']);

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0].userId).toBe('active-user');
      expect(state.session.members[0].missedHeartbeats).toBe(0); // Reset for responding user
    });

    it('should handle grace period for new members', () => {
      const recentTime = Date.now();
      
      store.updateState({
        session: {
          members: [
            { 
              userId: 'new-user', 
              name: 'New User', 
              isDJ: false, 
              isActive: true, 
              missedHeartbeats: 5, // Normally would be removed
              lastActivity: recentTime // But just joined
            }
          ]
        }
      });

      // Should not remove new user despite missed heartbeats
      sessionManager['updateMemberActivityFromHeartbeat']('dj-user', []); // No responses

      const state = store.getState();
      expect(state.session.members).toHaveLength(1); // New user preserved
      expect(state.session.members[0].userId).toBe('new-user');
    });
  });

  describe('Socket Message Flow', () => {
    it('should handle complete DJ claim message flow', async () => {
      const mockSocket = TestUtils.getMocks().socket;
      
      // User claims DJ role
      TestUtils.mockUser({ id: 'claiming-user', name: 'Claiming User' });
      await sessionManager.claimDJRole();

      // Verify socket message was sent
      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'DJ_CLAIM',
        userId: 'claiming-user'
      }));

      // Simulate another user receiving the message
      TestUtils.mockUser({ id: 'other-user' });
      
      const djClaimHandler = socketManager['messageHandlers'].get('DJ_CLAIM');
      await djClaimHandler?.handle({
        type: 'DJ_CLAIM',
        userId: 'claiming-user',
        timestamp: Date.now(),
        data: { userName: 'Claiming User' }
      });

      // Other user's state should be updated
      const state = store.getState();
      expect(state.session.djUserId).toBe('claiming-user');
    });

    it('should handle state synchronization between users', async () => {
      // User A has different state
      TestUtils.mockUser({ id: 'user-a' });
      store.updateState({
        session: { hasJoinedSession: true },
        queue: { items: [], currentIndex: -1, mode: 'single-dj', djUserId: null }
      });

      // User B requests state
      const stateRequestHandler = socketManager['messageHandlers'].get('STATE_REQUEST');
      await stateRequestHandler?.handle({
        type: 'STATE_REQUEST',
        userId: 'user-b',
        timestamp: Date.now()
      });

      // Verify state response was sent
      const mockSocket = TestUtils.getMocks().socket;
      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'STATE_RESPONSE',
        userId: 'user-a',
        data: expect.objectContaining({
          session: expect.objectContaining({
            hasJoinedSession: true
          })
        })
      }));
    });
  });
});