/**
 * IPC client. Opens one connection to the daemon and multiplexes requests over
 * it, correlating responses by id. Supports both single request/response calls
 * and streamed subscriptions (e.g. `logs --follow`).
 */
import { DevmanError } from '../utils/errors.js';
import type { IpcClientTransport, IpcConnection } from './transport.js';
import type {
  IpcMethod,
  IpcRequest,
  IpcResponse,
  IpcStreamMessage,
} from './protocol.js';

/** Default time to wait for a terminal response, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

interface PendingCall {
  readonly onStream: ((chunk: unknown) => void) | undefined;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Options for a single call. */
export interface CallOptions {
  /** Milliseconds to wait for the terminal response. `0` disables the timeout. */
  readonly timeoutMs?: number;
  /** Invoked for each streamed chunk before the terminal response. */
  readonly onStream?: (chunk: unknown) => void;
}

/** Client over an {@link IpcConnection}. Construct via {@link IpcClient.connect}. */
export class IpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  private constructor(private readonly connection: IpcConnection) {
    connection.onMessage((message) => this.onMessage(message));
    connection.onClose(() => this.onClose());
  }

  /** Dial the daemon and return a ready client. */
  static async connect(transport: IpcClientTransport): Promise<IpcClient> {
    const connection = await transport.connect();
    return new IpcClient(connection);
  }

  /**
   * Invoke a method and await its terminal result, optionally receiving
   * streamed chunks via {@link CallOptions.onStream}.
   */
  call<R>(
    method: IpcMethod,
    params: unknown,
    options: CallOptions = {},
  ): Promise<R> {
    const id = this.nextId++;
    const request: IpcRequest = { id, kind: 'request', method, params };
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<R>((resolve, reject) => {
      const pending: PendingCall = {
        onStream: options.onStream,
        resolve: (result) => resolve(result as R),
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.pending.delete(id);
                reject(
                  new DevmanError(
                    'IPC_TIMEOUT',
                    `IPC call "${method}" timed out after ${timeoutMs}ms.`,
                  ),
                );
              }, timeoutMs)
            : undefined,
      };
      this.pending.set(id, pending);

      this.connection.send(request).catch((error: unknown) => {
        this.settle(id)?.reject(error as Error);
      });
    });
  }

  /** Close the underlying connection. */
  close(): void {
    this.connection.close();
  }

  private onMessage(message: IpcResponse | IpcStreamMessage | unknown): void {
    const msg = message as IpcResponse | IpcStreamMessage;
    if (msg.kind === 'stream') {
      this.pending.get(msg.id)?.onStream?.(msg.chunk);
      return;
    }
    if (msg.kind === 'response') {
      const pending = this.settle(msg.id);
      if (!pending) return;
      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        const err = msg.error;
        pending.reject(
          new DevmanError(
            err?.code ?? 'IPC_ERROR',
            err?.message ?? 'IPC error',
            {
              ...(err?.hint ? { hint: err.hint } : {}),
            },
          ),
        );
      }
    }
  }

  private onClose(): void {
    for (const id of [...this.pending.keys()]) {
      this.settle(id)?.reject(
        new DevmanError('IPC_ERROR', 'Connection closed before response.'),
      );
    }
  }

  /** Remove and return a pending call, clearing its timer. */
  private settle(id: number): PendingCall | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }
}
