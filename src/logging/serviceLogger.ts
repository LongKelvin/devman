/**
 * Per-service log capture.
 *
 * Each service's stdout/stderr is written to `logs/<id>.log` as timestamped,
 * stream-tagged lines. {@link ServiceLogWriter} owns one append stream per
 * service; {@link readLogTail} reads the last N lines for `--log` without
 * following. The line format is deliberately simple and greppable, and the
 * writer is structured so a future rotation policy can wrap {@link openStream}
 * without touching callers.
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { ensureDir } from '../utils/fs.js';
import { now } from '../utils/time.js';
import type { DevmanPaths } from '../config/paths.js';

/** Which standard stream a line came from. */
export type LogStreamName = 'stdout' | 'stderr';

/** Absolute path to a service's log file. */
export function logFilePath(paths: DevmanPaths, serviceId: string): string {
  return join(paths.logsDir, `${serviceId}.log`);
}

/** Format a single log line: ISO timestamp, stream tag, then the text. */
export function formatLogLine(
  stream: LogStreamName,
  line: string,
  timestamp: number,
): string {
  const tag = stream === 'stderr' ? 'ERR' : 'OUT';
  return `${new Date(timestamp).toISOString()} ${tag} ${line}`;
}

/**
 * Appends a single service's output to its log file. One writer per service for
 * the daemon's lifetime; call {@link close} on teardown.
 */
export class ServiceLogWriter {
  private stream: WriteStream | undefined;

  constructor(
    private readonly filePath: string,
    private readonly clock: () => number = now,
  ) {}

  /** Ensure the log directory exists and open the append stream. */
  async open(): Promise<void> {
    if (this.stream) return;
    await ensureDir(dirname(this.filePath));
    this.stream = this.openStream();
  }

  /** Overridable hook so a rotation policy can swap the stream later. */
  protected openStream(): WriteStream {
    return createWriteStream(this.filePath, { flags: 'a' });
  }

  /**
   * Write one captured line. Returns the timestamp used, so the caller can emit
   * a matching {@link LogReceived} event without a second clock read.
   */
  write(stream: LogStreamName, line: string): number {
    const timestamp = this.clock();
    this.stream?.write(`${formatLogLine(stream, line, timestamp)}\n`);
    return timestamp;
  }

  /** Flush and close the underlying stream. */
  async close(): Promise<void> {
    const stream = this.stream;
    if (!stream) return;
    this.stream = undefined;
    await new Promise<void>((resolve) => stream.end(resolve));
  }
}

/**
 * Read the last `maxLines` lines of a log file. Returns `[]` if the file does
 * not exist yet. Reads line-by-line to avoid loading huge files into memory.
 */
export async function readLogTail(
  filePath: string,
  maxLines: number,
): Promise<string[]> {
  const lines: string[] = [];
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return lines;
}
