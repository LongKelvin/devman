/**
 * Shared CLI context. Resolves the global options common to every command
 * (base directory, config directory, log level) into the objects commands need,
 * keeping option parsing in one place.
 */
import { resolvePaths, type DevmanPaths } from '../config/paths.js';
import {
  ConsoleLogger,
  parseLogLevel,
  type Logger,
} from '../logging/logger.js';

/** Global options accepted before any subcommand. */
export interface GlobalOptions {
  /** Base directory override (`--home`). */
  readonly home?: string;
  /** Config directory override (`--config`). */
  readonly config?: string;
  /** Verbose logging (`--verbose`). */
  readonly verbose?: boolean;
}

/** Everything a command needs, derived once from global options. */
export interface CliContext {
  readonly paths: DevmanPaths;
  readonly logger: Logger;
}

/** Build a {@link CliContext} from parsed global options. */
export function createContext(options: GlobalOptions): CliContext {
  const paths = resolvePaths({
    ...(options.home !== undefined ? { home: options.home } : {}),
    ...(options.config !== undefined ? { configDir: options.config } : {}),
  });
  const level = parseLogLevel(
    options.verbose ? 'debug' : process.env.DEVMAN_LOG_LEVEL,
    'info',
  );
  return { paths, logger: new ConsoleLogger(level) };
}
