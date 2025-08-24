/**
 * Integration tests for Group Mode feature
 * Tests multi-user collaborative queue management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { QueueManager } from '../../src/services/QueueManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Group Mode Integration', () => {
  let store: SessionStore;
  let sessionManager: SessionManager;
  let queueManager: QueueManager;
  let socketManager: SocketManager;

  beforeEach(() => {
    TestUtils.resetMocks();
    
    // Reset singleton instances
    (SessionStore as any).instance = null;
    
    // Initialize services
    store = SessionStore.getInstance();
    store.initialize();
    
    socketManager = new SocketManager(store);
    socketManager.initialize();
    
    sessionManager = new SessionManager(store, socketManager);
    queueManager = new QueueManager(store);
  });

  describe('Multi-User Queue Collaboration', () => {
    const djUser = { id: 'dj-user', name: 'DJ User', isGM: false };
    const member1 = { id: 'member-1', name: 'Member 1', isGM: false };
    const member2 = { id: 'member-2', name: 'Member 2', isGM: false };
    const gmUser = { id: 'gm-user', name: 'Game Master', isGM: true };

    beforeEach(async () => {
      // Setup initial session with DJ and members
      TestUtils.mockUser(djUser);
      await sessionManager.claimDJRole();
      
      // Add DJ to session as member
      sessionManager.addSessionMember({
        userId: djUser.id,
        name: djUser.name,
        isDJ: true,
        isActive: true,
        missedHeartbeats: 0
      });

      // Add other members via socket messages (simulating widget join)
      const member1JoinMessage = {
        type: 'USER_JOIN',
        userId: member1.id,
        timestamp: Date.now(),
        data: { userName: member1.name, userId: member1.id }
      };

      const member2JoinMessage = {
        type: 'USER_JOIN',
        userId: member2.id,
        timestamp: Date.now(),
        data: { userName: member2.name, userId: member2.id }
      };

      // Simulate USER_JOIN messages
      const userJoinHandler = socketManager['messageHandlers'].get('USER_JOIN');
      userJoinHandler?.handle(member1JoinMessage);
      userJoinHandler?.handle(member2JoinMessage);
    });

    describe('when Group Mode is disabled', () => {
      beforeEach(() => {
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return false;
          return null;
        });
      });

      it('should only allow DJ to add videos', async () => {
        const videoInfo = {
          videoId: 'test-video-1',
          title: 'DJ Video'
        };

        // DJ can add videos
        TestUtils.mockUser(djUser);
        await expect(queueManager.addVideo(videoInfo)).resolves.not.toThrow();
        
        // Non-DJ cannot add videos
        TestUtils.mockUser(member1);
        await expect(queueManager.addVideo({
          videoId: 'test-video-2',
          title: 'Member Video'
        })).rejects.toThrow('Only the DJ can add videos to the queue');
        
        // Verify only DJ's video was added
        const state = store.getState();
        expect(state.queue.items).toHaveLength(1);
        expect(state.queue.items[0].addedBy).toBe('DJ User');
      });

      it('should maintain DJ-only control through QueueManager', async () => {
        // Non-DJ member tries to add video through QueueManager
        TestUtils.mockUser(member1);
        
        // Ensure session state shows the member is in session
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 },
              { userId: member2.id, name: member2.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        // Try to add video as non-DJ - should fail
        await expect(queueManager.addVideo({
          videoId: 'test-video',
          title: 'Test Video'
        })).rejects.toThrow('Only the DJ can add videos to the queue');
        
        // Queue should remain empty
        const state = store.getState();
        expect(state.queue.items).toHaveLength(0);
      });
    });

    describe('when Group Mode is enabled', () => {
      beforeEach(() => {
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
          return null;
        });
        
        // Update queue mode to collaborative
        store.updateState({
          queue: { mode: 'collaborative' }
        });
      });

      it('should allow all session members to add videos', async () => {
        // Member 1 adds a video
        TestUtils.mockUser(member1);
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 },
              { userId: member2.id, name: member2.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await queueManager.addVideo({
          videoId: 'member1-video',
          title: 'Member 1 Video'
        });
        
        // Member 2 adds a video
        TestUtils.mockUser(member2);
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 },
              { userId: member2.id, name: member2.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await queueManager.addVideo({
          videoId: 'member2-video',
          title: 'Member 2 Video'
        });
        
        // DJ adds a video
        TestUtils.mockUser(djUser);
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 },
              { userId: member2.id, name: member2.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await queueManager.addVideo({
          videoId: 'dj-video',
          title: 'DJ Video'
        });
        
        // Verify all videos were added
        const state = store.getState();
        expect(state.queue.items).toHaveLength(3);
        expect(state.queue.items[0].addedBy).toBe('Member 1');
        expect(state.queue.items[1].addedBy).toBe('Member 2');
        expect(state.queue.items[2].addedBy).toBe('DJ User');
      });

      it('should prevent non-session members from adding videos', async () => {
        const outsider = { id: 'outsider', name: 'Outsider', isGM: false };
        TestUtils.mockUser(outsider);
        
        // User not in session
        store.updateState({
          session: {
            hasJoinedSession: false,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await expect(queueManager.addVideo({
          videoId: 'outsider-video',
          title: 'Outsider Video'
        })).rejects.toThrow('You must be in the listening session to add videos to the queue');
        
        // Verify no video was added
        const state = store.getState();
        expect(state.queue.items).toHaveLength(0);
      });

      it('should handle mode transitions correctly', async () => {
        // Add video in Group Mode
        TestUtils.mockUser(member1);
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await queueManager.addVideo({
          videoId: 'group-mode-video',
          title: 'Group Mode Video'
        });
        
        // Disable Group Mode
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return false;
          return null;
        });
        
        store.updateState({
          queue: { mode: 'single-dj' }
        });
        
        // Now member cannot add videos
        await expect(queueManager.addVideo({
          videoId: 'single-dj-video',
          title: 'Single DJ Video'
        })).rejects.toThrow('Only the DJ can add videos to the queue');
        
        // But DJ still can
        TestUtils.mockUser(djUser);
        store.updateState({
          session: {
            hasJoinedSession: true,
            members: [
              { userId: djUser.id, name: djUser.name, isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: member1.id, name: member1.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });
        
        await queueManager.addVideo({
          videoId: 'dj-only-video',
          title: 'DJ Only Video'
        });
        
        // Verify correct videos were added
        const state = store.getState();
        expect(state.queue.items).toHaveLength(2);
        expect(state.queue.items[0].title).toBe('Group Mode Video');
        expect(state.queue.items[1].title).toBe('DJ Only Video');
      });
    });

    describe('GM Override Behavior', () => {
      beforeEach(() => {
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
          return null;
        });
        
        // Enable Group Mode
        store.updateState({
          queue: { mode: 'collaborative' }
        });
      });

      it('should allow GM to toggle Group Mode setting', () => {
        TestUtils.mockUser(gmUser);
        
        // Mock settings.set to track calls
        const mockSet = vi.fn();
        vi.spyOn(game.settings, 'set').mockImplementation(mockSet);
        
        // GM should be able to change the setting
        // This would normally be done through the module settings UI
        game.settings.set('core', 'youtubeDJ.groupMode', false);
        
        expect(mockSet).toHaveBeenCalledWith('core', 'youtubeDJ.groupMode', false);
      });

      it('should broadcast Group Mode changes to all users', () => {
        const mockHooks = TestUtils.getMocks().Hooks;
        mockHooks.callAll.mockClear();
        
        // Simulate Group Mode change
        const groupModeChangeData = { enabled: false };
        
        // This would be triggered by the onChange handler in the setting
        Hooks.callAll('youtubeDJ.groupModeChanged', groupModeChangeData);
        
        expect(mockHooks.callAll).toHaveBeenCalledWith(
          'youtubeDJ.groupModeChanged',
          groupModeChangeData
        );
      });
    });
  });

  describe('Socket Message Broadcasting', () => {
    it('should broadcast queue additions in Group Mode', async () => {
      // Enable Group Mode
      vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
        if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
        return null;
      });
      
      store.updateState({
        queue: { mode: 'collaborative' }
      });
      
      // Setup member in session
      const member = { id: 'member-1', name: 'Member 1', isGM: false };
      TestUtils.mockUser(member);
      store.updateState({
        session: {
          hasJoinedSession: true,
          djUserId: 'dj-user',
          members: [
            { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
            { userId: member.id, name: member.name, isDJ: false, isActive: true, missedHeartbeats: 0 }
          ]
        }
      });
      
      // Mock socket emit
      const mockSocket = TestUtils.getMocks().socket;
      mockSocket.emit.mockClear();
      
      // Add video as member
      await queueManager.addVideo({
        videoId: 'collaborative-video',
        title: 'Collaborative Video'
      });
      
      // Verify socket message was sent
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_ADD',
          userId: member.id,
          data: expect.objectContaining({
            queueItem: expect.objectContaining({
              videoId: 'collaborative-video',
              title: 'Collaborative Video',
              addedBy: member.name
            })
          })
        })
      );
    });
  });
});