/**
 * CLI definition. Builds the Commander program that backs the `devman` binary.
 *
 * Uses subcommands for all actions: `devman start`, `devman status`,
 * `devman stop`, `devman restart`, `devman log <service>`,
 * `devman info <service>`, `devman doctor`. A bare `devman` (no subcommand)
 * is equivalent to `devman start`. Command *handlers* are injected so the
 * program definition stays free of I/O and is unit-testable.
 */
import { Command } from 'commander';
import type { CliContext, GlobalOptions } from './context.js';
import { createContext } from './context.js';

/** Options shared by commands that support profile scoping. */
export interface ProfileOptions {
  readonly profile?: string;
}

/**
 * Injectable command handlers. Each receives the resolved {@link CliContext}.
 * This indirection lets phases add behaviour without touching the CLI shape and
 * keeps handlers independently testable.
 */
export interface CommandHandlers {
  start(ctx: CliContext, options: ProfileOptions): Promise<void>;
  status(ctx: CliContext): Promise<void>;
  stop(ctx: CliContext, options: ProfileOptions): Promise<void>;
  restart(ctx: CliContext, options: ProfileOptions): Promise<void>;
  log(ctx: CliContext, service: string): Promise<void>;
  info(ctx: CliContext, service: string): Promise<void>;
  doctor(ctx: CliContext): Promise<void>;
}

/** Program name shown in help output. */
export const PROGRAM_NAME = 'devman';

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

  // Bare `devman` with no subcommand starts services.
  program.action(async (_options: unknown, command: Command) => {
    await handlers.start(contextFor(command), {});
  });

  program
    .command('start')
    .description('start all enabled services (default action)')
    .option('-p, --profile <profile>', 'limit the action to a profile')
    .action(async (options: ProfileOptions, command: Command) => {
      await handlers.start(contextFor(command), options);
    });

  program
    .command('status')
    .description('show status of all services')
    .action(async (_options: unknown, command: Command) => {
      await handlers.status(contextFor(command));
    });

  program
    .command('stop')
    .description('stop all services and the daemon')
    .option('-p, --profile <profile>', 'limit the stop to a profile (leaves daemon running)')
    .action(async (options: ProfileOptions, command: Command) => {
      await handlers.stop(contextFor(command), options);
    });

  program
    .command('restart')
    .description('restart all services')
    .option('-p, --profile <profile>', 'limit the action to a profile')
    .action(async (options: ProfileOptions, command: Command) => {
      await handlers.restart(contextFor(command), options);
    });

  program
    .command('log <service>')
    .description('stream logs for a service')
    .action(async (service: string, _options: unknown, command: Command) => {
      await handlers.log(contextFor(command), service);
    });

  program
    .command('info <service>')
    .description('show detailed info for a service')
    .action(async (service: string, _options: unknown, command: Command) => {
      await handlers.info(contextFor(command), service);
    });

  program
    .command('doctor')
    .description('diagnose configuration and daemon health')
    .action(async (_options: unknown, command: Command) => {
      await handlers.doctor(contextFor(command));
    });

  return program;
}
