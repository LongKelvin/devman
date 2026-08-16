/**
 * Daemon bootstrap: spawn the daemon as a detached background process and wait
 * until it is reachable over IPC.
 *
 * This lives on the CLI side of the boundary — the CLI never owns child
 * processes itself, but it may *launch* the daemon, which then owns everything.
 * Spawning is detached with `unref()` so the CLI can exit while the daemon keeps
 * running, exactly like `pm2` or a systemd user service.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import { delay } from '../utils/time.js';
import { DevmanError } from '../utils/errors.js';
import { readLiveDaemonPid } from './pidfile.js';
import { SocketClientTransport } from '../ipc/socketTransport.js';
import { IpcClient } from '../ipc/client.js';
import type { PingResult, StatusResult } from '../ipc/protocol.js';
import type { DevmanPaths } from '../config/paths.js';
import type { RuntimeState } from '../types/index.js';
import type { Logger } from '../logging/logger.js';

/** Absolute path to the compiled daemon entry point. */
function daemonEntryPath(): string {
  return fileURLToPath(new URL('./index.js', import.meta.url));
}

/**
 * Attempt a single `ping`, returning the result or `null` if unreachable.
 * Only needs `socketPath` — accepting the narrower shape lets callers that
 * only have a bare socket path (e.g. a registry entry for some other
 * `--home`, see `devman list`) reuse this without a full {@link DevmanPaths}.
 */
export async function pingDaemon(
  paths: Pick<DevmanPaths, 'socketPath'>,
): Promise<PingResult | null> {
  let client: IpcClient | undefined;
  try {
    client = await IpcClient.connect(
      new SocketClientTransport(paths.socketPath),
    );
    return await client.call<PingResult>('ping', {}, { timeoutMs: 2000 });
  } catch {
    return null;
  } finally {
    client?.close();
  }
}

/**
 * Fetch a daemon's runtime state given only its socket path, or `null` if
 * unreachable. Used by `devman list` to summarise every registered instance
 * without needing each one's `--home`/config on disk.
 */
export async function fetchStatus(
  socketPath: string,
): Promise<RuntimeState | null> {
  let client: IpcClient | undefined;
  try {
    client = await IpcClient.connect(new SocketClientTransport(socketPath));
    const result = await client.call<StatusResult>(
      'status',
      {},
      { timeoutMs: 2000 },
    );
    return result.state;
  } catch {
    return null;
  } finally {
    client?.close();
  }
}

/** Options controlling how long bootstrap waits for readiness. */
export interface BootstrapOptions {
  /** Total time to wait for the daemon to become reachable. */
  readonly readyTimeoutMs?: number;
  /** Poll interval while waiting. */
  readonly pollIntervalMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

/**
 * Ensure a daemon is running and reachable, spawning one if necessary. Returns
 * the daemon's {@link PingResult}. Idempotent: if a healthy daemon already
 * exists it is reused.
 */
export async function ensureDaemon(
  paths: DevmanPaths,
  logger: Logger,
  options: BootstrapOptions = {},
): Promise<PingResult> {
  const existing = await pingDaemon(paths);
  if (existing) {
    logger.debug('Reusing running daemon', { pid: existing.daemonPid });
    return existing;
  }

  await spawnDaemon(paths, logger);
  return waitForDaemon(paths, options);
}

/** Spawn the daemon detached, with stdio redirected to a log file. */
async function spawnDaemon(paths: DevmanPaths, logger: Logger): Promise<void> {
  await ensureDir(paths.logsDir);
  await ensureDir(paths.runtimeDir);
  const logFd = openSync(join(paths.logsDir, 'daemon.log'), 'a');

  const child = spawn(process.execPath, [daemonEntryPath()], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      DEVMAN_HOME: paths.home,
      DEVMAN_CONFIG_DIR: paths.configDir,
      DEVMAN_LOGS_DIR: paths.logsDir,
      DEVMAN_RUNTIME_DIR: paths.runtimeDir,
    },
  });
  child.unref();
  logger.debug('Spawned daemon process', { pid: child.pid });
}

/** Poll until the daemon answers `ping` or the timeout elapses. */
async function waitForDaemon(
  paths: DevmanPaths,
  options: BootstrapOptions,
): Promise<PingResult> {
  const timeout = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = performance.now() + timeout;

  while (performance.now() < deadline) {
    const result = await pingDaemon(paths);
    if (result) return result;
    await delay(interval);
  }

  // One last check of the pid file gives a more precise error message.
  const pid = await readLiveDaemonPid(paths.pidFile);
  throw new DevmanError(
    'DAEMON_NOT_RUNNING',
    pid === null
      ? `Daemon exited during startup within ${timeout}ms.`
      : `Daemon (pid ${pid}) did not become reachable within ${timeout}ms.`,
    { hint: `Check ${join(paths.logsDir, 'daemon.log')} for startup errors.` },
  );
}
