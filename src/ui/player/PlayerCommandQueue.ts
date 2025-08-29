export interface PlayerCommand {
  id: string;
  type: 'play' | 'pause' | 'seek' | 'load' | 'volume' | 'mute' | 'unmute' | 'stop' | 'quality' | 'rate';
  data?: any;
  timestamp: number;
  priority: number;
  retries: number;
  maxRetries: number;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  data?: any;
}

export type CommandHandler = (command: PlayerCommand) => Promise<CommandResult>;

export class PlayerCommandQueue {
  private queue: PlayerCommand[] = [];
  private processing = false;
  private handlers = new Map<string, CommandHandler>();
  private commandId = 0;
  private maxQueueSize = 100;
  private processingDelay = 50; // ms between commands
  private debugMode = false;

  constructor(maxQueueSize = 100, processingDelay = 50) {
    this.maxQueueSize = maxQueueSize;
    this.processingDelay = processingDelay;
  }

  // Command registration
  registerHandler(commandType: string, handler: CommandHandler): void {
    this.handlers.set(commandType, handler);
  }

  unregisterHandler(commandType: string): void {
    this.handlers.delete(commandType);
  }

  // Command queueing
  queueCommand(
    type: PlayerCommand['type'], 
    data?: any, 
    priority = 0, 
    maxRetries = 3
  ): string {
    const command: PlayerCommand = {
      id: `cmd_${++this.commandId}_${Date.now()}`,
      type,
      data,
      timestamp: Date.now(),
      priority,
      retries: 0,
      maxRetries
    };

    // Remove commands that exceed max queue size
    while (this.queue.length >= this.maxQueueSize) {
      const removed = this.queue.shift();
      if (this.debugMode && removed) {
        console.warn(`PlayerCommandQueue: Removed command ${removed.id} due to queue size limit`);
      }
    }

    // Insert command based on priority (higher priority first)
    const insertIndex = this.queue.findIndex(cmd => cmd.priority < priority);
    if (insertIndex === -1) {
      this.queue.push(command);
    } else {
      this.queue.splice(insertIndex, 0, command);
    }

    if (this.debugMode) {
      console.log(`PlayerCommandQueue: Queued command ${command.id} (${type}) with priority ${priority}`);
    }

    // Start processing if not already running
    if (!this.processing) {
      this.startProcessing();
    }

    return command.id;
  }

  // High-priority commands for immediate execution
  queueHighPriorityCommand(type: PlayerCommand['type'], data?: any): string {
    return this.queueCommand(type, data, 10, 1);
  }

  // Low-priority commands for background tasks
  queueLowPriorityCommand(type: PlayerCommand['type'], data?: any): string {
    return this.queueCommand(type, data, -1, 1);
  }

  // Queue management
  clearQueue(): void {
    const clearedCount = this.queue.length;
    this.queue = [];
    if (this.debugMode) {
      console.log(`PlayerCommandQueue: Cleared ${clearedCount} commands from queue`);
    }
  }

  removeCommand(commandId: string): boolean {
    const index = this.queue.findIndex(cmd => cmd.id === commandId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      if (this.debugMode) {
        console.log(`PlayerCommandQueue: Removed command ${commandId}`);
      }
      return true;
    }
    return false;
  }

  hasCommand(commandId: string): boolean {
    return this.queue.some(cmd => cmd.id === commandId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getQueuedCommands(): ReadonlyArray<PlayerCommand> {
    return [...this.queue];
  }

  // Command processing
  private async startProcessing(): Promise<void> {
    if (this.processing) return;

    this.processing = true;
    
    while (this.queue.length > 0) {
      const command = this.queue.shift();
      if (!command) continue;

      await this.executeCommand(command);
      
      // Small delay between commands to prevent overwhelming the player
      if (this.processingDelay > 0) {
        await this.delay(this.processingDelay);
      }
    }

    this.processing = false;
  }

  private async executeCommand(command: PlayerCommand): Promise<void> {
    const handler = this.handlers.get(command.type);
    
    if (!handler) {
      if (this.debugMode) {
        console.warn(`PlayerCommandQueue: No handler registered for command type '${command.type}'`);
      }
      return;
    }

    try {
      if (this.debugMode) {
        console.log(`PlayerCommandQueue: Executing command ${command.id} (${command.type})`);
      }

      const result = await handler(command);
      
      if (!result.success && command.retries < command.maxRetries) {
        // Retry the command
        command.retries++;
        command.timestamp = Date.now(); // Update timestamp for retry
        
        if (this.debugMode) {
          console.log(`PlayerCommandQueue: Retrying command ${command.id} (attempt ${command.retries + 1}/${command.maxRetries + 1})`);
        }

        // Re-queue with lower priority to allow other commands to execute first
        const retryPriority = Math.max(command.priority - 1, -10);
        const insertIndex = this.queue.findIndex(cmd => cmd.priority < retryPriority);
        if (insertIndex === -1) {
          this.queue.push(command);
        } else {
          this.queue.splice(insertIndex, 0, command);
        }
      } else if (!result.success) {
        if (this.debugMode) {
          console.error(`PlayerCommandQueue: Command ${command.id} failed after ${command.retries + 1} attempts:`, result.error);
        }
      } else if (this.debugMode) {
        console.log(`PlayerCommandQueue: Command ${command.id} executed successfully`);
      }
    } catch (error) {
      if (this.debugMode) {
        console.error(`PlayerCommandQueue: Error executing command ${command.id}:`, error);
      }
    }
  }

  // Batch operations
  queueBatch(commands: Array<{type: PlayerCommand['type'], data?: any, priority?: number}>): string[] {
    const commandIds: string[] = [];
    
    for (const cmd of commands) {
      const id = this.queueCommand(cmd.type, cmd.data, cmd.priority);
      commandIds.push(id);
    }

    return commandIds;
  }

  // Utility methods
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Configuration
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  setProcessingDelay(delay: number): void {
    this.processingDelay = Math.max(0, delay);
  }

  setMaxQueueSize(size: number): void {
    this.maxQueueSize = Math.max(1, size);
    
    // Trim queue if it exceeds new max size
    while (this.queue.length > this.maxQueueSize) {
      const removed = this.queue.shift();
      if (this.debugMode && removed) {
        console.warn(`PlayerCommandQueue: Removed command ${removed.id} due to queue size reduction`);
      }
    }
  }

  // Status information
  isProcessing(): boolean {
    return this.processing;
  }

  getStats(): {
    queueLength: number;
    processing: boolean;
    registeredHandlers: string[];
    maxQueueSize: number;
    processingDelay: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      registeredHandlers: Array.from(this.handlers.keys()),
      maxQueueSize: this.maxQueueSize,
      processingDelay: this.processingDelay
    };
  }

  // Cleanup
  destroy(): void {
    this.clearQueue();
    this.handlers.clear();
    this.processing = false;
  }
}