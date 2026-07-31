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
import { now } from '../utils/time.js';
import type { EventBus } from '../runtime/events.js';
import type { Logger } from '../logging/logger.js';
import type { RuntimeStateStore } from '../runtime/state.js';
import type { DevmanPaths } from '../config/paths.js';
import type { HealthStatus, ServiceDefinition } from '../types/index.js';
import type { LogStreamName } from '../logging/serviceLogger.js';

/** How long a service is given to exit gracefully before SIGKILL. */
const DEFAULT_STOP_GRACE_MS = 5000;

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
    const process = this.process;
    if (!process) return;

    await this.transition('stopping');
    await process.stop(this.deps.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
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
      onExit: (info) => void this.onExit(info),
    });
    this.process = proc;

    const pid = proc.start();
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
      (health) => void this.onHealthChanged(health),
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
      this.restartTimer = setTimeout(resolve, delayMs);
    });
    this.restartTimer = undefined;
    // A stop may have been requested during the delay.
    if (this.stopRequested) return;
    await this.spawn();
  }

  /** Update only the status field in runtime state. */
  private async transition(status: 'starting' | 'stopping'): Promise<void> {
    await this.deps.state.updateService(this.service.id, { status }, now());
  }
}
