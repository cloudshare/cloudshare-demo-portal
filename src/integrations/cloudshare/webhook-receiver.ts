import type { WebhookIdempotencyStore } from "@/domain/webhook";
import {
  parseWebhookEvent,
  synthesiseIdempotencyKey,
  verifyWebhookSignature,
  type CloudShareEnvironmentEvent,
} from "./webhooks";

/**
 * Ingest one inbound CloudShare webhook request, returning a typed outcome the
 * route maps to an HTTP status. The pipeline is deliberately ordered:
 *
 *   1. Verify the HMAC signature over the raw body — unauthenticated requests are
 *      rejected before anything else looks at the payload.
 *   2. Validate the payload shape with Zod.
 *   3. Compute and record a best-effort idempotency key for support correlation.
 *
 * An `accepted` outcome means "act on this": the route then triggers the polling
 * reconcile, which — not the event payload — is the authoritative state driver.
 * Live CloudShare payloads currently reuse `CreatedAt` from the environment
 * creation time across later lifecycle events, so the synthesised key is not
 * reliable enough to suppress repeat deliveries. Reconcile is idempotent, so
 * accepting a replay is safer than dropping a legitimate later transition.
 *
 * The same path serves real CloudShare webhooks (live mode, via the tunnel) and the
 * environment simulator's identically-signed payloads (demo mode).
 */

export interface ReceiveWebhookDeps {
  /** Account-level webhook secret selected for the resolved Customer. */
  readonly secret: string;
  /** Customer-specific namespace so two tenants cannot dedupe each other's events. */
  readonly idempotencyScope: string;
  readonly idempotency: WebhookIdempotencyStore;
}

export interface RawWebhookRequest {
  readonly rawBody: string;
  readonly signature: string | null | undefined;
}

export type WebhookOutcome =
  | { readonly kind: "accepted"; readonly event: CloudShareEnvironmentEvent; readonly idempotencyKey: string }
  | { readonly kind: "missing_signature" }
  | { readonly kind: "invalid_signature" }
  | { readonly kind: "invalid_payload"; readonly issues: string[] };

export async function receiveWebhook(
  deps: ReceiveWebhookDeps,
  raw: RawWebhookRequest,
): Promise<WebhookOutcome> {
  if (!raw.signature) {
    return { kind: "missing_signature" };
  }

  if (!verifyWebhookSignature(raw.rawBody, raw.signature, deps.secret)) {
    return { kind: "invalid_signature" };
  }

  const parsed = parseWebhookEvent(raw.rawBody);
  if (!parsed.ok) {
    return { kind: "invalid_payload", issues: parsed.issues };
  }

  const idempotencyKey = `${deps.idempotencyScope}:${synthesiseIdempotencyKey(parsed.event)}`;
  await deps.idempotency.markIfNew(idempotencyKey);

  return { kind: "accepted", event: parsed.event, idempotencyKey };
}
