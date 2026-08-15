/**
 * Typed error hierarchy. Every error thrown by devman extends {@link DevmanError}
 * and carries a stable, machine-readable `code` plus an optional user-facing
 * `hint`. This lets the CLI render human-friendly messages without string
 * matching and lets IPC serialise errors losslessly.
 */

/** Stable, machine-readable error codes. */
export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'SERVICE_NOT_FOUND'
  | 'DEPENDENCY_CYCLE'
  | 'DEPENDENCY_MISSING'
  | 'DAEMON_NOT_RUNNING'
  | 'DAEMON_ALREADY_RUNNING'
  | 'IPC_ERROR'
  | 'IPC_TIMEOUT'
  | 'PROCESS_START_FAILED'
  | 'INTERNAL';

/** Base class for all devman errors. */
export class DevmanError extends Error {
  readonly code: ErrorCode;
  /** Optional actionable suggestion shown to the user. */
  readonly hint: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { hint?: string; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.hint = options?.hint;
  }
}

/** Configuration file could not be located. */
export class ConfigNotFoundError extends DevmanError {
  constructor(path: string) {
    super('CONFIG_NOT_FOUND', `Configuration file not found: ${path}`, {
      hint: 'Create it or pass --config <path>. See config/services.example.json.',
    });
  }
}

/** Configuration failed validation. */
export class ConfigInvalidError extends DevmanError {
  constructor(message: string, cause?: unknown) {
    super('CONFIG_INVALID', message, {
      hint: 'Fix the configuration and try again.',
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

/** A referenced service does not exist. */
export class ServiceNotFoundError extends DevmanError {
  constructor(id: string) {
    super('SERVICE_NOT_FOUND', `Unknown service: "${id}".`, {
      hint: 'Run `devman status` to list configured services.',
    });
  }
}

/** The service dependency graph contains a cycle. */
export class DependencyCycleError extends DevmanError {
  constructor(cycle: readonly string[]) {
    super(
      'DEPENDENCY_CYCLE',
      `Dependency cycle detected: ${cycle.join(' → ')}.`,
      { hint: 'Break the cycle in your `dependsOn` declarations.' },
    );
  }
}

/** A service depends on an id that is not defined. */
export class DependencyMissingError extends DevmanError {
  constructor(serviceId: string, missingId: string) {
    super(
      'DEPENDENCY_MISSING',
      `Service "${serviceId}" depends on unknown service "${missingId}".`,
      { hint: 'Add the missing service or correct the `dependsOn` entry.' },
    );
  }
}

/** The daemon is not running but the operation requires it. */
export class DaemonNotRunningError extends DevmanError {
  constructor() {
    super('DAEMON_NOT_RUNNING', 'The devman daemon is not running.', {
      hint: 'Start it with `devman start`.',
    });
  }
}

/** Narrow an unknown value to an `Error` message string. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/** Wrap an unknown thrown value as a {@link DevmanError}. */
export function toDevmanError(error: unknown): DevmanError {
  if (error instanceof DevmanError) return error;
  return new DevmanError('INTERNAL', toErrorMessage(error), {
    ...(error !== undefined ? { cause: error } : {}),
  });
}
