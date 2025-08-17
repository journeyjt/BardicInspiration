/**
 * QueueSectionComponent - Manages queue display and controls
 * Isolated component that only re-renders for queue-related state changes
 */

import { BaseComponent, ComponentConfig } from '../BaseComponent.js';
import { SessionStore } from '../../state/SessionStore.js';
import { QueueManager } from '../../services/QueueManager.js';
import { PlayerManager } from '../../services/PlayerManager.js';
import { StateChangeEvent } from '../../state/StateTypes.js';
import { UIHelper } from '../UIHelper.js';
import { logger } from '../../lib/logger.js';

export class QueueSectionComponent extends BaseComponent {
  private queueManager: QueueManager;
  private playerManager: PlayerManager;

  constructor(
    store: SessionStore, 
    parentElement: HTMLElement, 
    queueManager: QueueManager,
    playerManager: PlayerManager
  ) {
    const config: ComponentConfig = {
      selector: '.queue-section',
      template: 'modules/bardic-inspiration/templates/components/queue-section.hbs',
      stateSubscriptions: [
        'queue.items',
        'queue.currentIndex',
        'session.djUserId', // Need to know DJ status for controls
        'player.isReady' // Need for enabling/disabling video input controls
      ]
    };

    super(store, parentElement, config);
    this.queueManager = queueManager;
    this.playerManager = playerManager;
  }

  /**
   * Prepare context data for queue section template
   */
  protected async prepareContext(): Promise<any> {
    const queueState = this.store.getQueueState();
    const playerState = this.store.getPlayerState();
    const isDJ = this.store.isDJ();

    return {
      // Queue state - enhance items with current status
      queue: queueState.items.map((item, index) => ({
        ...item,
        isCurrentItem: index === queueState.currentIndex
      })),
      currentQueueIndex: queueState.currentIndex,
      hasQueue: queueState.items.length > 0,
      
      // Control state
      isDJ,
      isPlayerReady: playerState.isReady
    };
  }

  /**
   * Override state change handling for queue-specific optimizations
   */
  protected onStateChanged(event: StateChangeEvent): void {
    const changes = event.changes;

    // Handle queue changes with scroll position preservation
    if (changes.queue !== undefined) {
      logger.debug('🎵 YouTube DJ | QueueSectionComponent updating for queue changes');
      
      // Save scroll position before render
      const scrollTop = this.componentElement?.scrollTop || 0;
      
      this.renderDebounced();
      
      // Restore scroll position after render (with a small delay for DOM update)
      if (scrollTop > 0) {
        setTimeout(() => {
          if (this.componentElement) {
            this.componentElement.scrollTop = scrollTop;
            logger.debug('🎵 YouTube DJ | Queue scroll position restored:', scrollTop);
          }
        }, 50);
      }
    }
    
    // Handle DJ status changes (affects queue controls visibility)
    else if (changes.session?.djUserId !== undefined) {
      logger.debug('🎵 YouTube DJ | QueueSectionComponent updating for DJ status change');
      this.renderDebounced();
    }
  }

  /**
   * Override selective update for queue-specific optimizations
   */
  async updateSelectively(changes: any): Promise<void> {
    if (!this.componentElement) return;

    // For queue highlighting changes only, do minimal DOM updates
    if (changes.queue?.currentIndex !== undefined && changes.queue?.items === undefined) {
      this.updateQueueHighlighting();
      return;
    }

    // For other changes, use full render with scroll preservation
    await this.render();
  }

  /**
   * Update only queue item highlighting without full re-render
   */
  private updateQueueHighlighting(): void {
    if (!this.componentElement) return;

    const queueState = this.store.getQueueState();
    const queueItems = this.componentElement.querySelectorAll('.queue-item');
    
    queueItems.forEach((item, index) => {
      item.classList.toggle('queue-item-current', index === queueState.currentIndex);
      
      // Update status indicators
      const statusIndicator = item.querySelector('.status-indicator');
      if (statusIndicator) {
        statusIndicator.remove();
      }
      
      if (index === queueState.currentIndex) {
        const positionDiv = item.querySelector('.queue-position');
        if (positionDiv) {
          const indicator = document.createElement('div');
          indicator.className = 'status-indicator now-playing';
          indicator.innerHTML = '<i class="fas fa-play"></i><span>Now Playing</span>';
          positionDiv.appendChild(indicator);
        }
      }
    });

    logger.debug('🎵 YouTube DJ | Queue highlighting updated selectively');
  }

  /**
   * Handle add to queue click
   */
  async onAddToQueueClick(): Promise<void> {
    const urlInput = this.componentElement?.querySelector('.youtube-url-input') as HTMLInputElement;
    if (!urlInput) return;

    const input = urlInput.value.trim();
    if (!input) {
      ui.notifications?.warn('Please enter a YouTube URL');
      return;
    }

    try {
      this.updateLoadingState(true);
      
      const videoId = UIHelper.extractVideoId(input);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Add to queue via QueueManager
      await this.queueManager.addVideo({
        videoId,
        url: input,
        title: `Video ${videoId}`, // Will be updated when loaded
        duration: 0
      });

      // Clear input
      urlInput.value = '';
      ui.notifications?.success('Video added to queue');

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to add video to queue:', error);
      ui.notifications?.error(`Failed to add video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.updateLoadingState(false);
    }
  }

  /**
   * Handle remove queue item click
   */
  async onRemoveQueueClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const queueId = button.closest('.remove-queue-btn')?.getAttribute('data-queue-id');
    
    if (!queueId) {
      logger.warn('🎵 YouTube DJ | No queue ID found for remove button');
      return;
    }

    try {
      await this.queueManager.removeVideo(queueId);
      ui.notifications?.success('Video removed from queue');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to remove video from queue:', error);
      ui.notifications?.error(`Failed to remove video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle move queue item up
   */
  async onMoveUpClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const indexStr = button.closest('.move-up-btn')?.getAttribute('data-index');
    
    if (!indexStr) {
      logger.warn('🎵 YouTube DJ | No index found for move up button');
      return;
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index) || index <= 0) {
      return;
    }

    try {
      await this.queueManager.moveItemUp(index);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to move queue item up:', error);
      ui.notifications?.error('Failed to reorder queue');
    }
  }

  /**
   * Handle move queue item down
   */
  async onMoveDownClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const indexStr = button.closest('.move-down-btn')?.getAttribute('data-index');
    
    if (!indexStr) {
      logger.warn('🎵 YouTube DJ | No index found for move down button');
      return;
    }

    const index = parseInt(indexStr, 10);
    const queueLength = this.store.getQueueState().items.length;
    
    if (isNaN(index) || index >= queueLength - 1) {
      return;
    }

    try {
      await this.queueManager.moveItemDown(index);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to move queue item down:', error);
      ui.notifications?.error('Failed to reorder queue');
    }
  }

  /**
   * Handle skip to queue item click
   */
  async onSkipToClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const indexStr = button.closest('.skip-to-btn')?.getAttribute('data-index');
    
    if (!indexStr) {
      logger.warn('🎵 YouTube DJ | No index found for skip to button');
      return;
    }

    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      return;
    }

    try {
      await this.queueManager.skipToIndex(index);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to skip to queue item:', error);
      ui.notifications?.error('Failed to skip to track');
    }
  }

  /**
   * Handle clear queue click
   */
  async onClearQueueClick(): Promise<void> {
    const confirmed = await UIHelper.confirmDialog(
      'Clear Queue',
      'Are you sure you want to clear the entire queue?',
      { defaultYes: false }
    );

    if (!confirmed) return;

    try {
      await this.queueManager.clearQueue();
      ui.notifications?.success('Queue cleared');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to clear queue:', error);
      ui.notifications?.error('Failed to clear queue');
    }
  }

  /**
   * Handle URL input keypress
   */
  onUrlInputKeypress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onAddToQueueClick();
    }
  }

  /**
   * Handle play next button click (add to queue at next position)
   */
  async onPlayNextClick(): Promise<void> {
    const urlInput = this.componentElement?.querySelector('.video-url-input') as HTMLInputElement;
    if (!urlInput) return;

    const input = urlInput.value.trim();
    if (!input) {
      ui.notifications?.warn('Please enter a YouTube URL');
      return;
    }

    try {
      const videoId = UIHelper.extractVideoId(input);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Fetch video metadata
      ui.notifications?.info('Fetching video information...');
      const videoInfo = await this.playerManager.fetchVideoInfo(videoId);

      // Add to queue with playNow flag
      await this.queueManager.addVideo(videoInfo, true); // playNow = true

      // Clear input
      urlInput.value = '';
      ui.notifications?.success('Video queued to play next');

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to queue video for next play:', error);
      ui.notifications?.error(`Failed to queue video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle load video button click (play now)
   */
  async onLoadVideoClick(): Promise<void> {
    const urlInput = this.componentElement?.querySelector('.video-url-input') as HTMLInputElement;
    if (!urlInput) return;

    const input = urlInput.value.trim();
    if (!input) {
      ui.notifications?.warn('Please enter a YouTube URL');
      return;
    }

    try {
      const videoId = UIHelper.extractVideoId(input);
      if (!videoId) {
        throw new Error('Invalid YouTube URL');
      }

      // Load video immediately (no need to fetch metadata for direct play)
      await this.playerManager.loadVideo(videoId);

      // Clear input
      urlInput.value = '';
      ui.notifications?.success('Video loaded');

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load video:', error);
      ui.notifications?.error(`Failed to load video: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update loading state for queue controls
   */
  private updateLoadingState(isLoading: boolean): void {
    if (!this.componentElement) return;

    const addButton = this.componentElement.querySelector('.add-to-queue-btn') as HTMLButtonElement;
    const urlInput = this.componentElement.querySelector('.youtube-url-input') as HTMLInputElement;

    if (addButton && urlInput) {
      addButton.disabled = isLoading;
      addButton.textContent = isLoading ? 'Adding...' : 'Add to Queue';
      urlInput.disabled = isLoading;
    }
  }
}