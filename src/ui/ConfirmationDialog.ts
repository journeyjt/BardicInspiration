/**
 * ConfirmationDialog - DialogV2-based themed confirmation dialog
 */

import { logger } from '../lib/logger.js';

interface ConfirmationDialogOptions {
  yesLabel?: string;
  noLabel?: string;
  defaultYes?: boolean;
  icon?: string;
  type?: 'info' | 'warning' | 'danger' | 'success';
}

/**
 * Modern DialogV2-based confirmation dialog with our theme
 */
export class ConfirmationDialog {

  /**
   * Static method to show confirmation dialog using DialogV2
   */
  static async show(
    title: string,
    content: string,
    options: ConfirmationDialogOptions = {}
  ): Promise<boolean> {
    const dialogData = {
      title,
      content,
      yesLabel: options.yesLabel || 'Yes',
      noLabel: options.noLabel || 'No',
      icon: options.icon || 'fas fa-question-circle',
      type: options.type || 'info'
    };

    // Generate HTML content for the dialog body (no buttons - DialogV2 handles those)
    const htmlContent = `
      <div class="bardic-confirmation-dialog">
        <div class="dialog-content">
          <div class="dialog-icon ${dialogData.type}">
            <i class="${dialogData.icon}"></i>
          </div>
          <div class="dialog-message">
            ${dialogData.content}
          </div>
        </div>
      </div>
    `;

    try {
      logger.debug('🎵 YouTube DJ | ConfirmationDialog.show starting with data:', dialogData);
      
      const dialogConfig = {
        window: {
          title: dialogData.title,
          icon: dialogData.icon,
        },
        position: {
          width: 400,
        },
        content: htmlContent,
        buttons: [
          {
            action: "confirm",
            label: dialogData.yesLabel,
            icon: "fas fa-check",
            default: options.defaultYes || false
          },
          {
            action: "cancel", 
            label: dialogData.noLabel,
            icon: "fas fa-times",
            default: !(options.defaultYes || false)
          }
        ],
        close: () => false
      };
      
      logger.debug('🎵 YouTube DJ | Calling DialogV2.wait with config:', dialogConfig);
      
      const result = await foundry.applications.api.DialogV2.wait(dialogConfig);
      
      logger.debug('🎵 YouTube DJ | DialogV2.wait returned:', result);
      
      const finalResult = result?.choice === "true" || result === "confirm";
      logger.debug('🎵 YouTube DJ | Final result:', finalResult);
      
      return finalResult;
    } catch (error) {
      logger.error('🎵 YouTube DJ | ConfirmationDialog error:', error);
      return false;
    }
  }
}