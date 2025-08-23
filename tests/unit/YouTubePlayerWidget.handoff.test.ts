/**
 * Isolated Unit tests for YouTube Player Widget Handoff Notifications
 * Tests the core notification functionality without widget lifecycle complexity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YouTubePlayerWidget } from '../../src/ui/YouTubePlayerWidget.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import TestUtils from '../setup/test-setup.js';

describe('YouTubePlayerWidget Handoff Notifications - Isolated', () => {
  let mockElement: HTMLElement;
  let mockWidget: any;
  let store: SessionStore;

  beforeEach(() => {
    TestUtils.resetMocks();
    
    // Create mock DOM element 
    mockElement = document.createElement('div');
    mockElement.innerHTML = '<div class="handoff-notifications"></div>';
    
    // Create a minimal mock widget that only has the notification functionality
    mockWidget = {
      widgetElement: mockElement,
      store: {
        getSessionState: vi.fn(),
        isDJ: vi.fn()
      }
    };
    
    // Initialize fresh store
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    
    // Mock global session manager
    (globalThis as any).youtubeDJSessionManager = {
      approveDJRequest: vi.fn().mockResolvedValue(undefined),
      denyDJRequest: vi.fn().mockResolvedValue(undefined)
    };
  });

  describe('updateHandoffNotifications method', () => {
    it('should display notifications when user is DJ with active requests', () => {
      // Mock the store methods to return the right state
      mockWidget.store.getSessionState.mockReturnValue({
        hasJoinedSession: true,
        activeRequests: [
          { userId: 'user1', userName: 'User One', timestamp: Date.now() },
          { userId: 'user2', userName: 'User Two', timestamp: Date.now() }
        ]
      });
      mockWidget.store.isDJ.mockReturnValue(true);
      
      // Mock game.user
      (global as any).game.user = { id: 'dj-user' };
      
      // Get the method from the widget prototype
      const updateHandoffNotifications = YouTubePlayerWidget.prototype.updateHandoffNotifications;
      
      // Call the method on our mock widget
      updateHandoffNotifications.call(mockWidget);
      
      // Check that notifications were created
      const notificationArea = mockElement.querySelector('.handoff-notifications');
      expect(notificationArea).toBeTruthy();
      
      const notifications = notificationArea?.querySelectorAll('.handoff-notification');
      expect(notifications?.length).toBe(2);
      
      // Check first notification content
      const firstNotification = notifications?.[0];
      expect(firstNotification?.textContent).toContain('User One');
      expect(firstNotification?.textContent).toContain('requests DJ role');
    });

    it('should clear notifications when user is not DJ', () => {
      // First add some notifications
      const notificationArea = mockElement.querySelector('.handoff-notifications');
      if (notificationArea) {
        notificationArea.innerHTML = '<div class="test-notification">Test</div>';
      }
      
      // Mock the store methods to return non-DJ state
      mockWidget.store.getSessionState.mockReturnValue({
        hasJoinedSession: true,
        activeRequests: [
          { userId: 'user1', userName: 'User One', timestamp: Date.now() }
        ]
      });
      mockWidget.store.isDJ.mockReturnValue(false);
      
      // Mock game.user
      (global as any).game.user = { id: 'listener-user' };
      
      // Get the method from the widget prototype
      const updateHandoffNotifications = YouTubePlayerWidget.prototype.updateHandoffNotifications;
      
      // Call the method on our mock widget
      updateHandoffNotifications.call(mockWidget);
      
      // Check that notifications were cleared
      expect(notificationArea?.innerHTML).toBe('');
    });

    it('should clear notifications when user has not joined session', () => {
      // First add some notifications
      const notificationArea = mockElement.querySelector('.handoff-notifications');
      if (notificationArea) {
        notificationArea.innerHTML = '<div class="test-notification">Test</div>';
      }
      
      // Mock the store methods to return not-joined state
      mockWidget.store.getSessionState.mockReturnValue({
        hasJoinedSession: false,
        activeRequests: [
          { userId: 'user1', userName: 'User One', timestamp: Date.now() }
        ]
      });
      mockWidget.store.isDJ.mockReturnValue(true);
      
      // Mock game.user
      (global as any).game.user = { id: 'dj-user' };
      
      // Get the method from the widget prototype
      const updateHandoffNotifications = YouTubePlayerWidget.prototype.updateHandoffNotifications;
      
      // Call the method on our mock widget
      updateHandoffNotifications.call(mockWidget);
      
      // Check that notifications were cleared
      expect(notificationArea?.innerHTML).toBe('');
    });

    it('should clear notifications when no active requests', () => {
      // First add some notifications
      const notificationArea = mockElement.querySelector('.handoff-notifications');
      if (notificationArea) {
        notificationArea.innerHTML = '<div class="test-notification">Test</div>';
      }
      
      // Mock the store methods to return no requests
      mockWidget.store.getSessionState.mockReturnValue({
        hasJoinedSession: true,
        activeRequests: []
      });
      mockWidget.store.isDJ.mockReturnValue(true);
      
      // Mock game.user
      (global as any).game.user = { id: 'dj-user' };
      
      // Get the method from the widget prototype
      const updateHandoffNotifications = YouTubePlayerWidget.prototype.updateHandoffNotifications;
      
      // Call the method on our mock widget
      updateHandoffNotifications.call(mockWidget);
      
      // Check that notifications were cleared
      expect(notificationArea?.innerHTML).toBe('');
    });
  });

  describe('Action methods', () => {
    beforeEach(() => {
      // Mock game.user
      (global as any).game.user = { id: 'dj-user' };
    });

    it('should call SessionManager when approving request', async () => {
      const mockSessionManager = (globalThis as any).youtubeDJSessionManager;
      
      // Get the method from the widget prototype
      const approveHandoffRequest = YouTubePlayerWidget.prototype.approveHandoffRequest;
      
      // Call the method
      await approveHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockSessionManager.approveDJRequest).toHaveBeenCalledWith('test-user-id');
    });

    it('should call SessionManager when denying request', async () => {
      const mockSessionManager = (globalThis as any).youtubeDJSessionManager;
      
      // Get the method from the widget prototype
      const denyHandoffRequest = YouTubePlayerWidget.prototype.denyHandoffRequest;
      
      // Call the method
      await denyHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockSessionManager.denyDJRequest).toHaveBeenCalledWith('test-user-id');
    });

    it('should show error when SessionManager not available for approval', async () => {
      delete (globalThis as any).youtubeDJSessionManager;
      const mockNotifications = TestUtils.getMocks().notifications;
      
      // Get the method from the widget prototype
      const approveHandoffRequest = YouTubePlayerWidget.prototype.approveHandoffRequest;
      
      // Call the method
      await approveHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockNotifications.error).toHaveBeenCalledWith(
        'Could not approve handoff request. Please try from the control window.'
      );
    });

    it('should show error when SessionManager not available for denial', async () => {
      delete (globalThis as any).youtubeDJSessionManager;
      const mockNotifications = TestUtils.getMocks().notifications;
      
      // Get the method from the widget prototype
      const denyHandoffRequest = YouTubePlayerWidget.prototype.denyHandoffRequest;
      
      // Call the method
      await denyHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockNotifications.error).toHaveBeenCalledWith(
        'Could not deny handoff request. Please try from the control window.'
      );
    });

    it('should handle approval errors gracefully', async () => {
      const mockSessionManager = (globalThis as any).youtubeDJSessionManager;
      mockSessionManager.approveDJRequest.mockRejectedValue(new Error('Network error'));
      const mockNotifications = TestUtils.getMocks().notifications;
      
      // Get the method from the widget prototype
      const approveHandoffRequest = YouTubePlayerWidget.prototype.approveHandoffRequest;
      
      // Call the method
      await approveHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockNotifications.error).toHaveBeenCalledWith('Failed to approve handoff request.');
    });

    it('should handle denial errors gracefully', async () => {
      const mockSessionManager = (globalThis as any).youtubeDJSessionManager;
      mockSessionManager.denyDJRequest.mockRejectedValue(new Error('Network error'));
      const mockNotifications = TestUtils.getMocks().notifications;
      
      // Get the method from the widget prototype
      const denyHandoffRequest = YouTubePlayerWidget.prototype.denyHandoffRequest;
      
      // Call the method
      await denyHandoffRequest.call(mockWidget, 'test-user-id');
      
      expect(mockNotifications.error).toHaveBeenCalledWith('Failed to deny handoff request.');
    });
  });

  describe('HTML Generation', () => {
    it('should generate correct HTML structure for notifications', () => {
      // Mock the store methods
      mockWidget.store.getSessionState.mockReturnValue({
        hasJoinedSession: true,
        activeRequests: [
          { userId: 'test-user', userName: 'Test User Name', timestamp: Date.now() }
        ]
      });
      mockWidget.store.isDJ.mockReturnValue(true);
      
      // Mock game.user
      (global as any).game.user = { id: 'dj-user' };
      
      // Get the method from the widget prototype
      const updateHandoffNotifications = YouTubePlayerWidget.prototype.updateHandoffNotifications;
      
      // Call the method on our mock widget
      updateHandoffNotifications.call(mockWidget);
      
      // Check HTML structure
      const notification = mockElement.querySelector('.handoff-notification');
      expect(notification).toBeTruthy();
      
      // Check header
      const title = notification?.querySelector('.handoff-notification-title');
      expect(title?.textContent?.trim()).toBe('DJ Handoff Request');
      
      // Check content
      const content = notification?.querySelector('.handoff-notification-content');
      expect(content?.textContent).toContain('Test User Name');
      expect(content?.textContent).toContain('requests DJ role');
      
      // Check buttons
      const approveBtn = notification?.querySelector('.approve');
      const denyBtn = notification?.querySelector('.deny');
      expect(approveBtn?.textContent?.trim()).toContain('Approve');
      expect(denyBtn?.textContent?.trim()).toContain('Deny');
      
      // Check data attributes
      expect(notification?.getAttribute('data-requester-id')).toBe('test-user');
    });
  });
});