import { describe, expect, it, vi } from 'vitest';
import { HealthChecker } from '../../src/service/healthChecker.js';
import { delay } from '../../src/utils/time.js';
import type { HealthStatus } from '../../src/types/index.js';

describe('HealthChecker (process strategy)', () => {
  it('reports healthy while the process runs and transitions on stop', async () => {
    let running = true;
    const seen: HealthStatus[] = [];
    const checker = new HealthChecker(
      { type: 'process', intervalMs: 20 },
      { isProcessRunning: () => running },
      (h) => seen.push(h),
    );

    checker.start();
    await delay(60);
    expect(checker.status).toBe('healthy');
    expect(seen).toContain('healthy');

    // Flip to not-running: the next probe should report unhealthy.
    running = false;
    await delay(60);
    expect(checker.status).toBe('unhealthy');

    checker.stop();
    // Stop resets to unknown.
    expect(checker.status).toBe('unknown');
  });

  it('only notifies on transitions, not every tick', async () => {
    const listener = vi.fn();
    const checker = new HealthChecker(
      { type: 'process', intervalMs: 10 },
      { isProcessRunning: () => true },
      listener,
    );
    checker.start();
    await delay(80);
    checker.stop();
    // healthy (once) + unknown on stop = 2 transitions, despite many ticks.
    expect(listener.mock.calls.map((c) => c[0])).toEqual([
      'healthy',
      'unknown',
    ]);
  });
});
