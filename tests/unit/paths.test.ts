import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';

describe('resolvePaths', () => {
  it('derives all paths from an explicit home', () => {
    const paths = resolvePaths({ home: '/srv/app', env: {} });
    expect(paths.home).toBe('/srv/app');
    expect(paths.configDir).toBe('/srv/app/config');
    expect(paths.servicesFile).toBe('/srv/app/config/services.json');
    expect(paths.logsDir).toBe('/srv/app/logs');
    expect(paths.runtimeDir).toBe('/srv/app/runtime');
    expect(paths.stateFile).toBe('/srv/app/runtime/state.json');
  });

  it('honours DEVMAN_HOME when no explicit home is given', () => {
    const paths = resolvePaths({ env: { DEVMAN_HOME: '/opt/x' } });
    expect(paths.home).toBe('/opt/x');
  });

  it('lets the config dir be overridden independently', () => {
    const paths = resolvePaths({ home: '/srv/app', configDir: '/etc/devman' });
    expect(paths.configDir).toBe('/etc/devman');
    expect(paths.servicesFile).toBe('/etc/devman/services.json');
  });

  it('resolves a relative home against cwd', () => {
    const paths = resolvePaths({ home: 'sub', cwd: '/base', env: {} });
    expect(paths.home).toBe('/base/sub');
  });
});
