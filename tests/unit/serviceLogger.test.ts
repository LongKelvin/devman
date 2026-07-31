import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ServiceLogWriter,
  formatLogLine,
  readLogTail,
} from '../../src/logging/serviceLogger.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('formatLogLine', () => {
  it('tags stdout and stderr distinctly with an ISO timestamp', () => {
    const t = Date.parse('2026-01-01T00:00:00.000Z');
    expect(formatLogLine('stdout', 'hello', t)).toBe(
      '2026-01-01T00:00:00.000Z OUT hello',
    );
    expect(formatLogLine('stderr', 'oops', t)).toBe(
      '2026-01-01T00:00:00.000Z ERR oops',
    );
  });
});

describe('ServiceLogWriter + readLogTail', () => {
  it('appends lines and tails the last N', async () => {
    const file = join(dir, 'svc.log');
    const writer = new ServiceLogWriter(file);
    await writer.open();
    for (let i = 0; i < 5; i++) writer.write('stdout', `line-${i}`);
    await writer.close();

    const tail = await readLogTail(file, 3);
    expect(tail).toHaveLength(3);
    expect(tail[2]).toContain('line-4');
    expect(tail[0]).toContain('line-2');
  });

  it('returns an empty tail for a missing file', async () => {
    expect(await readLogTail(join(dir, 'nope.log'), 10)).toEqual([]);
  });
});
