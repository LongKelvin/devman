/**
 * Internal diagnostic logger for devman itself (the daemon and CLI), as
 * distinct from {@link ServiceLogger}, which captures the output of managed
 * services.
 *
 * The {@link Logger} interface is intentionally minimal so it can be injected
 * everywhere and swapped in tests. {@link ConsoleLogger} is the default sink.
 */

/** Severity levels in increasing order of importance. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Structured, injectable logger used across the daemon and CLI. */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /** Derive a child logger that prefixes messages with `scope`. */
  child(scope: string): Logger;
}

/** Where the {@link ConsoleLogger} writes its lines. */
export interface LogSink {
  write(line: string): void;
}

const CONSOLE_SINK: LogSink = {
  write(line: string): void {
    process.stderr.write(`${line}\n`);
  },
};

/**
 * Logger that writes single-line, timestamped records to a {@link LogSink}
 * (stderr by default, so it never pollutes machine-readable stdout).
 */
export class ConsoleLogger implements Logger {
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly scope: string | undefined = undefined,
    private readonly sink: LogSink = CONSOLE_SINK,
  ) {}

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;
    const time = new Date().toISOString();
    const scope = this.scope ? ` [${this.scope}]` : '';
    const suffix =
      meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    this.sink.write(
      `${time} ${level.toUpperCase().padEnd(5)}${scope} ${message}${suffix}`,
    );
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  child(scope: string): Logger {
    const nextScope = this.scope ? `${this.scope}:${scope}` : scope;
    return new ConsoleLogger(this.minLevel, nextScope, this.sink);
  }
}

/** Logger that discards everything. Useful for tests. */
export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

/** Parse a {@link LogLevel} from an environment string, with a fallback. */
export function parseLogLevel(
  value: string | undefined,
  fallback: LogLevel = 'info',
): LogLevel {
  if (value && value in LEVEL_WEIGHT) return value as LogLevel;
  return fallback;
}
