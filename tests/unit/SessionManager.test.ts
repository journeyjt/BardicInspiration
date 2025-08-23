/**
 * Unit tests for SessionManager - DJ roles, member management, session lifecycle
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/services/SessionManager.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import TestUtils from '../setup/test-setup.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let store: SessionStore;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    sessionManager = new SessionManager(store);
  });

  describe('DJ Role Management', () => {
    it('should allow user to claim DJ role when vacant', async () => {
      TestUtils.mockUser({ id: 'test-user-id', name: 'Test User' });
      
      await sessionManager.claimDJRole();

      const state = store.getState();
      expect(state.session.djUserId).toBe('test-user-id');
    });

    it('should prevent claiming DJ role when already claimed by another user', async () => {
      TestUtils.mockUser({ id: 'test-user-id' });
      
      // Set another user as DJ
      store.updateState({
        session: { djUserId: 'other-user-id' }
      });

      await expect(sessionManager.claimDJRole()).rejects.toThrow('Another user is already DJ');
    });

    it('should allow DJ to release their role', async () => {
      TestUtils.mockUser({ id: 'test-dj-id' });
      
      // Set user as DJ first
      store.updateState({
        session: {
          djUserId: 'test-dj-id',
          members: [
            { userId: 'test-dj-id', name: 'Test DJ', isDJ: true, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      await sessionManager.releaseDJRole();

      const state = store.getState();
      expect(state.session.djUserId).toBe(null);
      expect(state.session.members[0].isDJ).toBe(false);
    });

    it('should broadcast DJ claim message', async () => {
      TestUtils.mockUser({ id: 'test-user-id' });
      const mockSocket = TestUtils.getMocks().socket;

      await sessionManager.claimDJRole();

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'DJ_CLAIM',
        userId: 'test-user-id',
      }));
    });
  });

  describe('GM Override', () => {
    it('should allow GM to override DJ role', async () => {
      TestUtils.mockGM();
      
      // Set another user as DJ
      store.updateState({
        session: { djUserId: 'other-user-id' }
      });

      await sessionManager.gmOverrideDJRole();

      const state = store.getState();
      expect(state.session.djUserId).toBe('test-gm-id');
    });

    it('should prevent non-GM from using override', async () => {
      TestUtils.mockUser({ id: 'test-user-id', isGM: false });

      await expect(sessionManager.gmOverrideDJRole()).rejects.toThrow('Only GMs can use override');
    });
  });

  describe('DJ Handoff', () => {
    it('should allow DJ to handoff role to session member', async () => {
      TestUtils.mockUser({ id: 'current-dj-id' });
      
      const targetMember = {
        userId: 'target-user-id',
        name: 'Target User',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      };

      store.updateState({
        session: {
          djUserId: 'current-dj-id',
          members: [
            { userId: 'current-dj-id', name: 'Current DJ', isDJ: true, isActive: true, missedHeartbeats: 0 },
            targetMember
          ]
        }
      });

      await sessionManager.handoffDJRole('target-user-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe('target-user-id');
      expect(state.session.members.find(m => m.userId === 'target-user-id')?.isDJ).toBe(true);
      expect(state.session.members.find(m => m.userId === 'current-dj-id')?.isDJ).toBe(false);
    });

    it('should prevent non-DJ from handing off role', async () => {
      TestUtils.mockUser({ id: 'non-dj-user' });
      
      store.updateState({
        session: { djUserId: 'actual-dj-id' }
      });

      await expect(sessionManager.handoffDJRole('target-user')).rejects.toThrow('Only DJ can handoff role');
    });

    it('should prevent handoff to non-session member', async () => {
      TestUtils.mockUser({ id: 'current-dj-id' });
      
      store.updateState({
        session: {
          djUserId: 'current-dj-id',
          members: [
            { userId: 'current-dj-id', name: 'Current DJ', isDJ: true, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      await expect(sessionManager.handoffDJRole('non-member-id')).rejects.toThrow('Target user not in session');
    });
  });

  describe('DJ Request System', () => {
    it('should auto-approve request when no current DJ', async () => {
      TestUtils.mockUser({ id: 'listener-id' });
      
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Simulate incoming DJ request
      await sessionManager['onDJRequestReceived']({
        userId: 'requester-id',
        userName: 'Requester'
      });

      const state = store.getState();
      expect(state.session.djUserId).toBe('requester-id');
    });

    it('should add request to active requests when DJ exists', async () => {
      TestUtils.mockUser({ id: 'current-dj-id' });
      
      store.updateState({
        session: {
          djUserId: 'current-dj-id',
          activeRequests: []
        }
      });

      await sessionManager['onDJRequestReceived']({
        userId: 'requester-id',
        userName: 'Requester'
      });

      const state = store.getState();
      expect(state.session.activeRequests).toHaveLength(1);
      expect(state.session.activeRequests[0]).toEqual(expect.objectContaining({
        userId: 'requester-id',
        userName: 'Requester'
      }));
    });

    it('should approve DJ request and handoff role', async () => {
      TestUtils.mockUser({ id: 'current-dj-id' });
      
      const requester = {
        userId: 'requester-id',
        name: 'Requester',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      };

      store.updateState({
        session: {
          djUserId: 'current-dj-id',
          members: [
            { userId: 'current-dj-id', name: 'Current DJ', isDJ: true, isActive: true, missedHeartbeats: 0 },
            requester
          ],
          activeRequests: [
            { userId: 'requester-id', userName: 'Requester', timestamp: Date.now() }
          ]
        }
      });

      await sessionManager.approveDJRequest('requester-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe('requester-id');
      expect(state.session.activeRequests).toHaveLength(0);
    });

    it('should deny DJ request and remove from active requests', async () => {
      TestUtils.mockUser({ id: 'current-dj-id' });
      
      store.updateState({
        session: {
          djUserId: 'current-dj-id',
          activeRequests: [
            { userId: 'requester-id', userName: 'Requester', timestamp: Date.now() }
          ]
        }
      });

      await sessionManager.denyDJRequest('requester-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe('current-dj-id'); // DJ unchanged
      expect(state.session.activeRequests).toHaveLength(0);
    });
  });

  describe('Member Management', () => {
    it('should add new session member', () => {
      const member = {
        userId: 'new-user-id',
        name: 'New User',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0
      };

      sessionManager.addSessionMember(member);

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0]).toEqual(member);
    });

    it('should update existing session member', () => {
      const originalMember = {
        userId: 'existing-user-id',
        name: 'Original Name',
        isDJ: false,
        isActive: false,
        missedHeartbeats: 3
      };

      store.updateState({
        session: { members: [originalMember] }
      });

      const updatedMember = {
        userId: 'existing-user-id',
        name: 'Updated Name',
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      };

      sessionManager.addSessionMember(updatedMember);

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0]).toEqual(updatedMember);
    });

    it('should remove session member', () => {
      store.updateState({
        session: {
          members: [
            { userId: 'user-1', name: 'User 1', isDJ: false, isActive: true, missedHeartbeats: 0 },
            { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      sessionManager.removeSessionMember('user-1');

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0].userId).toBe('user-2');
    });

    it('should clear DJ role when removing DJ member', () => {
      store.updateState({
        session: {
          djUserId: 'dj-user-id',
          members: [
            { userId: 'dj-user-id', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      sessionManager.removeSessionMember('dj-user-id');

      const state = store.getState();
      expect(state.session.djUserId).toBe(null);
      expect(state.session.members).toHaveLength(0);
    });
  });

  describe('User Join/Leave Events', () => {
    it('should process user joined event', () => {
      const userData = { userId: 'new-user-id', userName: 'New User' };
      
      // Mock the hook listener directly
      sessionManager['onUserJoined'](userData);

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0]).toEqual(expect.objectContaining({
        userId: 'new-user-id',
        name: 'New User',
        isDJ: false,
        isActive: true
      }));
    });

    it('should ignore own user joined event', () => {
      TestUtils.mockUser({ id: 'current-user-id' });
      
      const userData = { userId: 'current-user-id', userName: 'Current User' };
      
      sessionManager['onUserJoined'](userData);

      const state = store.getState();
      expect(state.session.members).toHaveLength(0); // Should not add self
    });

    it('should process user left event', () => {
      store.updateState({
        session: {
          members: [
            { userId: 'leaving-user', name: 'Leaving User', isDJ: false, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });

      sessionManager['onUserLeft']({ userId: 'leaving-user' });

      const state = store.getState();
      expect(state.session.members).toHaveLength(0);
    });
  });
});