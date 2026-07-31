/**
 * Small filesystem helpers shared across modules. Kept dependency-free and
 * async so callers never block the event loop.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Ensure a directory exists, creating parents as needed. Idempotent. */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Read and parse a JSON file as type `T`. Throws on missing file or bad JSON. */
export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

/**
 * Write JSON atomically: serialise to a temp file in the same directory, then
 * rename over the target. Rename is atomic on POSIX filesystems, so readers
 * never observe a half-written file.
 */
export async function writeJsonFileAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

/** Return whether a filesystem path exists. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    await access(path);
    return true;
  } catch {
    return false;
  }
}
