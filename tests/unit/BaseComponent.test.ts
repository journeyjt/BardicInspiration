/**
 * Unit tests for BaseComponent - State subscription refinement and heartbeat resistance
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseComponent, ComponentConfig } from '../../src/ui/BaseComponent.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import { StateChangeEvent } from '../../src/state/StateTypes.js';
import TestUtils from '../setup/test-setup.js';

// Test implementation of BaseComponent
class TestComponent extends BaseComponent {
  public renderCount = 0;
  public lastContext: any = null;

  protected async prepareContext(): Promise<any> {
    this.lastContext = {
      djUserId: this.store.getState().session?.djUserId,
      isReady: this.store.getState().player?.isReady,
      queueLength: this.store.getState().queue?.items?.length || 0
    };
    return this.lastContext;
  }

  protected async onAfterRender(): Promise<void> {
    this.renderCount++;
  }

  // Expose private methods for testing
  public testShouldUpdate(event: StateChangeEvent): boolean {
    return this.shouldUpdate(event);
  }

  public testGetValueByPath(obj: any, path: string): any {
    return (this as any).getValueByPath(obj, path);
  }

  public testDeepEquals(a: any, b: any): boolean {
    return (this as any).deepEquals(a, b);
  }

  public getSubscriptionValues(): Map<string, any> {
    return (this as any).subscriptionValues;
  }
}

describe('BaseComponent State Subscription Refinement', () => {
  let component: TestComponent;
  let store: SessionStore;
  let parentElement: HTMLElement;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    
    // Create a mock parent element
    parentElement = document.createElement('div');
    parentElement.innerHTML = '<div class="test-component"></div>';

    // Mock foundry's renderTemplate function
    (globalThis as any).foundry = {
      applications: {
        handlebars: {
          renderTemplate: vi.fn().mockResolvedValue('<div>Mock Template</div>')
        }
      }
    };

    // Initialize store with base state
    store.updateState({
      session: {
        id: 'test-session',
        members: [
          { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: 0 },
          { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 0 }
        ],
        djUserId: 'user-1',
        isConnected: true,
        connectionStatus: 'connected',
        hasJoinedSession: true,
        activeRequests: []
      },
      player: {
        isReady: true,
        playbackState: 'paused',
        currentVideo: null
      },
      queue: {
        items: [],
        currentIndex: -1,
        mode: 'single-dj',
        djUserId: 'user-1'
      }
    });
  });

  describe('State Subscription Filtering', () => {
    it('should only update when subscribed values actually change', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId', 'player.isReady']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const initialRenderCount = component.renderCount;
      
      // First update store state to simulate heartbeat changes (but djUserId stays the same)
      store.updateState({
        session: {
          id: 'test-session',
          members: [
            { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: 0 },
            { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 1 } // Changed missedHeartbeats
          ],
          djUserId: 'user-1', // Same value as before
          isConnected: true,
          connectionStatus: 'connected',
          hasJoinedSession: true,
          activeRequests: []
        }
      });

      // Create state change event that reflects the above update
      const heartbeatEvent: StateChangeEvent = {
        changes: {
          session: {
            id: 'test-session',
            members: [
              { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: 0 },
              { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 1 } // Changed missedHeartbeats
            ],
            djUserId: 'user-1', // Same value as before
            isConnected: true,
            connectionStatus: 'connected',
            hasJoinedSession: true,
            activeRequests: []
          }
        }
      };

      // This should NOT trigger a re-render because djUserId didn't change
      expect(component.testShouldUpdate(heartbeatEvent)).toBe(false);
      
      // Wait a tick to ensure debounced render wouldn't trigger
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(component.renderCount).toBe(initialRenderCount);
    });

    it('should update when subscribed values actually change', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId', 'player.isReady']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const initialRenderCount = component.renderCount;
      
      // Use the store's updateState method which will trigger the hook system
      // This simulates an actual state change that would happen in the app
      store.updateState({
        session: {
          id: 'test-session',
          members: [
            { userId: 'user-1', name: 'User 1', isDJ: false, isActive: true, missedHeartbeats: 0 },
            { userId: 'user-2', name: 'User 2', isDJ: true, isActive: true, missedHeartbeats: 0 }
          ],
          djUserId: 'user-2', // Changed from 'user-1'
          isConnected: true,
          connectionStatus: 'connected',
          hasJoinedSession: true,
          activeRequests: []
        }
      });

      // Wait for debounced renders
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should have triggered re-render because djUserId changed
      expect(component.renderCount).toBeGreaterThan(initialRenderCount);
    });

    it('should handle multiple subscriptions correctly', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId', 'player.isReady', 'queue.items']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const initialRenderCount = component.renderCount;
      
      // Use the store's updateState method which will trigger the hook system
      store.updateState({
        queue: {
          items: [{ id: 'v1', videoId: 'video-1', title: 'Video 1', addedBy: 'user-1', addedAt: Date.now() }],
          currentIndex: -1,
          mode: 'single-dj',
          djUserId: 'user-1'
        }
      });
      
      // Wait for debounced renders
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have triggered re-render because queue.items changed
      expect(component.renderCount).toBeGreaterThan(initialRenderCount);
      
      // Change only session.members (not subscribed)
      const membersChangeEvent: StateChangeEvent = {
        changes: {
          session: {
            id: 'test-session',
            members: [
              { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: 1 }
            ],
            djUserId: 'user-1', // Same as before
            isConnected: true,
            connectionStatus: 'connected',
            hasJoinedSession: true,
            activeRequests: []
          }
        }
      };

      expect(component.testShouldUpdate(membersChangeEvent)).toBe(false);
    });
  });

  describe('Deep Equality Checks', () => {
    beforeEach(() => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['queue.items']
      };

      component = new TestComponent(store, parentElement, config);
    });

    it('should correctly identify identical primitive values', () => {
      expect(component.testDeepEquals('user-1', 'user-1')).toBe(true);
      expect(component.testDeepEquals('user-1', 'user-2')).toBe(false);
      expect(component.testDeepEquals(42, 42)).toBe(true);
      expect(component.testDeepEquals(42, 43)).toBe(false);
      expect(component.testDeepEquals(true, true)).toBe(true);
      expect(component.testDeepEquals(true, false)).toBe(false);
      expect(component.testDeepEquals(null, null)).toBe(true);
      expect(component.testDeepEquals(null, undefined)).toBe(false);
    });

    it('should correctly identify identical arrays', () => {
      const arr1 = [1, 2, 3];
      const arr2 = [1, 2, 3];
      const arr3 = [1, 2, 4];
      
      expect(component.testDeepEquals(arr1, arr2)).toBe(true);
      expect(component.testDeepEquals(arr1, arr3)).toBe(false);
      expect(component.testDeepEquals([], [])).toBe(true);
    });

    it('should correctly identify identical objects', () => {
      const obj1 = { a: 1, b: { c: 2 } };
      const obj2 = { a: 1, b: { c: 2 } };
      const obj3 = { a: 1, b: { c: 3 } };
      
      expect(component.testDeepEquals(obj1, obj2)).toBe(true);
      expect(component.testDeepEquals(obj1, obj3)).toBe(false);
      expect(component.testDeepEquals({}, {})).toBe(true);
    });

    it('should handle complex nested structures', () => {
      const complex1 = {
        users: [
          { id: 'user-1', data: { name: 'User 1', active: true } },
          { id: 'user-2', data: { name: 'User 2', active: false } }
        ],
        meta: { count: 2, lastUpdate: null }
      };
      
      const complex2 = {
        users: [
          { id: 'user-1', data: { name: 'User 1', active: true } },
          { id: 'user-2', data: { name: 'User 2', active: false } }
        ],
        meta: { count: 2, lastUpdate: null }
      };
      
      const complex3 = {
        users: [
          { id: 'user-1', data: { name: 'User 1', active: true } },
          { id: 'user-2', data: { name: 'User 2', active: true } } // Changed active status
        ],
        meta: { count: 2, lastUpdate: null }
      };
      
      expect(component.testDeepEquals(complex1, complex2)).toBe(true);
      expect(component.testDeepEquals(complex1, complex3)).toBe(false);
    });
  });

  describe('Path Value Extraction', () => {
    beforeEach(() => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId']
      };

      component = new TestComponent(store, parentElement, config);
    });

    it('should extract simple path values', () => {
      const obj = { session: { djUserId: 'user-1' } };
      
      expect(component.testGetValueByPath(obj, 'session.djUserId')).toBe('user-1');
      expect(component.testGetValueByPath(obj, 'session')).toEqual({ djUserId: 'user-1' });
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { session: { djUserId: 'user-1' } };
      
      expect(component.testGetValueByPath(obj, 'session.nonExistent')).toBeUndefined();
      expect(component.testGetValueByPath(obj, 'nonExistent.path')).toBeUndefined();
    });

    it('should handle deep nested paths', () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              value: 'deep-value'
            }
          }
        }
      };
      
      expect(component.testGetValueByPath(obj, 'level1.level2.level3.value')).toBe('deep-value');
      expect(component.testGetValueByPath(obj, 'level1.level2.level3')).toEqual({ value: 'deep-value' });
    });

    it('should handle arrays in paths', () => {
      const obj = {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' }
        ]
      };
      
      expect(component.testGetValueByPath(obj, 'items')).toEqual(obj.items);
      // Note: Dot notation doesn't handle array indices, which is fine for our use case
    });
  });

  describe('Subscription Cache Management', () => {
    it('should initialize subscription cache on component initialization', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId', 'player.isReady', 'queue.items']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const cache = component.getSubscriptionValues();
      
      expect(cache.get('session.djUserId')).toBe('user-1');
      expect(cache.get('player.isReady')).toBe(true);
      expect(cache.get('queue.items')).toEqual([]);
    });

    it('should update cache when values change', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const cache = component.getSubscriptionValues();
      expect(cache.get('session.djUserId')).toBe('user-1');
      
      // First update store state  
      store.updateState({
        session: {
          id: 'test-session',
          djUserId: 'user-2',
          members: [],
          isConnected: true,
          connectionStatus: 'connected',
          hasJoinedSession: true,
          activeRequests: []
        }
      });
      
      // Trigger a change
      const changeEvent: StateChangeEvent = {
        changes: {
          session: {
            djUserId: 'user-2',
            // ... other properties would be here in real scenario
          }
        }
      };
      
      component.testShouldUpdate(changeEvent);
      
      // Cache should be updated
      expect(cache.get('session.djUserId')).toBe('user-2');
    });

    it('should clear cache on component destruction', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId']
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const cache = component.getSubscriptionValues();
      expect(cache.size).toBeGreaterThan(0);
      
      component.destroy();
      
      expect(cache.size).toBe(0);
    });
  });

  describe('Heartbeat Resistance Integration Test', () => {
    it('should resist frequent heartbeat-triggered state changes', async () => {
      const config: ComponentConfig = {
        selector: '.test-component',
        template: 'test-template.hbs',
        stateSubscriptions: ['session.djUserId', 'player.isReady'] // Typical QueueSectionComponent subscriptions
      };

      component = new TestComponent(store, parentElement, config);
      await component.initialize();
      
      const initialRenderCount = component.renderCount;
      
      // Simulate 10 heartbeat cycles that only change session.members
      for (let i = 0; i < 10; i++) {
        const heartbeatEvent: StateChangeEvent = {
          changes: {
            session: {
              id: 'test-session',
              members: [
                { userId: 'user-1', name: 'User 1', isDJ: true, isActive: true, missedHeartbeats: i }, // Incrementing missed heartbeats
                { userId: 'user-2', name: 'User 2', isDJ: false, isActive: true, missedHeartbeats: 0 }
              ],
              djUserId: 'user-1', // Same as before
              isConnected: true,
              connectionStatus: 'connected',
              hasJoinedSession: true,
              activeRequests: []
            }
          }
        };

        expect(component.testShouldUpdate(heartbeatEvent)).toBe(false);
      }
      
      // Wait for any potential debounced renders
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should not have triggered any re-renders
      expect(component.renderCount).toBe(initialRenderCount);
      
      // But a real change should still trigger re-render
      store.updateState({
        session: {
          id: 'test-session',
          djUserId: 'user-2', // Actually changed
          members: [],
          isConnected: true,
          connectionStatus: 'connected',
          hasJoinedSession: true,
          activeRequests: []
        }
      });
      
      // Wait for debounced renders
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Should have triggered re-render because djUserId changed
      expect(component.renderCount).toBeGreaterThan(initialRenderCount);
    });
  });
});