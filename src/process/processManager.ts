/**
 * Orchestrates all service supervisors.
 *
 * The {@link ProcessManager} is the daemon's process-control surface. It owns
 * one {@link ServiceSupervisor} per configured service and applies dependency
 * ordering when starting and stopping sets of services. Individual-service
 * concerns (spawning, restart policy, logging) are delegated to the supervisors;
 * this class only decides *what* to act on and in *what order*.
 */
import { ServiceSupervisor } from './serviceSupervisor.js';
import { DependencyGraph } from '../service/dependencyGraph.js';
import { ServiceNotFoundError } from '../utils/errors.js';
import type { EventBus } from '../runtime/events.js';
import type { Logger } from '../logging/logger.js';
import type { RuntimeStateStore } from '../runtime/state.js';
import type { DevmanConfig } from '../config/loader.js';
import type { DevmanPaths } from '../config/paths.js';
import type { ServiceRuntime } from '../types/index.js';

/** Collaborators the process manager needs. */
export interface ProcessManagerDependencies {
  readonly paths: DevmanPaths;
  readonly config: DevmanConfig;
  readonly state: RuntimeStateStore;
  readonly events: EventBus;
  readonly logger: Logger;
}

/** Coordinates supervisors with dependency-aware ordering. */
export class ProcessManager {
  private readonly supervisors: ReadonlyMap<string, ServiceSupervisor>;
  private readonly graph: DependencyGraph;
  private readonly logger: Logger;

  constructor(private readonly deps: ProcessManagerDependencies) {
    this.logger = deps.logger.child('pm');
    this.graph = new DependencyGraph(deps.config.services);
    const supervisors = new Map<string, ServiceSupervisor>();
    for (const service of deps.config.services) {
      supervisors.set(
        service.id,
        new ServiceSupervisor(service, {
          paths: deps.paths,
          state: deps.state,
          events: deps.events,
          logger: deps.logger,
        }),
      );
    }
    this.supervisors = supervisors;
  }

  /**
   * Start the given services (default: all enabled), preceded by their
   * dependencies, in topological order. Returns the resulting runtime records.
   */
  async start(ids?: readonly string[]): Promise<ServiceRuntime[]> {
    const targets = this.expandWithDependencies(this.resolveTargets(ids));
    const ordered = this.graph.startOrder().filter((id) => targets.has(id));

    this.logger.info('Starting services', { order: ordered });
    for (const id of ordered) {
      await this.supervisorFor(id).start();
    }
    return this.runtimeFor(ordered);
  }

  /**
   * Stop the given services (default: all), in reverse dependency order so
   * dependents stop before the services they rely on.
   */
  async stop(ids?: readonly string[]): Promise<ServiceRuntime[]> {
    const targets = this.resolveTargets(ids);
    const ordered = this.graph.stopOrder().filter((id) => targets.has(id));

    this.logger.info('Stopping services', { order: ordered });
    for (const id of ordered) {
      await this.supervisorFor(id).stop();
    }
    return this.runtimeFor(ordered);
  }

  /** Restart the given services (default: all) respecting ordering. */
  async restart(ids?: readonly string[]): Promise<ServiceRuntime[]> {
    const targets = this.resolveTargets(ids);
    await this.stop([...targets]);
    return this.start([...targets]);
  }

  /** Stop every running service. Used during daemon shutdown. */
  async stopAll(): Promise<void> {
    await this.stop();
    await Promise.all([...this.supervisors.values()].map((s) => s.dispose()));
  }

  /** Runtime record for a single service. */
  info(id: string): ServiceRuntime {
    if (!this.supervisors.has(id)) throw new ServiceNotFoundError(id);
    const runtime = this.deps.state.getService(id);
    if (!runtime) throw new ServiceNotFoundError(id);
    return runtime;
  }

  /** Resolve the target set from ids (or all enabled services by default). */
  private resolveTargets(ids?: readonly string[]): Set<string> {
    if (!ids || ids.length === 0) {
      return new Set(this.deps.config.enabledServiceIds());
    }
    for (const id of ids) {
      if (!this.supervisors.has(id)) throw new ServiceNotFoundError(id);
    }
    return new Set(ids);
  }

  /** Add the transitive dependencies of each target to the set. */
  private expandWithDependencies(targets: Set<string>): Set<string> {
    const expanded = new Set(targets);
    const visit = (id: string): void => {
      for (const dep of this.graph.dependenciesOf(id)) {
        if (!expanded.has(dep)) {
          expanded.add(dep);
          visit(dep);
        }
      }
    };
    for (const id of targets) visit(id);
    return expanded;
  }

  private supervisorFor(id: string): ServiceSupervisor {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) throw new ServiceNotFoundError(id);
    return supervisor;
  }

  private runtimeFor(ids: readonly string[]): ServiceRuntime[] {
    return ids.map((id) => this.info(id));
  }
}
