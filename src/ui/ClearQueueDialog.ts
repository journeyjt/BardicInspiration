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
      <div class="bardic-clear-queue-dialog">
        <div class="dialog-content">
          <div class="form-group">
            <div class="warning-message">
              <i class="fas fa-exclamation-triangle"></i>
              <span>Are you sure you want to clear the entire queue?</span>
            </div>
          </div>
          
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" name="saveQueue" id="saveQueueCheckbox">
              <span>
                <i class="fas fa-save"></i>
                Save current queue before clearing
              </span>
            </label>
          </div>
          
          <div class="form-group queue-name-group" id="queueNameGroup" style="display: none;">
            <label for="queueName">
              <i class="fas fa-tag"></i>
              Queue Name
            </label>
            <input 
              type="text" 
              name="queueName" 
              id="queueName" 
              placeholder="Enter a name for the saved queue"
              class="bardic-input"
            />
            <p class="notes">Choose a name to save the queue before clearing</p>
          </div>
        </div>
      </div>
    ` : `
      <div class="bardic-clear-queue-dialog">
        <div class="dialog-content">
          <div class="form-group">
            <div class="info-message">
              <i class="fas fa-info-circle"></i>
              <span>The queue is already empty.</span>
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
          icon: hasItems ? "fas fa-trash" : "fas fa-info-circle",
        },
        position: {
          width: 450,
        },
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