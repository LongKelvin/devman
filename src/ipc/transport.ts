/**
 * Transport abstraction. The IPC server and client depend on these interfaces,
 * not on `node:net`, so the wire (Unix domain socket today) can be swapped for
 * TCP, a named pipe, or an in-memory channel in tests without changing any
 * command logic.
 */
import type { IpcMessage } from './protocol.js';

/** A single bidirectional connection between client and server. */
export interface IpcConnection {
  /** Send one framed message. Rejects if the connection is closed. */
  send(message: IpcMessage): Promise<void>;
  /** Register a handler for inbound messages. */
  onMessage(handler: (message: IpcMessage) => void): void;
  /** Register a handler invoked once when the connection closes. */
  onClose(handler: () => void): void;
  /** Register a handler for transport-level errors. */
  onError(handler: (error: Error) => void): void;
  /** Close the connection. */
  close(): void;
}

/** Server side of a transport: accepts connections at an address. */
export interface IpcServerTransport {
  /** Start listening. Resolves once ready to accept connections. */
  listen(onConnection: (connection: IpcConnection) => void): Promise<void>;
  /** Stop listening and release the address. */
  close(): Promise<void>;
  /** The address being listened on (for diagnostics). */
  readonly address: string;
}

/** Client side of a transport: dials the server. */
export interface IpcClientTransport {
  /** Open a connection to the server. Rejects if it cannot connect. */
  connect(): Promise<IpcConnection>;
}
