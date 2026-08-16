import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `rename` is mocked at the module level (Node ESM builtins can't be
// spied on in place) so individual tests can make it fail transiently
// without touching the real filesystem semantics for everything else.
const renameMock = vi.fn();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: (...args: Parameters<typeof actual.rename>) =>
      renameMock(actual, ...args),
  };
});

const { writeJsonFileAtomic } = await import('../../src/utils/fs.js');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-fs-'));
  renameMock.mockReset();
  renameMock.mockImplementation((actual, ...args) => actual.rename(...args));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeJsonFileAtomic', () => {
  it('writes valid, newline-terminated JSON', async () => {
    const path = join(dir, 'out.json');
    await writeJsonFileAtomic(path, { a: 1 });
    const raw = await readFile(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual({ a: 1 });
  });

  it('retries a transient EPERM on rename and still succeeds', async () => {
    // Regression: Windows can throw EPERM/EBUSY on rename() when the
    // destination is momentarily held by another handle (antivirus, search
    // indexing). This used to surface as an immediate, fatal error.
    const path = join(dir, 'out.json');
    let calls = 0;
    renameMock.mockImplementation((actual, ...args) => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return actual.rename(...args);
    });

    await writeJsonFileAtomic(path, { ok: true });
    expect(calls).toBe(3);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ ok: true });
  });

  it('does not retry non-transient rename errors', async () => {
    const path = join(dir, 'out.json');
    let calls = 0;
    renameMock.mockImplementation(() => {
      calls += 1;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    await expect(writeJsonFileAtomic(path, { ok: true })).rejects.toThrow(
      'ENOENT',
    );
    expect(calls).toBe(1);
  });
});
