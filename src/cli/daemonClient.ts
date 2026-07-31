/**
 * CLI-side helper for talking to the daemon over IPC. Encapsulates connecting,
 * running a single call, and always closing the connection, so command handlers
 * stay focused on presentation.
 */
import { IpcClient, type CallOptions } from '../ipc/client.js';
import { SocketClientTransport } from '../ipc/socketTransport.js';
import { pingDaemon } from '../daemon/bootstrap.js';
import { DaemonNotRunningError } from '../utils/errors.js';
import type { DevmanPaths } from '../config/paths.js';
import type { IpcMethod } from '../ipc/protocol.js';

/**
 * Connect to the daemon, run `fn` with a client, and close the connection.
 * Throws {@link DaemonNotRunningError} if no daemon is reachable.
 */
export async function withDaemon<T>(
  paths: DevmanPaths,
  fn: (client: IpcClient) => Promise<T>,
): Promise<T> {
  if ((await pingDaemon(paths)) === null) {
    throw new DaemonNotRunningError();
  }
  const client = await IpcClient.connect(
    new SocketClientTransport(paths.socketPath),
  );
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

/** Run a single request/response call against the daemon. */
export async function callDaemon<R>(
  paths: DevmanPaths,
  method: IpcMethod,
  params: unknown,
  options?: CallOptions,
): Promise<R> {
  return withDaemon(paths, (client) => client.call<R>(method, params, options));
}
