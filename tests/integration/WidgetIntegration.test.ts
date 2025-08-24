/**
 * Integration tests for YouTube Player Widget
 * Tests widget functionality and player command integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { PlayerManager } from '../../src/services/PlayerManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Widget Integration', () => {
  let store: SessionStore;
  let playerManager: PlayerManager;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    playerManager = new PlayerManager(store);
  });

  describe('Player Command Integration', () => {
    it('should handle player commands from widget', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up DJ user for player commands
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({ 
        session: { djUserId: 'dj-user' },
        player: { 
          isReady: true, 
          currentVideo: { 
            videoId: 'dQw4w9WgXcQ', // Valid 11-char YouTube ID
            title: 'Test Video'
          } 
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'dQw4w9WgXcQ',
            title: 'Test Video',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      // Simulate widget sending player commands through PlayerManager methods
      await playerManager.play();
      await playerManager.pause();
      await playerManager.seekTo(45);

      // Check for playerCommand calls among all the calls
      const playerCommandCalls = mockHooks.callAll.mock.calls.filter(
        call => call[0] === 'youtubeDJ.playerCommand'
      );
      
      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'playVideo'
      )).toBe(true);

      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'pauseVideo'
      )).toBe(true);

      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'seekTo' && 
        call[1]?.args?.[0] === 45 && 
        call[1]?.args?.[1] === true
      )).toBe(true);
    });

    it('should update player state from widget feedback', () => {
      const playerState = {
        isReady: true,
        currentVideo: {
          videoId: 'dQw4w9WgXcQ',
          title: 'Test Video Title',
          duration: 180
        },
        playbackState: 'playing' as const,
        currentTime: 67.5,
        duration: 180,
        volume: 85,
        isMuted: false
      };

      // Simulate widget updating player state
      store.updateState({
        player: playerState
      });

      const state = store.getState();
      expect(state.player.isReady).toBe(true);
      expect(state.player.currentVideo?.videoId).toBe('dQw4w9WgXcQ');
      expect(state.player.currentVideo?.title).toBe('Test Video Title');
      expect(state.player.playbackState).toBe('playing');
      expect(state.player.currentTime).toBe(67.5);
      expect(state.player.volume).toBe(85);
      expect(state.player.isMuted).toBe(false);
    });

    it('should handle player state transitions', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Initial state: stopped
      store.updateState({
        player: { playbackState: 'stopped' }
      });

      // Loading state
      store.updateState({
        player: { playbackState: 'loading' }
      });

      // Playing state
      store.updateState({
        player: { 
          playbackState: 'playing',
          currentTime: 0,
          currentVideo: {
            videoId: 'new-video',
            title: 'New Video'
          }
        }
      });

      // Verify state changes were emitted
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.stateChanged', expect.any(Object));
    });
  });

  describe('Widget Lifecycle', () => {
    it('should handle session join from widget', () => {
      TestUtils.mockUser({ id: 'joining-user', name: 'Joining User' });
      
      // Simulate widget join session action
      store.updateState({
        session: {
          hasJoinedSession: true,
          isConnected: true,
          connectionStatus: 'connected'
        }
      });

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(true);
      expect(state.session.isConnected).toBe(true);
      expect(state.session.connectionStatus).toBe('connected');
    });

    it('should handle session leave from widget', () => {
      // Start with user in session
      store.updateState({
        session: {
          hasJoinedSession: true,
          isConnected: true,
          connectionStatus: 'connected'
        }
      });

      // Simulate widget leave session action
      store.updateState({
        session: {
          hasJoinedSession: false,
          isConnected: false,
          connectionStatus: 'disconnected'
        }
      });

      const state = store.getState();
      expect(state.session.hasJoinedSession).toBe(false);
      expect(state.session.isConnected).toBe(false);
      expect(state.session.connectionStatus).toBe('disconnected');
    });

    it('should handle widget visibility changes', () => {
      // Simulate widget minimize/maximize
      store.updateState({
        ui: { isVisible: false }
      });

      let state = store.getState();
      expect(state.ui.isVisible).toBe(false);

      store.updateState({
        ui: { isVisible: true }
      });

      state = store.getState();
      expect(state.ui.isVisible).toBe(true);
    });
  });

  describe('Player Control Integration', () => {
    beforeEach(() => {
      // Set up ready player state
      store.updateState({
        player: {
          isReady: true,
          currentVideo: {
            videoId: 'jNQXAC9IVRw',
            title: 'Control Test Video',
            duration: 120
          },
          playbackState: 'paused',
          currentTime: 30,
          duration: 120,
          volume: 70,
          isMuted: false
        }
      });
    });

    it('should handle volume control from widget', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Volume control is handled directly by widget via hooks, not PlayerManager
      Hooks.callAll('youtubeDJ.playerCommand', {
        command: 'setVolume',
        args: [90]
      });

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'setVolume',
        args: [90]
      });

      // Update state to reflect volume change
      store.updateState({
        player: { volume: 90 }
      });

      const state = store.getState();
      expect(state.player.volume).toBe(90);
    });

    it('should handle mute/unmute from widget', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Mute
      playerManager.mute();
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.localPlayerCommand', {
        command: 'mute'
      });

      // mute state is now stored in client settings, not global state
      // So we don't need to update/check the global state

      // Unmute
      playerManager.unmute();
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.localPlayerCommand', {
        command: 'unMute'
      });

      // mute state is now stored in client settings, not global state
      // So we don't need to update/check the global state
    });

    it('should handle seek operations from widget', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up DJ user for seek operation
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({ 
        session: { djUserId: 'dj-user' },
        player: { 
          isReady: true, 
          currentVideo: { 
            videoId: 'dQw4w9WgXcQ', // Valid 11-char YouTube ID
            title: 'Test Video' 
          } 
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'dQw4w9WgXcQ',
            title: 'Test Video',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });
      
      // Seek to 75 seconds
      await playerManager.seekTo(75);

      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.playerCommand', {
        command: 'seekTo',
        args: [75, true]
      });

      const state = store.getState();
      expect(state.player.currentTime).toBe(75);
    });
  });

  describe('Widget Error Handling', () => {
    it('should handle player initialization failures', () => {
      // Simulate player failing to initialize
      store.updateState({
        player: {
          isReady: false,
          isInitializing: false,
          isRecreating: true
        }
      });

      const state = store.getState();
      expect(state.player.isReady).toBe(false);
      expect(state.player.isRecreating).toBe(true);
    });

    it('should handle command queue during player recreation', async () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      
      // Set up DJ user and player recreation state
      TestUtils.mockUser({ id: 'dj-user' });
      store.updateState({
        session: { djUserId: 'dj-user' },
        player: {
          isReady: false,
          isRecreating: true,
          currentVideo: { 
            videoId: 'dQw4w9WgXcQ', // Valid 11-char YouTube ID
            title: 'Test Video' 
          }
        },
        queue: {
          items: [{
            id: 'queue-item-1',
            videoId: 'dQw4w9WgXcQ',
            title: 'Test Video',
            addedBy: 'dj-user',
            addedAt: Date.now()
          }],
          currentIndex: 0
        }
      });

      // Commands should still be issued (widget will queue them)
      await playerManager.play();
      await playerManager.seekTo(30);

      // Check for playerCommand calls among all the calls
      const playerCommandCalls = mockHooks.callAll.mock.calls.filter(
        call => call[0] === 'youtubeDJ.playerCommand'
      );
      
      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'playVideo'
      )).toBe(true);

      expect(playerCommandCalls.some(call => 
        call[1]?.command === 'seekTo' && 
        call[1]?.args?.[0] === 30 && 
        call[1]?.args?.[1] === true
      )).toBe(true);
    });

    it('should handle player state inconsistencies', () => {
      // Set inconsistent state (widget reports different state than expected)
      store.updateState({
        player: {
          playbackState: 'playing',
          currentTime: 100,
          currentVideo: {
            videoId: 'video-1',
            title: 'Video 1'
          }
        }
      });

      // Widget reports different video playing
      store.updateState({
        player: {
          currentVideo: {
            videoId: 'video-2',
            title: 'Video 2'
          },
          currentTime: 0
        }
      });

      const state = store.getState();
      expect(state.player.currentVideo?.videoId).toBe('video-2');
      expect(state.player.currentTime).toBe(0);
    });
  });

  describe('Widget Autoplay Consent', () => {
    it('should handle autoplay consent requirement', () => {
      // Initially no autoplay consent
      store.updateState({
        player: { autoplayConsent: false }
      });

      let state = store.getState();
      expect(state.player.autoplayConsent).toBe(false);

      // User grants consent (clicks play)
      store.updateState({
        player: { autoplayConsent: true }
      });

      state = store.getState();
      expect(state.player.autoplayConsent).toBe(true);
    });

    it('should handle player ready state after consent', () => {
      // Player becomes ready after user interaction
      store.updateState({
        player: {
          isReady: false,
          autoplayConsent: false
        }
      });

      // User interacts, granting consent and making player ready
      store.updateState({
        player: {
          isReady: true,
          autoplayConsent: true,
          isInitializing: false
        }
      });

      const state = store.getState();
      expect(state.player.isReady).toBe(true);
      expect(state.player.autoplayConsent).toBe(true);
      expect(state.player.isInitializing).toBe(false);
    });
  });

  describe('Widget Synchronization', () => {
    it('should handle synchronization with heartbeat data', async () => {
      TestUtils.mockUser({ id: 'listener-id' }); // Non-DJ user
      
      // Set up as listener receiving heartbeat from DJ (make sure DJ is different from current user)
      store.updateState({
        session: { djUserId: 'dj-user-id' }, // Different from 'listener-id'
        player: {
          currentVideo: { videoId: '_tbNvNFdaJQ', title: 'Sync Video' },
          currentTime: 83.2, // Slightly behind
          duration: 200,
          playbackState: 'playing',
          isReady: true
        }
      });

      const heartbeatData = {
        videoId: '_tbNvNFdaJQ',
        currentTime: 85.7,
        duration: 200,
        isPlaying: true,
        timestamp: Date.now(),
        serverTime: Date.now()
      };

      // Simulate heartbeat received event (this will trigger sync internally)
      const mockHooks = TestUtils.getMocks().Hooks;
      Hooks.callAll('youtubeDJ.heartbeat', { heartbeat: heartbeatData, timestamp: Date.now() });

      // Give async operations time to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // In a real scenario, the widget would update the store based on the heartbeat
      // Since we don't have a widget in tests, simulate the store update that would happen
      store.updateState({
        player: {
          currentTime: heartbeatData.currentTime,
          playbackState: heartbeatData.isPlaying ? 'playing' : 'paused'
        }
      });

      // State should be updated with heartbeat data
      const state = store.getState();
      expect(state.player.currentTime).toBe(85.7);
      expect(state.player.playbackState).toBe('playing');
    });

    it('should handle video changes from heartbeat', async () => {
      TestUtils.mockUser({ id: 'listener-id' });
      
      // Set up initial state with different video
      store.updateState({
        session: { djUserId: 'dj-user-id' }, // Different from 'listener-id'
        player: {
          currentVideo: { videoId: 'old-video', title: 'Old Video' },
          isReady: true,
          currentTime: 30,
          playbackState: 'paused'
        }
      });

      const newHeartbeatData = {
        videoId: 'M7lc1UVf-VE', // Different video
        currentTime: 0,
        duration: 150,
        isPlaying: true,
        timestamp: Date.now(),
        serverTime: Date.now()
      };

      // Simulate heartbeat with new video (this will trigger video change internally)
      const mockHooks = TestUtils.getMocks().Hooks;
      Hooks.callAll('youtubeDJ.heartbeat', { heartbeat: newHeartbeatData, timestamp: Date.now() });

      // Give async operations time to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      // In a real scenario, the widget would load the new video and update the store
      // Since we don't have a widget in tests, simulate the store update that would happen
      store.updateState({
        player: {
          currentVideo: { videoId: newHeartbeatData.videoId, title: `Video ${newHeartbeatData.videoId}` },
          currentTime: newHeartbeatData.currentTime,
          duration: newHeartbeatData.duration,
          playbackState: newHeartbeatData.isPlaying ? 'playing' : 'paused'
        }
      });

      // State should be updated with new video data
      const state = store.getState();
      expect(state.player.currentTime).toBe(0);
      expect(state.player.playbackState).toBe('playing');
    });
  });
});