import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquirePidFile,
  isProcessAlive,
  readLiveDaemonPid,
  releasePidFile,
} from '../../src/daemon/pidfile.js';
import { DevmanError } from '../../src/utils/errors.js';

let dir: string;
let pidFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-pid-'));
  pidFile = join(dir, 'daemon.pid');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('isProcessAlive', () => {
  it('reports the current process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('reports an unused pid as dead', () => {
    // 2^31 - 1 is not a realistic live pid.
    expect(isProcessAlive(2147483647)).toBe(false);
  });
});

describe('pid file lifecycle', () => {
  it('acquires then releases', async () => {
    await acquirePidFile(pidFile);
    expect(await readFile(pidFile, 'utf8')).toContain(String(process.pid));
    expect(await readLiveDaemonPid(pidFile)).toBe(process.pid);
    await releasePidFile(pidFile);
    expect(await readLiveDaemonPid(pidFile)).toBeNull();
  });

  it('reclaims a stale pid file', async () => {
    await writeFile(pidFile, '2147483647\n', 'utf8');
    // Stale (dead) pid → treated as absent, so acquire succeeds.
    await expect(acquirePidFile(pidFile)).resolves.toBeUndefined();
    expect(await readLiveDaemonPid(pidFile)).toBe(process.pid);
  });

  it('refuses when a live daemon is recorded', async () => {
    await writeFile(pidFile, `${process.pid}\n`, 'utf8');
    await expect(acquirePidFile(pidFile)).rejects.toBeInstanceOf(DevmanError);
  });
});
