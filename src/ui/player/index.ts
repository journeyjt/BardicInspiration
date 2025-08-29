// Core components
export { YouTubePlayerCore } from './YouTubePlayerCore.js';
export type { 
  YouTubePlayerConfig, 
  VideoInfo, 
  PlayerState 
} from './YouTubePlayerCore.js';

// Command queue
export { PlayerCommandQueue } from './PlayerCommandQueue.js';
export type { 
  PlayerCommand, 
  CommandResult, 
  CommandHandler 
} from './PlayerCommandQueue.js';

// State management
export { PlayerStateManager } from './PlayerStateManager.js';
export type { 
  ExtendedPlayerState, 
  PlaybackEvent, 
  StateSnapshot, 
  StateChangeCallback 
} from './PlayerStateManager.js';

// UI rendering
export { PlayerUIRenderer } from './PlayerUIRenderer.js';
export type { 
  UIElement, 
  UIConfig, 
  RenderContext 
} from './PlayerUIRenderer.js';

// Event handling
export { PlayerEventHandler } from './PlayerEventHandler.js';
export type { 
  EventContext, 
  PlayerEvent, 
  EventHandler, 
  EventFilter, 
  EventSubscription 
} from './PlayerEventHandler.js';

// Manager
export { YouTubePlayerManager } from './YouTubePlayerManager.js';
export type { 
  YouTubePlayerManagerConfig, 
  PlayerManagerState 
} from './YouTubePlayerManager.js';

// Adapter for integration
export { YouTubeWidgetAdapter } from './YouTubeWidgetAdapter.js';