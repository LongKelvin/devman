import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { loadConfig } from '../../src/config/loader.js';
import { NullLogger } from '../../src/logging/logger.js';
import { Daemon } from '../../src/daemon/daemon.js';
import { readRegistry } from '../../src/config/registry.js';
import { handlers } from '../../src/cli/handlers.js';
import type { CliContext } from '../../src/cli/context.js';

let root: string;
let registryFile: string;
let daemons: Daemon[] = [];

async function writeConfig(home: string, id: string): Promise<void> {
  await mkdir(join(home, 'config'), { recursive: true });
  await writeFile(
    join(home, 'config', 'services.json'),
    JSON.stringify({
      services: [
        {
          id,
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
        },
      ],
    }),
    'utf8',
  );
}

async function bootDaemon(home: string, serviceId: string): Promise<Daemon> {
  await writeConfig(home, serviceId);
  const paths = resolvePaths({ home, env: {} });
  const config = await loadConfig(paths);
  const daemon = new Daemon({
    paths,
    config,
    logger: new NullLogger(),
    registryFile,
  });
  await daemon.start();
  daemons.push(daemon);
  return daemon;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'devman-registry-list-'));
  registryFile = join(root, 'registry.json');
  daemons = [];
});

afterEach(async () => {
  await Promise.all(daemons.map((d) => d.shutdown('test')));
  daemons = [];
  await rm(root, { recursive: true, force: true });
});

describe('registry + `devman list`', () => {
  it('registers running daemons and deregisters on shutdown', async () => {
    const homeA = join(root, 'project-a');
    const homeB = join(root, 'project-b');
    const daemonA = await bootDaemon(homeA, 'api');
    await bootDaemon(homeB, 'web');

    const entries = await readRegistry(registryFile);
    expect(entries.map((e) => e.home).sort()).toEqual([homeA, homeB].sort());

    await daemonA.shutdown('test');
    daemons = daemons.filter((d) => d !== daemonA);

    const afterShutdown = await readRegistry(registryFile);
    expect(afterShutdown.map((e) => e.home)).toEqual([homeB]);
  });

  it('`devman list` summarises every registered instance across homes', async () => {
    process.env.DEVMAN_REGISTRY_FILE = registryFile;
    try {
      const homeA = join(root, 'project-a');
      const homeB = join(root, 'project-b');
      await bootDaemon(homeA, 'api');
      await bootDaemon(homeB, 'web');

      // `list` is global — the ctx passed in is irrelevant to which
      // instances it finds, only to logging.
      const ctx: CliContext = {
        paths: resolvePaths({ home: root, env: {} }),
        logger: new NullLogger(),
      };

      const lines: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        lines.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        await handlers.list(ctx, { json: true });
      } finally {
        process.stdout.write = originalWrite;
      }

      const rows = JSON.parse(lines.join('')) as Array<{
        home: string;
        reachable: boolean;
      }>;
      expect(rows.map((r) => r.home).sort()).toEqual([homeA, homeB].sort());
      expect(rows.every((r) => r.reachable)).toBe(true);
    } finally {
      delete process.env.DEVMAN_REGISTRY_FILE;
    }
  });
});
