/**
 * Socket Manager - Handles message communication and broadcasting
 * Part of Phase 2: Service Layer Extraction
 */

import { SessionStore } from '../state/SessionStore.js';
import { logger } from '../lib/logger.js';

export interface YouTubeDJMessage {
  type: string;
  userId: string;
  timestamp: number;
  data?: any;
}

export interface MessageHandler {
  handle(message: YouTubeDJMessage): void;
}

export class SocketManager {
  private store: SessionStore;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private static readonly SOCKET_NAME = 'module.bardic-inspiration';
  private static readonly FALLBACK_SOCKET = 'module.bardic-inspiration.fallback';

  constructor(store: SessionStore) {
    this.store = store;
  }

  /**
   * Initialize socket communication
   */
  initialize(): void {
    logger.debug('🎵 YouTube DJ | Initializing SocketManager...');

    this.setupSocketListeners();
    this.setupConnectionMonitoring();
    this.registerDefaultHandlers();

    logger.info('🎵 YouTube DJ | SocketManager initialized');
  }

  /**
   * Send message to all connected users
   */
  async sendMessage(message: YouTubeDJMessage): Promise<void> {
    try {
      // Add timestamp if not present
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }

      logger.debug('🎵 YouTube DJ | Sending message:', {
        type: message.type,
        userId: message.userId,
        timestamp: message.timestamp
      });

      // Try primary socket channel first
      if (game.socket?.connected) {
        game.socket.emit(SocketManager.SOCKET_NAME, message);
      } else {
        logger.warn('🎵 YouTube DJ | Primary socket not connected, using fallback');
        this.sendFallbackMessage(message);
      }

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to send message:', error);
      // Try fallback method
      this.sendFallbackMessage(message);
    }
  }

  /**
   * Register message handler for specific message type
   */
  registerHandler(messageType: string, handler: MessageHandler): void {
    this.messageHandlers.set(messageType, handler);
    logger.debug('🎵 YouTube DJ | Registered handler for message type:', messageType);
  }

  /**
   * Remove message handler
   */
  unregisterHandler(messageType: string): void {
    this.messageHandlers.delete(messageType);
    logger.debug('🎵 YouTube DJ | Unregistered handler for message type:', messageType);
  }

  /**
   * Check if socket is connected
   */
  isConnected(): boolean {
    return game.socket?.connected || false;
  }

  /**
   * Setup socket listeners
   */
  private setupSocketListeners(): void {
    // Listen to primary socket channel
    game.socket?.on(SocketManager.SOCKET_NAME, (message: YouTubeDJMessage) => {
      this.handleMessage(message);
    });

    // Listen to fallback channel
    game.socket?.on(SocketManager.FALLBACK_SOCKET, (data: any) => {
      logger.debug('🎵 YouTube DJ | Received FALLBACK message:', data);
      if (data.bardic_dj_message && data.bardic_dj_message.userId !== game.user?.id) {
        logger.debug('🎵 YouTube DJ | Processing fallback message...');
        this.handleMessage(data.bardic_dj_message);
      }
    });

    logger.debug('🎵 YouTube DJ | Socket listeners setup complete');
  }

  /**
   * Setup connection monitoring
   */
  private setupConnectionMonitoring(): void {
    game.socket?.on('connect', () => {
      logger.info('🎵 YouTube DJ | Socket connected');
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          isConnected: true,
          connectionStatus: 'connected'
        }
      });
    });

    game.socket?.on('disconnect', () => {
      logger.warn('🎵 YouTube DJ | Socket disconnected');
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          isConnected: false,
          connectionStatus: 'disconnected'
        }
      });
    });

    game.socket?.on('reconnect', () => {
      logger.info('🎵 YouTube DJ | Socket reconnected');
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          isConnected: true,
          connectionStatus: 'connected'
        }
      });

      // Request current state when reconnecting
      this.sendMessage({
        type: 'STATE_REQUEST',
        userId: game.user?.id || '',
        timestamp: Date.now()
      });
    });
  }

  /**
   * Register default message handlers
   */
  private registerDefaultHandlers(): void {
    // State management handlers
    this.registerHandler('STATE_REQUEST', new StateRequestHandler(this.store, this));
    this.registerHandler('STATE_RESPONSE', new StateResponseHandler(this.store));
    this.registerHandler('STATE_SAVE_REQUEST', new StateSaveRequestHandler(this.store));

    // Session management handlers
    this.registerHandler('USER_JOIN', new UserJoinHandler(this.store));
    this.registerHandler('USER_LEAVE', new UserLeaveHandler(this.store));

    // DJ management handlers
    this.registerHandler('DJ_CLAIM', new DJClaimHandler(this.store));
    this.registerHandler('DJ_RELEASE', new DJReleaseHandler(this.store));
    this.registerHandler('DJ_REQUEST', new DJRequestHandler(this.store));
    this.registerHandler('DJ_APPROVE', new DJApproveHandler(this.store));
    this.registerHandler('DJ_DENY', new DJDenyHandler(this.store));
    this.registerHandler('DJ_HANDOFF', new DJHandoffHandler(this.store));
    this.registerHandler('GM_OVERRIDE', new GMOverrideHandler(this.store));
    this.registerHandler('MEMBER_CLEANUP', new MemberCleanupHandler(this.store));

    // Player control handlers
    this.registerHandler('PLAY', new PlayHandler(this.store));
    this.registerHandler('PAUSE', new PauseHandler(this.store));
    this.registerHandler('SEEK', new SeekHandler(this.store));
    this.registerHandler('LOAD', new LoadHandler(this.store));
    this.registerHandler('HEARTBEAT', new HeartbeatHandler(this.store));
    this.registerHandler('HEARTBEAT_RESPONSE', new HeartbeatResponseHandler(this.store));

    // Queue management handlers
    this.registerHandler('QUEUE_ADD', new QueueAddHandler(this.store));
    this.registerHandler('QUEUE_REMOVE', new QueueRemoveHandler(this.store));
    this.registerHandler('QUEUE_UPDATE', new QueueUpdateHandler(this.store));
    this.registerHandler('QUEUE_NEXT', new QueueNextHandler(this.store));

    logger.debug('🎵 YouTube DJ | Default message handlers registered');
  }

  /**
   * Handle incoming socket message
   */
  private handleMessage(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Received socket message:', {
      type: message.type,
      userId: message.userId,
      timestamp: message.timestamp
    });

    // Ignore messages from self
    if (message.userId === game.user?.id) {
      logger.debug('🎵 YouTube DJ | Ignoring message from self');
      return;
    }

    // Validate message
    if (!this.isValidMessage(message)) {
      logger.warn('🎵 YouTube DJ | Invalid message received:', message);
      return;
    }

    // Find and execute handler
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler.handle(message);
      } catch (error) {
        logger.error('🎵 YouTube DJ | Error handling message:', error);
      }
    } else {
      logger.warn('🎵 YouTube DJ | No handler for message type:', message.type);
    }

    // Update sender activity
    this.updateUserActivity(message.userId);
  }

  /**
   * Send message via fallback method
   */
  private sendFallbackMessage(message: YouTubeDJMessage): void {
    try {
      game.socket?.emit(SocketManager.FALLBACK_SOCKET, {
        bardic_dj_message: message,
        sender: game.user?.id,
        timestamp: Date.now()
      });
      logger.debug('🎵 YouTube DJ | Message sent via fallback channel');
    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to send fallback message:', error);
    }
  }

  /**
   * Validate message format
   */
  private isValidMessage(message: any): message is YouTubeDJMessage {
    return (
      message &&
      typeof message.type === 'string' &&
      typeof message.userId === 'string' &&
      typeof message.timestamp === 'number'
    );
  }

  /**
   * Update user activity timestamp
   */
  private updateUserActivity(userId: string): void {
    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.userActivity', { userId });
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    this.messageHandlers.clear();
    
    // Remove socket listeners
    game.socket?.off(SocketManager.SOCKET_NAME);
    game.socket?.off(SocketManager.FALLBACK_SOCKET);
    game.socket?.off('connect');
    game.socket?.off('disconnect');
    game.socket?.off('reconnect');

    logger.debug('🎵 YouTube DJ | SocketManager destroyed');
  }
}

// ===== Message Handlers =====

class StateRequestHandler implements MessageHandler {
  constructor(private store: SessionStore, private socketManager: SocketManager) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Handling STATE_REQUEST from:', message.userId);

    // Send current state to requester
    const currentState = this.store.getState();
    this.socketManager.sendMessage({
      type: 'STATE_RESPONSE',
      userId: game.user?.id || '',
      timestamp: Date.now(),
      data: {
        session: currentState.session,
        queue: currentState.queue,
        player: {
          currentVideo: currentState.player.currentVideo,
          playbackState: currentState.player.playbackState,
          currentTime: currentState.player.currentTime
        }
      }
    });
  }
}

class StateResponseHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Handling STATE_RESPONSE from:', message.userId);

    if (message.data) {
      // Merge received state with current state
      const updates: any = {};

      if (message.data.session) {
        updates.session = {
          ...this.store.getSessionState(),
          ...message.data.session
        };
      }

      if (message.data.queue) {
        updates.queue = {
          ...this.store.getQueueState(),
          ...message.data.queue
        };
      }

      if (message.data.player) {
        updates.player = {
          ...this.store.getPlayerState(),
          ...message.data.player
        };
      }

      this.store.updateState(updates);
    }
  }
}

class StateSaveRequestHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Handling STATE_SAVE_REQUEST from:', message.userId);
    
    // Only GMs can trigger state saves
    if (!game.user?.isGM) {
      logger.debug('🎵 YouTube DJ | Non-GM user cannot trigger state save, ignoring request');
      return;
    }
    
    // Force save current state to world settings
    this.store.saveToWorld();
  }
}

class UserJoinHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | User joined session:', message.data?.userName);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.userJoined', {
      userId: message.userId,
      userName: message.data?.userName || 'Unknown'
    });
  }
}

class UserLeaveHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | User left session:', message.userId);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.userLeft', {
      userId: message.userId
    });
  }
}

class DJClaimHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ claimed by:', message.userId);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.djClaimReceived', {
      userId: message.userId,
      userName: message.data?.userName || game.users?.get(message.userId)?.name || 'Unknown'
    });
  }
}

class DJReleaseHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ released by:', message.userId);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.djReleaseReceived', {
      userId: message.userId
    });
  }
}

class DJRequestHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ request from:', message.data?.userName);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.djRequestReceived', {
      userId: message.userId,
      userName: message.data?.userName || game.users?.get(message.userId)?.name || 'Unknown'
    });
  }
}

class DJApproveHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ request approved for:', message.data?.requesterId);

    // Remove from active requests
    const currentRequests = this.store.getSessionState().activeRequests;
    const updatedRequests = currentRequests.filter(
      req => req.userId !== message.data?.requesterId
    );

    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        activeRequests: updatedRequests
      }
    });
  }
}

class DJDenyHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ request denied for:', message.data?.requesterId);

    // Remove from active requests
    const currentRequests = this.store.getSessionState().activeRequests;
    const updatedRequests = currentRequests.filter(
      req => req.userId !== message.data?.requesterId
    );

    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        activeRequests: updatedRequests
      }
    });
  }
}

class DJHandoffHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | DJ handed off to:', message.data?.targetUserId);

    // Emit event for SessionManager to handle
    Hooks.callAll('youtubeDJ.djHandoffReceived', {
      fromUserId: message.userId,
      toUserId: message.data?.targetUserId,
      toUserName: message.data?.targetUserName || game.users?.get(message.data?.targetUserId)?.name || 'Unknown'
    });
  }
}

class GMOverrideHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | GM override received:', message.data?.userName);

    // Update local state to reflect GM override
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: message.data?.newDJ,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === message.data?.newDJ
        })),
        activeRequests: [] // Clear any pending requests
      }
    });

    // Show notification to other users
    if (message.userId !== game.user?.id) {
      ui.notifications?.info(`${message.data?.userName || 'GM'} used GM override to become DJ`);
    }
  }
}

class MemberCleanupHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Member cleanup received from:', message.userId);

    // Emit hook for SessionManager to handle
    Hooks.callAll('youtubeDJ.memberCleanupReceived', {
      userId: message.userId,
      removedMembers: message.data?.removedMembers || [],
      activeMembers: message.data?.activeMembers || []
    });
  }
}

class PlayHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Play command from DJ');

    // Emit event for PlayerManager to handle
    Hooks.callAll('youtubeDJ.playCommand', { timestamp: message.timestamp });
  }
}

class PauseHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Pause command from DJ');

    // Emit event for PlayerManager to handle
    Hooks.callAll('youtubeDJ.pauseCommand', { timestamp: message.timestamp });
  }
}

class SeekHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Seek command from DJ:', message.data?.time);

    // Emit event for PlayerManager to handle
    Hooks.callAll('youtubeDJ.seekCommand', {
      time: message.data?.time || 0,
      timestamp: message.timestamp
    });
  }
}

class LoadHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Load command from DJ:', message.data?.videoId);

    // Update player state
    this.store.updateState({
      player: {
        ...this.store.getPlayerState(),
        currentVideo: message.data?.videoInfo || null
      }
    });

    // Emit event for PlayerManager to handle
    Hooks.callAll('youtubeDJ.loadCommand', {
      videoId: message.data?.videoId,
      startTime: message.data?.startTime || 0,
      videoInfo: message.data?.videoInfo,
      timestamp: message.timestamp
    });
  }
}

class HeartbeatHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    // Only process heartbeats from the current DJ
    const currentDJ = this.store.getSessionState().djUserId;
    if (message.userId !== currentDJ) {
      logger.debug('🎵 YouTube DJ | Ignoring heartbeat from non-DJ user:', message.userId);
      return;
    }

    if (message.data) {
      // Emit event for PlayerManager to handle
      Hooks.callAll('youtubeDJ.heartbeat', {
        heartbeat: message.data,
        timestamp: message.timestamp
      });
      
      // Track that this user processed a heartbeat (after a small delay to let sync happen)
      setTimeout(() => {
        this.trackHeartbeatResponse(currentDJ);
      }, 100);
    }
  }
  
  private trackHeartbeatResponse(djUserId: string): void {
    // Get current user ID - they just processed a heartbeat
    const currentUserId = game.user?.id;
    if (!currentUserId) return;
    
    // Send heartbeat response back to DJ if we're not the DJ
    if (currentUserId !== djUserId) {
      game.socket?.emit('module.bardic-inspiration', {
        type: 'HEARTBEAT_RESPONSE',
        userId: currentUserId,
        timestamp: Date.now(),
        data: { djUserId, respondedAt: Date.now() }
      });
    }
  }
}

class HeartbeatResponseHandler implements MessageHandler {
  private responseTracker: Map<string, Set<string>> = new Map(); // djUserId -> Set of responding userIds
  private cleanupTimeouts: Map<string, number> = new Map();
  
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    const currentDJ = this.store.getSessionState().djUserId;
    const respondingUserId = message.userId;
    const djUserId = message.data?.djUserId;
    
    // Only DJ should collect responses
    if (game.user?.id !== currentDJ || djUserId !== currentDJ) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Heartbeat response from:', respondingUserId);
    
    // Track this response
    if (!this.responseTracker.has(djUserId)) {
      this.responseTracker.set(djUserId, new Set());
    }
    
    const responses = this.responseTracker.get(djUserId)!;
    responses.add(respondingUserId);
    
    // Clear any existing cleanup timeout for this DJ
    const existingTimeout = this.cleanupTimeouts.get(djUserId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set a new cleanup timeout to process responses after all listeners have had time to respond
    const timeoutId = window.setTimeout(() => {
      this.processCollectedResponses(djUserId);
    }, 1000); // Wait 1 second for all responses
    
    this.cleanupTimeouts.set(djUserId, timeoutId);
  }
  
  private processCollectedResponses(djUserId: string): void {
    const responses = this.responseTracker.get(djUserId);
    if (!responses) return;
    
    const respondingUsers = Array.from(responses);
    respondingUsers.push(djUserId); // DJ always counts as responding
    
    logger.debug('🎵 YouTube DJ | Processing heartbeat responses:', respondingUsers);
    
    // Emit heartbeat processed event for SessionManager
    Hooks.callAll('youtubeDJ.heartbeatProcessed', {
      djUserId,
      respondingUsers,
      timestamp: Date.now()
    });
    
    // Clean up
    this.responseTracker.delete(djUserId);
    this.cleanupTimeouts.delete(djUserId);
  }
}

class QueueAddHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Queue add from DJ');

    // Emit event for QueueManager to handle
    Hooks.callAll('youtubeDJ.queueAdd', {
      queueItem: message.data?.queueItem,
      playNow: message.data?.playNow || false,
      timestamp: message.timestamp
    });
  }
}

class QueueRemoveHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Queue remove from DJ');

    // Emit event for QueueManager to handle
    Hooks.callAll('youtubeDJ.queueRemove', {
      queueItemId: message.data?.queueItemId,
      timestamp: message.timestamp
    });
  }
}

class QueueUpdateHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Queue update from DJ');

    // Emit event for QueueManager to handle
    Hooks.callAll('youtubeDJ.queueUpdate', {
      fromIndex: message.data?.fromIndex,
      toIndex: message.data?.toIndex,
      timestamp: message.timestamp
    });
  }
}

class QueueNextHandler implements MessageHandler {
  constructor(private store: SessionStore) {}

  handle(message: YouTubeDJMessage): void {
    logger.debug('🎵 YouTube DJ | Queue next from DJ');

    // Emit event for QueueManager to handle
    Hooks.callAll('youtubeDJ.queueNext', {
      nextIndex: message.data?.nextIndex,
      videoItem: message.data?.videoItem,
      timestamp: message.timestamp
    });
  }
}