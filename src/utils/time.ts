/**
 * Time helpers. Centralising clock access behind {@link now} makes time an
 * injectable seam for tests and keeps `Date.now()` calls out of business logic.
 */

/** Current epoch time in milliseconds. */
export function now(): number {
  return Date.now();
}

/** A monotonically-increasing timestamp in milliseconds, for durations. */
export function monotonicNow(): number {
  return performance.now();
}

/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
