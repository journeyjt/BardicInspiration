/**
 * SaveQueueDialog - DialogV2-based dialog for saving queues
 */

import { logger } from '../lib/logger.js';

export interface SaveQueueDialogResult {
  confirmed: boolean;
  queueName: string;
}

/**
 * DialogV2-based save queue dialog with consistent theming
 */
export class SaveQueueDialog {
  
  /**
   * Show save queue dialog
   */
  static async show(): Promise<SaveQueueDialogResult> {
    const htmlContent = `
      <div class="bardic-save-queue-dialog">
        <div class="dialog-content">
          <div class="form-group">
            <label for="queueName">
              <i class="fas fa-tag"></i>
              Queue Name
            </label>
            <input 
              type="text" 
              name="queueName" 
              id="queueName" 
              placeholder="Enter a name for this queue"
              class="bardic-input"
              autofocus
              required
            />
            <p class="notes">Choose a unique name to identify this queue</p>
          </div>
        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | SaveQueueDialog opening');
      
      const dialogConfig = {
        window: {
          title: "Save Queue",
          icon: "fas fa-save",
        },
        position: {
          width: 400,
        },
        content: htmlContent,
        buttons: [
          {
            action: "save",
            label: "Save",
            icon: "fas fa-save",
            default: true,
            callback: (event: Event, button: HTMLElement, dialog: any) => {
              const queueNameInput = dialog.element.querySelector('#queueName') as HTMLInputElement;
              const queueName = queueNameInput?.value?.trim();
              
              if (!queueName) {
                ui.notifications?.warn('Please enter a queue name');
                return false; // Prevent dialog from closing
              }
              
              return queueName;
            }
          },
          {
            action: "cancel",
            label: "Cancel",
            icon: "fas fa-times",
            default: false
          }
        ],
        render: (element: HTMLElement) => {
          // Add bardic-inspiration class to dialog for theming
          element.closest('.dialog-v2')?.classList.add('bardic-dialog');
          
          // Focus the input field
          const input = element.querySelector('#queueName') as HTMLInputElement;
          if (input) {
            setTimeout(() => input.focus(), 100);
          }
        },
        close: () => ({ confirmed: false, queueName: '' })
      };
      
      const result = await foundry.applications.api.DialogV2.wait(dialogConfig);
      
      logger.debug('🎵 YouTube DJ | SaveQueueDialog result:', result);
      
      if (result && typeof result === 'string') {
        return {
          confirmed: true,
          queueName: result
        };
      }
      
      return {
        confirmed: false,
        queueName: ''
      };
      
    } catch (error) {
      logger.error('🎵 YouTube DJ | SaveQueueDialog error:', error);
      return {
        confirmed: false,
        queueName: ''
      };
    }
  }
}