import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/runtime/events.js';

describe('EventBus', () => {
  it('delivers events to subscribers with typed payloads', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.on('ServiceStarted', (p) => seen.push(p.pid));
    bus.emit('ServiceStarted', { serviceId: 'a', pid: 42, at: 1 });
    expect(seen).toEqual([42]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const off = bus.on('ServiceStopped', listener);
    off();
    bus.emit('ServiceStopped', {
      serviceId: 'a',
      exitCode: 0,
      signal: null,
      at: 1,
      expected: true,
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it('only notifies listeners of the emitted event', () => {
    const bus = new EventBus();
    const started = vi.fn();
    const stopped = vi.fn();
    bus.on('ServiceStarted', started);
    bus.on('ServiceStopped', stopped);
    bus.emit('ServiceStarted', { serviceId: 'a', pid: 1, at: 1 });
    expect(started).toHaveBeenCalledOnce();
    expect(stopped).not.toHaveBeenCalled();
  });

  it('clear removes every listener', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.on('ServiceStarted', listener);
    bus.clear();
    bus.emit('ServiceStarted', { serviceId: 'a', pid: 1, at: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
