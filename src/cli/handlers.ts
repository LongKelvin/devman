/**
 * CLI command handlers.
 *
 * Handlers are thin: they resolve the daemon over IPC and render results. They
 * never own child processes — every action is an IPC call to the daemon, which
 * is the sole owner of managed processes.
 */
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { pathExists } from '../utils/fs.js';
import { now } from '../utils/time.js';
import { ensureDaemon, pingDaemon } from '../daemon/bootstrap.js';
import { callDaemon, withDaemon } from './daemonClient.js';
import { printInfo, printSuccess } from './render.js';
import { renderServiceInfo, renderStatusTable } from '../ui/statusTable.js';
import type { CliContext } from './context.js';
import type { CommandHandlers, ProfileOptions } from './program.js';
import type {
  InfoResult,
  LifecycleResult,
  StatusResult,
} from '../ipc/protocol.js';

/**
 * Resolve the `--profile` option to explicit service ids by consulting the
 * configuration. Returns `undefined` when no profile is given, letting the
 * daemon apply its default (all enabled services).
 */
async function resolveSelector(
  ctx: CliContext,
  profile: string | undefined,
): Promise<{ ids?: string[] }> {
  if (!profile) return {};
  const config = await loadConfig(ctx.paths);
  return { ids: config.resolveProfile(profile) };
}

async function showStatus(ctx: CliContext): Promise<void> {
  const { state } = await callDaemon<StatusResult>(ctx.paths, 'status', {});
  process.stdout.write(`${renderStatusTable(state, now())}\n`);
}

async function stopAll(
  ctx: CliContext,
  options: ProfileOptions,
): Promise<void> {
  if ((await pingDaemon(ctx.paths)) === null) {
    printInfo('Daemon is not running.');
    return;
  }

  // A scoped stop (`--profile`) stops only those services and leaves the daemon
  // running; a bare `--stop` stops everything and shuts the daemon down.
  if (options.profile) {
    const selector = await resolveSelector(ctx, options.profile);
    const spinner = ora(`Stopping profile "${options.profile}"…`).start();
    try {
      const { services } = await callDaemon<LifecycleResult>(
        ctx.paths,
        'stop',
        selector,
      );
      spinner.succeed(`Stopped ${services.length} service(s).`);
    } catch (error) {
      spinner.fail('Failed to stop services.');
      throw error;
    }
    return;
  }

  const spinner = ora('Stopping all services and daemon…').start();
  try {
    await callDaemon(ctx.paths, 'shutdown', {});
    spinner.succeed('Daemon stopped.');
  } catch (error) {
    spinner.fail('Failed to stop daemon.');
    throw error;
  }
}

async function restart(
  ctx: CliContext,
  options: ProfileOptions,
): Promise<void> {
  const selector = await resolveSelector(ctx, options.profile);
  await ensureDaemon(ctx.paths, ctx.logger);
  const spinner = ora('Restarting services…').start();
  try {
    const { services } = await callDaemon<LifecycleResult>(
      ctx.paths,
      'restart',
      selector,
      { timeoutMs: 60_000 },
    );
    spinner.succeed(`Restarted ${services.length} service(s).`);
  } catch (error) {
    spinner.fail('Failed to restart services.');
    throw error;
  }
  await showStatus(ctx);
}

async function startDefault(
  ctx: CliContext,
  options: ProfileOptions,
): Promise<void> {
  const spinner = ora('Starting daemon…').start();
  try {
    const ping = await ensureDaemon(ctx.paths, ctx.logger);
    spinner.text = `Daemon ready (pid ${ping.daemonPid}); starting services…`;
  } catch (error) {
    spinner.fail('Daemon failed to start.');
    throw error;
  }

  try {
    const selector = await resolveSelector(ctx, options.profile);
    const { services } = await callDaemon<LifecycleResult>(
      ctx.paths,
      'start',
      selector,
      { timeoutMs: 60_000 },
    );
    spinner.succeed(`Started ${services.length} service(s).`);
  } catch (error) {
    spinner.fail('Failed to start services.');
    throw error;
  }
  await showStatus(ctx);
}

async function showInfo(ctx: CliContext, serviceId: string): Promise<void> {
  const { runtime } = await callDaemon<InfoResult>(ctx.paths, 'info', {
    serviceId,
  });
  process.stdout.write(`${renderServiceInfo(runtime)}\n`);
}

async function streamLogs(ctx: CliContext, serviceId: string): Promise<void> {
  await withDaemon(ctx.paths, async (client) => {
    await client.call(
      'logs',
      { serviceId, follow: true },
      {
        // Follow streams are open-ended; disable the response timeout.
        timeoutMs: 0,
        onStream: (chunk) => process.stdout.write(`${String(chunk)}\n`),
      },
    );
  });
}

async function runDoctor(ctx: CliContext): Promise<void> {
  const { paths, logger } = ctx;
  printInfo(`home:        ${paths.home}`);
  printInfo(`config dir:  ${paths.configDir}`);
  printInfo(`logs dir:    ${paths.logsDir}`);
  printInfo(`runtime dir: ${paths.runtimeDir}`);
  printInfo(`socket:      ${paths.socketPath}`);

  if (!(await pathExists(paths.servicesFile))) {
    logger.warn('No services.json found.', { file: paths.servicesFile });
    printInfo('No configuration found yet — see config/services.example.json.');
  } else {
    const config = await loadConfig(paths);
    printSuccess(
      `Configuration valid: ${config.services.length} service(s), ` +
        `${config.profiles.length} profile(s).`,
    );
  }

  const ping = await pingDaemon(paths);
  if (ping) {
    printSuccess(`Daemon running (pid ${ping.daemonPid}, v${ping.version}).`);
  } else {
    printInfo('Daemon is not running. Run `devman start` to start it.');
  }
}

/** Production command handlers. */
export const handlers: CommandHandlers = {
  start: startDefault,
  status: showStatus,
  stop: stopAll,
  restart,
  log: streamLogs,
  info: showInfo,
  doctor: runDoctor,
};
