/**
 * CLI command handlers.
 *
 * Handlers are thin: they resolve the daemon over IPC and render results. They
 * never own child processes. Methods that require the process manager (starting
 * and streaming individual services) arrive in later phases; until then they
 * report clearly rather than pretend to work.
 */
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { pathExists } from '../utils/fs.js';
import { now } from '../utils/time.js';
import { ensureDaemon, pingDaemon } from '../daemon/bootstrap.js';
import { callDaemon } from './daemonClient.js';
import { printInfo, printSuccess } from './render.js';
import { renderStatusTable } from '../ui/statusTable.js';
import { notImplemented } from './commands/stub.js';
import type { CliContext } from './context.js';
import type { CommandHandlers, StartDevOptions } from './program.js';
import type { PingResult, StatusResult } from '../ipc/protocol.js';

async function showStatus(ctx: CliContext): Promise<void> {
  const { state } = await callDaemon<StatusResult>(ctx.paths, 'status', {});
  process.stdout.write(`${renderStatusTable(state, now())}\n`);
}

async function stopAll(ctx: CliContext): Promise<void> {
  if ((await pingDaemon(ctx.paths)) === null) {
    printInfo('Daemon is not running.');
    return;
  }
  const spinner = ora('Stopping daemon…').start();
  try {
    await callDaemon(ctx.paths, 'shutdown', {});
    spinner.succeed('Daemon stopped.');
  } catch (error) {
    spinner.fail('Failed to stop daemon.');
    throw error;
  }
}

async function startDefault(ctx: CliContext): Promise<void> {
  const spinner = ora('Starting daemon…').start();
  let ping: PingResult;
  try {
    ping = await ensureDaemon(ctx.paths, ctx.logger);
    spinner.succeed(`Daemon ready (pid ${ping.daemonPid}).`);
  } catch (error) {
    spinner.fail('Daemon failed to start.');
    throw error;
  }
  // Service supervision is added in Phase 3; for now surface current state.
  await showStatus(ctx);
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
    printInfo('Daemon is not running. Start it with `start-dev`.');
  }
}

/** Production command handlers. */
export const handlers: CommandHandlers = {
  async startDev(ctx: CliContext, options: StartDevOptions): Promise<void> {
    if (options.status) return showStatus(ctx);
    if (options.stop) return stopAll(ctx);
    if (options.restart) notImplemented('start-dev --restart');
    if (options.log) notImplemented('start-dev --log');
    if (options.info) notImplemented('start-dev --info');
    return startDefault(ctx);
  },
  doctor: runDoctor,
};
