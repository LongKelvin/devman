/**
 * Runtime state types. These describe the *observed* state of services and the
 * daemon, as opposed to their *declared* configuration.
 */

/**
 * Lifecycle states a service moves through.
 *
 * ```text
 * Configured → Starting → Running → Stopping → Stopped
 *                              └──────────────→ Failed (unexpected exit)
 * ```
 */
export type ServiceStatus =
  | 'configured'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

/** Health as reported by the health checker. */
export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy';

/**
 * Runtime metadata for a single service. Persisted so the CLI can report state
 * without holding any child processes itself.
 */
export interface ServiceRuntime {
  /** Service identifier, matching {@link ServiceDefinition.id}. */
  readonly id: string;
  /** Current lifecycle status. */
  readonly status: ServiceStatus;
  /** OS process ID while running, otherwise `null`. */
  readonly pid: number | null;
  /** Epoch milliseconds of the most recent start, otherwise `null`. */
  readonly startedAt: number | null;
  /** Exit code of the last run, otherwise `null`. */
  readonly exitCode: number | null;
  /** Signal that terminated the last run, otherwise `null`. */
  readonly exitSignal: string | null;
  /** Number of automatic restarts performed for the current supervision. */
  readonly restartCount: number;
  /** Latest known health. */
  readonly health: HealthStatus;
  /** Epoch milliseconds this runtime record was last updated. */
  readonly updatedAt: number;
}

/**
 * Top-level runtime document persisted by the daemon.
 */
export interface RuntimeState {
  /** Schema version to allow forward-compatible migrations. */
  readonly version: number;
  /** Daemon process ID. */
  readonly daemonPid: number;
  /** Epoch milliseconds the daemon started. */
  readonly daemonStartedAt: number;
  /** Absolute path to the IPC socket the daemon is listening on. */
  readonly socketPath: string;
  /** Runtime record per service, keyed by service ID. */
  readonly services: Readonly<Record<string, ServiceRuntime>>;
}
