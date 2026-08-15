/**
 * Integration tests for the `start`/`restart` CLI handlers' success
 * reporting: they must fail (throw, non-zero exit) when a service doesn't
 * actually end up running, not just print a table and return 0.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { loadConfig } from '../../src/config/loader.js';
import { NullLogger } from '../../src/logging/logger.js';
import { Daemon } from '../../src/daemon/daemon.js';
import { handlers } from '../../src/cli/handlers.js';
import { ServiceStartFailedError } from '../../src/utils/errors.js';
import type { CliContext } from '../../src/cli/context.js';

let dir: string;
let daemon: Daemon | undefined;

async function writeConfig(home: string, service: unknown): Promise<void> {
  await mkdir(join(home, 'config'), { recursive: true });
  await writeFile(
    join(home, 'config', 'services.json'),
    JSON.stringify({ services: [service] }),
    'utf8',
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-clihandlers-'));
});

afterEach(async () => {
  await daemon?.shutdown('test');
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('start/restart handlers', () => {
  it('rejects with ServiceStartFailedError when a service fails to spawn', async () => {
    await writeConfig(dir, {
      id: 'ghost',
      command: 'this-binary-does-not-exist-xyz',
    });
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({ paths, config, logger: new NullLogger() });
    await daemon.start();

    const ctx: CliContext = { paths, logger: new NullLogger() };
    await expect(handlers.start(ctx, {})).rejects.toThrow(
      ServiceStartFailedError,
    );
  }, 10_000);

  it('succeeds without throwing when every service actually starts', async () => {
    await writeConfig(dir, {
      id: 'sleeper',
      command: process.execPath,
      args: ['-e', 'setTimeout(()=>{},30000)'],
    });
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({ paths, config, logger: new NullLogger() });
    await daemon.start();

    const ctx: CliContext = { paths, logger: new NullLogger() };
    await expect(handlers.start(ctx, {})).resolves.toBeUndefined();
  }, 10_000);
});
