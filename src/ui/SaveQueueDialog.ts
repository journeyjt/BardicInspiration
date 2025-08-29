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
      <div class="bardic-save-queue-dialog modern">
        <div class="dialog-header">
          <div class="header-content">
            <div class="header-icon">
              <i class="fas fa-save"></i>
            </div>
            <div class="header-text">
              <h3>Save Current Queue</h3>
              <p>Save your current queue to load it again later</p>
            </div>
          </div>
        </div>

        <div class="dialog-body">
          <div class="queue-info-section">
            <div class="section-header">
              <i class="fas fa-info-circle"></i>
              <span>Queue Summary</span>
            </div>
            
            <div class="current-queue-preview">
              <div class="preview-stats">
                <span class="stat primary">
                  <i class="fas fa-music"></i>
                  <span id="currentTrackCount">Loading...</span> tracks ready to save
                </span>
                <span class="stat">
                  <i class="fas fa-clock"></i>
                  <span>Saved: <span id="currentDateTime">${new Date().toLocaleString()}</span></span>
                </span>
              </div>
            </div>
          </div>

          <div class="name-input-section">
            <div class="section-header">
              <i class="fas fa-tag"></i>
              <span>Queue Name</span>
            </div>
            
            <div class="input-wrapper">
              <input 
                type="text" 
                name="queueName" 
                id="queueName" 
                placeholder="Enter a memorable name for this queue..."
                class="modern-input"
                autofocus
                required
              />
              <div class="input-help">
                <i class="fas fa-lightbulb"></i>
                <span>Tip: Use descriptive names like "Epic Battle Music" or "Tavern Ambience"</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | SaveQueueDialog opening');
      
      const dialogConfig = {
        window: {
          title: "Save Queue",
          icon: "fas fa-save"
        },
        position: {
          width: 400
        },
        modal: false,
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
          
          // Focus the input field - use the proper DOM element
          const input = (domElement?.querySelector ? domElement.querySelector('#queueName') : actualDialog?.element?.querySelector('#queueName')) as HTMLInputElement;
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