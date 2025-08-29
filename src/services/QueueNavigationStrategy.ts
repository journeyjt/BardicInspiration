/**
 * Strategy pattern for queue navigation operations
 * Extracted from QueueManager to reduce complexity
 */

import { SessionStore } from '../state/SessionStore.js';
import { VideoItem, QueueState } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

/**
 * Base interface for queue navigation strategies
 */
export interface QueueNavigationStrategy {
  canExecute(queueState: QueueState): boolean;
  execute(queueState: QueueState): QueueNavigationResult;
  getDescription(): string;
}

/**
 * Result of queue navigation operation
 */
export interface QueueNavigationResult {
  nextVideo: VideoItem | null;
  newQueue: VideoItem[];
  newIndex: number;
  cycledItem?: VideoItem;
  isCycling?: boolean;
}

/**
 * Strategy for cycling to next video in queue
 * Moves current video to end and advances to next
 */
export class CycleToNextStrategy implements QueueNavigationStrategy {
  canExecute(queueState: QueueState): boolean {
    return queueState.currentIndex >= 0 && 
           queueState.currentIndex < queueState.items.length &&
           queueState.items.length > 0;
  }

  execute(queueState: QueueState): QueueNavigationResult {
    const currentItem = queueState.items[queueState.currentIndex];
    const newQueue = [...queueState.items];
    
    // Remove current item from its position
    newQueue.splice(queueState.currentIndex, 1);
    
    // Add it to the end of the queue
    newQueue.push(currentItem);
    
    // Calculate new index
    let newIndex = this.calculateNewIndex(queueState.currentIndex, newQueue.length);
    
    const nextVideo = newIndex >= 0 ? newQueue[newIndex] : null;
    
    logger.info('🎵 YouTube DJ | Cycling queue - moved to end:', currentItem.title);
    
    return {
      nextVideo,
      newQueue,
      newIndex,
      cycledItem: currentItem,
      isCycling: true
    };
  }

  private calculateNewIndex(currentIndex: number, queueLength: number): number {
    if (queueLength === 0) {
      return -1; // Queue is empty
    }
    if (currentIndex >= queueLength) {
      return 0; // Loop back to beginning
    }
    return currentIndex; // Stay at same position (next item moved up)
  }

  getDescription(): string {
    return 'Cycling to next video in queue';
  }
}

/**
 * Strategy for starting queue from beginning
 * Used when no video is currently playing
 */
export class StartQueueStrategy implements QueueNavigationStrategy {
  canExecute(queueState: QueueState): boolean {
    return (queueState.currentIndex < 0 || 
            queueState.currentIndex >= queueState.items.length) &&
           queueState.items.length > 0;
  }

  execute(queueState: QueueState): QueueNavigationResult {
    const nextVideo = queueState.items[0];
    
    logger.info('🎵 YouTube DJ | Starting queue from beginning:', nextVideo.title);
    
    return {
      nextVideo,
      newQueue: queueState.items,
      newIndex: 0,
      isCycling: false
    };
  }

  getDescription(): string {
    return 'Starting queue from first video';
  }
}

/**
 * Strategy for empty queue
 */
export class EmptyQueueStrategy implements QueueNavigationStrategy {
  canExecute(queueState: QueueState): boolean {
    return queueState.items.length === 0;
  }

  execute(queueState: QueueState): QueueNavigationResult {
    logger.debug('🎵 YouTube DJ | Queue is empty');
    
    return {
      nextVideo: null,
      newQueue: [],
      newIndex: -1,
      isCycling: false
    };
  }

  getDescription(): string {
    return 'Queue is empty';
  }
}

/**
 * Factory for selecting appropriate navigation strategy
 */
export class QueueNavigationFactory {
  static createStrategy(queueState: QueueState): QueueNavigationStrategy {
    // Check for empty queue first
    if (new EmptyQueueStrategy().canExecute(queueState)) {
      return new EmptyQueueStrategy();
    }
    
    // Check if we can cycle to next
    if (new CycleToNextStrategy().canExecute(queueState)) {
      return new CycleToNextStrategy();
    }
    
    // Otherwise start from beginning
    if (new StartQueueStrategy().canExecute(queueState)) {
      return new StartQueueStrategy();
    }
    
    // Fallback to empty queue
    return new EmptyQueueStrategy();
  }
}

/**
 * Service for handling queue navigation broadcasts
 */
export class QueueNavigationBroadcaster {
  constructor(
    private broadcastMessage: (message: any) => void
  ) {}

  broadcast(result: QueueNavigationResult, userId: string): void {
    if (!result.nextVideo) {
      return; // Don't broadcast for empty queue
    }

    const message: any = {
      type: 'QUEUE_NEXT',
      userId: userId || '',
      timestamp: Date.now(),
      data: {
        nextIndex: result.newIndex,
        videoItem: result.nextVideo
      }
    };

    // Add cycling info if applicable
    if (result.isCycling && result.cycledItem) {
      message.data.cycledItem = result.cycledItem;
      message.data.isCycling = true;
    }

    this.broadcastMessage(message);
    
    logger.debug('🎵 YouTube DJ | Broadcasted queue navigation:', {
      nextVideo: result.nextVideo.title,
      newIndex: result.newIndex,
      isCycling: result.isCycling
    });
  }
}