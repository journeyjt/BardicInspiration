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

      // Show a styled dialog to select the user to hand off to
      const selectedUserId = await Dialog.prompt({
        title: 'Hand Off DJ Role',
        content: `
          <div class="bardic-inspiration-dialog handoff-dialog">
            <style>
              .bardic-inspiration-dialog {
                padding: 1rem;
              }
              .bardic-inspiration-dialog .form-group {
                margin-bottom: 1rem;
              }
              .bardic-inspiration-dialog label {
                display: block;
                margin-bottom: 0.5rem;
                color: var(--bardic-inspiration-text, #f8fafc);
                font-weight: 600;
                font-size: 0.95rem;
              }
              .bardic-inspiration-dialog select {
                width: 100%;
                padding: 0.625rem;
                background: var(--bardic-inspiration-bg-card, #1e293b);
                color: var(--bardic-inspiration-text, #f8fafc);
                border: 1px solid var(--bardic-inspiration-border, #475569);
                border-radius: var(--bardic-inspiration-radius, 0.5rem);
                font-size: 0.95rem;
                cursor: pointer;
                transition: all 0.2s ease;
              }
              .bardic-inspiration-dialog select:hover {
                border-color: var(--bardic-inspiration-primary, #2563eb);
                background: var(--bardic-inspiration-bg-elevated, #334155);
              }
              .bardic-inspiration-dialog select:focus {
                outline: none;
                border-color: var(--bardic-inspiration-primary, #2563eb);
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
              }
              .bardic-inspiration-dialog select option {
                background: var(--bardic-inspiration-bg-card, #1e293b);
                color: var(--bardic-inspiration-text, #f8fafc);
                padding: 0.5rem;
              }
              .bardic-inspiration-dialog .hint-text {
                margin-top: 0.5rem;
                color: var(--bardic-inspiration-text-muted, #94a3b8);
                font-size: 0.875rem;
                font-style: italic;
              }
              /* Style the dialog buttons */
              .dialog .dialog-buttons button {
                background: var(--bardic-inspiration-primary, #2563eb);
                color: white;
                border: none;
                padding: 0.625rem 1.5rem;
                border-radius: var(--bardic-inspiration-radius, 0.5rem);
                font-weight: 600;
                transition: all 0.2s ease;
              }
              .dialog .dialog-buttons button:hover {
                background: var(--bardic-inspiration-primary-hover, #1d4ed8);
                transform: translateY(-1px);
                box-shadow: var(--bardic-inspiration-shadow-md);
              }
            </style>
            <div class="form-group">
              <label>Select a user to hand off DJ role to:</label>
              <select name="targetUser">
                ${Object.entries(choices).map(([userId, name]) => 
                  `<option value="${userId}">${name}</option>`
                ).join('')}
              </select>
              <div class="hint-text">
                The selected user will become the new DJ and gain full control over playback.
              </div>
            </div>
          </div>
        `,
        label: 'Hand Off',
        callback: (html: JQuery) => {
          const form = html[0] as HTMLElement;
          const select = form.querySelector('select[name="targetUser"]') as HTMLSelectElement;
          return select?.value;
        },
        rejectClose: false
      });

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