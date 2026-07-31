/**
 * Phase 1 command handlers.
 *
 * At this phase there is no daemon, so actions that require IPC are stubbed via
 * {@link notImplemented}. `doctor` already does useful, daemon-free work:
 * validating configuration and reporting resolved paths. Later phases replace
 * the stubs with IPC calls without changing the CLI shape.
 */
import { loadConfig } from '../config/loader.js';
import { pathExists } from '../utils/fs.js';
import { printInfo, printSuccess } from './render.js';
import { notImplemented } from './commands/stub.js';
import type { CliContext } from './context.js';
import type { CommandHandlers, StartDevOptions } from './program.js';

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
    return;
  }

  const config = await loadConfig(paths);
  printSuccess(
    `Configuration valid: ${config.services.length} service(s), ` +
      `${config.profiles.length} profile(s).`,
  );
}

/** Phase 1 handler set. */
export const phase1Handlers: CommandHandlers = {
  async startDev(_ctx: CliContext, options: StartDevOptions): Promise<void> {
    if (options.status) notImplemented('start-dev --status');
    if (options.stop) notImplemented('start-dev --stop');
    if (options.restart) notImplemented('start-dev --restart');
    if (options.log) notImplemented('start-dev --log');
    if (options.info) notImplemented('start-dev --info');
    notImplemented('start-dev');
  },
  doctor: runDoctor,
};
