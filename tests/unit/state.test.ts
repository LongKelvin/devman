import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RuntimeStateStore,
  initialServiceRuntime,
  readRuntimeState,
} from '../../src/runtime/state.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-state-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('initialServiceRuntime', () => {
  it('starts configured with no pid', () => {
    const rt = initialServiceRuntime('api', 100);
    expect(rt.status).toBe('configured');
    expect(rt.pid).toBeNull();
    expect(rt.restartCount).toBe(0);
    expect(rt.updatedAt).toBe(100);
  });
});

describe('RuntimeStateStore', () => {
  it('creates initial records for each service', () => {
    const store = RuntimeStateStore.create({
      stateFile: join(dir, 'state.json'),
      daemonPid: 1,
      daemonStartedAt: 10,
      socketPath: '/tmp/x.sock',
      serviceIds: ['a', 'b'],
    });
    expect(Object.keys(store.snapshot().services)).toEqual(['a', 'b']);
  });

  it('merges patches and persists atomically', async () => {
    const stateFile = join(dir, 'state.json');
    const store = RuntimeStateStore.create({
      stateFile,
      daemonPid: 1,
      daemonStartedAt: 10,
      socketPath: '/tmp/x.sock',
      serviceIds: ['a'],
    });

    await store.updateService('a', { status: 'running', pid: 42 }, 20);

    const onDisk = await readRuntimeState(stateFile);
    expect(onDisk?.services.a?.status).toBe('running');
    expect(onDisk?.services.a?.pid).toBe(42);
    expect(onDisk?.services.a?.updatedAt).toBe(20);

    // Raw file is valid JSON with a trailing newline.
    const raw = await readFile(stateFile, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('returns null when reading a missing state file', async () => {
    expect(await readRuntimeState(join(dir, 'missing.json'))).toBeNull();
  });

  it('serialises concurrent updates instead of racing on rename', async () => {
    // Regression: two services changing state in the same tick (e.g. two
    // health checks resolving together) used to fire overlapping
    // writeJsonFileAtomic calls at the same destination, which can EPERM on
    // Windows when two renames land close together. Firing many concurrent
    // updateService calls and awaiting them all should never reject and
    // should leave every patch reflected in the final file.
    const stateFile = join(dir, 'state.json');
    const store = RuntimeStateStore.create({
      stateFile,
      daemonPid: 1,
      daemonStartedAt: 10,
      socketPath: '/tmp/x.sock',
      serviceIds: ['a', 'b', 'c'],
    });

    await Promise.all([
      store.updateService('a', { status: 'running', pid: 1 }, 1),
      store.updateService('b', { status: 'running', pid: 2 }, 2),
      store.updateService('c', { status: 'running', pid: 3 }, 3),
      store.updateService('a', { health: 'healthy' }, 4),
      store.updateService('b', { health: 'healthy' }, 5),
    ]);

    const onDisk = await readRuntimeState(stateFile);
    expect(onDisk?.services.a).toMatchObject({ status: 'running', pid: 1 });
    expect(onDisk?.services.b).toMatchObject({ status: 'running', pid: 2 });
    expect(onDisk?.services.c).toMatchObject({ status: 'running', pid: 3 });
  });
});
