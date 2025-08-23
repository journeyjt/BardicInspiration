/**
 * Unit tests for ConfirmationDialog - DialogV2-based themed confirmation dialog
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ConfirmationDialog } from '../../src/ui/ConfirmationDialog.js';
import TestUtils from '../setup/test-setup.js';

describe('ConfirmationDialog', () => {
  let mockDialogV2Wait: any;

  beforeEach(() => {
    TestUtils.resetMocks();
    TestUtils.setupDOM();
    
    // Mock DialogV2.wait method
    mockDialogV2Wait = vi.fn();
    
    // Mock foundry global with DialogV2
    (global as any).foundry = {
      ...((global as any).foundry || {}),
      applications: {
        ...((global as any).foundry?.applications || {}),
        api: {
          ...((global as any).foundry?.applications?.api || {}),
          DialogV2: {
            wait: mockDialogV2Wait
          }
        }
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Static show method', () => {
    it('should call DialogV2.wait with correct parameters', async () => {
      mockDialogV2Wait.mockResolvedValue('confirm');

      const result = await ConfirmationDialog.show(
        'Test Title',
        'Test message content',
        {
          yesLabel: 'Accept',
          noLabel: 'Decline',
          type: 'warning',
          icon: 'fas fa-exclamation'
        }
      );

      expect(mockDialogV2Wait).toHaveBeenCalledWith(
        expect.objectContaining({
          window: {
            title: 'Test Title',
            icon: 'fas fa-exclamation'
          },
          position: {
            width: 400
          },
          content: expect.stringContaining('Test message content'),
          buttons: expect.arrayContaining([
            expect.objectContaining({
              action: 'confirm',
              label: 'Accept',
              icon: 'fas fa-check'
            }),
            expect.objectContaining({
              action: 'cancel',
              label: 'Decline',
              icon: 'fas fa-times'
            })
          ])
        })
      );

      expect(result).toBe(true);
    });

    it('should return false when DialogV2 returns cancel', async () => {
      mockDialogV2Wait.mockResolvedValue('cancel');

      const result = await ConfirmationDialog.show(
        'Test Title',
        'Test content'
      );

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockDialogV2Wait.mockRejectedValue(new Error('Dialog failed'));

      const result = await ConfirmationDialog.show(
        'Error Test',
        'This should handle errors'
      );

      expect(result).toBe(false);
    });
  });

  describe('Content generation', () => {
    it('should generate correct HTML content with default options', async () => {
      mockDialogV2Wait.mockResolvedValue('confirm');

      await ConfirmationDialog.show('Title', 'Message');

      const callArgs = mockDialogV2Wait.mock.calls[0][0];
      expect(callArgs.content).toContain('bardic-confirmation-dialog');
      expect(callArgs.content).toContain('Message');
      expect(callArgs.content).toContain('fas fa-question-circle');
      expect(callArgs.content).toContain('info'); // type class
      
      // Buttons should be in DialogV2 buttons array, not in content HTML
      expect(callArgs.content).not.toContain('control-btn');
      expect(callArgs.content).not.toContain('Yes');
      expect(callArgs.content).not.toContain('No');
    });

    it('should generate correct HTML content with custom options', async () => {
      mockDialogV2Wait.mockResolvedValue('confirm');

      await ConfirmationDialog.show(
        'Delete File',
        'Are you sure?',
        {
          yesLabel: 'Delete',
          noLabel: 'Keep',
          type: 'danger',
          icon: 'fas fa-trash'
        }
      );

      const callArgs = mockDialogV2Wait.mock.calls[0][0];
      expect(callArgs.content).toContain('Are you sure?');
      expect(callArgs.content).toContain('fas fa-trash');
      expect(callArgs.content).toContain('danger');
      
      // Buttons should be in DialogV2 buttons array, not in content HTML  
      expect(callArgs.content).not.toContain('Delete');
      expect(callArgs.content).not.toContain('Keep');
    });
  });
});