/**
 * PID-file management for the daemon.
 *
 * The PID file records the running daemon's process id so a second invocation
 * can detect an existing daemon (and so the CLI can find one). We guard against
 * stale files left by a crash by checking whether the recorded process is
 * actually alive.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureDir, pathExists } from '../utils/fs.js';
import { DevmanError } from '../utils/errors.js';

/** Return whether a process with `pid` is currently alive. */
export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs error checking without sending a signal.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process. EPERM: exists but not ours — still "alive".
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read the pid recorded in `pidFile`, or `null` if absent/unreadable. */
export async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = await readFile(pidFile, 'utf8');
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Return the pid of a live daemon recorded in `pidFile`, or `null`. A recorded
 * pid whose process is dead is treated as stale and reported as `null`.
 */
export async function readLiveDaemonPid(
  pidFile: string,
): Promise<number | null> {
  const pid = await readPid(pidFile);
  if (pid === null) return null;
  return isProcessAlive(pid) ? pid : null;
}

/**
 * Write the current process id to `pidFile`, refusing if a live daemon is
 * already recorded. A stale pid file is silently reclaimed.
 */
export async function acquirePidFile(pidFile: string): Promise<void> {
  const existing = await readLiveDaemonPid(pidFile);
  if (existing !== null) {
    throw new DevmanError(
      'DAEMON_ALREADY_RUNNING',
      `A devman daemon is already running (pid ${existing}).`,
      { hint: 'Stop it with `devman stop` before starting a new one.' },
    );
  }
  await ensureDir(dirname(pidFile));
  await writeFile(pidFile, `${process.pid}\n`, 'utf8');
}

/** Remove the pid file, ignoring a missing file. */
export async function releasePidFile(pidFile: string): Promise<void> {
  if (await pathExists(pidFile)) {
    await rm(pidFile, { force: true });
  }
}
