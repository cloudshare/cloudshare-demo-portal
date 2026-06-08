import type {
  IntegrationEvent,
  IntegrationEventOf,
  IntegrationEventPublisher,
  IntegrationEventType,
} from "./integration-event";

/**
 * A minimal in-process pub/sub bus for IntegrationEvents. Publishers (e.g. the
 * booking use case) depend only on {@link IntegrationEventPublisher}; subscribers
 * (e.g. the lab-launch flow) register handlers by event type.
 *
 * Handlers are isolated: one throwing handler never stops the others, and its
 * error is routed to `onError` rather than escaping `publish`. This keeps event
 * delivery safe in the face of partial failure, as the integration brief requires.
 */

export type IntegrationEventHandler<T extends IntegrationEventType> = (
  event: IntegrationEventOf<T>,
) => void | Promise<void>;

export interface IntegrationEventBus extends IntegrationEventPublisher {
  subscribe<T extends IntegrationEventType>(
    type: T,
    handler: IntegrationEventHandler<T>,
  ): void;
}

export interface EventBusOptions {
  /** Invoked when a handler throws, instead of failing the publish. */
  readonly onError?: (error: unknown, event: IntegrationEvent) => void;
}

/** Storage type: the variance between specific and general handlers is reconciled
 * at the subscribe boundary; runtime routing by `event.type` guarantees a handler
 * only ever receives events of the type it registered for. */
type AnyHandler = (event: IntegrationEvent) => void | Promise<void>;

export function createInMemoryEventBus(opts: EventBusOptions = {}): IntegrationEventBus {
  const handlers = new Map<IntegrationEventType, AnyHandler[]>();

  return {
    subscribe(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler as unknown as AnyHandler);
      handlers.set(type, list);
    },

    async publish(event: IntegrationEvent): Promise<void> {
      for (const handler of handlers.get(event.type) ?? []) {
        try {
          await handler(event);
        } catch (error) {
          opts.onError?.(error, event);
        }
      }
    },
  };
}
