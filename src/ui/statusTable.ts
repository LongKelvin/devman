/**
 * Presentation helpers for runtime state. Rendering lives in `ui/` so command
 * handlers stay free of formatting concerns and the look can evolve (colours,
 * a TUI) without touching command logic.
 */
import Table from 'cli-table3';
import chalk from 'chalk';
import type {
  HealthStatus,
  RuntimeState,
  ServiceRuntime,
  ServiceStatus,
} from '../types/index.js';

/** Colour a status label for at-a-glance scanning. */
function colorStatus(status: ServiceStatus): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'starting':
    case 'stopping':
      return chalk.yellow(status);
    case 'failed':
      return chalk.red(status);
    case 'stopped':
      return chalk.gray(status);
    case 'configured':
    default:
      return chalk.dim(status);
  }
}

/** Colour a health label. */
function colorHealth(health: HealthStatus): string {
  switch (health) {
    case 'healthy':
      return chalk.green(health);
    case 'unhealthy':
      return chalk.red(health);
    case 'unknown':
    default:
      return chalk.dim(health);
  }
}

/**
 * Human-friendly uptime for a running service. Uptime is meaningful only while
 * the process is up, so non-running services render `-` regardless of their
 * last start time.
 */
function formatUptime(svc: ServiceRuntime, nowMs: number): string {
  if (svc.status !== 'running' || svc.startedAt === null) return '-';
  const seconds = Math.max(0, Math.floor((nowMs - svc.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Render the full status document as a table. */
export function renderStatusTable(state: RuntimeState, nowMs: number): string {
  const table = new Table({
    head: ['SERVICE', 'STATUS', 'PID', 'UPTIME', 'RESTARTS', 'HEALTH'].map(
      (h) => chalk.bold(h),
    ),
    style: { head: [], border: [] },
  });

  const services = Object.values(state.services);
  for (const svc of services) {
    table.push([
      svc.id,
      colorStatus(svc.status),
      svc.pid === null ? '-' : String(svc.pid),
      formatUptime(svc, nowMs),
      String(svc.restartCount),
      colorHealth(svc.health),
    ]);
  }
  return table.toString();
}

/** Render a single service's detail as a vertical key/value table. */
export function renderServiceInfo(runtime: ServiceRuntime): string {
  const table = new Table({ style: { head: [], border: [] } });
  table.push(
    { [chalk.bold('ID')]: runtime.id },
    { [chalk.bold('Status')]: colorStatus(runtime.status) },
    { [chalk.bold('PID')]: runtime.pid === null ? '-' : String(runtime.pid) },
    {
      [chalk.bold('Started')]:
        runtime.startedAt === null
          ? '-'
          : new Date(runtime.startedAt).toISOString(),
    },
    {
      [chalk.bold('Exit code')]:
        runtime.exitCode === null ? '-' : String(runtime.exitCode),
    },
    {
      [chalk.bold('Exit signal')]: runtime.exitSignal ?? '-',
    },
    { [chalk.bold('Restarts')]: String(runtime.restartCount) },
    { [chalk.bold('Health')]: colorHealth(runtime.health) },
  );
  return table.toString();
}
