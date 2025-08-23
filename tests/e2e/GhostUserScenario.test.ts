/**
 * End-to-end test for the "ghost user" scenario that was fixed
 * Tests the complete flow from user join, disconnect, cleanup, and reconnection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionStore } from '../../src/state/SessionStore.js';
import { SessionManager } from '../../src/services/SessionManager.js';
import { SocketManager } from '../../src/services/SocketManager.js';
import TestUtils from '../setup/test-setup.js';

describe('Ghost User Scenario E2E', () => {
  let store: SessionStore;
  let sessionManager: SessionManager;
  let socketManager: SocketManager;

  beforeEach(() => {
    TestUtils.resetMocks();
    (SessionStore as any).instance = null;
    store = SessionStore.getInstance();
    store.initialize();
    sessionManager = new SessionManager(store);
    socketManager = new SocketManager(store);
    socketManager.initialize();
  });

  it('should handle complete ghost user scenario correctly', async () => {
    // === PHASE 1: Director joins and becomes DJ ===
    TestUtils.mockUser({ id: 'director-id', name: 'Director' });
    
    await sessionManager.claimDJRole();
    sessionManager.addSessionMember({
      userId: 'director-id',
      name: 'Director',
      isDJ: true,
      isActive: true,
      missedHeartbeats: 0
    });

    // Update session state to show director joined
    store.updateState({
      session: { hasJoinedSession: true, isConnected: true }
    });

    let state = store.getState();
    expect(state.session.djUserId).toBe('director-id');
    expect(state.session.members).toHaveLength(1);

    // === PHASE 2: Player3 joins session ===
    const player3JoinMessage = {
      type: 'USER_JOIN',
      userId: 'player3-id',
      timestamp: Date.now(),
      data: { userName: 'Player 3', userId: 'player3-id' }
    };

    // Director receives Player3's join message
    const userJoinHandler = socketManager['messageHandlers'].get('USER_JOIN');
    userJoinHandler?.handle(player3JoinMessage);

    state = store.getState();
    expect(state.session.members).toHaveLength(2);
    expect(state.session.members.some(m => m.userId === 'player3-id')).toBe(true);

    // === PHASE 3: Player3 closes browser without leaving session ===
    // (No explicit leave message sent)

    // === PHASE 4: Heartbeat system removes Player3 ===
    // Simulate heartbeat processing where Player3 doesn't respond
    sessionManager['updateMemberActivityFromHeartbeat']('director-id', ['director-id']); // Only director responds

    // Player3 should be marked with missed heartbeat
    state = store.getState();
    let player3Member = state.session.members.find(m => m.userId === 'player3-id');
    expect(player3Member?.missedHeartbeats).toBeGreaterThan(0);

    // Simulate multiple missed heartbeats (simulate enough time passing)
    for (let i = 0; i < 5; i++) {
      sessionManager['updateMemberActivityFromHeartbeat']('director-id', ['director-id']);
    }

    // Player3 should be removed after missing too many heartbeats
    state = store.getState();
    expect(state.session.members).toHaveLength(1);
    expect(state.session.members.some(m => m.userId === 'player3-id')).toBe(false);

    // === PHASE 5: Mock world settings without Player3 ===
    // This simulates what would be saved to world settings after cleanup
    const mockSettings = TestUtils.getMocks().settings;
    mockSettings.get.mockImplementation((scope: string, key: string) => {
      if (key === 'youtubeDJ.sessionMembers') {
        return [
          { userId: 'director-id', name: 'Director', isDJ: true, isActive: true, missedHeartbeats: 0 }
        ]; // Player3 not in persistent state
      }
      if (key === 'youtubeDJ.currentDJ') {
        return 'director-id';
      }
      if (key === 'youtubeDJ.queueState') {
        return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'director-id' };
      }
      return null;
    });

    // === PHASE 6: Player3 reconnects (new browser session) ===
    TestUtils.mockUser({ id: 'player3-id', name: 'Player 3' });

    // Initial state would be default (fresh browser)
    store.reset();
    
    // But then set as if they think they're still in session (old bug behavior)
    store.updateState({
      session: { hasJoinedSession: true, isConnected: true }
    });

    // Load from world settings (this is where the fix was applied)
    await store.loadFromWorld();

    // === VERIFICATION: Player3's session state should be reset ===
    state = store.getState();
    
    // The fix should have reset Player3's session state
    expect(state.session.hasJoinedSession).toBe(false);
    expect(state.session.isConnected).toBe(false);
    expect(state.session.connectionStatus).toBe('disconnected');
    
    // Player3 should NOT be in the member list
    expect(state.session.members.some(m => m.userId === 'player3-id')).toBe(false);
    
    // Only director should be in the member list
    expect(state.session.members).toHaveLength(1);
    expect(state.session.members[0].userId).toBe('director-id');

    // === PHASE 7: Player3 must rejoin properly ===
    // Player3 now clicks "Join Session" (proper rejoin)
    store.updateState({
      session: { hasJoinedSession: true, isConnected: true }
    });

    sessionManager.addSessionMember({
      userId: 'player3-id',
      name: 'Player 3',
      isDJ: false,
      isActive: true,
      missedHeartbeats: 0
    });

    // Send USER_JOIN message to other users
    const rejoinMessage = {
      type: 'USER_JOIN',
      userId: 'player3-id',
      timestamp: Date.now(),
      data: { userName: 'Player 3', userId: 'player3-id' }
    };

    // Switch back to director's perspective to receive the message
    TestUtils.mockUser({ id: 'director-id', name: 'Director' });
    userJoinHandler?.handle(rejoinMessage);

    // === FINAL VERIFICATION: Player3 properly rejoined ===
    state = store.getState();
    
    // Player3 should now be back in the member list (visible to director)
    expect(state.session.members).toHaveLength(2);
    expect(state.session.members.some(m => m.userId === 'player3-id')).toBe(true);
    
    // Director should still be DJ
    expect(state.session.djUserId).toBe('director-id');
    
    // Both members should be active
    const directorMember = state.session.members.find(m => m.userId === 'director-id');
    const player3Member2 = state.session.members.find(m => m.userId === 'player3-id');
    
    expect(directorMember?.isActive).toBe(true);
    expect(player3Member2?.isActive).toBe(true);
    expect(player3Member2?.missedHeartbeats).toBe(0);
  });

  it('should handle multiple players with same scenario', async () => {
    // Setup director as DJ
    TestUtils.mockUser({ id: 'director-id', name: 'Director' });
    await sessionManager.claimDJRole();
    sessionManager.addSessionMember({
      userId: 'director-id',
      name: 'Director',
      isDJ: true,
      isActive: true,
      missedHeartbeats: 0
    });

    // Multiple players join
    const userJoinHandler = socketManager['messageHandlers'].get('USER_JOIN');
    
    for (const playerId of ['player1-id', 'player2-id', 'player3-id']) {
      userJoinHandler?.handle({
        type: 'USER_JOIN',
        userId: playerId,
        timestamp: Date.now(),
        data: { userName: `Player ${playerId}`, userId: playerId }
      });
    }

    let state = store.getState();
    expect(state.session.members).toHaveLength(4); // Director + 3 players

    // All players disconnect without leaving
    // Heartbeat cleanup removes them all
    sessionManager['updateMemberActivityFromHeartbeat']('director-id', ['director-id']);
    
    // Simulate enough missed heartbeats to remove inactive players
    for (let i = 0; i < 6; i++) {
      sessionManager['updateMemberActivityFromHeartbeat']('director-id', ['director-id']);
    }

    state = store.getState();
    expect(state.session.members).toHaveLength(1); // Only director remains

    // Mock world settings reflect only director
    const mockSettings = TestUtils.getMocks().settings;
    mockSettings.get.mockImplementation((scope: string, key: string) => {
      if (key === 'youtubeDJ.sessionMembers') {
        return [{ userId: 'director-id', name: 'Director' }];
      }
      if (key === 'youtubeDJ.currentDJ') {
        return 'director-id';
      }
      if (key === 'youtubeDJ.queueState') {
        return { items: [], currentIndex: -1, mode: 'single-dj', djUserId: 'director-id' };
      }
      return null;
    });

    // Each player reconnects and should be forced to rejoin
    for (const playerId of ['player1-id', 'player2-id', 'player3-id']) {
      TestUtils.mockUser({ id: playerId, name: `Player ${playerId}` });
      
      // Reset and set as if they think they're in session
      store.reset();
      store.updateState({ session: { hasJoinedSession: true } });
      
      // Load from world should reset their state
      await store.loadFromWorld();
      
      const playerState = store.getState();
      expect(playerState.session.hasJoinedSession).toBe(false);
      expect(playerState.session.members.some(m => m.userId === playerId)).toBe(false);
    }
  });

  it('should maintain consistent state across service interactions', async () => {
    // This test verifies that state changes flow correctly through all services
    
    TestUtils.mockUser({ id: 'test-user-id', name: 'Test User' });
    
    // Track state changes
    const stateChanges: any[] = [];
    const mockHooks = TestUtils.getMocks().Hooks;
    mockHooks.callAll.mockImplementation((hookName: string, data: any) => {
      if (hookName === 'youtubeDJ.stateChanged') {
        stateChanges.push(data);
      }
    });

    // Sequence of operations
    await sessionManager.claimDJRole();
    sessionManager.addSessionMember({
      userId: 'test-user-id',
      name: 'Test User',
      isDJ: true,
      isActive: true,
      missedHeartbeats: 0
    });

    await sessionManager.releaseDJRole();

    // Verify each state change was properly emitted
    expect(stateChanges).toHaveLength(3); // claimDJ, addMember, releaseDJ
    
    // Verify final state consistency
    const finalState = store.getState();
    expect(finalState.session.djUserId).toBe(null);
    expect(finalState.session.members[0]?.isDJ).toBe(false);
  });
});