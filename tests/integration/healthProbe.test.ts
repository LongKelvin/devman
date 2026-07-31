import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHealthProbe } from '../../src/service/healthProbe.js';

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

/** Start a bare TCP server on an ephemeral port and return the port. */
function listenOnEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    server = s;
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('no port'));
    });
  });
}

const ctx = { isProcessRunning: () => true };

describe('TCP health probe', () => {
  it('is healthy when the port accepts connections', async () => {
    const port = await listenOnEphemeralPort();
    const probe = createHealthProbe({ type: 'tcp', port, timeoutMs: 500 }, ctx);
    expect(await probe.check()).toBe(true);
  });

  it('is unhealthy when nothing listens on the port', async () => {
    // Port 1 is privileged and almost never open to an unprivileged client.
    const probe = createHealthProbe(
      { type: 'tcp', port: 1, timeoutMs: 300 },
      ctx,
    );
    expect(await probe.check()).toBe(false);
  });

  it('falls back to the process probe when port is missing', async () => {
    const probe = createHealthProbe({ type: 'tcp' }, ctx);
    // Process is "running" in this ctx, so the fallback reports healthy.
    expect(await probe.check()).toBe(true);
  });
});
