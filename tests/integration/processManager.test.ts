import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { DevmanConfig } from '../../src/config/loader.js';
import { parseServiceDefinition } from '../../src/config/validate.js';
import { RuntimeStateStore } from '../../src/runtime/state.js';
import { EventBus } from '../../src/runtime/events.js';
import { NullLogger } from '../../src/logging/logger.js';
import { ProcessManager } from '../../src/process/processManager.js';
import { readLogTail, logFilePath } from '../../src/logging/serviceLogger.js';
import { delay } from '../../src/utils/time.js';

let dir: string;

function makeManager(config: DevmanConfig, home: string): ProcessManager {
  const paths = resolvePaths({ home, env: {} });
  const state = RuntimeStateStore.create({
    stateFile: paths.stateFile,
    daemonPid: process.pid,
    daemonStartedAt: 0,
    socketPath: paths.socketPath,
    serviceIds: config.services.map((s) => s.id),
  });
  return new ProcessManager({
    paths,
    config,
    state,
    events: new EventBus(),
    logger: new NullLogger(),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-pm-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ProcessManager', () => {
  it('starts a long-running service and records running state', async () => {
    const config = new DevmanConfig(
      [
        parseServiceDefinition({
          id: 'sleeper',
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
        }),
      ],
      [],
    );
    const pm = makeManager(config, dir);

    const started = await pm.start();
    expect(started[0]?.status).toBe('running');
    expect(started[0]?.pid).toBeGreaterThan(0);

    const stopped = await pm.stop();
    expect(stopped[0]?.status).toBe('stopped');
    await pm.stopAll();
  });

  it('captures stdout to the service log file', async () => {
    const config = new DevmanConfig(
      [
        parseServiceDefinition({
          id: 'echoer',
          command: process.execPath,
          args: [
            '-e',
            "process.stdout.write('hello-world\\n'); setTimeout(()=>{},30000)",
          ],
        }),
      ],
      [],
    );
    const paths = resolvePaths({ home: dir, env: {} });
    const pm = makeManager(config, dir);

    await pm.start();
    await delay(500); // allow the line to be flushed
    const tail = await readLogTail(logFilePath(paths, 'echoer'), 10);
    expect(tail.some((l) => l.includes('hello-world'))).toBe(true);

    await pm.stopAll();
  });

  it('starts dependencies before dependents', async () => {
    const config = new DevmanConfig(
      [
        parseServiceDefinition({
          id: 'dep',
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
        }),
        parseServiceDefinition({
          id: 'app',
          command: process.execPath,
          args: ['-e', 'setTimeout(()=>{},30000)'],
          dependsOn: ['dep'],
        }),
      ],
      [],
    );
    const pm = makeManager(config, dir);

    const started = await pm.start(['app']);
    // 'dep' is pulled in and ordered first.
    expect(started.map((s) => s.id)).toEqual(['dep', 'app']);

    await pm.stopAll();
  }, 15000);
});
