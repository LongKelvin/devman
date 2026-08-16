import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readRegistry,
  registryFilePath,
  removeRegistryEntry,
  upsertRegistryEntry,
  type RegistryEntry,
} from '../../src/config/registry.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-registry-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function entry(home: string, pid = 1): RegistryEntry {
  return {
    home,
    pid,
    socketPath: `/tmp/${home}.sock`,
    startedAt: 100,
    version: '0.1.0',
  };
}

describe('registryFilePath', () => {
  it('honours DEVMAN_REGISTRY_FILE', () => {
    expect(
      registryFilePath({ DEVMAN_REGISTRY_FILE: '/custom/registry.json' }),
    ).toBe('/custom/registry.json');
  });

  it('falls back to ~/.devman/registry.json', () => {
    expect(registryFilePath({})).toMatch(/\.devman[\\/]registry\.json$/);
  });
});

describe('readRegistry', () => {
  it('returns an empty array for a missing file', async () => {
    expect(await readRegistry(join(dir, 'missing.json'))).toEqual([]);
  });
});

describe('upsertRegistryEntry / removeRegistryEntry', () => {
  it('adds and replaces entries by home', async () => {
    const path = join(dir, 'registry.json');
    await upsertRegistryEntry(path, entry('/projects/a', 1));
    await upsertRegistryEntry(path, entry('/projects/b', 2));
    expect((await readRegistry(path)).map((e) => e.home).sort()).toEqual([
      '/projects/a',
      '/projects/b',
    ]);

    // Re-registering the same home (e.g. a restart with a new pid) replaces,
    // not duplicates, the entry.
    await upsertRegistryEntry(path, entry('/projects/a', 99));
    const entries = await readRegistry(path);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.home === '/projects/a')?.pid).toBe(99);
  });

  it('removes only the matching home', async () => {
    const path = join(dir, 'registry.json');
    await upsertRegistryEntry(path, entry('/projects/a'));
    await upsertRegistryEntry(path, entry('/projects/b'));

    await removeRegistryEntry(path, '/projects/a');

    const entries = await readRegistry(path);
    expect(entries.map((e) => e.home)).toEqual(['/projects/b']);
  });

  it('removing an unknown home is a no-op', async () => {
    const path = join(dir, 'registry.json');
    await upsertRegistryEntry(path, entry('/projects/a'));
    await expect(
      removeRegistryEntry(path, '/projects/does-not-exist'),
    ).resolves.toBeUndefined();
    expect(await readRegistry(path)).toHaveLength(1);
  });
});
