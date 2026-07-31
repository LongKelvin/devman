/**
 * Domain types describing services and how they are configured.
 *
 * These types are the shared vocabulary for configuration, the process
 * manager, runtime state and IPC. They intentionally contain no behaviour so
 * they can be imported freely without creating coupling.
 */

/**
 * Restart policy for a service. Mirrors the vocabulary used by process
 * supervisors such as systemd and PM2.
 *
 * - `no`: never restart automatically.
 * - `on-failure`: restart only when the process exits with a non-zero code
 *   (or is killed by a signal) and was not stopped by the user.
 * - `always`: restart whenever the process exits, regardless of exit code.
 */
export type RestartPolicy = 'no' | 'on-failure' | 'always';

/** Restart configuration for a service. */
export interface RestartConfig {
  /** When the supervisor should attempt to restart the service. */
  readonly policy: RestartPolicy;
  /** Maximum number of automatic restarts before giving up. */
  readonly maxRetries: number;
  /** Delay, in milliseconds, before attempting a restart. */
  readonly delayMs: number;
}

/**
 * Health check definition. Only the process-liveness strategy is implemented
 * today; the shape leaves room for HTTP/TCP probes without a breaking change.
 */
export interface HealthCheckConfig {
  /** Strategy used to determine service health. */
  readonly type: 'process' | 'http' | 'tcp';
  /** URL to probe for the `http` strategy. */
  readonly url?: string;
  /** Port to probe for the `tcp` strategy. */
  readonly port?: number;
  /** How often to run the probe, in milliseconds. */
  readonly intervalMs?: number;
  /** How long a single probe may take before it is considered failed. */
  readonly timeoutMs?: number;
}

/**
 * A single managed service, as declared in `services.json`.
 */
export interface ServiceDefinition {
  /** Stable, unique identifier used by the CLI and runtime state. */
  readonly id: string;
  /** Human-friendly display name. */
  readonly name: string;
  /** Working directory the command runs in. Resolved relative to the config base. */
  readonly cwd: string;
  /** Executable to run. */
  readonly command: string;
  /** Arguments passed to the command. */
  readonly args: readonly string[];
  /** Whether the service participates in `start`/`stop` by default. */
  readonly enabled: boolean;
  /** IDs of services that must be running before this one starts. */
  readonly dependsOn: readonly string[];
  /** Extra environment variables merged over the daemon environment. */
  readonly env: Readonly<Record<string, string>>;
  /** Restart policy. */
  readonly restart: RestartConfig;
  /** Optional health check. */
  readonly healthCheck?: HealthCheckConfig;
}

/**
 * A named group of service IDs, as declared in `profiles.json`.
 */
export interface ProfileDefinition {
  /** Profile identifier, e.g. `backend`, `frontend`, `full`. */
  readonly id: string;
  /** Service IDs included in the profile. */
  readonly services: readonly string[];
}
