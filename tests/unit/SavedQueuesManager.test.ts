/**
 * Unit tests for SavedQueuesManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SavedQueuesManager } from '../../src/services/SavedQueuesManager';
import { SessionStore } from '../../src/state/SessionStore';
import { QueueManager } from '../../src/services/QueueManager';
import { SavedQueue, VideoItem } from '../../src/state/StateTypes';

// Mock data
const mockVideoItems: VideoItem[] = [
  {
    id: 'item_1',
    videoId: 'abc123def45',
    title: 'Test Video 1',
    addedBy: 'TestUser',
    addedAt: Date.now()
  },
  {
    id: 'item_2',
    videoId: 'xyz789ghi12',
    title: 'Test Video 2',
    addedBy: 'TestUser',
    addedAt: Date.now()
  }
];

const mockSavedQueue: SavedQueue = {
  id: 'queue_test_123',
  name: 'Test Queue',
  items: mockVideoItems,
  createdBy: 'TestUser',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

describe('SavedQueuesManager', () => {
  let savedQueuesManager: SavedQueuesManager;
  let store: SessionStore;
  let queueManager: QueueManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Mock QueueManager
    queueManager = new QueueManager(store);
    
    // Create SavedQueuesManager instance
    savedQueuesManager = new SavedQueuesManager(store, queueManager);
    
    // Mock game settings
    (global as any).game = {
      user: { id: 'test-user', name: 'TestUser' },
      settings: {
        get: vi.fn().mockReturnValue([]),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn()
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getSavedQueues', () => {
    it('should return empty array when no saved queues exist', () => {
      const queues = savedQueuesManager.getSavedQueues();
      expect(queues).toEqual([]);
    });

    it('should return saved queues from settings', () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      
      const queues = savedQueuesManager.getSavedQueues();
      expect(queues).toEqual([mockSavedQueue]);
    });
  });

  describe('getSavedQueue', () => {
    it('should return null when queue not found', () => {
      const queue = savedQueuesManager.getSavedQueue('non-existent');
      expect(queue).toBeNull();
    });

    it('should return saved queue by ID', () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      
      const queue = savedQueuesManager.getSavedQueue('queue_test_123');
      expect(queue).toEqual(mockSavedQueue);
    });
  });

  describe('saveCurrentQueue', () => {
    beforeEach(() => {
      // Mock current queue state
      store.updateState({
        queue: {
          items: mockVideoItems,
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        },
        session: {
          ...store.getSessionState(),
          djUserId: 'test-user'
        }
      });
    });

    it('should throw error if not DJ', async () => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });

      await expect(
        savedQueuesManager.saveCurrentQueue({ name: 'Test' })
      ).rejects.toThrow('Only the DJ can save queues');
    });

    it('should throw error if name is empty', async () => {
      await expect(
        savedQueuesManager.saveCurrentQueue({ name: '' })
      ).rejects.toThrow('Queue name is required');
    });

    it('should throw error if queue is empty', async () => {
      store.updateState({
        queue: {
          ...store.getQueueState(),
          items: []
        }
      });

      await expect(
        savedQueuesManager.saveCurrentQueue({ name: 'Test' })
      ).rejects.toThrow('Cannot save an empty queue');
    });

    it('should save new queue successfully', async () => {
      const result = await savedQueuesManager.saveCurrentQueue({ name: 'My Queue' });
      
      expect(result).toMatchObject({
        name: 'My Queue',
        items: mockVideoItems,
        createdBy: 'TestUser'
      });
      expect(result.id).toBeDefined();
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.arrayContaining([result])
      );
      expect(ui.notifications?.success).toHaveBeenCalledWith('Queue saved as "My Queue"');
    });

    it('should throw error if queue name already exists without overwrite', async () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);

      await expect(
        savedQueuesManager.saveCurrentQueue({ name: 'Test Queue', overwrite: false })
      ).rejects.toThrow('A queue named "Test Queue" already exists');
    });

    it('should overwrite existing queue when overwrite is true', async () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);

      const result = await savedQueuesManager.saveCurrentQueue({ 
        name: 'Test Queue', 
        overwrite: true 
      });
      
      expect(result.name).toBe('Test Queue');
      expect(result.id).toBe(mockSavedQueue.id);
      expect(result.items).toEqual(mockVideoItems);
    });

    it('should broadcast save event via socket', async () => {
      await savedQueuesManager.saveCurrentQueue({ name: 'My Queue' });
      
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_SAVED',
          userId: 'test-user'
        })
      );
    });
  });

  describe('loadSavedQueue', () => {
    beforeEach(() => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'test-user'
        }
      });
    });

    it('should throw error if not DJ', async () => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });

      await expect(
        savedQueuesManager.loadSavedQueue({ queueId: 'test' })
      ).rejects.toThrow('Only the DJ can load saved queues');
    });

    it('should throw error if queue not found', async () => {
      await expect(
        savedQueuesManager.loadSavedQueue({ queueId: 'non-existent' })
      ).rejects.toThrow('Saved queue not found');
    });

    it('should replace current queue when replace is true', async () => {
      const initialQueue = {
        items: [{ id: 'old', videoId: 'old123', title: 'Old', addedBy: 'User', addedAt: 0 }],
        currentIndex: 0,
        mode: 'single-dj' as const,
        djUserId: 'test-user',
        savedQueues: []
      };
      
      store.updateState({ queue: initialQueue });

      await savedQueuesManager.loadSavedQueue({ 
        queueId: 'queue_test_123', 
        replace: true 
      });

      const newQueue = store.getQueueState();
      expect(newQueue.items).toEqual(mockVideoItems);
      expect(newQueue.currentIndex).toBe(0);
      expect(ui.notifications?.success).toHaveBeenCalledWith(
        'Queue "Test Queue" loaded (2 tracks)'
      );
    });

    it('should append to current queue when replace is false', async () => {
      const existingItem: VideoItem = { 
        id: 'existing', 
        videoId: 'exist123456', 
        title: 'Existing', 
        addedBy: 'User', 
        addedAt: 0 
      };
      
      store.updateState({
        queue: {
          items: [existingItem],
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        }
      });

      await savedQueuesManager.loadSavedQueue({ 
        queueId: 'queue_test_123', 
        replace: false 
      });

      const newQueue = store.getQueueState();
      expect(newQueue.items).toEqual([existingItem, ...mockVideoItems]);
      expect(newQueue.currentIndex).toBe(0);
    });

    it('should broadcast load event via socket', async () => {
      await savedQueuesManager.loadSavedQueue({ queueId: 'queue_test_123' });
      
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_LOADED',
          userId: 'test-user',
          data: expect.objectContaining({
            queueName: 'Test Queue',
            queueId: 'queue_test_123'
          })
        })
      );
    });
  });

  describe('deleteSavedQueue', () => {
    beforeEach(() => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'test-user'
        }
      });
    });

    it('should throw error if not DJ', async () => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });

      await expect(
        savedQueuesManager.deleteSavedQueue('test')
      ).rejects.toThrow('Only the DJ can delete saved queues');
    });

    it('should throw error if queue not found', async () => {
      await expect(
        savedQueuesManager.deleteSavedQueue('non-existent')
      ).rejects.toThrow('Saved queue not found');
    });

    it('should delete queue successfully', async () => {
      await savedQueuesManager.deleteSavedQueue('queue_test_123');
      
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        []
      );
      expect(ui.notifications?.success).toHaveBeenCalledWith('Queue "Test Queue" deleted');
    });

    it('should broadcast delete event via socket', async () => {
      await savedQueuesManager.deleteSavedQueue('queue_test_123');
      
      expect(game.socket?.emit).toHaveBeenCalledWith(
        'module.bardic-inspiration',
        expect.objectContaining({
          type: 'QUEUE_DELETED',
          userId: 'test-user',
          data: expect.objectContaining({
            queueName: 'Test Queue',
            queueId: 'queue_test_123'
          })
        })
      );
    });
  });

  describe('renameSavedQueue', () => {
    beforeEach(() => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'test-user'
        }
      });
    });

    it('should throw error if not DJ', async () => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });

      await expect(
        savedQueuesManager.renameSavedQueue('test', 'New Name')
      ).rejects.toThrow('Only the DJ can rename saved queues');
    });

    it('should throw error if new name is empty', async () => {
      await expect(
        savedQueuesManager.renameSavedQueue('queue_test_123', '')
      ).rejects.toThrow('New queue name is required');
    });

    it('should throw error if queue not found', async () => {
      await expect(
        savedQueuesManager.renameSavedQueue('non-existent', 'New Name')
      ).rejects.toThrow('Saved queue not found');
    });

    it('should throw error if new name already exists', async () => {
      const anotherQueue: SavedQueue = {
        ...mockSavedQueue,
        id: 'another_queue',
        name: 'Another Queue'
      };
      (game.settings.get as any).mockReturnValue([mockSavedQueue, anotherQueue]);

      await expect(
        savedQueuesManager.renameSavedQueue('queue_test_123', 'Another Queue')
      ).rejects.toThrow('A queue named "Another Queue" already exists');
    });

    it('should rename queue successfully', async () => {
      await savedQueuesManager.renameSavedQueue('queue_test_123', 'Renamed Queue');
      
      expect(game.settings.set).toHaveBeenCalledWith(
        'core',
        'youtubeDJ.savedQueues',
        expect.arrayContaining([
          expect.objectContaining({
            id: 'queue_test_123',
            name: 'Renamed Queue'
          })
        ])
      );
      expect(ui.notifications?.success).toHaveBeenCalledWith('Queue renamed to "Renamed Queue"');
    });
  });

  describe('exportSavedQueue', () => {
    it('should throw error if queue not found', () => {
      expect(() => savedQueuesManager.exportSavedQueue('non-existent'))
        .toThrow('Saved queue not found');
    });

    it('should export queue as JSON', () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      
      const json = savedQueuesManager.exportSavedQueue('queue_test_123');
      const parsed = JSON.parse(json);
      
      expect(parsed).toEqual(mockSavedQueue);
    });
  });

  describe('importSavedQueue', () => {
    beforeEach(() => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'test-user'
        }
      });
    });

    it('should throw error if not DJ', async () => {
      store.updateState({
        session: {
          ...store.getSessionState(),
          djUserId: 'other-user'
        }
      });

      await expect(
        savedQueuesManager.importSavedQueue('{}')
      ).rejects.toThrow('Only the DJ can import saved queues');
    });

    it('should throw error for invalid JSON', async () => {
      await expect(
        savedQueuesManager.importSavedQueue('invalid json')
      ).rejects.toThrow('Invalid JSON format');
    });

    it('should throw error for invalid queue format', async () => {
      await expect(
        savedQueuesManager.importSavedQueue('{"invalid": "format"}')
      ).rejects.toThrow('Invalid queue format');
    });

    it('should import queue successfully', async () => {
      const jsonData = JSON.stringify(mockSavedQueue);
      
      const result = await savedQueuesManager.importSavedQueue(jsonData);
      
      expect(result.name).toBe('Test Queue');
      expect(result.items).toEqual(mockVideoItems);
      expect(result.createdBy).toBe('TestUser');
      expect(game.settings.set).toHaveBeenCalled();
      expect(ui.notifications?.success).toHaveBeenCalledWith('Queue "Test Queue" imported');
    });

    it('should rename imported queue if name exists', async () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      const jsonData = JSON.stringify(mockSavedQueue);
      
      const result = await savedQueuesManager.importSavedQueue(jsonData, false);
      
      expect(result.name).toContain('Test Queue (Imported');
    });

    it('should overwrite existing queue when overwrite is true', async () => {
      (game.settings.get as any).mockReturnValue([mockSavedQueue]);
      const updatedQueue = { ...mockSavedQueue, items: [] };
      const jsonData = JSON.stringify(updatedQueue);
      
      const result = await savedQueuesManager.importSavedQueue(jsonData, true);
      
      expect(result.name).toBe('Test Queue');
      expect(result.items).toEqual([]);
    });
  });
});