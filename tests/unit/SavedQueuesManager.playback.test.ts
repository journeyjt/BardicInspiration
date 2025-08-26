/**
 * Unit tests for SavedQueuesManager - Playback Control
 * Ensures that loading saved queues doesn't automatically start playback
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
    videoId: 'test_video_1',
    title: 'Test Video 1',
    addedBy: 'DJ User',
    addedAt: Date.now()
  },
  {
    id: 'item_2',
    videoId: 'test_video_2',
    title: 'Test Video 2',
    addedBy: 'DJ User',
    addedAt: Date.now()
  }
];

const mockSavedQueue: SavedQueue = {
  id: 'queue_playback_test',
  name: 'Playback Test Queue',
  items: mockVideoItems,
  createdBy: 'DJ User',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

describe('SavedQueuesManager - Playback Control', () => {
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
      user: { id: 'dj-user', name: 'DJ User', isGM: true },
      settings: {
        get: vi.fn((scope, key) => {
          if (key === 'youtubeDJ.savedQueues') {
            return [mockSavedQueue];
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
        djUserId: 'dj-user'
      },
      player: {
        ...store.getPlayerState(),
        playbackState: 'stopped'
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading saved queue - No automatic playback', () => {
    it('should NOT trigger playVideo command when loading saved queue', async () => {
      // Load saved queue with replace
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that no playVideo command was issued
      const playVideoCalls = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.playerCommand' && 
        call.data?.command === 'playVideo'
      );
      
      expect(playVideoCalls).toHaveLength(0);
    });

    it('should use cueVideo with autoPlay=false when loading saved queue', async () => {
      // Load saved queue with replace
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that cueVideo was called with autoPlay=false
      const cueVideoCalls = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.cueVideo'
      );
      
      expect(cueVideoCalls).toHaveLength(1);
      expect(cueVideoCalls[0].data.autoPlay).toBe(false);
    });

    it('should NOT trigger loadVideo hook when loading saved queue', async () => {
      // Load saved queue with replace
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that loadVideo was NOT called
      const loadVideoCalls = capturedHookCalls.filter(call => 
        call.hook === 'youtubeDJ.loadVideo'
      );
      
      expect(loadVideoCalls).toHaveLength(0);
    });

    it('should maintain stopped playback state after loading queue', async () => {
      // Ensure player is stopped
      store.updateState({
        player: {
          ...store.getPlayerState(),
          playbackState: 'stopped'
        }
      });

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that playback state remains stopped
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).toBe('stopped');
    });

    it('should maintain paused playback state after loading queue', async () => {
      // Set player to paused
      store.updateState({
        player: {
          ...store.getPlayerState(),
          playbackState: 'paused'
        }
      });

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that playback state remains paused
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).toBe('paused');
    });

    it('should not send play commands in socket messages', async () => {
      const socketEmitSpy = vi.spyOn(game.socket, 'emit');

      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check socket messages for any play commands
      const playMessages = socketEmitSpy.mock.calls.filter((call: any[]) => {
        const [, message] = call;
        return message?.type === 'PLAY' || 
               message?.type === 'LOAD' ||
               (message?.data?.autoPlay === true);
      });

      expect(playMessages).toHaveLength(0);
    });

    it('should require manual play action from DJ after loading queue', async () => {
      // Load saved queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Verify queue is loaded
      const queueState = store.getQueueState();
      expect(queueState.items).toHaveLength(2);
      expect(queueState.currentIndex).toBe(0);

      // Verify player is not playing
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).not.toBe('playing');

      // Now simulate DJ manually pressing play
      capturedHookCalls = [];
      Hooks.callAll('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });

      // Verify play command was issued
      const playCommands = capturedHookCalls.filter(call =>
        call.hook === 'youtubeDJ.playerCommand' &&
        call.data?.command === 'playVideo'
      );
      expect(playCommands).toHaveLength(1);
    });
  });

  describe('Loading saved queue - Append mode', () => {
    it('should not affect playback when appending to queue', async () => {
      // Set up existing queue with a playing video
      store.updateState({
        queue: {
          ...store.getQueueState(),
          items: [{
            id: 'current',
            videoId: 'current_video',
            title: 'Currently Playing',
            addedBy: 'DJ',
            addedAt: Date.now()
          }],
          currentIndex: 0
        },
        player: {
          ...store.getPlayerState(),
          playbackState: 'playing'
        }
      });

      // Load saved queue with append
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: false
      });

      // Check that no play/pause/stop commands were issued
      const playbackCommands = capturedHookCalls.filter(call =>
        call.hook === 'youtubeDJ.playerCommand' &&
        ['playVideo', 'pauseVideo', 'stopVideo'].includes(call.data?.command)
      );
      
      expect(playbackCommands).toHaveLength(0);

      // Verify playback state unchanged
      const playerState = store.getPlayerState();
      expect(playerState.playbackState).toBe('playing');
    });

    it('should not trigger any video loading when appending', async () => {
      // Set up existing queue
      store.updateState({
        queue: {
          ...store.getQueueState(),
          items: [{
            id: 'existing',
            videoId: 'existing_video',
            title: 'Existing Video',
            addedBy: 'User',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });

      // Load saved queue with append
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: false
      });

      // Check that no video loading hooks were called
      const videoLoadCalls = capturedHookCalls.filter(call =>
        call.hook === 'youtubeDJ.loadVideo' ||
        call.hook === 'youtubeDJ.cueVideo'
      );
      
      expect(videoLoadCalls).toHaveLength(0);
    });
  });

  describe('Error scenarios', () => {
    it('should not start playback even if queue load partially fails', async () => {
      // Mock a partial failure scenario
      (game.settings.get as any).mockImplementation((scope: string, key: string) => {
        if (key === 'youtubeDJ.savedQueues') {
          return [{
            ...mockSavedQueue,
            items: [] // Empty items to trigger edge case
          }];
        }
        return undefined;
      });

      // Attempt to load queue
      await savedQueuesManager.loadSavedQueue({
        queueId: 'queue_playback_test',
        replace: true
      });

      // Check that no play commands were issued
      const playCommands = capturedHookCalls.filter(call =>
        call.hook === 'youtubeDJ.playerCommand' &&
        call.data?.command === 'playVideo'
      );
      
      expect(playCommands).toHaveLength(0);
    });
  });
});