/**
 * Unit tests for SocketManager - message handling and broadcasting
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SocketManager } from '../../src/services/SocketManager.js';
import { SessionStore } from '../../src/state/SessionStore.js';
import TestUtils from '../setup/test-setup.js';

describe('SocketManager', () => {
  let socketManager: SocketManager;
  let store: SessionStore;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    socketManager = new SocketManager(store);
    socketManager.initialize();
  });

  describe('Initialization', () => {
    it('should initialize with default message handlers', () => {
      // Check that common handlers are registered
      const handlers = socketManager['messageHandlers'];
      expect(handlers.has('USER_JOIN')).toBe(true);
      expect(handlers.has('USER_LEAVE')).toBe(true);
      expect(handlers.has('DJ_CLAIM')).toBe(true);
      expect(handlers.has('DJ_RELEASE')).toBe(true);
      expect(handlers.has('STATE_REQUEST')).toBe(true);
      expect(handlers.has('STATE_RESPONSE')).toBe(true);
    });

    it('should setup socket listeners', () => {
      const mockSocket = TestUtils.getMocks().socket;
      expect(mockSocket.on).toHaveBeenCalledWith('module.bardic-inspiration', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });
  });

  describe('Message Handling', () => {
    it('should handle valid messages', () => {
      const mockHooks = TestUtils.getMocks().Hooks;
      const testMessage = {
        type: 'USER_JOIN',
        userId: 'other-user-id', // Different from current user to avoid self-message filtering
        timestamp: Date.now(),
        data: { userName: 'Other User' }
      };

      // Simulate receiving message
      socketManager['handleMessage'](testMessage);

      // Should emit hook for USER_JOIN
      expect(mockHooks.callAll).toHaveBeenCalledWith('youtubeDJ.userJoined', expect.objectContaining({
        userId: 'other-user-id',
        userName: 'Other User'
      }));
    });

    it('should ignore messages from self', () => {
      TestUtils.mockUser({ id: 'current-user-id' });
      
      const testMessage = {
        type: 'USER_JOIN',
        userId: 'current-user-id', // Same as current user
        timestamp: Date.now(),
        data: { userName: 'Current User' }
      };

      const mockHooks = TestUtils.getMocks().Hooks;
      socketManager['handleMessage'](testMessage);

      // Should not process own messages
      expect(mockHooks.callAll).not.toHaveBeenCalled();
    });

    it('should reject invalid messages', () => {
      const invalidMessage = {
        type: 'USER_JOIN',
        // Missing required fields
        timestamp: Date.now()
      };

      const mockHooks = TestUtils.getMocks().Hooks;
      socketManager['handleMessage'](invalidMessage as any);

      expect(mockHooks.callAll).not.toHaveBeenCalled();
    });

    it('should handle unknown message types gracefully', () => {
      const unknownMessage = {
        type: 'UNKNOWN_MESSAGE_TYPE',
        userId: 'test-user-id',
        timestamp: Date.now()
      };

      // Should not throw error
      expect(() => socketManager['handleMessage'](unknownMessage)).not.toThrow();
    });
  });

  describe('Message Broadcasting', () => {
    it('should send messages via socket', async () => {
      const mockSocket = TestUtils.getMocks().socket;
      mockSocket.connected = true;

      const testMessage = {
        type: 'DJ_CLAIM',
        userId: 'test-user-id',
        timestamp: Date.now()
      };

      await socketManager.sendMessage(testMessage);

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', testMessage);
    });

    it('should use fallback when socket not connected', async () => {
      const mockSocket = TestUtils.getMocks().socket;
      mockSocket.connected = false;

      const testMessage = {
        type: 'DJ_CLAIM',
        userId: 'test-user-id',
        timestamp: Date.now()
      };

      await socketManager.sendMessage(testMessage);

      // Should use fallback socket
      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration.fallback', expect.objectContaining({
        bardic_dj_message: testMessage
      }));
    });

    it('should add timestamp to messages without one', async () => {
      const mockSocket = TestUtils.getMocks().socket;
      
      const messageWithoutTimestamp = {
        type: 'DJ_CLAIM',
        userId: 'test-user-id'
      };

      await socketManager.sendMessage(messageWithoutTimestamp as any);

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        timestamp: expect.any(Number)
      }));
    });
  });

  describe('Connection Monitoring', () => {
    it('should update state on socket connect', () => {
      const connectCallback = TestUtils.getMocks().socket.on.mock.calls
        .find(call => call[0] === 'connect')?.[1];

      connectCallback?.();

      const state = store.getState();
      expect(state.session.isConnected).toBe(true);
      expect(state.session.connectionStatus).toBe('connected');
    });

    it('should update state on socket disconnect', () => {
      const disconnectCallback = TestUtils.getMocks().socket.on.mock.calls
        .find(call => call[0] === 'disconnect')?.[1];

      disconnectCallback?.();

      const state = store.getState();
      expect(state.session.isConnected).toBe(false);
      expect(state.session.connectionStatus).toBe('disconnected');
    });

    it('should request state on reconnection', () => {
      const mockSocket = TestUtils.getMocks().socket;
      const reconnectCallback = TestUtils.getMocks().socket.on.mock.calls
        .find(call => call[0] === 'reconnect')?.[1];

      reconnectCallback?.();

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'STATE_REQUEST'
      }));
    });
  });

  describe('State Synchronization', () => {
    it('should handle state request and send response', async () => {
      TestUtils.mockUser({ id: 'responding-user' });
      const mockSocket = TestUtils.getMocks().socket;
      
      // Setup some state to send
      store.updateState({
        session: { djUserId: 'responding-user' },
        queue: { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'responding-user' }
      });

      const stateRequestHandler = socketManager['messageHandlers'].get('STATE_REQUEST');
      await stateRequestHandler?.handle({
        type: 'STATE_REQUEST',
        userId: 'requesting-user',
        timestamp: Date.now()
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('module.bardic-inspiration', expect.objectContaining({
        type: 'STATE_RESPONSE',
        data: expect.objectContaining({
          session: expect.objectContaining({
            djUserId: 'responding-user'
          })
        })
      }));
    });

    it('should handle state response and update local state', async () => {
      TestUtils.mockUser({ id: 'receiving-user' });
      
      const stateResponseHandler = socketManager['messageHandlers'].get('STATE_RESPONSE');
      await stateResponseHandler?.handle({
        type: 'STATE_RESPONSE',
        userId: 'sending-user',
        timestamp: Date.now(),
        data: {
          session: {
            djUserId: 'remote-dj',
            members: [{ userId: 'remote-dj', name: 'Remote DJ', isDJ: true }]
          },
          queue: {
            items: [],
            currentIndex: -1,
            mode: 'single-dj'
          }
        }
      });

      const state = store.getState();
      expect(state.session.djUserId).toBe('remote-dj');
      expect(state.session.members).toHaveLength(1);
    });

    it('should preserve local runtime state during state response', async () => {
      TestUtils.mockUser({ id: 'receiving-user' });
      
      // Set local runtime state
      store.updateState({
        session: {
          hasJoinedSession: true,
          isConnected: true,
          connectionStatus: 'connected'
        }
      });

      const stateResponseHandler = socketManager['messageHandlers'].get('STATE_RESPONSE');
      await stateResponseHandler?.handle({
        type: 'STATE_RESPONSE',
        userId: 'sending-user',
        timestamp: Date.now(),
        data: {
          session: {
            djUserId: 'remote-dj',
            hasJoinedSession: false, // Should not override local state
            isConnected: false, // Should not override local state
            connectionStatus: 'disconnected' // Should not override local state
          }
        }
      });

      const state = store.getState();
      // Remote state should be merged
      expect(state.session.djUserId).toBe('remote-dj');
      // But local runtime state should be preserved
      expect(state.session.hasJoinedSession).toBe(true);
      expect(state.session.isConnected).toBe(true);
      expect(state.session.connectionStatus).toBe('connected');
    });
  });

  describe('Handler Registration', () => {
    it('should allow registering custom handlers', () => {
      const customHandler = {
        handle: vi.fn()
      };

      socketManager.registerHandler('CUSTOM_MESSAGE', customHandler);

      const handlers = socketManager['messageHandlers'];
      expect(handlers.get('CUSTOM_MESSAGE')).toBe(customHandler);
    });

    it('should allow unregistering handlers', () => {
      socketManager.unregisterHandler('USER_JOIN');

      const handlers = socketManager['messageHandlers'];
      expect(handlers.has('USER_JOIN')).toBe(false);
    });
  });
});