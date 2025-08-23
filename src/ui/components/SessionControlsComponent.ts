/**
 * SessionControlsComponent - Manages DJ controls, session members, and DJ requests
 * 
 * Responsibilities:
 * - DJ role management (claim, release, request, handoff)
 * - Session member display and status
 * - DJ request approval/denial
 * 
 * State subscriptions: session.djUserId, session.members, session.activeRequests, session.isConnected
 * Only re-renders when session-related state changes occur
 */

import { BaseComponent, ComponentConfig } from '../BaseComponent.js';
import { SessionStore } from '../../state/SessionStore.js';
import { SessionManager } from '../../services/SessionManager.js';
import { StateChangeEvent } from '../../state/StateTypes.js';
import { logger } from '../../lib/logger.js';

export class SessionControlsComponent extends BaseComponent {
  private sessionManager: SessionManager;

  constructor(store: SessionStore, parentElement: HTMLElement, sessionManager: SessionManager) {
    const config: ComponentConfig = {
      selector: '.session-control-section',
      template: 'modules/bardic-inspiration/templates/components/session-controls.hbs',
      stateSubscriptions: [
        'session.djUserId',
        'session.members',
        'session.activeRequests',
        'session.isConnected'
      ]
    };

    super(store, parentElement, config);
    this.sessionManager = sessionManager;
  }

  /**
   * Prepare context data for session controls template
   */
  protected async prepareContext(): Promise<any> {
    const sessionState = this.store.getSessionState();
    const currentUserId = game.user?.id;
    const isDJ = this.store.isDJ();
    const djUser = sessionState.members.find(m => m.isDJ);

    return {
      // Session state
      isDJ,
      djUser: djUser?.name || null,
      isConnected: sessionState.isConnected,
      sessionMembers: sessionState.members,

      // DJ Management
      isGM: game.user?.isGM || false,
      djRequests: sessionState.activeRequests,
      hasDJRequests: sessionState.activeRequests.length > 0,
      canHandoffDJ: isDJ && sessionState.members.filter(m => m.isActive && !m.isDJ).length > 0
    };
  }

  /**
   * Override state change handling for session-specific optimizations
   */
  protected onStateChanged(event: StateChangeEvent): void {
    const changes = event.changes;

    // Only render if session-related changes occurred
    if (changes.session?.djUserId !== undefined ||
        changes.session?.members !== undefined ||
        changes.session?.activeRequests !== undefined ||
        changes.session?.isConnected !== undefined) {
      
      logger.debug('🎵 YouTube DJ | SessionControlsComponent updating for session changes');
      this.renderDebounced();
    }
  }

  /**
   * Handle DJ role claim
   */
  async onClaimDJClick(): Promise<void> {
    try {
      await this.sessionManager.claimDJRole();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to claim DJ role:', error);
      ui.notifications?.error(`Failed to claim DJ role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle DJ role release
   */
  async onReleaseDJClick(): Promise<void> {
    try {
      await this.sessionManager.releaseDJRole();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to release DJ role:', error);
    }
  }

  /**
   * Handle DJ role request
   */
  async onRequestDJClick(): Promise<void> {
    try {
      await this.sessionManager.requestDJRole();
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to request DJ role:', error);
    }
  }

  /**
   * Handle DJ handoff
   */
  async onHandoffDJClick(): Promise<void> {
    try {
      // Show dialog to select target user
      const sessionState = this.store.getSessionState();
      const eligibleMembers = sessionState.members.filter(m => m.isActive && !m.isDJ);
      
      if (eligibleMembers.length === 0) {
        ui.notifications?.warn('No eligible users to hand off DJ role to');
        return;
      }

      // Create options for the dialog
      const choices: Record<string, string> = {};
      eligibleMembers.forEach(member => {
        choices[member.userId] = member.name;
      });

      // Show handoff dialog using FoundryVTT v2 dialog system
      const result = await foundry.applications.api.DialogV2.wait({
        window: {
          title: 'Hand Off DJ Role',
          icon: 'fas fa-exchange-alt',
        },
        position: {
          width: 450,
        },
        content: `
          <form class="bardic-inspiration-dialog handoff-dialog">
            <div class="form-group">
              <label for="targetUser">Select a user to hand off DJ role to:</label>
            </div>
            <div class="form-group">
              <select name="targetUser" id="targetUser">
                ${Object.entries(choices).map(([userId, name]) => 
                  `<option value="${userId}">${name}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <div class="hint-text">
                The selected user will become the new DJ and gain full control over playback.
              </div>
            </div>
          </form>
        `,
        buttons: [
          {
            action: 'cancel',
            label: 'Cancel',
            icon: 'fas fa-times'
          },
          {
            action: 'confirm',
            label: 'Hand Off DJ Role',
            icon: 'fas fa-exchange-alt',
            callback: (event, button, dialog) => {
              const select = dialog.element.querySelector('select[name="targetUser"]') as HTMLSelectElement;
              return select?.value;
            }
          }
        ],
        modal: true,
        close: () => null
      });

      const selectedUserId = result;

      // If user selected someone, perform the handoff
      if (selectedUserId) {
        await this.sessionManager.handoffDJRole(selectedUserId);
        const selectedMember = eligibleMembers.find(m => m.userId === selectedUserId);
        ui.notifications?.success(`DJ role handed off to ${selectedMember?.name}`);
      }
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to handoff DJ role:', error);
      ui.notifications?.error('Failed to hand off DJ role');
    }
  }

  /**
   * Handle GM override
   */
  async onGMOverrideClick(): Promise<void> {
    if (!game.user?.isGM) {
      ui.notifications?.error('Only GMs can override DJ role');
      return;
    }

    try {
      await this.sessionManager.gmOverrideDJRole();
      ui.notifications?.success('GM override successful - you are now DJ');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to GM override DJ role:', error);
      ui.notifications?.error(`Failed to override DJ role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Handle DJ request approval
   */
  async onApproveDJRequestClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const requesterId = button.dataset.requesterId;
    
    if (!requesterId) {
      logger.warn('🎵 YouTube DJ | No requester ID found for DJ request approval');
      return;
    }

    try {
      await this.sessionManager.approveDJRequest(requesterId);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to approve DJ request:', error);
    }
  }

  /**
   * Handle DJ request denial
   */
  async onDenyDJRequestClick(event: Event): Promise<void> {
    const button = event.target as HTMLElement;
    const requesterId = button.dataset.requesterId;
    
    if (!requesterId) {
      logger.warn('🎵 YouTube DJ | No requester ID found for DJ request denial');
      return;
    }

    try {
      await this.sessionManager.denyDJRequest(requesterId);
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to deny DJ request:', error);
    }
  }
}