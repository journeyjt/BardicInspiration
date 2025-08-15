/**
 * Main module entry point
 */

const MODULE_ID = 'bardic-inspiration';

class ModuleAPI {
  static ID = MODULE_ID;
  
  // Expose public API methods here
  static somePublicMethod() {
    // Implementation will be added later
  }
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Module initialized`);
  
  // Register module in global scope for API access
  game.modules.get(MODULE_ID).api = ModuleAPI;
});

Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Module ready`);
  
  // Check for Developer Mode
  if (game.modules.get('_dev-mode')?.active) {
    console.log(`${MODULE_ID} | Developer Mode detected`);
  }
});

// DevMode hook for debugging
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
  registerPackageDebugFlag(MODULE_ID);
});