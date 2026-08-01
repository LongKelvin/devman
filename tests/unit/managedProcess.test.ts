/**
 * Unit tests for ManagedProcess.
 *
 * All tests use `process.execPath` (the running Node binary) so they work
 * identically on Windows, Linux, and macOS without any POSIX-specific commands
 * like `sleep` or `sh`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedProcess } from '../../src/process/managedProcess.js';
import type { ServiceDefinition } from '../../src/types/service.js';
import { delay } from '../../src/utils/time.js';

/** Build a minimal ServiceDefinition backed by a Node.js one-liner. */
function makeService(
  nodeScript: string,
  id = 'test',
): ServiceDefinition {
  return {
    id,
    name: id,
    cwd: '.',
    command: process.execPath,
    args: ['-e', nodeScript],
    enabled: true,
    dependsOn: [],
    env: {},
    restart: { policy: 'no', maxRetries: 0, delayMs: 0 },
  };
}

/** Processes still running at the end of a test — cleaned up in afterEach. */
const running: ManagedProcess[] = [];

afterEach(async () => {
  for (const mp of running.splice(0)) {
    if (mp.running) await mp.stop(500).catch(() => {});
  }
});

describe('ManagedProcess', () => {
  // ─── State before start ───────────────────────────────────────────────────

  it('is not running and has no pid before start()', () => {
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    expect(mp.running).toBe(false);
    expect(mp.pid).toBeUndefined();
    expect(mp.wasStopRequested).toBe(false);
  });

  // ─── Start ────────────────────────────────────────────────────────────────

  it('start() returns a positive pid and marks the process as running', () => {
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    const pid = mp.start();
    expect(pid).toBeGreaterThan(0);
    expect(mp.pid).toBe(pid);
    expect(mp.running).toBe(true);
  });

  it('a second start() call returns the same pid without spawning again', () => {
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    const pid1 = mp.start();
    const pid2 = mp.start();
    expect(pid1).toBe(pid2);
  });

  // ─── Output capture ───────────────────────────────────────────────────────

  it('delivers stdout lines to onLine', async () => {
    const lines: string[] = [];
    const mp = new ManagedProcess(
      makeService(
        "process.stdout.write('line1\\nline2\\n'); setTimeout(()=>{},30000)",
      ),
      process.cwd(),
      {
        onLine: (stream, line) => {
          if (stream === 'stdout') lines.push(line);
        },
        onExit: vi.fn(),
      },
    );
    running.push(mp);
    mp.start();
    await delay(500);
    expect(lines).toContain('line1');
    expect(lines).toContain('line2');
  });

  it('delivers stderr lines to onLine with stream="stderr"', async () => {
    const stderr: string[] = [];
    const mp = new ManagedProcess(
      makeService(
        "process.stderr.write('err-line\\n'); setTimeout(()=>{},30000)",
      ),
      process.cwd(),
      {
        onLine: (stream, line) => {
          if (stream === 'stderr') stderr.push(line);
        },
        onExit: vi.fn(),
      },
    );
    running.push(mp);
    mp.start();
    await delay(500);
    expect(stderr).toContain('err-line');
  });

  it('strips \\r from CRLF output (Windows-style line endings)', async () => {
    // Simulates Windows-native programs that emit \r\n instead of \n.
    // readline's crlfDelay:Infinity must strip the \r before delivering lines.
    const lines: string[] = [];
    const mp = new ManagedProcess(
      makeService(
        "process.stdout.write('hello\\r\\nworld\\r\\n'); setTimeout(()=>{},30000)",
      ),
      process.cwd(),
      {
        onLine: (stream, line) => {
          if (stream === 'stdout') lines.push(line);
        },
        onExit: vi.fn(),
      },
    );
    running.push(mp);
    mp.start();
    await delay(500);
    expect(lines).toContain('hello');
    expect(lines).toContain('world');
    for (const line of lines) {
      expect(line).not.toContain('\r');
    }
  });

  // ─── Natural exit ─────────────────────────────────────────────────────────

  it('calls onExit with {code:0, signal:null} on a clean process.exit(0)', async () => {
    const onExit = vi.fn();
    const mp = new ManagedProcess(
      makeService('process.exit(0)'),
      process.cwd(),
      { onLine: vi.fn(), onExit },
    );
    running.push(mp);
    mp.start();
    await delay(1000);
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ code: 0, signal: null });
    expect(mp.running).toBe(false);
  });

  it('calls onExit with a non-zero code on process.exit(1)', async () => {
    const onExit = vi.fn();
    const mp = new ManagedProcess(
      makeService('process.exit(1)'),
      process.cwd(),
      { onLine: vi.fn(), onExit },
    );
    running.push(mp);
    mp.start();
    await delay(1000);
    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ code: 1, signal: null });
  });

  // ─── Stop ─────────────────────────────────────────────────────────────────

  it('stop() resolves before the full grace period elapses', async () => {
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    mp.start();
    const start = Date.now();
    await mp.stop(10_000);
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(mp.running).toBe(false);
  });

  it('sets wasStopRequested=true after stop()', async () => {
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    mp.start();
    expect(mp.wasStopRequested).toBe(false);
    await mp.stop(3000);
    expect(mp.wasStopRequested).toBe(true);
    expect(mp.running).toBe(false);
  });

  it('stop() on an already-stopped process is a no-op', async () => {
    const mp = new ManagedProcess(
      makeService('process.exit(0)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    mp.start();
    await delay(500);
    // Already exited — stop() must resolve without throwing
    await expect(mp.stop(500)).resolves.toBeUndefined();
  });

  // ─── Platform-specific signal path ────────────────────────────────────────

  it('uses process-group signaling on POSIX, direct kill on Windows', async () => {
    // This test does not assert the exact kill mechanism (hard to unit-test
    // without mocking node:child_process), but verifies that stop() terminates
    // the process on the current platform regardless of which path is taken.
    const mp = new ManagedProcess(
      makeService('setTimeout(()=>{},30000)'),
      process.cwd(),
      { onLine: vi.fn(), onExit: vi.fn() },
    );
    running.push(mp);
    mp.start();
    await mp.stop(3000);
    expect(mp.running).toBe(false);
  });
});
