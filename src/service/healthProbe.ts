/**
 * Health probes.
 *
 * A {@link HealthProbe} answers one question: is this service healthy *right
 * now*? Strategies are selected by {@link HealthCheckConfig.type} and hidden
 * behind a common interface so the checker (and future strategies) compose
 * without conditionals leaking outward.
 */
import { connect } from 'node:net';
import type { HealthCheckConfig } from '../types/index.js';

/** Default per-probe timeout when the config omits one. */
const DEFAULT_PROBE_TIMEOUT_MS = 2000;

/** A single health check strategy. */
export interface HealthProbe {
  /** Resolve `true` if the service is currently healthy. Never rejects. */
  check(): Promise<boolean>;
}

/** Context a probe may need beyond its own config. */
export interface ProbeContext {
  /** Whether the supervised process is currently running. */
  isProcessRunning(): boolean;
}

/** Healthy iff the supervised process is running. The always-available default. */
class ProcessProbe implements HealthProbe {
  constructor(private readonly ctx: ProbeContext) {}
  async check(): Promise<boolean> {
    return this.ctx.isProcessRunning();
  }
}

/** Healthy iff a TCP connection to the configured port succeeds. */
class TcpProbe implements HealthProbe {
  constructor(
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly host = '127.0.0.1',
  ) {}

  check(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ port: this.port, host: this.host });
      const done = (healthy: boolean): void => {
        socket.destroy();
        resolve(healthy);
      };
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }
}

/** Healthy iff an HTTP GET returns a 2xx/3xx status within the timeout. */
class HttpProbe implements HealthProbe {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async check(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        signal: controller.signal,
        redirect: 'manual',
      });
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build the probe for a service's health-check config. Falls back to the
 * process probe when a strategy's required fields are missing, so a
 * misconfigured `http`/`tcp` check degrades gracefully rather than throwing.
 */
export function createHealthProbe(
  config: HealthCheckConfig,
  ctx: ProbeContext,
): HealthProbe {
  const timeout = config.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  switch (config.type) {
    case 'tcp':
      return typeof config.port === 'number'
        ? new TcpProbe(config.port, timeout)
        : new ProcessProbe(ctx);
    case 'http':
      return typeof config.url === 'string'
        ? new HttpProbe(config.url, timeout)
        : new ProcessProbe(ctx);
    case 'process':
    default:
      return new ProcessProbe(ctx);
  }
}
