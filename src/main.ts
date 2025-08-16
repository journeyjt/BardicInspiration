/**
 * Bardic Inspiration Module
 * Main entry point with TypeScript and modern tooling
 */

import { LibWrapperUtils } from './lib/lib-wrapper-utils.js';
import { YouTubeDJApp } from './apps/YouTubeDJApp.js';
import { logger } from './lib/logger.js';
import './styles/main.css';

const MODULE_ID = 'bardic-inspiration';

interface ModuleAPI {
  ID: string;
  openYoutubeDJ(): void;
  somePublicMethod(): void;
}

class BardicInspirationAPI implements ModuleAPI {
  static readonly ID = MODULE_ID;

  static openYoutubeDJ(): void {
    YouTubeDJApp.open();
  }

  static somePublicMethod(): void {
    logger.api('Public API method called');
  }

  static getLibWrapperUtils(): typeof LibWrapperUtils {
    return LibWrapperUtils;
  }
}

// Module initialization
Hooks.once('init', () => {
  logger.info('Module initialized');
  
  // Register world-level settings for YouTube DJ
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
      djUserId: null
    }
  });

  logger.info('YouTube DJ world settings registered');
  
  // Register module API globally
  const module = game.modules.get(MODULE_ID);
  if (module) {
    (module as any).api = BardicInspirationAPI;
  }

  // Example of using libWrapper (when available)
  if (LibWrapperUtils.isLibWrapperAvailable()) {
    logger.info('libWrapper detected and ready');
  }
});

Hooks.once('ready', () => {
  logger.info('Module ready');
  
  // Check for Developer Mode
  const devMode = game.modules.get('_dev-mode');
  if (devMode?.active) {
    logger.info('Developer Mode detected - enhanced logging enabled');
  }
});

// Use getSceneControlButtons hook to add control buttons properly
Hooks.on('getSceneControlButtons', (controls: any) => {
  logger.debug('Adding tool to existing controls');
  
  // In v13, controls.tokens.tools is an object, not an array
  if (controls.tokens && controls.tokens.tools) {
    logger.debug('Adding tool to tokens control group');
    
    // Add our tool as a property of the tools object
    controls.tokens.tools['bardic-inspiration-youtube-dj'] = {
      name: 'bardic-inspiration-youtube-dj',
      title: 'YouTube DJ - Synced Player',
      icon: 'fas fa-music',
      onChange: () => {
        logger.debug('YouTube DJ tool clicked!');
        BardicInspirationAPI.openYoutubeDJ();
      },
      button: true
    };
    
    logger.debug('Tool added to tokens control group');
    logger.debug('Updated tools:', Object.keys(controls.tokens.tools));
  } else {
    logger.warn('No tokens control or tools found in controls');
  }
});


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