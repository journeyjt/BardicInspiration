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
        'queue.currentlyLoadedQueueId', // Need to know if a saved queue is loaded
        'queue.isModifiedFromSaved', // Need to know if changes exist
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
        authorName: playerState.currentVideo?.authorName,
        // Add playlist progress if available
        playlistInfo: playerState.playlistInfo
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

    // Get currently loaded queue info
    const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager;
    const currentlyLoadedInfo = savedQueuesManager ? savedQueuesManager.getCurrentlyLoadedQueue() : { savedQueue: null, hasChanges: false };

    return {
      // Currently playing item
      currentlyPlaying,
      
      // Upcoming queue items
      upcomingQueue,
      
      // Queue stats
      queueCount: upcomingQueue.length,
      hasQueue: queueState.items.length > 0,
      
      // Currently loaded queue info
      hasLoadedQueue: !!currentlyLoadedInfo.savedQueue,
      loadedQueueName: currentlyLoadedInfo.savedQueue?.name || '',
      hasLoadedQueueChanges: currentlyLoadedInfo.hasChanges,
      
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
      
      // Use QueueManager's validation which now handles playlists
      const validation = this.queueManager.validateVideoInput(input);
      
      if (!validation.isValid) {
        throw new Error(validation.error || 'Invalid YouTube URL');
      }

      // Handle playlist URLs differently
      if (validation.isPlaylist && validation.playlistId) {
        ui.notifications?.info('Adding YouTube playlist to queue...');
        
        // Add playlist to queue
        await this.queueManager.addPlaylist(validation.playlistId, input);
        
        // Clear input
        urlInput.value = '';
        ui.notifications?.success('Playlist added to queue');
      } else if (validation.videoId) {
        // Handle regular video URLs
        ui.notifications?.info('Fetching video information...');
        const videoInfo = await this.playerManager.fetchVideoInfo(validation.videoId);
        
        logger.debug('🎵 YouTube DJ | Video metadata fetched:', videoInfo);

        // Add to queue via QueueManager with proper metadata
        await this.queueManager.addVideo(videoInfo);

        // Clear input
        urlInput.value = '';
        ui.notifications?.success('Video added to queue');
      } else {
        throw new Error('Could not extract video or playlist ID');
      }

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to add to queue:', error);
      ui.notifications?.error(`Failed to add: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      
      // Check if queue has items to save
      const currentQueue = this.store.getQueueState();
      const hasItems = currentQueue.items.length > 0;
      
      // Import and show the ClearQueueDialog
      const { ClearQueueDialog } = await import('../ClearQueueDialog.js');
      const dialogResult = await ClearQueueDialog.show(hasItems);
      
      if (!dialogResult.confirmed) {
        logger.debug('🎵 YouTube DJ | Clear queue cancelled');
        return;
      }
      
      // Save queue if requested
      if (dialogResult.saveQueue && dialogResult.queueName) {
        try {
          const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager;
          if (savedQueuesManager) {
            await savedQueuesManager.saveCurrentQueue({ name: dialogResult.queueName });
            ui.notifications?.success(`Queue saved as "${dialogResult.queueName}"`);
          }
        } catch (error) {
          logger.error('🎵 YouTube DJ | Failed to save queue before clearing:', error);
          ui.notifications?.error('Failed to save queue, but proceeding with clear');
        }
      }

      // Clear the queue
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
   * Handle save queue button click
   */
  async onSaveQueueClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can save queues');
      return;
    }

    const currentQueue = this.store.getQueueState();
    if (currentQueue.items.length === 0) {
      ui.notifications?.warn('Cannot save an empty queue');
      return;
    }

    // Import and show the SaveQueueDialog
    const { SaveQueueDialog } = await import('../SaveQueueDialog.js');
    const result = await SaveQueueDialog.show();
    
    if (!result.confirmed || !result.queueName) return;

    try {
      const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager;
      if (savedQueuesManager) {
        await savedQueuesManager.saveCurrentQueue({ name: result.queueName });
      } else {
        ui.notifications?.error('Saved queues manager not initialized');
      }
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to save queue:', error);
      ui.notifications?.error('Failed to save queue');
    }
  }

  /**
   * Handle save changes button click
   */
  async onSaveChangesClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can save queue changes');
      return;
    }

    try {
      const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager;
      if (!savedQueuesManager) {
        ui.notifications?.error('Saved queues manager not initialized');
        return;
      }

      const result = await savedQueuesManager.saveChangesToCurrentQueue();
      if (!result) {
        // No changes to save message already shown by the manager
        return;
      }

      logger.debug('🎵 YouTube DJ | Queue changes saved successfully');
    } catch (error: any) {
      logger.error('🎵 YouTube DJ | Failed to save queue changes:', error);
      ui.notifications?.error(`Failed to save changes: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Handle load queue button click
   */
  async onLoadQueueClick(): Promise<void> {
    if (!this.store.isDJ()) {
      ui.notifications?.warn('Only the DJ can load queues');
      return;
    }

    const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager;
    if (!savedQueuesManager) {
      ui.notifications?.error('Saved queues manager not initialized');
      return;
    }

    const savedQueues = savedQueuesManager.getSavedQueues();
    if (savedQueues.length === 0) {
      ui.notifications?.info('No saved queues found');
      return;
    }

    // Import and show the LoadQueueDialog
    const { LoadQueueDialog } = await import('../LoadQueueDialog.js');
    const result = await LoadQueueDialog.show(savedQueues);
    
    if (!result || !result.confirmed) return;

    try {
      await savedQueuesManager.loadSavedQueue({
        queueId: result.queueId,
        replace: result.replace
      });
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load queue:', error);
      ui.notifications?.error('Failed to load queue');
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
      // Check if current item is a playlist
      const currentItem = this.queueManager.getCurrentVideo();
      
      if (currentItem?.isPlaylist) {
        // For playlists, send command to YouTube player to go to next video in playlist
        logger.debug('🎵 YouTube DJ | Skipping to next video in playlist');
        Hooks.callAll('youtubeDJ.playerCommand', {
          command: 'nextVideo'
        });
        
        // Broadcast the next video command to other users
        game.socket?.emit('module.bardic-inspiration', {
          type: 'PLAYLIST_NEXT',
          userId: game.user?.id || '',
          timestamp: Date.now()
        });
      } else {
        // For regular videos, advance to next queue item (with cycling)
        await this.queueManager.nextVideo();
      }
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