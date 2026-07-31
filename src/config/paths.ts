/**
 * Central resolution of every filesystem path devman uses.
 *
 * All paths derive from a single base directory so the tool stays generic and
 * free of workspace-specific assumptions. Resolution order for the base:
 *
 *   1. explicit `home` argument (e.g. a `--home` flag),
 *   2. the `DEVMAN_HOME` environment variable,
 *   3. the current working directory.
 *
 * Config, logs and runtime directories can each be overridden independently via
 * environment variables, matching how tools like git and docker expose XDG-style
 * overrides.
 */
import { isAbsolute, resolve } from 'node:path';

/** Fully-resolved set of paths used throughout the daemon and CLI. */
export interface DevmanPaths {
  /** Base directory all other paths derive from. */
  readonly home: string;
  /** Directory containing `services.json` and `profiles.json`. */
  readonly configDir: string;
  /** Path to the services configuration file. */
  readonly servicesFile: string;
  /** Path to the profiles configuration file. */
  readonly profilesFile: string;
  /** Directory for per-service log files. */
  readonly logsDir: string;
  /** Directory for runtime artifacts (state, pid, socket). */
  readonly runtimeDir: string;
  /** Path to the persisted runtime-state document. */
  readonly stateFile: string;
  /** Path to the daemon PID file. */
  readonly pidFile: string;
  /** Path to the IPC socket (or named pipe on Windows). */
  readonly socketPath: string;
}

/** Options for {@link resolvePaths}. */
export interface ResolvePathsOptions {
  /** Explicit base directory; overrides `DEVMAN_HOME`. */
  readonly home?: string;
  /** Explicit config directory; overrides `DEVMAN_CONFIG_DIR`. */
  readonly configDir?: string;
  /** Environment to read overrides from. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Base for resolving relative inputs. Defaults to `process.cwd()`. */
  readonly cwd?: string;
}

/** Resolve `candidate` against `base` unless it is already absolute. */
function resolveFrom(base: string, candidate: string): string {
  return isAbsolute(candidate) ? candidate : resolve(base, candidate);
}

/**
 * Compute the {@link DevmanPaths} for the current invocation.
 *
 * On Windows the IPC endpoint uses the named-pipe namespace; elsewhere it is a
 * Unix domain socket inside the runtime directory.
 */
export function resolvePaths(options: ResolvePathsOptions = {}): DevmanPaths {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();

  const home = resolveFrom(cwd, options.home ?? env.DEVMAN_HOME ?? cwd);

  const configDir = resolveFrom(
    home,
    options.configDir ?? env.DEVMAN_CONFIG_DIR ?? 'config',
  );
  const logsDir = resolveFrom(home, env.DEVMAN_LOGS_DIR ?? 'logs');
  const runtimeDir = resolveFrom(home, env.DEVMAN_RUNTIME_DIR ?? 'runtime');

  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\devman-${Buffer.from(runtimeDir).toString('hex').slice(0, 16)}`
      : resolve(runtimeDir, 'daemon.sock');

  return {
    home,
    configDir,
    servicesFile: resolve(configDir, 'services.json'),
    profilesFile: resolve(configDir, 'profiles.json'),
    logsDir,
    runtimeDir,
    stateFile: resolve(runtimeDir, 'state.json'),
    pidFile: resolve(runtimeDir, 'daemon.pid'),
    socketPath,
  };
}
