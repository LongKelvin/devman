/** Barrel re-export for the IPC module. */
export { IpcServer } from './server.js';
export type { HandlerContext, MethodHandler } from './server.js';
export { IpcClient } from './client.js';
export type { CallOptions } from './client.js';
export { encodeMessage, NdjsonDecoder } from './codec.js';
export {
  SocketServerTransport,
  SocketClientTransport,
} from './socketTransport.js';
export type {
  IpcClientTransport,
  IpcConnection,
  IpcServerTransport,
} from './transport.js';
export type * from './protocol.js';
