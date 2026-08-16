/**
 * Global instance registry: a small, best-effort index of every devman
 * daemon running on the machine, independent of which `--home` you're
 * currently standing in.
 *
 * Each `--home` is otherwise a fully isolated world (own config, logs,
 * runtime, socket) — which is correct for running many projects side by
 * side, but leaves no way to answer "what's running, and where" without
 * `cd`-ing into every project and running `doctor`. The registry exists
 * purely to answer that question for `devman list`; it is not consulted for
 * anything else and losing it is harmless — a running daemon just briefly
 * drops out of `list` until it next registers.
 *
 * Concurrency note: multiple daemons (different homes) may register/
 * deregister around the same time. Writes are read-modify-write with no
 * cross-process locking, so a very unlucky race can drop one entry. This
 * self-heals: `devman list` prunes dead pids on every read, and a daemon
 * that's still alive but missing from the file simply re-registers on its
 * next start.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from '../utils/fs.js';

/** One running daemon, as recorded in the registry. */
export interface RegistryEntry {
  /** The `--home` directory this daemon was started for. */
  readonly home: string;
  /** Daemon process id. */
  readonly pid: number;
  /** IPC socket/pipe path to reach it. */
  readonly socketPath: string;
  /** Epoch milliseconds the daemon started. */
  readonly startedAt: number;
  /** Daemon version, for display. */
  readonly version: string;
}

/** Resolve the registry file path. Overridable for tests via `env`. */
export function registryFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.DEVMAN_REGISTRY_FILE ?? join(homedir(), '.devman', 'registry.json')
  );
}

/** Read every registered entry. Tolerant of a missing or corrupt file. */
export async function readRegistry(path: string): Promise<RegistryEntry[]> {
  try {
    const entries = await readJsonFile<RegistryEntry[]>(path);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** Insert or replace the entry for `entry.home`. Best-effort. */
export async function upsertRegistryEntry(
  path: string,
  entry: RegistryEntry,
): Promise<void> {
  const entries = await readRegistry(path);
  const next = entries.filter((e) => e.home !== entry.home);
  next.push(entry);
  await writeJsonFileAtomic(path, next);
}

/** Remove the entry for `home`, if present. Best-effort. */
export async function removeRegistryEntry(
  path: string,
  home: string,
): Promise<void> {
  const entries = await readRegistry(path);
  const next = entries.filter((e) => e.home !== home);
  if (next.length === entries.length) return;
  await writeJsonFileAtomic(path, next);
}
