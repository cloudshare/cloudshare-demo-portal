import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * CloudShare environment webhook contract: signature verification, payload
 * validation, and idempotency-key synthesis. This is the only place that knows
 * CloudShare's webhook wire format; every other layer works with the normalised
 * {@link CloudShareEnvironmentEvent}.
 *
 * Signing scheme: HMAC-SHA256 of the *raw* request body, encoded base64, keyed by
 * the account-level webhook secret (`CLOUDSHARE_WEBHOOK_SECRET`). The raw body must
 * be verified before any JSON re-serialisation, which would change the bytes.
 *
 * NOTE (assumptions to verify against a live tenant — isolated behind this module):
 *  - The wire field names below (`Event`, `EnvironmentExternalId`, `CreatedAt`) and
 *    the event vocabulary are modelled on the documented environment events. Adjust
 *    only here if a live payload differs; this is tracked in the Slice 12 gap report.
 *  - CloudShare cannot send custom headers and the payload carries no unique event
 *    id, so dedupe uses a key synthesised from (environmentExternalId, Event,
 *    CreatedAt) rather than a header or body id.
 *  - The signature is delivered in the {@link CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER}
 *    request header (the route reads it and passes it here).
 */

/** Request header carrying the base64 HMAC signature. Assumption — verify live. */
export const CLOUDSHARE_WEBHOOK_SIGNATURE_HEADER = "x-cloudshare-signature";

/** The environment lifecycle events the portal ingests. */
export const CLOUDSHARE_ENVIRONMENT_EVENT_TYPES = [
  "environment.created",
  "environment.suspended",
  "environment.resumed",
  "environment.deleted",
  "environment.extended",
  "environment.archived",
] as const;

export type CloudShareEnvironmentEventType =
  (typeof CLOUDSHARE_ENVIRONMENT_EVENT_TYPES)[number];

/** A validated, normalised environment webhook event. */
export interface CloudShareEnvironmentEvent {
  readonly event: CloudShareEnvironmentEventType;
  readonly environmentExternalId: string;
  /** The event timestamp as CloudShare sent it; used verbatim in the idempotency key. */
  readonly createdAt: string;
}

const webhookPayloadSchema = z.object({
  Event: z.enum(CLOUDSHARE_ENVIRONMENT_EVENT_TYPES),
  EnvironmentExternalId: z.string().min(1),
  CreatedAt: z.string().min(1),
});

/** Compute the base64 HMAC-SHA256 signature of a raw body. Used by the simulator. */
export function computeWebhookSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

/**
 * Verify a webhook signature against the raw body in constant time. Returns false
 * (never throws) for a missing, malformed, or mismatched signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeWebhookSignature(rawBody, secret), "base64");
  const provided = Buffer.from(signature, "base64");
  // timingSafeEqual requires equal-length buffers; a length mismatch is itself a
  // rejection, checked first so the comparison never throws.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export type ParseWebhookResult =
  | { readonly ok: true; readonly event: CloudShareEnvironmentEvent }
  | { readonly ok: false; readonly issues: string[] };

/** Parse and validate a raw webhook body into a normalised event. */
export function parseWebhookEvent(rawBody: string): ParseWebhookResult {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { ok: false, issues: ["body is not valid JSON"] };
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  return {
    ok: true,
    event: {
      event: parsed.data.Event,
      environmentExternalId: parsed.data.EnvironmentExternalId,
      createdAt: parsed.data.CreatedAt,
    },
  };
}

/**
 * Synthesise a stable idempotency key. CloudShare sends no unique event id, so the
 * key is the tuple that uniquely identifies one logical event: the environment, the
 * event type, and the moment it occurred.
 */
export function synthesiseIdempotencyKey(event: CloudShareEnvironmentEvent): string {
  return `${event.environmentExternalId}:${event.event}:${event.createdAt}`;
}
