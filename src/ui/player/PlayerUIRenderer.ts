import type { ExtendedPlayerState } from './PlayerStateManager.js';

export interface UIElement {
  id: string;
  element: HTMLElement;
  updateFn: (state: ExtendedPlayerState) => void;
  visible: boolean;
}

export interface UIConfig {
  containerSelector: string;
  playerContainerSelector: string;
  controlsContainerSelector?: string;
  debugMode?: boolean;
}

export interface RenderContext {
  state: ExtendedPlayerState;
  hasJoinedSession: boolean;
  isVisible: boolean;
  containerWidth: number;
  containerHeight: number;
}

export class PlayerUIRenderer {
  private config: UIConfig;
  private container: HTMLElement | null = null;
  private playerContainer: HTMLElement | null = null;
  private controlsContainer: HTMLElement | null = null;
  private elements = new Map<string, UIElement>();
  private renderQueue = new Set<string>();
  private renderTimer: number | null = null;
  private debugMode = false;
  private isRendering = false;

  constructor(config: UIConfig) {
    this.config = config;
    this.debugMode = config.debugMode || false;
  }

  // Initialization
  async initialize(): Promise<void> {
    this.container = document.querySelector(this.config.containerSelector);
    if (!this.container) {
      // For the widget case, the container might not exist yet, so we'll check again later
      if (this.debugMode) {
        console.warn(`PlayerUIRenderer: Container not found initially: ${this.config.containerSelector}`);
      }
    }

    this.playerContainer = document.querySelector(this.config.playerContainerSelector);
    if (!this.playerContainer) {
      // For the widget case, the player container is created dynamically, so this is expected
      if (this.debugMode) {
        console.warn(`PlayerUIRenderer: Player container not found initially: ${this.config.playerContainerSelector}`);
      }
    }

    if (this.config.controlsContainerSelector) {
      this.controlsContainer = document.querySelector(this.config.controlsContainerSelector);
    }

    if (this.debugMode) {
      console.log('PlayerUIRenderer: Initialized', {
        container: this.container,
        playerContainer: this.playerContainer,
        controlsContainer: this.controlsContainer
      });
    }
  }

  // Element registration and management
  registerElement(
    id: string, 
    selector: string, 
    updateFn: (state: ExtendedPlayerState) => void
  ): void {
    const element = document.querySelector(selector) as HTMLElement;
    if (!element) {
      console.warn(`PlayerUIRenderer: Element not found for selector: ${selector}`);
      return;
    }

    this.elements.set(id, {
      id,
      element,
      updateFn,
      visible: true
    });

    if (this.debugMode) {
      console.log(`PlayerUIRenderer: Registered element ${id}`, element);
    }
  }

  unregisterElement(id: string): void {
    this.elements.delete(id);
    this.renderQueue.delete(id);
  }

  getElement(id: string): HTMLElement | null {
    const uiElement = this.elements.get(id);
    return uiElement ? uiElement.element : null;
  }

  setElementVisibility(id: string, visible: boolean): void {
    const uiElement = this.elements.get(id);
    if (uiElement) {
      uiElement.visible = visible;
      uiElement.element.style.display = visible ? '' : 'none';
    }
  }

  // Rendering
  render(state: ExtendedPlayerState, context?: Partial<RenderContext>): void {
    if (this.isRendering) {
      // Queue all elements for re-render
      this.elements.forEach((_, id) => {
        this.renderQueue.add(id);
      });
      return;
    }

    this.isRendering = true;

    try {
      const renderContext: RenderContext = {
        state,
        hasJoinedSession: true,
        isVisible: true,
        containerWidth: this.container?.clientWidth || 0,
        containerHeight: this.container?.clientHeight || 0,
        ...context
      };

      // Update container visibility
      this.updateContainerVisibility(renderContext);

      // Update all registered elements
      this.elements.forEach((uiElement, id) => {
        if (uiElement.visible) {
          try {
            uiElement.updateFn(state);
          } catch (error) {
            console.error(`PlayerUIRenderer: Error updating element ${id}:`, error);
          }
        }
      });

      if (this.debugMode) {
        console.log('PlayerUIRenderer: Rendered', { state, context: renderContext });
      }
    } finally {
      this.isRendering = false;

      // Process queued renders
      if (this.renderQueue.size > 0) {
        this.scheduleElementUpdates(state);
      }
    }
  }

  renderElement(id: string, state: ExtendedPlayerState): void {
    const uiElement = this.elements.get(id);
    if (!uiElement || !uiElement.visible) return;

    try {
      uiElement.updateFn(state);
    } catch (error) {
      console.error(`PlayerUIRenderer: Error updating element ${id}:`, error);
    }
  }

  scheduleRender(state: ExtendedPlayerState, context?: Partial<RenderContext>): void {
    if (this.renderTimer) {
      cancelAnimationFrame(this.renderTimer);
    }

    this.renderTimer = requestAnimationFrame(() => {
      this.render(state, context);
      this.renderTimer = null;
    });
  }

  private scheduleElementUpdates(state: ExtendedPlayerState): void {
    const elementsToUpdate = Array.from(this.renderQueue);
    this.renderQueue.clear();

    if (this.renderTimer) {
      cancelAnimationFrame(this.renderTimer);
    }

    this.renderTimer = requestAnimationFrame(() => {
      elementsToUpdate.forEach(id => {
        this.renderElement(id, state);
      });
      this.renderTimer = null;
    });
  }

  // Container management
  private updateContainerVisibility(context: RenderContext): void {
    if (!this.container) return;

    const shouldShow = context.hasJoinedSession && context.isVisible;
    const currentDisplay = this.container.style.display;
    const targetDisplay = shouldShow ? 'block' : 'none';

    if (currentDisplay !== targetDisplay) {
      this.container.style.display = targetDisplay;
      
      if (this.debugMode) {
        console.log(`PlayerUIRenderer: Container visibility changed to ${targetDisplay}`);
      }
    }
  }

  showContainer(): void {
    if (this.container) {
      this.container.style.display = 'block';
      this.container.classList.add('active');
    }
  }

  hideContainer(): void {
    if (this.container) {
      this.container.style.display = 'none';
      this.container.classList.remove('active');
    }
  }

  setContainerClass(className: string, add: boolean): void {
    if (this.container) {
      if (add) {
        this.container.classList.add(className);
      } else {
        this.container.classList.remove(className);
      }
    }
  }

  // Player container specific methods
  setPlayerContainerSize(width: string, height: string): void {
    if (this.playerContainer) {
      this.playerContainer.style.width = width;
      this.playerContainer.style.height = height;
    }
  }

  getPlayerContainerSize(): { width: number; height: number } {
    if (!this.playerContainer) return { width: 0, height: 0 };
    
    return {
      width: this.playerContainer.clientWidth,
      height: this.playerContainer.clientHeight
    };
  }

  // Utility methods for common UI updates
  updateProgressBar(elementId: string, current: number, duration: number): void {
    const element = this.getElement(elementId) as HTMLInputElement;
    if (!element) return;

    const percentage = duration > 0 ? (current / duration) * 100 : 0;
    
    if (element.type === 'range') {
      element.value = current.toString();
      element.max = duration.toString();
    } else {
      element.style.width = `${percentage}%`;
    }
  }

  updateTimeDisplay(elementId: string, time: number): void {
    const element = this.getElement(elementId);
    if (!element) return;

    element.textContent = this.formatTime(time);
  }

  updateVolumeControl(elementId: string, volume: number, isMuted: boolean): void {
    const element = this.getElement(elementId) as HTMLInputElement;
    if (!element) return;

    if (element.type === 'range') {
      element.value = isMuted ? '0' : volume.toString();
    }

    element.classList.toggle('muted', isMuted);
  }

  updatePlayButton(elementId: string, isPlaying: boolean): void {
    const element = this.getElement(elementId);
    if (!element) return;

    element.textContent = isPlaying ? '⏸️' : '▶️';
    element.classList.toggle('playing', isPlaying);
    element.classList.toggle('paused', !isPlaying);
  }

  updateVideoTitle(elementId: string, title?: string): void {
    const element = this.getElement(elementId);
    if (!element) return;

    element.textContent = title || 'No video loaded';
    element.title = title || '';
  }

  updateLoadingState(elementId: string, isLoading: boolean): void {
    const element = this.getElement(elementId);
    if (!element) return;

    element.classList.toggle('loading', isLoading);
    
    if (isLoading) {
      element.setAttribute('aria-busy', 'true');
    } else {
      element.removeAttribute('aria-busy');
    }
  }

  updateErrorState(elementId: string, hasError: boolean, message?: string): void {
    const element = this.getElement(elementId);
    if (!element) return;

    element.classList.toggle('error', hasError);
    
    if (hasError && message) {
      element.textContent = message;
      element.title = message;
    }
  }

  // Utility functions
  private formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }

  // Accessibility helpers
  setAriaLabel(elementId: string, label: string): void {
    const element = this.getElement(elementId);
    if (element) {
      element.setAttribute('aria-label', label);
    }
  }

  setAriaPressed(elementId: string, pressed: boolean): void {
    const element = this.getElement(elementId);
    if (element) {
      element.setAttribute('aria-pressed', pressed.toString());
    }
  }

  announceToScreenReader(message: string): void {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.style.position = 'absolute';
    announcement.style.left = '-10000px';
    announcement.style.width = '1px';
    announcement.style.height = '1px';
    announcement.style.overflow = 'hidden';
    
    document.body.appendChild(announcement);
    announcement.textContent = message;
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // Configuration
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  // Statistics and diagnostics
  getStats(): {
    elementCount: number;
    renderQueueSize: number;
    isRendering: boolean;
    hasRenderTimer: boolean;
    containerDimensions: { width: number; height: number };
  } {
    return {
      elementCount: this.elements.size,
      renderQueueSize: this.renderQueue.size,
      isRendering: this.isRendering,
      hasRenderTimer: this.renderTimer !== null,
      containerDimensions: {
        width: this.container?.clientWidth || 0,
        height: this.container?.clientHeight || 0
      }
    };
  }

  // Cleanup
  destroy(): void {
    if (this.renderTimer) {
      cancelAnimationFrame(this.renderTimer);
      this.renderTimer = null;
    }

    this.elements.clear();
    this.renderQueue.clear();
    this.container = null;
    this.playerContainer = null;
    this.controlsContainer = null;
  }
}