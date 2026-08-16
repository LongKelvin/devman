#!/usr/bin/env node
/**
 * Daemon entry point. Invoked as a detached child by the CLI (see
 * {@link bootstrap}). Reads its base directory from the environment, loads
 * configuration, constructs the {@link Daemon} and runs until stopped.
 *
 * Kept deliberately thin: parse environment → build dependencies → run. All
 * behaviour lives in {@link Daemon} and its collaborators.
 */
import { resolvePaths } from '../config/paths.js';
import { loadConfig } from '../config/loader.js';
import { ConsoleLogger, parseLogLevel } from '../logging/logger.js';
import { Daemon } from './daemon.js';
import { toDevmanError } from '../utils/errors.js';
import type { Logger } from '../logging/logger.js';

/**
 * Log and survive an error that would otherwise crash the daemon process
 * uncaught. The daemon supervises every service on the host, and a fully
 * detached background process gives the user no chance to notice a silent
 * exit — so an isolated failure (a flaky state-file write, a bug in a rarely
 * hit code path) must not take the whole stack down with it. This is a
 * last-resort net, not a substitute for handling errors at the source.
 */
function installCrashSafetyNet(logger: Logger): void {
  const survive = (kind: string) => (error: unknown) => {
    const devErr = toDevmanError(error);
    logger.error(`Unhandled ${kind}; daemon continues running`, {
      code: devErr.code,
      message: devErr.message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  };
  process.on('uncaughtException', survive('exception'));
  process.on('unhandledRejection', survive('rejection'));
}

async function main(): Promise<void> {
  const paths = resolvePaths();
  const logger = new ConsoleLogger(
    parseLogLevel(process.env.DEVMAN_LOG_LEVEL, 'info'),
  );
  installCrashSafetyNet(logger);

  const config = await loadConfig(paths);
  const daemon = new Daemon({ paths, config, logger });

  await daemon.start();
  await daemon.waitUntilStopped();
}

main().catch((error: unknown) => {
  const devErr = toDevmanError(error);
  process.stderr.write(`daemon fatal: ${devErr.code} ${devErr.message}\n`);
  process.exitCode = 1;
});
