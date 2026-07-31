import { describe, expect, it } from 'vitest';
import {
  parseServiceDefinition,
  parseServicesDocument,
  parseProfilesDocument,
} from '../../src/config/validate.js';
import { ConfigInvalidError } from '../../src/utils/errors.js';

describe('parseServiceDefinition', () => {
  it('applies defaults for optional fields', () => {
    const svc = parseServiceDefinition({ id: 'api', command: 'node' });
    expect(svc.name).toBe('api');
    expect(svc.cwd).toBe('.');
    expect(svc.args).toEqual([]);
    expect(svc.enabled).toBe(true);
    expect(svc.dependsOn).toEqual([]);
    expect(svc.env).toEqual({});
    expect(svc.restart).toEqual({
      policy: 'on-failure',
      maxRetries: 5,
      delayMs: 1000,
    });
    expect(svc.healthCheck).toBeUndefined();
  });

  it('preserves explicit values', () => {
    const svc = parseServiceDefinition({
      id: 'web',
      name: 'Web',
      command: 'npm',
      args: ['run', 'dev'],
      enabled: false,
      dependsOn: ['api'],
      env: { PORT: '3000' },
      restart: { policy: 'always', maxRetries: 2, delayMs: 500 },
      healthCheck: { type: 'http', url: 'http://x/health' },
    });
    expect(svc.enabled).toBe(false);
    expect(svc.dependsOn).toEqual(['api']);
    expect(svc.restart.policy).toBe('always');
    expect(svc.healthCheck).toEqual({ type: 'http', url: 'http://x/health' });
  });

  it('rejects a missing command', () => {
    expect(() => parseServiceDefinition({ id: 'x' })).toThrow(
      ConfigInvalidError,
    );
  });

  it('rejects an invalid restart policy', () => {
    expect(() =>
      parseServiceDefinition({
        id: 'x',
        command: 'node',
        restart: { policy: 'sometimes' },
      }),
    ).toThrow(ConfigInvalidError);
  });
});

describe('parseServicesDocument', () => {
  it('accepts a bare array', () => {
    const services = parseServicesDocument([{ id: 'a', command: 'node' }]);
    expect(services).toHaveLength(1);
  });

  it('accepts an object with a services array', () => {
    const services = parseServicesDocument({
      services: [{ id: 'a', command: 'node' }],
    });
    expect(services).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parseServicesDocument([
        { id: 'a', command: 'node' },
        { id: 'a', command: 'node' },
      ]),
    ).toThrow(/Duplicate service id/);
  });
});

describe('parseProfilesDocument', () => {
  it('parses a mapping form', () => {
    const profiles = parseProfilesDocument({ backend: ['db', 'api'] });
    expect(profiles).toEqual([{ id: 'backend', services: ['db', 'api'] }]);
  });

  it('returns empty for undefined', () => {
    expect(parseProfilesDocument(undefined)).toEqual([]);
  });
});
