import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { loadConfig } from '../../src/config/loader.js';
import { NullLogger } from '../../src/logging/logger.js';
import { Daemon } from '../../src/daemon/daemon.js';
import { IpcClient } from '../../src/ipc/client.js';
import { SocketClientTransport } from '../../src/ipc/socketTransport.js';
import type { StatusResult } from '../../src/ipc/protocol.js';

let dir: string;
let daemon: Daemon | undefined;

async function writeConfig(home: string): Promise<void> {
  await mkdir(join(home, 'config'), { recursive: true });
  await writeFile(
    join(home, 'config', 'services.json'),
    JSON.stringify({
      services: [
        {
          id: 'a',
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
        },
        {
          id: 'b',
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
        },
      ],
    }),
    'utf8',
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-active-profile-'));
  await writeConfig(dir);
});

afterEach(async () => {
  await daemon?.shutdown('test');
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('active profile tracking', () => {
  it('records the profile passed to start and clears it on a matching stop', async () => {
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({
      paths,
      config,
      logger: new NullLogger(),
      registryFile: join(dir, 'registry.json'),
    });
    await daemon.start();

    const client = await IpcClient.connect(
      new SocketClientTransport(paths.socketPath),
    );
    try {
      await client.call('start', { ids: ['a'], profile: 'infra' });
      let status = await client.call<StatusResult>('status', {});
      expect(status.state.activeProfile).toBe('infra');

      // A scoped stop of a *different* profile must not clear it.
      await client.call('stop', { ids: ['a'], profile: 'other' });
      status = await client.call<StatusResult>('status', {});
      expect(status.state.activeProfile).toBe('infra');

      // Stopping the exact active profile clears it.
      await client.call('start', { ids: ['a'], profile: 'infra' });
      await client.call('stop', { ids: ['a'], profile: 'infra' });
      status = await client.call<StatusResult>('status', {});
      expect(status.state.activeProfile).toBeNull();
    } finally {
      client.close();
    }
  });

  it('an unscoped start clears the recorded profile', async () => {
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({
      paths,
      config,
      logger: new NullLogger(),
      registryFile: join(dir, 'registry.json'),
    });
    await daemon.start();

    const client = await IpcClient.connect(
      new SocketClientTransport(paths.socketPath),
    );
    try {
      await client.call('start', { ids: ['a'], profile: 'infra' });
      await client.call('start', {});
      const status = await client.call<StatusResult>('status', {});
      expect(status.state.activeProfile).toBeNull();
    } finally {
      client.close();
    }
  });
});
