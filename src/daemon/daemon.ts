/**
 * The devman daemon.
 *
 * The daemon is the single owner of runtime state and (from Phase 3) of every
 * managed child process. It hosts the IPC server and translates requests into
 * actions. This class wires the collaborators together and manages its own
 * lifecycle (acquire pid → listen → serve → graceful shutdown); the heavy
 * lifting lives in the injected {@link IpcServer}, {@link RuntimeStateStore}
 * and (later) the process manager.
 */
import { IpcServer } from '../ipc/server.js';
import { SocketServerTransport } from '../ipc/socketTransport.js';
import { RuntimeStateStore } from '../runtime/state.js';
import { EventBus } from '../runtime/events.js';
import { ProcessManager } from '../process/processManager.js';
import { acquirePidFile, releasePidFile } from './pidfile.js';
import { registerLifecycleHandlers } from './handlers.js';
import { now } from '../utils/time.js';
import type { Logger } from '../logging/logger.js';
import type { DevmanConfig } from '../config/loader.js';
import type { DevmanPaths } from '../config/paths.js';
import type { PingResult, StatusResult } from '../ipc/protocol.js';

/** Semantic version reported over IPC. Kept in sync with package.json. */
export const DAEMON_VERSION = '0.1.0';

/** Collaborators the daemon needs. Injected for testability. */
export interface DaemonDependencies {
  readonly paths: DevmanPaths;
  readonly config: DevmanConfig;
  readonly logger: Logger;
}

/**
 * Long-lived daemon process. Construct with {@link DaemonDependencies}, then
 * {@link start}. Call {@link shutdown} (or send SIGINT/SIGTERM) to stop.
 */
export class Daemon {
  private readonly logger: Logger;
  private readonly events = new EventBus();
  private readonly ipc: IpcServer;
  private readonly state: RuntimeStateStore;
  private readonly processes: ProcessManager;
  private shuttingDown = false;
  private readonly stopped: Promise<void>;
  private resolveStopped: () => void = () => {};

  constructor(private readonly deps: DaemonDependencies) {
    this.stopped = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });
    this.logger = deps.logger.child('daemon');
    const startedAt = now();
    this.state = RuntimeStateStore.create({
      stateFile: deps.paths.stateFile,
      daemonPid: process.pid,
      daemonStartedAt: startedAt,
      socketPath: deps.paths.socketPath,
      serviceIds: deps.config.services.map((s) => s.id),
    });
    this.processes = new ProcessManager({
      paths: deps.paths,
      config: deps.config,
      state: this.state,
      events: this.events,
      logger: this.logger,
    });
    this.ipc = new IpcServer(
      new SocketServerTransport(deps.paths.socketPath),
      this.logger,
    );
    this.registerHandlers();
    // Stop all child processes before IPC is torn down on shutdown.
    this.onBeforeShutdown(() => this.processes.stopAll());
  }

  /** The runtime-state store owned by this daemon. */
  get runtimeState(): RuntimeStateStore {
    return this.state;
  }

  /** The event bus owned by this daemon. */
  get eventBus(): EventBus {
    return this.events;
  }

  /** The process manager owned by this daemon. */
  get processManager(): ProcessManager {
    return this.processes;
  }

  /**
   * Start the daemon: claim the pid file, persist initial state, install signal
   * handlers, and begin serving IPC. Resolves once listening.
   */
  async start(): Promise<void> {
    await acquirePidFile(this.deps.paths.pidFile);
    await this.state.flush();
    this.installSignalHandlers();
    await this.ipc.start();
    this.logger.info('Daemon started', {
      pid: process.pid,
      services: this.deps.config.services.length,
    });
  }

  /** Resolves when the daemon has fully shut down. */
  waitUntilStopped(): Promise<void> {
    return this.stopped;
  }

  /**
   * Gracefully shut down: stop accepting IPC, release the pid file, and resolve
   * {@link waitUntilStopped}. Idempotent. Child-process teardown is added by the
   * process manager in Phase 3 via {@link onBeforeShutdown}.
   */
  async shutdown(reason = 'requested'): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.logger.info('Daemon shutting down', { reason });

    for (const hook of this.beforeShutdownHooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.warn('Shutdown hook failed', {
          error: (error as Error).message,
        });
      }
    }

    await this.ipc.stop();
    this.events.clear();
    await releasePidFile(this.deps.paths.pidFile);
    this.logger.info('Daemon stopped');
    this.resolveStopped();
  }

  private readonly beforeShutdownHooks: Array<() => Promise<void> | void> = [];

  /**
   * Register a hook run during {@link shutdown}, before IPC is torn down. The
   * process manager uses this to stop child processes gracefully.
   */
  onBeforeShutdown(hook: () => Promise<void> | void): void {
    this.beforeShutdownHooks.push(hook);
  }

  private registerHandlers(): void {
    this.ipc.handle('ping', async (): Promise<PingResult> => {
      return { pong: true, daemonPid: process.pid, version: DAEMON_VERSION };
    });

    this.ipc.handle('status', async (): Promise<StatusResult> => {
      return { state: this.state.snapshot() };
    });

    this.ipc.handle('shutdown', async (): Promise<{ stopping: true }> => {
      // Defer so the response is flushed before the socket closes.
      queueMicrotask(() => void this.shutdown('ipc'));
      return { stopping: true };
    });

    registerLifecycleHandlers(this.ipc, {
      processes: this.processes,
      events: this.events,
      paths: this.deps.paths,
    });
  }

  private installSignalHandlers(): void {
    const onSignal = (signal: NodeJS.Signals): void => {
      this.logger.info('Received signal', { signal });
      void this.shutdown(signal);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
}
