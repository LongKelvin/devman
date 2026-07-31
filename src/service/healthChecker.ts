/**
 * Periodic health monitoring for a single service.
 *
 * A {@link HealthChecker} runs a {@link HealthProbe} on an interval, and reports
 * transitions (not every tick) via a callback. It owns no service state itself;
 * the supervisor decides what to do with a health change (persist it, emit an
 * event). This separation keeps polling policy independent of the probe
 * strategy and of runtime-state concerns.
 */
import { createHealthProbe, type ProbeContext } from './healthProbe.js';
import type { HealthCheckConfig, HealthStatus } from '../types/index.js';

/** Default interval between probes when the config omits one. */
const DEFAULT_INTERVAL_MS = 5000;

/** Invoked when health transitions to a new value. */
export type HealthTransitionListener = (health: HealthStatus) => void;

/** Runs one service's health probe on a timer and reports transitions. */
export class HealthChecker {
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private current: HealthStatus = 'unknown';
  private probing = false;

  constructor(
    private readonly config: HealthCheckConfig,
    private readonly ctx: ProbeContext,
    private readonly onTransition: HealthTransitionListener,
  ) {
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Latest observed health. */
  get status(): HealthStatus {
    return this.current;
  }

  /** Begin polling. Runs an immediate probe, then repeats on the interval. */
  start(): void {
    if (this.timer) return;
    void this.runProbe();
    this.timer = setInterval(() => void this.runProbe(), this.intervalMs);
    // Don't keep the event loop alive solely for health polling.
    this.timer.unref?.();
  }

  /** Stop polling and reset health to `unknown`. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.setHealth('unknown');
  }

  /** Run a single probe and report a transition if the result changed. */
  private async runProbe(): Promise<void> {
    if (this.probing) return; // Skip if the previous probe is still in flight.
    this.probing = true;
    try {
      const probe = createHealthProbe(this.config, this.ctx);
      const healthy = await probe.check();
      this.setHealth(healthy ? 'healthy' : 'unhealthy');
    } finally {
      this.probing = false;
    }
  }

  /** Update health and notify only on a real transition. */
  private setHealth(next: HealthStatus): void {
    if (next === this.current) return;
    this.current = next;
    this.onTransition(next);
  }
}
