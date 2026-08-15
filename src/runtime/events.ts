/**
 * Internal event bus. Decouples process supervision (which knows *when*
 * something happened) from cross-cutting consumers (log streaming, future
 * notifications/metrics) that only care *that* it happened. Every event is a
 * plain, typed payload — see {@link EventMap} for the full catalogue.
 */
import type { HealthStatus } from '../types/index.js';
import type { LogStreamName } from '../logging/serviceLogger.js';

/** A service process was spawned. */
export interface ServiceStartedEvent {
  readonly serviceId: string;
  readonly pid: number;
  readonly at: number;
}

/** A service process exited, whether requested or not. */
export interface ServiceStoppedEvent {
  readonly serviceId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly at: number;
  /** True when the exit followed a `stop()` call; false for an unexpected clean exit. */
  readonly expected: boolean;
}

/** A service process exited unexpectedly with a non-zero code/signal. */
export interface ServiceFailedEvent {
  readonly serviceId: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly at: number;
}

/** A supervisor is about to respawn a service after a crash. */
export interface ServiceRestartingEvent {
  readonly serviceId: string;
  /** 1-based restart attempt count for the current supervision. */
  readonly attempt: number;
  readonly at: number;
}

/** A line of captured stdout/stderr was written to a service's log. */
export interface LogReceivedEvent {
  readonly serviceId: string;
  readonly stream: LogStreamName;
  readonly line: string;
  readonly at: number;
}

/** A service's health check result changed. */
export interface HealthChangedEvent {
  readonly serviceId: string;
  readonly health: HealthStatus;
  readonly at: number;
}

/** Every event name mapped to its payload type. */
export interface EventMap {
  ServiceStarted: ServiceStartedEvent;
  ServiceStopped: ServiceStoppedEvent;
  ServiceFailed: ServiceFailedEvent;
  ServiceRestarting: ServiceRestartingEvent;
  LogReceived: LogReceivedEvent;
  HealthChanged: HealthChangedEvent;
}

/** Valid event names. */
export type EventName = keyof EventMap;

/** A listener for a specific event's typed payload. */
export type EventListener<K extends EventName> = (
  payload: EventMap[K],
) => void;

/** Unsubscribe function returned by {@link EventBus.on}. */
export type Unsubscribe = () => void;

/**
 * A minimal typed pub/sub bus. One instance per daemon, shared by the process
 * manager (publisher) and IPC handlers (subscriber, e.g. for `logs --follow`).
 */
export class EventBus {
  private readonly listeners = new Map<
    EventName,
    Set<(payload: unknown) => void>
  >();

  /** Subscribe to an event. Returns a function that unsubscribes. */
  on<K extends EventName>(event: K, listener: EventListener<K>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  /** Publish an event to every current subscriber. */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Snapshot the set so a listener unsubscribing mid-emit doesn't affect
    // this dispatch pass.
    for (const listener of [...set]) {
      listener(payload);
    }
  }

  /** Remove every listener for every event. Used on daemon shutdown. */
  clear(): void {
    this.listeners.clear();
  }
}
