/**
 * Idempotency port for inbound webhooks. CloudShare may deliver the same event more
 * than once (retries, replays), so every event is reduced to a synthesised key and
 * checked here before it is acted on. The store is the at-most-once gate; the
 * polling reconcile is the safety net that keeps even a slipped-through duplicate
 * harmless. Implemented in the persistence layer.
 */
export interface WebhookIdempotencyStore {
  /**
   * Atomically record a key. Returns `true` if it had not been seen before (and is
   * now recorded), `false` if it is a duplicate that should not be reprocessed.
   */
  markIfNew(key: string): Promise<boolean>;
}
