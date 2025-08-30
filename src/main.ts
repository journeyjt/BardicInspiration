/**
 * Bardic Inspiration Module
 * Main entry point with TypeScript and modern tooling
 */

import { LibWrapperUtils } from './lib/lib-wrapper-utils.js';
import { YouTubeDJApp } from './apps/YouTubeDJApp.js';
import { YouTubePlayerWidget } from './ui/YouTubePlayerWidget.js';
import { SessionStore } from './state/SessionStore.js';
import { SocketManager } from './services/SocketManager.js';
import { SessionManager } from './services/SessionManager.js';
import { PlayerManager } from './services/PlayerManager.js';
import { QueueManager } from './services/QueueManager.js';
import { SavedQueuesManager } from './services/SavedQueuesManager.js';
import { UIHelper } from './ui/UIHelper.js';
import { logger } from './lib/logger.js';
import './styles/main.css';

const MODULE_ID = 'bardic-inspiration';

class BardicInspirationAPI implements ModuleAPI {
  readonly ID = MODULE_ID;

  openYoutubeDJ(): void {
    YouTubeDJApp.open();
  }

  openYoutubeDJWidget(): void {
    YouTubePlayerWidget.getInstance().initialize();
  }

  getLibWrapperUtils(): any {
    return LibWrapperUtils;
  }
}

// Module initialization
Hooks.once('init', () => {
  logger.info('Module initialized');
  
  // Register Handlebars helpers for queue UI
  Handlebars.registerHelper('add', function(a: number, b: number): number {
    return a + b;
  });

  Handlebars.registerHelper('eq', function(a: any, b: any): boolean {
    return a === b;
  });
  
  // Initialize SessionStore
  SessionStore.getInstance().initialize();
  logger.info('YouTube DJ SessionStore initialized');
  
  // Services will be initialized in the ready hook
  
  // Register world-level settings for YouTube DJ
  // New unified session state setting
  game.settings.register('core', 'youtubeDJ.sessionState', {
    name: 'YouTube DJ Session State',
    hint: 'Unified session state for YouTube DJ module',
    scope: 'world',
    config: false,
    type: Object,
    default: null
  });

  // Legacy settings for backward compatibility
  game.settings.register('core', 'youtubeDJ.currentDJ', {
    name: 'YouTube DJ Current DJ',
    hint: 'The current DJ user ID',
    scope: 'world',
    config: false,
    type: String,
    default: null
  });

  game.settings.register('core', 'youtubeDJ.sessionMembers', {
    name: 'YouTube DJ Session Members',
    hint: 'Current session members list',
    scope: 'world',
    config: false,
    type: Object,
    default: []
  });

  // MVP-U4: Queue state setting
  game.settings.register('core', 'youtubeDJ.queueState', {
    name: 'YouTube DJ Queue State',
    hint: 'Current queue state with videos and index',
    scope: 'world',
    config: false,
    type: Object,
    default: {
      items: [],
      currentIndex: -1,
      mode: 'single-dj',
      djUserId: null,
      savedQueues: []
    }
  });

  // Saved queues setting
  game.settings.register('core', 'youtubeDJ.savedQueues', {
    name: 'YouTube DJ Saved Queues',
    hint: 'Saved queue templates that can be loaded',
    scope: 'world',
    config: false,
    type: Array,
    default: []
  });

  // Group Mode setting - visible in module settings
  game.settings.register('bardic-inspiration', 'youtubeDJ.groupMode', {
    name: 'Group Mode',
    hint: 'When enabled, all users in the listening session can add videos to the queue (not just the DJ)',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: (value: boolean) => {
      logger.info(`YouTube DJ Group Mode ${value ? 'enabled' : 'disabled'}`);
      // Update the queue state mode
      const queueState = game.settings.get('core', 'youtubeDJ.queueState') as any;
      queueState.mode = value ? 'collaborative' : 'single-dj';
      game.settings.set('core', 'youtubeDJ.queueState', queueState);
      // Notify all users of the mode change
      Hooks.callAll('youtubeDJ.groupModeChanged', { enabled: value });
    }
  });

  // Client-side settings for user preferences (not synchronized)
  game.settings.register('bardic-inspiration', 'youtubeDJ.userMuted', {
    name: 'Personal Mute State',
    hint: 'Your personal mute preference for the YouTube DJ player',
    scope: 'client',
    config: false, // Hidden from settings menu
    type: Boolean,
    default: false
  });

  game.settings.register('bardic-inspiration', 'youtubeDJ.userVolume', {
    name: 'Personal Volume',
    hint: 'Your personal volume preference for the YouTube DJ player',
    scope: 'client', 
    config: false, // Hidden from settings menu
    type: Number,
    default: 50
  });

  logger.info('YouTube DJ world settings registered');
  
  // Register module API globally
  const module = game.modules.get(MODULE_ID);
  if (module) {
    const apiInstance = new BardicInspirationAPI();
    (module as any).api = apiInstance;
  }

  // Example of using libWrapper (when available)
  if (LibWrapperUtils.isLibWrapperAvailable()) {
    logger.info('libWrapper detected and ready');
  }
});

Hooks.once('ready', async () => {
  logger.info('Module ready');
  
  // Load SessionStore state from world settings
  await SessionStore.getInstance().loadFromWorld();
  logger.info('YouTube DJ state loaded from world settings');
  
  // Initialize global service managers
  const store = SessionStore.getInstance();
  
  // Initialize global SocketManager for message handling
  const socketManager = new SocketManager(store);
  socketManager.initialize();
  logger.info('YouTube DJ SocketManager initialized globally');
  
  // Initialize global SessionManager for DJ role management
  const sessionManager = new SessionManager(store);
  logger.info('YouTube DJ SessionManager initialized globally');
  
  // Initialize global PlayerManager for playback control
  const playerManager = new PlayerManager(store);
  logger.info('YouTube DJ PlayerManager initialized globally');
  
  // Initialize global QueueManager for queue operations
  const queueManager = new QueueManager(store);
  logger.info('YouTube DJ QueueManager initialized globally');
  
  // Initialize global SavedQueuesManager for saved queue operations
  const savedQueuesManager = new SavedQueuesManager(store, queueManager);
  logger.info('YouTube DJ SavedQueuesManager initialized globally');
  
  // Connect QueueManager to SavedQueuesManager for queue modification tracking
  queueManager.setSavedQueuesManager(savedQueuesManager);
  
  // Store global references for access across components
  (globalThis as any).youtubeDJSocketManager = socketManager;
  (globalThis as any).youtubeDJSessionManager = sessionManager;
  (globalThis as any).youtubeDJPlayerManager = playerManager;
  (globalThis as any).youtubeDJQueueManager = queueManager;
  (globalThis as any).youtubeDJSavedQueuesManager = savedQueuesManager;
  
  // Initialize YouTube player widget above player list
  try {
    const widget = YouTubePlayerWidget.getInstance();
    await widget.initialize();
    
    // Add global reference for inline handlers
    (window as any).youtubeDJWidget = widget;
    
    logger.info('YouTube DJ widget initialized above player list');
  } catch (error) {
    logger.warn('Failed to initialize YouTube DJ widget:', error);
  }
  
  // Check for Developer Mode
  const devMode = game.modules.get('_dev-mode');
  if (devMode?.active) {
    logger.info('Developer Mode detected - enhanced logging enabled');
  }
});

// Scene controls tool removed - widget now handles DJ controls launching


// Developer Mode integration
Hooks.once('devModeReady', ({ registerPackageDebugFlag }: { registerPackageDebugFlag: (packageId: string) => void }) => {
  registerPackageDebugFlag(MODULE_ID);
  logger.info('Debug flag registered with Developer Mode');
});

// Hot Module Replacement support for Vite
if (import.meta.hot) {
  import.meta.hot.accept();
  logger.debug('Hot Module Replacement enabled');
}

// Export API for external access
export { BardicInspirationAPI as default };