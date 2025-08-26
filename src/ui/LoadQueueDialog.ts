/**
 * LoadQueueDialog - DialogV2-based dialog for loading saved queues
 */

import { logger } from '../lib/logger.js';
import { SavedQueue } from '../state/StateTypes.js';
import { SavedQueuesManager } from '../services/SavedQueuesManager.js';

export interface LoadQueueDialogResult {
  confirmed: boolean;
  queueId: string;
  replace: boolean;
}

/**
 * DialogV2-based load queue dialog with consistent theming
 */
export class LoadQueueDialog {
  
  /**
   * Show load queue dialog
   */
  static async show(savedQueues: SavedQueue[]): Promise<LoadQueueDialogResult | null> {
    // Sort queues by name
    const sortedQueues = [...savedQueues].sort((a, b) => a.name.localeCompare(b.name));
    
    const htmlContent = `
      <div class="bardic-load-queue-dialog">
        <div class="dialog-content">
          <div class="form-group">
            <label for="savedQueue">
              <i class="fas fa-list"></i>
              Select Queue
            </label>
            <select name="savedQueue" id="savedQueue" class="bardic-select">
              ${sortedQueues.map(q => `
                <option value="${q.id}" data-queue-name="${q.name}">
                  ${q.name} (${q.items.length} tracks)
                </option>
              `).join('')}
            </select>
            <p class="notes">Choose a saved queue to load</p>
          </div>
          
          <div class="form-group">
            <label class="radio-label">
              <input type="radio" name="loadMode" value="replace" checked>
              <span>
                <i class="fas fa-exchange-alt"></i>
                Replace current queue
              </span>
            </label>
            <label class="radio-label">
              <input type="radio" name="loadMode" value="append">
              <span>
                <i class="fas fa-plus"></i>
                Add to current queue
              </span>
            </label>
          </div>
          
          <div class="form-group queue-actions">
            <button type="button" class="control-btn danger-btn delete-queue-btn" title="Delete selected queue">
              <i class="fas fa-trash"></i>
              Delete Selected Queue
            </button>
          </div>
        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | LoadQueueDialog opening with', sortedQueues.length, 'queues');
      
      let dialogInstance: any = null;
      
      const dialogConfig = {
        window: {
          title: "Load Saved Queue",
          icon: "fas fa-folder-open",
        },
        position: {
          width: 450,
        },
        content: htmlContent,
        buttons: [
          {
            action: "load",
            label: "Load",
            icon: "fas fa-folder-open",
            default: true,
            callback: (event: Event, button: HTMLElement, dialog: any) => {
              const selectElement = dialog.element.querySelector('#savedQueue') as HTMLSelectElement;
              const queueId = selectElement?.value;
              const replaceModeInput = dialog.element.querySelector('input[name="loadMode"]:checked') as HTMLInputElement;
              const replace = replaceModeInput?.value === 'replace';
              
              if (!queueId) {
                ui.notifications?.warn('Please select a queue to load');
                return false;
              }
              
              return { queueId, replace };
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
          dialogInstance = dialog;
          
          // Add bardic-inspiration class to dialog for theming
          element.closest('.dialog-v2')?.classList.add('bardic-dialog');
          
          // Handle delete button
          const deleteBtn = element.querySelector('.delete-queue-btn');
          deleteBtn?.addEventListener('click', async () => {
            const selectElement = element.querySelector('#savedQueue') as HTMLSelectElement;
            const queueId = selectElement?.value;
            const selectedOption = selectElement?.selectedOptions[0];
            const queueName = selectedOption?.getAttribute('data-queue-name') || 'this queue';
            
            if (!queueId) {
              ui.notifications?.warn('Please select a queue to delete');
              return;
            }
            
            // Show confirmation dialog
            const { ConfirmationDialog } = await import('./ConfirmationDialog.js');
            const confirmDelete = await ConfirmationDialog.show(
              'Delete Saved Queue',
              `Are you sure you want to delete "${queueName}"?`,
              {
                defaultYes: false,
                type: 'warning',
                icon: 'fas fa-trash',
                yesLabel: 'Delete',
                noLabel: 'Cancel'
              }
            );
            
            if (confirmDelete) {
              try {
                const savedQueuesManager = (globalThis as any).youtubeDJSavedQueuesManager as SavedQueuesManager;
                if (savedQueuesManager) {
                  await savedQueuesManager.deleteSavedQueue(queueId);
                  
                  // Remove the option from the select
                  selectedOption?.remove();
                  
                  // If no more queues, close dialog
                  if (selectElement.options.length === 0) {
                    ui.notifications?.info('No more saved queues');
                    dialogInstance?.close();
                  }
                } else {
                  ui.notifications?.error('Saved queues manager not available');
                }
              } catch (error) {
                logger.error('🎵 YouTube DJ | Failed to delete queue:', error);
                ui.notifications?.error('Failed to delete queue');
              }
            }
          });
        },
        close: () => null
      };
      
      const result = await foundry.applications.api.DialogV2.wait(dialogConfig);
      
      logger.debug('🎵 YouTube DJ | LoadQueueDialog result:', result);
      
      if (result && typeof result === 'object' && 'queueId' in result) {
        return {
          confirmed: true,
          queueId: result.queueId,
          replace: result.replace
        };
      }
      
      return null;
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | LoadQueueDialog error:', error);
      return null;
    }
  }
}