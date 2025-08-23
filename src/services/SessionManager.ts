/**
 * Session Manager - Handles DJ roles, member management, and session lifecycle
 * Part of Phase 2: Service Layer Extraction
 */

import { SessionStore } from '../state/SessionStore.js';
import { SessionMember, DJRequest, StateChangeEvent, HEARTBEAT_ACTIVITY_CONFIG } from '../state/StateTypes.js';
import { logger } from '../lib/logger.js';

export interface YouTubeDJMessage {
  type: string;
  userId: string;
  timestamp: number;
  data?: any;
}

export class SessionManager {
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
    
    // Listen to state changes for business logic
    Hooks.on('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    
    // Listen to socket events from SocketManager
    Hooks.on('youtubeDJ.userJoined', this.onUserJoined.bind(this));
    Hooks.on('youtubeDJ.userLeft', this.onUserLeft.bind(this));
    Hooks.on('youtubeDJ.djClaimReceived', this.onDJClaimReceived.bind(this));
    Hooks.on('youtubeDJ.djReleaseReceived', this.onDJReleaseReceived.bind(this));
    Hooks.on('youtubeDJ.djRequestReceived', this.onDJRequestReceived.bind(this));
    Hooks.on('youtubeDJ.djHandoffReceived', this.onDJHandoffReceived.bind(this));
    Hooks.on('youtubeDJ.gmOverrideReceived', this.onGMOverrideReceived.bind(this));
    Hooks.on('youtubeDJ.memberCleanupReceived', this.onMemberCleanupReceived.bind(this));
    
    // Listen for heartbeat events for inactive user detection
    Hooks.on('youtubeDJ.heartbeatProcessed', this.onHeartbeatProcessed.bind(this));
  }

  // joinSession method removed - sessions can only be joined via widget

  // leaveSession method removed - sessions can only be left via widget

  /**
   * Claim DJ role
   */
  async claimDJRole(): Promise<void> {
    const userId = game.user?.id;
    if (!userId) {
      throw new Error('No user context available');
    }

    if (this.store.isDJ(userId)) {
      logger.debug('🎵 YouTube DJ | Already DJ');
      return;
    }

    const currentDJ = this.store.getSessionState().djUserId;
    if (currentDJ && currentDJ !== userId) {
      throw new Error('Another user is already DJ');
    }

    logger.debug('🎵 YouTube DJ | Claiming DJ role...');

    // Update state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: userId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === userId
        }))
      }
    });

    // Broadcast DJ claim
    this.broadcastMessage({
      type: 'DJ_CLAIM',
      userId: userId,
      timestamp: Date.now()
    });

    logger.info('🎵 YouTube DJ | Successfully claimed DJ role');
  }

  /**
   * GM override to force claim DJ role (bypasses normal restrictions)
   */
  async gmOverrideDJRole(): Promise<void> {
    const userId = game.user?.id;
    if (!userId) {
      throw new Error('No user context available');
    }

    if (!game.user?.isGM) {
      throw new Error('Only GMs can use override');
    }

    if (this.store.isDJ(userId)) {
      logger.debug('🎵 YouTube DJ | Already DJ');
      return;
    }

    logger.debug('🎵 YouTube DJ | GM overriding DJ role...');

    const currentDJ = this.store.getSessionState().djUserId;
    if (currentDJ && currentDJ !== userId) {
      logger.info('🎵 YouTube DJ | GM overriding DJ role from user:', currentDJ);
    }

    // Update state (bypass normal restrictions)
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: userId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === userId
        }))
      }
    });

    // Broadcast GM override
    this.broadcastMessage({
      type: 'GM_OVERRIDE',
      userId: userId,
      timestamp: Date.now(),
      data: { previousDJ: currentDJ }
    });

    logger.info('🎵 YouTube DJ | GM successfully overrode DJ role');
  }

  /**
   * Release DJ role
   */
  async releaseDJRole(): Promise<void> {
    const userId = game.user?.id;
    if (!userId) return;

    if (!this.store.isDJ(userId)) {
      logger.debug('🎵 YouTube DJ | Not DJ, cannot release');
      return;
    }

    logger.debug('🎵 YouTube DJ | Releasing DJ role...');

    // Update state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: null,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: false
        }))
      }
    });

    // Broadcast DJ release
    this.broadcastMessage({
      type: 'DJ_RELEASE',
      userId: userId,
      timestamp: Date.now()
    });

    // Auto-recovery removed - DJ role must be manually claimed

    logger.info('🎵 YouTube DJ | Successfully released DJ role');
  }

  /**
   * Request DJ role (for approval workflow)
   */
  async requestDJRole(): Promise<void> {
    const userId = game.user?.id;
    const userName = game.user?.name;

    if (!userId || !userName) {
      throw new Error('No user context available');
    }

    if (this.store.isDJ(userId)) {
      logger.debug('🎵 YouTube DJ | Already DJ');
      return;
    }

    const currentDJ = this.store.getSessionState().djUserId;
    
    logger.debug('🎵 YouTube DJ | Requesting DJ role...', { currentDJ, isGM: game.user?.isGM });
    
    // If no current DJ and user is GM, they can claim directly
    if (!currentDJ && game.user?.isGM) {
      await this.claimDJRole();
      return;
    }
    
    // If no current DJ and user is not GM, they still need to go through request flow
    // This ensures consistent behavior and prevents race conditions

    // Broadcast DJ request
    this.broadcastMessage({
      type: 'DJ_REQUEST',
      userId: userId,
      timestamp: Date.now(),
      data: { userName }
    });

    ui.notifications?.info('DJ request sent. Waiting for approval...');
  }

  /**
   * Handoff DJ role to another user
   */
  async handoffDJRole(targetUserId: string): Promise<void> {
    const currentUserId = game.user?.id;
    if (!currentUserId) return;

    if (!this.store.isDJ(currentUserId)) {
      throw new Error('Only DJ can handoff role');
    }

    const targetMember = this.store.getSessionState().members.find(m => m.userId === targetUserId);
    if (!targetMember) {
      throw new Error('Target user not in session');
    }

    logger.debug('🎵 YouTube DJ | Handing off DJ role to:', targetMember.name);

    // Update state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: targetUserId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === targetUserId
        }))
      }
    });

    // Broadcast handoff
    this.broadcastMessage({
      type: 'DJ_HANDOFF',
      userId: currentUserId,
      timestamp: Date.now(),
      data: { targetUserId, targetUserName: targetMember.name }
    });

    ui.notifications?.success(`DJ role handed off to ${targetMember.name}`);
  }

  /**
   * Approve DJ request
   */
  async approveDJRequest(requesterId: string): Promise<void> {
    const currentUserId = game.user?.id;
    if (!currentUserId || !this.store.isDJ(currentUserId)) {
      throw new Error('Only DJ can approve requests');
    }

    logger.debug('🎵 YouTube DJ | Approving DJ request from:', requesterId);

    // Remove from active requests
    const activeRequests = this.store.getSessionState().activeRequests.filter(
      req => req.userId !== requesterId
    );

    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        activeRequests
      }
    });

    // Broadcast approval and handoff role
    this.broadcastMessage({
      type: 'DJ_APPROVE',
      userId: currentUserId,
      timestamp: Date.now(),
      data: { requesterId }
    });

    await this.handoffDJRole(requesterId);
  }

  /**
   * Deny DJ request
   */
  async denyDJRequest(requesterId: string): Promise<void> {
    const currentUserId = game.user?.id;
    if (!currentUserId || !this.store.isDJ(currentUserId)) {
      throw new Error('Only DJ can deny requests');
    }

    logger.debug('🎵 YouTube DJ | Denying DJ request from:', requesterId);

    // Remove from active requests
    const activeRequests = this.store.getSessionState().activeRequests.filter(
      req => req.userId !== requesterId
    );

    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        activeRequests
      }
    });

    // Broadcast denial
    this.broadcastMessage({
      type: 'DJ_DENY',
      userId: currentUserId,
      timestamp: Date.now(),
      data: { requesterId }
    });
  }

  /**
   * Add session member
   */
  addSessionMember(member: SessionMember): void {
    const currentMembers = this.store.getSessionState().members;
    const existingIndex = currentMembers.findIndex(m => m.userId === member.userId);

    logger.debug('🎵 YouTube DJ | addSessionMember called:', {
      memberName: member.name,
      memberId: member.userId,
      existingIndex,
      currentMemberCount: currentMembers.length,
      currentMembers: currentMembers.map(m => ({ id: m.userId, name: m.name }))
    });

    let updatedMembers: SessionMember[];
    if (existingIndex >= 0) {
      // Update existing member
      updatedMembers = [...currentMembers];
      updatedMembers[existingIndex] = { ...member };
      logger.debug('🎵 YouTube DJ | Updated existing member at index:', existingIndex);
    } else {
      // Add new member
      updatedMembers = [...currentMembers, { ...member }];
      logger.debug('🎵 YouTube DJ | Added new member, total count will be:', updatedMembers.length);
    }

    const sessionStateBefore = this.store.getSessionState();
    
    this.store.updateState({
      session: {
        ...sessionStateBefore,
        members: updatedMembers
      }
    });

    const sessionStateAfter = this.store.getSessionState();
    
    logger.debug('🎵 YouTube DJ | Session member added/updated - state update result:', {
      memberName: member.name,
      membersBefore: sessionStateBefore.members.length,
      membersAfter: sessionStateAfter.members.length,
      finalMembers: sessionStateAfter.members.map(m => ({ id: m.userId, name: m.name }))
    });
  }

  /**
   * Remove session member
   */
  removeSessionMember(userId: string): void {
    const currentMembers = this.store.getSessionState().members;
    const wasDJ = currentMembers.find(m => m.userId === userId)?.isDJ;

    const updatedMembers = currentMembers.filter(m => m.userId !== userId);

    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        members: updatedMembers,
        djUserId: wasDJ ? null : this.store.getSessionState().djUserId
      }
    });

    // If removed member was DJ, clear DJ role - no auto-recovery
    if (wasDJ) {
      // DJ role cleared, members must manually claim it
      logger.info('🎵 YouTube DJ | DJ left session - role available for manual claim');
    }

    logger.debug('🎵 YouTube DJ | Session member removed:', userId);
  }


  /**
   * Try to claim DJ role if available
   */
  private async tryClaimDJRole(): Promise<void> {
    const currentDJ = this.store.getSessionState().djUserId;
    const userId = game.user?.id;

    if (!currentDJ && userId) {
      logger.debug('🎵 YouTube DJ | No DJ found, attempting to claim role...');
      try {
        await this.claimDJRole();
      } catch (error) {
        logger.debug('🎵 YouTube DJ | Could not claim DJ role:', error);
      }
    }
  }

  // Auto-recovery feature removed - users must manually claim DJ role

  /**
   * Handle heartbeat processed event for activity tracking
   */
  private onHeartbeatProcessed(data: { djUserId: string; respondingUsers: string[] }): void {
    if (!HEARTBEAT_ACTIVITY_CONFIG.CLEANUP_ON_HEARTBEAT) {
      return;
    }

    this.updateMemberActivityFromHeartbeat(data.djUserId, data.respondingUsers);
  }

  /**
   * Update member activity based on heartbeat responses and remove inactive users
   */
  private updateMemberActivityFromHeartbeat(djUserId: string, respondingUsers: string[]): void {
    const currentMembers = this.store.getSessionState().members;
    let membersChanged = false;
    let removedMembers: string[] = [];
    
    const updatedMembers = currentMembers.filter(member => {
      const wasResponding = respondingUsers.includes(member.userId);
      const isDJ = member.userId === djUserId;
      
      // DJ is always considered active if they're sending heartbeats
      // Listeners are active if they responded to heartbeat
      if (isDJ || wasResponding) {
        if (member.missedHeartbeats > 0) {
          membersChanged = true;
          // Reset missed heartbeats since they responded
          member.missedHeartbeats = 0;
          member.isActive = true;
        }
        return true; // Keep this member
      } else {
        // User didn't respond - increment missed heartbeats
        const newMissedCount = member.missedHeartbeats + 1;
        
        // Give newly joined users a grace period (30 seconds)
        const memberAge = Date.now() - (member.lastActivity || 0);
        const isNewMember = memberAge < 30000; // 30 seconds grace period
        
        if (newMissedCount >= HEARTBEAT_ACTIVITY_CONFIG.MAX_MISSED_HEARTBEATS && !isNewMember) {
          // Remove user who missed consecutive heartbeats (but not new users)
          logger.info(`🎵 YouTube DJ | Removing inactive user: ${member.name} (${newMissedCount} missed heartbeats) - likely browser closed`);
          removedMembers.push(member.userId);
          membersChanged = true;
          
          // If inactive member was the DJ, clear DJ role
          if (member.userId === this.store.getSessionState().djUserId) {
            logger.warn('🎵 YouTube DJ | DJ became inactive - clearing role');
            this.store.updateState({
              session: {
                ...this.store.getSessionState(),
                djUserId: null
              }
            });
          }
          
          return false; // Remove this member
        } else {
          // Still within tolerance, just increment missed count
          if (member.missedHeartbeats !== newMissedCount) {
            membersChanged = true;
            member.missedHeartbeats = newMissedCount;
            member.isActive = true; // Still active until they hit the limit
            
            if (isNewMember) {
              logger.debug(`🎵 YouTube DJ | New member ${member.name} missed heartbeat ${newMissedCount} but still in grace period`);
            }
          }
          return true; // Keep this member
        }
      }
    });

    if (membersChanged) {
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          members: updatedMembers
        }
      });
      
      // Broadcast member removal if any users were removed
      if (removedMembers.length > 0) {
        this.broadcastMessage({
          type: 'MEMBER_CLEANUP',
          userId: game.user?.id || '',
          timestamp: Date.now(),
          data: { 
            removedMembers,
            activeMembers: updatedMembers
          }
        });
      }
    }
  }

  /**
   * Remove members who have missed too many heartbeats (for manual cleanup on join)
   */
  private removeInactiveMembers(): void {
    const currentMembers = this.store.getSessionState().members;
    
    // Remove members who have already been marked with excessive missed heartbeats
    const activeMembers = currentMembers.filter(member => 
      member.missedHeartbeats < HEARTBEAT_ACTIVITY_CONFIG.MAX_MISSED_HEARTBEATS
    );

    if (activeMembers.length !== currentMembers.length) {
      const removedMembers = currentMembers.filter(member => 
        member.missedHeartbeats >= HEARTBEAT_ACTIVITY_CONFIG.MAX_MISSED_HEARTBEATS
      );
      logger.debug(`🎵 YouTube DJ | Manual cleanup removing ${removedMembers.length} inactive members:`, removedMembers.map(m => m.name));
      
      // Update local state
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          members: activeMembers
        }
      });

      // Broadcast member cleanup to synchronize across all users
      this.broadcastMessage({
        type: 'MEMBER_CLEANUP',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { 
          removedMembers: removedMembers.map(m => m.userId),
          activeMembers: activeMembers
        }
      });
    }
  }

  /**
   * Request session state from other users
   */
  private requestSessionState(): void {
    this.broadcastMessage({
      type: 'STATE_REQUEST',
      userId: game.user?.id || '',
      timestamp: Date.now()
    });
  }

  /**
   * Broadcast message via socket
   */
  private broadcastMessage(message: YouTubeDJMessage): void {
    // This will be handled by SocketManager in next step
    // For now, use direct socket communication
    game.socket?.emit('module.bardic-inspiration', message);
  }

  /**
   * Handle state changes for business logic
   */
  private onStateChanged(event: StateChangeEvent): void {
    // React to specific state changes for business logic
    if (event.changes.session?.djUserId !== undefined) {
      const previousDJ = event.previous.session.djUserId;
      const currentDJ = event.current.session.djUserId;
      
      // Only trigger handler if DJ actually changed
      if (previousDJ !== currentDJ) {
        this.handleDJChange(previousDJ, currentDJ);
      }
    }

    // Handle session join to clean up inactive members
    if (event.changes.session?.hasJoinedSession === true && 
        event.previous.session?.hasJoinedSession === false) {
      logger.debug('🎵 YouTube DJ | Current user joined session - cleaning up inactive members');
      this.cleanupInactiveMembers();
    }
  }

  /**
   * Handle DJ role changes
   */
  private handleDJChange(previousDJ: string | null, currentDJ: string | null): void {
    logger.debug('🎵 YouTube DJ | DJ role changed:', { previousDJ, currentDJ });

    // Additional business logic for DJ transitions can go here
    if (currentDJ && !previousDJ) {
      logger.info('🎵 YouTube DJ | DJ role claimed:', currentDJ);
    } else if (!currentDJ && previousDJ) {
      logger.info('🎵 YouTube DJ | DJ role released:', previousDJ);
    } else if (currentDJ && previousDJ && currentDJ !== previousDJ) {
      logger.info('🎵 YouTube DJ | DJ role transferred:', { from: previousDJ, to: currentDJ });
    }
  }

  /**
   * Handle user joined event from socket
   */
  private onUserJoined(data: { userId: string; userName: string }): void {
    logger.debug('🎵 YouTube DJ | onUserJoined hook received:', {
      userId: data.userId,
      userName: data.userName,
      currentUser: game.user?.id,
      isOwnMessage: data.userId === game.user?.id,
      currentMemberCount: this.store.getSessionState().members.length,
      currentMembers: this.store.getSessionState().members.map(m => ({ id: m.userId, name: m.name }))
    });
    
    // Don't process our own join message
    if (data.userId === game.user?.id) {
      logger.debug('🎵 YouTube DJ | Ignoring own USER_JOIN message');
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing user join for:', data.userName);
    
    // Clean up inactive members when someone new joins
    this.cleanupInactiveMembers();
    
    const membersBefore = this.store.getSessionState().members.length;
    
    // Add the user to our session members
    this.addSessionMember({
      userId: data.userId,
      name: data.userName,
      isDJ: data.userId === this.store.getSessionState().djUserId,
      isActive: true,
      missedHeartbeats: 0
    });
    
    const membersAfter = this.store.getSessionState().members.length;
    
    logger.debug('🎵 YouTube DJ | After adding user - member count changed:', {
      before: membersBefore,
      after: membersAfter,
      addedUser: data.userName,
      allMembers: this.store.getSessionState().members.map(m => ({ id: m.userId, name: m.name }))
    });
  }

  /**
   * Handle user left event from socket
   */
  private onUserLeft(data: { userId: string }): void {
    // Don't process our own leave message
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing user leave:', data.userId);
    
    // Remove the user from session members
    this.removeSessionMember(data.userId);
    
    // If they were DJ, handle DJ release
    if (data.userId === this.store.getSessionState().djUserId) {
      this.handleDJRelease(data.userId);
    }
  }

  /**
   * Handle DJ claim received from socket
   */
  private onDJClaimReceived(data: { userId: string; userName: string }): void {
    // Don't process our own claim
    if (data.userId === game.user?.id) {
      return;
    }
    
    // Don't process if user is already DJ
    const currentDJ = this.store.getSessionState().djUserId;
    if (currentDJ === data.userId) {
      logger.debug('🎵 YouTube DJ | Ignoring duplicate DJ claim from:', data.userName);
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing DJ claim from:', data.userName);
    
    // Update DJ state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: data.userId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === data.userId
        }))
      }
    });
    
    ui.notifications?.info(`${data.userName} is now the DJ!`);
  }

  /**
   * Handle DJ release received from socket
   */
  private onDJReleaseReceived(data: { userId: string }): void {
    // Don't process our own release
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing DJ release from:', data.userId);
    
    this.handleDJRelease(data.userId);
  }

  /**
   * Handle DJ request received from socket
   */
  private onDJRequestReceived(data: { userId: string; userName: string }): void {
    const currentDJ = this.store.getSessionState().djUserId;
    
    // If there's no current DJ, auto-approve the request
    if (!currentDJ) {
      logger.debug('🎵 YouTube DJ | No current DJ, auto-approving request from:', data.userName);
      
      // Directly update state to make them DJ
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          djUserId: data.userId,
          members: this.store.getSessionState().members.map(member => ({
            ...member,
            isDJ: member.userId === data.userId
          }))
        }
      });
      
      // Broadcast approval
      this.broadcastMessage({
        type: 'DJ_APPROVE',
        userId: game.user?.id || '',
        timestamp: Date.now(),
        data: { approvedUserId: data.userId, userName: data.userName }
      });
      
      return;
    }
    
    // Only the current DJ should process requests when there is a DJ
    if (!this.store.isDJ()) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing DJ request from:', data.userName);
    
    // Add to active requests
    const currentRequests = this.store.getSessionState().activeRequests;
    const newRequest: DJRequest = {
      userId: data.userId,
      userName: data.userName,
      timestamp: Date.now()
    };
    
    // Don't add duplicate requests
    if (!currentRequests.some(req => req.userId === data.userId)) {
      this.store.updateState({
        session: {
          ...this.store.getSessionState(),
          activeRequests: [...currentRequests, newRequest]
        }
      });
      
      ui.notifications?.info(`${data.userName} is requesting DJ control`);
    }
  }

  /**
   * Handle DJ handoff received from socket
   */
  private onDJHandoffReceived(data: { fromUserId: string; toUserId: string; toUserName: string }): void {
    // Don't process our own handoff
    if (data.fromUserId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing DJ handoff to:', data.toUserName);
    
    // Update DJ state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: data.toUserId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === data.toUserId
        })),
        activeRequests: [] // Clear requests after handoff
      }
    });
    
    if (data.toUserId === game.user?.id) {
      ui.notifications?.success('You are now the DJ!');
    } else {
      ui.notifications?.info(`${data.toUserName} is now the DJ!`);
    }
  }

  /**
   * Handle GM override received from socket
   */
  private onGMOverrideReceived(data: { userId: string; previousDJ: string | null }): void {
    // Don't process our own override
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing GM override by:', data.userId);
    
    // Update DJ state
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: data.userId,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: member.userId === data.userId
        })),
        activeRequests: [] // Clear requests after GM override
      }
    });
    
    const gmUser = this.store.getSessionState().members.find(m => m.userId === data.userId);
    const gmName = gmUser?.name || 'GM';
    ui.notifications?.warn(`${gmName} used GM override and is now the DJ!`);
  }

  /**
   * Handle member cleanup received from socket
   */
  private onMemberCleanupReceived(data: { removedMembers: string[]; activeMembers: any[] }): void {
    // Don't process our own cleanup message
    if (data.userId === game.user?.id) {
      return;
    }
    
    logger.debug('🎵 YouTube DJ | Processing member cleanup from another user:', data.removedMembers);
    
    // Update our local member list to match the cleanup
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        members: data.activeMembers
      }
    });
    
    if (data.removedMembers.length > 0) {
      logger.info(`🎵 YouTube DJ | Synchronized cleanup: removed ${data.removedMembers.length} inactive members`);
    }
  }


  /**
   * Handle DJ release (common logic)
   */
  private handleDJRelease(userId: string): void {
    // Clear DJ role
    this.store.updateState({
      session: {
        ...this.store.getSessionState(),
        djUserId: null,
        members: this.store.getSessionState().members.map(member => ({
          ...member,
          isDJ: false
        }))
      }
    });
    
    // Auto-recovery removed - DJ role must be manually claimed
  }

  /**
   * Manually clean up inactive members (can be called immediately)
   */
  cleanupInactiveMembers(): void {
    logger.debug('🎵 YouTube DJ | Manual cleanup of inactive members triggered');
    this.removeInactiveMembers();
  }


  /**
   * Cleanup method
   */
  destroy(): void {
    // Remove all event listeners
    Hooks.off('youtubeDJ.stateChanged', this.onStateChanged.bind(this));
    Hooks.off('youtubeDJ.userJoined', this.onUserJoined.bind(this));
    Hooks.off('youtubeDJ.userLeft', this.onUserLeft.bind(this));
    Hooks.off('youtubeDJ.djClaimReceived', this.onDJClaimReceived.bind(this));
    Hooks.off('youtubeDJ.djReleaseReceived', this.onDJReleaseReceived.bind(this));
    Hooks.off('youtubeDJ.djRequestReceived', this.onDJRequestReceived.bind(this));
    Hooks.off('youtubeDJ.djHandoffReceived', this.onDJHandoffReceived.bind(this));
    Hooks.off('youtubeDJ.gmOverrideReceived', this.onGMOverrideReceived.bind(this));
    Hooks.off('youtubeDJ.memberCleanupReceived', this.onMemberCleanupReceived.bind(this));
    Hooks.off('youtubeDJ.heartbeatProcessed', this.onHeartbeatProcessed.bind(this));
    
    logger.debug('🎵 YouTube DJ | SessionManager destroyed');
  }
}