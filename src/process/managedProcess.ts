/**
 * A single supervised child process.
 *
 * {@link ManagedProcess} wraps one OS process for one service: it spawns the
 * command, streams stdout/stderr line-by-line to callbacks, and reports exit.
 * It deliberately knows nothing about restart policy, dependencies or runtime
 * state — that orchestration lives in {@link ProcessManager}. This keeps the
 * unit small and independently testable.
 */
import { execa, type Options, type ResultPromise } from 'execa';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { DevmanError } from '../utils/errors.js';
import type { LogStreamName } from '../logging/serviceLogger.js';
import type { ServiceDefinition } from '../types/index.js';

/** How a managed process ended. */
export interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

/** Callbacks a {@link ManagedProcess} invokes during its lifetime. */
export interface ManagedProcessHandlers {
  /** A complete line was read from stdout or stderr. */
  onLine(stream: LogStreamName, line: string): void;
  /** The process exited (for any reason). */
  onExit(info: ExitInfo): void;
}

/**
 * Spawns and observes one child process. Construct, then {@link start}; call
 * {@link stop} to terminate. Not reused across restarts — the manager creates a
 * fresh instance each time so state never leaks between runs.
 */
export class ManagedProcess {
  private child: ResultPromise | undefined;
  private stopping = false;

  constructor(
    private readonly service: ServiceDefinition,
    private readonly baseDir: string,
    private readonly handlers: ManagedProcessHandlers,
  ) {}

  /** Whether the process is currently running. */
  get running(): boolean {
    return this.child !== undefined;
  }

  /** OS process id while running, otherwise `undefined`. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /**
   * Spawn the child. Returns the OS pid. Throws
   * {@link DevmanError PROCESS_START_FAILED} if the spawn itself fails.
   */
  start(): number {
    if (this.child) return this.child.pid ?? -1;
    this.stopping = false;

    const cwd = resolve(this.baseDir, this.service.cwd);
    if (!existsSync(cwd)) {
      throw new DevmanError(
        'PROCESS_START_FAILED',
        `Working directory not found for "${this.service.id}": ${cwd}`,
        { hint: `Check the "cwd" setting for ${this.service.id} in services.json.` },
      );
    }
    const options: Options = {
      cwd,
      env: { ...process.env, ...this.service.env },
      // We handle exit ourselves; never throw on non-zero exit.
      reject: false,
      stdout: 'pipe',
      stderr: 'pipe',
      // Run the child as its own process-group leader (POSIX) so we can signal
      // the whole tree on stop — otherwise a shell's grandchildren (e.g. a
      // `sleep` under `sh -c`) can outlive it and hold the output pipe open.
      detached: process.platform !== 'win32',
    };
    let child: ResultPromise;
    try {
      child = execa(this.service.command, [...this.service.args], options);
    } catch (cause) {
      throw new DevmanError(
        'PROCESS_START_FAILED',
        `Failed to start "${this.service.id}": ${(cause as Error).message}`,
        {
          cause,
          hint: `Check the "command" and "cwd" for ${this.service.id}.`,
        },
      );
    }

    this.child = child;
    this.pipe(child.stdout, 'stdout');
    this.pipe(child.stderr, 'stderr');

    void child.then((result) => {
      this.child = undefined;
      this.handlers.onExit({
        code: typeof result.exitCode === 'number' ? result.exitCode : null,
        signal: result.signal ?? null,
      });
    });

    if (typeof child.pid !== 'number') {
      throw new DevmanError(
        'PROCESS_START_FAILED',
        `Process for "${this.service.id}" started without a pid.`,
      );
    }
    return child.pid;
  }

  /**
   * Request termination. Sends SIGTERM, then SIGKILL after `graceMs` if the
   * process has not exited. Resolves once the process is gone (or immediately
   * if it was not running).
   */
  async stop(graceMs: number): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;

    this.signal(child, 'SIGTERM');
    const timer = setTimeout(() => {
      if (this.child) this.signal(child, 'SIGKILL');
    }, graceMs);

    try {
      await child;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deliver a signal to the child. On POSIX the child leads its own process
   * group (see `detached` in {@link start}), so we signal the whole group via
   * the negative pid to reap grandchildren; if that fails (e.g. the group is
   * already gone) we fall back to signalling the child directly.
   */
  private signal(child: ResultPromise, signal: 'SIGTERM' | 'SIGKILL'): void {
    const pid = child.pid;
    if (process.platform !== 'win32' && typeof pid === 'number') {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // Group gone or not permitted — fall through to a direct kill.
      }
    }
    child.kill(signal);
  }

  /** Whether the last/most-recent stop was requested via {@link stop}. */
  get wasStopRequested(): boolean {
    return this.stopping;
  }

  /** Attach a line reader to a child stream. */
  private pipe(
    stream: NodeJS.ReadableStream | null,
    name: LogStreamName,
  ): void {
    if (!stream) return;
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line: string) => this.handlers.onLine(name, line));
  }
}
