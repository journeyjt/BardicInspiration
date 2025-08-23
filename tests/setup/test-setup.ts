/**
 * Test setup and configuration for YouTube DJ module tests
 * Mocks FoundryVTT global objects and provides testing utilities
 */

import { vi } from 'vitest';

// Mock FoundryVTT globals
const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  isGM: false,
};

const mockUsers = new Map([
  ['test-user-id', mockUser],
  ['test-dj-id', { id: 'test-dj-id', name: 'Test DJ', isGM: false }],
  ['test-gm-id', { id: 'test-gm-id', name: 'Test GM', isGM: true }],
]);

const mockSocket = {
  connected: true,
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

const mockSettings = new Map();
const mockSettingsManager = {
  get: vi.fn((scope: string, key: string) => mockSettings.get(`${scope}.${key}`)),
  set: vi.fn((scope: string, key: string, value: any) => mockSettings.set(`${scope}.${key}`, value)),
  register: vi.fn(),
};

const mockNotifications = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const mockModule = {
  id: 'bardic-inspiration',
  active: true,
  api: {},
};

const mockModules = new Map([
  ['bardic-inspiration', mockModule],
]);

// Mock Hooks system with event tracking
const mockHooksEvents = new Map<string, Function[]>();

const mockHooks = {
  events: {},
  on: vi.fn((event: string, callback: Function) => {
    if (!mockHooksEvents.has(event)) {
      mockHooksEvents.set(event, []);
    }
    mockHooksEvents.get(event)!.push(callback);
    // Update events object for compatibility
    (mockHooks.events as any)[event] = mockHooksEvents.get(event);
  }),
  off: vi.fn((event: string, callback?: Function) => {
    if (callback) {
      const listeners = mockHooksEvents.get(event);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    } else {
      mockHooksEvents.delete(event);
      delete (mockHooks.events as any)[event];
    }
  }),
  once: vi.fn((event: string, callback: Function) => {
    const wrappedCallback = (...args: any[]) => {
      callback(...args);
      mockHooks.off(event, wrappedCallback);
    };
    mockHooks.on(event, wrappedCallback);
  }),
  callAll: vi.fn((event: string, ...args: any[]) => {
    const listeners = mockHooksEvents.get(event) || [];
    listeners.forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Hook listener error for ${event}:`, error);
      }
    });
  }),
  call: vi.fn((event: string, ...args: any[]) => {
    const listeners = mockHooksEvents.get(event) || [];
    return listeners.reduce((result, listener) => {
      try {
        return listener(...args) || result;
      } catch (error) {
        console.error(`Hook listener error for ${event}:`, error);
        return result;
      }
    }, undefined);
  }),
};

// Global FoundryVTT mock
(global as any).game = {
  user: mockUser,
  users: mockUsers,
  socket: mockSocket,
  settings: mockSettingsManager,
  modules: {
    get: vi.fn((id: string) => mockModules.get(id)),
  },
};

(global as any).ui = {
  notifications: mockNotifications,
};

(global as any).Hooks = mockHooks;

(global as any).Handlebars = {
  registerHelper: vi.fn(),
};

// Mock FoundryVTT's foundry global namespace
(global as any).foundry = {
  applications: {
    api: {
      ApplicationV2: class MockApplicationV2 {
        static DEFAULT_OPTIONS = {
          window: { title: '', icon: '' },
          position: {},
          actions: {},
          form: {}
        };
        options: any = {
          window: { title: '', icon: '' },
          position: {},
          actions: {},
          form: {}
        };
        element: HTMLElement;
        
        constructor() {
          this.element = document.createElement('div');
          this.element.className = 'application';
        }
        
        async render(force?: boolean): Promise<this> {
          // Simulate template rendering
          if (this.template && (global as any).renderTemplate.getMockImplementation()) {
            const context = await this._prepareContext();
            const html = await (global as any).renderTemplate(this.template, context);
            this.element.innerHTML = html;
            document.body.appendChild(this.element);
            
            // Call _onRender if it exists
            if (this._onRender) {
              this._onRender(context, {});
            }
          }
          return this;
        }
        
        async close(): Promise<this> {
          if (this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
          }
          return this;
        }
        
        get template(): string {
          return '';
        }
        
        async _prepareContext(): Promise<any> {
          return {};
        }
        
        _onRender(context: any, options: any): void {}
      },
      HandlebarsApplicationMixin: (BaseClass: any) => {
        return class extends BaseClass {
          static DEFAULT_OPTIONS = {
            ...BaseClass.DEFAULT_OPTIONS,
            window: { 
              title: '', 
              icon: '',
              ...(BaseClass.DEFAULT_OPTIONS?.window || {})
            }
          };
          
          constructor(...args: any[]) {
            super(...args);
            // Ensure options are properly initialized
            this.options = {
              ...this.options,
              window: {
                title: '',
                icon: '',
                ...this.options?.window
              }
            };
          }
          
          get template(): string {
            return '';
          }
          
          async _prepareContext(): Promise<any> {
            return {};
          }
        };
      }
    }
  }
};

// Mock renderTemplate function
(global as any).renderTemplate = vi.fn();

// YouTube Player API mock
(global as any).YT = {
  Player: vi.fn().mockImplementation(() => ({
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    loadVideoById: vi.fn(),
    cueVideoById: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    isMuted: vi.fn(() => false),
    getVolume: vi.fn(() => 50),
    setVolume: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 100),
    getPlayerState: vi.fn(() => 1), // Playing
  })),
  PlayerState: {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  },
};

// Store original functions before mocking
const originalSetTimeout = globalThis.setTimeout;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

// DOM mocks for widget testing
Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value: vi.fn((cb) => originalSetTimeout(cb, 0)),
});

Object.defineProperty(window, 'setTimeout', {
  writable: true,
  value: vi.fn((cb, delay) => originalSetTimeout(cb, delay || 0)),
});

// Test utilities
export const TestUtils = {
  // Reset all mocks
  resetMocks: () => {
    vi.clearAllMocks();
    mockSettings.clear();
    mockHooksEvents.clear();
    mockHooks.events = {};
    // Reset socket to connected state by default
    mockSocket.connected = true;
  },

  // Mock user context
  mockUser: (userData: Partial<typeof mockUser>) => {
    Object.assign(mockUser, userData);
  },

  // Mock GM user
  mockGM: () => {
    mockUser.isGM = true;
    mockUser.id = 'test-gm-id';
    mockUser.name = 'Test GM';
  },

  // Mock socket connection
  mockSocketConnected: (connected: boolean = true) => {
    mockSocket.connected = connected;
  },

  // Get mock instances for assertions
  getMocks: () => ({
    socket: mockSocket,
    settings: mockSettingsManager,
    notifications: mockNotifications,
    ui: {
      notifications: mockNotifications,
    },
    Hooks: mockHooks,
  }),

  // Create test session state
  createTestSessionState: () => ({
    id: 'test-session',
    members: [
      { userId: 'test-user-id', name: 'Test User', isDJ: false, isActive: true, missedHeartbeats: 0 },
      { userId: 'test-dj-id', name: 'Test DJ', isDJ: true, isActive: true, missedHeartbeats: 0 },
    ],
    djUserId: 'test-dj-id',
    isConnected: true,
    connectionStatus: 'connected' as const,
    hasJoinedSession: true,
    activeRequests: [],
  }),

  // Create test queue state
  createTestQueueState: () => ({
    items: [
      {
        id: 'queue-1',
        videoId: 'test-video-1',
        title: 'Test Video 1',
        addedBy: 'test-dj-id',
        addedAt: Date.now(),
      },
    ],
    currentIndex: 0,
    mode: 'single-dj' as const,
    djUserId: 'test-dj-id',
  }),

  // Create test player state
  createTestPlayerState: () => ({
    isReady: true,
    isInitializing: false,
    isRecreating: false,
    currentVideo: {
      videoId: 'test-video-1',
      title: 'Test Video 1',
      duration: 100,
    },
    playbackState: 'playing' as const,
    currentTime: 50,
    duration: 100,
    isMuted: false,
    volume: 75,
    autoplayConsent: true,
    lastHeartbeat: null,
    driftTolerance: 1.0,
    heartbeatFrequency: 2000,
  }),

  // Wait for async operations
  waitFor: (ms: number = 0) => new Promise(resolve => setTimeout(resolve, ms)),

  // Setup DOM environment
  setupDOM: () => {
    // Clear any existing DOM content
    document.body.innerHTML = '';
    
    // Add a basic container for applications
    const container = document.createElement('div');
    container.id = 'foundry-container';
    document.body.appendChild(container);
  },
};

export default TestUtils;