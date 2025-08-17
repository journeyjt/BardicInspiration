/**
 * PlayerControlsComponent - Manages playback controls and video input
 * Isolated component that only re-renders for player-related state changes
 */

import { BaseComponent, ComponentConfig } from '../BaseComponent.js';
import { SessionStore } from '../../state/SessionStore.js';
import { PlayerManager } from '../../services/PlayerManager.js';
import { QueueManager } from '../../services/QueueManager.js';
import { StateChangeEvent } from '../../state/StateTypes.js';
import { UIHelper } from '../UIHelper.js';
import { logger } from '../../lib/logger.js';
import { SeekBarComponent } from './SeekBarComponent.js';

export class PlayerControlsComponent extends BaseComponent {
  private playerManager: PlayerManager;
  private queueManager: QueueManager;
  public seekBarComponent?: SeekBarComponent;

  constructor(
    store: SessionStore, 
    parentElement: HTMLElement, 
    playerManager: PlayerManager,
    queueManager: QueueManager
  ) {
    const config: ComponentConfig = {
      selector: '.player-controls-section',
      template: 'modules/bardic-inspiration/templates/components/player-controls.hbs',
      stateSubscriptions: [
        'player.isReady',
        'player.playbackState',
        'session.djUserId', // Need to know DJ status for controls
        'queue.items' // Need to know if queue has items
      ]
    };

    super(store, parentElement, config);
    this.playerManager = playerManager;
    this.queueManager = queueManager;
  }

  /**
   * Override render to initialize child components
   */
  async render(): Promise<void> {
    // First do the base render
    await super.render();
    
    // Initialize seek bar component only if user is DJ and container exists
    await this.initializeSeekBarIfNeeded();
  }

  /**
   * Initialize seek bar component only when appropriate
   */
  private async initializeSeekBarIfNeeded(): Promise<void> {
    const isDJ = this.store.isDJ();
    const seekBarContainer = this.componentElement?.querySelector('.seek-bar-section');

    // Only initialize if user is DJ and container exists
    if (isDJ && seekBarContainer && !this.seekBarComponent) {
      logger.debug('🎵 YouTube DJ | Initializing SeekBarComponent for DJ');
      this.seekBarComponent = new SeekBarComponent(
        this.store,
        this.componentElement!,
        this.playerManager
      );
      
      await this.seekBarComponent.initialize();
    } 
    // Clean up seek bar if user is no longer DJ or container doesn't exist
    else if (this.seekBarComponent && (!isDJ || !seekBarContainer)) {
      logger.debug('🎵 YouTube DJ | Destroying SeekBarComponent - no longer DJ or container missing');
      this.seekBarComponent.destroy();
      this.seekBarComponent = undefined;
    }
  }

  /**
   * Prepare context data for player controls template
   */
  protected async prepareContext(): Promise<any> {
    const playerState = this.store.getPlayerState();
    const queueState = this.store.getQueueState();
    const isDJ = this.store.isDJ();

    return {
      // Player state
      isPlayerReady: playerState.isReady,
      playerState: playerState.playbackState,

      // DJ status and controls
      isDJ,
      hasQueue: queueState.items.length > 0
    };
  }

  /**
   * Override state change handling for player-specific optimizations
   */
  protected onStateChanged(event: StateChangeEvent): void {
    const changes = event.changes;

    // Handle player state changes (excluding time updates which SeekBarComponent handles)
    if (changes.player !== undefined) {
      // Skip time-only updates - SeekBarComponent handles those
      if (changes.player.currentTime !== undefined && 
          Object.keys(changes.player).length === 1) {
        return;
      }
      // For other player changes (ready state, playback state), do full render
      logger.debug('🎵 YouTube DJ | PlayerControlsComponent full render for player changes');
      this.renderDebounced();
      return;
    }

    // Handle DJ or queue changes - these require full re-render and seek bar re-initialization
    if (changes.session?.djUserId !== undefined ||
        changes.queue?.items !== undefined) {
      logger.debug('🎵 YouTube DJ | PlayerControlsComponent updating for DJ/queue changes');
      this.renderDebounced();
      // Note: initializeSeekBarIfNeeded() will be called after render() completes
    }
  }

  /**
   * Handle play button click
   */
  async onPlayClick(): Promise<void> {
    try {
      await this.playerManager.play();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to play:', error);
    }
  }

  /**
   * Handle pause button click
   */
  async onPauseClick(): Promise<void> {
    try {
      await this.playerManager.pause();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to pause:', error);
    }
  }

  /**
   * Handle next track button click
   */
  async onNextTrackClick(): Promise<void> {
    try {
      await this.queueManager.nextVideo();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to skip to next track:', error);
    }
  }

  /**
   * Handle previous track button click
   */
  async onPreviousTrackClick(): Promise<void> {
    try {
      await this.queueManager.previousVideo();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to skip to previous track:', error);
    }
  }

  /**
   * Cleanup when component is destroyed
   */
  destroy(): void {
    if (this.seekBarComponent) {
      this.seekBarComponent.destroy();
      this.seekBarComponent = undefined;
    }
    super.destroy();
  }
}