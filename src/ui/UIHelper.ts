/**
 * UI Helper - Common utility methods for UI operations
 * Extracted from YouTubeDJApp.ts for better code organization
 */

import { logger } from '../lib/logger.js';

export class UIHelper {
  /**
   * Format time in MM:SS or HH:MM:SS format
   */
  static formatTime(seconds: number): string {
    if (!seconds || seconds === 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  static escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Extract video ID from YouTube URL or direct ID
   */
  static extractVideoId(input: string): string | null {
    // Remove any whitespace
    input = input.trim();
    
    // Handle direct video ID (11 characters, alphanumeric + hyphens/underscores)
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
      return input;
    }
    
    // Various YouTube URL patterns
    const patterns = [
      // Standard watch URLs
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      // Embedded URLs
      /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      // Playlist URLs (extract the v parameter)
      /youtube\.com\/watch\?.*[&?]v=([a-zA-Z0-9_-]{11})/,
      // YouTube Music URLs
      /music\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
      // Short URLs with additional parameters
      /youtu\.be\/([a-zA-Z0-9_-]{11})(?:\?|$)/
    ];
    
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Debounce function to limit rapid function calls
   */
  static debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number,
    immediate = false
  ): (...args: Parameters<T>) => void {
    let timeout: number | null = null;
    
    return function executedFunction(...args: Parameters<T>) {
      const later = () => {
        timeout = null;
        if (!immediate) func(...args);
      };
      
      const callNow = immediate && !timeout;
      
      if (timeout) clearTimeout(timeout);
      timeout = window.setTimeout(later, wait);
      
      if (callNow) func(...args);
    };
  }

  /**
   * Throttle function to limit function calls to once per interval
   */
  static throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
  ): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    
    return function executedFunction(...args: Parameters<T>) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Add event listener with automatic cleanup tracking
   */
  static addEventListenerWithCleanup(
    element: Element | Document | Window,
    event: string,
    handler: EventListener,
    options?: boolean | AddEventListenerOptions
  ): () => void {
    element.addEventListener(event, handler, options);
    
    return () => {
      element.removeEventListener(event, handler, options);
    };
  }

  /**
   * Add Foundry Hook with automatic cleanup tracking
   */
  static addHookWithCleanup(
    hook: string,
    handler: Function
  ): () => void {
    Hooks.on(hook, handler);
    
    return () => {
      Hooks.off(hook, handler);
    };
  }

  /**
   * Create element with attributes and content
   */
  static createElement(
    tag: string,
    attributes: Record<string, string> = {},
    content?: string | HTMLElement | HTMLElement[]
  ): HTMLElement {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    
    // Set content
    if (content !== undefined) {
      if (typeof content === 'string') {
        element.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        element.appendChild(content);
      } else if (Array.isArray(content)) {
        content.forEach(child => element.appendChild(child));
      }
    }
    
    return element;
  }

  /**
   * Find element with error handling and logging
   */
  static findElement(
    parent: Element | Document,
    selector: string,
    required = false
  ): HTMLElement | null {
    const element = parent.querySelector(selector) as HTMLElement | null;
    
    if (!element && required) {
      logger.warn(`🎵 YouTube DJ | Required element not found: ${selector}`);
    }
    
    return element;
  }

  /**
   * Find all elements with error handling
   */
  static findElements(
    parent: Element | Document,
    selector: string
  ): HTMLElement[] {
    const elements = Array.from(parent.querySelectorAll(selector)) as HTMLElement[];
    return elements;
  }

  /**
   * Show/hide element with optional animation
   */
  static toggleElementVisibility(
    element: HTMLElement,
    show: boolean,
    animate = false
  ): void {
    if (animate) {
      if (show) {
        element.style.display = 'block';
        element.style.opacity = '0';
        element.style.transition = 'opacity 0.3s ease';
        
        // Trigger reflow
        element.offsetHeight;
        
        element.style.opacity = '1';
      } else {
        element.style.transition = 'opacity 0.3s ease';
        element.style.opacity = '0';
        
        setTimeout(() => {
          element.style.display = 'none';
        }, 300);
      }
    } else {
      element.style.display = show ? 'block' : 'none';
    }
  }

  /**
   * Add CSS class with optional removal timeout
   */
  static addTemporaryClass(
    element: HTMLElement,
    className: string,
    duration?: number
  ): void {
    element.classList.add(className);
    
    if (duration) {
      setTimeout(() => {
        element.classList.remove(className);
      }, duration);
    }
  }

  /**
   * Validate that required form inputs have values
   */
  static validateRequiredInputs(container: Element): { valid: boolean; missing: string[] } {
    const requiredInputs = container.querySelectorAll('input[required], select[required], textarea[required]');
    const missing: string[] = [];
    
    requiredInputs.forEach(input => {
      const element = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!element.value.trim()) {
        const label = container.querySelector(`label[for="${element.id}"]`)?.textContent || element.name || 'Unknown field';
        missing.push(label);
      }
    });
    
    return {
      valid: missing.length === 0,
      missing
    };
  }

  /**
   * Create confirmation dialog with promise
   */
  static async confirmDialog(
    title: string,
    content: string,
    options: {
      yesLabel?: string;
      noLabel?: string;
      defaultYes?: boolean;
    } = {}
  ): Promise<boolean> {
    return new Promise((resolve) => {
      new Dialog({
        title,
        content,
        buttons: {
          yes: {
            label: options.yesLabel || 'Yes',
            callback: () => resolve(true)
          },
          no: {
            label: options.noLabel || 'No',
            callback: () => resolve(false)
          }
        },
        default: options.defaultYes ? 'yes' : 'no',
        close: () => resolve(false)
      }).render(true);
    });
  }

  /**
   * Show notification with automatic cleanup
   */
  static showNotification(
    message: string,
    type: 'info' | 'warn' | 'error' | 'success' = 'info',
    duration?: number
  ): void {
    if (!ui.notifications) {
      console.log(`[${type.toUpperCase()}] ${message}`);
      return;
    }

    switch (type) {
      case 'info':
        ui.notifications.info(message, { duration });
        break;
      case 'warn':
        ui.notifications.warn(message, { duration });
        break;
      case 'error':
        ui.notifications.error(message, { duration });
        break;
      case 'success':
        ui.notifications.success(message, { duration });
        break;
    }
  }

  /**
   * Safe JSON parse with error handling
   */
  static safeJsonParse<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json);
    } catch (error) {
      logger.warn('🎵 YouTube DJ | Failed to parse JSON:', error);
      return fallback;
    }
  }

  /**
   * Get element's computed style property
   */
  static getComputedStyleProperty(element: HTMLElement, property: string): string {
    return window.getComputedStyle(element).getPropertyValue(property);
  }

  /**
   * Check if element is visible in viewport
   */
  static isElementInViewport(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  /**
   * Scroll element into view if not visible
   */
  static scrollIntoViewIfNeeded(element: HTMLElement, options?: ScrollIntoViewOptions): void {
    if (!this.isElementInViewport(element)) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
        ...options
      });
    }
  }
}