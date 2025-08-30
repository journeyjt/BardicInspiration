/**
 * ClearQueueDialog - DialogV2-based dialog for clearing queue with save option
 */

import { logger } from '../lib/logger.js';

export interface ClearQueueDialogResult {
  confirmed: boolean;
  saveQueue: boolean;
  queueName: string;
}

/**
 * DialogV2-based clear queue dialog with save option and consistent theming
 */
export class ClearQueueDialog {
  
  /**
   * Show clear queue dialog with save option
   */
  static async show(hasItems: boolean = true): Promise<ClearQueueDialogResult> {
    const htmlContent = hasItems ? `
      <div class="bardic-clear-queue-dialog modern">
        <div class="dialog-header">
          <div class="header-content">
            <div class="header-icon warning">
              <i class="fas fa-trash-alt"></i>
            </div>
            <div class="header-text">
              <h3>Clear Queue</h3>
              <p>This action will remove all tracks from the current queue</p>
            </div>
          </div>
        </div>

        <div class="dialog-body">
          <div class="warning-section">
            <div class="warning-card">
              <div class="warning-icon">
                <i class="fas fa-exclamation-triangle"></i>
              </div>
              <div class="warning-content">
                <h4>Permanent Action</h4>
                <p>Are you sure you want to clear the entire queue? This action cannot be undone unless you save the queue first.</p>
              </div>
            </div>
          </div>

          <div class="save-option-section">
            <div class="section-header">
              <i class="fas fa-shield-alt"></i>
              <span>Backup Option</span>
            </div>
            
            <div class="save-option">
              <label class="option-toggle">
                <input type="checkbox" name="saveQueue" id="saveQueueCheckbox">
                <div class="toggle-content">
                  <div class="toggle-header">
                    <i class="fas fa-save"></i>
                    <span>Save current queue before clearing</span>
                  </div>
                  <p class="toggle-description">Recommended: Keep a backup copy of your current queue</p>
                </div>
              </label>
            </div>

            <div class="save-name-section" id="queueNameGroup" style="display: none;">
              <div class="input-wrapper">
                <input 
                  type="text" 
                  name="queueName" 
                  id="queueName" 
                  placeholder="Enter a name for the backup queue..."
                  class="modern-input"
                />
                <div class="input-help">
                  <i class="fas fa-info-circle"></i>
                  <span>This backup will be available in Load Queue</span>
                </div>
              </div>
            </div>
          </div>

          <div class="impact-section">
            <div class="section-header">
              <i class="fas fa-info-circle"></i>
              <span>What This Does</span>
            </div>
            
            <div class="impact-list">
              <div class="impact-item">
                <i class="fas fa-times-circle"></i>
                <span>Removes all tracks from the current queue</span>
              </div>
              <div class="impact-item">
                <i class="fas fa-stop-circle"></i>
                <span>Stops current playback if active</span>
              </div>
              <div class="impact-item positive">
                <i class="fas fa-check-circle"></i>
                <span>Gives you a fresh start for new music</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ` : `
      <div class="bardic-clear-queue-dialog modern empty">
        <div class="dialog-header">
          <div class="header-content">
            <div class="header-icon info">
              <i class="fas fa-info-circle"></i>
            </div>
            <div class="header-text">
              <h3>Queue Already Empty</h3>
              <p>There are no tracks to clear from the queue</p>
            </div>
          </div>
        </div>

        <div class="dialog-body">
          <div class="empty-state">
            <div class="empty-icon">
              <i class="fas fa-list-alt"></i>
            </div>
            <div class="empty-content">
              <h4>Nothing to Clear</h4>
              <p>The queue is already empty. Add some tracks to your queue and then you can clear them if needed.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | ClearQueueDialog opening, hasItems:', hasItems);
      
      const dialogConfig = {
        window: {
          title: "Clear Queue",
          icon: hasItems ? "fas fa-trash" : "fas fa-info-circle"
        },
        position: {
          width: 450
        },
        modal: false,
        content: htmlContent,
        buttons: hasItems ? [
          {
            action: "clear",
            label: "Clear Queue",
            icon: "fas fa-trash",
            default: false,
            callback: (event: Event, button: HTMLElement, dialog: any) => {
              const saveQueueCheckbox = dialog.element.querySelector('#saveQueueCheckbox') as HTMLInputElement;
              const queueNameInput = dialog.element.querySelector('#queueName') as HTMLInputElement;
              
              const saveQueue = saveQueueCheckbox?.checked || false;
              const queueName = queueNameInput?.value?.trim() || '';
              
              if (saveQueue && !queueName) {
                ui.notifications?.warn('Please enter a name for the saved queue');
                return false; // Prevent dialog from closing
              }
              
              return { saveQueue, queueName };
            }
          },
          {
            action: "cancel",
            label: "Cancel",
            icon: "fas fa-times",
            default: true
          }
        ] : [
          {
            action: "ok",
            label: "OK",
            icon: "fas fa-check",
            default: true
          }
        ],
        render: (element: HTMLElement) => {
          // Add bardic-inspiration class to dialog for theming
          // The element parameter might be the application instance or jQuery object
          // so we need to get the actual HTML element
          const actualElement = element ? 
            ((element as any).element?.[0] || (element as any)[0] || element) : 
            null;
          
          if (actualElement && actualElement.closest) {
            actualElement.closest('.dialog-v2')?.classList.add('bardic-dialog');
          } else {
            // Fallback: try to find the dialog element in the document
            setTimeout(() => {
              document.querySelector('.dialog-v2:last-of-type')?.classList.add('bardic-dialog');
            }, 0);
          }
          
          if (hasItems && element) {
            // Handle checkbox change to show/hide queue name input
            const searchElement = actualElement && actualElement.querySelector ? actualElement : element;
            const checkbox = searchElement?.querySelector?.('#saveQueueCheckbox') as HTMLInputElement;
            const queueNameGroup = searchElement?.querySelector?.('#queueNameGroup') as HTMLElement;
            const queueNameInput = searchElement?.querySelector?.('#queueName') as HTMLInputElement;
            
            checkbox?.addEventListener('change', () => {
              if (checkbox.checked && queueNameGroup) {
                queueNameGroup.style.display = 'block';
                setTimeout(() => queueNameInput?.focus(), 100);
              } else if (queueNameGroup) {
                queueNameGroup.style.display = 'none';
              }
            });
          }
        },
        close: () => ({ confirmed: false, saveQueue: false, queueName: '' })
      };
      
      const result = await foundry.applications.api.DialogV2.wait(dialogConfig);
      
      logger.debug('🎵 YouTube DJ | ClearQueueDialog result:', result);
      
      if (result === 'ok') {
        // Empty queue case - just acknowledged
        return {
          confirmed: false,
          saveQueue: false,
          queueName: ''
        };
      }
      
      if (result && typeof result === 'object' && 'saveQueue' in result) {
        return {
          confirmed: true,
          saveQueue: result.saveQueue,
          queueName: result.queueName
        };
      }
      
      return {
        confirmed: false,
        saveQueue: false,
        queueName: ''
      };
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | ClearQueueDialog error:', error);
      return {
        confirmed: false,
        saveQueue: false,
        queueName: ''
      };
    }
  }
}