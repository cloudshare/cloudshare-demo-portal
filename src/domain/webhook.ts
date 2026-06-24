/**
 * Best-effort idempotency marker for inbound webhooks. CloudShare may deliver the
 * same event more than once, but live environment lifecycle payloads do not expose
 * a reliable unique event id and can reuse `CreatedAt` across distinct transitions.
 * The receiver therefore records the synthesised key for support correlation while
 * still accepting verified lifecycle webhooks; the authoritative polling reconcile
 * is idempotent and safe under replay.
 */
export interface WebhookIdempotencyStore {
  /**
   * Atomically record a key. Returns `true` if it had not been seen before (and is
   * now recorded), `false` if it was already seen. Callers may use this as
   * support metadata; for CloudShare environment lifecycle events it must not be
   * used as a hard processing gate.
   */
  markIfNew(key: string): Promise<boolean>;
}
