/**
 * BaseComponent - Foundation for all UI components
 * 
 * Provides:
 * - State subscription system for reactive updates
 * - Automatic lifecycle management 
 * - Selective rendering capabilities
 * - Scroll position preservation
 * - Event cleanup handling
 * 
 * Usage:
 * 1. Extend this class
 * 2. Define config with selector, template, and state subscriptions
 * 3. Implement prepareContext() method
 * 4. Call initialize() after DOM is ready
 */

import { logger } from '../lib/logger.js';
import { SessionStore } from '../state/SessionStore.js';
import { StateChangeEvent } from '../state/StateTypes.js';
import { UIHelper } from './UIHelper.js';

export interface ComponentConfig {
  selector: string;
  template: string;
  stateSubscriptions: string[];
}

export abstract class BaseComponent {
  protected store: SessionStore;
  protected parentElement: HTMLElement;
  protected componentElement: HTMLElement | null = null;
  protected config: ComponentConfig;
  protected cleanupFunctions: (() => void)[] = [];
  protected isInitialized: boolean = false;
  protected lastRenderTime: number = 0;
  protected renderDebounced: () => void;
  private subscriptionValues: Map<string, any> = new Map();

  constructor(store: SessionStore, parentElement: HTMLElement, config: ComponentConfig) {
    this.store = store;
    this.parentElement = parentElement;
    this.config = config;
    
    // Create debounced render function
    this.renderDebounced = UIHelper.debounce(() => this.render(), 100);
  }

  /**
   * Initialize the component - find DOM element and setup state listeners
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn(`🎵 YouTube DJ | Component ${this.config.selector} already initialized`);
      return;
    }

    // Find component element in parent
    this.componentElement = this.parentElement.querySelector(this.config.selector);
    if (!this.componentElement) {
      logger.error(`🎵 YouTube DJ | Component element not found: ${this.config.selector}`);
      return;
    }

    // Initialize subscription value cache
    this.initializeSubscriptionCache();

    // Setup state change listeners for subscribed state slices
    this.setupStateListeners();

    // Perform initial render
    await this.render();

    this.isInitialized = true;
    logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} initialized`);
  }

  /**
   * Initialize the subscription value cache with current values
   */
  private initializeSubscriptionCache(): void {
    this.config.stateSubscriptions.forEach(subscription => {
      const currentValue = this.getValueByPath(this.store.getState(), subscription);
      this.subscriptionValues.set(subscription, this.deepClone(currentValue));
    });
    logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} subscription cache initialized for:`, 
      this.config.stateSubscriptions);
  }

  /**
   * Setup state change listeners for this component's state subscriptions
   */
  private setupStateListeners(): void {
    const stateChangeCleanup = UIHelper.addHookWithCleanup('youtubeDJ.stateChanged', (event: StateChangeEvent) => {
      if (this.shouldUpdate(event)) {
        this.onStateChanged(event);
      }
    });
    this.cleanupFunctions.push(stateChangeCleanup);
  }

  /**
   * Determine if this component should update based on state changes
   */
  protected shouldUpdate(event: StateChangeEvent): boolean {
    const changes = event.changes;
    
    // Check if any of our subscribed state values actually changed
    return this.config.stateSubscriptions.some(subscription => {
      // Get current value from store
      const currentValue = this.getValueByPath(this.store.getState(), subscription);
      
      // Get previous value from our cache
      const previousValue = this.subscriptionValues.get(subscription);
      
      // Check if the value actually changed (deep comparison for objects/arrays)
      const hasChanged = !this.deepEquals(currentValue, previousValue);
      
      // Update cached value for next comparison
      if (hasChanged) {
        this.subscriptionValues.set(subscription, this.deepClone(currentValue));
        logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} subscription "${subscription}" changed:`, 
          { from: previousValue, to: currentValue });
      }
      
      return hasChanged;
    });
  }

  /**
   * Get value from object using dot notation path
   */
  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }

  /**
   * Deep equality check for primitive values, objects, and arrays
   */
  private deepEquals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      return a.every((item, index) => this.deepEquals(item, b[index]));
    }
    
    if (typeof a === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;
      return keysA.every(key => keysB.includes(key) && this.deepEquals(a[key], b[key]));
    }
    
    return false;
  }

  /**
   * Deep clone for caching subscription values
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const cloned: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
    return obj;
  }

  /**
   * Handle state changes - can be overridden by subclasses for custom logic
   */
  protected onStateChanged(event: StateChangeEvent): void {
    logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} state changed, rendering`);
    this.renderDebounced();
  }

  /**
   * Render the component using its template
   */
  async render(): Promise<void> {
    if (!this.componentElement) {
      logger.warn(`🎵 YouTube DJ | Cannot render ${this.config.selector} - no element`);
      return;
    }

    try {
      const context = await this.prepareContext();
      const html = await foundry.applications.handlebars.renderTemplate(this.config.template, context);
      
      // Store current scroll position if needed
      const scrollTop = this.componentElement.scrollTop;
      
      this.componentElement.innerHTML = html;
      
      // Restore scroll position if it was significant
      if (scrollTop > 0) {
        this.componentElement.scrollTop = scrollTop;
      }

      // Post-render hook for custom logic
      await this.onAfterRender();

      this.lastRenderTime = Date.now();
      logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} rendered`);

    } catch (error) {
      logger.error(`🎵 YouTube DJ | Failed to render component ${this.config.selector}:`, error);
    }
  }

  /**
   * Prepare context data for template rendering - must be implemented by subclasses
   */
  protected abstract prepareContext(): Promise<any>;

  /**
   * Hook called after render - can be overridden for post-render logic
   */
  protected async onAfterRender(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Update component without full re-render (for minor changes)
   */
  async updateSelectively(changes: any): Promise<void> {
    // Override in subclasses for selective updates
    // Default to full render
    await this.render();
  }

  /**
   * Get current component state from store
   */
  protected getComponentState(): any {
    // Override in subclasses to return relevant state slice
    return this.store.getState();
  }

  /**
   * Cleanup component resources
   */
  destroy(): void {
    // Clean up state listeners
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];

    // Clear subscription cache
    this.subscriptionValues.clear();

    this.componentElement = null;
    this.isInitialized = false;

    logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} destroyed`);
  }

  /**
   * Check if component is ready for operations
   */
  isReady(): boolean {
    return this.isInitialized && this.componentElement !== null;
  }

  /**
   * Get the component's DOM element
   */
  getElement(): HTMLElement | null {
    return this.componentElement;
  }

  /**
   * Force immediate render (bypasses debouncing)
   */
  async forceRender(): Promise<void> {
    await this.render();
  }

  /**
   * Update component visibility
   */
  setVisible(visible: boolean): void {
    if (this.componentElement) {
      this.componentElement.style.display = visible ? 'block' : 'none';
    }
  }

  /**
   * Add CSS classes to component element
   */
  addClass(className: string): void {
    if (this.componentElement) {
      this.componentElement.classList.add(className);
    }
  }

  /**
   * Remove CSS classes from component element
   */
  removeClass(className: string): void {
    if (this.componentElement) {
      this.componentElement.classList.remove(className);
    }
  }

  /**
   * Toggle CSS classes on component element
   */
  toggleClass(className: string, force?: boolean): void {
    if (this.componentElement) {
      this.componentElement.classList.toggle(className, force);
    }
  }
}