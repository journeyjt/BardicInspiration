/**
 * libWrapper utility functions
 * Safe monkey-patching utilities following best practices
 */

export class LibWrapperUtils {
  static MODULE_ID = 'bardic-inspiration';

  /**
   * Register a libWrapper wrapper safely
   * @param {string} target - The function to wrap
   * @param {Function} wrapper - The wrapper function
   * @param {string} type - WRAPPER, MIXED, OVERRIDE, or LISTENER
   */
  static registerWrapper(target, wrapper, type = 'WRAPPER') {
    if (typeof libWrapper !== 'undefined') {
      libWrapper.register(this.MODULE_ID, target, wrapper, type);
    } else {
      console.warn(`${this.MODULE_ID} | libWrapper not available - falling back to direct method override`);
      // Fallback for when libWrapper is not available
      const parts = target.split('.');
      let obj = window;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
      }
      const original = obj[parts[parts.length - 1]];
      obj[parts[parts.length - 1]] = wrapper.bind(obj, original.bind(obj));
    }
  }

  /**
   * Check if libWrapper is available
   */
  static isLibWrapperAvailable() {
    return typeof libWrapper !== 'undefined' && libWrapper?.register;
  }
}