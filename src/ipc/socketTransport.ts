/**
 * Unix-domain-socket transport (also valid for Windows named pipes, since
 * `node:net` accepts a pipe path as `path`). Implements the transport
 * interfaces in terms of {@link NdjsonDecoder} framing.
 */
import { createServer, connect, type Socket, type Server } from 'node:net';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ensureDir, pathExists } from '../utils/fs.js';
import { DevmanError } from '../utils/errors.js';
import { encodeMessage, NdjsonDecoder } from './codec.js';
import type {
  IpcClientTransport,
  IpcConnection,
  IpcServerTransport,
} from './transport.js';
import type { IpcMessage } from './protocol.js';

/** Wrap a `node:net` socket as an {@link IpcConnection}. */
function wrapSocket(socket: Socket): IpcConnection {
  const decoder = new NdjsonDecoder();
  const messageHandlers: Array<(m: IpcMessage) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const errorHandlers: Array<(e: Error) => void> = [];

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    let messages: IpcMessage[];
    try {
      messages = decoder.push(chunk);
    } catch (error) {
      for (const handler of errorHandlers) handler(error as Error);
      return;
    }
    for (const message of messages) {
      for (const handler of messageHandlers) handler(message);
    }
  });
  socket.on('close', () => {
    for (const handler of closeHandlers) handler();
  });
  socket.on('error', (error: Error) => {
    for (const handler of errorHandlers) handler(error);
  });

  return {
    send(message: IpcMessage): Promise<void> {
      return new Promise((resolve, reject) => {
        if (socket.writableEnded || socket.destroyed) {
          reject(new DevmanError('IPC_ERROR', 'Connection is closed.'));
          return;
        }
        socket.write(encodeMessage(message), (error) =>
          error ? reject(error) : resolve(),
        );
      });
    },
    onMessage(handler): void {
      messageHandlers.push(handler);
    },
    onClose(handler): void {
      closeHandlers.push(handler);
    },
    onError(handler): void {
      errorHandlers.push(handler);
    },
    close(): void {
      socket.end();
    },
  };
}

/** Server transport backed by a listening Unix socket. */
export class SocketServerTransport implements IpcServerTransport {
  private server: Server | undefined;

  constructor(readonly address: string) {}

  async listen(
    onConnection: (connection: IpcConnection) => void,
  ): Promise<void> {
    await ensureDir(dirname(this.address));
    // Remove a stale socket file left by a previous crash.
    if (await pathExists(this.address)) {
      await rm(this.address, { force: true });
    }

    const server = createServer((socket) => onConnection(wrapSocket(socket)));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(this.address, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.server = undefined;
    await rm(this.address, { force: true }).catch(() => {});
  }
}

/** Client transport that dials a Unix socket. */
export class SocketClientTransport implements IpcClientTransport {
  constructor(private readonly address: string) {}

  connect(): Promise<IpcConnection> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.address);
      const onError = (error: NodeJS.ErrnoException): void => {
        socket.destroy();
        reject(
          new DevmanError(
            'IPC_ERROR',
            `Cannot connect to daemon: ${error.message}`,
            {
              cause: error,
            },
          ),
        );
      };
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.removeListener('error', onError);
        resolve(wrapSocket(socket));
      });
    });
  }
}
