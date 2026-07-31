/**
 * CLI definition. Builds the Commander program that backs the `start-dev`
 * (and `devman`) binaries.
 *
 * The architecture specifies a single primary command, `start-dev`, whose
 * behaviour is selected by flags (`--status`, `--stop`, `--restart`, `--log`,
 * `--info`) plus a `doctor` subcommand. Command *handlers* are injected so the
 * program definition stays free of I/O and is unit-testable.
 */
import { Command } from 'commander';
import type { CliContext, GlobalOptions } from './context.js';
import { createContext } from './context.js';

/** Options parsed from the default `start-dev` action. */
export interface StartDevOptions {
  readonly status?: boolean;
  readonly stop?: boolean;
  readonly restart?: boolean;
  readonly log?: string;
  readonly info?: string;
  readonly profile?: string;
}

/**
 * Injectable command handlers. Each receives the resolved {@link CliContext}.
 * This indirection lets phases add behaviour without touching the CLI shape and
 * keeps handlers independently testable.
 */
export interface CommandHandlers {
  startDev(ctx: CliContext, options: StartDevOptions): Promise<void>;
  doctor(ctx: CliContext): Promise<void>;
}

/** Program name shown in help output. */
export const PROGRAM_NAME = 'start-dev';

/** Build the Commander program with the given handlers. */
export function buildProgram(handlers: CommandHandlers): Command {
  const program = new Command();

  program
    .name(PROGRAM_NAME)
    .description('Manage local development services via a background daemon.')
    .version('0.1.0')
    .option('--home <dir>', 'base directory for config, logs and runtime')
    .option('--config <dir>', 'configuration directory')
    .option('-v, --verbose', 'enable verbose (debug) logging');

  const contextFor = (command: Command): CliContext =>
    createContext(command.optsWithGlobals() as GlobalOptions);

  program
    .option('-s, --status', 'show status of all services')
    .option('--stop', 'stop all services and the daemon')
    .option('--restart', 'restart all services')
    .option('--log <service>', 'stream logs for a service')
    .option('--info <service>', 'show detailed info for a service')
    .option('-p, --profile <profile>', 'limit the action to a profile')
    .action(async (options: StartDevOptions, command: Command) => {
      await handlers.startDev(contextFor(command), options);
    });

  program
    .command('doctor')
    .description('diagnose configuration and daemon health')
    .action(async (_options: unknown, command: Command) => {
      await handlers.doctor(contextFor(command));
    });

  return program;
}
