/**
 * Centralized state management for YouTube DJ module
 * Uses FoundryVTT world settings for persistence and hooks for reactivity
 */

import { 
  YouTubeDJState, 
  StateChangeEvent, 
  StateChangeListener,
  createDefaultYoutubeDJState 
} from './StateTypes.js';
import { logger } from '../lib/logger.js';

export class SessionStore {
  private static instance: SessionStore | null = null;
  private state: YouTubeDJState;
  private listeners: Set<StateChangeListener> = new Set();
  private saveTimeout: number | null = null;
  private initialized: boolean = false;

  // FoundryVTT world setting keys
  private static readonly WORLD_SETTINGS = {
    SESSION_STATE: 'youtubeDJ.sessionState',
    QUEUE_STATE: 'youtubeDJ.queueState',
    CURRENT_DJ: 'youtubeDJ.currentDJ',
    SESSION_MEMBERS: 'youtubeDJ.sessionMembers'
  } as const;

  private constructor() {
    this.state = createDefaultYoutubeDJState();
  }

  /**
   * Singleton pattern for FoundryVTT compatibility
   */
  static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  /**
   * Initialize the store (called from FoundryVTT init hook)
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('🎵 YouTube DJ | SessionStore already initialized');
      return;
    }

    logger.debug('🎵 YouTube DJ | Initializing SessionStore');
    this.initialized = true;
  }

  /**
   * Load state from FoundryVTT world settings
   */
  async loadFromWorld(): Promise<void> {
    try {
      logger.debug('🎵 YouTube DJ | Loading state from world settings');

      // Load legacy settings first for backward compatibility
      const currentDJ = game.settings.get('core', SessionStore.WORLD_SETTINGS.CURRENT_DJ) as string | null;
      const sessionMembers = game.settings.get('core', SessionStore.WORLD_SETTINGS.SESSION_MEMBERS) as any[] || [];
      const queueState = game.settings.get('core', SessionStore.WORLD_SETTINGS.QUEUE_STATE) as any || {};

      // Try to load the new unified state setting (future-proofing)
      let savedState: Partial<YouTubeDJState> | null = null;
      try {
        savedState = game.settings.get('core', SessionStore.WORLD_SETTINGS.SESSION_STATE) as Partial<YouTubeDJState> | null;
      } catch (error) {
        // Setting doesn't exist yet, will be created on first save
        logger.debug('🎵 YouTube DJ | No unified session state found, using legacy settings');
      }

      if (savedState) {
        // Use new unified state
        this.state = { ...createDefaultYoutubeDJState(), ...savedState };
      } else {
        // Migrate from legacy settings
        this.state = createDefaultYoutubeDJState();
        this.state.session.djUserId = currentDJ;
        this.state.session.members = sessionMembers.map(member => ({
          userId: member.userId || member.id || '',
          name: member.name || '',
          isDJ: (member.userId || member.id) === currentDJ,
          isActive: member.isActive ?? true,
          lastActivity: member.lastActivity || Date.now(),
          missedHeartbeats: member.missedHeartbeats ?? 0
        }));
        this.state.queue = {
          items: queueState.items || [],
          currentIndex: queueState.currentIndex || -1,
          mode: queueState.mode || 'single-dj',
          djUserId: queueState.djUserId || currentDJ
        };
      }

      // Clean up session members on startup to remove stale/duplicate entries
      this.cleanupSessionMembers();

      // No auto-join - all users must explicitly join via widget
      const currentUserId = game.user?.id;
      logger.debug('🎵 YouTube DJ | Session state loaded, requiring explicit join via widget:', {
        currentUserId,
        djUserId: this.state.session.djUserId,
        previouslyJoined: this.state.session.hasJoinedSession
      });
      
      // Reset session state for all users - they must join via widget
      this.state.session.hasJoinedSession = false;
      this.state.session.isConnected = false;
      this.state.session.connectionStatus = 'disconnected';

      logger.debug('🎵 YouTube DJ | State loaded successfully:', {
        djUserId: this.state.session.djUserId,
        memberCount: this.state.session.members.length,
        queueLength: this.state.queue.items.length
      });

    } catch (error) {
      logger.error('🎵 YouTube DJ | Failed to load state from world:', error);
      this.state = createDefaultYoutubeDJState();
    }
  }

  /**
   * Save state to FoundryVTT world settings
   * Only GMs can update world settings
   */
  async saveToWorld(): Promise<void> {
    if (!this.initialized) {
      logger.warn('🎵 YouTube DJ | Attempted to save before initialization');
      return;
    }

    // Only GMs can update world settings
    if (!game.user?.isGM) {
      logger.debug('🎵 YouTube DJ | Non-GM user cannot save to world settings, skipping');
      return;
    }

    try {
      // Debounce saves to prevent excessive world setting writes
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }

      this.saveTimeout = window.setTimeout(async () => {
        try {
          // Save unified state
          await game.settings.set('core', SessionStore.WORLD_SETTINGS.SESSION_STATE, this.state);
          
          // Also maintain backward compatibility with legacy settings
          await game.settings.set('core', SessionStore.WORLD_SETTINGS.CURRENT_DJ, this.state.session.djUserId);
          await game.settings.set('core', SessionStore.WORLD_SETTINGS.SESSION_MEMBERS, this.state.session.members);
          await game.settings.set('core', SessionStore.WORLD_SETTINGS.QUEUE_STATE, this.state.queue);

          logger.debug('🎵 YouTube DJ | State saved to world settings by GM');
        } catch (error) {
          logger.error('🎵 YouTube DJ | Failed to save state to world:', error);
        }
      }, 100); // 100ms debounce

    } catch (error) {
      logger.error('🎵 YouTube DJ | Error scheduling state save:', error);
    }
  }

  /**
   * Get current state (immutable copy)
   */
  getState(): YouTubeDJState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Update state and notify listeners
   */
  updateState(updates: Partial<YouTubeDJState>): void {
    if (!this.initialized) {
      logger.warn('🎵 YouTube DJ | Attempted to update state before initialization');
      return;
    }

    const previousState = this.getState();
    
    // Deep merge the updates
    this.state = this.deepMerge(this.state, updates);
    
    const currentState = this.getState();
    
    // Create state change event
    const changeEvent: StateChangeEvent = {
      previous: previousState,
      current: currentState,
      changes: updates,
      timestamp: Date.now()
    };

    // Emit FoundryVTT hook for other listeners
    logger.debug('🎵 YouTube DJ | Emitting state change hook:', {
      changes: Object.keys(updates),
      djChanged: updates.session?.djUserId !== undefined,
      hookListeners: Hooks.events['youtubeDJ.stateChanged']?.length || 0
    });
    Hooks.callAll('youtubeDJ.stateChanged', changeEvent);

    // Notify local listeners
    this.listeners.forEach(listener => {
      try {
        listener(changeEvent);
      } catch (error) {
        logger.error('🎵 YouTube DJ | Error in state change listener:', error);
      }
    });

    // Save to world settings
    this.saveToWorld();

    // Only log significant state changes to reduce console spam
    const significantChanges = Object.keys(updates).filter(key => {
      if (key === 'player') {
        // For player updates, only log if it's not just currentTime, lastHeartbeat, or activity updates
        return updates.player && Object.keys(updates.player).some(playerKey => 
          playerKey !== 'currentTime' && 
          playerKey !== 'lastHeartbeat' &&
          playerKey !== 'lastActivity'
        );
      }
      if (key === 'session') {
        // For session updates, don't log if it's only member activity updates
        return updates.session && Object.keys(updates.session).some(sessionKey => {
          if (sessionKey === 'members') {
            // Check if the members change is only activity timestamp updates
            const oldMembers = this.state.session.members;
            const newMembers = updates.session.members;
            if (oldMembers && newMembers && oldMembers.length === newMembers.length) {
              // Compare members excluding lastActivity field
              const significantMemberChanges = newMembers.some((newMember, index) => {
                const oldMember = oldMembers[index];
                return !oldMember || 
                       oldMember.id !== newMember.id ||
                       oldMember.name !== newMember.name ||
                       oldMember.isDJ !== newMember.isDJ;
              });
              return significantMemberChanges;
            }
            return true; // Member count changed, so it's significant
          }
          return sessionKey !== 'lastActivity';
        });
      }
      return true; // Other changes are significant
    });

    if (significantChanges.length > 0) {
      logger.debug('🎵 YouTube DJ | State updated:', {
        changes: significantChanges,
        djUserId: this.state.session.djUserId,
        memberCount: this.state.session.members.length
      });
    }
  }

  /**
   * Subscribe to state changes (local listeners)
   */
  subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Deep merge objects for state updates
   */
  private deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) {
      return target;
    }

    if (typeof source !== 'object' || Array.isArray(source)) {
      return source;
    }

    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
          result[key] = this.deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }

    return result;
  }

  /**
   * Reset state to defaults
   */
  reset(): void {
    logger.debug('🎵 YouTube DJ | Resetting state to defaults');
    this.updateState(createDefaultYoutubeDJState());
  }

  /**
   * Get specific state slice for convenience
   */
  getSessionState() {
    return this.state.session;
  }

  getPlayerState() {
    return this.state.player;
  }

  getQueueState() {
    return this.state.queue;
  }

  getUIState() {
    return this.state.ui;
  }

  /**
   * Check if user is DJ
   */
  isDJ(userId?: string): boolean {
    const targetUserId = userId || game.user?.id;
    return this.state.session.djUserId === targetUserId;
  }

  /**
   * Check if session is active
   */
  isSessionActive(): boolean {
    return this.state.session.hasJoinedSession && this.state.session.members.length > 0;
  }

  /**
   * Clean up session members on startup to remove duplicates and validate DJ status
   */
  private cleanupSessionMembers(): void {
    const members = this.state.session.members;
    
    // Remove duplicates based on userId
    const uniqueMembers = members.filter((member, index, arr) => 
      arr.findIndex(m => m.userId === member.userId) === index
    );
    
    // Validate DJ status consistency
    const currentDJ = this.state.session.djUserId;
    const validatedMembers = uniqueMembers.map(member => ({
      ...member,
      isDJ: member.userId === currentDJ,
      missedHeartbeats: member.missedHeartbeats ?? 0 // Ensure missedHeartbeats is set
    }));
    
    // Check if the current DJ is actually in the members list
    if (currentDJ && !validatedMembers.some(m => m.userId === currentDJ)) {
      logger.warn('🎵 YouTube DJ | DJ user not found in session members, clearing DJ role:', currentDJ);
      this.state.session.djUserId = null;
      // Update all members to not be DJ
      validatedMembers.forEach(member => member.isDJ = false);
    }
    
    // Update state if cleanup made changes
    if (validatedMembers.length !== members.length || 
        validatedMembers.some((m, i) => m.isDJ !== members[i]?.isDJ)) {
      
      this.state.session.members = validatedMembers;
      
      logger.debug('🎵 YouTube DJ | Session cleanup completed:', {
        originalCount: members.length,
        cleanedCount: validatedMembers.length,
        duplicatesRemoved: members.length - validatedMembers.length,
        djUserId: this.state.session.djUserId
      });
    }
  }

  /**
   * Cleanup method
   */
  destroy(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.listeners.clear();
    this.initialized = false;
    SessionStore.instance = null;
    logger.debug('🎵 YouTube DJ | SessionStore destroyed');
  }
}