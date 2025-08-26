/**
 * Integration tests for saved queue workflows
 * Tests the full workflow of saving, loading, and managing queues across multiple users
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore';
import { SocketManager } from '../../src/services/SocketManager';
import { QueueManager } from '../../src/services/QueueManager';
import { SavedQueuesManager } from '../../src/services/SavedQueuesManager';
import { VideoItem } from '../../src/state/StateTypes';

describe('Saved Queues Workflow Integration', () => {
  let djStore: SessionStore;
  let listenerStore: SessionStore;
  let djSocketManager: SocketManager;
  let listenerSocketManager: SocketManager;
  let djQueueManager: QueueManager;
  let listenerQueueManager: QueueManager;
  let djSavedQueuesManager: SavedQueuesManager;
  let listenerSavedQueuesManager: SavedQueuesManager;
  
  const djUserId = 'dj-user';
  const listenerUserId = 'listener-user';
  
  const mockVideoItems: VideoItem[] = [
    {
      id: 'item_1',
      videoId: 'abc123def45',
      title: 'Epic Battle Music',
      addedBy: 'DJ',
      addedAt: Date.now()
    },
    {
      id: 'item_2',
      videoId: 'xyz789ghi12',
      title: 'Tavern Ambience',
      addedBy: 'DJ',
      addedAt: Date.now()
    },
    {
      id: 'item_3',
      videoId: 'qrs456tuv78',
      title: 'Forest Exploration',
      addedBy: 'Player1',
      addedAt: Date.now()
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Initialize DJ's environment
    djStore = SessionStore.getInstance();
    djStore.initialize();
    djSocketManager = new SocketManager(djStore);
    djQueueManager = new QueueManager(djStore);
    djSavedQueuesManager = new SavedQueuesManager(djStore, djQueueManager);
    
    // Initialize listener's environment (simulating separate client)
    listenerStore = new SessionStore();
    listenerStore.initialize();
    listenerSocketManager = new SocketManager(listenerStore);
    listenerQueueManager = new QueueManager(listenerStore);
    listenerSavedQueuesManager = new SavedQueuesManager(listenerStore, listenerQueueManager);
    
    // Mock game context for DJ
    (global as any).game = {
      user: { id: djUserId, name: 'DJ' },
      settings: {
        get: vi.fn().mockReturnValue([]),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn((channel, message) => {
          // Simulate socket message propagation to listener
          if (message.userId !== listenerUserId) {
            simulateSocketMessage(listenerSocketManager, message);
          }
        })
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
    
    // Set up DJ state
    djStore.updateState({
      session: {
        ...djStore.getSessionState(),
        djUserId: djUserId,
        hasJoinedSession: true,
        members: [
          { userId: djUserId, name: 'DJ', isDJ: true, isActive: true, missedHeartbeats: 0 },
          { userId: listenerUserId, name: 'Listener', isDJ: false, isActive: true, missedHeartbeats: 0 }
        ]
      }
    });
    
    // Set up listener state
    listenerStore.updateState({
      session: {
        ...listenerStore.getSessionState(),
        djUserId: djUserId,
        hasJoinedSession: true,
        members: [
          { userId: djUserId, name: 'DJ', isDJ: true, isActive: true, missedHeartbeats: 0 },
          { userId: listenerUserId, name: 'Listener', isDJ: false, isActive: true, missedHeartbeats: 0 }
        ]
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to simulate socket message reception
   */
  function simulateSocketMessage(socketManager: any, message: any) {
    // Simulate handling the message as if it came from socket
    const handler = getHandlerForMessageType(message.type);
    if (handler) {
      handler(message);
    }
  }

  /**
   * Helper to get the appropriate handler for a message type
   */
  function getHandlerForMessageType(type: string): Function | null {
    // Map message types to their corresponding hook events
    const hookMap: Record<string, string> = {
      'QUEUE_SAVED': 'youtubeDJ.saveQueue',
      'QUEUE_LOADED': 'youtubeDJ.loadQueue',
      'QUEUE_DELETED': 'youtubeDJ.deleteQueue',
      'QUEUE_RENAMED': 'youtubeDJ.renameQueue',
      'QUEUE_ADD': 'youtubeDJ.queueAdd',
      'QUEUE_CLEAR': 'youtubeDJ.queueClear'
    };
    
    const hookName = hookMap[type];
    if (hookName) {
      return (message: any) => {
        Hooks.callAll(hookName, message.data ? { ...message.data, userId: message.userId, timestamp: message.timestamp } : message);
      };
    }
    return null;
  }

  describe('Save and Load Queue Workflow', () => {
    it('should allow DJ to save current queue and load it later', async () => {
      // Setup: DJ has a queue with videos
      djStore.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      // Step 1: DJ saves the current queue
      const savedQueue = await djSavedQueuesManager.saveCurrentQueue({ name: 'Battle Playlist' });
      
      expect(savedQueue).toMatchObject({
        name: 'Battle Playlist',
        items: mockVideoItems,
        createdBy: 'DJ'
      });
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.arrayContaining([savedQueue])
      );

      // Step 2: DJ clears the queue
      await djQueueManager.clearQueue();
      expect(djStore.getQueueState().items).toHaveLength(0);

      // Step 3: DJ loads the saved queue
      (game.settings.get as any).mockReturnValue([savedQueue]);
      await djSavedQueuesManager.loadSavedQueue({
        queueId: savedQueue.id,
        replace: true
      });

      // Verify queue is restored
      const restoredQueue = djStore.getQueueState();
      expect(restoredQueue.items).toEqual(mockVideoItems);
      expect(restoredQueue.currentIndex).toBe(0);
    });

    it('should prevent non-DJ from saving or loading queues', async () => {
      // Setup: Switch to listener context
      (game.user as any) = { id: listenerUserId, name: 'Listener' };
      
      listenerStore.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      // Attempt to save queue as listener
      await expect(
        listenerSavedQueuesManager.saveCurrentQueue({ name: 'My Playlist' })
      ).rejects.toThrow('Only the DJ can save queues');

      // Attempt to load queue as listener
      await expect(
        listenerSavedQueuesManager.loadSavedQueue({ queueId: 'some-id' })
      ).rejects.toThrow('Only the DJ can load saved queues');
    });

    it('should handle save queue before clearing with dialog option', async () => {
      // Setup: DJ has a queue
      djStore.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 1,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      // Step 1: Save queue before clearing
      const savedQueue = await djSavedQueuesManager.saveCurrentQueue({ 
        name: 'Session Backup' 
      });
      
      expect(savedQueue.items).toEqual(mockVideoItems);
      expect(ui.notifications?.success).toHaveBeenCalledWith(
        'Queue saved as "Session Backup"'
      );

      // Step 2: Clear the queue
      await djQueueManager.clearQueue();
      expect(djStore.getQueueState().items).toHaveLength(0);

      // Step 3: Verify saved queue persists
      (game.settings.get as any).mockReturnValue([savedQueue]);
      const savedQueues = djSavedQueuesManager.getSavedQueues();
      expect(savedQueues).toHaveLength(1);
      expect(savedQueues[0].name).toBe('Session Backup');
    });

    it('should handle appending loaded queue to existing queue', async () => {
      const existingItems: VideoItem[] = [
        {
          id: 'existing_1',
          videoId: 'exi123sting',
          title: 'Current Track',
          addedBy: 'DJ',
          addedAt: Date.now()
        }
      ];

      // Setup: DJ has a current queue and a saved queue
      djStore.updateState({
        queue: {
          items: existingItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      const savedQueue = {
        id: 'saved_queue_1',
        name: 'Additional Tracks',
        items: mockVideoItems,
        createdBy: 'DJ',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      (game.settings.get as any).mockReturnValue([savedQueue]);

      // Load saved queue with append mode
      await djSavedQueuesManager.loadSavedQueue({
        queueId: savedQueue.id,
        replace: false
      });

      // Verify queue contains both existing and loaded items
      const finalQueue = djStore.getQueueState();
      expect(finalQueue.items).toHaveLength(4);
      expect(finalQueue.items[0]).toEqual(existingItems[0]);
      expect(finalQueue.items.slice(1)).toEqual(mockVideoItems);
      expect(finalQueue.currentIndex).toBe(0);
    });

    it('should handle multiple saved queues and deletion', async () => {
      // Create multiple saved queues
      const savedQueues = [
        {
          id: 'queue_1',
          name: 'Combat Music',
          items: mockVideoItems.slice(0, 2),
          createdBy: 'DJ',
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'queue_2',
          name: 'Exploration Music',
          items: mockVideoItems.slice(1, 3),
          createdBy: 'DJ',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      (game.settings.get as any).mockReturnValue(savedQueues);

      // Verify all queues are available
      let allQueues = djSavedQueuesManager.getSavedQueues();
      expect(allQueues).toHaveLength(2);

      // Delete one queue
      await djSavedQueuesManager.deleteSavedQueue('queue_1');
      
      // Verify deletion
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.arrayContaining([savedQueues[1]])
      );
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.not.arrayContaining([savedQueues[0]])
      );
    });

    it('should handle renaming saved queues', async () => {
      const savedQueue = {
        id: 'queue_1',
        name: 'Original Name',
        items: mockVideoItems,
        createdBy: 'DJ',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      (game.settings.get as any).mockReturnValue([savedQueue]);

      // Rename the queue
      await djSavedQueuesManager.renameSavedQueue('queue_1', 'New Epic Name');

      // Verify rename
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'queue_1',
            name: 'New Epic Name'
          })
        ])
      );
      expect(ui.notifications?.success).toHaveBeenCalledWith(
        'Queue renamed to "New Epic Name"'
      );
    });

    it('should prevent duplicate queue names', async () => {
      const existingQueues = [
        {
          id: 'queue_1',
          name: 'Existing Queue',
          items: [],
          createdBy: 'DJ',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];
      (game.settings.get as any).mockReturnValue(existingQueues);

      djStore.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      // Try to save with existing name
      await expect(
        djSavedQueuesManager.saveCurrentQueue({ name: 'Existing Queue', overwrite: false })
      ).rejects.toThrow('A queue named "Existing Queue" already exists');

      // Should work with overwrite flag
      const result = await djSavedQueuesManager.saveCurrentQueue({ 
        name: 'Existing Queue', 
        overwrite: true 
      });
      expect(result.name).toBe('Existing Queue');
      expect(result.items).toEqual(mockVideoItems);
    });

    it('should handle export and import of saved queues', async () => {
      // Setup: Create a saved queue
      const originalQueue = {
        id: 'original_queue',
        name: 'Exportable Queue',
        items: mockVideoItems,
        createdBy: 'DJ',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      (game.settings.get as any).mockReturnValue([originalQueue]);

      // Export the queue
      const exportedJson = djSavedQueuesManager.exportSavedQueue('original_queue');
      const exportedData = JSON.parse(exportedJson);
      expect(exportedData).toEqual(originalQueue);

      // Clear saved queues
      (game.settings.get as any).mockReturnValue([]);

      // Import the queue
      const importedQueue = await djSavedQueuesManager.importSavedQueue(exportedJson);
      
      expect(importedQueue.name).toBe('Exportable Queue');
      expect(importedQueue.items).toEqual(mockVideoItems);
      expect(importedQueue.createdBy).toBe('DJ');
      expect(importedQueue.id).not.toBe(originalQueue.id); // Should have new ID
    });
  });

  describe('Clear Queue with Save Option', () => {
    it('should save queue before clearing when option is selected', async () => {
      // Setup: DJ has a queue
      djStore.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: djUserId,
          savedQueues: []
        }
      });

      // Save queue with a specific name
      const savedQueue = await djSavedQueuesManager.saveCurrentQueue({ 
        name: 'Before Clear Backup' 
      });

      // Clear the queue
      await djQueueManager.clearQueue();

      // Verify queue was saved and then cleared
      expect(savedQueue.name).toBe('Before Clear Backup');
      expect(savedQueue.items).toEqual(mockVideoItems);
      expect(djStore.getQueueState().items).toHaveLength(0);
      
      // Verify saved queue is available for loading
      (game.settings.get as any).mockReturnValue([savedQueue]);
      const availableQueues = djSavedQueuesManager.getSavedQueues();
      expect(availableQueues).toContainEqual(savedQueue);
    });
  });
});