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

/** Rename error codes that are worth a short retry — usually a transient
 * handle held by an antivirus scanner, search indexer, or a concurrent
 * reader, not a real permissions problem. Overwhelmingly a Windows quirk:
 * POSIX `rename(2)` is atomic and doesn't fail this way. */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY']);

const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 20;

/**
 * Write JSON atomically: serialise to a temp file in the same directory, then
 * rename over the target. Rename is atomic on POSIX filesystems, so readers
 * never observe a half-written file.
 *
 * Callers must not invoke this concurrently for the same `path` — pair it
 * with a per-path write queue (see `RuntimeStateStore.persist`) so renames
 * onto the same destination never race each other.
 */
export async function writeJsonFileAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureDir(dirname(path));
  // A per-call unique suffix prevents concurrent writers in the same process
  // from colliding on one temp file (which would race on rename).
  const tmp = `${path}.${process.pid}.${nextTmpSeq()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await renameWithRetry(tmp, path);
}

/**
 * `rename` with a short retry-with-backoff on transient failures. Windows can
 * throw `EPERM`/`EBUSY` when the destination is momentarily held open by
 * another process (antivirus, search indexing) even when callers are
 * otherwise serialised — a real permissions error will still fail after the
 * retries are exhausted.
 */
async function renameWithRetry(tmp: string, dest: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tmp, dest);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= RENAME_RETRIES ||
        !code ||
        !TRANSIENT_RENAME_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RENAME_RETRY_DELAY_MS * attempt),
      );
    }
  }
}

let tmpSeq = 0;
/** Monotonic counter making temp-file names unique within a process. */
function nextTmpSeq(): number {
  tmpSeq = (tmpSeq + 1) % Number.MAX_SAFE_INTEGER;
  return tmpSeq;
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
