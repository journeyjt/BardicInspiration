/**
 * NowPlayingComponent - Manages now playing display
 * Isolated component that only re-renders for player-related state changes
 */

import { BaseComponent, ComponentConfig } from '../BaseComponent.js';
import { SessionStore } from '../../state/SessionStore.js';
import { StateChangeEvent } from '../../state/StateTypes.js';
import { logger } from '../../lib/logger.js';

export class NowPlayingComponent extends BaseComponent {

  constructor(store: SessionStore, parentElement: HTMLElement) {
    const config: ComponentConfig = {
      selector: '.player-status-section',
      template: 'modules/bardic-inspiration/templates/components/now-playing.hbs',
      stateSubscriptions: [
        'player.isReady',
        'player.currentVideo',
        'player.playbackState',
        'session.djUserId' // Need to know DJ status for display
      ]
    };

    super(store, parentElement, config);
  }

  /**
   * Prepare context data for now playing template
   */
  protected async prepareContext(): Promise<any> {
    const playerState = this.store.getPlayerState();
    const isDJ = this.store.isDJ();

    return {
      // Player state
      isPlayerReady: playerState.isReady,
      currentVideoTitle: playerState.currentVideo?.title || 'No video loaded',
      playerState: this.formatPlaybackState(playerState.playbackState),

      // DJ status
      isDJ
    };
  }

  /**
   * Override state change handling for now playing specific optimizations
   */
  protected onStateChanged(event: StateChangeEvent): void {
    const changes = event.changes;

    // Only render if player state or DJ status changes occurred
    if (changes.player?.isReady !== undefined ||
        changes.player?.currentVideo !== undefined ||
        changes.player?.playbackState !== undefined ||
        changes.session?.djUserId !== undefined) {
      
      logger.debug('🎵 YouTube DJ | NowPlayingComponent updating for player/DJ changes');
      this.renderDebounced();
    }
  }

  /**
   * Format playback state for display
   */
  private formatPlaybackState(state: string): string {
    switch (state) {
      case 'playing':
        return 'Playing';
      case 'paused':
        return 'Paused';
      case 'stopped':
        return 'Stopped';
      case 'buffering':
        return 'Buffering';
      case 'ended':
        return 'Ended';
      default:
        return 'Unknown';
    }
  }

  /**
   * Override selective update for now playing specific optimizations
   */
  async updateSelectively(changes: any): Promise<void> {
    if (!this.componentElement) return;

    // For playback state changes only, update status text without full re-render
    if (changes.player?.playbackState !== undefined && 
        Object.keys(changes.player).length === 1) {
      this.updatePlaybackStatusOnly();
      return;
    }

    // For other changes, use full render
    await this.render();
  }

  /**
   * Update only playback status text without full re-render
   */
  private updatePlaybackStatusOnly(): void {
    if (!this.componentElement) return;

    const playerState = this.store.getPlayerState();
    const statusElement = this.componentElement.querySelector('.playback-status');

    if (statusElement) {
      statusElement.textContent = this.formatPlaybackState(playerState.playbackState);
      logger.debug('🎵 YouTube DJ | Playback status updated selectively');
    }
  }
}