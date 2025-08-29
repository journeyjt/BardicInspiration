export interface EventContext {
  source: 'user' | 'system' | 'network' | 'youtube';
  timestamp: number;
  userId?: string;
  sessionId?: string;
}

export interface PlayerEvent {
  type: string;
  data: any;
  context: EventContext;
}

export type EventHandler = (event: PlayerEvent) => void | Promise<void>;
export type EventFilter = (event: PlayerEvent) => boolean;

export interface EventSubscription {
  id: string;
  handler: EventHandler;
  filter?: EventFilter;
  once: boolean;
}

export class PlayerEventHandler {
  private subscriptions = new Map<string, EventSubscription[]>();
  private globalFilters: EventFilter[] = [];
  private eventQueue: PlayerEvent[] = [];
  private processing = false;
  private subscriptionId = 0;
  private debugMode = false;
  private maxQueueSize = 1000;
  private batchSize = 10;

  constructor(debugMode = false) {
    this.debugMode = debugMode;
  }

  // Event subscription
  on(eventType: string, handler: EventHandler, filter?: EventFilter): string {
    return this.subscribe(eventType, handler, filter, false);
  }

  once(eventType: string, handler: EventHandler, filter?: EventFilter): string {
    return this.subscribe(eventType, handler, filter, true);
  }

  private subscribe(
    eventType: string,
    handler: EventHandler,
    filter?: EventFilter,
    once = false
  ): string {
    const subscription: EventSubscription = {
      id: `sub_${++this.subscriptionId}_${Date.now()}`,
      handler,
      filter,
      once
    };

    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }

    this.subscriptions.get(eventType)!.push(subscription);

    if (this.debugMode) {
      console.log(`PlayerEventHandler: Subscribed to '${eventType}' (${subscription.id})`);
    }

    return subscription.id;
  }

  // Event unsubscription
  off(subscriptionId: string): boolean {
    for (const [eventType, subs] of this.subscriptions.entries()) {
      const index = subs.findIndex(sub => sub.id === subscriptionId);
      if (index !== -1) {
        subs.splice(index, 1);
        
        // Clean up empty event type arrays
        if (subs.length === 0) {
          this.subscriptions.delete(eventType);
        }

        if (this.debugMode) {
          console.log(`PlayerEventHandler: Unsubscribed ${subscriptionId} from '${eventType}'`);
        }
        
        return true;
      }
    }
    
    return false;
  }

  offAll(eventType?: string): void {
    if (eventType) {
      this.subscriptions.delete(eventType);
      if (this.debugMode) {
        console.log(`PlayerEventHandler: Removed all subscriptions for '${eventType}'`);
      }
    } else {
      this.subscriptions.clear();
      if (this.debugMode) {
        console.log('PlayerEventHandler: Removed all subscriptions');
      }
    }
  }

  // Event emission
  emit(eventType: string, data: any, context?: Partial<EventContext>): void {
    const event: PlayerEvent = {
      type: eventType,
      data,
      context: {
        source: 'system',
        timestamp: Date.now(),
        ...context
      }
    };

    this.queueEvent(event);
  }

  emitUser(eventType: string, data: any, userId?: string): void {
    this.emit(eventType, data, { source: 'user', userId });
  }

  emitSystem(eventType: string, data: any): void {
    this.emit(eventType, data, { source: 'system' });
  }

  emitNetwork(eventType: string, data: any, sessionId?: string): void {
    this.emit(eventType, data, { source: 'network', sessionId });
  }

  emitYouTube(eventType: string, data: any): void {
    this.emit(eventType, data, { source: 'youtube' });
  }

  // Event processing
  private queueEvent(event: PlayerEvent): void {
    // Apply global filters
    for (const filter of this.globalFilters) {
      if (!filter(event)) {
        if (this.debugMode) {
          console.log(`PlayerEventHandler: Event '${event.type}' filtered out by global filter`);
        }
        return;
      }
    }

    // Add to queue
    this.eventQueue.push(event);

    // Limit queue size
    while (this.eventQueue.length > this.maxQueueSize) {
      const dropped = this.eventQueue.shift();
      if (this.debugMode && dropped) {
        console.warn(`PlayerEventHandler: Dropped event '${dropped.type}' due to queue size limit`);
      }
    }

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }
  }

  private async startProcessing(): Promise<void> {
    if (this.processing) return;

    this.processing = true;

    while (this.eventQueue.length > 0) {
      const batch = this.eventQueue.splice(0, this.batchSize);
      
      for (const event of batch) {
        await this.processEvent(event);
      }

      // Yield to event loop between batches
      if (this.eventQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    this.processing = false;
  }

  private async processEvent(event: PlayerEvent): Promise<void> {
    const subscriptions = this.subscriptions.get(event.type);
    if (!subscriptions || subscriptions.length === 0) {
      if (this.debugMode) {
        console.log(`PlayerEventHandler: No subscribers for event '${event.type}'`);
      }
      return;
    }

    const toRemove: string[] = [];

    for (const subscription of subscriptions) {
      // Apply subscription filter
      if (subscription.filter && !subscription.filter(event)) {
        continue;
      }

      try {
        if (this.debugMode) {
          console.log(`PlayerEventHandler: Processing event '${event.type}' with handler ${subscription.id}`);
        }

        await subscription.handler(event);

        // Mark for removal if this was a once subscription
        if (subscription.once) {
          toRemove.push(subscription.id);
        }
      } catch (error) {
        console.error(`PlayerEventHandler: Error in event handler ${subscription.id}:`, error);
      }
    }

    // Remove once subscriptions
    toRemove.forEach(id => this.off(id));
  }

  // Filters
  addGlobalFilter(filter: EventFilter): void {
    this.globalFilters.push(filter);
  }

  removeGlobalFilter(filter: EventFilter): void {
    const index = this.globalFilters.indexOf(filter);
    if (index !== -1) {
      this.globalFilters.splice(index, 1);
    }
  }

  clearGlobalFilters(): void {
    this.globalFilters = [];
  }

  // Common event filters
  static createSourceFilter(source: EventContext['source']): EventFilter {
    return (event) => event.context.source === source;
  }

  static createUserFilter(userId: string): EventFilter {
    return (event) => event.context.userId === userId;
  }

  static createTimeFilter(maxAge: number): EventFilter {
    return (event) => (Date.now() - event.context.timestamp) <= maxAge;
  }

  static createDataFilter(predicate: (data: any) => boolean): EventFilter {
    return (event) => predicate(event.data);
  }

  // Utility methods
  hasSubscriptions(eventType?: string): boolean {
    if (eventType) {
      const subs = this.subscriptions.get(eventType);
      return subs !== undefined && subs.length > 0;
    }
    return this.subscriptions.size > 0;
  }

  getSubscriptionCount(eventType?: string): number {
    if (eventType) {
      return this.subscriptions.get(eventType)?.length || 0;
    }
    return Array.from(this.subscriptions.values()).reduce((sum, subs) => sum + subs.length, 0);
  }

  getEventTypes(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  // High-level event methods for common player events
  onPlayerReady(handler: (data: any) => void): string {
    return this.on('player:ready', (event) => handler(event.data));
  }

  onPlayerStateChange(handler: (state: number) => void): string {
    return this.on('player:statechange', (event) => handler(event.data.state));
  }

  onPlayerError(handler: (error: any) => void): string {
    return this.on('player:error', (event) => handler(event.data));
  }

  onVideoLoad(handler: (videoId: string) => void): string {
    return this.on('video:load', (event) => handler(event.data.videoId));
  }

  onPlaybackCommand(handler: (command: string, data: any) => void): string {
    return this.on('command:playback', (event) => handler(event.data.command, event.data));
  }

  onSyncRequest(handler: (data: any) => void): string {
    return this.on('sync:request', (event) => handler(event.data));
  }

  onVolumeChange(handler: (volume: number, isMuted: boolean) => void): string {
    return this.on('player:volumechange', (event) => handler(event.data.volume, event.data.isMuted));
  }

  onQualityChange(handler: (quality: string) => void): string {
    return this.on('player:qualitychange', (event) => handler(event.data.quality));
  }

  onRateChange(handler: (rate: number) => void): string {
    return this.on('player:ratechange', (event) => handler(event.data.rate));
  }

  // Emit common player events
  emitPlayerReady(data?: any): void {
    this.emitYouTube('player:ready', data);
  }

  emitPlayerStateChange(state: number): void {
    this.emitYouTube('player:statechange', { state });
  }

  emitPlayerError(error: any): void {
    this.emitYouTube('player:error', error);
  }

  emitVideoLoad(videoId: string, videoData?: any): void {
    this.emitSystem('video:load', { videoId, ...videoData });
  }

  emitPlaybackCommand(command: string, data?: any): void {
    this.emitUser('command:playback', { command, ...data });
  }

  emitSyncRequest(data: any): void {
    this.emitSystem('sync:request', data);
  }

  emitVolumeChange(volume: number, isMuted: boolean): void {
    this.emitYouTube('player:volumechange', { volume, isMuted });
  }

  emitQualityChange(quality: string): void {
    this.emitYouTube('player:qualitychange', { quality });
  }

  emitRateChange(rate: number): void {
    this.emitYouTube('player:ratechange', { rate });
  }

  // Configuration
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  setMaxQueueSize(size: number): void {
    this.maxQueueSize = Math.max(1, size);
  }

  setBatchSize(size: number): void {
    this.batchSize = Math.max(1, size);
  }

  // Statistics
  getStats(): {
    subscriptionCount: number;
    eventTypes: string[];
    queueLength: number;
    processing: boolean;
    globalFilterCount: number;
    maxQueueSize: number;
    batchSize: number;
  } {
    return {
      subscriptionCount: this.getSubscriptionCount(),
      eventTypes: this.getEventTypes(),
      queueLength: this.eventQueue.length,
      processing: this.processing,
      globalFilterCount: this.globalFilters.length,
      maxQueueSize: this.maxQueueSize,
      batchSize: this.batchSize
    };
  }

  // Cleanup
  async flush(): Promise<void> {
    while (this.processing || this.eventQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  destroy(): void {
    this.offAll();
    this.clearGlobalFilters();
    this.eventQueue = [];
    this.processing = false;
  }
}