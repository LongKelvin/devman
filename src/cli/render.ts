/**
 * Terminal rendering helpers. Centralising chalk usage keeps colour decisions
 * in one place and makes it trivial to honour `NO_COLOR` or add themes later.
 */
import chalk from 'chalk';
import { DevmanError, toDevmanError } from '../utils/errors.js';

/** Render a caught error as a friendly, multi-line block on stderr. */
export function printError(error: unknown): void {
  const devErr = toDevmanError(error);
  process.stderr.write(`${chalk.red.bold('✖ Error')} ${devErr.message}\n`);
  if (devErr.hint) {
    process.stderr.write(`  ${chalk.yellow('hint:')} ${devErr.hint}\n`);
  }
  if (process.env.DEVMAN_DEBUG && devErr.cause instanceof Error) {
    process.stderr.write(chalk.dim(`  cause: ${devErr.cause.stack}\n`));
  }
}

/** A success line with a green check. */
export function printSuccess(message: string): void {
  process.stdout.write(`${chalk.green('✔')} ${message}\n`);
}

/** An informational line. */
export function printInfo(message: string): void {
  process.stdout.write(`${chalk.cyan('ℹ')} ${message}\n`);
}

/** Map a {@link DevmanError} to a process exit code. */
export function exitCodeFor(error: unknown): number {
  return error instanceof DevmanError ? 1 : 2;
}
