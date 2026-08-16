/**
 * Registers the process-lifecycle IPC handlers on an {@link IpcServer}.
 *
 * Keeping these out of the {@link Daemon} class keeps that class focused on
 * lifecycle wiring and makes the request→action mapping easy to read and test.
 * Each handler translates typed IPC params into a {@link ProcessManager} call
 * and shapes the typed result.
 */
import { logFilePath, readLogTail } from '../logging/serviceLogger.js';
import type { IpcServer } from '../ipc/server.js';
import type { ProcessManager } from '../process/processManager.js';
import type { EventBus } from '../runtime/events.js';
import type { RuntimeStateStore } from '../runtime/state.js';
import type { DevmanPaths } from '../config/paths.js';
import type {
  InfoResult,
  LifecycleResult,
  LogChunk,
  LogsParams,
  ServiceSelector,
} from '../ipc/protocol.js';

/** Default number of historical lines returned by `logs`. */
const DEFAULT_TAIL_LINES = 100;

/** Collaborators the lifecycle handlers need. */
export interface LifecycleHandlerDependencies {
  readonly processes: ProcessManager;
  readonly events: EventBus;
  readonly paths: DevmanPaths;
  readonly state: RuntimeStateStore;
}

/** Resolve a selector to explicit service ids (empty = manager's default). */
function selectorToIds(params: unknown): string[] | undefined {
  const selector = (params ?? {}) as ServiceSelector;
  if (selector.ids && selector.ids.length > 0) return [...selector.ids];
  return undefined;
}

/** Register `start`/`stop`/`restart`/`info`/`logs` on the IPC server. */
export function registerLifecycleHandlers(
  ipc: IpcServer,
  deps: LifecycleHandlerDependencies,
): void {
  ipc.handle('start', async (params): Promise<LifecycleResult> => {
    const selector = (params ?? {}) as ServiceSelector;
    const services = await deps.processes.start(selectorToIds(params));
    // Informational only: records which profile this start targeted (or
    // `null` for an unscoped start) so `status`/`doctor`/`list` can show it.
    await deps.state.setActiveProfile(selector.profile ?? null);
    return { services };
  });

  ipc.handle('stop', async (params): Promise<LifecycleResult> => {
    const selector = (params ?? {}) as ServiceSelector;
    const services = await deps.processes.stop(selectorToIds(params));
    // Only clear the recorded profile if this stop targeted exactly the one
    // that's active — a scoped stop of some other profile (or an unscoped
    // stop that the caller turns into a full shutdown) shouldn't erase it.
    if (
      selector.profile &&
      deps.state.snapshot().activeProfile === selector.profile
    ) {
      await deps.state.setActiveProfile(null);
    }
    return { services };
  });

  ipc.handle('restart', async (params): Promise<LifecycleResult> => {
    const services = await deps.processes.restart(selectorToIds(params));
    return { services };
  });

  ipc.handle('info', async (params): Promise<InfoResult> => {
    const { serviceId } = params as { serviceId: string };
    return { runtime: deps.processes.info(serviceId) };
  });

  ipc.handle('logs', async (params, ctx): Promise<{ done: true }> => {
    const { serviceId, tail, follow } = params as LogsParams;
    // Validate the id up front so an unknown service errors immediately.
    deps.processes.info(serviceId);

    const historical = await readLogTail(
      logFilePath(deps.paths, serviceId),
      tail ?? DEFAULT_TAIL_LINES,
    );
    for (const line of historical) {
      await ctx.stream(line);
    }

    if (!follow) return { done: true };

    // Stream new lines until the client disconnects.
    const unsubscribe = deps.events.on('LogReceived', (event) => {
      if (event.serviceId !== serviceId) return;
      const chunk: LogChunk = {
        serviceId: event.serviceId,
        stream: event.stream,
        line: event.line,
        timestamp: event.at,
      };
      void ctx.stream(chunk.line);
    });

    await ctx.closed;
    unsubscribe();
    return { done: true };
  });
}
