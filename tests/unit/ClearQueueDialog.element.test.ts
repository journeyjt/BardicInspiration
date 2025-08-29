/**
 * Unit tests for ClearQueueDialog - Element Handling Edge Cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClearQueueDialog } from '../../src/ui/ClearQueueDialog';
import { logger } from '../../src/lib/logger';

// Mock the logger module
vi.mock('../../src/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

describe('ClearQueueDialog - Element Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock game global
    (global as any).game = {
      user: { id: 'test-user', name: 'Test User' }
    };
    
    // Mock UI
    (global as any).ui = {
      notifications: {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    };
    
    // Mock foundry DialogV2
    (global as any).foundry = {
      applications: {
        api: {
          DialogV2: {
            wait: vi.fn()
          }
        }
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Render Element Parameter Handling', () => {
    it('should handle HTMLElement parameter correctly', async () => {
      let renderCallback: Function | null = null;
      
      // Capture the render callback
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      // Create dialog
      await ClearQueueDialog.show(true);
      
      // Create a mock HTML element
      const mockElement = document.createElement('div');
      mockElement.querySelector = vi.fn().mockReturnValue(null);
      mockElement.closest = vi.fn().mockReturnValue({
        classList: {
          add: vi.fn()
        }
      });
      
      // Call render callback with HTMLElement
      if (renderCallback) {
        renderCallback(mockElement);
      }
      
      // Should handle element correctly
      expect(mockElement.closest).toHaveBeenCalledWith('.dialog-v2');
    });

    it('should handle jQuery-wrapped element', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Create a mock jQuery object
      const actualElement = document.createElement('div');
      actualElement.closest = vi.fn().mockReturnValue({
        classList: {
          add: vi.fn()
        }
      });
      
      const mockJQuery = {
        0: actualElement, // jQuery array-like access
        element: [actualElement], // Alternative jQuery structure
        querySelector: vi.fn()
      };
      
      // Call render with jQuery-like object
      if (renderCallback) {
        renderCallback(mockJQuery);
      }
      
      // Should extract actual element and use it
      expect(actualElement.closest).toHaveBeenCalledWith('.dialog-v2');
    });

    it('should handle ApplicationV2 instance with element property', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Create mock ApplicationV2 instance
      const actualElement = document.createElement('div');
      actualElement.closest = vi.fn().mockReturnValue({
        classList: {
          add: vi.fn()
        }
      });
      
      const mockApp = {
        element: [actualElement]
      };
      
      // Call render with app instance
      if (renderCallback) {
        renderCallback(mockApp);
      }
      
      // Should extract element from app
      expect(actualElement.closest).toHaveBeenCalledWith('.dialog-v2');
    });

    it('should use fallback when closest is not available', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      vi.useFakeTimers();
      
      await ClearQueueDialog.show(true);
      
      // Create element without closest method
      const mockElement = {
        querySelector: vi.fn()
      };
      
      // Mock document.querySelector for fallback
      const mockDialog = {
        classList: {
          add: vi.fn()
        }
      };
      document.querySelector = vi.fn().mockReturnValue(mockDialog);
      
      // Call render
      if (renderCallback) {
        renderCallback(mockElement);
      }
      
      // Advance timers for setTimeout fallback
      vi.advanceTimersByTime(0);
      
      // Should use document.querySelector fallback
      expect(document.querySelector).toHaveBeenCalledWith('.dialog-v2:last-of-type');
      expect(mockDialog.classList.add).toHaveBeenCalledWith('bardic-dialog');
      
      vi.useRealTimers();
    });

    it('should handle undefined element gracefully', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Call render with undefined
      expect(() => {
        if (renderCallback) {
          renderCallback(undefined);
        }
      }).not.toThrow();
    });
  });

  describe('Checkbox and Input Handling', () => {
    it('should handle checkbox change events with various element formats', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Create mock elements
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'saveQueueCheckbox';
      
      const queueNameGroup = document.createElement('div');
      queueNameGroup.id = 'queueNameGroup';
      queueNameGroup.style.display = 'none';
      
      const queueNameInput = document.createElement('input');
      queueNameInput.id = 'queueName';
      queueNameInput.focus = vi.fn();
      
      // Mock element with proper querySelector
      const mockElement = {
        querySelector: vi.fn((selector: string) => {
          if (selector === '#saveQueueCheckbox') return checkbox;
          if (selector === '#queueNameGroup') return queueNameGroup;
          if (selector === '#queueName') return queueNameInput;
          return null;
        })
      };
      
      // Also provide array access for jQuery compatibility
      Object.assign(mockElement, { 0: mockElement });
      
      if (renderCallback) {
        renderCallback(mockElement);
      }
      
      // Simulate checking the checkbox
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      
      // Queue name group should be shown
      expect(queueNameGroup.style.display).toBe('block');
    });

    it('should handle missing checkbox gracefully', async () => {
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Mock element that returns null for all queries
      const mockElement = {
        querySelector: vi.fn().mockReturnValue(null)
      };
      
      // Should not throw when checkbox not found
      expect(() => {
        if (renderCallback) {
          renderCallback(mockElement);
        }
      }).not.toThrow();
    });
  });

  describe('Dialog Result Handling', () => {
    it('should return correct result for clear with save', async () => {
      foundry.applications.api.DialogV2.wait.mockResolvedValue({
        saveQueue: true,
        queueName: 'My Queue'
      });
      
      const result = await ClearQueueDialog.show(true);
      
      expect(result).toEqual({
        confirmed: true,
        saveQueue: true,
        queueName: 'My Queue'
      });
    });

    it('should return correct result for clear without save', async () => {
      foundry.applications.api.DialogV2.wait.mockResolvedValue({
        saveQueue: false,
        queueName: ''
      });
      
      const result = await ClearQueueDialog.show(true);
      
      expect(result).toEqual({
        confirmed: true,
        saveQueue: false,
        queueName: ''
      });
    });

    it('should handle cancel action', async () => {
      foundry.applications.api.DialogV2.wait.mockResolvedValue('cancel');
      
      const result = await ClearQueueDialog.show(true);
      
      expect(result).toEqual({
        confirmed: false,
        saveQueue: false,
        queueName: ''
      });
    });

    it('should handle empty queue case', async () => {
      foundry.applications.api.DialogV2.wait.mockResolvedValue('ok');
      
      const result = await ClearQueueDialog.show(false); // hasItems = false
      
      expect(result).toEqual({
        confirmed: false,
        saveQueue: false,
        queueName: ''
      });
    });
  });

  describe('Focus Management', () => {
    it('should focus queue name input when checkbox is checked', async () => {
      vi.useFakeTimers();
      let renderCallback: Function | null = null;
      
      foundry.applications.api.DialogV2.wait.mockImplementation((config) => {
        renderCallback = config.render;
        return Promise.resolve('ok');
      });
      
      await ClearQueueDialog.show(true);
      
      // Create mock elements
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      
      const queueNameInput = document.createElement('input');
      queueNameInput.focus = vi.fn();
      
      const queueNameGroup = document.createElement('div');
      
      const mockElement = {
        querySelector: vi.fn((selector: string) => {
          if (selector === '#saveQueueCheckbox') return checkbox;
          if (selector === '#queueName') return queueNameInput;
          if (selector === '#queueNameGroup') return queueNameGroup;
          return null;
        })
      };
      
      if (renderCallback) {
        renderCallback(mockElement);
      }
      
      // Simulate checking checkbox
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      
      // Advance timers for focus delay
      vi.advanceTimersByTime(100);
      
      // Input should be focused
      expect(queueNameInput.focus).toHaveBeenCalled();
      
      vi.useRealTimers();
    });
  });
});