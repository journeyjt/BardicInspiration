/**
 * HandoffDialog - DialogV2-based dialog for DJ role handoff
 */

import { logger } from '../lib/logger.js';

export interface SessionMember {
  userId: string;
  name: string;
  isActive: boolean;
  isDJ: boolean;
}

export interface HandoffDialogResult {
  confirmed: boolean;
  selectedUserId: string;
}

/**
 * DialogV2-based handoff dialog with consistent theming
 */
export class HandoffDialog {
  
  /**
   * Show handoff dialog
   */
  static async show(eligibleMembers: SessionMember[]): Promise<HandoffDialogResult | null> {
    if (eligibleMembers.length === 0) {
      ui.notifications?.warn('No eligible users to hand off DJ role to');
      return null;
    }

    const htmlContent = `
      <div class="bardic-handoff-dialog modern">
        <div class="dialog-header">
          <div class="header-content">
            <div class="header-icon">
              <i class="fas fa-exchange-alt"></i>
            </div>
            <div class="header-text">
              <h3>Hand Off DJ Role</h3>
              <p>Transfer DJ control to another active session member</p>
            </div>
          </div>
        </div>

        <div class="dialog-body">
          <div class="current-dj-section">
            <div class="section-header">
              <i class="fas fa-user-crown"></i>
              <span>Current DJ</span>
            </div>
            
            <div class="current-dj-card">
              <div class="dj-info">
                <div class="dj-avatar">
                  <i class="fas fa-headphones"></i>
                </div>
                <div class="dj-details">
                  <h4>${game.user?.name || 'You'}</h4>
                  <p>Currently controlling playback</p>
                </div>
              </div>
              <div class="handoff-arrow">
                <i class="fas fa-arrow-right"></i>
              </div>
            </div>
          </div>

          <div class="target-selection-section">
            <div class="section-header">
              <i class="fas fa-users"></i>
              <span>Select New DJ</span>
            </div>
            
            <div class="member-selector">
              <select name="targetUser" id="targetUser" class="modern-select">
                ${eligibleMembers.map(member => `
                  <option value="${member.userId}">
                    ${member.name}
                  </option>
                `).join('')}
              </select>
              
              <div class="selected-member-display" id="selectedMemberDisplay">
                <div class="member-card">
                  <div class="member-header">
                    <div class="member-icon">
                      <i class="fas fa-user"></i>
                    </div>
                    <div class="member-title">
                      <h4 id="selectedMemberName">${eligibleMembers[0]?.name || 'No member selected'}</h4>
                      <p>Will become new DJ</p>
                    </div>
                  </div>
                  
                  <div class="member-details">
                    <div class="detail-row">
                      <span class="detail-label">Status:</span>
                      <span class="detail-value active">Active in session</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Role:</span>
                      <span class="detail-value">Session Member</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="handoff-impact-section">
            <div class="section-header">
              <i class="fas fa-info-circle"></i>
              <span>What This Does</span>
            </div>
            
            <div class="impact-list">
              <div class="impact-item">
                <i class="fas fa-crown"></i>
                <span>Transfers full DJ control to selected user</span>
              </div>
              <div class="impact-item">
                <i class="fas fa-play-circle"></i>
                <span>New DJ can control playback, queue, and volume</span>
              </div>
              <div class="impact-item">
                <i class="fas fa-user-minus"></i>
                <span>You will become a regular session member</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | HandoffDialog opening with', eligibleMembers.length, 'eligible members');
      
      const dialogConfig = {
        window: {
          title: "Hand Off DJ Role",
          icon: "fas fa-exchange-alt"
        },
        position: {
          width: 450
        },
        modal: false,
        content: htmlContent,
        buttons: [
          {
            action: "handoff",
            label: "Hand Off Role",
            icon: "fas fa-exchange-alt",
            default: true,
            callback: (event: Event, button: HTMLElement, dialog: any) => {
              const selectElement = dialog.element.querySelector('#targetUser') as HTMLSelectElement;
              const selectedUserId = selectElement?.value;
              
              if (!selectedUserId) {
                ui.notifications?.warn('Please select a user to hand off the DJ role to');
                return false;
              }
              
              return { selectedUserId };
            }
          },
          {
            action: "cancel",
            label: "Cancel",
            icon: "fas fa-times",
            default: false
          }
        ],
        render: (element: HTMLElement, dialog: any) => {
          // Get the actual DOM element - DialogV2 might pass different parameters
          const domElement = element?.element?.[0] || element?.element || element;
          const actualDialog = dialog || element;
          
          // Add bardic-inspiration class to dialog for theming - with safety check
          if (domElement && typeof domElement.closest === 'function') {
            domElement.closest('.dialog-v2')?.classList.add('bardic-dialog');
          } else if (actualDialog?.element && typeof actualDialog.element.closest === 'function') {
            actualDialog.element.closest('.dialog-v2')?.classList.add('bardic-dialog');
          }
          
          // Add member selection change listener for preview update
          const selectElement = (domElement?.querySelector ? domElement.querySelector('#targetUser') : actualDialog?.element?.querySelector('#targetUser')) as HTMLSelectElement;
          const updatePreview = () => {
            const selectedOption = selectElement?.selectedOptions[0];
            if (selectedOption) {
              const userId = selectedOption.value;
              const selectedMember = eligibleMembers.find(m => m.userId === userId);
              if (selectedMember) {
                const selectedMemberNameEl = domElement?.querySelector ? domElement.querySelector('#selectedMemberName') : actualDialog?.element?.querySelector('#selectedMemberName');
                
                if (selectedMemberNameEl) {
                  selectedMemberNameEl.textContent = selectedMember.name;
                }
              }
            }
          };
          
          selectElement?.addEventListener('change', updatePreview);
        },
        close: () => null
      };
      
      const result = await foundry.applications.api.DialogV2.wait(dialogConfig);
      
      logger.debug('🎵 YouTube DJ | HandoffDialog result:', result);
      
      if (result && typeof result === 'object' && 'selectedUserId' in result) {
        return {
          confirmed: true,
          selectedUserId: result.selectedUserId
        };
      }
      
      return null;
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | HandoffDialog error:', error);
      return null;
    }
  }
}