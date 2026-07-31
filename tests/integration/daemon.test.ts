import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { loadConfig } from '../../src/config/loader.js';
import { NullLogger } from '../../src/logging/logger.js';
import { Daemon } from '../../src/daemon/daemon.js';
import { IpcClient } from '../../src/ipc/client.js';
import { SocketClientTransport } from '../../src/ipc/socketTransport.js';
import { readLiveDaemonPid } from '../../src/daemon/pidfile.js';
import type { PingResult, StatusResult } from '../../src/ipc/protocol.js';

let dir: string;
let daemon: Daemon | undefined;

async function writeConfig(home: string): Promise<void> {
  await mkdir(join(home, 'config'), { recursive: true });
  await writeFile(
    join(home, 'config', 'services.json'),
    JSON.stringify({
      services: [{ id: 'svc', command: 'true' }],
    }),
    'utf8',
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-daemon-'));
  await writeConfig(dir);
});

afterEach(async () => {
  await daemon?.shutdown('test');
  daemon = undefined;
  await rm(dir, { recursive: true, force: true });
});

describe('Daemon over IPC', () => {
  it('serves ping, status and shutdown', async () => {
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({ paths, config, logger: new NullLogger() });
    await daemon.start();

    // A live pid file is written on start.
    expect(await readLiveDaemonPid(paths.pidFile)).toBe(process.pid);

    const client = await IpcClient.connect(
      new SocketClientTransport(paths.socketPath),
    );

    const ping = await client.call<PingResult>('ping', {});
    expect(ping.pong).toBe(true);
    expect(ping.daemonPid).toBe(process.pid);

    const status = await client.call<StatusResult>('status', {});
    expect(Object.keys(status.state.services)).toEqual(['svc']);
    expect(status.state.services.svc?.status).toBe('configured');

    await client.call('shutdown', {});
    client.close();

    await daemon.waitUntilStopped();
    // Pid file released on shutdown.
    expect(await readLiveDaemonPid(paths.pidFile)).toBeNull();
    daemon = undefined;
  });

  it('rejects unknown methods', async () => {
    const paths = resolvePaths({ home: dir, env: {} });
    const config = await loadConfig(paths);
    daemon = new Daemon({ paths, config, logger: new NullLogger() });
    await daemon.start();

    const client = await IpcClient.connect(
      new SocketClientTransport(paths.socketPath),
    );
    await expect(
      // Cast: intentionally exercising an unregistered method.
      client.call('bogus' as 'ping', {}),
    ).rejects.toThrow(/Unknown method/);
    client.close();
  });
});
