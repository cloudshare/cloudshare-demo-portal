import type { Logger } from "@/observability/logger";
import {
  receiveWebhook,
  type RawWebhookRequest,
} from "@/integrations/cloudshare/webhook-receiver";
import type { WebhookIdempotencyStore } from "@/domain/webhook";

/**
 * Framework-agnostic handler for the inbound CloudShare webhook endpoint. It owns
 * the policy — verify, validate, dedupe, then trigger the authoritative poll — and
 * returns a plain `{ status, body }` the Next.js route serialises. Keeping it free
 * of request/response framework types makes the whole policy unit-testable.
 *
 * HTTP contract:
 *  - 401 invalid signature   — rejected before the payload is trusted
 *  - 400 invalid payload     — failed Zod validation (logged with issues)
 *  - 200 duplicate           — replayed event, acknowledged but not reprocessed
 *  - 202 accepted            — event taken; a `GET environment` reconcile is triggered
 *
 * A reconcile failure is logged but still returns 202: the webhook is only a hint,
 * and the next event or poll re-reads the authoritative state, so a transient poll
 * failure must not make CloudShare retry against a request we already accepted.
 *
 * Any *unexpected* failure before the reconcile step (e.g. a backing idempotency
 * store throwing) is caught and turned into a deliberate 500 `internal_error` —
 * logged without webhook content or secrets — rather than escaping as a bare 500.
 */

export interface CloudShareWebhookDeps {
  /** Account-level webhook secret. */
  readonly secret: string;
  readonly idempotency: WebhookIdempotencyStore;
  /** Trigger the authoritative poll-and-reconcile for one environment. */
  readonly reconcile: (environmentExternalId: string) => Promise<unknown>;
  readonly logger: Logger;
}

export interface CloudShareWebhookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handleCloudShareWebhook(
  deps: CloudShareWebhookDeps,
  request: RawWebhookRequest,
): Promise<CloudShareWebhookResponse> {
  try {
    const outcome = await receiveWebhook(
      { secret: deps.secret, idempotency: deps.idempotency },
      request,
    );

    switch (outcome.kind) {
      case "invalid_signature":
        deps.logger.warn("cloudshare webhook rejected: invalid signature");
        return { status: 401, body: { status: "invalid_signature" } };

      case "invalid_payload":
        deps.logger.warn("cloudshare webhook rejected: invalid payload", {
          issues: outcome.issues,
        });
        return { status: 400, body: { status: "invalid_payload" } };

      case "duplicate":
        deps.logger.info("cloudshare webhook ignored: duplicate event", {
          idempotencyKey: outcome.idempotencyKey,
        });
        return { status: 200, body: { status: "duplicate" } };

      case "accepted": {
        const { event, idempotencyKey } = outcome;
        deps.logger.info("cloudshare webhook accepted", {
          event: event.event,
          environmentExternalId: event.environmentExternalId,
          idempotencyKey,
        });
        // The webhook is only a hint; the poll is the source of truth. Best-effort:
        // a failure here is logged, not surfaced, because the next event/poll recovers.
        try {
          await deps.reconcile(event.environmentExternalId);
        } catch (err) {
          deps.logger.error("cloudshare environment reconcile failed", {
            environmentExternalId: event.environmentExternalId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return { status: 202, body: { status: "accepted" } };
      }
    }
  } catch (err) {
    // An unexpected failure before reconcile (e.g. a backing store throwing). Log
    // the message only — never webhook content or secrets — and return a deliberate
    // 500 rather than letting a bare exception become an opaque framework 500.
    deps.logger.error("cloudshare webhook handler errored", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: { status: "internal_error" } };
  }
}
