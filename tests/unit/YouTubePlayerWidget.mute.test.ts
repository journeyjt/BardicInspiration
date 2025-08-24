/**
 * Test for YouTubePlayerWidget mute button visual state synchronization bug
 * Verifies that mute button visual state stays in sync with actual mute state
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YouTubePlayerWidget } from '../../src/ui/YouTubePlayerWidget';
import { SessionStore } from '../../src/state/SessionStore';
import TestUtils from '../setup/test-setup';

describe('YouTubePlayerWidget Mute Button Visual State', () => {
  let widget: YouTubePlayerWidget;
  let store: SessionStore;
  let mockPlayer: any;
  let mockSettingsStore: Map<string, any>;

  beforeEach(async () => {
    TestUtils.resetMocks();
    TestUtils.setupDOM();

    // Mock client settings storage
    mockSettingsStore = new Map();
    vi.spyOn(game.settings, 'get').mockImplementation((scope: string, key: string) => {
      return mockSettingsStore.get(`${scope}.${key}`) ?? false;
    });
    
    vi.spyOn(game.settings, 'set').mockImplementation((scope: string, key: string, value: any) => {
      mockSettingsStore.set(`${scope}.${key}`, value);
      return Promise.resolve();
    });

    // Create mock YouTube player
    mockPlayer = {
      isMuted: vi.fn(() => false),
      mute: vi.fn(),
      unMute: vi.fn(),
      getVolume: vi.fn(() => 50),
      setVolume: vi.fn(),
    };

    // Initialize store first
    store = SessionStore.getInstance();
    
    // Initialize store with required state
    await (store as any).initialize(); // Force initialization
    store.updateState({
      session: { hasJoinedSession: true },
      player: { isReady: true }
    });
    
    // Verify the session state is correctly set
    expect(store.getSessionState().hasJoinedSession).toBe(true);
    
    // Create widget after store is properly initialized
    widget = new YouTubePlayerWidget(store);
    
    // Mock player being ready
    (widget as any).player = mockPlayer;
    (widget as any).isPlayerReady = true;
    (widget as any).widgetElement = document.createElement('div');
    
    // Set up DOM with mute button
    (widget as any).widgetElement.innerHTML = `
      <button class="widget-btn mute-volume-btn" title="Mute">
        <i class="fas fa-volume-up"></i>
      </button>
    `;
  });

  describe('Visual State Synchronization Bug', () => {
    it('should keep mute button visual state in sync when toggling via widget', async () => {
      // Initial state - should be unmuted
      const muteButton = (widget as any).widgetElement.querySelector('.mute-volume-btn');
      const muteIcon = muteButton.querySelector('i');
      
      expect(mockPlayer.isMuted()).toBe(false);
      expect((widget as any).getUserMuteState()).toBe(false);
      
      // Simulate clicking the mute button - this calls toggleMute() directly
      mockPlayer.isMuted.mockReturnValue(false); // Currently unmuted
      
      // Call toggleMute - widget should mute player and update visuals
      await (widget as any).toggleMute();
      
      // Verify player was muted
      expect(mockPlayer.mute).toHaveBeenCalled();
      
      // Mock that player is now muted
      mockPlayer.isMuted.mockReturnValue(true);
      
      // Wait for the setTimeout in toggleMute to execute
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Check that the visual state is updated correctly
      // The icon should now show muted state
      expect(muteIcon.className).toBe('fas fa-volume-mute');
      expect(muteButton.getAttribute('title')).toBe('Unmute');
    });

    it('should keep mute button visual state in sync when toggling via PlayerManager', async () => {
      const muteButton = (widget as any).widgetElement.querySelector('.mute-volume-btn');
      const muteIcon = muteButton.querySelector('i');
      
      // Initial state - should be unmuted
      expect((widget as any).getUserMuteState()).toBe(false);
      expect(muteIcon.className).toBe('fas fa-volume-up');
      
      // Simulate PlayerManager mute operation
      // This sets client settings and sends localPlayerCommand hook
      await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', true);
      mockPlayer.isMuted.mockReturnValue(true);
      
      // Call onPlayerCommand directly (this is what the hook does)
      await (widget as any).onPlayerCommand({ command: 'mute' });
      
      // Wait for the setTimeout in onPlayerCommand to execute
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Check that the visual state matches the actual state
      expect((widget as any).getUserMuteState()).toBe(true);
      expect(mockPlayer.isMuted()).toBe(true);
      expect(muteIcon.className).toBe('fas fa-volume-mute');
      expect(muteButton.getAttribute('title')).toBe('Unmute');
    });

    it('should sync visual state with actual player state when they diverge', async () => {
      const muteButton = (widget as any).widgetElement.querySelector('.mute-volume-btn');
      const muteIcon = muteButton.querySelector('i');
      
      // Set up a scenario where client setting and actual player state are out of sync
      // This could happen if player state changed without updating client settings
      mockSettingsStore.set('bardic-inspiration.youtubeDJ.userMuted', false); // Client setting says unmuted
      mockPlayer.isMuted.mockReturnValue(true); // But player is actually muted
      
      // Call updateMuteButton - this should detect the mismatch and fix it
      await (widget as any).updateMuteButton();
      
      // Wait for any async client settings updates
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Visual state should match actual player state (muted)
      expect(muteIcon.className).toBe('fas fa-volume-mute');
      expect(muteButton.getAttribute('title')).toBe('Unmute');
      
      // Client setting should be updated to match actual player state
      expect(mockSettingsStore.get('bardic-inspiration.youtubeDJ.userMuted')).toBe(true);
    });

    it('should handle rapid mute/unmute toggles without visual desync', async () => {
      const muteButton = (widget as any).widgetElement.querySelector('.mute-volume-btn');
      const muteIcon = muteButton.querySelector('i');
      
      // Rapid toggle sequence
      let muteState = false;
      
      for (let i = 0; i < 5; i++) {
        // Toggle the state
        muteState = !muteState;
        
        // Update mock player
        mockPlayer.isMuted.mockReturnValue(muteState);
        
        // Update client setting
        await game.settings.set('bardic-inspiration', 'youtubeDJ.userMuted', muteState);
        
        // Update mute button
        await (widget as any).updateMuteButton();
        
        // Wait for any async operations
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Verify visual state is correct
        const expectedIcon = muteState ? 'fas fa-volume-mute' : 'fas fa-volume-up';
        const expectedTitle = muteState ? 'Unmute' : 'Mute';
        
        expect(muteIcon.className).toBe(expectedIcon);
        expect(muteButton.getAttribute('title')).toBe(expectedTitle);
        expect((widget as any).getUserMuteState()).toBe(muteState);
      }
    });

    it('should handle missing DOM elements gracefully', async () => {
      // Remove the mute button from DOM
      const muteButton = (widget as any).widgetElement.querySelector('.mute-volume-btn');
      muteButton.remove();
      
      // updateMuteButton should not throw when button is missing
      expect(async () => {
        await (widget as any).updateMuteButton();
      }).not.toThrow();
    });
  });
});