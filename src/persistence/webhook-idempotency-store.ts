import type { WebhookIdempotencyStore } from "@/domain/webhook";

/**
 * In-memory {@link WebhookIdempotencyStore} for the demo (Prisma-swappable behind
 * the port — a durable deployment would persist keys so dedupe survives restarts).
 * Single-threaded Node makes the check-and-record effectively atomic here.
 */
export function createInMemoryWebhookIdempotencyStore(): WebhookIdempotencyStore {
  const seen = new Set<string>();

  return {
    async markIfNew(key: string): Promise<boolean> {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
  };
}
