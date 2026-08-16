import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { loadConfig } from '../../src/config/loader.js';
import {
  ConfigInvalidError,
  DependencyCycleError,
} from '../../src/utils/errors.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-loader-'));
  await mkdir(join(dir, 'config'), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeServices(value: unknown): Promise<void> {
  await writeFile(
    join(dir, 'config', 'services.json'),
    typeof value === 'string' ? value : JSON.stringify(value),
    'utf8',
  );
}

describe('loadConfig', () => {
  it('loads a valid, acyclic configuration', async () => {
    await writeServices({
      services: [
        { id: 'db', command: 'node' },
        { id: 'api', command: 'node', dependsOn: ['db'] },
      ],
    });
    const config = await loadConfig(resolvePaths({ home: dir, env: {} }));
    expect(config.services.map((s) => s.id)).toEqual(['db', 'api']);
  });

  it('rejects a dependsOn cycle at load time, not only at start time', async () => {
    await writeServices({
      services: [
        { id: 'a', command: 'node', dependsOn: ['b'] },
        { id: 'b', command: 'node', dependsOn: ['a'] },
      ],
    });
    await expect(
      loadConfig(resolvePaths({ home: dir, env: {} })),
    ).rejects.toThrow(DependencyCycleError);
  });

  it('wraps malformed JSON as a hinted ConfigInvalidError, not a raw SyntaxError', async () => {
    await writeServices('{ "services": [ { "id": "a", command: "node" } ] }');
    const paths = resolvePaths({ home: dir, env: {} });
    await expect(loadConfig(paths)).rejects.toThrow(ConfigInvalidError);
    await expect(loadConfig(paths)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      hint: expect.any(String),
    });
  });
});
