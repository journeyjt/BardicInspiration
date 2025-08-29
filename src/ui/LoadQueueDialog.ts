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
      <div class="bardic-load-queue-dialog modern">
        <div class="dialog-header">
          <div class="header-content">
            <div class="header-icon">
              <i class="fas fa-folder-open"></i>
            </div>
            <div class="header-text">
              <h3>Load Saved Queue</h3>
              <p>Choose a queue to load and set how it should be added</p>
            </div>
          </div>
        </div>

        <div class="dialog-body">
          <div class="queue-selection-section">
            <div class="section-header">
              <i class="fas fa-list"></i>
              <span>Available Queues</span>
            </div>
            
            <div class="queue-selector">
              <select name="savedQueue" id="savedQueue" class="modern-select">
                ${sortedQueues.map(q => {
                  const createdDate = new Date(q.createdAt).toLocaleDateString();
                  return `
                    <option value="${q.id}" data-queue-name="${q.name}">
                      ${q.name}
                    </option>
                  `;
                }).join('')}
              </select>
              
              <div class="selected-queue-display" id="selectedQueueDisplay">
                <div class="queue-card">
                  <div class="queue-header">
                    <div class="queue-icon">
                      <i class="fas fa-list-ul"></i>
                    </div>
                    <div class="queue-title">
                      <h4 id="selectedQueueName">${sortedQueues[0]?.name || 'No queue selected'}</h4>
                      <p>Selected Queue</p>
                    </div>
                  </div>
                  
                  <div class="queue-details">
                    <div class="detail-row">
                      <span class="detail-label">Tracks:</span>
                      <span class="detail-value" id="trackCount">${sortedQueues[0]?.items.length || 0}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Created by:</span>
                      <span class="detail-value" id="createdBy">${sortedQueues[0]?.createdBy || 'Unknown'}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">Date:</span>
                      <span class="detail-value" id="createdDate">${sortedQueues[0] ? new Date(sortedQueues[0].createdAt).toLocaleDateString() : 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="load-mode-section">
            <div class="section-header">
              <i class="fas fa-cog"></i>
              <span>Loading Options</span>
            </div>
            
            <div class="mode-options">
              <label class="mode-option replace-mode">
                <input type="radio" name="loadMode" value="replace" checked>
                <div class="option-content">
                  <div class="option-header">
                    <i class="fas fa-exchange-alt"></i>
                    <span>Replace Current Queue</span>
                  </div>
                  <p class="option-description">Clear the current queue and load this one</p>
                </div>
              </label>
              
              <label class="mode-option append-mode">
                <input type="radio" name="loadMode" value="append">
                <div class="option-content">
                  <div class="option-header">
                    <i class="fas fa-plus"></i>
                    <span>Add to Current Queue</span>
                  </div>
                  <p class="option-description">Keep current queue and add these tracks to the end</p>
                </div>
              </label>
            </div>
          </div>

          <div class="danger-zone">
            <div class="section-header danger">
              <i class="fas fa-exclamation-triangle"></i>
              <span>Danger Zone</span>
            </div>
            <button type="button" class="danger-btn delete-queue-btn">
              <i class="fas fa-trash"></i>
              <span>Delete Selected Queue</span>
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
          icon: "fas fa-folder-open"
        },
        position: {
          width: 450
        },
        modal: false,
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
          
          // Get the actual DOM element - DialogV2 might pass different parameters
          const domElement = element?.element?.[0] || element?.element || element;
          const actualDialog = dialog || element;
          
          // Add bardic-inspiration class to dialog for theming - with safety check
          if (domElement && typeof domElement.closest === 'function') {
            domElement.closest('.dialog-v2')?.classList.add('bardic-dialog');
          } else if (actualDialog?.element && typeof actualDialog.element.closest === 'function') {
            actualDialog.element.closest('.dialog-v2')?.classList.add('bardic-dialog');
          }
          
          // Add queue selection change listener for preview update
          const selectElement = (domElement?.querySelector ? domElement.querySelector('#savedQueue') : actualDialog?.element?.querySelector('#savedQueue')) as HTMLSelectElement;
          const updatePreview = () => {
            const selectedOption = selectElement?.selectedOptions[0];
            if (selectedOption) {
              const queueId = selectedOption.value;
              const selectedQueue = sortedQueues.find(q => q.id === queueId);
              if (selectedQueue) {
                const selectedQueueNameEl = domElement?.querySelector ? domElement.querySelector('#selectedQueueName') : actualDialog?.element?.querySelector('#selectedQueueName');
                const trackCountEl = domElement?.querySelector ? domElement.querySelector('#trackCount') : actualDialog?.element?.querySelector('#trackCount');
                const createdByEl = domElement?.querySelector ? domElement.querySelector('#createdBy') : actualDialog?.element?.querySelector('#createdBy');
                const createdDateEl = domElement?.querySelector ? domElement.querySelector('#createdDate') : actualDialog?.element?.querySelector('#createdDate');
                
                if (selectedQueueNameEl) selectedQueueNameEl.textContent = selectedQueue.name;
                if (trackCountEl) trackCountEl.textContent = selectedQueue.items.length.toString();
                if (createdByEl) createdByEl.textContent = selectedQueue.createdBy;
                if (createdDateEl) createdDateEl.textContent = new Date(selectedQueue.createdAt).toLocaleDateString();
              }
            }
          };
          
          selectElement?.addEventListener('change', updatePreview);

          // Handle delete button - use the proper DOM element
          const deleteBtn = domElement?.querySelector ? domElement.querySelector('.delete-queue-btn') : actualDialog?.element?.querySelector('.delete-queue-btn');
          deleteBtn?.addEventListener('click', async () => {
            const selectElement = (domElement?.querySelector ? domElement.querySelector('#savedQueue') : actualDialog?.element?.querySelector('#savedQueue')) as HTMLSelectElement;
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
                  logger.debug('🎵 YouTube DJ | Deleting queue:', { queueId, queueName });
                  await savedQueuesManager.deleteSavedQueue(queueId);
                  
                  // Remove the option from the select
                  selectedOption?.remove();
                  
                  // If no more queues, close dialog
                  if (selectElement.options.length === 0) {
                    ui.notifications?.info('No more saved queues');
                    dialogInstance?.close();
                  }
                  ui.notifications?.success(`Queue "${queueName}" deleted`);
                } else {
                  logger.error('🎵 YouTube DJ | SavedQueuesManager not found in global scope');
                  ui.notifications?.error('Saved queues manager not available');
                }
              } catch (error: any) {
                logger.error('🎵 YouTube DJ | Failed to delete queue:', error);
                ui.notifications?.error(`Failed to delete queue: ${error.message || 'Unknown error'}`);
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