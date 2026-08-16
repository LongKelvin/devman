/**
 * Supervises the lifecycle of a single service: spawning it, capturing its
 * logs, updating runtime state, and applying the restart policy on exit.
 *
 * One supervisor per service. It owns a {@link ManagedProcess} (recreated on
 * each run), a {@link ServiceLogWriter}, and the transitions through
 * {@link ServiceStatus}. Cross-service concerns (ordering, health) live in
 * {@link ProcessManager}; a supervisor only knows about its own service.
 */
import { ManagedProcess, type ExitInfo } from './managedProcess.js';
import { ServiceLogWriter, logFilePath } from '../logging/serviceLogger.js';
import { HealthChecker } from '../service/healthChecker.js';
import { delay, now } from '../utils/time.js';
import type { EventBus } from '../runtime/events.js';
import type { Logger } from '../logging/logger.js';
import type { RuntimeStateStore } from '../runtime/state.js';
import type { DevmanPaths } from '../config/paths.js';
import type { HealthStatus, ServiceDefinition } from '../types/index.js';
import type { LogStreamName } from '../logging/serviceLogger.js';

/** How long a service is given to exit gracefully before SIGKILL. */
const DEFAULT_STOP_GRACE_MS = 5000;

/**
 * How long to wait after spawning before trusting a service is actually
 * running. A command that fails to spawn (bad executable, missing cwd) fails
 * asynchronously — without this window, `start` would report success and a
 * live-looking pid for a process that was already dead.
 */
const SPAWN_SETTLE_MS = 150;

/** Collaborators a supervisor needs. */
export interface SupervisorDependencies {
  readonly paths: DevmanPaths;
  readonly state: RuntimeStateStore;
  readonly events: EventBus;
  readonly logger: Logger;
  /** Grace period before force-kill on stop. */
  readonly stopGraceMs?: number;
}

/** Supervises one service. */
export class ServiceSupervisor {
  private readonly logWriter: ServiceLogWriter;
  private readonly logger: Logger;
  private process: ManagedProcess | undefined;
  private health: HealthChecker | undefined;
  private restartCount = 0;
  /** True while a user-requested stop is in progress (suppresses restart). */
  private stopRequested = false;
  /** Guards against overlapping restart timers. */
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Resolves the in-flight restart backoff wait. Cleared alongside
   * `restartTimer`; `stop()` calls it directly so cancelling the timer
   * doesn't leave `maybeRestart` — and therefore `exitHandled` — awaiting a
   * promise that will now never settle on its own.
   */
  private restartResolve: (() => void) | undefined;
  /**
   * Resolves when the in-flight exit handler (state persistence + restart
   * decision) has finished. `stop()` awaits this so callers can rely on runtime
   * state being fully settled once stop resolves.
   */
  private exitHandled: Promise<void> = Promise.resolve();

  constructor(
    private readonly service: ServiceDefinition,
    private readonly deps: SupervisorDependencies,
  ) {
    this.logger = deps.logger.child(`svc:${service.id}`);
    this.logWriter = new ServiceLogWriter(logFilePath(deps.paths, service.id));
  }

  /** The service id this supervisor manages. */
  get id(): string {
    return this.service.id;
  }

  /** Whether the service process is currently running. */
  get running(): boolean {
    return this.process?.running ?? false;
  }

  /**
   * Start the service. Idempotent: a no-op if already running. Resolves once
   * the process has been spawned (not when it becomes healthy).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.stopRequested = false;
    this.restartCount = 0;
    await this.spawn();
  }

  /**
   * Stop the service and suppress automatic restarts. Idempotent.
   */
  async stop(): Promise<void> {
    this.stopRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    if (this.restartResolve) {
      // Unblock maybeRestart's backoff wait immediately; it checks
      // stopRequested right after and bails without respawning.
      const resolve = this.restartResolve;
      this.restartResolve = undefined;
      resolve();
    }
    const process = this.process;
    if (!process) {
      // Nothing running, but an exit handler may still be settling state.
      await this.exitHandled;
      return;
    }

    await this.transition('stopping');
    await process.stop(this.deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
    // Wait for onExit to persist the terminal state before returning.
    await this.exitHandled;
  }

  /** Restart: stop if running, then start fresh. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Flush and close the log writer. Called during daemon shutdown. */
  async dispose(): Promise<void> {
    await this.logWriter.close();
  }

  /** Spawn a fresh process and wire its handlers. */
  private async spawn(): Promise<void> {
    await this.logWriter.open();
    await this.transition('starting');

    const proc = new ManagedProcess(this.service, this.deps.paths.home, {
      onLine: (stream, line) => this.onLine(stream, line),
      onExit: (info) => {
        // Track the exit handler so stop() can await state settlement.
        this.exitHandled = this.onExit(info);
      },
    });
    this.process = proc;

    const pid = proc.start();

    // Give the OS a brief window to report an immediate spawn failure (a
    // missing executable, a missing cwd) before declaring the service
    // "running". A crash inside this window is handled entirely by the
    // onExit callback above — including recording the terminal state and
    // deciding whether to restart — so we only need to check whether the
    // process is *still* alive once the window has passed.
    await delay(SPAWN_SETTLE_MS);
    if (!this.running) {
      // Already exited — onExit already recorded the correct terminal state
      // (and possibly started a restart). Don't clobber it with a stale
      // "running" write.
      this.logger.warn('Service exited before startup could be confirmed', {
        pid,
      });
      return;
    }

    const at = now();
    await this.deps.state.updateService(
      this.service.id,
      {
        status: 'running',
        pid,
        startedAt: at,
        exitCode: null,
        exitSignal: null,
      },
      at,
    );
    this.deps.events.emit('ServiceStarted', {
      serviceId: this.service.id,
      pid,
      at,
    });
    this.logger.info('Service started', { pid });
    this.startHealthChecks();
  }

  /** Begin health monitoring for the current run, if configured. */
  private startHealthChecks(): void {
    if (!this.service.healthCheck) return;
    this.health = new HealthChecker(
      this.service.healthCheck,
      { isProcessRunning: () => this.running },
      (health) => {
        // Fire-and-forget from the health checker's perspective, but a
        // rejection here must never become an unhandled rejection — that
        // would crash the whole daemon (and every other supervised service)
        // over a transient state-persist error. Log and move on; the next
        // health change or state update will retry the write.
        this.onHealthChanged(health).catch((error: unknown) => {
          this.logger.error('Failed to persist health change', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    );
    this.health.start();
  }

  /** Persist a health transition and emit the corresponding event. */
  private async onHealthChanged(health: HealthStatus): Promise<void> {
    const at = now();
    await this.deps.state.updateService(this.service.id, { health }, at);
    this.deps.events.emit('HealthChanged', {
      serviceId: this.service.id,
      health,
      at,
    });
    this.logger.debug('Health changed', { health });
  }

  /** Stop and clear the health checker, if any. */
  private stopHealthChecks(): void {
    this.health?.stop();
    this.health = undefined;
  }

  /** Handle a captured output line: persist to the log file and emit an event. */
  private onLine(stream: LogStreamName, line: string): void {
    const at = this.logWriter.write(stream, line);
    this.deps.events.emit('LogReceived', {
      serviceId: this.service.id,
      stream,
      line,
      at,
    });
  }

  /** Handle process exit: update state, then apply restart policy. */
  private async onExit(info: ExitInfo): Promise<void> {
    this.process = undefined;
    this.stopHealthChecks();
    const at = now();
    const expected = this.stopRequested;
    const crashed = !expected && !(info.code === 0 && info.signal === null);

    await this.deps.state.updateService(
      this.service.id,
      {
        status: crashed ? 'failed' : 'stopped',
        pid: null,
        exitCode: info.code,
        exitSignal: info.signal,
      },
      at,
    );

    if (expected) {
      this.deps.events.emit('ServiceStopped', {
        serviceId: this.service.id,
        exitCode: info.code,
        signal: info.signal,
        at,
        expected: true,
      });
      this.logger.info('Service stopped', { code: info.code });
      return;
    }

    if (crashed) {
      this.deps.events.emit('ServiceFailed', {
        serviceId: this.service.id,
        exitCode: info.code,
        signal: info.signal,
        at,
      });
      this.logger.warn('Service exited unexpectedly', {
        code: info.code,
        signal: info.signal,
      });
    } else {
      this.deps.events.emit('ServiceStopped', {
        serviceId: this.service.id,
        exitCode: info.code,
        signal: info.signal,
        at,
        expected: false,
      });
      this.logger.info('Service completed', { code: info.code });
    }

    await this.maybeRestart(crashed);
  }

  /** Apply the restart policy after an unexpected exit. */
  private async maybeRestart(crashed: boolean): Promise<void> {
    const { policy, maxRetries, delayMs } = this.service.restart;
    const shouldRestart =
      policy === 'always' || (policy === 'on-failure' && crashed);
    if (!shouldRestart) return;

    if (this.restartCount >= maxRetries) {
      this.logger.error('Restart limit reached; giving up', {
        maxRetries,
      });
      return;
    }

    this.restartCount += 1;
    const attempt = this.restartCount;
    this.deps.events.emit('ServiceRestarting', {
      serviceId: this.service.id,
      attempt,
      at: now(),
    });
    this.logger.info('Restarting service', { attempt, delayMs });

    await this.deps.state.updateService(
      this.service.id,
      { restartCount: attempt },
      now(),
    );

    await new Promise<void>((resolve) => {
      this.restartResolve = resolve;
      this.restartTimer = setTimeout(() => {
        this.restartResolve = undefined;
        resolve();
      }, delayMs);
    });
    this.restartTimer = undefined;
    // A stop may have been requested during the delay (in which case
    // stop() already resolved this promise directly).
    if (this.stopRequested) return;
    await this.spawn();
  }

  /** Update only the status field in runtime state. */
  private async transition(status: 'starting' | 'stopping'): Promise<void> {
    await this.deps.state.updateService(this.service.id, { status }, now());
  }
}
