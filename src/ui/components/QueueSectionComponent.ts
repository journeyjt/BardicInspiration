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
        'queue.mode', // Need to know queue mode for Group Mode
        'session.djUserId', // Need to know DJ status for controls
        'session.hasJoinedSession', // Need to know if user is in session
        'session.members', // Need to check if user is active member
        'player.isReady', // Need for enabling/disabling video input controls
        'player.playbackState', // Need for play/pause button state
        'player.currentVideo' // Need for currently playing metadata
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
    const sessionState = this.store.getSessionState();
    const isDJ = this.store.isDJ();
    
    // Check if Group Mode is enabled
    const groupMode = game.settings.get('bardic-inspiration', 'youtubeDJ.groupMode') as boolean;
    
    // Determine if user can add to queue
    const currentUserId = game.user?.id;
    const isActiveMember = sessionState.hasJoinedSession && 
                          sessionState.members.some(m => m.userId === currentUserId && m.isActive);
    const canAddToQueue = groupMode ? isActiveMember : isDJ;

    // Separate currently playing from upcoming queue
    let currentlyPlaying = null;
    let upcomingQueue = [];
    
    if (queueState.currentIndex >= 0 && queueState.items[queueState.currentIndex]) {
      // Get the currently playing item with additional metadata
      const currentItem = queueState.items[queueState.currentIndex];
      currentlyPlaying = {
        ...currentItem,
        // Add video metadata if available from player state
        thumbnailUrl: playerState.currentVideo?.thumbnailUrl,
        authorName: playerState.currentVideo?.authorName
      };
      
      // Get all items after the current one for the upcoming queue
      const startIndex = queueState.currentIndex + 1;
      upcomingQueue = queueState.items.slice(startIndex).map((item, index) => ({
        ...item,
        actualIndex: startIndex + index // Add the actual index in the full queue
      }));
    } else {
      // No currently playing item, all items are in upcoming queue
      upcomingQueue = queueState.items.map((item, index) => ({
        ...item,
        actualIndex: index // Add the actual index in the full queue
      }));
    }

    return {
      // Currently playing item
      currentlyPlaying,
      
      // Upcoming queue items
      upcomingQueue,
      
      // Queue stats
      queueCount: upcomingQueue.length,
      hasQueue: queueState.items.length > 0,
      
      // Playback state
      isPlaying: playerState.playbackState === 'playing',
      
      // Control state
      isDJ,
      canAddToQueue,
      groupMode,
      isPlayerReady: playerState.isReady,
      
      // Session state for UI hints
      isInSession: sessionState.hasJoinedSession,
      isActiveMember
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
    
    // Handle player state changes (affects play/pause button state)
    else if (changes.player !== undefined) {
      logger.debug('🎵 YouTube DJ | QueueSectionComponent updating for player state change');
      this.renderDebounced();
    }
    
    // For other subscribed state changes, use default behavior
    else {
      super.onStateChanged(event);
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

      // Fetch video metadata before adding to queue
      ui.notifications?.info('Fetching video information...');
      const videoInfo = await this.playerManager.fetchVideoInfo(videoId);
      
      logger.debug('🎵 YouTube DJ | Video metadata fetched:', videoInfo);

      // Add to queue via QueueManager with proper metadata
      await this.queueManager.addVideo(videoInfo);

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
    try {
      logger.debug('🎵 YouTube DJ | Clear queue button clicked');
      
      const confirmed = await UIHelper.confirmDialog(
        'Clear Queue',
        'Are you sure you want to clear the entire queue?',
        { 
          defaultYes: false,
          type: 'warning',
          icon: 'fas fa-trash',
          yesLabel: 'Clear Queue',
          noLabel: 'Cancel'
        }
      );

      logger.debug('🎵 YouTube DJ | Clear queue confirmation result:', confirmed);

      if (!confirmed) return;

      try {
        await this.queueManager.clearQueue();
        ui.notifications?.success('Queue cleared');
      } catch (error) {
        logger.error('🎵 YouTube DJ | Failed to clear queue:', error);
        ui.notifications?.error('Failed to clear queue');
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Error in onClearQueueClick:', error);
      ui.notifications?.error('Failed to show confirmation dialog');
    }
  }

  /**
   * Handle skip button click (skip currently playing)
   */
  async onSkipClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can skip tracks');
      return;
    }

    try {
      await this.queueManager.nextVideo();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to skip track:', error);
      ui.notifications?.error('Failed to skip track');
    }
  }

  /**
   * Handle play button click
   */
  async onPlayClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can control playback');
      return;
    }

    try {
      await this.playerManager.play();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to play:', error);
      ui.notifications?.error('Failed to play');
    }
  }

  /**
   * Handle pause button click
   */
  async onPauseClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can control playback');
      return;
    }

    try {
      await this.playerManager.pause();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to pause:', error);
      ui.notifications?.error('Failed to pause');
    }
  }

  /**
   * Handle start queue button click
   */
  async onStartQueueClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can start queue playback');
      return;
    }

    try {
      const queueState = this.store.getQueueState();
      
      if (queueState.items.length === 0) {
        ui.notifications?.warn('Queue is empty');
        return;
      }

      // Start playback from the first item in the queue
      if (queueState.currentIndex < 0 || queueState.currentIndex >= queueState.items.length) {
        // Set current index to 0 if invalid
        this.store.updateState({
          queue: {
            ...queueState,
            currentIndex: 0
          }
        });
      }

      await this.playerManager.play();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to start queue:', error);
      ui.notifications?.error('Failed to start queue playback');
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

  // Removed onPlayNextClick and onLoadVideoClick methods - users can reorder queue instead

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