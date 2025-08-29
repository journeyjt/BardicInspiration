# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Bardic Inspiration - YouTube DJ Module for FoundryVTT

A synchronized YouTube music playback module for tabletop gaming sessions featuring DJ management, queue controls, and real-time synchronization across all players. Current version: 1.0.1. Tested with FoundryVTT v13.347.

## Essential Development Commands

### Build & Development
```bash
npm run dev:serve       # Clean ports, bump version, build, and start dev server (recommended)
npm run vite:build      # Build production bundle
npm run vite:dev        # Start Vite dev server with HMR
npm run build           # Full build: prod urls, validate, bump version, build, and create zip
npm run validate        # Validate module structure and manifest
npm run dev:urls        # Set development URLs in module.json (Docker-compatible)
npm run prod:urls       # Set production URLs in module.json (GitHub releases)
npm run build:zip       # Create module.zip for distribution
```

### Testing
```bash
npm test                # Run all tests once
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
npm run test:ui         # Open Vitest UI in browser

# Run specific test file
npx vitest run tests/unit/SessionStore.test.ts

# Run tests matching pattern
npx vitest run -t "DJ role"

# Run specific test suites
npx vitest run tests/unit/         # Unit tests only
npx vitest run tests/integration/  # Integration tests only
npx vitest run tests/e2e/          # End-to-end tests only
```

### Port Management (Windows)
```bash
npm run dev:clean       # Clean ports 5000 and 517x if stuck
```

### Version Management
```bash
npm run version:bump    # Increment patch version in both package.json and module.json
```

### Development Server Details
- Development server: http://localhost:5000/modules/bardic-inspiration/
- FoundryVTT instance: http://localhost:30000 (if using Docker setup)
- Hot Module Replacement enabled on port 5000
- Vite proxies non-module requests to FoundryVTT instance on port 30000
- WebSocket connections automatically proxied for socket.io
- Server allows external connections (0.0.0.0) for Docker compatibility

## High-Level Architecture

### CRITICAL: Global vs Local Service Pattern

**⚠️ IMPORTANT**: The architecture uses a **hybrid service initialization pattern** that is crucial for multi-user functionality:

#### Global Services (MUST be initialized once in main.ts)
```typescript
// Global initialization ensures ALL users receive messages
const socketManager = new SocketManager(store);
socketManager.initialize();
(globalThis as any).youtubeDJSocketManager = socketManager;
```

**Services that MUST be global:**
- **`SocketManager`**: Universal message handling (prevents queue sync bugs)
- **`SessionManager`**, **`PlayerManager`**, **`QueueManager`**: Shared state management

**Why this pattern is essential:**
- Original bug: Services initialized only when DJ app opened → queue changes only updated DJ's UI
- Solution: Global initialization ensures all users receive updates regardless of app state
- Never create service instances in apps - always reference global instances

### Core Application Flow (Service-Oriented)

1. **Module Initialization** (`src/main.ts`):
   - Registers world-level settings for DJ state, session members, and queue
   - Initializes global `SocketManager` for universal message handling
   - Initializes `YouTubePlayerWidget` above player list
   - Exposes public API through `game.modules.get('bardic-inspiration').api`

2. **Service Layer**:
   - **`SessionStore`**: Centralized state management with FoundryVTT hooks
   - **`SocketManager`**: Global message handling and broadcasting
   - **`SessionManager`**: DJ roles, member management, session lifecycle
   - **`PlayerManager`**: YouTube player operations and synchronization
   - **`QueueManager`**: Queue operations and persistence
   - **`SavedQueuesManager`**: Saved queue persistence, load/save operations, export/import

3. **Application Layer** (`src/apps/YouTubeDJApp.ts`):
   - Pure presentation layer extending ApplicationV2 with Handlebars mixin
   - Reactive UI updates via state change hooks
   - Delegates business logic to service layer

4. **Widget Layer** (`src/ui/YouTubePlayerWidget.ts`):
   - Manages YouTube IFrame API player lifecycle
   - Handles actual YouTube player interactions
   - Positioned above FoundryVTT's player list
   - Isolated from services for browser constraint compliance

5. **Component-Based UI** (`src/ui/components/`):
   - `BaseComponent`: Foundation for all UI components with state subscriptions
   - `SessionControlsComponent`: DJ role management and member display
   - `QueueSectionComponent`: Queue display and operations with integrated player controls

6. **Dialog System** (`src/ui/`):
   - `ConfirmationDialog`: DialogV2-based themed confirmation dialogs
   - `SaveQueueDialog`: DialogV2 for saving current queue with custom names
   - `LoadQueueDialog`: DialogV2 for loading/managing saved queues
   - `ClearQueueDialog`: DialogV2 with save prompt before clearing

### Key Architectural Patterns

#### Hook-Based Communication
The architecture uses **FoundryVTT hooks as a message bus** for decoupled service communication:

```typescript
// SocketManager receives socket messages and emits hooks
Hooks.callAll('youtubeDJ.queueNext', { nextIndex, videoItem, timestamp });

// QueueManager listens for the hook
Hooks.on('youtubeDJ.queueNext', this.onQueueNext.bind(this));
```

**Hook Categories:**
- **State Events**: `youtubeDJ.stateChanged` - Central state change notifications
- **Socket Events**: `youtubeDJ.userJoined`, `youtubeDJ.djClaimReceived`, etc.
- **Player Commands**: `youtubeDJ.playerCommand`, `youtubeDJ.loadVideo`
- **Queue Operations**: `youtubeDJ.queueNext`, `youtubeDJ.queueAdd`

#### Socket Message Types
- Playback: `PLAY`, `PAUSE`, `SEEK`, `LOAD`
- DJ Management: `DJ_CLAIM`, `DJ_RELEASE`, `DJ_REQUEST`, `DJ_HANDOFF`, `GM_OVERRIDE`
- Session: `USER_JOIN`, `USER_LEAVE`, `STATE_REQUEST`, `STATE_RESPONSE`
- Queue: `QUEUE_ADD`, `QUEUE_REMOVE`, `QUEUE_NEXT`, `QUEUE_UPDATE`, `QUEUE_SYNC`
- Saved Queues: `QUEUE_SAVED`, `QUEUE_LOADED`, `QUEUE_DELETED`, `QUEUE_RENAMED`
- Sync: `HEARTBEAT`, `STATE_SAVE_REQUEST`

#### State Management
- **Single Source of Truth**: `SessionStore` manages all state
- **Persistence**: World settings for state recovery
- **Runtime vs Persistent State**: Session join state is runtime-only
- **Legacy Compatibility**: Supports both unified and legacy settings

### CRITICAL: YouTube IFrame API Container Visibility

**⚠️ IMPORTANT**: The YouTube IFrame API requires the target container to be **visible** (`display: block`) when the player is created. If the container has `display: none`, the API will silently fail.

**Solution implemented in `YouTubePlayerWidget.ts`:**
```typescript
// Container must be visible when hasJoinedSession is true
<div class="player-container ${hasJoinedSession ? 'active' : ''}" style="width: 100%; height: 140px;">
  <div id="${this.containerId}" style="width: 100%; height: 100%;"></div>
</div>
```

## Development Guidelines

### Critical Architectural Rules

**DO:**
- ✅ Reference global service instances from `globalThis`
- ✅ Use `SessionStore.getInstance().updateState()` for ALL state changes
- ✅ Communicate between services via hooks, not direct references
- ✅ Send player commands through widget proxy via hooks
- ✅ Validate all socket messages before processing
- ✅ Consider multi-user synchronization in all operations

**DON'T:**
- ❌ Create service instances in apps (breaks multi-user sync)
- ❌ Bypass SessionStore for state changes (breaks persistence)
- ❌ Integrate YouTube API outside widget (violates browser constraints)
- ❌ Assume single-user operation (architecture is inherently multi-user)
- ❌ Use deep state spreading in updates (causes UI thrashing)

### Adding New Features

1. **State Changes**: Use `SessionStore.getInstance().updateState()` for all state modifications
2. **Player Commands**: Send through widget using `Hooks.callAll('youtubeDJ.playerCommand', data)`
3. **Socket Messages**: Register handlers in `SocketManager` for type safety
4. **UI Updates**: React to state changes via `youtubeDJ.stateChanged` hook
5. **Components**: Extend `BaseComponent` for new UI components

### Testing Guidelines

The module includes comprehensive unit, integration, and e2e tests:

#### Test Coverage Areas
- **Unit Tests**: Individual service functionality (SessionStore, SessionManager, SocketManager)
- **Integration Tests**: Multi-user scenarios and service interactions
- **End-to-End Tests**: Complete user workflows and bug scenario reproductions

#### Key Test Scenarios
- Multi-user session management and synchronization
- DJ role claiming, handoff, and release workflows
- Session state recovery after disconnection
- Heartbeat system and inactive user cleanup
- "Ghost user" bug prevention and user reconnection flows

## Common Debugging Scenarios

### Queue Not Syncing to All Users
**Check:** Is `SocketManager` globally initialized in main.ts?
**Solution:** Ensure global initialization pattern is followed

### UI Scrolling/Thrashing Issues
**Check:** Are you spreading state objects in updates?
**Solution:** Only update changed properties, avoid spreading entire state objects

### Player Commands Not Working
**Check:** Is the YouTube widget properly initialized and visible?
**Solution:** Check widget container visibility and player ready state

### Users Not Being Removed When Inactive
**Check:** Is heartbeat processing working correctly?
**Solution:** Verify `HeartbeatResponseHandler` and `SessionManager` activity tracking

## Technology Stack

- **TypeScript**: Full type safety with FoundryVTT type definitions
- **Vite**: Modern bundling with HMR support and custom middleware for module serving
- **Vitest**: Testing framework with jsdom for DOM simulation  
- **Handlebars**: Template rendering with FoundryVTT integration
- **YouTube IFrame API**: Embedded player control
- **CSS Custom Properties**: Themeable design system

## Build Configuration

### Vite Configuration (`vite.config.js`)
- Base path: `/modules/bardic-inspiration/`
- Development port: 5000 (strict, fails if in use)
- Proxy configuration for FoundryVTT on port 30000
- Custom middleware for serving module.json, module.zip, and dist files
- External dependencies: FoundryVTT globals not bundled
- Source maps enabled for development

### TypeScript Configuration (`tsconfig.json`)
- Target: ES2022 with ESNext modules
- Module resolution: bundler mode with import extensions allowed
- Strict mode: disabled for FoundryVTT compatibility
- Path alias: `@/*` maps to `./src/*`
- Type roots: FoundryVTT types from @league-of-foundry-developers

### Test Configuration (`vitest.config.ts`)
- Environment: jsdom for DOM simulation
- Setup file: `./tests/setup/test-setup.ts`
- Coverage: v8 provider with HTML/JSON/text reporters
- Test structure: unit/, integration/, e2e/, and performance/ test directories

## Module Integration Points

1. **FoundryVTT Hooks**:
   - `init`: Module initialization and settings registration
   - `ready`: Post-initialization setup

2. **World Settings** (stored in `core` scope):
   - `youtubeDJ.sessionState`: Unified session state (new)
   - `youtubeDJ.currentDJ`: Active DJ user ID (legacy)
   - `youtubeDJ.sessionMembers`: Connected users list (legacy)
   - `youtubeDJ.queueState`: Full queue and playback state
   - `youtubeDJ.savedQueues`: Persisted saved queue configurations

3. **Public API** (via `game.modules.get('bardic-inspiration').api`):
   - `openYoutubeDJ()`: Opens the DJ application window
   - `openYoutubeDJWidget()`: Initializes the widget
   - `getLibWrapperUtils()`: Access to libWrapper utilities

## Recent Major Fixes

### ✅ Queue Synchronization Issue (v0.8.100+)
**Problem**: Queue UI updates weren't syncing to listeners
**Solution**: Global `SocketManager` initialization for universal message handling

### ✅ UI Thrashing/Scrolling Bug (v0.8.100+)
**Problem**: Periodic messages causing UI to scroll to top
**Solution**: Component-based architecture with isolated render cycles

### ✅ Volume Control Consolidation (v0.8.115+)
**Problem**: Multiple redundant mute buttons
**Solution**: Consolidated controls in widget with direct event listeners

### ✅ Queue Persistence Feature (v1.0.1+)
**Problem**: DJs couldn't save favorite playlists for reuse
**Solution**: Added SavedQueuesManager service with full save/load/export functionality

### ✅ Audio Settings Preservation (v1.0.1+)
**Problem**: Loading saved queues would unmute users unintentionally
**Solution**: Use cueVideo with autoPlay=false to preserve user audio preferences

### ✅ Multi-User Queue Load Sync (v1.0.1+)
**Problem**: Loading saved queue only updated DJ's view
**Solution**: Added QUEUE_SYNC socket message to broadcast full queue state

## Current Working Branch

The repository is currently on `feat-support-yt-playlist-links` branch with the following changes:
- Modified files include QueueManager, PlayerManager, SocketManager, and UI components
- New test files for playlist functionality and playback
- Uncommitted documentation files (CLAUDE.md, architecture.mmd, docs/)

## Project Status

**Production Ready** - Version 1.0.25 with:
- ✅ Stable multi-user synchronization
- ✅ Component-based UI preventing full re-renders
- ✅ Comprehensive test coverage (unit, integration, e2e, performance)
- ✅ Global service architecture for reliable message handling
- ✅ Persistent widget above player list
- ✅ Queue save/load functionality with export/import
- ✅ Audio settings preservation across queue operations
- ✅ FoundryVTT v12-v13 compatibility
- ✅ Group Mode for collaborative queue management