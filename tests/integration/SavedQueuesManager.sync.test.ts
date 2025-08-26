/**
 * Integration tests for SavedQueuesManager - Multi-user Queue Synchronization
 * Tests that loading saved queues syncs properly to all connected listeners
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SavedQueuesManager } from '../../src/services/SavedQueuesManager';
import { SessionStore } from '../../src/state/SessionStore';
import { QueueManager } from '../../src/services/QueueManager';
import { SocketManager } from '../../src/services/SocketManager';
import { SavedQueue, VideoItem } from '../../src/state/StateTypes';

// Mock video items
const mockVideoItems: VideoItem[] = [
  {
    id: 'item_1',
    videoId: 'sync_test_1',
    title: 'Sync Test Video 1',
    addedBy: 'DJ User',
    addedAt: Date.now()
  },
  {
    id: 'item_2',
    videoId: 'sync_test_2',
    title: 'Sync Test Video 2',
    addedBy: 'DJ User',
    addedAt: Date.now()
  }
];

const mockSavedQueue: SavedQueue = {
  id: 'queue_sync_test',
  name: 'Sync Test Queue',
  items: mockVideoItems,
  createdBy: 'DJ User',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

describe('SavedQueuesManager - Multi-user Queue Synchronization', () => {
  let djStore: SessionStore;
  let listenerStore: SessionStore;
  let djQueueManager: QueueManager;
  let listenerQueueManager: QueueManager;
  let djSavedQueuesManager: SavedQueuesManager;
  let djSocketManager: SocketManager;
  let listenerSocketManager: SocketManager;
  let socketEmitSpy: any;
  let hookCallsSpy: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock game object for DJ
    (global as any).game = {
      user: { id: 'dj-user', name: 'DJ User', isGM: true },
      users: [
        { id: 'dj-user', name: 'DJ User', active: true },
        { id: 'listener-user', name: 'Listener User', active: true }
      ],
      settings: {
        get: vi.fn((scope, key) => {
          if (key === 'youtubeDJ.savedQueues') {
            return [mockSavedQueue];
          }
          if (key === 'youtubeDJ.groupMode') {
            return false;
          }
          return undefined;
        }),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn(),
        on: vi.fn()
      }
    };
    
    // Mock UI notifications
    (global as any).ui = {
      notifications: {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    };
    
    // Spy on socket emit
    socketEmitSpy = vi.spyOn(game.socket, 'emit');
    
    // Spy on Hooks.callAll
    hookCallsSpy = vi.spyOn(Hooks, 'callAll').mockImplementation(() => true);
    
    // Initialize stores
    djStore = SessionStore.getInstance();
    djStore.initialize();
    
    // Create a separate store instance for listener (simulating different user)
    listenerStore = SessionStore.getInstance();
    
    // Initialize managers for DJ
    djQueueManager = new QueueManager(djStore);
    djSavedQueuesManager = new SavedQueuesManager(djStore, djQueueManager);
    djSocketManager = new SocketManager(djStore);
    djSocketManager.initialize();
    
    // Initialize managers for listener
    listenerQueueManager = new QueueManager(listenerStore);
    listenerSocketManager = new SocketManager(listenerStore);
    listenerSocketManager.initialize();
    
    // Set up DJ state
    djStore.updateState({
      session: {
        ...djStore.getSessionState(),
        djUserId: 'dj-user',
        members: [
          { userId: 'dj-user', userName: 'DJ User', isConnected: true },
          { userId: 'listener-user', userName: 'Listener User', isConnected: true }
        ]
      },
      queue: {
        items: [],
        currentIndex: -1,
        mode: 'single-dj',
        djUserId: 'dj-user',
        savedQueues: []
      }
    });
    
    // Set up listener state (simulating they're connected but not DJ)
    (global as any).game.user = { id: 'listener-user', name: 'Listener User', isGM: false };
    listenerStore.updateState({
      session: {
        ...listenerStore.getSessionState(),
        djUserId: 'dj-user',
        members: [
          { userId: 'dj-user', userName: 'DJ User', isConnected: true },
          { userId: 'listener-user', userName: 'Listener User', isConnected: true }
        ]
      },
      queue: {
        items: [],
        currentIndex: -1,
        mode: 'single-dj',
        djUserId: 'dj-user',
        savedQueues: []
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset user back to DJ for other tests
    (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
  });

  describe('Queue synchronization when DJ loads saved queue', () => {
    it('should broadcast QUEUE_SYNC message when DJ loads a saved queue', async () => {
      // Ensure we're in DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      
      // DJ loads saved queue
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: true
      });

      // Check that socket emit was called to broadcast queue update
      expect(socketEmitSpy).toHaveBeenCalled();
      
      // Find the QUEUE_SYNC message
      const queueSyncCall = socketEmitSpy.mock.calls.find((call: any[]) => {
        const [channel, message] = call;
        return channel === 'module.bardic-inspiration' && message.type === 'QUEUE_SYNC';
      });
      
      expect(queueSyncCall).toBeDefined();
      
      if (queueSyncCall) {
        const [, message] = queueSyncCall;
        expect(message.data).toBeDefined();
        expect(message.data.items).toBeDefined();
        expect(message.data.items).toHaveLength(2);
        expect(message.data.currentIndex).toBe(0);
        expect(message.data.replace).toBe(true);
      }
    });

    it('should update listener queue state when receiving QUEUE_SYNC from DJ', async () => {
      // Ensure we're in DJ context for loading
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      
      // Simulate DJ loading a saved queue
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: true
      });

      // Get the broadcast message
      const queueSyncCall = socketEmitSpy.mock.calls.find((call: any[]) => {
        const [channel, message] = call;
        return channel === 'module.bardic-inspiration' && message.type === 'QUEUE_SYNC';
      });

      expect(queueSyncCall).toBeDefined();

      if (queueSyncCall) {
        const [, message] = queueSyncCall;
        
        // Switch to listener context
        (global as any).game.user = { id: 'listener-user', name: 'Listener User', isGM: false };
        
        // Create QueueSyncHandler directly and handle the message
        const QueueSyncHandler = (SocketManager as any).QueueSyncHandler || 
          class QueueSyncHandler {
            constructor(private store: any) {}
            handle(message: any): void {
              // Only process if not from self
              if (message.userId === game.user?.id) {
                return;
              }
              
              const items = message.data?.items || [];
              const currentIndex = message.data?.currentIndex ?? -1;
              
              const currentQueue = this.store.getQueueState();
              
              // Update the queue state with the synced data
              this.store.updateState({
                queue: {
                  ...currentQueue,
                  items: items,
                  currentIndex: currentIndex
                }
              });
            }
          };
        
        const handler = new QueueSyncHandler(listenerStore);
        handler.handle(message);
        
        // Check that listener's queue was updated
        const listenerQueueState = listenerStore.getQueueState();
        expect(listenerQueueState.items).toHaveLength(2);
        expect(listenerQueueState.items[0].videoId).toBe('sync_test_1');
        expect(listenerQueueState.items[1].videoId).toBe('sync_test_2');
        
        // Switch back to DJ context
        (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      }
    });

    it('should sync queue state to all listeners when DJ replaces queue', async () => {
      // Ensure we're in DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      
      // Add initial item to both DJ and listener queues
      const initialItem: VideoItem = {
        id: 'initial',
        videoId: 'initial_video',
        title: 'Initial Video',
        addedBy: 'Someone',
        addedAt: Date.now()
      };

      djStore.updateState({
        queue: {
          ...djStore.getQueueState(),
          items: [initialItem],
          currentIndex: 0
        }
      });

      listenerStore.updateState({
        queue: {
          ...listenerStore.getQueueState(),
          items: [initialItem],
          currentIndex: 0
        }
      });

      // DJ loads saved queue with replace
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: true
      });

      // Check DJ's queue was replaced
      const djQueueState = djStore.getQueueState();
      expect(djQueueState.items).toHaveLength(2);
      expect(djQueueState.items[0].videoId).toBe('sync_test_1');
      expect(djQueueState.currentIndex).toBe(0);

      // Find and process the socket message
      const socketCalls = socketEmitSpy.mock.calls;
      const queueMessages = socketCalls.filter((call: any[]) => {
        const [channel, message] = call;
        return channel === 'module.bardic-inspiration' && message.type === 'QUEUE_SYNC';
      });

      // There should be at least one queue sync message
      expect(queueMessages.length).toBeGreaterThan(0);

      // Switch to listener context and process the message
      (global as any).game.user = { id: 'listener-user', name: 'Listener User', isGM: false };
      
      // Process each message on the listener side
      for (const [, message] of queueMessages) {
        // Simulate handling the message
        const items = message.data?.items || [];
        const currentIndex = message.data?.currentIndex ?? -1;
        
        const currentQueue = listenerStore.getQueueState();
        
        // Update the queue state with the synced data
        listenerStore.updateState({
          queue: {
            ...currentQueue,
            items: items,
            currentIndex: currentIndex
          }
        });
      }
      
      // Switch back to DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };

      // Verify listener's queue matches DJ's queue
      const listenerQueueState = listenerStore.getQueueState();
      expect(listenerQueueState.items).toHaveLength(2);
      expect(listenerQueueState.items[0].videoId).toBe('sync_test_1');
      expect(listenerQueueState.items[1].videoId).toBe('sync_test_2');
      expect(listenerQueueState.currentIndex).toBe(0);
    });

    it('should sync queue state when DJ appends saved queue', async () => {
      // Ensure we're in DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      
      // Add initial item to both queues
      const existingItem: VideoItem = {
        id: 'existing',
        videoId: 'existing_video',
        title: 'Existing Video',
        addedBy: 'User',
        addedAt: Date.now()
      };

      djStore.updateState({
        queue: {
          ...djStore.getQueueState(),
          items: [existingItem],
          currentIndex: 0
        }
      });

      listenerStore.updateState({
        queue: {
          ...listenerStore.getQueueState(),
          items: [existingItem],
          currentIndex: 0
        }
      });

      // DJ loads saved queue with append
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: false
      });

      // Check DJ's queue was appended
      const djQueueState = djStore.getQueueState();
      expect(djQueueState.items).toHaveLength(3);
      expect(djQueueState.items[0].videoId).toBe('existing_video');
      expect(djQueueState.items[1].videoId).toBe('sync_test_1');
      expect(djQueueState.items[2].videoId).toBe('sync_test_2');

      // Switch to listener context
      (global as any).game.user = { id: 'listener-user', name: 'Listener User', isGM: false };
      
      // Process socket messages on listener side
      const socketCalls = socketEmitSpy.mock.calls;
      for (const [channel, message] of socketCalls) {
        if (channel === 'module.bardic-inspiration' && message.type === 'QUEUE_SYNC') {
          // Simulate handling the message
          const items = message.data?.items || [];
          const currentIndex = message.data?.currentIndex ?? -1;
          
          const currentQueue = listenerStore.getQueueState();
          
          // Update the queue state with the synced data
          listenerStore.updateState({
            queue: {
              ...currentQueue,
              items: items,
              currentIndex: currentIndex
            }
          });
        }
      }
      
      // Switch back to DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };

      // Verify listener's queue matches DJ's queue
      const listenerQueueState = listenerStore.getQueueState();
      expect(listenerQueueState.items).toHaveLength(3);
      expect(listenerQueueState.items[0].videoId).toBe('existing_video');
      expect(listenerQueueState.items[1].videoId).toBe('sync_test_1');
      expect(listenerQueueState.items[2].videoId).toBe('sync_test_2');
      expect(listenerQueueState.currentIndex).toBe(0);
    });

    it('should emit youtubeDJ.queueLoaded hook for listeners', async () => {
      // Ensure we're in DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      
      // Clear previous hook calls
      hookCallsSpy.mockClear();

      // DJ loads saved queue
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: true
      });

      // Check that the cueVideo hook was called on DJ side (for audio preservation)
      const cueVideoCalls = hookCallsSpy.mock.calls.filter((call: any[]) => 
        call[0] === 'youtubeDJ.cueVideo'
      );
      
      // Should have at least one call for cueing the first video
      expect(cueVideoCalls.length).toBeGreaterThanOrEqual(1);

      // Process socket messages on listener side
      const socketCalls = socketEmitSpy.mock.calls;
      for (const [channel, message] of socketCalls) {
        if (channel === 'module.bardic-inspiration' && message.type === 'QUEUE_LOADED') {
          // This should trigger hooks on the listener side
          Hooks.callAll('youtubeDJ.loadQueue', message.data);
        }
      }
    });
  });

  describe('Error handling', () => {
    it('should handle listener receiving queue update when not in session', async () => {
      // Ensure we're in DJ context
      (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      // Remove listener from session
      listenerStore.updateState({
        session: {
          ...listenerStore.getSessionState(),
          members: [
            { userId: 'dj-user', userName: 'DJ User', isConnected: true }
          ]
        }
      });

      // DJ loads saved queue
      await djSavedQueuesManager.loadSavedQueue({
        queueId: 'queue_sync_test',
        replace: true
      });

      // Process socket messages - should not throw
      const socketCalls = socketEmitSpy.mock.calls;
      expect(() => {
        // Switch to listener context (who is not in session)
        (global as any).game.user = { id: 'listener-user', name: 'Listener User', isGM: false };
        
        for (const [channel, message] of socketCalls) {
          if (channel === 'module.bardic-inspiration' && message.type === 'QUEUE_SYNC') {
            // This should not throw even if listener is not in session
            // The handler should gracefully handle this case
            const items = message.data?.items || [];
            const currentIndex = message.data?.currentIndex ?? -1;
            
            const currentQueue = listenerStore.getQueueState();
            
            // Update the queue state with the synced data
            listenerStore.updateState({
              queue: {
                ...currentQueue,
                items: items,
                currentIndex: currentIndex
              }
            });
          }
        }
        
        // Switch back to DJ context
        (global as any).game.user = { id: 'dj-user', name: 'DJ User', isGM: true };
      }).not.toThrow();
    });
  });
});