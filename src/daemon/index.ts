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

async function main(): Promise<void> {
  const paths = resolvePaths();
  const logger = new ConsoleLogger(
    parseLogLevel(process.env.DEVMAN_LOG_LEVEL, 'info'),
  );

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
