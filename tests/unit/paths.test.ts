import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';

describe('resolvePaths', () => {
  it('derives all paths from an explicit home', () => {
    const home = resolve('/srv/app');
    const paths = resolvePaths({ home: '/srv/app', env: {} });
    expect(paths.home).toBe(home);
    expect(paths.configDir).toBe(resolve(home, 'config'));
    expect(paths.servicesFile).toBe(resolve(home, 'config', 'services.json'));
    expect(paths.logsDir).toBe(resolve(home, 'logs'));
    expect(paths.runtimeDir).toBe(resolve(home, 'runtime'));
    expect(paths.stateFile).toBe(resolve(home, 'runtime', 'state.json'));
  });

  it('honours DEVMAN_HOME when no explicit home is given', () => {
    const paths = resolvePaths({ env: { DEVMAN_HOME: '/opt/x' } });
    expect(paths.home).toBe(resolve('/opt/x'));
  });

  it('lets the config dir be overridden independently', () => {
    const paths = resolvePaths({ home: '/srv/app', configDir: '/etc/devman' });
    expect(paths.configDir).toBe(resolve('/etc/devman'));
    expect(paths.servicesFile).toBe(resolve('/etc/devman', 'services.json'));
  });

  it('resolves a relative home against cwd', () => {
    const paths = resolvePaths({ home: 'sub', cwd: '/base', env: {} });
    expect(paths.home).toBe(resolve('/base', 'sub'));
  });

  it('socketPath is a named pipe on Windows, a Unix socket on POSIX', () => {
    const paths = resolvePaths({ home: '/srv/app', env: {} });
    if (process.platform === 'win32') {
      // Windows: \\.\ pipe\devman-<hex>
      expect(paths.socketPath).toMatch(/^\\\\.\\pipe\\devman-[0-9a-f]+$/);
    } else {
      expect(paths.socketPath).toBe(
        resolve(resolve('/srv/app'), 'runtime', 'daemon.sock'),
      );
    }
  });
});
