/**
 * IPC wire protocol shared by the CLI (client) and daemon (server).
 *
 * The protocol is transport-agnostic: messages are plain JSON objects framed as
 * newline-delimited JSON (see {@link codec}). Keeping the message *shapes* here,
 * separate from any socket code, is what lets the transport be replaced (Unix
 * socket today, TCP or named pipe later) without touching command logic.
 *
 * Every exchange is request/response and correlated by `id`. A single request
 * may yield multiple `stream` messages (e.g. live logs) terminated by a final
 * `response`, enabling long-lived subscriptions over one connection.
 */
import type { RuntimeState, ServiceRuntime } from '../types/index.js';
import type { ErrorCode } from '../utils/errors.js';

/** Method names the daemon understands. Extend here to add commands. */
export type IpcMethod =
  | 'ping'
  | 'status'
  | 'start'
  | 'stop'
  | 'restart'
  | 'info'
  | 'logs'
  | 'shutdown';

/** A request sent from client to daemon. */
export interface IpcRequest<P = unknown> {
  /** Correlation id, unique per client connection. */
  readonly id: number;
  readonly kind: 'request';
  readonly method: IpcMethod;
  /** Method-specific parameters. */
  readonly params: P;
}

/** A terminal response to a request. */
export interface IpcResponse<R = unknown> {
  readonly id: number;
  readonly kind: 'response';
  readonly ok: boolean;
  /** Present when `ok` is true. */
  readonly result?: R;
  /** Present when `ok` is false. */
  readonly error?: IpcErrorPayload;
}

/** A non-terminal streamed chunk for a request (e.g. a log line). */
export interface IpcStreamMessage<C = unknown> {
  readonly id: number;
  readonly kind: 'stream';
  readonly chunk: C;
}

/** Serialisable error, mirroring {@link DevmanError}. */
export interface IpcErrorPayload {
  readonly code: ErrorCode;
  readonly message: string;
  readonly hint?: string;
}

/** Any message that can travel over the wire. */
export type IpcMessage = IpcRequest | IpcResponse | IpcStreamMessage;

/* ------------------------------------------------------------------ */
/* Method parameter / result contracts                                 */
/* ------------------------------------------------------------------ */

/** Params for methods that target a set of services. */
export interface ServiceSelector {
  /** Explicit service ids. Empty means "all enabled" unless `profile` is set. */
  readonly ids?: readonly string[];
  /** Profile id whose members should be targeted. */
  readonly profile?: string;
}

/** Result of `ping`. */
export interface PingResult {
  readonly pong: true;
  readonly daemonPid: number;
  readonly version: string;
}

/** Result of `status`. */
export interface StatusResult {
  readonly state: RuntimeState;
}

/** Result of a lifecycle action (`start`/`stop`/`restart`). */
export interface LifecycleResult {
  /** Per-service outcome, in the order the action was applied. */
  readonly services: readonly ServiceRuntime[];
}

/** Result of `info`. */
export interface InfoResult {
  readonly runtime: ServiceRuntime;
}

/** Params for `logs`. */
export interface LogsParams {
  readonly serviceId: string;
  /** Emit the last N lines before streaming. */
  readonly tail?: number;
  /** Keep the connection open and stream new lines. */
  readonly follow?: boolean;
}

/** A streamed log chunk. */
export interface LogChunk {
  readonly serviceId: string;
  readonly stream: 'stdout' | 'stderr';
  readonly line: string;
  readonly timestamp: number;
}
