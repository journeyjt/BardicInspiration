/**
 * libWrapper utility functions with TypeScript support
 * Safe monkey-patching utilities following best practices
 */

import { logger } from './logger.js';

type WrapperType = 'WRAPPER' | 'MIXED' | 'OVERRIDE' | 'LISTENER';
type WrapperFunction = (...args: any[]) => any;

declare global {
  const libWrapper: {
    register(packageId: string, target: string, fn: WrapperFunction, type: WrapperType): void;
    WRAPPER: 'WRAPPER';
    MIXED: 'MIXED';
    OVERRIDE: 'OVERRIDE';
    LISTENER: 'LISTENER';
  } | undefined;
}

export class LibWrapperUtils {
  private static readonly MODULE_ID = 'bardic-inspiration';

  /**
   * Register a libWrapper wrapper safely with full TypeScript support
   * @param target - The function to wrap (e.g., 'Actor.prototype.rollSkill')
   * @param wrapper - The wrapper function
   * @param type - WRAPPER, MIXED, OVERRIDE, or LISTENER
   */
  static registerWrapper(target: string, wrapper: WrapperFunction, type: WrapperType = 'WRAPPER'): void {
    if (this.isLibWrapperAvailable()) {
      libWrapper!.register(this.MODULE_ID, target, wrapper, type);
      logger.debug(`Registered ${type} for ${target}`);
    } else {
      logger.warn(`libWrapper not available - falling back to direct method override for ${target}`);
      this.fallbackWrapper(target, wrapper);
    }
  }

  /**
   * Check if libWrapper is available and ready
   */
  static isLibWrapperAvailable(): boolean {
    return typeof libWrapper !== 'undefined' && 
           typeof libWrapper.register === 'function';
  }

  /**
   * Get libWrapper constants for type safety
   */
  static get WRAPPER_TYPES() {
    return {
      WRAPPER: 'WRAPPER' as const,
      MIXED: 'MIXED' as const,
      OVERRIDE: 'OVERRIDE' as const,
      LISTENER: 'LISTENER' as const,
    };
  }

  /**
   * Fallback wrapper implementation when libWrapper is not available
   * @private
   */
  private static fallbackWrapper(target: string, wrapper: WrapperFunction): void {
    try {
      const parts = target.split('.');
      let obj: any = globalThis;
      
      // Navigate to the parent object
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
        if (!obj) {
          throw new Error(`Cannot find object path: ${parts.slice(0, i + 1).join('.')}`);
        }
      }

      const methodName = parts[parts.length - 1];
      const original = obj[methodName];
      
      if (typeof original !== 'function') {
        throw new Error(`Target ${target} is not a function`);
      }

      // Replace with wrapped version
      obj[methodName] = function(this: any, ...args: any[]) {
        return wrapper.call(this, original.bind(this), ...args);
      };

      logger.debug(`Applied fallback wrapper to ${target}`);
    } catch (error) {
      logger.error(`Failed to apply fallback wrapper to ${target}:`, error);
    }
  }

  /**
   * Example wrapper helper for common FoundryVTT patterns
   */
  static wrapActorMethod(methodName: string, wrapper: WrapperFunction, type: WrapperType = 'WRAPPER'): void {
    this.registerWrapper(`Actor.prototype.${methodName}`, wrapper, type);
  }

  /**
   * Example wrapper helper for Item methods
   */
  static wrapItemMethod(methodName: string, wrapper: WrapperFunction, type: WrapperType = 'WRAPPER'): void {
    this.registerWrapper(`Item.prototype.${methodName}`, wrapper, type);
  }
}