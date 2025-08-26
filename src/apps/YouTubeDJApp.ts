/**
 * YouTube DJ Application - Component-Based Architecture
 * Isolated UI components prevent full window re-renders for optimal UX
 */

import { logger } from '../lib/logger.js';
import { SessionStore } from '../state/SessionStore.js';
import { StateChangeEvent } from '../state/StateTypes.js';
import { SessionManager } from '../services/SessionManager.js';
import { PlayerManager } from '../services/PlayerManager.js';
import { QueueManager } from '../services/QueueManager.js';
import { SocketManager } from '../services/SocketManager.js';

// UI Components
import { SessionControlsComponent } from '../ui/components/SessionControlsComponent.js';
import { QueueSectionComponent } from '../ui/components/QueueSectionComponent.js';
// PlayerControlsComponent now integrated into QueueSectionComponent
import { UIHelper } from '../ui/UIHelper.js';

interface YouTubeDJData {
  // Only main template context data needed - components handle their own data
  hasJoinedSession: boolean;
  isDJ: boolean;
}

export class YouTubeDJApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  
  // State management
  private store: SessionStore;
  
  // Service layer
  private sessionManager: SessionManager;
  private playerManager: PlayerManager;
  private queueManager: QueueManager;
  private socketManager: SocketManager;
  
  // UI Components
  private sessionControlsComponent!: SessionControlsComponent;
  private queueSectionComponent!: QueueSectionComponent;
  // PlayerControlsComponent integrated into QueueSectionComponent
  
  // Event cleanup tracking - separated by type
  private stateListenerCleanup: (() => void)[] = [];
  private domEventCleanup: (() => void)[] = [];
  
  constructor(options = {}) {
    super(options);
    
    // Initialize SessionStore integration
    this.store = SessionStore.getInstance();
    
    // Use global service instances for consistency
    this.socketManager = (globalThis as any).youtubeDJSocketManager;
    this.sessionManager = (globalThis as any).youtubeDJSessionManager;
    this.playerManager = (globalThis as any).youtubeDJPlayerManager;
    this.queueManager = (globalThis as any).youtubeDJQueueManager;
    
    // Validate all global services are available
    if (!this.socketManager) {
      logger.error('🎵 YouTube DJ | Global SocketManager not found - socket communication will not work');
    }
    if (!this.sessionManager) {
      logger.error('🎵 YouTube DJ | Global SessionManager not found - DJ controls will not work');
    }
    if (!this.playerManager) {
      logger.error('🎵 YouTube DJ | Global PlayerManager not found - player controls will not work');
    }
    if (!this.queueManager) {
      logger.error('🎵 YouTube DJ | Global QueueManager not found - queue controls will not work');
    }
    
    // Components handle their own rendering - no need for debounced render
    
    // Setup state change listeners
    this.setupStateListeners();
    
    logger.debug('🎵 YouTube DJ | YouTubeDJApp initialized with UI managers');
  }

  /**
   * Application configuration
   */
  static DEFAULT_OPTIONS = {
    id: 'youtube-dj-app',
    tag: 'section',
    window: {
      title: 'YouTube DJ Controls',
      icon: 'fas fa-music',
      resizable: true,
      minimizable: true
    },
    position: {
      width: 675,
      height: 'auto'
    }
  };

  /**
   * Template path for the application
   */
  get template(): string {
    return 'modules/bardic-inspiration/templates/youtube-dj.hbs';
  }

  /**
   * Prepare data for main template rendering - minimal context since components handle their own data
   */
  async _prepareContext(): Promise<YouTubeDJData> {
    const sessionState = this.store.getSessionState();
    const isDJ = this.store.isDJ();

    const context = {
      // Main template only needs structural information
      hasJoinedSession: sessionState.hasJoinedSession,
      isDJ
    };
    
    logger.debug('🎵 YouTube DJ | Main template context:', {
      hasJoinedSession: context.hasJoinedSession,
      isDJ: context.isDJ
    });
    
    return context;
  }

  /**
   * Setup state change listeners
   */
  private setupStateListeners(): void {
    // Main state change listener for reactive UI updates
    const stateChangeCleanup = UIHelper.addHookWithCleanup('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    this.stateListenerCleanup.push(stateChangeCleanup);
    
    logger.debug('🎵 YouTube DJ | State change listener registered', {
      hookListeners: Hooks.events['youtubeDJ.stateChanged']?.length || 0
    });

    // Player widget integration listeners
    this.stateListenerCleanup.push(
      UIHelper.addHookWithCleanup('youtubeDJ.isolatedPlayerReady', this.onIsolatedPlayerReady.bind(this))
    );

    this.stateListenerCleanup.push(
      UIHelper.addHookWithCleanup('youtubeDJ.isolatedPlayerDestroyed', this.onIsolatedPlayerDestroyed.bind(this))
    );
  }

  /**
   * Initialize UI components after initial render
   */
  private async initializeUIComponents(): Promise<void> {
    if (!this.element) return;

    // Only initialize components if user has joined session
    const sessionState = this.store.getSessionState();
    if (!sessionState.hasJoinedSession) {
      logger.debug('🎵 YouTube DJ | Skipping component initialization - not in session');
      return;
    }

    // Get the content element where the template is rendered
    const contentElement = this.element.querySelector('.window-content') as HTMLElement;
    if (!contentElement) {
      logger.error('🎵 YouTube DJ | Could not find window-content element');
      return;
    }

    try {
      // Initialize UI components with their specific containers
      this.sessionControlsComponent = new SessionControlsComponent(this.store, contentElement, this.sessionManager);
      this.queueSectionComponent = new QueueSectionComponent(this.store, contentElement, this.queueManager, this.playerManager);
      // PlayerControls integrated into QueueSectionComponent

      // Initialize all components
      await Promise.all([
        this.sessionControlsComponent.initialize(),
        this.queueSectionComponent.initialize()
      ]);

      logger.debug('🎵 YouTube DJ | UI components initialized');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to initialize UI components:', error);
    }
  }

  /**
   * Setup event listeners after render - delegate to components
   */
  private setupEventListeners(): void {
    if (!this.element) return;
    
    // Get the content element where the template is rendered
    const contentElement = this.element.querySelector('.window-content');
    if (!contentElement) {
      logger.error('🎵 YouTube DJ | Could not find window-content element for event listeners');
      return;
    }

    // Session controls event delegation
    this.addEventDelegation('.claim-dj-btn', 'click', () => this.sessionControlsComponent.onClaimDJClick());
    this.addEventDelegation('.release-dj-btn', 'click', () => this.sessionControlsComponent.onReleaseDJClick());
    this.addEventDelegation('.request-dj-btn', 'click', () => this.sessionControlsComponent.onRequestDJClick());
    this.addEventDelegation('.handoff-dj-btn', 'click', () => this.sessionControlsComponent.onHandoffDJClick());
    this.addEventDelegation('.approve-dj-request-btn', 'click', (e) => this.sessionControlsComponent.onApproveDJRequestClick(e));
    this.addEventDelegation('.deny-dj-request-btn', 'click', (e) => this.sessionControlsComponent.onDenyDJRequestClick(e));
    this.addEventDelegation('.gm-override-btn', 'click', () => this.sessionControlsComponent.onGMOverrideClick());

    // Queue controls event delegation  
    this.addEventDelegation('.add-to-queue-btn', 'click', () => this.queueSectionComponent.onAddToQueueClick());
    this.addEventDelegation('.remove-queue-btn', 'click', (e) => this.queueSectionComponent.onRemoveQueueClick(e));
    this.addEventDelegation('.move-up-btn', 'click', (e) => this.queueSectionComponent.onMoveUpClick(e));
    this.addEventDelegation('.move-down-btn', 'click', (e) => this.queueSectionComponent.onMoveDownClick(e));
    this.addEventDelegation('.skip-to-btn', 'click', (e) => this.queueSectionComponent.onSkipToClick(e));
    this.addEventDelegation('.clear-queue-btn', 'click', () => this.queueSectionComponent.onClearQueueClick());
    this.addEventDelegation('.save-queue-btn', 'click', () => this.queueSectionComponent.onSaveQueueClick());
    this.addEventDelegation('.load-queue-btn', 'click', () => this.queueSectionComponent.onLoadQueueClick());
    this.addEventDelegation('.youtube-url-input', 'keypress', (e) => this.queueSectionComponent.onUrlInputKeypress(e as KeyboardEvent));
    
    // Integrated playbook controls in queue section
    this.addEventDelegation('.play-btn', 'click', () => this.queueSectionComponent.onPlayClick());
    this.addEventDelegation('.pause-btn', 'click', () => this.queueSectionComponent.onPauseClick());
    this.addEventDelegation('.skip-btn', 'click', () => this.queueSectionComponent.onSkipClick());
    this.addEventDelegation('.start-queue-btn', 'click', () => this.queueSectionComponent.onStartQueueClick());

    // Removed: play-next-btn and load-video-btn - users can use queue reordering instead

    // Seek bar controls removed (seeking now handled by widget)

    // Widget volume control
    this.addEventDelegation('.volume-slider', 'input', (e) => (window as any).youtubeDJWidget?.onVolumeChange(e));
    this.addEventDelegation('.volume-slider', 'change', (e) => (window as any).youtubeDJWidget?.onVolumeChange(e));

    // Close button (app-level)
    this.addEventDelegation('.close-btn', 'click', () => this.close());

    logger.debug('🎵 YouTube DJ | Component event delegation setup complete');
  }

  /**
   * Add event delegation with cleanup tracking
   */
  private addEventDelegation(selector: string, event: string, handler: (e: Event) => void): void {
    // Get the content element for event delegation
    const contentElement = this.element?.querySelector('.window-content');
    if (!contentElement) {
      logger.error('🎵 YouTube DJ | Cannot add event delegation - window-content not found');
      return;
    }

    const wrappedHandler = (e: Event) => {
      // Check if the event target or any of its parents matches the selector
      const target = e.target as Element;
      const matchedElement = target.closest(selector);
      
      // Debug logging for queue buttons
      if (selector.includes('move-') || selector.includes('remove-queue') || selector.includes('clear-queue')) {
        logger.debug('🎵 YouTube DJ | Event delegation check', {
          selector,
          targetTag: target.tagName,
          targetClasses: target.className,
          matchedElement: !!matchedElement,
          contained: matchedElement ? contentElement.contains(matchedElement) : false
        });
      }
      
      if (matchedElement && contentElement.contains(matchedElement)) {
        handler(e);
      }
    };

    const cleanup = UIHelper.addEventListenerWithCleanup(contentElement, event, wrappedHandler, true);
    this.domEventCleanup.push(cleanup);
  }

  /**
   * Old event handlers - now handled by components
   */

  /**
   * Handle state changes - components handle their own updates now
   */
  private onStateChanged(event: StateChangeEvent): void {
    logger.debug('🎵 YouTube DJ | State changed in UI (received):', {
      hasElement: !!this.element,
      changes: Object.keys(event.changes),
      djChanged: event.changes.session?.djUserId !== undefined,
      membersChanged: event.changes.session?.members !== undefined,
      queueChanged: event.changes.queue !== undefined
    });

    if (!this.element) {
      logger.warn('🎵 YouTube DJ | State changed but no element - UI not ready');
      return;
    }

    // Only handle app-level state changes that require full re-render
    if (this.shouldFullRender(event)) {
      logger.debug('🎵 YouTube DJ | Triggering full render due to structural changes');
      this.render();
    } else {
      // Components handle their own selective updates via their state subscriptions
      logger.debug('🎵 YouTube DJ | Components handling selective updates');
    }

    // Handle non-visual state changes
    this.handleNonVisualStateChanges(event);
  }

  /**
   * Determine if full render is needed - much more restrictive now
   */
  private shouldFullRender(event: StateChangeEvent): boolean {
    const changes = event.changes;
    
    // Only full render for structural changes that affect the main template layout
    if (changes.session?.hasJoinedSession !== undefined) {
      logger.debug('🎵 YouTube DJ | Session join/leave - full render needed');
      return true;
    }
    
    // All other changes are handled by individual components
    return false;
  }

  /**
   * Components now handle their own selective updates
   * This method is no longer needed but kept for legacy compatibility
   */

  /**
   * Handle non-visual state changes (notifications, etc.)
   */
  private handleNonVisualStateChanges(event: StateChangeEvent): void {
    const changes = event.changes;
    const previousStatus = event.previous.session?.connectionStatus;
    const currentStatus = event.current.session?.connectionStatus;

    // Only show connection notifications when status actually changes
    if (changes.session?.connectionStatus !== undefined && 
        previousStatus !== currentStatus &&
        currentStatus === 'connected') {
      UIHelper.showNotification('Connected to Youtube DJ session', 'success', 3000);
    }
  }

  /**
   * Called after the application is rendered
   */
  async _onRender(): Promise<void> {
    super._onRender();
    
    const contentElement = this.element?.querySelector('.window-content');
    logger.debug('🎵 YouTube DJ | App render:', {
      hasElement: !!this.element,
      hasContent: !!contentElement,
      componentsInitialized: !!(this.sessionControlsComponent && this.queueSectionComponent)
    });

    // Check session state to determine if we need to re-initialize
    const sessionState = this.store.getSessionState();
    const needsComponentInit = sessionState.hasJoinedSession && !this.sessionControlsComponent;
    const needsFullRender = !this.sessionControlsComponent || 
                           (sessionState.hasJoinedSession && !this.element?.querySelector('.session-control-section'));
    
    // Render template on initial render or when session state changes
    if (needsFullRender) {
      logger.debug('🎵 YouTube DJ | Rendering template - components need setup', {
        hasJoinedSession: sessionState.hasJoinedSession,
        hasComponents: !!this.sessionControlsComponent
      });
      
      // Render main template structure (component containers only)
      if (contentElement) {
        try {
          const context = await this._prepareContext();
          const templateContent = await foundry.applications.handlebars.renderTemplate(this.template, context);
          contentElement.innerHTML = templateContent;
          logger.debug('🎵 YouTube DJ | Main template rendered');
        } catch (error) {
          logger.error('🎵 YouTube DJ | Failed to render main template:', error);
          return;
        }
      }

      // Clear previous DOM event listeners
      this.domEventCleanup.forEach(cleanup => cleanup());
      this.domEventCleanup = [];
      
      // Destroy existing components if they exist
      if (this.sessionControlsComponent) {
        this.sessionControlsComponent.destroy();
        this.sessionControlsComponent = null as any;
      }
      if (this.queueSectionComponent) {
        this.queueSectionComponent.destroy();
        this.queueSectionComponent = null as any;
      }
      // PlayerControls integrated into QueueSectionComponent
      
      // Initialize UI components (will check for hasJoinedSession internally)
      await this.initializeUIComponents();
      
      // Setup DOM event listeners
      this.setupEventListeners();
      
      logger.debug('🎵 YouTube DJ | Component setup completed');
    } else {
      // For subsequent renders, components handle their own updates
      logger.debug('🎵 YouTube DJ | Subsequent render - components handle updates');
    }
  }

  /**
   * Components handle their own updates now
   * This method is no longer needed
   */

  /**
   * Handle isolated player ready event
   */
  private onIsolatedPlayerReady(data: { player: YT.Player }): void {
    logger.debug('🎵 YouTube DJ | Isolated player ready');
    // Player state will be updated via state management
  }

  /**
   * Handle isolated player destroyed event
   */
  private onIsolatedPlayerDestroyed(): void {
    logger.debug('🎵 YouTube DJ | Isolated player destroyed');
    // Player state will be updated via state management
  }

  /**
   * Send command to isolated player widget
   */
  private sendPlayerCommand(command: string, args?: any[]): void {
    Hooks.callAll('youtubeDJ.playerCommand', { command, args });
  }

  /**
   * Static method to open the application
   */
  static open(): YouTubeDJApp {
    const existingApp = Object.values(ui.windows).find(app => app instanceof YouTubeDJApp) as YouTubeDJApp;
    
    if (existingApp) {
      existingApp.bringToTop();
      return existingApp;
    }
    
    const app = new YouTubeDJApp();
    app.render(true);
    return app;
  }

  /**
   * Cleanup when application is closed
   */
  async close(options?: any): Promise<void> {
    // Debug: Log what's triggering the close
    const stack = new Error().stack;
    logger.debug('🎵 YouTube DJ | Application close triggered', {
      options,
      stack: stack?.split('\n').slice(1, 5) // First few stack frames
    });
    
    // Clean up all event listeners
    this.stateListenerCleanup.forEach(cleanup => cleanup());
    this.domEventCleanup.forEach(cleanup => cleanup());
    this.stateListenerCleanup = [];
    this.domEventCleanup = [];
    
    // Destroy UI components
    if (this.sessionControlsComponent) {
      this.sessionControlsComponent.destroy();
    }
    if (this.queueSectionComponent) {
      this.queueSectionComponent.destroy();
    }
    // PlayerControls integrated into QueueSectionComponent
    
    // Note: Don't destroy global services - they persist across app instances
    
    logger.debug('🎵 YouTube DJ | Application closed and cleaned up');
    
    return super.close(options);
  }
}