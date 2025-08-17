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

    // Setup state change listeners for subscribed state slices
    this.setupStateListeners();

    // Perform initial render
    await this.render();

    this.isInitialized = true;
    logger.debug(`🎵 YouTube DJ | Component ${this.config.selector} initialized`);
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
    
    // Check if any of our subscribed state slices changed
    return this.config.stateSubscriptions.some(subscription => {
      const keys = subscription.split('.');
      let current = changes;
      
      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key];
        } else {
          return false;
        }
      }
      
      return current !== undefined;
    });
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