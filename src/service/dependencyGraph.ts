/**
 * Dependency resolution for services.
 *
 * Services form a directed acyclic graph via their `dependsOn` edges.
 * {@link DependencyGraph} computes a start order (dependencies before
 * dependents) using a deterministic topological sort, and the reverse for
 * shutdown. Cycles are reported as {@link DependencyCycleError}.
 */
import { DependencyCycleError } from '../utils/errors.js';
import type { ServiceDefinition } from '../types/index.js';

/**
 * Immutable dependency graph over a set of services. Only edges between the
 * provided services are considered, so passing a subset (e.g. a profile)
 * yields an order restricted to that subset.
 */
export class DependencyGraph {
  /** Adjacency: service id → ids it directly depends on (within the set). */
  private readonly dependencies: ReadonlyMap<string, readonly string[]>;
  private readonly ids: readonly string[];

  constructor(services: readonly ServiceDefinition[]) {
    const ids = services.map((s) => s.id);
    const idSet = new Set(ids);
    const deps = new Map<string, string[]>();
    for (const service of services) {
      // Restrict edges to the provided set so subsets resolve independently.
      deps.set(
        service.id,
        service.dependsOn.filter((d) => idSet.has(d)),
      );
    }
    this.ids = ids;
    this.dependencies = deps;
  }

  /** Direct dependencies of a service (within the graph's set). */
  dependenciesOf(id: string): readonly string[] {
    return this.dependencies.get(id) ?? [];
  }

  /**
   * Return service ids in start order: every service appears after all of its
   * dependencies. Deterministic — ties break on declaration order. Throws
   * {@link DependencyCycleError} if the graph contains a cycle.
   */
  startOrder(): string[] {
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const order: string[] = [];
    const path: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (onStack.has(id)) {
        const cycleStart = path.indexOf(id);
        throw new DependencyCycleError([...path.slice(cycleStart), id]);
      }
      onStack.add(id);
      path.push(id);
      for (const dep of this.dependencies.get(id) ?? []) visit(dep);
      path.pop();
      onStack.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.ids) visit(id);
    return order;
  }

  /** Reverse of {@link startOrder}: dependents stop before their dependencies. */
  stopOrder(): string[] {
    return this.startOrder().reverse();
  }
}
