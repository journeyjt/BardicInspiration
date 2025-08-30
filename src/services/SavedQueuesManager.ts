/**
 * SavedQueuesManager - Handles saving, loading, and managing saved queues
 * Provides DJ's with ability to save current queue and load previously saved queues
 */

import { SessionStore } from '../state/SessionStore.js';
import { QueueManager } from './QueueManager.js';
import { SavedQueue, VideoItem } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

export interface SaveQueueOptions {
  name: string;
  overwrite?: boolean;
}

export interface LoadQueueOptions {
  queueId: string;
  replace?: boolean; // If true, replaces current queue. If false, appends to current queue
}

export class SavedQueuesManager {
  private store: SessionStore;
  private queueManager: QueueManager;

  constructor(store: SessionStore, queueManager: QueueManager) {
    this.store = store;
    this.queueManager = queueManager;
    
    // Listen for saved queue events
    Hooks.on('youtubeDJ.saveQueue', this.onSaveQueue.bind(this));
    Hooks.on('youtubeDJ.loadQueue', this.onLoadQueue.bind(this));
    Hooks.on('youtubeDJ.deleteQueue', this.onDeleteQueue.bind(this));
    Hooks.on('youtubeDJ.renameQueue', this.onRenameQueue.bind(this));
  }

  /**
   * Get all saved queues
   */
  getSavedQueues(): SavedQueue[] {
    const savedQueues = game.settings.get('core', 'youtubeDJ.savedQueues') as SavedQueue[];
    return savedQueues || [];
  }

  /**
   * Get a saved queue by ID
   */
  getSavedQueue(queueId: string): SavedQueue | null {
    const savedQueues = this.getSavedQueues();
    return savedQueues.find(q => q.id === queueId) || null;
  }

  /**
   * Save the current queue
   */
  async saveCurrentQueue(options: SaveQueueOptions): Promise<SavedQueue> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can save queues');
    }

    const { name, overwrite = false } = options;

    if (!name || name.trim().length === 0) {
      throw new Error('Queue name is required');
    }

    const trimmedName = name.trim();
    const savedQueues = this.getSavedQueues();
    
    // Check if name already exists
    const existingQueue = savedQueues.find(q => q.name.toLowerCase() === trimmedName.toLowerCase());
    if (existingQueue && !overwrite) {
      throw new Error(`A queue named "${trimmedName}" already exists. Choose a different name or enable overwrite.`);
    }

    // Get current queue items
    const currentQueue = this.store.getQueueState();
    if (currentQueue.items.length === 0) {
      throw new Error('Cannot save an empty queue');
    }

    const userId = game.user?.id;
    const userName = game.user?.name;
    
    if (!userId || !userName) {
      throw new Error('No user context available');
    }

    const now = Date.now();
    
    // Create or update saved queue
    const savedQueue: SavedQueue = existingQueue ? {
      ...existingQueue,
      items: [...currentQueue.items], // Deep copy items
      updatedAt: now
    } : {
      id: `queue_${userId}_${now}`,
      name: trimmedName,
      items: [...currentQueue.items], // Deep copy items
      createdBy: userName,
      createdAt: now,
      updatedAt: now
    };

    // Update saved queues list
    let updatedQueues: SavedQueue[];
    if (existingQueue) {
      updatedQueues = savedQueues.map(q => q.id === existingQueue.id ? savedQueue : q);
    } else {
      updatedQueues = [...savedQueues, savedQueue];
    }

    // Sort by name for easier browsing
    updatedQueues.sort((a, b) => a.name.localeCompare(b.name));

    // Save to world settings
    await game.settings.set('core', 'youtubeDJ.savedQueues', updatedQueues);

    // Update queue state to track this as the currently loaded queue
    this.store.updateState({
      queue: {
        ...currentQueue,
        currentlyLoadedQueueId: savedQueue.id,
        isModifiedFromSaved: false
      }
    });

    // Broadcast save event
    this.broadcastMessage({
      type: 'QUEUE_SAVED',
      userId: userId,
      timestamp: now,
      data: { 
        savedQueue,
        isOverwrite: !!existingQueue
      }
    });

    logger.info('🎵 YouTube DJ | Queue saved:', savedQueue.name);
    ui.notifications?.success(`Queue saved as "${savedQueue.name}"`);
    
    return savedQueue;
  }

  /**
   * Load a saved queue
   */
  async loadSavedQueue(options: LoadQueueOptions): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can load saved queues');
    }

    const { queueId, replace = false } = options;
    
    const savedQueue = this.getSavedQueue(queueId);
    if (!savedQueue) {
      throw new Error('Saved queue not found');
    }

    logger.debug('🎵 YouTube DJ | Loading saved queue:', savedQueue.name);

    const currentQueue = this.store.getQueueState();
    let newItems: VideoItem[];

    if (replace) {
      // Replace current queue with saved queue
      newItems = [...savedQueue.items];
    } else {
      // Append saved queue to current queue
      newItems = [...currentQueue.items, ...savedQueue.items];
    }

    // Update queue state with tracking
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newItems,
        currentIndex: replace && newItems.length > 0 ? 0 : currentQueue.currentIndex,
        // Track the loaded queue only if we replaced (not if we appended)
        currentlyLoadedQueueId: replace ? queueId : null,
        isModifiedFromSaved: false
      }
    });

    // If we replaced the queue and have items, cue (not play) the first one
    // This loads the video without affecting playback state or audio settings
    // Only the DJ should cue the video - listeners will receive it via sync
    if (replace && newItems.length > 0 && this.store.isDJ()) {
      const firstItem = newItems[0];
      // Use cueVideo instead of loadVideo to avoid auto-play
      // This preserves user's mute/volume settings
      Hooks.callAll('youtubeDJ.cueVideo', {
        videoId: firstItem.videoId,
        videoInfo: {
          videoId: firstItem.videoId,
          title: firstItem.title,
          duration: 0
        },
        autoPlay: false // Explicitly don't auto-play
      });
    }

    // Broadcast the updated queue state to all listeners
    // This ensures the queue is synced across all connected users
    this.broadcastMessage({
      type: 'QUEUE_SYNC',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: {
        items: newItems,
        currentIndex: replace && newItems.length > 0 ? 0 : currentQueue.currentIndex,
        replace
      }
    });

    // Broadcast load event (metadata about what was loaded)
    this.broadcastMessage({
      type: 'QUEUE_LOADED',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { 
        queueName: savedQueue.name,
        queueId: savedQueue.id,
        itemCount: savedQueue.items.length,
        replace
      }
    });

    logger.info('🎵 YouTube DJ | Queue loaded:', savedQueue.name);
    ui.notifications?.success(`Queue "${savedQueue.name}" loaded (${savedQueue.items.length} tracks)`);
  }

  /**
   * Delete a saved queue
   */
  async deleteSavedQueue(queueId: string): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can delete saved queues');
    }

    const savedQueues = this.getSavedQueues();
    const queueToDelete = savedQueues.find(q => q.id === queueId);
    
    if (!queueToDelete) {
      throw new Error('Saved queue not found');
    }

    logger.debug('🎵 YouTube DJ | Deleting saved queue:', queueToDelete.name);

    // Remove from saved queues
    const updatedQueues = savedQueues.filter(q => q.id !== queueId);
    
    // Save to world settings
    await game.settings.set('core', 'youtubeDJ.savedQueues', updatedQueues);

    // Broadcast delete event
    this.broadcastMessage({
      type: 'QUEUE_DELETED',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { 
        queueName: queueToDelete.name,
        queueId: queueToDelete.id
      }
    });

    logger.info('🎵 YouTube DJ | Queue deleted:', queueToDelete.name);
    ui.notifications?.success(`Queue "${queueToDelete.name}" deleted`);
  }

  /**
   * Rename a saved queue
   */
  async renameSavedQueue(queueId: string, newName: string): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can rename saved queues');
    }

    if (!newName || newName.trim().length === 0) {
      throw new Error('New queue name is required');
    }

    const trimmedName = newName.trim();
    const savedQueues = this.getSavedQueues();
    const queueToRename = savedQueues.find(q => q.id === queueId);
    
    if (!queueToRename) {
      throw new Error('Saved queue not found');
    }

    // Check if new name already exists (excluding current queue)
    const nameExists = savedQueues.some(q => 
      q.id !== queueId && q.name.toLowerCase() === trimmedName.toLowerCase()
    );
    
    if (nameExists) {
      throw new Error(`A queue named "${trimmedName}" already exists`);
    }

    logger.debug('🎵 YouTube DJ | Renaming saved queue:', {
      oldName: queueToRename.name,
      newName: trimmedName
    });

    // Update queue name
    const updatedQueue = {
      ...queueToRename,
      name: trimmedName,
      updatedAt: Date.now()
    };

    // Update saved queues list
    const updatedQueues = savedQueues.map(q => q.id === queueId ? updatedQueue : q);
    
    // Sort by name for easier browsing
    updatedQueues.sort((a, b) => a.name.localeCompare(b.name));
    
    // Save to world settings
    await game.settings.set('core', 'youtubeDJ.savedQueues', updatedQueues);

    // Broadcast rename event
    this.broadcastMessage({
      type: 'QUEUE_RENAMED',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { 
        queueId,
        oldName: queueToRename.name,
        newName: trimmedName
      }
    });

    logger.info('🎵 YouTube DJ | Queue renamed:', {
      from: queueToRename.name,
      to: trimmedName
    });
    ui.notifications?.success(`Queue renamed to "${trimmedName}"`);
  }

  /**
   * Save changes to the currently loaded saved queue
   */
  async saveChangesToCurrentQueue(): Promise<SavedQueue | null> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can save queue changes');
    }

    const currentQueue = this.store.getQueueState();
    
    // Check if there's a currently loaded saved queue
    if (!currentQueue.currentlyLoadedQueueId) {
      throw new Error('No saved queue is currently loaded. Use "Save Queue" to create a new saved queue.');
    }

    // Check if the queue has been modified
    if (!currentQueue.isModifiedFromSaved) {
      ui.notifications?.info('No changes to save - queue is already up to date');
      return null;
    }

    const savedQueue = this.getSavedQueue(currentQueue.currentlyLoadedQueueId);
    if (!savedQueue) {
      throw new Error('Currently loaded saved queue not found');
    }

    if (currentQueue.items.length === 0) {
      throw new Error('Cannot save an empty queue');
    }

    logger.debug('🎵 YouTube DJ | Saving changes to currently loaded queue:', savedQueue.name);

    // Create updated saved queue
    const updatedQueue: SavedQueue = {
      ...savedQueue,
      items: [...currentQueue.items], // Deep copy current items
      updatedAt: Date.now()
    };

    // Update saved queues list
    const savedQueues = this.getSavedQueues();
    const updatedQueues = savedQueues.map(q => 
      q.id === currentQueue.currentlyLoadedQueueId ? updatedQueue : q
    );

    // Save to world settings
    await game.settings.set('core', 'youtubeDJ.savedQueues', updatedQueues);

    // Update queue state to reflect saved changes
    this.store.updateState({
      queue: {
        ...currentQueue,
        isModifiedFromSaved: false
      }
    });

    // Broadcast save event
    this.broadcastMessage({
      type: 'QUEUE_SAVED',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { 
        savedQueue: updatedQueue,
        isOverwrite: true,
        isCurrentQueueUpdate: true
      }
    });

    logger.info('🎵 YouTube DJ | Changes saved to queue:', savedQueue.name);
    ui.notifications?.success(`Changes saved to "${savedQueue.name}"`);
    
    return updatedQueue;
  }

  /**
   * Get information about the currently loaded saved queue
   */
  getCurrentlyLoadedQueue(): { savedQueue: SavedQueue | null; hasChanges: boolean } {
    const currentQueue = this.store.getQueueState();
    
    if (!currentQueue.currentlyLoadedQueueId) {
      return { savedQueue: null, hasChanges: false };
    }

    const savedQueue = this.getSavedQueue(currentQueue.currentlyLoadedQueueId);
    return { 
      savedQueue, 
      hasChanges: currentQueue.isModifiedFromSaved 
    };
  }

  /**
   * Mark the current queue as modified from the saved version
   */
  markQueueAsModified(): void {
    const currentQueue = this.store.getQueueState();
    
    if (currentQueue.currentlyLoadedQueueId && !currentQueue.isModifiedFromSaved) {
      this.store.updateState({
        queue: {
          ...currentQueue,
          isModifiedFromSaved: true
        }
      });
      
      logger.debug('🎵 YouTube DJ | Queue marked as modified from saved version');
    }
  }

  /**
   * Clear the currently loaded queue tracking (when creating a new queue from scratch)
   */
  clearCurrentlyLoadedQueue(): void {
    const currentQueue = this.store.getQueueState();
    
    if (currentQueue.currentlyLoadedQueueId || currentQueue.isModifiedFromSaved) {
      this.store.updateState({
        queue: {
          ...currentQueue,
          currentlyLoadedQueueId: null,
          isModifiedFromSaved: false
        }
      });
      
      logger.debug('🎵 YouTube DJ | Cleared currently loaded queue tracking');
    }
  }

  /**
   * Export a saved queue to JSON
   */
  exportSavedQueue(queueId: string): string {
    const savedQueue = this.getSavedQueue(queueId);
    if (!savedQueue) {
      throw new Error('Saved queue not found');
    }

    return JSON.stringify(savedQueue, null, 2);
  }

  /**
   * Import a saved queue from JSON
   */
  async importSavedQueue(jsonData: string, overwrite: boolean = false): Promise<SavedQueue> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can import saved queues');
    }

    let importedQueue: SavedQueue;
    try {
      importedQueue = JSON.parse(jsonData);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }

    // Validate structure
    if (!importedQueue.name || !Array.isArray(importedQueue.items)) {
      throw new Error('Invalid queue format');
    }

    // Generate new ID to avoid conflicts
    const userId = game.user?.id;
    const userName = game.user?.name;
    
    if (!userId || !userName) {
      throw new Error('No user context available');
    }

    const now = Date.now();
    importedQueue.id = `queue_${userId}_${now}`;
    importedQueue.createdBy = userName;
    importedQueue.createdAt = now;
    importedQueue.updatedAt = now;

    // Check if name already exists
    const savedQueues = this.getSavedQueues();
    const existingQueue = savedQueues.find(q => 
      q.name.toLowerCase() === importedQueue.name.toLowerCase()
    );
    
    if (existingQueue && !overwrite) {
      // Append import timestamp to name to make it unique
      importedQueue.name = `${importedQueue.name} (Imported ${new Date(now).toLocaleDateString()})`;
    }

    // Add to saved queues
    let updatedQueues: SavedQueue[];
    if (existingQueue && overwrite) {
      updatedQueues = savedQueues.map(q => 
        q.id === existingQueue.id ? importedQueue : q
      );
    } else {
      updatedQueues = [...savedQueues, importedQueue];
    }

    // Sort by name
    updatedQueues.sort((a, b) => a.name.localeCompare(b.name));
    
    // Save to world settings
    await game.settings.set('core', 'youtubeDJ.savedQueues', updatedQueues);

    logger.info('🎵 YouTube DJ | Queue imported:', importedQueue.name);
    ui.notifications?.success(`Queue "${importedQueue.name}" imported`);
    
    return importedQueue;
  }

  /**
   * Handle save queue event from other users (for syncing)
   */
  private onSaveQueue(data: any): void {
    // Only process events from other users
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing saved queue from DJ:', data.savedQueue?.name);
    // UI components will react to the settings change
  }

  /**
   * Handle load queue event from DJ (for listeners)
   */
  private onLoadQueue(data: any): void {
    // Only process events from other users
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing loaded queue from DJ:', data.queueName);
    // Queue state will be updated through normal queue sync
  }

  /**
   * Handle delete queue event from DJ (for listeners)
   */
  private onDeleteQueue(data: any): void {
    // Only process events from other users
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing deleted queue from DJ:', data.queueName);
    // UI components will react to the settings change
  }

  /**
   * Handle rename queue event from DJ (for listeners)
   */
  private onRenameQueue(data: any): void {
    // Only process events from other users
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing renamed queue from DJ:', {
      from: data.oldName,
      to: data.newName
    });
    // UI components will react to the settings change
  }

  /**
   * Broadcast message via socket
   */
  private broadcastMessage(message: any): void {
    game.socket?.emit('module.bardic-inspiration', message);
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    Hooks.off('youtubeDJ.saveQueue', this.onSaveQueue.bind(this));
    Hooks.off('youtubeDJ.loadQueue', this.onLoadQueue.bind(this));
    Hooks.off('youtubeDJ.deleteQueue', this.onDeleteQueue.bind(this));
    Hooks.off('youtubeDJ.renameQueue', this.onRenameQueue.bind(this));
    logger.debug('🎵 YouTube DJ | SavedQueuesManager destroyed');
  }
}