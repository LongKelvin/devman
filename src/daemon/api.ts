/** Barrel re-export for the daemon module (excludes the executable entry). */
export { Daemon, DAEMON_VERSION } from './daemon.js';
export type { DaemonDependencies } from './daemon.js';
export { ensureDaemon, pingDaemon } from './bootstrap.js';
export type { BootstrapOptions } from './bootstrap.js';
export {
  acquirePidFile,
  releasePidFile,
  readLiveDaemonPid,
  readPid,
  isProcessAlive,
} from './pidfile.js';
