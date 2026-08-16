import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { parseServiceDefinition } from '../../src/config/validate.js';
import { RuntimeStateStore } from '../../src/runtime/state.js';
import { EventBus } from '../../src/runtime/events.js';
import type { Logger } from '../../src/logging/logger.js';
import { ServiceSupervisor } from '../../src/process/serviceSupervisor.js';
import { delay } from '../../src/utils/time.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devman-supervisor-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Minimal spy logger: records every `error()` call for assertions. */
function spyLogger(): Logger & { errors: Array<[string, unknown]> } {
  const errors: Array<[string, unknown]> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, meta) => errors.push([message, meta]),
    child: () => logger,
  };
  return Object.assign(logger, { errors });
}

describe('ServiceSupervisor health persistence', () => {
  it('survives a rejecting state write on a health change instead of crashing', async () => {
    // Regression: onHealthChanged used to be invoked fire-and-forget
    // (`void this.onHealthChanged(health)`), so a rejected state write on a
    // health transition became an unhandled rejection — which kills the
    // whole daemon process (and every other supervised service) on Node.
    // It must now be caught, logged, and otherwise ignored.
    const paths = resolvePaths({ home: dir, env: {} });
    const state = RuntimeStateStore.create({
      stateFile: paths.stateFile,
      daemonPid: process.pid,
      daemonStartedAt: 0,
      socketPath: paths.socketPath,
      serviceIds: ['svc'],
    });

    const originalUpdate = state.updateService.bind(state);
    const updateSpy = vi
      .spyOn(state, 'updateService')
      .mockImplementation(async (id, patch, at) => {
        if (patch.health !== undefined) {
          throw Object.assign(new Error('EPERM: simulated rename race'), {
            code: 'EPERM',
          });
        }
        return originalUpdate(id, patch, at);
      });

    const logger = spyLogger();
    const service = parseServiceDefinition({
      id: 'svc',
      command: process.execPath,
      args: ['-e', 'setTimeout(()=>{},30000)'],
      healthCheck: { type: 'process', intervalMs: 30 },
    });

    const supervisor = new ServiceSupervisor(service, {
      paths,
      state,
      events: new EventBus(),
      logger,
    });

    let unhandled: unknown;
    const onUnhandled = (reason: unknown): void => {
      unhandled = reason;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await supervisor.start();
      // Let a couple of health-check ticks (30ms interval) land.
      await delay(150);

      expect(supervisor.running).toBe(true);
      expect(updateSpy).toHaveBeenCalled();
      expect(
        logger.errors.some(([message]) =>
          message.includes('Failed to persist health change'),
        ),
      ).toBe(true);
      expect(unhandled).toBeUndefined();
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await supervisor.stop();
    }
  });
});
