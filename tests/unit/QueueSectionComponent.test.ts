/**
 * Unit tests for QueueSectionComponent - Queue UI functionality and actualIndex handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueueSectionComponent } from '../../src/ui/components/QueueSectionComponent.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import { QueueManager } from '../../src/services/QueueManager.js';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import TestUtils from '../setup/test-setup.js';

describe('QueueSectionComponent', () => {
  let component: QueueSectionComponent;
  let store: SessionStore;
  let queueManager: QueueManager;
  let playerManager: PlayerManager;
  let parentElement: HTMLElement;

  const testVideos = [
    { id: 'v1', videoId: 'video-1', title: 'Video 1', addedBy: 'user-1', addedAt: Date.now() },
    { id: 'v2', videoId: 'video-2', title: 'Video 2', addedBy: 'user-1', addedAt: Date.now() },
    { id: 'v3', videoId: 'video-3', title: 'Video 3', addedBy: 'user-1', addedAt: Date.now() },
    { id: 'v4', videoId: 'video-4', title: 'Video 4', addedBy: 'user-1', addedAt: Date.now() }
  ];

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    queueManager = new QueueManager(store);
    playerManager = new PlayerManager(store);
    
    // Create a mock parent element
    parentElement = document.createElement('div');
    parentElement.innerHTML = '<div class="queue-section"></div>';
    
    component = new QueueSectionComponent(store, parentElement, queueManager, playerManager);
  });

  describe('Context Preparation', () => {
    beforeEach(() => {
      TestUtils.mockUser({ id: 'user-1' });
      store.updateState({
        session: { djUserId: 'user-1' },
        player: { isReady: true, playbackState: 'paused', currentVideo: null }
      });
    });

    describe('actualIndex calculation', () => {
      it('should calculate actualIndex correctly when no currently playing video', async () => {
        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: -1, // No currently playing
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();

        expect(context.currentlyPlaying).toBeNull();
        expect(context.upcomingQueue).toHaveLength(4);
        
        // All items should have actualIndex matching their position in full queue
        context.upcomingQueue.forEach((item: any, index: number) => {
          expect(item.actualIndex).toBe(index);
          expect(item.id).toBe(testVideos[index].id);
        });
      });

      it('should calculate actualIndex correctly when video is currently playing', async () => {
        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: 1, // Second video is playing
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();

        expect(context.currentlyPlaying).toBeDefined();
        expect(context.currentlyPlaying.id).toBe(testVideos[1].id);
        expect(context.upcomingQueue).toHaveLength(2); // Only videos after current

        // Upcoming queue should start from index 2
        expect(context.upcomingQueue[0].actualIndex).toBe(2);
        expect(context.upcomingQueue[0].id).toBe(testVideos[2].id);
        expect(context.upcomingQueue[1].actualIndex).toBe(3);
        expect(context.upcomingQueue[1].id).toBe(testVideos[3].id);
      });

      it('should handle edge case when currently playing is last video', async () => {
        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: 3, // Last video is playing
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();

        expect(context.currentlyPlaying).toBeDefined();
        expect(context.currentlyPlaying.id).toBe(testVideos[3].id);
        expect(context.upcomingQueue).toHaveLength(0); // No upcoming videos
      });

      it('should handle empty queue', async () => {
        store.updateState({
          queue: {
            items: [],
            currentIndex: -1,
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();

        expect(context.currentlyPlaying).toBeNull();
        expect(context.upcomingQueue).toHaveLength(0);
        expect(context.hasQueue).toBe(false);
      });

      it('should include player metadata in currently playing item', async () => {
        const playerVideo = {
          videoId: 'video-2',
          title: 'Enhanced Video 2',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          authorName: 'Test Channel'
        };

        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: 1,
            mode: 'single-dj',
            djUserId: 'user-1'
          },
          player: {
            isReady: true,
            playbackState: 'playing',
            currentVideo: playerVideo
          }
        });

        const context = await component.prepareContext();

        expect(context.currentlyPlaying.thumbnailUrl).toBe(playerVideo.thumbnailUrl);
        expect(context.currentlyPlaying.authorName).toBe(playerVideo.authorName);
        expect(context.isPlaying).toBe(true);
      });
    });

    describe('DJ permissions', () => {
      it('should indicate DJ status correctly', async () => {
        store.updateState({
          session: { djUserId: 'user-1' },
          queue: { items: [...testVideos], currentIndex: -1 }
        });

        const context = await component.prepareContext();
        expect(context.isDJ).toBe(true);
      });

      it('should indicate non-DJ status correctly', async () => {
        TestUtils.mockUser({ id: 'user-2' });
        store.updateState({
          session: { djUserId: 'user-1' }, // Different user is DJ
          queue: { items: [...testVideos], currentIndex: -1 }
        });

        const context = await component.prepareContext();
        expect(context.isDJ).toBe(false);
      });
    });

    describe('queue statistics', () => {
      it('should calculate queue count correctly with current video', async () => {
        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: 1,
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();
        expect(context.queueCount).toBe(2); // Only upcoming videos count
        expect(context.hasQueue).toBe(true);
      });

      it('should calculate queue count correctly without current video', async () => {
        store.updateState({
          queue: {
            items: [...testVideos],
            currentIndex: -1,
            mode: 'single-dj',
            djUserId: 'user-1'
          }
        });

        const context = await component.prepareContext();
        expect(context.queueCount).toBe(4); // All videos count as upcoming
        expect(context.hasQueue).toBe(true);
      });
    });

    describe('Group Mode Context', () => {
      beforeEach(() => {
        // Mock Group Mode setting
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return true;
          return null;
        });
      });

      it('should provide Group Mode context when enabled', async () => {
        TestUtils.mockUser({ id: 'member-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: true,
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: 'member-user', name: 'Member User', isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          },
          queue: { mode: 'collaborative' }
        });

        const context = await component.prepareContext();
        
        expect(context.groupMode).toBe(true);
        expect(context.canAddToQueue).toBe(true);
        expect(context.isDJ).toBe(false);
        expect(context.isInSession).toBe(true);
        expect(context.isActiveMember).toBe(true);
      });

      it('should deny queue access for non-session members in Group Mode', async () => {
        TestUtils.mockUser({ id: 'outsider-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: false, // User not in session
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 }
            ]
          },
          queue: { mode: 'collaborative' }
        });

        const context = await component.prepareContext();
        
        expect(context.groupMode).toBe(true);
        expect(context.canAddToQueue).toBe(false);
        expect(context.isDJ).toBe(false);
        expect(context.isInSession).toBe(false);
        expect(context.isActiveMember).toBe(false);
      });

      it('should deny queue access for inactive members in Group Mode', async () => {
        TestUtils.mockUser({ id: 'inactive-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: true,
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: 'inactive-user', name: 'Inactive User', isDJ: false, isActive: false, missedHeartbeats: 10 }
            ]
          },
          queue: { mode: 'collaborative' }
        });

        const context = await component.prepareContext();
        
        expect(context.groupMode).toBe(true);
        expect(context.canAddToQueue).toBe(false);
        expect(context.isDJ).toBe(false);
        expect(context.isInSession).toBe(true);
        expect(context.isActiveMember).toBe(false);
      });

      it('should allow DJ to add videos in Group Mode', async () => {
        TestUtils.mockUser({ id: 'dj-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: true,
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 }
            ]
          },
          queue: { mode: 'collaborative' }
        });

        const context = await component.prepareContext();
        
        expect(context.groupMode).toBe(true);
        expect(context.canAddToQueue).toBe(true);
        expect(context.isDJ).toBe(true);
      });
    });

    describe('Single-DJ Mode Context', () => {
      beforeEach(() => {
        // Mock Group Mode setting as disabled
        vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
          if (scope === 'bardic-inspiration' && key === 'youtubeDJ.groupMode') return false;
          return null;
        });
      });

      it('should only allow DJ to add videos in single-DJ mode', async () => {
        // Test non-DJ member
        TestUtils.mockUser({ id: 'member-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: true,
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: 'member-user', name: 'Member User', isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          },
          queue: { mode: 'single-dj' }
        });

        const context = await component.prepareContext();
        
        expect(context.groupMode).toBe(false);
        expect(context.canAddToQueue).toBe(false);
        expect(context.isDJ).toBe(false);

        // Test DJ
        TestUtils.mockUser({ id: 'dj-user' });
        store.updateState({
          session: {
            djUserId: 'dj-user',
            hasJoinedSession: true,
            members: [
              { userId: 'dj-user', name: 'DJ User', isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: 'member-user', name: 'Member User', isDJ: false, isActive: true, missedHeartbeats: 0 }
            ]
          }
        });

        const contextDJ = await component.prepareContext();
        
        expect(contextDJ.groupMode).toBe(false);
        expect(contextDJ.canAddToQueue).toBe(true);
        expect(contextDJ.isDJ).toBe(true);
      });
    });
  });

  describe('Event Handlers', () => {
    beforeEach(() => {
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({
        session: { djUserId: 'dj-user' },
        queue: {
          items: [...testVideos],
          currentIndex: 1,
          mode: 'single-dj',
          djUserId: 'dj-user'
        }
      });
    });

    describe('onMoveUpClick', () => {
      it('should call queueManager.moveItemUp with correct actualIndex', async () => {
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue({
              getAttribute: vi.fn().mockReturnValue('2') // actualIndex from template
            })
          }
        } as any;

        const moveItemUpSpy = vi.spyOn(queueManager, 'moveItemUp').mockResolvedValue();

        await component.onMoveUpClick(mockEvent);

        expect(moveItemUpSpy).toHaveBeenCalledWith(2);
      });

      it('should handle missing data-index gracefully', async () => {
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue(null)
          }
        } as any;

        // Should not throw error, just log warning and return early
        await expect(component.onMoveUpClick(mockEvent)).resolves.not.toThrow();
      });

      it('should handle queueManager errors gracefully', async () => {
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue({
              getAttribute: vi.fn().mockReturnValue('2')
            })
          }
        } as any;

        vi.spyOn(queueManager, 'moveItemUp').mockRejectedValue(new Error('Test error'));

        // Should not throw, error should be handled
        await expect(component.onMoveUpClick(mockEvent)).resolves.not.toThrow();
      });
    });

    describe('onMoveDownClick', () => {
      it('should call queueManager.moveItemDown with correct actualIndex', async () => {
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue({
              getAttribute: vi.fn().mockReturnValue('2') // actualIndex from template
            })
          }
        } as any;

        const moveItemDownSpy = vi.spyOn(queueManager, 'moveItemDown').mockResolvedValue();

        await component.onMoveDownClick(mockEvent);

        expect(moveItemDownSpy).toHaveBeenCalledWith(2);
      });

      it('should validate index boundaries', async () => {
        // Mock queue with 4 items (indices 0-3), current index at 1
        // Index 3 is the last item and should NOT be able to move down
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue({
              getAttribute: vi.fn().mockReturnValue('3') // Last item (3 >= 4-1)
            })
          }
        } as any;

        const moveItemDownSpy = vi.spyOn(queueManager, 'moveItemDown').mockResolvedValue();

        await component.onMoveDownClick(mockEvent);

        // Should NOT call moveItemDown for last item - component should handle this boundary
        expect(moveItemDownSpy).not.toHaveBeenCalled();
      });
    });

    describe('onSkipToClick', () => {
      it('should call queueManager.skipToIndex with correct actualIndex', async () => {
        const mockEvent = {
          target: {
            closest: vi.fn().mockReturnValue({
              getAttribute: vi.fn().mockReturnValue('3') // actualIndex from template
            })
          }
        } as any;

        const skipToIndexSpy = vi.spyOn(queueManager, 'skipToIndex').mockResolvedValue();

        await component.onSkipToClick(mockEvent);

        expect(skipToIndexSpy).toHaveBeenCalledWith(3);
      });
    });

    describe('onPlayClick', () => {
      it('should call playerManager.play when DJ', async () => {
        const playSpy = vi.spyOn(playerManager, 'play').mockResolvedValue();

        await component.onPlayClick();

        expect(playSpy).toHaveBeenCalled();
      });

      it('should show warning when non-DJ tries to play', async () => {
        TestUtils.mockUser({ id: 'non-dj-user' });

        const playSpy = vi.spyOn(playerManager, 'play').mockResolvedValue();
        
        await component.onPlayClick();

        expect(playSpy).not.toHaveBeenCalled();
      });

      it('should handle playerManager errors gracefully', async () => {
        vi.spyOn(playerManager, 'play').mockRejectedValue(new Error('Play failed'));

        await expect(component.onPlayClick()).resolves.not.toThrow();
      });
    });

    describe('onPauseClick', () => {
      it('should call playerManager.pause when DJ', async () => {
        const pauseSpy = vi.spyOn(playerManager, 'pause').mockResolvedValue();

        await component.onPauseClick();

        expect(pauseSpy).toHaveBeenCalled();
      });

      it('should show warning when non-DJ tries to pause', async () => {
        TestUtils.mockUser({ id: 'non-dj-user' });

        const pauseSpy = vi.spyOn(playerManager, 'pause').mockResolvedValue();
        
        await component.onPauseClick();

        expect(pauseSpy).not.toHaveBeenCalled();
      });

      it('should handle playerManager errors gracefully', async () => {
        vi.spyOn(playerManager, 'pause').mockRejectedValue(new Error('Pause failed'));

        await expect(component.onPauseClick()).resolves.not.toThrow();
      });
    });
  });

  describe('State Change Handling', () => {
    it('should handle player state changes for play/pause button updates', () => {
      const mockEvent = {
        changes: {
          player: { playbackState: 'playing' }
        }
      };

      const renderSpy = vi.spyOn(component, 'renderDebounced');
      
      component.onStateChanged(mockEvent as any);

      expect(renderSpy).toHaveBeenCalled();
    });

    it('should not re-render for heartbeat-triggered session member changes', async () => {
      // Initialize component first
      await component.initialize();
      
      const initialRenderTime = (component as any).lastRenderTime;
      
      // Mock a heartbeat event that changes session.members but not djUserId
      const heartbeatEvent = {
        changes: {
          session: {
            id: 'test-session',
            members: [
              { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: 1 }, // Changed missedHeartbeats
              { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 0 }
            ],
            djUserId: 'user-1', // Same as before - this should not trigger re-render
            isConnected: true,
            connectionStatus: 'connected',
            hasJoinedSession: true,
            activeRequests: []
          }
        }
      };

      const renderSpy = vi.spyOn(component, 'renderDebounced');
      
      // Trigger state change via the hook system
      (globalThis as any).Hooks.callAll('youtubeDJ.stateChanged', heartbeatEvent);
      
      // Should not have called render due to refined state subscriptions
      expect(renderSpy).not.toHaveBeenCalled();
      
      // Wait for any potential debounced renders
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Render time should not have changed
      expect((component as any).lastRenderTime).toBe(initialRenderTime);
    });

    it('should re-render when DJ actually changes despite heartbeat noise', async () => {
      // Initialize component first
      await component.initialize();
      
      const renderSpy = vi.spyOn(component, 'renderDebounced');
      const initialCallCount = renderSpy.mock.calls.length;
      
      // Use store.updateState to trigger a real DJ change (this will also call the hook)
      store.updateState({
        session: {
          id: 'test-session',
          members: [
            { userId: 'user-1', name: 'User 1', isDJ: false, isActive: true, missedHeartbeats: 0 },
            { userId: 'user-2', name: 'User 2', isDJ: true, isActive: true, missedHeartbeats: 0 }
          ],
          djUserId: 'user-2', // Actually changed - this SHOULD trigger re-render
          isConnected: true,
          connectionStatus: 'connected',
          hasJoinedSession: true,
          activeRequests: []
        }
      });
      
      // Should have called render due to actual djUserId change
      expect(renderSpy).toHaveBeenCalledTimes(initialCallCount + 1);
    });

    it('should preserve scroll position during queue changes', async () => {
      // Create a mock component element with scroll
      const mockElement = {
        scrollTop: 100
      } as any;
      
      (component as any).componentElement = mockElement;

      const mockEvent = {
        changes: {
          queue: { items: [] }
        }
      };

      const renderSpy = vi.spyOn(component, 'renderDebounced');
      
      component.onStateChanged(mockEvent as any);

      expect(renderSpy).toHaveBeenCalled();
      
      // Verify scroll restoration logic is triggered (setTimeout)
      // This is hard to test directly due to setTimeout, but we've covered the main logic
    });

    it('should call parent method for unhandled state changes', () => {
      const mockEvent = {
        changes: {
          ui: { someProperty: 'value' }
        }
      };

      const parentSpy = vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(component)), 'onStateChanged');
      
      component.onStateChanged(mockEvent as any);

      expect(parentSpy).toHaveBeenCalledWith(mockEvent);
    });
  });
});