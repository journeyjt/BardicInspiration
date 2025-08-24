/**
 * Queue Manager - Handles queue operations and persistence
 * Part of Phase 2: Service Layer Extraction
 */

import { SessionStore } from '../state/SessionStore.js';
import { VideoItem, VideoInfo, StateChangeEvent } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

export interface YouTubeDJMessage {
  type: string;
  userId: string;
  timestamp: number;
  data?: any;
}

export class QueueManager {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
    
    // Listen to state changes and video events
    Hooks.on('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.on('youtubeDJ.videoEnded', this.onVideoEnded.bind(this));
    
    // Listen to queue events from other users
    Hooks.on('youtubeDJ.queueNext', this.onQueueNext.bind(this));
    Hooks.on('youtubeDJ.queueAdd', this.onQueueAdd.bind(this));
    Hooks.on('youtubeDJ.queueRemove', this.onQueueRemove.bind(this));
    Hooks.on('youtubeDJ.queueUpdate', this.onQueueUpdate.bind(this));
    Hooks.on('youtubeDJ.queueClear', this.onQueueClear.bind(this));
  }

  /**
   * Check if user can add videos to queue
   */
  private canAddToQueue(): boolean {
    // Check if Group Mode is enabled
    const groupMode = game.settings.get('bardic-inspiration', 'youtubeDJ.groupMode') as boolean;
    
    if (groupMode) {
      // In Group Mode, any user in the session can add videos
      const sessionState = this.store.getSessionState();
      const currentUserId = game.user?.id;
      return sessionState.hasJoinedSession && 
             sessionState.members.some(m => m.userId === currentUserId && m.isActive);
    } else {
      // In single-DJ mode, only the DJ can add videos
      return this.store.isDJ();
    }
  }

  /**
   * Add video to queue
   */
  async addVideo(videoInfo: VideoInfo, playNow: boolean = false): Promise<void> {
    if (!this.canAddToQueue()) {
      const groupMode = game.settings.get('bardic-inspiration', 'youtubeDJ.groupMode') as boolean;
      throw new Error(groupMode 
        ? 'You must be in the listening session to add videos to the queue' 
        : 'Only the DJ can add videos to the queue');
    }

    const userId = game.user?.id;
    const userName = game.user?.name;

    if (!userId || !userName) {
      throw new Error('No user context available');
    }

    logger.debug('🎵 YouTube DJ | Adding video to queue:', videoInfo.videoId);

    // Create queue item
    const queueItem: VideoItem = {
      id: `${videoInfo.videoId}_${Date.now()}`,
      videoId: videoInfo.videoId,
      title: videoInfo.title,
      addedBy: userName,
      addedAt: Date.now()
    };

    const currentQueue = this.store.getQueueState();
    let newQueue = [...currentQueue.items];
    let newIndex = currentQueue.currentIndex;

    if (playNow) {
      // Insert at current position + 1, or at beginning if no current video
      const insertIndex = newIndex >= 0 ? newIndex + 1 : 0;
      newQueue.splice(insertIndex, 0, queueItem);
      
      // If no video is currently playing, set this as current
      if (newIndex < 0) {
        newIndex = 0;
      }
    } else {
      // Add to end of queue
      newQueue.push(queueItem);
      
      // If queue was empty, set as current
      if (currentQueue.items.length === 0) {
        newIndex = 0;
      }
    }

    // Update queue state
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });

    // Broadcast queue update
    this.broadcastMessage({
      type: 'QUEUE_ADD',
      userId: userId,
      timestamp: Date.now(),
      data: { queueItem, playNow, queueLength: newQueue.length }
    });

    // If playing now and we have a current video, load it
    if (playNow && newIndex >= 0) {
      this.playQueueItem(newIndex);
    }

    logger.info('🎵 YouTube DJ | Video added to queue:', queueItem.title);
  }

  /**
   * Remove video from queue
   */
  async removeVideo(queueItemId: string): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can remove videos from queue');
    }

    logger.debug('🎵 YouTube DJ | Removing video from queue:', queueItemId);

    const currentQueue = this.store.getQueueState();
    const itemIndex = currentQueue.items.findIndex(item => item.id === queueItemId);

    if (itemIndex === -1) {
      throw new Error('Queue item not found');
    }

    const removedItem = currentQueue.items[itemIndex];
    const newQueue = currentQueue.items.filter(item => item.id !== queueItemId);
    let newIndex = currentQueue.currentIndex;

    // Adjust current index if necessary
    if (itemIndex < currentQueue.currentIndex) {
      // Removed item was before current, decrease index
      newIndex = currentQueue.currentIndex - 1;
    } else if (itemIndex === currentQueue.currentIndex) {
      // Removed current item
      if (newQueue.length === 0) {
        newIndex = -1; // No more items
      } else if (newIndex >= newQueue.length) {
        newIndex = newQueue.length - 1; // Adjust to last item
      }
      // If current item was removed, we might need to load the new current item
    }

    // Update queue state
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });

    // Broadcast queue update
    this.broadcastMessage({
      type: 'QUEUE_REMOVE',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { queueItemId, removedItem, queueLength: newQueue.length }
    });

    // If we removed the currently playing item, load the new current item
    if (itemIndex === currentQueue.currentIndex && newIndex >= 0 && newIndex < newQueue.length) {
      this.playQueueItem(newIndex);
    }

    logger.info('🎵 YouTube DJ | Video removed from queue:', removedItem.title);
  }

  /**
   * Reorder queue items
   */
  async reorderQueue(fromIndex: number, toIndex: number): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can reorder queue');
    }

    logger.debug('🎵 YouTube DJ | Reordering queue:', { fromIndex, toIndex });

    const currentQueue = this.store.getQueueState();
    
    if (fromIndex < 0 || fromIndex >= currentQueue.items.length ||
        toIndex < 0 || toIndex >= currentQueue.items.length) {
      throw new Error('Invalid queue indices');
    }

    const newQueue = [...currentQueue.items];
    const [movedItem] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, movedItem);

    // Adjust current index if necessary
    let newIndex = currentQueue.currentIndex;
    if (currentQueue.currentIndex === fromIndex) {
      // Moving the current item
      newIndex = toIndex;
    } else if (fromIndex < currentQueue.currentIndex && toIndex >= currentQueue.currentIndex) {
      // Moving item from before current to after current
      newIndex = currentQueue.currentIndex - 1;
    } else if (fromIndex > currentQueue.currentIndex && toIndex <= currentQueue.currentIndex) {
      // Moving item from after current to before current
      newIndex = currentQueue.currentIndex + 1;
    }

    // Update queue state
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });

    // Broadcast queue update
    this.broadcastMessage({
      type: 'QUEUE_UPDATE',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { fromIndex, toIndex, queueLength: newQueue.length }
    });

    logger.info('🎵 YouTube DJ | Queue reordered');
  }

  /**
   * Move queue item up
   */
  async moveItemUp(index: number): Promise<void> {
    if (index <= 0) {
      throw new Error('Cannot move first item up');
    }
    await this.reorderQueue(index, index - 1);
  }

  /**
   * Move queue item down
   */
  async moveItemDown(index: number): Promise<void> {
    const queueLength = this.store.getQueueState().items.length;
    if (index >= queueLength - 1) {
      throw new Error('Cannot move last item down');
    }
    await this.reorderQueue(index, index + 1);
  }

  /**
   * Play next video in queue (with auto-cycling)
   */
  async nextVideo(): Promise<VideoItem | null> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control queue playback');
    }

    const currentQueue = this.store.getQueueState();
    
    // If we have a currently playing item, move it to the end of the queue
    if (currentQueue.currentIndex >= 0 && currentQueue.items[currentQueue.currentIndex]) {
      const currentItem = currentQueue.items[currentQueue.currentIndex];
      let newQueue = [...currentQueue.items];
      
      // Remove the current item from its position
      newQueue.splice(currentQueue.currentIndex, 1);
      
      // Add it to the end of the queue
      newQueue.push(currentItem);
      
      // After cycling, the next item moves into the current index position
      // Unless we were at the end, in which case we go to 0
      let newIndex = currentQueue.currentIndex;
      if (newQueue.length === 0) {
        newIndex = -1; // Queue is empty after removing the only item
      } else if (newIndex >= newQueue.length) {
        newIndex = 0; // Loop back to beginning if we were at the last item
      }
      
      // Update the queue with the cycled item
      this.store.updateState({
        queue: {
          ...currentQueue,
          items: newQueue,
          currentIndex: newIndex
        }
      });
      
      // Play the next item if there is one
      if (newIndex >= 0 && newQueue.length > 0) {
        const nextVideo = newQueue[newIndex];
        this.playQueueItem(newIndex);
        
        // Broadcast queue advance with cycling
        this.broadcastMessage({
          type: 'QUEUE_NEXT',
          userId: game.user?.id || '',
          timestamp: Date.now(),
          data: { 
            nextIndex: newIndex, 
            videoItem: nextVideo,
            cycledItem: currentItem,
            isCycling: true 
          }
        });
        
        logger.info('🎵 YouTube DJ | Advanced to next video, cycled previous to end:', nextVideo.title);
        return nextVideo;
      } else {
        logger.debug('🎵 YouTube DJ | Queue is now empty');
        return null;
      }
    } else {
      // No current item, try to play the first item if available
      if (currentQueue.items.length > 0) {
        this.store.updateState({
          queue: {
            ...currentQueue,
            currentIndex: 0
          }
        });
        
        const nextVideo = currentQueue.items[0];
        this.playQueueItem(0);
        
        // Broadcast queue start
        this.broadcastMessage({
          type: 'QUEUE_NEXT',
          userId: game.user?.id || '',
          timestamp: Date.now(),
          data: { nextIndex: 0, videoItem: nextVideo }
        });
        
        return nextVideo;
      } else {
        logger.debug('🎵 YouTube DJ | Queue is empty');
        return null;
      }
    }
  }

  /**
   * Play next video (for manual skip without cycling)
   */
  async playNext(): Promise<VideoItem | null> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control queue playback');
    }

    const currentQueue = this.store.getQueueState();
    const nextIndex = currentQueue.currentIndex + 1;

    if (nextIndex >= currentQueue.items.length) {
      // End of queue - check if we should loop
      if (currentQueue.items.length > 0) {
        // Restart from beginning
        logger.debug('🎵 YouTube DJ | End of queue reached, restarting from beginning');
        const newIndex = 0;
        this.store.updateState({
          queue: {
            ...currentQueue,
            currentIndex: newIndex
          }
        });
        
        const nextVideo = currentQueue.items[newIndex];
        this.playQueueItem(newIndex);
        
        // Broadcast next video (restart case)
        this.broadcastMessage({
          type: 'QUEUE_NEXT',
          userId: game.user?.id || '',
          timestamp: Date.now(),
          data: { nextIndex: newIndex, videoItem: nextVideo }
        });
        
        return nextVideo;
      } else {
        logger.debug('🎵 YouTube DJ | Queue is empty');
        return null;
      }
    }

    // Play next video
    this.store.updateState({
      queue: {
        ...currentQueue,
        currentIndex: nextIndex
      }
    });

    const nextVideo = currentQueue.items[nextIndex];
    this.playQueueItem(nextIndex);

    // Broadcast next video
    this.broadcastMessage({
      type: 'QUEUE_NEXT',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { nextIndex, videoItem: nextVideo }
    });

    return nextVideo;
  }

  /**
   * Play previous video in queue
   */
  async previousVideo(): Promise<VideoItem | null> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can control queue playback');
    }

    const currentQueue = this.store.getQueueState();
    const prevIndex = currentQueue.currentIndex - 1;

    if (prevIndex < 0) {
      // Beginning of queue - go to end
      if (currentQueue.items.length > 0) {
        const newIndex = currentQueue.items.length - 1;
        this.store.updateState({
          queue: {
            ...currentQueue,
            currentIndex: newIndex
          }
        });
        
        const prevVideo = currentQueue.items[newIndex];
        this.playQueueItem(newIndex);
        return prevVideo;
      } else {
        logger.debug('🎵 YouTube DJ | Queue is empty');
        return null;
      }
    }

    // Play previous video
    this.store.updateState({
      queue: {
        ...currentQueue,
        currentIndex: prevIndex
      }
    });

    const prevVideo = currentQueue.items[prevIndex];
    this.playQueueItem(prevIndex);

    return prevVideo;
  }

  /**
   * Get current video in queue
   */
  getCurrentVideo(): VideoItem | null {
    const currentQueue = this.store.getQueueState();
    if (currentQueue.currentIndex >= 0 && currentQueue.currentIndex < currentQueue.items.length) {
      return currentQueue.items[currentQueue.currentIndex];
    }
    return null;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.store.getQueueState().items.length;
  }

  /**
   * Check if queue has items
   */
  hasItems(): boolean {
    return this.getQueueLength() > 0;
  }

  /**
   * Clear entire queue
   */
  async clearQueue(): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only the DJ can clear the queue');
    }

    logger.debug('🎵 YouTube DJ | Clearing queue...');

    this.store.updateState({
      queue: {
        items: [],
        currentIndex: -1,
        mode: 'single-dj',
        djUserId: this.store.getSessionState().djUserId
      },
      player: {
        ...this.store.getPlayerState(),
        playbackState: 'paused'
      }
    });

    // Broadcast queue clear
    this.broadcastMessage({
      type: 'QUEUE_CLEAR',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });

    logger.info('🎵 YouTube DJ | Queue cleared');
  }

  /**
   * Skip to specific queue index
   */
  async skipToIndex(index: number): Promise<void> {
    if (!this.store.isDJ()) {
      throw new Error('Only DJ can skip to queue items');
    }

    const currentQueue = this.store.getQueueState();
    
    if (index < 0 || index >= currentQueue.items.length) {
      throw new Error('Invalid queue index');
    }

    if (index === currentQueue.currentIndex) {
      logger.debug('🎵 YouTube DJ | Already at requested queue index:', index);
      return;
    }

    logger.debug('🎵 YouTube DJ | Skipping to queue index:', index);

    // Update queue state
    this.store.updateState({
      queue: {
        ...currentQueue,
        currentIndex: index
      }
    });

    // Play the queue item at the specified index
    await this.playQueueItem(index);

    // Broadcast skip to index
    this.broadcastMessage({
      type: 'QUEUE_SKIP_TO',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: { index, videoItem: currentQueue.items[index] }
    });

    logger.info('🎵 YouTube DJ | Skipped to queue index:', index);
  }

  /**
   * Extract video ID from YouTube URL
   */
  extractVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Validate YouTube URL/ID
   */
  validateVideoInput(input: string): { isValid: boolean; videoId: string | null; error?: string } {
    if (!input || input.trim().length === 0) {
      return { isValid: false, videoId: null, error: 'Please enter a YouTube URL or video ID' };
    }

    const videoId = this.extractVideoId(input.trim());
    
    if (!videoId) {
      return { 
        isValid: false, 
        videoId: null, 
        error: 'Invalid YouTube URL or video ID format' 
      };
    }

    if (videoId.length !== 11) {
      return { 
        isValid: false, 
        videoId: null, 
        error: 'Invalid video ID length' 
      };
    }

    return { isValid: true, videoId };
  }

  /**
   * Play specific queue item
   */
  private async playQueueItem(index: number): Promise<void> {
    const currentQueue = this.store.getQueueState();
    
    if (index < 0 || index >= currentQueue.items.length) {
      logger.warn('🎵 YouTube DJ | Invalid queue index:', index);
      return;
    }

    const queueItem = currentQueue.items[index];
    
    // Validate video ID before playing
    if (!queueItem.videoId || queueItem.videoId.length !== 11) {
      logger.error('🎵 YouTube DJ | Invalid video ID in queue item:', {
        title: queueItem.title,
        videoId: queueItem.videoId,
        index
      });
      ui.notifications?.error(`Cannot play "${queueItem.title}" - invalid video ID`);
      return;
    }
    
    // Emit event for PlayerManager to handle
    Hooks.callAll('youtubeDJ.loadVideo', {
      videoId: queueItem.videoId,
      videoInfo: {
        videoId: queueItem.videoId,
        title: queueItem.title,
        duration: 0
      }
    });

    logger.debug('🎵 YouTube DJ | Playing queue item:', queueItem.title);
  }

  /**
   * Handle queue next event from DJ (for listeners)
   */
  private onQueueNext(data: { nextIndex: number; videoItem: any; timestamp: number; userId: string; cycledItem?: any; isCycling?: boolean }): void {
    // Don't sync our own changes (avoid double-processing)
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing queue next from DJ:', data.nextIndex);
    
    const currentQueue = this.store.getQueueState();
    let newQueue = [...currentQueue.items];
    
    // If this is a cycling operation, reorder the queue to match DJ
    if (data.isCycling && data.cycledItem && currentQueue.currentIndex >= 0) {
      // Remove the current item and add it to the end (same as DJ did)
      const cycledItemIndex = currentQueue.currentIndex;
      if (cycledItemIndex < newQueue.length) {
        const removedItem = newQueue.splice(cycledItemIndex, 1)[0];
        newQueue.push(removedItem);
      }
    }
    
    // Update queue to match DJ's state
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: data.nextIndex
      }
    });
  }

  /**
   * Handle queue add event from other users
   */
  private onQueueAdd(data: { queueItem: any; playNow: boolean; timestamp: number; userId: string }): void {
    // Don't sync our own changes (avoid double-adding)
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing queue add from user:', data.userId, '-', data.queueItem?.title);
    
    const currentQueue = this.store.getQueueState();
    const newQueue = [...currentQueue.items, data.queueItem];
    let newIndex = currentQueue.currentIndex;
    
    // If queue was empty, set as current
    if (currentQueue.items.length === 0) {
      newIndex = 0;
    }
    
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });
  }

  /**
   * Handle queue remove event from DJ (for listeners)
   */
  private onQueueRemove(data: { queueItemId: string; timestamp: number }): void {
    // Only update state if we're not the DJ (DJ already updated their state)
    if (this.store.isDJ()) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing queue remove from DJ:', data.queueItemId);
    
    const currentQueue = this.store.getQueueState();
    const itemIndex = currentQueue.items.findIndex(item => item.id === data.queueItemId);
    
    if (itemIndex === -1) {
      return; // Item not found
    }
    
    const newQueue = currentQueue.items.filter(item => item.id !== data.queueItemId);
    let newIndex = currentQueue.currentIndex;
    
    // Adjust current index if necessary
    if (itemIndex < currentQueue.currentIndex) {
      // Removed item was before current, decrease index
      newIndex = currentQueue.currentIndex - 1;
    } else if (itemIndex === currentQueue.currentIndex) {
      // Removed current item
      if (newQueue.length === 0) {
        newIndex = -1; // No more items
      } else if (newIndex >= newQueue.length) {
        newIndex = newQueue.length - 1; // Adjust to last item
      }
    }
    
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });
  }

  /**
   * Handle queue update/reorder event from DJ (for listeners)
   */
  private onQueueUpdate(data: { fromIndex: number; toIndex: number; timestamp: number }): void {
    // Only update state if we're not the DJ (DJ already updated their state)
    if (this.store.isDJ()) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing queue reorder from DJ:', { from: data.fromIndex, to: data.toIndex });
    
    const currentQueue = this.store.getQueueState();
    const newQueue = [...currentQueue.items];
    
    // Perform the same reorder operation
    const [movedItem] = newQueue.splice(data.fromIndex, 1);
    newQueue.splice(data.toIndex, 0, movedItem);
    
    // Adjust current index if necessary (same logic as local reorder)
    let newIndex = currentQueue.currentIndex;
    if (currentQueue.currentIndex === data.fromIndex) {
      // Moving the current item
      newIndex = data.toIndex;
    } else if (data.fromIndex < currentQueue.currentIndex && data.toIndex >= currentQueue.currentIndex) {
      // Moving item from before current to after current
      newIndex = currentQueue.currentIndex - 1;
    } else if (data.fromIndex > currentQueue.currentIndex && data.toIndex <= currentQueue.currentIndex) {
      // Moving item from after current to before current
      newIndex = currentQueue.currentIndex + 1;
    }
    
    this.store.updateState({
      queue: {
        ...currentQueue,
        items: newQueue,
        currentIndex: newIndex
      }
    });
  }

  /**
   * Handle queue clear event from DJ (for listeners)
   */
  private onQueueClear(data: { timestamp: number; userId: string }): void {
    // Don't sync our own changes (avoid double-processing)
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Syncing queue clear from DJ');
    
    // Clear the queue
    this.store.updateState({
      queue: {
        items: [],
        currentIndex: -1,
        mode: 'single-dj',
        djUserId: this.store.getSessionState().djUserId
      },
      player: {
        ...this.store.getPlayerState(),
        playbackState: 'paused'
      }
    });
  }

  /**
   * Handle video ended event
   */
  private async onVideoEnded(data: { videoId: string }): Promise<void> {
    if (!this.store.isDJ()) {
      return;
    }

    logger.debug('🎵 YouTube DJ | Video ended, auto-advancing to next...');
    
    try {
      await this.nextVideo();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to advance to next video:', error);
    }
  }

  /**
   * Handle state changes for queue management
   */
  private onStateChanged(event: StateChangeEvent): void {
    // React to specific state changes for queue management
    if (event.changes.queue !== undefined) {
      this.handleQueueStateChange(event.previous.queue, event.current.queue);
    }
  }

  /**
   * Handle queue state changes
   */
  private handleQueueStateChange(previous: any, current: any): void {
    // Additional business logic for queue state changes can go here
    if (previous.currentIndex !== current.currentIndex) {
      logger.debug('🎵 YouTube DJ | Queue index changed:', {
        from: previous.currentIndex,
        to: current.currentIndex
      });
    }

    if (previous.items.length !== current.items.length) {
      logger.debug('🎵 YouTube DJ | Queue length changed:', {
        from: previous.items.length,
        to: current.items.length
      });
    }
  }

  /**
   * Broadcast message via socket
   */
  private broadcastMessage(message: YouTubeDJMessage): void {
    // This will be handled by SocketManager in next step
    // For now, use direct socket communication
    game.socket?.emit('module.bardic-inspiration', message);
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    Hooks.off('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.off('youtubeDJ.videoEnded', this.onVideoEnded.bind(this));
    Hooks.off('youtubeDJ.queueNext', this.onQueueNext.bind(this));
    Hooks.off('youtubeDJ.queueAdd', this.onQueueAdd.bind(this));
    Hooks.off('youtubeDJ.queueRemove', this.onQueueRemove.bind(this));
    Hooks.off('youtubeDJ.queueUpdate', this.onQueueUpdate.bind(this));
    Hooks.off('youtubeDJ.queueClear', this.onQueueClear.bind(this));
    logger.debug('🎵 YouTube DJ | QueueManager destroyed');
  }
}