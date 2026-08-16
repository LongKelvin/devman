/**
 * Runtime state persistence. The daemon is the sole owner of an in-memory
 * {@link RuntimeState}; {@link RuntimeStateStore} keeps it current and mirrors
 * every change to disk so the CLI (a separate process) can read state without
 * holding any child processes itself, and so a restarted daemon could recover
 * it in the future.
 */
import { readJsonFile, writeJsonFileAtomic } from '../utils/fs.js';
import type { RuntimeState, ServiceRuntime } from '../types/index.js';

/** Current on-disk schema version. Bump when the shape changes incompatibly. */
const STATE_VERSION = 1;

/** A freshly configured service that has never run yet. */
export function initialServiceRuntime(
  id: string,
  at: number,
): ServiceRuntime {
  return {
    id,
    status: 'configured',
    pid: null,
    startedAt: null,
    exitCode: null,
    exitSignal: null,
    restartCount: 0,
    health: 'unknown',
    updatedAt: at,
  };
}

/** Options to seed a fresh {@link RuntimeStateStore}. */
export interface RuntimeStateInit {
  readonly stateFile: string;
  readonly daemonPid: number;
  readonly daemonStartedAt: number;
  readonly socketPath: string;
  readonly serviceIds: readonly string[];
}

/** Fields of {@link ServiceRuntime} a caller may patch; `id` never changes. */
export type ServiceRuntimePatch = Partial<Omit<ServiceRuntime, 'id'>>;

/**
 * Owns the daemon's {@link RuntimeState} in memory and persists it to disk on
 * every change. Reads are synchronous (`snapshot`/`getService`); writes
 * (`updateService`/`flush`) are async and atomic (write-temp-then-rename), so
 * a reader of the state file never observes a partial write.
 */
export class RuntimeStateStore {
  private state: RuntimeState;
  /**
   * Tail of the write queue. Every `persist()` chains onto this so writes to
   * `stateFile` are strictly serialised — without it, two services changing
   * state close together (e.g. two health checks resolving in the same
   * event-loop tick) issue overlapping `rename`s onto the same destination,
   * which is not safe on Windows (see `writeJsonFileAtomic`).
   */
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly stateFile: string,
    initial: RuntimeState,
  ) {
    this.state = initial;
  }

  /** Build a fresh store with one `configured` record per service id. */
  static create(init: RuntimeStateInit): RuntimeStateStore {
    const services: Record<string, ServiceRuntime> = {};
    for (const id of init.serviceIds) {
      services[id] = initialServiceRuntime(id, init.daemonStartedAt);
    }
    const state: RuntimeState = {
      version: STATE_VERSION,
      daemonPid: init.daemonPid,
      daemonStartedAt: init.daemonStartedAt,
      socketPath: init.socketPath,
      services,
    };
    return new RuntimeStateStore(init.stateFile, state);
  }

  /** The full runtime document as it currently stands in memory. */
  snapshot(): RuntimeState {
    return this.state;
  }

  /** A single service's runtime record, if it exists. */
  getService(id: string): ServiceRuntime | undefined {
    return this.state.services[id];
  }

  /**
   * Merge `patch` into service `id`'s record (creating it if unseen), stamp
   * `updatedAt`, then persist the whole document atomically. Callers await
   * this so they can rely on the write having landed before responding.
   */
  async updateService(
    id: string,
    patch: ServiceRuntimePatch,
    at: number,
  ): Promise<void> {
    const current = this.state.services[id] ?? initialServiceRuntime(id, at);
    const updated: ServiceRuntime = {
      ...current,
      ...patch,
      id,
      updatedAt: at,
    };
    this.state = {
      ...this.state,
      services: { ...this.state.services, [id]: updated },
    };
    await this.persist();
  }

  /** Persist the current in-memory state to disk. Called once at startup. */
  async flush(): Promise<void> {
    await this.persist();
  }

  /**
   * Persist the current in-memory state, queued behind any write already in
   * flight. Each caller still awaits exactly its own write (and sees its own
   * rejection); a failed write doesn't block the ones queued after it.
   */
  private persist(): Promise<void> {
    const write = this.writeQueue.then(() =>
      writeJsonFileAtomic(this.stateFile, this.state),
    );
    this.writeQueue = write.catch(() => undefined);
    return write;
  }
}

/**
 * Read a persisted {@link RuntimeState} from disk. Returns `null` if the file
 * doesn't exist yet (e.g. the daemon has never run), and rethrows any other
 * error (bad JSON, permissions).
 */
export async function readRuntimeState(
  stateFile: string,
): Promise<RuntimeState | null> {
  try {
    return await readJsonFile<RuntimeState>(stateFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
