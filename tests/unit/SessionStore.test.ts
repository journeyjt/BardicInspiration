/**
 * Unit tests for SessionStore - centralized state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { createDefaultYoutubeDJState } from '../../src/state/StateTypes.js';
import TestUtils from '../setup/test-setup.js';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestUtils.resetMocks();
    // Reset singleton instance
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const store1 = SessionStore.getInstance();
      const store2 = SessionStore.getInstance();
      expect(store1).toBe(store2);
    });
  });

  describe('State Management', () => {
    it('should initialize with default state', () => {
      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(false);
      expect(state.session.members).toEqual([]);
      expect(state.session.djUserId).toBe(null);
      expect(state.queue.items).toEqual([]);
      expect(state.player.isReady).toBe(false);
    });

    it('should update state correctly', () => {
      const updates = {
        session: {
          hasJoinedSession: true,
          djUserId: 'test-dj-id',
        },
      };

      store.updateState(updates);
      
      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(true);
      expect(state.session.djUserId).toBe('test-dj-id');
      // Other fields should remain unchanged
      expect(state.session.members).toEqual([]);
    });

    it('should emit state change hooks', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      store.updateState({
        session: { hasJoinedSession: true }
      });

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.stateChanged', expect.objectContaining({
        changes: expect.objectContaining({
          session: expect.objectContaining({
            hasJoinedSession: true
          })
        })
      }));
    });

    it('should handle deep state updates', () => {
      const member = {
        userId: 'test-user',
        name: 'Test User',
        isDJ: false,
        isActive: true,
        missedHeartbeats: 0,
      };

      store.updateState({
        session: {
          members: [member],
        },
      });

      const state = store.getState();
      expect(state.session.members).toHaveLength(1);
      expect(state.session.members[0]).toEqual(member);
    });
  });

  describe('DJ Management', () => {
    it('should correctly identify DJ users', () => {
      TestUtils.mockUser({ id: 'test-dj-id' });
      
      store.updateState({
        session: { djUserId: 'test-dj-id' }
      });

      expect(store.isDJ()).toBe(true);
      expect(store.isDJ('test-dj-id')).toBe(true);
      expect(store.isDJ('other-user')).toBe(false);
    });

    it('should handle null DJ correctly', () => {
      TestUtils.mockUser({ id: 'test-user-id' });
      
      store.updateState({
        session: { djUserId: null }
      });

      expect(store.isDJ()).toBe(false);
    });
  });

  describe('Session Activity', () => {
    it('should determine session activity correctly', () => {
      expect(store.isSessionActive()).toBe(false);

      store.updateState({
        session: {
          hasJoinedSession: true,
          members: [TestUtils.createTestSessionState().members[0]]
        }
      });

      expect(store.isSessionActive()).toBe(true);
    });
  });

  describe('State Recovery', () => {
    it('should reset session state when user not in persistent members', async () => {
      TestUtils.mockUser({ id: 'removed-user-id' });
      
      // Mock world settings with different user in members list
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [{ userId: 'other-user', name: 'Other User' }];
        }
        if (key === 'youtubeDJ.currentDJ') {
          return 'other-user';
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: null };
        }
        return null;
      });

      // Set initial state as if user was in session
      store.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });

      // Load from world should reset the user's session state
      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(false);
      expect(state.session.isConnected).toBe(false);
      expect(state.session.connectionStatus).toBe('disconnected');
    });

    it('should preserve session state when user is in persistent members', async () => {
      TestUtils.mockUser({ id: 'existing-user-id' });
      
      // Mock world settings with user in members list
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [{ userId: 'existing-user-id', name: 'Existing User' }];
        }
        if (key === 'youtubeDJ.currentDJ') {
          return null;
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: null };
        }
        return null;
      });

      // Set initial state as if user was in session
      store.updateState({
        session: { hasJoinedSession: true, isConnected: true }
      });

      // Load from world should preserve the user's session state
      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(true);
      expect(state.session.isConnected).toBe(true);
    });
  });

  describe('Member Cleanup', () => {
    it('should remove duplicate members', async () => {
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [
            { userId: 'user-1', name: 'User 1' },
            { userId: 'user-1', name: 'User 1 Duplicate' }, // Duplicate
            { userId: 'user-2', name: 'User 2' },
          ];
        }
        if (key === 'youtubeDJ.currentDJ') {
          return 'user-1';
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'user-1' };
        }
        return null;
      });

      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.members).toHaveLength(2);
      expect(state.session.members.map(m => m.userId)).toEqual(['user-1', 'user-2']);
    });

    it('should clear DJ role if DJ user not in members', async () => {
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.sessionMembers') {
          return [{ userId: 'user-1', name: 'User 1' }]; // DJ not in list
        }
        if (key === 'youtubeDJ.currentDJ') {
          return 'missing-dj-user'; // DJ user missing from members
        }
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'missing-dj-user' };
        }
        return null;
      });

      await store.loadFromWorld();

      const state = store.getState();
      expect(state.session.djUserId).toBe(null);
      expect(state.session.members.every(m => !m.isDJ)).toBe(true);
    });
  });

  describe('Group Mode', () => {
    beforeEach(() => {
      // Reset hooks
      vi.clearAllMocks();
    });

    it('should update queue mode when Group Mode is enabled', () => {
      // Mock Group Mode hook call
      const groupModeHandler = vi.fn();
      
      // Re-initialize to register hooks
      (SessionStore as any).instance = null;
      store = SessionStore.getInstance();
      
      // Capture the hook handler during initialization
      const mockHooks = TestUtils.getMocks().Hooks;
      store.initialize();
      
      // Find the groupModeChanged hook handler
      const hookCall = mockHooks.on.mock.calls.find(call => call[0] === 'youtubeDJ.groupModeChanged');
      expect(hookCall).toBeDefined();
      
      const handler = hookCall![1];
      
      // Call the handler with enabled = true
      handler({ enabled: true });
      
      const state = store.getState();
      expect(state.queue.mode).toBe('collaborative');
    });

    it('should update queue mode when Group Mode is disabled', () => {
      // Re-initialize to register hooks
      (SessionStore as any).instance = null;
      store = SessionStore.getInstance();
      
      // Capture the hook handler during initialization
      const mockHooks = TestUtils.getMocks().Hooks;
      store.initialize();
      
      // Find the groupModeChanged hook handler
      const hookCall = mockHooks.on.mock.calls.find(call => call[0] === 'youtubeDJ.groupModeChanged');
      const handler = hookCall![1];
      
      // Set initial state to collaborative
      store.updateState({
        queue: { mode: 'collaborative' }
      });
      
      // Call the handler with enabled = false
      handler({ enabled: false });
      
      const state = store.getState();
      expect(state.queue.mode).toBe('single-dj');
    });

    it('should load queue mode based on Group Mode setting', async () => {
      const mockSettings = TestUtils.getMocks().settings;
      mockSettings.get.mockImplementation((scope: string, key: string) => {
        if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
        if (key === 'youtubeDJ.sessionMembers') return [];
        if (key === 'youtubeDJ.currentDJ') return null;
        if (key === 'youtubeDJ.queueState') {
          return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: null };
        }
        return null;
      });

      await store.loadFromWorld();

      const state = store.getState();
      expect(state.queue.mode).toBe('collaborative');
    });

    it('should preserve other queue state when updating mode', () => {
      const queueItems = [
        { id: 'v1', videoId: 'video-1', title: 'Video 1', addedBy: 'user-1', addedAt: Date.now() }
      ];
      
      // Re-initialize to register hooks (following pattern of other tests)
      (SessionStore as any).instance = null;
      store = SessionStore.getInstance();
      
      const mockHooks = TestUtils.getMocks().Hooks;
      store.initialize();
      
      // Set queue state after initialization
      store.updateState({
        queue: {
          items: queueItems,
          currentIndex: 0,
          mode: 'single-dj'
        }
      });
      
      // Find the groupModeChanged hook handler
      const hookCall = mockHooks.on.mock.calls.find(call => call[0] === 'youtubeDJ.groupModeChanged');
      expect(hookCall).toBeDefined();
      const handler = hookCall![1];
      
      // Call the handler to simulate Group Mode being enabled
      handler({ enabled: true });
      
      const state = store.getState();
      expect(state.queue.mode).toBe('collaborative');
      expect(state.queue.items).toEqual(queueItems);
      expect(state.queue.currentIndex).toBe(0);
    });

    it('should emit state change when Group Mode changes', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Re-initialize to register hooks
      (SessionStore as any).instance = null;
      store = SessionStore.getInstance();
      store.initialize();
      
      // Find and call the groupModeChanged hook handler
      const hookCall = mockHooks.on.mock.calls.find(call => call[0] === 'youtubeDJ.groupModeChanged');
      const handler = hookCall![1];
      
      // Clear previous calls
      mockHooks.callAll.mockClear();
      
      handler({ enabled: true });
      
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.stateChanged', expect.objectContaining({
        changes: expect.objectContaining({
          queue: expect.objectContaining({
            mode: 'collaborative'
          })
        })
      }));
    });
  });
});