/**
 * IPC server. Owns a {@link IpcServerTransport}, decodes requests, dispatches
 * them to registered {@link MethodHandler}s, and frames the results back to the
 * client. Handlers are registered by method name, so new commands are added
 * without touching the transport or the dispatch loop.
 */
import { toDevmanError } from '../utils/errors.js';
import type { Logger } from '../logging/logger.js';
import type { IpcConnection, IpcServerTransport } from './transport.js';
import type {
  IpcMethod,
  IpcRequest,
  IpcResponse,
  IpcStreamMessage,
} from './protocol.js';

/**
 * Context passed to a handler. `stream` emits a non-terminal chunk for the
 * current request; the value returned by the handler becomes the terminal
 * response result.
 */
export interface HandlerContext {
  readonly request: IpcRequest;
  /** Emit a streamed chunk to the client for this request. */
  stream(chunk: unknown): Promise<void>;
  /** Resolves when the client disconnects (for cancelling follow streams). */
  readonly closed: Promise<void>;
}

/** A handler for a single IPC method. Returns the response result. */
export type MethodHandler = (
  params: unknown,
  ctx: HandlerContext,
) => Promise<unknown>;

/** Registry + dispatch loop for IPC requests. */
export class IpcServer {
  private readonly handlers = new Map<IpcMethod, MethodHandler>();

  constructor(
    private readonly transport: IpcServerTransport,
    private readonly logger: Logger,
  ) {}

  /** Register (or replace) the handler for a method. */
  handle(method: IpcMethod, handler: MethodHandler): this {
    this.handlers.set(method, handler);
    return this;
  }

  /** Begin accepting connections. */
  async start(): Promise<void> {
    await this.transport.listen((connection) => this.onConnection(connection));
    this.logger.info('IPC server listening', {
      address: this.transport.address,
    });
  }

  /** Stop accepting connections and release the address. */
  async stop(): Promise<void> {
    await this.transport.close();
    this.logger.info('IPC server stopped');
  }

  private onConnection(connection: IpcConnection): void {
    let closed = false;
    const closePromise = new Promise<void>((resolve) => {
      connection.onClose(() => {
        closed = true;
        resolve();
      });
    });
    connection.onError((error) =>
      this.logger.debug('IPC connection error', { error: error.message }),
    );
    connection.onMessage((message) => {
      if (message.kind !== 'request') return;
      void this.dispatch(connection, message, closePromise, () => closed);
    });
  }

  private async dispatch(
    connection: IpcConnection,
    request: IpcRequest,
    closed: Promise<void>,
    isClosed: () => boolean,
  ): Promise<void> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      await this.reply(connection, {
        id: request.id,
        kind: 'response',
        ok: false,
        error: {
          code: 'IPC_ERROR',
          message: `Unknown method: ${request.method}`,
        },
      });
      return;
    }

    const ctx: HandlerContext = {
      request,
      closed,
      stream: async (chunk: unknown) => {
        if (isClosed()) return;
        const streamMessage: IpcStreamMessage = {
          id: request.id,
          kind: 'stream',
          chunk,
        };
        await connection.send(streamMessage);
      },
    };

    try {
      const result = await handler(request.params, ctx);
      await this.reply(connection, {
        id: request.id,
        kind: 'response',
        ok: true,
        result,
      });
    } catch (error) {
      const devErr = toDevmanError(error);
      this.logger.warn('IPC handler failed', {
        method: request.method,
        code: devErr.code,
        message: devErr.message,
      });
      await this.reply(connection, {
        id: request.id,
        kind: 'response',
        ok: false,
        error: {
          code: devErr.code,
          message: devErr.message,
          ...(devErr.hint ? { hint: devErr.hint } : {}),
        },
      });
    }
  }

  private async reply(
    connection: IpcConnection,
    response: IpcResponse,
  ): Promise<void> {
    try {
      await connection.send(response);
    } catch (error) {
      this.logger.debug('Failed to send IPC response', {
        error: (error as Error).message,
      });
    }
  }
}
