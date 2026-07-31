import { describe, expect, it } from 'vitest';
import { DependencyGraph } from '../../src/service/dependencyGraph.js';
import { parseServiceDefinition } from '../../src/config/validate.js';
import { DependencyCycleError } from '../../src/utils/errors.js';
import type { ServiceDefinition } from '../../src/types/index.js';

function svc(id: string, dependsOn: string[] = []): ServiceDefinition {
  return parseServiceDefinition({ id, command: 'true', dependsOn });
}

describe('DependencyGraph', () => {
  it('orders dependencies before dependents', () => {
    const graph = new DependencyGraph([
      svc('web', ['api']),
      svc('api', ['db']),
      svc('db'),
    ]);
    const order = graph.startOrder();
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
    expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'));
  });

  it('stop order is the reverse of start order', () => {
    const graph = new DependencyGraph([svc('a'), svc('b', ['a'])]);
    expect(graph.stopOrder()).toEqual(graph.startOrder().slice().reverse());
  });

  it('is deterministic and stable for independent services', () => {
    const graph = new DependencyGraph([svc('a'), svc('b'), svc('c')]);
    expect(graph.startOrder()).toEqual(['a', 'b', 'c']);
  });

  it('detects direct cycles', () => {
    const graph = new DependencyGraph([svc('a', ['b']), svc('b', ['a'])]);
    expect(() => graph.startOrder()).toThrow(DependencyCycleError);
  });

  it('detects self-cycles', () => {
    const graph = new DependencyGraph([svc('a', ['a'])]);
    expect(() => graph.startOrder()).toThrow(DependencyCycleError);
  });

  it('ignores dependency edges pointing outside the provided set', () => {
    // 'a' depends on 'external' which is not in the graph; it is skipped.
    const graph = new DependencyGraph([svc('a', ['external'])]);
    expect(graph.startOrder()).toEqual(['a']);
    expect(graph.dependenciesOf('a')).toEqual([]);
  });
});
