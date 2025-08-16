/**
 * Logging utility for Bardic Inspiration module
 * Provides conditional logging based on environment and log levels
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export class Logger {
  private static instance: Logger;
  private moduleId: string;
  private isDevelopment: boolean;
  private logLevel: LogLevel;

  private constructor(moduleId: string) {
    this.moduleId = moduleId;
    this.isDevelopment = this.checkDevelopmentMode();
    this.logLevel = LogLevel.WARN; // Always use WARN level to prevent console flooding
  }

  public static getInstance(moduleId: string = 'bardic-inspiration'): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(moduleId);
    }
    return Logger.instance;
  }

  private checkDevelopmentMode(): boolean {
    // Check if we're in development mode
    return (
      // @ts-ignore - FoundryVTT development mode check
      typeof game !== 'undefined' && game.settings?.get('core', 'noCanvas') === true ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port === '5000' ||
      // Check for Vite dev server
      import.meta.env?.DEV === true
    );
  }

  private formatMessage(level: string, message: string): string {
    return `🎵 ${this.moduleId.toUpperCase()} | [${level}] ${message}`;
  }

  public error(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', message), ...args);
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN', message), ...args);
    }
  }

  public info(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.info(this.formatMessage('INFO', message), ...args);
    }
  }

  public debug(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(this.formatMessage('DEBUG', message), ...args);
    }
  }

  public log(message: string, ...args: any[]): void {
    // Alias for debug - will only show in development
    this.debug(message, ...args);
  }

  // Utility methods for common logging patterns
  public socket(message: string, ...args: any[]): void {
    this.debug(`Socket | ${message}`, ...args);
  }

  public player(message: string, ...args: any[]): void {
    this.debug(`Player | ${message}`, ...args);
  }

  public ui(message: string, ...args: any[]): void {
    this.debug(`UI | ${message}`, ...args);
  }

  public api(message: string, ...args: any[]): void {
    this.debug(`API | ${message}`, ...args);
  }

  // Get current development mode status
  public get development(): boolean {
    return this.isDevelopment;
  }

  // Manually set log level (useful for testing)
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}

// Export default instance
export const logger = Logger.getInstance();