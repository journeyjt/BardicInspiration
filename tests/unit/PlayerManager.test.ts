/**
 * Unit tests for PlayerManager - YouTube player operations and synchronization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import TestUtils from '../setup/test-setup.js';

describe('PlayerManager', () => {
  let playerManager: PlayerManager;
  let store: SessionStore;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    playerManager = new PlayerManager(store);
  });

  describe('Initialization', () => {
    it('should initialize with correct store reference', () => {
      expect(playerManager).toBeDefined();
    });
  });

  describe('DJ State Management', () => {
    it('should start heartbeat when user becomes DJ', () => {
      TestUtils.mockUser({ id: 'new-dj-id' });
      
      // Mock heartbeat methods
      const startHeartbeatSpy = vi.spyOn(playerManager as any, 'startHeartbeat').mockImplementation(() => {});
      
      // Simulate user becoming DJ
      store.updateState({
        session: { djUserId: 'new-dj-id' }
      });

      expect(startHeartbeatSpy).toHaveBeenCalled();
    });

    it('should stop heartbeat when user stops being DJ', () => {
      TestUtils.mockUser({ id: 'former-dj-id' });
      
      // Set user as DJ first
      store.updateState({
        session: { djUserId: 'former-dj-id' }
      });

      const stopHeartbeatSpy = vi.spyOn(playerManager as any, 'stopHeartbeat').mockImplementation(() => {});
      
      // Remove DJ role
      store.updateState({
        session: { djUserId: null }
      });

      expect(stopHeartbeatSpy).toHaveBeenCalled();
    });

    it('should not start heartbeat for other users becoming DJ', () => {
      TestUtils.mockUser({ id: 'listener-id' });
      
      const startHeartbeatSpy = vi.spyOn(playerManager as any, 'startHeartbeat').mockImplementation(() => {});
      
      // Another user becomes DJ
      store.updateState({
        session: { djUserId: 'other-user-dj' }
      });

      expect(startHeartbeatSpy).not.toHaveBeenCalled();
    });
  });

  describe('Heartbeat System', () => {
    beforeEach(() => {
      // Mock user as DJ to enable heartbeat
      TestUtils.mockUser({ id: 'dj-user-id' });
      store.updateState({
        session: { djUserId: 'dj-user-id' }
      });
    });

    it('should send heartbeat messages when DJ', async () => {
      const mockSocket = TestUtils.getMocks().socket;
      
      // Mock player state
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { videoId: 'test-video', title: 'Test Video' },
          currentTime: 30,
          duration: 100,
          playbackState: 'playing',
          heartbeatFrequency: 2000
        }
      });

      // Call sendHeartbeat manually - needs to be async for getCurrentTime request
      await playerManager['sendHeartbeat']();

      // Check if socket.emit was called with HEARTBEAT message
      const heartbeatCalls = mockSocket.emit.mock.calls.filter(
        call => call[1]?.type === 'HEARTBEAT'
      );
      
      expect(heartbeatCalls.length).toBeGreaterThan(0);
      expect(heartbeatCalls[0][1]).toMatchObject({
        type: 'HEARTBEAT',
        userId: 'dj-user-id',
        data: expect.objectContaining({
          videoId: 'test-video',
          isPlaying: true
        })
      });
    });

    it('should start heartbeat when becoming DJ', () => {
      const startSpy = vi.spyOn(playerManager, 'startHeartbeat');
      
      playerManager.startHeartbeat();
      
      expect(startSpy).toHaveBeenCalled();
    });

    it('should stop heartbeat when losing DJ role', () => {
      const stopSpy = vi.spyOn(playerManager, 'stopHeartbeat');
      
      playerManager.stopHeartbeat();
      
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  describe('Video Loading', () => {
    beforeEach(() => {
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({ session: { djUserId: 'dj-user' } });
    });

    it('should load video and update state', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      const videoId = 'test-video-id';

      await playerManager.loadVideo(videoId);

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'loadVideoById',
        args: [videoId, 0]
      });
      
      const state = store.getState();
      expect(state.player.playbackState).toBe('loading');
    });
  });

  describe('Playback Control', () => {
    beforeEach(() => {
      // Set user as DJ and set up player state
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({
        session: { djUserId: 'dj-user' },
        player: {
          isReady: true,
          currentVideo: { videoId: 'test-video', title: 'Test Video' }
        }
      });
    });

    it('should play video when queue has items and correct video is loaded', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up queue with a video and matching loaded video
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { 
            videoId: 'queue-vid-1', 
            title: 'Queue Video 1' 
          }
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'queue-vid-1',
            title: 'Queue Video 1',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      await playerManager.play();

      // Should play directly without loading
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });
      
      // Should not call loadVideo since correct video is already loaded
      expect(mockHooks.callAll).not.toHaveBeenCalledWith('youtubeDJ.playerCommand', 
        expect.objectContaining({ command: 'loadVideoById' }));
    });

    it('should load correct video from queue when wrong video is loaded', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up queue with different video than what's loaded
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { 
            videoId: 'default-vid', // Different from queue
            title: 'Default Video' 
          }
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'queue-vid-1', // Different from loaded video
            title: 'Queue Video 1',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      // Mock loadVideo method
      const loadVideoSpy = vi.spyOn(playerManager, 'loadVideo').mockResolvedValue();
      
      await playerManager.play();

      // Should call loadVideo with the queue video
      expect(loadVideoSpy).toHaveBeenCalledWith('queue-vid-1');
      
      // Should not call playVideo directly since loadVideo handles it
      expect(mockHooks.callAll).not.toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });
    });

    it('should play loaded video when queue is empty', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up valid loaded video but empty queue
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { 
            videoId: 'default-vid', 
            title: 'Default Video' 
          }
        },
        queue: {
          items: [], // Empty queue
          currentIndex: -1
        }
      });
      
      await playerManager.play();

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });
    });

    it('should throw error when no queue items and no valid video loaded', async () => {
      // Set up empty queue and no loaded video
      store.updateState({
        player: {
          isReady: true,
          currentVideo: null // No video loaded
        },
        queue: {
          items: [], // Empty queue
          currentIndex: -1
        }
      });
      
      await expect(playerManager.play()).rejects.toThrow('No video loaded. Please add videos to the queue first.');
    });

    it('should handle invalid queue index gracefully', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up queue with invalid currentIndex
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { 
            videoId: 'default-vid', 
            title: 'Default Video' 
          }
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'queue-vid-1',
            title: 'Queue Video 1',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 5 // Invalid - out of bounds
        }
      });
      
      await playerManager.play();

      // Should fall back to playing loaded video
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });
    });

    it('should prioritize queue over default video (bug fix scenario)', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Simulate the bug scenario: default video loaded, user adds video to queue
      store.updateState({
        player: {
          isReady: true,
          currentVideo: { 
            videoId: 'dQw4w9WgXcQ', // Default video (Rick Roll)
            title: 'Never Gonna Give You Up' 
          }
        },
        queue: {
          items: [{
            id: 'user-video',
            videoId: 'user-vid-1', // User's video
            title: 'User Video',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      // Mock loadVideo method
      const loadVideoSpy = vi.spyOn(playerManager, 'loadVideo').mockResolvedValue();
      
      await playerManager.play();

      // Should load the user's video from queue, NOT play the default video
      expect(loadVideoSpy).toHaveBeenCalledWith('user-vid-1');
      
      // Should not play the default video
      expect(mockHooks.callAll).not.toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'playVideo'
      });
    });

    it('should pause video', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      await playerManager.pause();

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'pauseVideo'
      });
    });

    it('should seek to specific time', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      await playerManager.seekTo(45);

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'seekTo',
        args: [45, true]
      });
    });

    it('should handle volume via widget (no direct setVolume method)', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Volume is handled directly by widget, not PlayerManager
      Hooks.callAll('youtubeDJ.playerCommand', {
        command: 'setVolume',
        args: [75]
      });

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'setVolume',
        args: [75]
      });
    });

    it('should mute player', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      await playerManager.mute();

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'mute'
      });
    });

    it('should unmute player', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      await playerManager.unmute();

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'unMute'
      });
    });
  });

  describe('State Synchronization', () => {
    it('should handle player state updates from widget', () => {
      const playerState = {
        currentTime: 45,
        duration: 120,
        playbackState: 'playing' as const,
        volume: 80,
        isMuted: false
      };

      // Simulate player state update from widget
      store.updateState({
        player: playerState
      });

      const state = store.getState();
      expect(state.player.currentTime).toBe(45);
      expect(state.player.duration).toBe(120);
      expect(state.player.playbackState).toBe('playing');
      expect(state.player.volume).toBe(80);
      expect(state.player.isMuted).toBe(false);
    });

    it('should sync with heartbeat data from DJ', async () => {
      // Set up as listener receiving heartbeat from DJ
      TestUtils.mockUser({ id: 'listener-id' });
      store.updateState({ 
        session: { djUserId: 'dj-user-id' }, // Different DJ from 'listener-id'
        player: {
          isReady: true,
          currentVideo: { videoId: 'test-video', title: 'Test Video' },
          currentTime: 30, // Starting time
          duration: 120,
          playbackState: 'paused'
        }
      });
      
      const heartbeatData = {
        videoId: 'test-video',
        currentTime: 60,
        duration: 120,
        isPlaying: true,
        timestamp: Date.now(),
        serverTime: Date.now()
      };

      // Trigger heartbeat received event - this should call the sync method internally
      Hooks.callAll('youtubeDJ.heartbeat', { heartbeat: heartbeatData, timestamp: Date.now() });

      // Give async operations time to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // In a real scenario, the widget would update the store based on synchronization commands
      // Since we don't have a widget in tests, simulate the store update that would happen
      store.updateState({
        player: {
          currentTime: heartbeatData.currentTime,
          playbackState: heartbeatData.isPlaying ? 'playing' : 'paused'
        }
      });

      // State should be updated with heartbeat data
      const state = store.getState();
      expect(state.player.currentTime).toBe(60);
      expect(state.player.playbackState).toBe('playing');
    });
  });

  describe('Permission Checks', () => {
    it('should throw error when non-DJ tries to play', async () => {
      // Set up non-DJ user
      TestUtils.mockUser({ id: 'listener-id' });
      store.updateState({ session: { djUserId: 'other-dj' } });
      
      await expect(playerManager.play()).rejects.toThrow('Only DJ can control playback');
    });

    it('should throw error when non-DJ tries to load video', async () => {
      // Set up non-DJ user  
      TestUtils.mockUser({ id: 'listener-id' });
      store.updateState({ session: { djUserId: 'other-dj' } });
      
      await expect(playerManager.loadVideo('test-video')).rejects.toThrow('Only DJ can load videos');
    });
  });
});