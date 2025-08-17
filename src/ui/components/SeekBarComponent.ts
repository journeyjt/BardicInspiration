/**
 * SeekBarComponent - Isolated seek bar control to prevent interference with other controls
 * Handles only playback position and seeking, with high-frequency updates
 */

import { BaseComponent, ComponentConfig } from '../BaseComponent.js';
import { SessionStore } from '../../state/SessionStore.js';
import { PlayerManager } from '../../services/PlayerManager.js';
import { StateChangeEvent } from '../../state/StateTypes.js';
import { UIHelper } from '../UIHelper.js';
import { logger } from '../../lib/logger.js';

export class SeekBarComponent extends BaseComponent {
  private playerManager: PlayerManager;

  constructor(
    store: SessionStore, 
    parentElement: HTMLElement, 
    playerManager: PlayerManager
  ) {
    const config: ComponentConfig = {
      selector: '.seek-bar-section',
      template: 'modules/bardic-inspiration/templates/components/seek-bar.hbs',
      stateSubscriptions: [
        'player.currentTime',
        'player.duration', 
        'player.isReady',
        'session.djUserId' // Need DJ status for enabling/disabling
      ]
    };

    super(store, parentElement, config);
    this.playerManager = playerManager;
  }

  /**
   * Prepare context data for seek bar template
   */
  protected async prepareContext(): Promise<any> {
    const playerState = this.store.getPlayerState();
    const isDJ = this.store.isDJ();

    return {
      // Player state - raw values for seek bar, formatted for display
      isPlayerReady: playerState.isReady,
      currentTime: playerState.currentTime, // Raw seconds for seek bar value
      currentTimeFormatted: UIHelper.formatTime(playerState.currentTime), // Formatted for display
      totalTime: UIHelper.formatTime(playerState.duration), // Formatted for display
      duration: playerState.duration, // Raw seconds for seek bar max
      
      // Control state
      isDJ,
      canSeek: isDJ && playerState.isReady
    };
  }

  /**
   * Override state change handling for seek-specific optimizations
   */
  protected onStateChanged(event: StateChangeEvent): void {
    const changes = event.changes;

    // For time-only updates, use ultra-efficient updates
    if (changes.player?.currentTime !== undefined && 
        Object.keys(changes.player).length === 1) {
      this.updateTimeDisplayOnly();
      return;
    }

    // For other changes (duration, ready state, DJ status), do full render
    if (changes.player !== undefined || changes.session?.djUserId !== undefined) {
      logger.debug('🎵 YouTube DJ | SeekBarComponent full render for state changes');
      this.renderDebounced();
    }
  }

  /**
   * Handle seek bar input (while dragging)
   */
  onSeekBarInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const time = parseFloat(input.value);
    
    // Update time display during drag without seeking
    const currentTimeDisplay = this.componentElement?.querySelector('.current-time');
    if (currentTimeDisplay) {
      currentTimeDisplay.textContent = UIHelper.formatTime(time);
    }
  }

  /**
   * Handle seek bar change (when released)
   */
  async onSeekBarChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const time = parseFloat(input.value);

    try {
      await this.playerManager.seekTo(time);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to seek:', error);
    }
  }

  /**
   * Ultra-efficient time-only updates that don't touch the DOM structure
   */
  private updateTimeDisplayOnly(): void {
    if (!this.componentElement) return;

    const playerState = this.store.getPlayerState();
    const seekBar = this.componentElement.querySelector('.seek-bar') as HTMLInputElement;
    const currentTimeDisplay = this.componentElement.querySelector('.current-time');

    // Only update if user isn't actively dragging the seek bar
    if (seekBar && !seekBar.matches(':focus')) {
      seekBar.value = playerState.currentTime.toString();
      seekBar.max = playerState.duration.toString();
    }

    // Always update time display
    if (currentTimeDisplay) {
      currentTimeDisplay.textContent = UIHelper.formatTime(playerState.currentTime);
    }
  }
}