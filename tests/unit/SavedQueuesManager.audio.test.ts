/**
 * Unit tests for SavedQueuesManager - Audio Settings Preservation
 * Ensures that loading saved queues doesn't affect user's mute/volume settings
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SavedQueuesManager } from '../../src/services/SavedQueuesManager';
import { SessionStore } from '../../src/state/SessionStore';
import { QueueManager } from '../../src/services/QueueManager';
import { SavedQueue, VideoItem } from '../../src/state/StateTypes';

// Mock video items
const mockVideoItems: VideoItem[] = [
  {
    id: 'item_1',
    videoId: 'abc123def45',
    title: 'Test Video 1',
    addedBy: 'TestUser',
    addedAt: Date.now()
  },
  {
    id: 'item_2',
    videoId: 'xyz789ghi12',
    title: 'Test Video 2',
    addedBy: 'TestUser',
    addedAt: Date.now()
  }
];

const mockSavedQueue: SavedQueue = {
  id: 'queue_test_123',
  name: 'Test Queue',
  items: mockVideoItems,
  createdBy: 'TestUser',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

describe('SavedQueuesManager - Audio Settings Preservation', () => {
  let savedQueuesManager: SavedQueuesManager;
  let store: SessionStore;
  let queueManager: QueueManager;
  let hookCallsSpy: any;
  let capturedHookCalls: { hook: string; data: any }[] = [];

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    capturedHookCalls = [];
    
    // Initialize store
    store = SessionStore.getInstance();
    store.initialize();
    
    // Mock QueueManager
    queueManager = new QueueManager(store);
    
    // Create SavedQueuesManager instance
    savedQueuesManager = new SavedQueuesManager(store, queueManager);
    
    // Mock game settings
    (global as any).game = {
      user: { id: 'test-user', name: 'TestUser' },
      settings: {
        get: vi.fn((scope, key) => {
          if (key === 'youtubeDJ.savedQueues') {
            return [mockSavedQueue];
          }
          if (key === 'youtubeDJ.userMuted') {
            return true; // User has muted their player
          }
          if (key === 'youtubeDJ.userVolume') {
            return 50; // User has set volume to 50%
          }
          return undefined;
        }),
        set: vi.fn().mockResolvedValue(undefined)
      },
      socket: {
        emit: vi.fn()
      }
    };
    
    // Mock UI notifications
    (global as any).ui = {
      notifications: {
        success: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn()
      }
    };
    
    // Spy on Hooks.callAll to capture what hooks are called
    hookCallsSpy = vi.spyOn(Hooks, 'callAll').mockImplementation((hook: string, data?: any) => {
      capturedHookCalls.push({ hook, data });
      return true;
    });
    
    // Set up DJ state
    store.updateState({
      session: {
        ...store.getSessionState(),
        djUserId: 'test-user'
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading saved queue with replace mode', () => {
    it('should use cueVideo hook instead of loadVideo to preserve audio settings', async () => {
      // Setup: Empty current queue
      store.updateState({
        queue: {
          items: [],
          currentIndex: -1,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        }
      });

      // Load saved queue with replace mode
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Check that cueVideo was called, not loadVideo
      const cueVideoCalls = capturedHookCalls.filter(call => call.hook === 'youtubeDJ.cueVideo');
      const loadVideoCalls = capturedHookCalls.filter(call => call.hook === 'youtubeDJ.loadVideo');
      
      expect(cueVideoCalls).toHaveLength(1);
      expect(loadVideoCalls).toHaveLength(0);
      
      // Verify cueVideo was called with correct parameters
      const cueVideoCall = cueVideoCalls[0];
      expect(cueVideoCall.data).toMatchObject({
        videoId: 'abc123def45',
        videoInfo: {
          videoId: 'abc123def45',
          title: 'Test Video 1'
        },
        autoPlay: false // Important: should not auto-play
      });
    });

    it('should not trigger any mute/unmute commands', async () => {
      // Setup: Empty current queue
      store.updateState({
        queue: {
          items: [],
          currentIndex: -1,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        }
      });

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Check that no audio control commands were issued
      const muteCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.localPlayerCommand' && 
        (call.data?.command === 'mute' || call.data?.command === 'unMute')
      );
      
      expect(muteCommands).toHaveLength(0);
      
      // Check that no volume commands were issued
      const volumeCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.localPlayerCommand' && 
        call.data?.command === 'setVolume'
      );
      
      expect(volumeCommands).toHaveLength(0);
    });

    it('should not modify user audio settings in game settings', async () => {
      // Setup: Track initial call count
      const initialSetCallCount = (game.settings.set as any).mock.calls.length;

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Get all set calls after loading
      const setCalls = (game.settings.set as any).mock.calls.slice(initialSetCallCount);
      
      // Check that no audio-related settings were modified
      const audioSettingsCalls = setCalls.filter((call: any[]) => {
        const [scope, key] = call;
        return key === 'youtubeDJ.userMuted' || key === 'youtubeDJ.userVolume';
      });
      
      expect(audioSettingsCalls).toHaveLength(0);
    });

    it('should preserve current playback state when loading queue', async () => {
      // Setup: Set player to paused state
      store.updateState({
        player: {
          ...store.getPlayerState(),
          playbackState: 'paused'
        },
        queue: {
          items: [],
          currentIndex: -1,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        }
      });

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Check that no play command was issued
      const playCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.playerCommand' && 
        call.data?.command === 'playVideo'
      );
      
      expect(playCommands).toHaveLength(0);
      
      // Check playback state remains paused
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).toBe('paused');
    });
  });

  describe('Loading saved queue with append mode', () => {
    it('should not trigger any video loading when appending', async () => {
      // Setup: Current queue with one item
      store.updateState({
        queue: {
          items: [{
            id: 'existing',
            videoId: 'existing123',
            title: 'Existing Video',
            addedBy: 'User',
            addedAt: Date.now()
          }],
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        }
      });

      // Load saved queue with append mode
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: false
      });

      // Check that no video loading hooks were called
      const videoLoadCalls = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.loadVideo' || 
        call.hook === 'youtubeDJ.cueVideo'
      );
      
      expect(videoLoadCalls).toHaveLength(0);
    });

    it('should not affect current playing video when appending', async () => {
      // Setup: Current queue with playing video
      const currentVideo = {
        id: 'current',
        videoId: 'current12345',
        title: 'Currently Playing',
        addedBy: 'DJ',
        addedAt: Date.now()
      };
      
      store.updateState({
        queue: {
          items: [currentVideo],
          currentIndex: 0,
          mode: 'single-dj',
          djUserId: 'test-user',
          savedQueues: []
        },
        player: {
          ...store.getPlayerState(),
          currentVideo: {
            videoId: currentVideo.videoId,
            title: currentVideo.title,
            duration: 180
          },
          playbackState: 'playing'
        }
      });

      // Load saved queue with append mode
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: false
      });

      // Verify current video unchanged
      const playerState = store.getPlayerState();
      expect(playerState.currentVideo?.videoId).toBe('current12345');
      expect(playerState.playbackState).toBe('playing');
      
      // Verify queue was appended
      const queueState = store.getQueueState();
      expect(queueState.items).toHaveLength(3);
      expect(queueState.currentIndex).toBe(0);
    });
  });

  describe('User audio preferences', () => {
    it('should respect user mute preference across queue loads', async () => {
      // Setup: User has muted their player
      (game.settings.get as any).mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.userMuted') return true;
        if (key === 'youtubeDJ.savedQueues') return [mockSavedQueue];
        return undefined;
      });

      // Load a queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Verify no unmute command was sent
      const unmuteCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.localPlayerCommand' && 
        call.data?.command === 'unMute'
      );
      
      expect(unmuteCommands).toHaveLength(0);
    });

    it('should respect user volume preference across queue loads', async () => {
      // Setup: User has set volume to 30%
      (game.settings.get as any).mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.userVolume') return 30;
        if (key === 'youtubeDJ.savedQueues') return [mockSavedQueue];
        return undefined;
      });

      // Load a queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_test_123',
        replace: true
      });

      // Verify no volume change command was sent
      const volumeCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.localPlayerCommand' && 
        call.data?.command === 'setVolume'
      );
      
      expect(volumeCommands).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('should not affect audio settings even if queue load fails', async () => {
      // Setup: Make queue loading fail
      (game.settings.get as any).mockImplementation(() => {
        throw new Error('Settings error');
      });

      // Attempt to load queue (will fail)
      await expect(
        savedQueuesManager.loadSavedQueue({
          queueId: 'queue_test_123',
          replace: true
        })
      ).rejects.toThrow();

      // Verify no audio commands were sent despite the error
      const audioCommands = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.localPlayerCommand' &&
        ['mute', 'unMute', 'setVolume'].includes(call.data?.command)
      );
      
      expect(audioCommands).toHaveLength(0);
    });
  });
});